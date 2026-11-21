/**
 * @fileoverview MiniappSession — central session object for a local miniapp.
 *
 * Owns the transport, the request/response correlation map, the readiness queue,
 * the PONG auto-reply, the visibility state, and all per-module instances.
 *
 * Lifecycle:
 *   const session = new MiniappSession()
 *   await session.connect()          // sends CONNECT, resolves on CONNECT_ACK
 *   session.display.render([...])
 *   ...
 *   session.disconnect()
 */
import { MiniappColorScheme } from "./globals";
import { MiniappErrorCode, MiniappResponseType } from "./protocol";
import { CreateTransportOptions } from "./transport/auto";
import { CameraModule } from "./modules/camera";
import { AuthModule } from "./modules/auth";
import { CloudModule } from "./modules/cloud";
import { ConfigurationModule } from "./modules/configuration";
import { DashboardAPI } from "./modules/dashboard";
import { DisplayManager } from "./modules/display";
import { EventManager, type UnsubscribeFn } from "./modules/events";
import type { SpeechProcessingOptions } from "./modules/speechProcessing";
import { GlassesModule } from "./modules/glasses";
import { HeadingModule } from "./modules/heading";
import { ImuModule } from "./modules/imu";
import { InputModule } from "./modules/input";
import { LedModule } from "./modules/led";
import { LocationModule } from "./modules/location";
import { MicModule } from "./modules/mic";
import { NavigationModule } from "./modules/navigation";
import { PermissionsModule } from "./modules/permissions";
import { PhoneModule } from "./modules/phone";
import { TranscriptionModule } from "./modules/transcription";
import { TranslationModule } from "./modules/translation";
import { type UIModule } from "./modules/ui";
import { SimpleStorage } from "./modules/storage";
import { SpeakerModule } from "./modules/speaker";
import { StreamModule } from "./modules/stream";
import { SystemModule } from "./modules/system";
import { MiniappsModule } from "./modules/miniapps";
import { ActionsModule } from "./modules/actions";
import { TelemetryModule } from "./modules/telemetry";
import { BlobModule } from "./modules/blob";
import { MeetingModule } from "./modules/meeting";
/**
 * Typed display capabilities for the scene API. All limit fields are optional
 * in the type because older hosts don't send them — treat absence as "unknown",
 * not zero. Populated on the "ready" event (null in `start()`).
 */
export interface DisplayCapabilities {
    /** Legacy panel dimensions. Prefer drawable width/height when present. */
    resolution?: {
        width: number;
        height: number;
    };
    /** Public drawable canvas in px — raw coordinate space for `display.render()` boxes. */
    width?: number;
    height?: number;
    /** False ⇒ the device can't position elements; scenes degrade to text walls host-side. */
    canPosition?: boolean;
    /** Element budgets. Rects share the text pool on container-based devices. */
    maxTextElements?: number;
    maxImageElements?: number;
    /** Per-image dimension cap (box-level), when the device has one. */
    maxImagePx?: {
        width: number;
        height: number;
    };
    shapes?: string[];
    intensityLevels?: number;
    partialUpdate?: boolean;
    /** Legacy capability fields (resolution, isColor, maxTextLines, …) ride along. */
    [key: string]: unknown;
}
/** Minimal snapshot of the currently-connected glasses. Phone-provided. */
export interface GlassesCapabilities {
    /** Display block — null/absent on displayless devices (e.g. Mentra Live). */
    display?: DisplayCapabilities | null;
    [key: string]: unknown;
}
export type MiniappVisibility = "foreground" | "background";
export interface MiniappSessionOptions extends CreateTransportOptions {
    /** Override auto-detected packageName. Normally provided via window.MentraOS. */
    packageName?: string;
    /** Override the ready timeout. Default 10s. */
    connectTimeoutMs?: number;
}
export interface ConnectAckPayload {
    type: MiniappResponseType.CONNECT_ACK;
    userId: string;
    packageName: string;
    capabilities: GlassesCapabilities | null;
    visibility?: MiniappVisibility;
    colorScheme?: MiniappColorScheme;
    /**
     * Manifest-declared permission record. Mirrors cloud SDK v3's PermissionRecord:
     * `{location, microphone, camera, notifications, calendar}` — booleans
     * indicating whether the miniapp's manifest declared each. This is
     * declaration-only; OS-grant state is not modeled.
     */
    permissions?: PermissionRecord;
    /** Miniapp-scoped backend auth. Never a Core or runtime token. */
    auth?: MiniappAuthState;
    /** Optional read-only configuration supplied to this exact package by the host. */
    configuration?: Readonly<Record<string, string>>;
    /** Host-advertised optional features. Absent on older Mentra Apps. */
    hostFeatures?: HostFeatures;
}
export interface HostFeatures {
    /** @internal Runtime projects transcription independently for each listener. */
    transcriptionListeners?: boolean;
    /** Host honors `startStream({captureAudio})` for the lifetime of a WHIP session. */
    captureAudio?: boolean;
    /**
     * Host honors `startStream({ingest: "whip", videoPassthrough})`: on a managed WHIP stream the phone
     * forwards the glasses' encoded video without decoding and re-encoding it. Android only.
     */
    videoPassthrough?: boolean;
    /** Host keeps the UI closed until a background session that announced it sends READY. */
    initReady?: boolean;
    /**
     * Host installs miniapps from a miniapp URL through `session.miniapps.install({url})`. Only a miniapp on the
     * Mentra App's system list may call it; older Mentra Apps answer NOT_PERMITTED.
     */
    miniappInstall?: boolean;
    /** Host takes the miniapp's own events from `session.telemetry.capture` (Fleet Management's miniapp telemetry). */
    telemetry?: boolean;
}
export interface MiniappAuthState {
    mentraUserId: string;
    oemId?: string;
    token: string;
    expiresAt: number;
}
export interface AuthUpdatePayload {
    type: MiniappResponseType.AUTH_UPDATE;
    auth?: MiniappAuthState;
}
/**
 * Manifest-declared permission record. v3-aligned: lowercase canonical keys.
 * Booleans indicate whether the miniapp declared each in its manifest.json.
 */
