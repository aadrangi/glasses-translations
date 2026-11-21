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
import { EventEmitter } from "eventemitter3";
import { makeRequestId, parseEnvelope, serializeEnvelope } from "./envelope";
import { getMentraOSGlobals } from "./globals";
import { MiniappErrorCode, MiniappRequestType, MiniappResponseType } from "./protocol";
import { createTransport } from "./transport/auto";
import { CameraModule } from "./modules/camera";
import { AuthModule } from "./modules/auth";
import { CloudModule } from "./modules/cloud";
import { ConfigurationModule } from "./modules/configuration";
import { DashboardAPI } from "./modules/dashboard";
import { DisplayManager } from "./modules/display";
import { EventManager } from "./modules/events";
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
import { UIModuleImpl } from "./modules/ui";
import { SimpleStorage } from "./modules/storage";
import { SpeakerModule } from "./modules/speaker";
import { StreamModule } from "./modules/stream";
import { SystemModule } from "./modules/system";
import { MiniappsModule } from "./modules/miniapps";
import { ActionsModule } from "./modules/actions";
import { TelemetryModule } from "./modules/telemetry";
import { BlobModule } from "./modules/blob";
import { MeetingModule, parseMeetingCapabilities, parseMeetingEndReason, parseMeetingMediaSource, parseMeetingParticipants, parseMeetingRecovery, parseMeetingSoftApProgress, } from "./modules/meeting";
const ALL_PERMISSION_TYPES = [
    "location",
    "microphone",
    "camera",
    "notifications",
    "calendar",
];
export class NotConnectedError extends Error {
    constructor(message = "MiniappSession is not connected") {
        super(message);
        this.code = MiniappErrorCode.NOT_CONNECTED;
        this.name = "NotConnectedError";
    }
}
/**
 * @internal — `connect()` rejects with this when the host did not answer CONNECT
 * within `connectTimeoutMs`. The session stays usable: `connect()` sends CONNECT again.
 */
