/**
 * @fileoverview StreamModule -- video streaming from glasses.
 *
 * Wires to cloud streaming extensions via the __phone__ subscriber path.
 *
 * One entry point: `startStream`. By default it provisions a Mentra-hosted
 * stream and returns playback URLs (managed). Pass `direct` to publish straight
 * to your own ingest URL with no relay.
 */
import { type PreviewErrorCode, type PreviewSource } from "../protocol";
import type { UnsubscribeFn } from "./events";
import { MiniappSession } from "../session";
export interface StreamVideoConfig {
    width?: number;
    height?: number;
    bitrate?: number;
    /** WHIP minimum target in bps; omitted leaves it unset. Clamped to the maximum. */
    minBitrateBps?: number;
    /** WHIP startup bitrate in bps, clamped to the requested bounds. */
    initialBitrateBps?: number;
    fps?: number;
}
export interface StreamAudioConfig {
    bitrate?: number;
    sampleRate?: number;
    echoCancellation?: boolean;
    noiseSuppression?: boolean;
}
export interface StreamResolvedConfig {
    transport?: "rtmp" | "srt" | "whip";
    video?: {
        width: number;
        height: number;
        captureWidth?: number;
        captureHeight?: number;
        bitrate: number;
        fps: number;
    };
    audio?: {
        bitrate?: number;
        sampleRate?: number;
        echoCancellation?: boolean;
        noiseSuppression?: boolean;
    };
}
/**
 * Restream destination. The full stream key is part of the URL (e.g.
 * `rtmp://yt.com/live/STREAM-KEY`). `name` is a human label that surfaces
 * in dashboards but doesn't affect routing.
 */
export interface RestreamDestination {
    url: string;
    name?: string;
}
export interface StartStreamOptions {
    /**
     * Publish straight to your own ingest URL (rtmp/rtmps/srt/whip). The glasses
     * connect to it directly with no Mentra relay, so no playback URLs come back.
     * Omit this to use the managed relay (the default, best for most apps).
     */
    direct?: string;
    /**
     * Restream destinations the managed relay fans out to (YouTube, Twitch, …).
     * Bare URL strings or `{url, name?}` objects; mix freely. Managed streams
     * only — ignored when `direct` is set.
     */
    destinations?: Array<string | RestreamDestination>;
    video?: StreamVideoConfig;
    audio?: StreamAudioConfig;
    /** Play glasses-side stream start/stop sounds. Defaults to true. */
    sound?: boolean;
    /**
     * Managed ingest protocol, a latency/durability trade. Ignored when `direct`
     * is set.
     *   - "srt" (default): ~10-20s latency via LL-HLS, shareable HLS/DASH URLs,
     *     and automatic recording.
     *   - "whip": sub-second WebRTC playback (use `webrtcUrl`/WHEP), but no
     *     HLS/DASH and no recording.
     *   - "rtmp": RTMPS ingest over TCP 443 → HLS playback. Use when WHIP/SRT
     *     UDP is blocked (then play `hlsUrl`, not WHEP).
     */
    ingest?: "srt" | "whip" | "rtmp";
    /** Optional Bearer token for direct WHIP Authorization (custom authenticated endpoints). */
    authToken?: string;
    /**
     * When false, glasses skip mic capture for this WHIP session. Fixed for the
     * lifetime of the stream. Defaults to true. Older Mentra Apps ignore this.
     */
    captureAudio?: boolean;
    /**
     * Managed WHIP only. The phone relays the glasses' video through its own uplink; with this set it
     * forwards the encoded H.264 as it arrives instead of decoding and encoding it again. That saves the
     * phone's CPU and a generation of picture quality. The cost is that the picture size and bitrate are
     * the glasses', so a weak uplink cannot be adapted to. Ignored unless the host sets
     * `hostFeatures.videoPassthrough`, so a caller can pass it without checking.
     */
    videoPassthrough?: boolean;
}
export interface StreamResult {
    streamId: string;
    status: string;
    resolvedConfig?: StreamResolvedConfig;
    /** Managed streams only: the live-input UID for building hosted-player URLs. */
    liveInputId?: string;
    /** Managed streams only: which playback this stream serves. In "webrtc" mode
     *  `hlsUrl` never serves content. */
    mode?: "hls" | "webrtc";
    /** Managed streams only: HLS playback URL. */
    hlsUrl?: string;
    /** Managed streams only: DASH playback URL. */
    dashUrl?: string;
    /** Managed streams only: WHEP playback URL (present in "webrtc" mode). */
    webrtcUrl?: string;
}
/** Live encoder and device telemetry emitted periodically by supported glasses firmware. */
export interface StreamLiveStats {
    /** Current encoded video bitrate in bits per second. */
    bitrate?: number;
    /** Current encode frame rate. */
    fps?: number;
    droppedFrames?: number;
    /** Seconds since the stream started. */
    duration?: number;
    /** Device temperature in °C, if the hardware reports it. */
    temperatureC?: number;
}
/** Who reported a {@link StreamStatus}. */
export type StreamStatusSource = "glasses" | "cloudflare" | "coordinator";
/**
 * One stream status update. Statuses you can act on:
 *   - `source: "glasses"` — the glasses publisher: `streaming`, `reconnecting`,
 *     `reconnected`, `error`, `stopped`, ... with `kind`, `attempt`/`maxAttempts`
 *     on reconnects and `terminal: true` when the publisher gave up.
 *   - `source: "cloudflare"` — what the managed ingest sees, polled every 5s:
 *     `connected` / `disconnected`. Managed streams only.
 *   - `source: "coordinator"` — the phone: `connected`, `reconnecting` and
 *     `reconnected` for the WHIP phone relay (`transport: "softap_relay"`),
 *     `suspended` / `resumed` while Bluetooth to the glasses is down,
 *     `hls_ready` / `webrtc_ready` for playback, and `error` when the stream
 *     has ended and must be started again.
 */