export type PermissionType = "location" | "microphone" | "camera" | "notifications" | "calendar";
export type PermissionRecord = Record<PermissionType, boolean>;
export declare class NotConnectedError extends Error {
    readonly code = MiniappErrorCode.NOT_CONNECTED;
    constructor(message?: string);
}
/**
 * @internal — `connect()` rejects with this when the host did not answer CONNECT
 * within `connectTimeoutMs`. The session stays usable: `connect()` sends CONNECT again.
 */
export declare class ConnectAckTimeoutError extends Error {
    constructor();
}
export interface MiniappRequestError {
    code: string;
    message: string;
    /** A finer cause, where a request documents one (`INSTALL_FAILED` from `session.miniapps.install`). */
    reason?: string;
}
type SessionEmitterEvents = {
    ready: () => void;
    error: (error: Error) => void;
    /**
     * Last-chance hook before the transport closes. Fires when the phone
     * sends WILL_DISCONNECT, or when this session calls `disconnect()`
     * locally. Handlers run synchronously and may issue one final
     * `sendOneShot`/`sendRequest` (e.g. `display.render([])`); async work won't complete
     * before the socket closes.
     */
    beforeDisconnect: (reason: string) => void;
    disconnect: (reason: string) => void;
    visibility: (v: MiniappVisibility) => void;
    capabilities: (cap: GlassesCapabilities | null) => void;
    colorScheme: (scheme: MiniappColorScheme) => void;
    permissions: (perms: PermissionRecord) => void;
    speakerState: (event: import("./modules/speaker").SpeakerStateEvent) => void;
    meetingState: (event: import("./modules/meeting").MeetingState) => void;
    meetingVideoPublisher: (event: import("./modules/meeting").MeetingVideoPublisherEvent) => void;
    meetingStill: (event: import("./modules/meeting").MeetingStillProgressEvent) => void;
    auth: (auth: MiniappAuthState) => void;
};
export declare class MiniappSession<TChannels extends object = any> {
    readonly auth: AuthModule;
    readonly configuration: ConfigurationModule;
    readonly display: DisplayManager;
    /**
     * Internal subscription registry + escape hatch.
     *
     * Domain modules (`session.mic`, `session.input`, etc.) are the canonical
     * surface for typed event subscriptions. `events.subscribe(...)` remains as
     * a forward-compat escape hatch for new event types not yet wrapped on a
     * domain module.
     */
    readonly events: EventManager;
    readonly speaker: SpeakerModule;
    readonly meeting: MeetingModule;
    readonly camera: CameraModule;
    readonly cloud: CloudModule;
    readonly dashboard: DashboardAPI;
    readonly glasses: GlassesModule;
    readonly heading: HeadingModule;
    readonly imu: ImuModule;
    readonly input: InputModule;
    readonly led: LedModule;
    readonly location: LocationModule;
    readonly mic: MicModule;
    readonly navigation: NavigationModule;
    readonly permissions: PermissionsModule;
    readonly phone: PhoneModule;
    readonly storage: SimpleStorage;
    /**
     * Phone-local persistent BINARY storage (`session.blob`) — the binary
     * counterpart to `session.storage`. Files on disk, scoped to this miniapp.
     * Writes/reads are chunked so large payloads (e.g. captured audio fed in via
     * `session.mic.onAudioChunk`) never cross the bridge in one message.
     */
    readonly blob: BlobModule;
    readonly stream: StreamModule;
    readonly system: SystemModule;
    readonly transcription: TranscriptionModule;
    readonly translation: TranslationModule;
    /**
     * UI message bus to the bound WebView (when one is open).
     * Background-only API surface; mirrors the WebView's `mentra` global
     * with inverted buffering policy (background drops when no WebView is
     * bound; the WebView buffers until ready).
     */
    readonly ui: UIModule<TChannels>;
    /**
     * Inter-miniapp lifecycle + discovery (list / start / stop). SYSTEM-only —
     * calls reject with NOT_PERMITTED unless this miniapp is a system app.
     */
    readonly miniapps: MiniappsModule;
    /**
     * Inter-miniapp action layer. `invoke` (SYSTEM-only) calls another miniapp's
     * declared action; `handle` (open to all) exposes one of your own.
     */
    readonly actions: ActionsModule;
    /** The miniapp's own analytics, shown in its organization's Fleet Management (see {@link TelemetryModule}). */
    readonly telemetry: TelemetryModule;
    /** Phone-declared glasses capabilities. Null until CONNECT_ACK arrives. */
    capabilities: GlassesCapabilities | null;
    /**
     * Host-advertised optional features. Null until CONNECT_ACK. Older Mentra Apps
     * omit this, so miniapps must not assume `captureAudio` is honored.
     */
    hostFeatures: HostFeatures | null;
    userId: string;
    packageName: string;
    visibility: MiniappVisibility;
    /** Host color scheme. Seeded from window.MentraOS, updated via session events. */
    colorScheme: MiniappColorScheme;
    /** True after CONNECT_ACK. Observe with waitForReady() or the "ready" event. */
    ready: boolean;
    private readonly transport;
    private readonly connectTimeoutMs;
    private readonly emitter;
    private authState;
    private configurationState;
    private readonly authWaiters;
    private authRefreshPromise;
    /**
     * Outbound queue for anything sent before CONNECT_ACK. Flushed in FIFO order
     * once the phone responds with CONNECT_ACK. A queued request carries its id so
     * one that has already been rejected is dropped instead of sent.
     */
    private readonly outboundQueue;
    private readonly pendingRequests;
    /** In flight or succeeded. A failed attempt clears it so `connect()` can send CONNECT again. */
    private connectPromise;
    /**
     * Set by the first CONNECT_ACK and never cleared: the handshake completes once
     * per session. The host answers every CONNECT, so after a retry the ACK for
     * another CONNECT of this session can still arrive, in either order. Unlike
     * `ready`, this survives a transport drop, which a session does not recover from.
     */
    private handshakeComplete;
    /** Rejects the handshake in flight. Set only while waiting for CONNECT_ACK. */
    private failHandshake;
    /** Set by `registerMiniapp`: a CONNECT_ACK timeout sends CONNECT again instead of failing `connect()`. */
    private retryHandshake;
    /** Ends the pause before CONNECT is sent again, with the failure that ended it if any. Set only during that pause. */
    private endRetryPause;
    private disposed;
    /**
     * Set by `registerMiniapp` to the host's id for this spawn: CONNECT tells the
     * host to wait for READY, and both carry the id so the host can ignore
     * frames from a previous context.
     */
    private initSessionId;
    /** Manifest-declared permission cache. Updated on CONNECT_ACK / PERMISSIONS_UPDATE. */
    private _permissions;
    constructor(options?: MiniappSessionOptions);
    /** @internal Whether CONNECT_ACK arrived, so `hostFeatures` is the host's answer and not just unknown. */
    get handshakeDone(): boolean;
    /**
     * @internal — synchronous lookup against the cached manifest-declared
     * permission record from CONNECT_ACK / PERMISSIONS_UPDATE. Domain modules
     * use this to expose their `hasPermission` getters without going to the
     * wire. Returns false until CONNECT_ACK arrives.
     *
     * `manifestKey` is the manifest's UPPER_CASE permission name
     * (MICROPHONE, CAMERA, LOCATION, READ_NOTIFICATIONS, etc.). Maps to v3's
     * lowercase canonical keys internally.
     */
    _hasManifestPermission(manifestKey: string): boolean;
    /**
     * @internal — read the current manifest-declared permission record.
     * Powers session.permissions.getAll(). Returns a fresh shallow copy so
     * callers can't mutate internal state.
     */
    _getPermissions(): PermissionRecord;
    /** @internal — current miniapp-scoped backend auth, if the host provided one. */
    _getAuth(): MiniappAuthState | null;
    /** @internal — immutable package configuration received in CONNECT_ACK. */
    _getConfiguration(): Readonly<Record<string, string>>;
    /**
     * @internal — wait for a scoped miniapp token. Used by session.auth; not part
     * of the public SDK surface because authors should never manage wire events.
     */
    _waitForAuth(minTtlMs: number, timeoutMs?: number): Promise<MiniappAuthState>;
    /**
     * @internal — subscribe to a raw stream type. Domain modules call this; it
     * delegates to the EventManager registry. Underscore prefix signals "not
     * part of the public SDK surface — use session.mic.onAudioChunk /
     * session.transcription.on(...)
     * etc. instead."
     */
    _subscribe(streamType: string, handler: (data: unknown) => void, options?: SpeechProcessingOptions): UnsubscribeFn;
    /**
     * Connect to LocalMiniappRuntime. Idempotent while a handshake is in flight
     * or has succeeded: repeat calls return the same Promise. A failed attempt
     * (CONNECT_ACK timeout, transport failure) does not stick, so a later call
     * sends CONNECT again. A session started by `registerMiniapp` keeps sending
     * CONNECT after a timeout, so this Promise (and `waitForReady()`) settles
     * only when the host answers, the transport fails, or the session ends.
     */
    connect(): Promise<void>;
    /**
     * @internal — called by `registerMiniapp` before its handler runs. The host
     * owns this context's lifetime, so a host that has not answered CONNECT is
     * stalled rather than gone: send CONNECT again instead of failing.
     */
    retryHandshakeOnTimeout(): void;
    private connectUntilAcknowledged;
    /**
     * Resolves after CONNECT_RETRY_MS, or as soon as CONNECT_ACK lands or the
     * session ends. Resolves with the error when the transport failed meanwhile.
     */
    private pauseBeforeRetry;
    /** Send one CONNECT and wait for its CONNECT_ACK. */
    private sendConnect;
    /**
     * @internal — called by `registerMiniapp` before `connect()`. The host then
     * keeps the UI closed until {@link reportInitReady}, so UI requests cannot
     * reach the background before its `session.ui.handle` handlers exist.
     */
    announceInitReady(sessionId: string): void;
    /** @internal — the `registerMiniapp` handler settled; let the host open the UI. */
    reportInitReady(): void;
    /** Resolves when `ready` becomes true, or rejects if connect failed. */
    waitForReady(): Promise<void>;
    isConnected(): boolean;
    disconnect(): void;
    /** Send a fire-and-forget request that does not need a response. */
    sendOneShot(payload: object): void;
    /**
     * Send a request and get a Promise that resolves with the REQUEST_RESULT payload.
     * Rejects with a MiniappRequestError if the phone returns an error result.
     *
     * `opts.timeoutMs` overrides the default request timeout. Pass `0` to disable
     * it entirely for inherently long-running requests whose duration is unbounded
     * (e.g. audio playback that resolves only when the clip finishes) — those still
     * settle via REQUEST_RESULT or `failAllPending` on disconnect, so they can't
     * leak. Most requests should keep the default ceiling.
     */
    sendRequest<TResult = unknown>(payload: object, opts?: {
        timeoutMs?: number;
    }): Promise<TResult>;
    on<K extends keyof SessionEmitterEvents>(event: K, handler: SessionEmitterEvents[K]): () => void;
    off<K extends keyof SessionEmitterEvents>(event: K, handler: SessionEmitterEvents[K]): void;
    /**
     * Last-chance hook before the transport closes. Fires either when the
     * phone notifies the session of an imminent disconnect (~50ms grace
     * window before the socket is torn down) or when this session's
     * `disconnect()` is called locally. Use it to flush final cleanup
     * messages — e.g. `display.render([])` — synchronously. Async work
     * started here will not complete before the socket closes.
     */
    onBeforeDisconnect(handler: (reason: string) => void): () => void;
    onVisibilityChange(handler: (v: MiniappVisibility) => void): () => void;
    onCapabilitiesChange(handler: (cap: GlassesCapabilities | null) => void): () => void;
    onColorSchemeChange(handler: (scheme: MiniappColorScheme) => void): () => void;
    private enqueueOrSend;
    private flushQueue;
    private handleIncoming;
    private handleTransportDisconnect;
    private failAllPending;
    private authHasTtl;
    private requestAuthRefresh;
    private applyAuth;
    /**
     * Update the cached permission record. Idempotent: emits "permissions"
     * only when the record actually changed. Sanitizes incoming objects to
     * the v3 PermissionType union.
     */
    private applyPermissions;
}
/** @internal — for the permissions module's onUpdate plumbing. */
export declare function _allPermissionTypes(): readonly PermissionType[];
export {};
//# sourceMappingURL=session.d.ts.map