export class ConnectAckTimeoutError extends Error {
    constructor() {
        super("MiniappSession: CONNECT_ACK timeout");
        this.name = "ConnectAckTimeoutError";
    }
}
const DEFAULT_CONNECT_TIMEOUT_MS = 10000;
/** Pause before a `registerMiniapp` session sends CONNECT again after a CONNECT_ACK timeout. */
const CONNECT_RETRY_MS = 1000;
// Hard ceiling on how long a single bridge request waits for the host's
// REQUEST_RESULT. Without it, a host that never responds (a hung cloud call, a
// GPS fix that never arrives, a native handler that stalls) leaves the request
// promise pending FOREVER — which is what stalled navigation at "Starting…"
// (the controller's `starting` guard never reset because start() never settled).
// 60s is generous: it covers a slow route computation while still guaranteeing
// the promise eventually rejects so callers can roll back / surface an error.
const DEFAULT_REQUEST_TIMEOUT_MS = 60000;
// The default preserves the pre-channel-registry behavior for code that creates
// or accepts a bare MiniappSession. `registerMiniapp<Channels>` supplies the
// concrete mapping for scaffolded miniapps.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class MiniappSession {
    constructor(options = {}) {
        /** Phone-declared glasses capabilities. Null until CONNECT_ACK arrives. */
        this.capabilities = null;
        /**
         * Host-advertised optional features. Null until CONNECT_ACK. Older Mentra Apps
         * omit this, so miniapps must not assume `captureAudio` is honored.
         */
        this.hostFeatures = null;
        this.userId = "";
        this.packageName = "";
        this.visibility = "foreground";
        /** Host color scheme. Seeded from window.MentraOS, updated via session events. */
        this.colorScheme = "light";
        /** True after CONNECT_ACK. Observe with waitForReady() or the "ready" event. */
        this.ready = false;
        this.emitter = new EventEmitter();
        this.authState = null;
        this.configurationState = {};
        this.authWaiters = new Set();
        this.authRefreshPromise = null;
        /**
         * Outbound queue for anything sent before CONNECT_ACK. Flushed in FIFO order
         * once the phone responds with CONNECT_ACK. A queued request carries its id so
         * one that has already been rejected is dropped instead of sent.
         */
        this.outboundQueue = [];
        this.pendingRequests = new Map();
        /** In flight or succeeded. A failed attempt clears it so `connect()` can send CONNECT again. */
        this.connectPromise = null;
        /**
         * Set by the first CONNECT_ACK and never cleared: the handshake completes once
         * per session. The host answers every CONNECT, so after a retry the ACK for
         * another CONNECT of this session can still arrive, in either order. Unlike
         * `ready`, this survives a transport drop, which a session does not recover from.
         */
        this.handshakeComplete = false;
        /** Rejects the handshake in flight. Set only while waiting for CONNECT_ACK. */
        this.failHandshake = null;
        /** Set by `registerMiniapp`: a CONNECT_ACK timeout sends CONNECT again instead of failing `connect()`. */
        this.retryHandshake = false;
        /** Ends the pause before CONNECT is sent again, with the failure that ended it if any. Set only during that pause. */
        this.endRetryPause = null;
        this.disposed = false;
        /**
         * Set by `registerMiniapp` to the host's id for this spawn: CONNECT tells the
         * host to wait for READY, and both carry the id so the host can ignore
         * frames from a previous context.
         */
        this.initSessionId = null;
        /** Manifest-declared permission cache. Updated on CONNECT_ACK / PERMISSIONS_UPDATE. */
        this._permissions = {
            location: false,
            microphone: false,
            camera: false,
            notifications: false,
            calendar: false,
        };
        this.transport = createTransport(options);
        this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
        const injected = getMentraOSGlobals();
        this.packageName = options.packageName ?? injected.packageName ?? "";
        if (injected.colorScheme === "light" || injected.colorScheme === "dark") {
            this.colorScheme = injected.colorScheme;
        }
        this.auth = new AuthModule(this);
        this.configuration = new ConfigurationModule(this);
        this.events = new EventManager(this);
        this.speaker = new SpeakerModule(this);
        this.meeting = new MeetingModule(this);
        this.camera = new CameraModule(this);
        this.cloud = new CloudModule(this);
        this.dashboard = new DashboardAPI(this);
        this.display = new DisplayManager(this);
        this.glasses = new GlassesModule(this);
        this.heading = new HeadingModule(this);
        this.imu = new ImuModule(this);
        this.input = new InputModule(this);
        this.led = new LedModule(this);
        this.location = new LocationModule(this);
        this.mic = new MicModule(this);
        this.navigation = new NavigationModule(this);
        this.permissions = new PermissionsModule(this);
        this.phone = new PhoneModule(this);
        this.storage = new SimpleStorage(this);
        this.blob = new BlobModule(this);
        this.stream = new StreamModule(this);
        this.system = new SystemModule(this);
        this.transcription = new TranscriptionModule(this);
        this.translation = new TranslationModule(this);
        this.ui = new UIModuleImpl(this);
        this.miniapps = new MiniappsModule(this);
        this.actions = new ActionsModule(this);
        this.telemetry = new TelemetryModule(this);
    }
    /** @internal Whether CONNECT_ACK arrived, so `hostFeatures` is the host's answer and not just unknown. */
    get handshakeDone() {
        return this.handshakeComplete;
    }
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
    _hasManifestPermission(manifestKey) {
        const canonical = manifestKeyToCanonical(manifestKey);
        if (!canonical)
            return false;
        return this._permissions[canonical] === true;
    }
    /**
     * @internal — read the current manifest-declared permission record.
     * Powers session.permissions.getAll(). Returns a fresh shallow copy so
     * callers can't mutate internal state.
     */
    _getPermissions() {
        return { ...this._permissions };
    }
    /** @internal — current miniapp-scoped backend auth, if the host provided one. */
    _getAuth() {
        return this.authState ? { ...this.authState } : null;
    }
    /** @internal — immutable package configuration received in CONNECT_ACK. */
    _getConfiguration() {
        return { ...this.configurationState };
    }
    /**
     * @internal — wait for a scoped miniapp token. Used by session.auth; not part
     * of the public SDK surface because authors should never manage wire events.
     */
    _waitForAuth(minTtlMs, timeoutMs = 10000) {
        const current = this.authState;
        if (current && this.authHasTtl(current, minTtlMs)) {
            return Promise.resolve({ ...current });
        }
        void this.requestAuthRefresh(minTtlMs);
        return new Promise((resolve, reject) => {
            const waiter = {
                minTtlMs,
                resolve,
                reject,
                timer: setTimeout(() => {
                    this.authWaiters.delete(waiter);
                    reject(new NotConnectedError("Miniapp auth token is not available"));
                }, timeoutMs),
            };
            this.authWaiters.add(waiter);
        });
    }
    /**
     * @internal — subscribe to a raw stream type. Domain modules call this; it
     * delegates to the EventManager registry. Underscore prefix signals "not
     * part of the public SDK surface — use session.mic.onAudioChunk /
     * session.transcription.on(...)
     * etc. instead."
     */
    _subscribe(streamType, handler, options = {}) {
        return this.events.subscribe(streamType, handler, options);
    }
    // -------------------------------------------------------------------------
    // Connection lifecycle
    // -------------------------------------------------------------------------
    /**
     * Connect to LocalMiniappRuntime. Idempotent while a handshake is in flight
     * or has succeeded: repeat calls return the same Promise. A failed attempt
     * (CONNECT_ACK timeout, transport failure) does not stick, so a later call
     * sends CONNECT again. A session started by `registerMiniapp` keeps sending
     * CONNECT after a timeout, so this Promise (and `waitForReady()`) settles
     * only when the host answers, the transport fails, or the session ends.
     */
    connect() {
        if (this.disposed) {
            return Promise.reject(new NotConnectedError("MiniappSession was disposed"));
        }
        if (this.connectPromise)
            return this.connectPromise;
        // A CONNECT_ACK that arrived after an earlier attempt timed out still completed the handshake.
        if (this.handshakeComplete) {
            this.connectPromise = Promise.resolve();
            return this.connectPromise;
        }
        const attempt = this.retryHandshake ? this.connectUntilAcknowledged() : this.sendConnect();
        this.connectPromise = attempt;
        attempt.catch(() => {
            // Registered before the caller's handlers, so a retry from a rejection handler sends CONNECT again.
            if (this.connectPromise === attempt)
                this.connectPromise = null;
        });
        return attempt;
    }
    /**
     * @internal — called by `registerMiniapp` before its handler runs. The host
     * owns this context's lifetime, so a host that has not answered CONNECT is
     * stalled rather than gone: send CONNECT again instead of failing.
     */
    retryHandshakeOnTimeout() {
        this.retryHandshake = true;
    }
    async connectUntilAcknowledged() {
        for (;;) {
            try {
                await this.sendConnect();
                return;
            }
            catch (err) {
                if (this.disposed || !(err instanceof ConnectAckTimeoutError))
                    throw err;
            }
            // eslint-disable-next-line no-console
            console.warn("[mentra-miniapp] CONNECT_ACK timed out; sending CONNECT again");
            const failure = await this.pauseBeforeRetry();
            if (failure)
                throw failure;
            // The CONNECT_ACK for an earlier CONNECT can still land during the pause.
            if (this.handshakeComplete)
                return;
            if (this.disposed)
                throw new NotConnectedError("MiniappSession: connect aborted");
        }
    }
    /**
     * Resolves after CONNECT_RETRY_MS, or as soon as CONNECT_ACK lands or the
     * session ends. Resolves with the error when the transport failed meanwhile.
     */
    pauseBeforeRetry() {
        return new Promise((resolve) => {
            const end = (failure) => {
                clearTimeout(timer);
                this.emitter.off("ready", onReady);
                if (this.endRetryPause === end)
                    this.endRetryPause = null;
                resolve(failure);
            };
            const onReady = () => end();
            const timer = setTimeout(end, CONNECT_RETRY_MS);
            this.emitter.on("ready", onReady);
            this.endRetryPause = end;
        });
    }
    /** Send one CONNECT and wait for its CONNECT_ACK. */
    sendConnect() {
        // Only a host that received CONNECT can be waited out. Before that, the transport is what failed.
        let connectSent = false;
        // This attempt's own outcome. A slow open() can finish after a newer attempt
        // took over, so nothing below acts through the session-wide failHandshake.
        let attemptSettled = false;
        let failAttempt = () => { };
        // Register the readiness listener BEFORE any awaits so that a synchronous
        // CONNECT_ACK delivery in tests (or the phone) can't race the subscription.
        const readyPromise = new Promise((resolve, reject) => {
            const settle = (error) => {
                if (attemptSettled)
                    return;
                attemptSettled = true;
                clearTimeout(timer);
                this.emitter.off("ready", onReady);
                this.emitter.off("error", onError);
                if (this.failHandshake === onError)
                    this.failHandshake = null;
                if (error)
                    reject(error);
                else
                    resolve();
            };
            const onReady = () => settle();
            const onError = (error) => settle(error);
            const timer = setTimeout(() => {
                const err = connectSent
                    ? new ConnectAckTimeoutError()
                    : new Error("MiniappSession: transport did not open before the CONNECT_ACK timeout");
                // Settled before the public emit, so a throwing "error" listener cannot leave it pending.
                settle(err);
                // Requests queued for a retried handshake wait for it, bounded by their own timeouts.
                if (connectSent && this.retryHandshake)
                    return;
                this.failAllPending({ code: MiniappErrorCode.NOT_CONNECTED, message: err.message });
                this.emitter.emit("error", err);
            }, this.connectTimeoutMs);
            this.emitter.on("ready", onReady);
            this.emitter.on("error", onError);
            this.failHandshake = onError;
            failAttempt = onError;
        });
        // Settles once CONNECT is sent, or rejects if opening or sending fails.
        const sent = (async () => {
            try {
                this.transport.onMessage((raw) => this.handleIncoming(raw));
                this.transport.onDisconnect((reason) => this.handleTransportDisconnect(reason));
                // An open transport stays as it is: a retried handshake only sends CONNECT again.
                const opening = this.transport.isOpen() ? Promise.resolve() : this.transport.open();
                // An open that finishes after disconnect() must not leave the transport open.
                opening.then(() => {
                    if (this.disposed)
                        this.transport.close();
                }, () => { });
                await opening;
                // Settled while opening: failed (the timeout, disconnect(), a transport drop),
                // or completed by an earlier CONNECT's ACK. Either way, send nothing.
                if (attemptSettled)
                    return;
                if (this.disposed)
                    throw new NotConnectedError("MiniappSession: connect aborted");
                const requestId = makeRequestId();
                const connectPayload = {
                    type: MiniappRequestType.CONNECT,
                    packageName: this.packageName,
                    ...(this.initSessionId !== null ? { initReady: true, sessionId: this.initSessionId } : {}),
                };
                connectSent = true;
                this.transport.send(serializeEnvelope({ payload: connectPayload, requestId }));
            }
            catch (err) {
                // Already reported through readyPromise; a newer attempt may own the session now.
                if (attemptSettled)
                    return;
                const error = err instanceof Error ? err : new Error(String(err));
                if (!this.disposed)
                    this.failAllPending({ code: MiniappErrorCode.NOT_CONNECTED, message: error.message });
                failAttempt(error);
                throw error;
            }
        })();
        // The handshake can fail while the transport is still opening (disconnect(),
        // the timeout): the attempt settles then, without waiting for open().
        return Promise.all([sent, readyPromise]).then(() => undefined);
    }
    /**
     * @internal — called by `registerMiniapp` before `connect()`. The host then
     * keeps the UI closed until {@link reportInitReady}, so UI requests cannot
     * reach the background before its `session.ui.handle` handlers exist.
     */
    announceInitReady(sessionId) {
        this.initSessionId = sessionId;
    }
    /** @internal — the `registerMiniapp` handler settled; let the host open the UI. */
    reportInitReady() {
        if (this.initSessionId === null || this.disposed || !this.hostFeatures?.initReady)
            return;
        this.sendOneShot({ type: MiniappRequestType.READY, sessionId: this.initSessionId });
    }
    /** Resolves when `ready` becomes true, or rejects if connect failed. */
    waitForReady() {
        if (this.ready)
            return Promise.resolve();
        return this.connect();
    }
    isConnected() {
        return this.ready && this.transport.isOpen();
    }
    disconnect() {
        if (this.disposed)
            return;
        this.disposed = true;
        // End a handshake still waiting for CONNECT_ACK. Its timer would otherwise
        // report a timeout for a session that no longer exists.
        this.failHandshake?.(new NotConnectedError("MiniappSession: connect aborted"));
        this.endRetryPause?.();
        // Give listeners one synchronous chance to flush final messages
        // (e.g. display.render([])) before we tear down the transport.
        try {
            this.emitter.emit("beforeDisconnect", "disconnect called");
        }
        catch (err) {
            // A throwing handler must not block teardown.
            console.warn("[MiniappSession] beforeDisconnect handler threw:", err);
        }
        this.failAllPending({ code: MiniappErrorCode.REQUEST_ABORTED, message: "Session disconnected" });
        try {
            this.transport.close();
        }
        catch {
            // ignore
        }
        this.ready = false;
        this.emitter.emit("disconnect", "disconnect called");
    }
    // -------------------------------------------------------------------------
    // Outbound traffic — modules call these
    // -------------------------------------------------------------------------
    /** Send a fire-and-forget request that does not need a response. */
    sendOneShot(payload) {
        const envelope = { payload };
        this.enqueueOrSend(serializeEnvelope(envelope));
    }
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
    sendRequest(payload, opts) {
        if (this.disposed) {
            return Promise.reject(new NotConnectedError());
        }
        const requestId = makeRequestId();
        const envelope = { payload, requestId };
        const timeoutMs = opts?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        return new Promise((resolve, reject) => {
            // Reject (and drop) the request if the host never sends a REQUEST_RESULT,
            // so the promise can't hang forever. The REQUEST_RESULT / failAllPending
            // paths clear this timer before settling. A non-positive timeout opts out
            // (long-running requests rely on the host result / disconnect to settle).
            const timer = timeoutMs > 0
                ? setTimeout(() => {
                    const pending = this.pendingRequests.get(requestId);
                    if (!pending)
                        return;
                    this.pendingRequests.delete(requestId);
                    pending.reject({
                        code: MiniappErrorCode.ACTION_TIMEOUT,
                        message: "Request timed out waiting for a response from the host",
                    });
                }, timeoutMs)
                : undefined;
            this.pendingRequests.set(requestId, {
                requestId,
                resolve: resolve,
                reject,
                timer,
            });
            this.enqueueOrSend(serializeEnvelope(envelope), requestId);
        });
    }
    // -------------------------------------------------------------------------
    // Event emitter — external API
    // -------------------------------------------------------------------------
    on(event, handler) {
        this.emitter.on(event, handler);
        return () => this.emitter.off(event, handler);
    }
    off(event, handler) {
        this.emitter.off(event, handler);
    }
    /**
     * Last-chance hook before the transport closes. Fires either when the
     * phone notifies the session of an imminent disconnect (~50ms grace
     * window before the socket is torn down) or when this session's
     * `disconnect()` is called locally. Use it to flush final cleanup
     * messages — e.g. `display.render([])` — synchronously. Async work
     * started here will not complete before the socket closes.
     */
    onBeforeDisconnect(handler) {
        return this.on("beforeDisconnect", handler);
    }
    onVisibilityChange(handler) {
        return this.on("visibility", handler);
    }
    onCapabilitiesChange(handler) {
        return this.on("capabilities", handler);
    }
    onColorSchemeChange(handler) {
        return this.on("colorScheme", handler);
    }
    // -------------------------------------------------------------------------
    // Internal — transport glue
    // -------------------------------------------------------------------------
    enqueueOrSend(raw, requestId) {
        if (this.ready) {
            try {
                this.transport.send(raw);
            }
            catch (err) {
                // If send fails post-ready, treat as transport error.
                this.emitter.emit("error", err);
            }
            return;
        }
        this.outboundQueue.push(requestId === undefined ? { raw } : { raw, requestId });
    }
    flushQueue() {
        const queue = this.outboundQueue.splice(0);
        for (const { raw, requestId } of queue) {
            // Rejected while waiting for the handshake (a CONNECT_ACK timeout or its own
            // timeout). Its caller has seen the failure, so the host must not run it.
            if (requestId !== undefined && !this.pendingRequests.has(requestId))
                continue;
            try {
                this.transport.send(raw);
            }
            catch (err) {
                this.emitter.emit("error", err);
            }
        }
    }
    handleIncoming(raw) {
        const envelope = parseEnvelope(raw);
        if (!envelope)
            return;
        const payload = envelope.payload;
        const type = payload?.type;
        switch (type) {
            case MiniappResponseType.CONNECT_ACK: {
                // The answer to another CONNECT of this session (a retry, or one whose
                // attempt timed out). Applying it would run the handshake again: emit
                // "ready" twice and replace state that later updates may have changed.
                if (this.handshakeComplete)
                    return;
                const ack = payload;
                this.userId = ack.userId ?? "";
                if (ack.packageName)
                    this.packageName = ack.packageName;
                this.capabilities = ack.capabilities ?? null;
                this.hostFeatures = ack.hostFeatures ?? null;
                if (ack.visibility)
                    this.visibility = ack.visibility;
                if (ack.colorScheme === "light" || ack.colorScheme === "dark") {
                    this.colorScheme = ack.colorScheme;
                }
                if (ack.auth) {
                    this.applyAuth(ack.auth);
                    if (!this.userId)
                        this.userId = ack.auth.mentraUserId;
                }
                this.configurationState = Object.freeze({ ...ack.configuration });
                // Populate the manifest-declared permission cache. Older runtimes
                // that don't send `permissions` leave the all-false default in place
                // — `hasPermission` getters will simply return false.
                if (ack.permissions)
                    this.applyPermissions(ack.permissions);
                this.handshakeComplete = true;
                this.ready = true;
                this.flushQueue();
                this.emitter.emit("ready");
                // Don't resolve request correlation here — CONNECT_ACK has no requestId.
                return;
            }
            case MiniappResponseType.AUTH_UPDATE: {
                const next = payload.auth;
                if (next) {
                    this.applyAuth(next);
                    if (!this.userId)
                        this.userId = next.mentraUserId;
                }
                return;
            }
            case MiniappResponseType.PERMISSIONS_UPDATE: {
                const next = payload.permissions;
                if (next)
                    this.applyPermissions(next);
                return;
            }
            case MiniappResponseType.SPEAKER_STATE: {
                const state = payload.state;
                if (!state)
                    return;
                const event = {
                    state,
                    errorCode: payload.errorCode,
                    errorMessage: payload.errorMessage,
                    durationMs: payload.durationMs,
                };
                this.speaker._applyState(event);
                this.emitter.emit("speakerState", event);
                return;
            }
            case MiniappResponseType.MEETING_STATE: {
                const state = payload.state;
                if (!state)
                    return;
                const identityMode = payload.identityMode === "guest" || payload.identityMode === "teams-user" ? payload.identityMode : undefined;
                const event = {
                    state,
                    identityMode,
                    guestReason: identityMode === "guest"
                        ? payload.guestReason
                        : undefined,
                    muted: Boolean(payload.muted),
                    videoEnabled: typeof payload.videoEnabled === "boolean" ? payload.videoEnabled : undefined,
                    error: payload.error,
                    meetingUrl: payload.meetingUrl,
                    provider: payload.provider,
                    audioSource: payload.audioSource,
                    audioSourceReason: payload.audioSourceReason,
                    activeStream: payload.activeStream,
                    audioSafety: payload.audioSafety,
                    mediaSource: parseMeetingMediaSource(payload.mediaSource),
                    endReason: parseMeetingEndReason(payload.endReason),
                    participants: parseMeetingParticipants(payload.participants),
                    capabilities: parseMeetingCapabilities(payload.capabilities),
                    softap: parseMeetingSoftApProgress(payload.softap),
                    recovery: parseMeetingRecovery(payload.recovery),
                };
                this.meeting._applyState(event);
                this.emitter.emit("meetingState", event);
                return;
            }
            case MiniappResponseType.MEETING_VIDEO_PUBLISHER: {
                const pauseId = typeof payload.pauseId === "string" ? payload.pauseId : "";
                if (!pauseId || payload.status !== "expired")
                    return;
                const event = { pauseId, status: "expired" };
                this.emitter.emit("meetingVideoPublisher", event);
                return;
            }
            case MiniappResponseType.MEETING_STILL: {
                const stillId = typeof payload.stillId === "string" ? payload.stillId : "";
                const phase = payload.phase;
                if (!stillId || (phase !== "card" && phase !== "uploading" && phase !== "shown"))
                    return;
                this.emitter.emit("meetingStill", { stillId, phase });
                return;
            }
            case MiniappResponseType.STREAM_PREVIEW_STATUS: {
                this.stream._applyPreviewStatus(payload);
                return;
            }
            case MiniappRequestType.PING: {
                // Phone → miniapp keepalive ping. Auto-reply with PONG.
                const pong = { type: MiniappResponseType.PONG };
                const env = {
                    payload: pong,
                    ...(envelope.requestId ? { requestId: envelope.requestId } : {}),
                };
                try {
                    this.transport.send(serializeEnvelope(env));
                }
                catch {
                    // Ignore; next ping will fail too and runtime will unregister.
                }
                return;
            }
            case MiniappResponseType.EVENT: {
                const streamType = payload.streamType;
                if (!streamType)
                    return;
                this.events._forwardEvent(streamType, payload.data, payload.transcriptionRoute, payload.listenerId);
                return;
            }
            case MiniappResponseType.ACTION_CALL: {
                // Another miniapp invoked one of our declared actions. Route to the
                // registered handler (or buffer briefly for one to register). The SDK
                // replies with an ACTION_RESULT request keyed by callId.
                const callId = payload.callId;
                const actionId = payload.actionId;
                if (!callId || !actionId)
                    return;
                const params = payload.params ?? {};
                const callerPackageName = payload.callerPackageName ?? "";
                this.actions._deliver(callId, actionId, params, { callerPackageName });
                return;
            }
            case MiniappResponseType.CAPABILITIES_UPDATE: {
                const cap = payload.capabilities ?? null;
                this.capabilities = cap;
                this.emitter.emit("capabilities", cap);
                return;
            }
            case MiniappResponseType.VISIBILITY_CHANGE: {
                const next = payload.visibility;
                if (next === "foreground" || next === "background") {
                    this.visibility = next;
                    this.emitter.emit("visibility", next);
                }
                return;
            }
            case MiniappResponseType.COLOR_SCHEME_CHANGE: {
                const next = payload.colorScheme;
                if (next === "light" || next === "dark") {
                    this.colorScheme = next;
                    this.emitter.emit("colorScheme", next);
                }
                return;
            }
            case MiniappResponseType.REQUEST_RESULT: {
                const requestId = envelope.requestId;
                if (!requestId)
                    return;
                const pending = this.pendingRequests.get(requestId);
                if (!pending)
                    return;
                this.pendingRequests.delete(requestId);
                if (pending.timer)
                    clearTimeout(pending.timer);
                if (payload.ok === false) {
                    const err = payload.error ?? {
                        code: MiniappErrorCode.INTERNAL,
                        message: "Unknown error",
                    };
                    pending.reject(err);
                }
                else {
                    pending.resolve(payload.data ?? null);
                }
                return;
            }
            case MiniappResponseType.WILL_DISCONNECT: {
                const reason = payload.reason ?? "phone unregistering";
                try {
                    this.emitter.emit("beforeDisconnect", reason);
                }
                catch (err) {
                    console.warn("[MiniappSession] beforeDisconnect handler threw:", err);
                }
                return;
            }
            case MiniappResponseType.ERROR: {
                const err = new Error(payload.message ?? "MiniappSession error");
                this.emitter.emit("error", err);
                return;
            }
            default:
                // Unknown type — drop silently. Forward-compat.
                return;
        }
    }
    handleTransportDisconnect(reason) {
        this.ready = false;
        // A transport that drops during the handshake has failed it. Sending CONNECT
        // again over a dead bridge would keep that failure from the host.
        const failure = new Error(`MiniappSession: transport disconnected: ${reason}`);
        this.failHandshake?.(failure);
        this.endRetryPause?.(failure);
        this.failAllPending({ code: MiniappErrorCode.NOT_CONNECTED, message: `Transport disconnected: ${reason}` });
        this.emitter.emit("disconnect", reason);
    }
    failAllPending(error) {
        for (const pending of this.pendingRequests.values()) {
            if (pending.timer)
                clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pendingRequests.clear();
        // Auth waiters live outside pendingRequests — they're resolved by an
        // AUTH_UPDATE push, not a correlated REQUEST_RESULT — so a transport drop,
        // dispose, or CONNECT_ACK timeout must reject them here too. Otherwise an
        // in-flight session.auth.getToken()/fetch() hangs until its 10s waiter
        // timeout instead of failing fast with the disconnect error.
        for (const waiter of Array.from(this.authWaiters)) {
            clearTimeout(waiter.timer);
            this.authWaiters.delete(waiter);
            waiter.reject(new NotConnectedError(error.message));
        }
    }
    authHasTtl(auth, minTtlMs) {
        return auth.expiresAt - Date.now() > minTtlMs;
    }
    requestAuthRefresh(minTtlMs) {
        if (this.authRefreshPromise)
            return this.authRefreshPromise;
        if (!this.ready || !this.transport.isOpen())
            return Promise.resolve(null);
        this.authRefreshPromise = this.sendRequest({
            type: MiniappRequestType.AUTH_REFRESH,
            minTtlMs,
        })
            .then((result) => {
            const auth = result?.auth;
            if (auth)
                this.applyAuth(auth);
            return auth ?? null;
        })
            .catch((err) => {
            console.warn("[MiniappSession] auth refresh failed:", err);
            return null;
        })
            .finally(() => {
            this.authRefreshPromise = null;
        });
        return this.authRefreshPromise;
    }
    applyAuth(next) {
        this.authState = { ...next };
        for (const waiter of Array.from(this.authWaiters)) {
            if (!this.authHasTtl(next, waiter.minTtlMs))
                continue;
            clearTimeout(waiter.timer);
            this.authWaiters.delete(waiter);
            waiter.resolve({ ...next });
        }
        this.emitter.emit("auth", { ...next });
    }
    /**
     * Update the cached permission record. Idempotent: emits "permissions"
     * only when the record actually changed. Sanitizes incoming objects to
     * the v3 PermissionType union.
     */
    applyPermissions(next) {
        let changed = false;
        const updated = { ...this._permissions };
        for (const k of ALL_PERMISSION_TYPES) {
            const v = next[k] === true;
            if (updated[k] !== v) {
                updated[k] = v;
                changed = true;
            }
        }
        if (changed) {
            this._permissions = updated;
            this.emitter.emit("permissions", { ...updated });
        }
    }
}
/**
 * Map a manifest UPPER_CASE permission name to the lowercase canonical key
 * used by `session.permissions`. Returns null for unknown manifest keys.
 *
 * BACKGROUND_LOCATION + POST_NOTIFICATIONS map onto the same canonical keys
 * as their non-suffixed counterparts (location / notifications) since
 * `has()` is "do I have *any* form of this permission declared".
 */
function manifestKeyToCanonical(manifestKey) {
    switch (manifestKey.toUpperCase()) {
        case "MICROPHONE":
            return "microphone";
        case "CAMERA":
            return "camera";
        case "LOCATION":
        case "BACKGROUND_LOCATION":
            return "location";
        case "READ_NOTIFICATIONS":
        case "POST_NOTIFICATIONS":
            return "notifications";
        case "CALENDAR":
            return "calendar";
        default:
            return null;
    }
}
/** @internal — for the permissions module's onUpdate plumbing. */
export function _allPermissionTypes() {
    return ALL_PERMISSION_TYPES;
}
//# sourceMappingURL=session.js.map