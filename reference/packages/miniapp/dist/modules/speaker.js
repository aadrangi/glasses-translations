/**
 * @fileoverview SpeakerModule — phone-side audio output.
 *
 * Mirrors cloud SDK v3's SpeakerManager naming. Audio *input* (transcription,
 * audio chunks, VAD) lives on session.mic — the split is by I/O direction.
 *
 * Imperative surface:
 *   speaker.play({audioUrl})   — play an http(s) or data: URL, or one of this
 *                                miniapp's blobs, via the phone's
 *                                AudioPlaybackService.
 *   speaker.speak(text)        — send a SPEAK request. By default the phone
 *                                streams cloud TTS when connected and falls
 *                                back to its on-device voice; the
 *                                `processing` option picks the order.
 *                                Resolves when playback completes; rejects
 *                                with a TTS_* error code on failure.
 *   speaker.createStream(opts) — open a live PCM output stream (16-bit LE).
 *                                Returns a SpeakerStreamWriter: write() PCM
 *                                chunks as they arrive (e.g. from a WebSocket
 *                                in the background), close() to drain, abort()
 *                                to drop. write() resolves with {bufferedMs}
 *                                so producers can throttle.
 *   speaker.stop()             — stop any audio this miniapp is playing.
 *
 * State observability:
 *   speaker.state              — current SpeakerState (sync getter).
 *   speaker.isPlaying          — true iff state === "playing".
 *   speaker.onStateChange(h)   — fires on every state transition.
 *
 * State machine (per miniapp):
 *   idle ─── speak()/play() ──► loading ──► playing ──► stopped
 *                                  │            │           │
 *                                  └── error ───┴── stop ───┘
 *
 * `error` is transient — fires once with errorCode set, then settles to
 * `stopped` so isPlaying reads false correctly.
 */
import { MiniappErrorCode, MiniappRequestType } from "../protocol";
import { bytesToBase64, toUint8Array } from "./base64";
import { resolveSpeechProcessing } from "./speechProcessing";
/** Raw bytes per bridge write. PCM chunks are small; keep messages snappy. */
export const SPEAKER_WRITE_CHUNK_BYTES = 256 * 1024;
// Every non-final base64 slice must decode to complete 16-bit samples. Six
// raw bytes map to eight base64 chars, preserving both base64 and PCM framing.
const SPEAKER_WRITE_CHUNK_B64 = Math.floor(SPEAKER_WRITE_CHUNK_BYTES / 6) * 8;
/**
 * Soft backpressure ceiling. When the host reports more than this buffered,
 * it holds the WRITE reply until the buffer drains below it, so a producer
 * that awaits each write self-throttles to realtime.
 */
export const SPEAKER_STREAM_MAX_BUFFERED_MS = 2000;
/**
 * Live PCM writer returned by `speaker.createStream()`. 16-bit little-endian
 * PCM only — decode compressed formats (MP3/Opus) server-side before sending.
 *
 * Call `write()` as chunks arrive (each is auto-split into bridge-safe
 * messages), then `close()` to drain and finish, or `abort()` to drop
 * immediately. Shaped like BlobWriter so the two stream APIs feel the same.
 */