export interface StreamStatus {
    streamId: string;
    status: string;
    source?: StreamStatusSource;
    /** Glasses status kind (`lifecycle`, `reconnect`, `error`, `snapshot`, ...). */
    kind?: string;
    /** Human-readable cause, when the reporter gave one. */
    reason?: string;
    errorDetails?: string;
    /** The glasses publisher gave up; the stream will not recover by itself. */
    terminal?: boolean;
    willRetry?: boolean;
    attempt?: number;
    maxAttempts?: number;
    /** `"softap_relay"` on WHIP relay statuses. */
    transport?: string;
    /** Negotiated encode config — forwarded once, on the first status ack. */
    resolvedConfig?: StreamResolvedConfig;
    stats?: StreamLiveStats;
    [key: string]: unknown;
}
export interface StreamPreviewOptions {
    /** Defaults to `"call"`. `"glasses"` is reserved and rejects with `unsupported`. */
    source?: PreviewSource;
}
export type PreviewHandleState = "held" | "ended";
export interface PreviewHandleStatus {
    state: PreviewHandleState;
    /** Set when `state` is `"ended"`: `stopped`, `source_ended`, `runtime_stopped`, ... */
    reason?: string;
}
/** A preview request or lease failed. `code` is one of {@link PreviewErrorCode} when the host sent one. */
export declare class PreviewError extends Error {
    readonly code: PreviewErrorCode | string;
    constructor(code: PreviewErrorCode | string, message?: string);
}
/**
 * The background-owned lease on a preview source.
 *
 * The lease is what lets a `<StreamPreview>` in the UI show frames. It survives the UI closing and
 * the WebView being destroyed, and ends on `stop()`, when the source ends (the meeting is over), or
 * when the background runtime stops. Hiding the component does not release it.
 */
export interface PreviewHandle {
    readonly source: PreviewSource;
    readonly handleId: string;
    /** Correlation id stamped on every `PREVIEW_TRACE` log line for this lease. */
    readonly previewTraceId: string;
    readonly state: PreviewHandleState;
    /** Release the lease. Idempotent. */
    stop(): Promise<void>;
    /** Lease transitions. Fires `{state: "ended", reason}` exactly once. */
    onStatus(cb: (status: PreviewHandleStatus) => void): () => void;
}
export declare class StreamModule {
    private readonly session;
    private readonly previewHandles;
    constructor(session: MiniappSession);
    /**
     * Take the preview lease on a source so a `<StreamPreview>` in the UI can show its frames.
     *
     * For `"call"` the caller must declare `CAMERA` and own the active meeting (`session.meeting`).
     * Only one lease exists at a time; a second request fails with `preview_busy`. Rejects with a
     * {@link PreviewError}. Never await this on a call's connect path: preview is additive.
     */
    preview(options?: StreamPreviewOptions): Promise<PreviewHandle>;
    private releasePreview;
    /** @internal — applied by MiniappSession on inbound STREAM_PREVIEW_STATUS. */
    _applyPreviewStatus(payload: Record<string, unknown>): void;
    /**
     * Start a live video stream from the glasses camera.
     *
     * Managed (default) -- Mentra hosts the stream and the result carries
     * `hlsUrl`/`dashUrl`/`webrtcUrl` for playback. Optionally fan out to your own
     * `destinations`.
     *
     * Direct -- pass `direct` with your own ingest URL; the glasses publish to it
     * and no playback URLs are returned.
     */
    startStream(options?: StartStreamOptions): Promise<StreamResult>;
    /**
     * Listen for status updates on the stream this miniapp started or joined.
     * Returns an unsubscribe function.
     *
     * A stream that is recovering on its own reports `reconnecting`, then
     * `reconnected`, and keeps its `streamId` and playback URLs. A
     * `source: "coordinator"` status of `error` means the stream has ended: call
     * `startStream()` again, which returns new playback URLs.
     */
    onStatus(handler: (status: StreamStatus) => void): UnsubscribeFn;
    /** Stop the active stream, or a specific one by `streamId`. */
    stop(streamId?: string): Promise<void>;
}
//# sourceMappingURL=stream.d.ts.map