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
import { MiniappSession } from "../session";
import type { UnsubscribeFn } from "./events";
import { type SpeechProcessing } from "./speechProcessing";
export interface PlayAudioOptions {
    /**
     * An http(s) or `data:` URL, or the `file://` uri of one of this miniapp's
     * blobs (`session.blob`). The host refuses any other file or scheme.
     */
    audioUrl: string;
    /** Start playback at this offset in milliseconds. Defaults to zero. */
    startPositionMs?: number;
    volume?: number;
    stopOtherAudio?: boolean;
}
export interface SpeakOptions {
    voice_id?: string;
    voice_settings?: Record<string, unknown>;
    volume?: number;
    stopOtherAudio?: boolean;
    /**
     * Normalize display-oriented markup and symbols into natural spoken words.
     * Defaults to true. Set false when exact characters must reach the TTS engine.
     */
    enableSanitization?: boolean;
    /**
     * Where the speech is synthesized. Default `"preferCloud"`.
     *
     * - `"preferCloud"`: cloud TTS while the cloud is connected, otherwise the
     *   phone's on-device voice.
     * - `"preferLocal"`: the on-device voice when its model is ready and can say
     *   it (an explicit cloud `voice_id` cannot), otherwise cloud TTS.
     * - `"localOnly"`: the on-device voice only; never the cloud. Rejects with
     *   `TTS_LOCAL_UNAVAILABLE` when the on-device model isn't ready.
     */
    processing?: SpeechProcessing;
    /** @deprecated Use `processing: "localOnly"`. Removed in 4.0; ignored when `processing` is set. */
    forceLocal?: boolean;
}
export interface SpeakResult {
    /** True if playback completed; false if playback was interrupted. */
    completed: boolean;
}
export type SpeakerState = "idle" | "loading" | "playing" | "stopped" | "error";
/** Sample rates the native chunk player accepts. */
export type SpeakerStreamSampleRate = 16000 | 24000 | 48000;
export interface SpeakerStreamOptions {
    /** PCM sample rate in Hz. Default 16000. */
    sampleRate?: SpeakerStreamSampleRate;
    /**
     * Open the native stream now and keep it idle until the first write, so a
     * later sound only has to write samples. The speaker reports `idle` and other
     * audio is left alone until then. If the audio route changes before the
     * first write (Bluetooth or glasses connect/disconnect, a call, an audio
     * interruption), the phone closes the stream and the next write fails with
     * "not open"; open a fresh stream then.
     */
    prewarm?: boolean;
    /**
     * How much audio (80–500 ms) the phone queues before playback starts, and
     * the cushion against gaps after that. Default 500. A sound shorter than
     * this still plays once you close the stream. Use a small value such as 80
     * for short cues that should start immediately.
     */
    jitterMs?: number;
    /** Channel count. v1 is mono only. Default 1. */
    channels?: 1;
    /** Playback volume 0..1. Default 1. */
    volume?: number;
    /** Stop any other audio this miniapp is playing first. Default true. */
    stopOtherAudio?: boolean;
}
export interface SpeakerStreamWriteResult {
    /** Milliseconds of audio queued host-side but not yet played. */
    bufferedMs: number;
}
/** Raw bytes per bridge write. PCM chunks are small; keep messages snappy. */
export declare const SPEAKER_WRITE_CHUNK_BYTES: number;
/**
 * Soft backpressure ceiling. When the host reports more than this buffered,
 * it holds the WRITE reply until the buffer drains below it, so a producer
 * that awaits each write self-throttles to realtime.
 */
export declare const SPEAKER_STREAM_MAX_BUFFERED_MS = 2000;
/**
 * Live PCM writer returned by `speaker.createStream()`. 16-bit little-endian
 * PCM only — decode compressed formats (MP3/Opus) server-side before sending.
 *
 * Call `write()` as chunks arrive (each is auto-split into bridge-safe
 * messages), then `close()` to drain and finish, or `abort()` to drop
 * immediately. Shaped like BlobWriter so the two stream APIs feel the same.
 */
export declare class SpeakerStreamWriter {
    private readonly session;
    readonly streamId: string;
    private settled;
    private writeChain;
    constructor(session: MiniappSession, streamId: string);
    /**
     * Append raw PCM bytes (16-bit LE). Auto-chunked. Resolves with the host's
     * buffered-ms after the last chunk. The host holds the reply while its
     * buffer is above the backpressure ceiling, so a producer that awaits each
     * write self-throttles to realtime.
     */
    write(chunk: Uint8Array | ArrayBuffer): Promise<SpeakerStreamWriteResult>;
    /** Append already-base64-encoded PCM bytes (e.g. relayed straight off a WS frame). */
    writeBase64(b64: string): Promise<SpeakerStreamWriteResult>;
    /** Drain the remaining buffer and finish. Resolves when playback has ended. */
    close(): Promise<{
        durationMs?: number;
    }>;
    /** Stop immediately and drop any buffered audio. Idempotent. */
    abort(): Promise<void>;
    private assertOpen;
    private send;
    /** Preserve PCM ordering even when a producer issues overlapping writes. */
    private enqueueWrite;
}
export interface SpeakerStateEvent {
    state: SpeakerState;
    /** When state === "error", the underlying error code (TTS_*, INTERNAL). */
    errorCode?: string;
    errorMessage?: string;
    /** When state === "stopped", how many ms the playback ran (best-effort). */
    durationMs?: number;
}
export declare class SpeakerModule {
    private readonly session;
    private _state;
    private _lastEvent;
    constructor(session: MiniappSession);
    /** Current speaker playback state. */
    get state(): SpeakerState;
    /** True iff state === "playing". */
    get isPlaying(): boolean;
    /** Play a URL. Resolves when playback completes on the phone. */
    play(options: PlayAudioOptions): Promise<void>;
    /**
     * Speak text through the phone, in the cloud or on-device as
     * `options.processing` says (default: cloud TTS when connected, then the
     * on-device voice).
     *
     * Rejects with a MiniappRequestError containing a `code` field on cloud-side
     * TTS failures: `TTS_TEXT_TOO_LONG`, `TTS_INVALID_VOICE`, `TTS_UPSTREAM_ERROR`.
     */
    speak(text: string, options?: SpeakOptions): Promise<SpeakResult>;
    speak(sentences: string[], options?: SpeakOptions): Promise<SpeakResult>;
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
    createStream(options?: SpeakerStreamOptions): Promise<SpeakerStreamWriter>;
    /** Stop any audio this miniapp is currently playing. */
    stop(): void;
    /**
     * Subscribe to speaker state transitions. Fires for every change. Does NOT
     * fire immediately with the current value — call `state` separately if you
     * want the seed.
     */
    onStateChange(handler: (event: SpeakerStateEvent) => void): UnsubscribeFn;
    /** @internal — applied by MiniappSession on inbound SPEAKER_STATE envelope. */
    _applyState(event: SpeakerStateEvent): void;
    /** @internal — for tests. */
    _getLastEvent(): SpeakerStateEvent;
}
//# sourceMappingURL=speaker.d.ts.map