export class SpeakerStreamWriter {
    constructor(session, streamId) {
        this.session = session;
        this.streamId = streamId;
        this.settled = false;
        this.writeChain = Promise.resolve();
    }
    /**
     * Append raw PCM bytes (16-bit LE). Auto-chunked. Resolves with the host's
     * buffered-ms after the last chunk. The host holds the reply while its
     * buffer is above the backpressure ceiling, so a producer that awaits each
     * write self-throttles to realtime.
     */
    async write(chunk) {
        this.assertOpen();
        const bytes = toUint8Array(chunk);
        if (bytes.byteLength === 0)
            throw new Error("PCM chunk cannot be empty");
        if (bytes.byteLength % 2 !== 0)
            throw new Error("PCM chunk must contain complete 16-bit samples");
        return this.enqueueWrite(async () => {
            let last = { bufferedMs: 0 };
            for (let off = 0; off < bytes.length; off += SPEAKER_WRITE_CHUNK_BYTES) {
                last = await this.send(bytesToBase64(bytes.subarray(off, off + SPEAKER_WRITE_CHUNK_BYTES)));
            }
            return last;
        });
    }
    /** Append already-base64-encoded PCM bytes (e.g. relayed straight off a WS frame). */
    async writeBase64(b64) {
        this.assertOpen();
        if (b64.length === 0 || b64.length % 4 !== 0)
            throw new Error("PCM base64 must be non-empty and padded");
        const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
        const decodedBytes = (b64.length / 4) * 3 - padding;
        if (decodedBytes % 2 !== 0)
            throw new Error("PCM base64 must contain complete 16-bit samples");
        return this.enqueueWrite(async () => {
            let last = { bufferedMs: 0 };
            // Slice on 4-char boundaries so each chunk is whole base64 groups.
            for (let off = 0; off < b64.length; off += SPEAKER_WRITE_CHUNK_B64) {
                last = await this.send(b64.slice(off, off + SPEAKER_WRITE_CHUNK_B64));
            }
            return last;
        });
    }
    /** Drain the remaining buffer and finish. Resolves when playback has ended. */
    async close() {
        this.assertOpen();
        this.settled = true;
        await this.writeChain;
        // Draining takes as long as the buffered audio — opt out of the default
        // request timeout like play()/speak() do.
        const res = await this.session.sendRequest({ type: MiniappRequestType.SPEAKER_STREAM_CLOSE, streamId: this.streamId }, { timeoutMs: 0 });
        return res ?? {};
    }
    /** Stop immediately and drop any buffered audio. Idempotent. */
    async abort() {
        if (this.settled)
            return;
        this.settled = true;
        await this.session.sendRequest({
            type: MiniappRequestType.SPEAKER_STREAM_ABORT,
            streamId: this.streamId,
        });
    }
    assertOpen() {
        if (this.settled)
            throw new Error("SpeakerStreamWriter is already closed/aborted");
    }
    async send(base64) {
        const res = await this.session.sendRequest({
            type: MiniappRequestType.SPEAKER_STREAM_WRITE,
            streamId: this.streamId,
            base64,
        });
        return res ?? { bufferedMs: 0 };
    }
    /** Preserve PCM ordering even when a producer issues overlapping writes. */
    enqueueWrite(operation) {
        const result = this.writeChain.then(operation);
        this.writeChain = result.then(() => undefined, () => undefined);
        return result;
    }
}
export class SpeakerModule {
    constructor(session) {
        this.session = session;
        this._state = "idle";
        this._lastEvent = { state: "idle" };
    }
    /** Current speaker playback state. */
    get state() {
        return this._state;
    }
    /** True iff state === "playing". */
    get isPlaying() {
        return this._state === "playing";
    }
    /** Play a URL. Resolves when playback completes on the phone. */
    async play(options) {
        if (options.startPositionMs !== undefined &&
            (!Number.isFinite(options.startPositionMs) || options.startPositionMs < 0)) {
            throw new RangeError("startPositionMs must be a finite, non-negative number");
        }
        // Playback length is unbounded (a clip can run for minutes), and the host
        // only sends its REQUEST_RESULT when playback finishes or is interrupted, so
        // opt out of the default request timeout — otherwise a long clip would reject
        // with ACTION_TIMEOUT mid-playback. A `stop()` or disconnect still settles it.
        await this.session.sendRequest({
            type: MiniappRequestType.PLAY_AUDIO,
            audioUrl: options.audioUrl,
            ...(options.startPositionMs !== undefined ? { startPositionMs: options.startPositionMs } : {}),
            volume: options.volume,
            stopOtherAudio: options.stopOtherAudio ?? false,
        }, { timeoutMs: 0 });
    }
    async speak(text, options = {}) {
        const normalized = Array.isArray(text) ? text.map((sentence) => sentence.trim()).filter(Boolean) : text.trim();
        if ((Array.isArray(normalized) && normalized.length === 0) || normalized === "") {
            throw { code: MiniappErrorCode.INTERNAL, message: "speak requires at least one non-empty sentence" };
        }
        const processing = resolveSpeechProcessing(options, "speaker.speak(options)");
        try {
            // Like play(): resolves only when TTS playback completes, so opt out of the
            // default request timeout (long text can outlast it). Settled by the host
            // result, a stop(), or disconnect.
            const result = await this.session.sendRequest({
                type: MiniappRequestType.SPEAK,
                text: normalized,
                voice_id: options.voice_id,
                voice_settings: options.voice_settings,
                volume: options.volume,
                stopOtherAudio: options.stopOtherAudio ?? false,
                enableSanitization: options.enableSanitization ?? true,
                processing,
                // Hosts before `processing` (Mentra App 3.4.0) read only this flag.
                forceLocal: processing === "localOnly",
            }, { timeoutMs: 0 });
            return result ?? { completed: true };
        }
        catch (err) {
            // Normalize so callers can `catch (e) { if (e.code === "TTS_TEXT_TOO_LONG") ...`
            if (err && typeof err === "object" && "code" in err) {
                throw err;
            }
            throw { code: MiniappErrorCode.INTERNAL, message: String(err) };
        }
    }
    /**
     * Open a live PCM output stream (16-bit LE) to the phone's audio playback
     * service. Use from the background to play audio that arrives in chunks
     * (e.g. live meeting audio over a WebSocket) with low latency — unlike
     * `play()`, nothing has to be a file or URL first.
     *
     * One stream per miniapp: opening a second closes the first. Rejects with
     * `NOT_IMPLEMENTED` on hosts that predate streaming. Miniapps that depend on
     * this API must declare `minHostVersion: "2.13.0"` or newer.
     */
    async createStream(options = {}) {
        if (options.volume !== undefined &&
            (!Number.isFinite(options.volume) || options.volume < 0 || options.volume > 1)) {
            throw new RangeError("speaker stream volume must be between 0 and 1");
        }
        if (options.jitterMs !== undefined &&
            (!Number.isFinite(options.jitterMs) || options.jitterMs < 80 || options.jitterMs > 500))
            throw new RangeError("speaker stream jitterMs must be between 80 and 500");
        const res = await this.session.sendRequest({
            type: MiniappRequestType.SPEAKER_STREAM_OPEN,
            sampleRate: options.sampleRate ?? 16000,
            ...(options.jitterMs === undefined ? {} : { jitterMs: options.jitterMs }),
            ...(options.prewarm === undefined ? {} : { prewarm: options.prewarm }),
            channels: options.channels ?? 1,
            volume: options.volume,
            stopOtherAudio: options.stopOtherAudio ?? true,
        });
        return new SpeakerStreamWriter(this.session, res.streamId);
    }
    /** Stop any audio this miniapp is currently playing. */
    stop() {
        this.session.sendOneShot({ type: MiniappRequestType.STOP_AUDIO });
    }
    /**
     * Subscribe to speaker state transitions. Fires for every change. Does NOT
     * fire immediately with the current value — call `state` separately if you
     * want the seed.
     */
    onStateChange(handler) {
        return this.session.on("speakerState", handler);
    }
    /** @internal — applied by MiniappSession on inbound SPEAKER_STATE envelope. */
    _applyState(event) {
        // Idempotent: skip if state didn't change. Error events are transient
        // and are not deduped against the prior state — they're informational
        // and the phone immediately follows up with `stopped`.
        if (event.state === this._state && event.state !== "error")
            return;
        this._state = event.state;
        this._lastEvent = event;
    }
    /** @internal — for tests. */
    _getLastEvent() {
        return { ...this._lastEvent };
    }
}
//# sourceMappingURL=speaker.js.map