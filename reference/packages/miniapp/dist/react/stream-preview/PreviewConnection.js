/**
 * The preview connection for this document.
 *
 * Three owners with three lifetimes meet here:
 *   - The **lease** belongs to the miniapp's background (`session.stream.preview()`). The page
 *     never creates or releases it; it only hears `lease_available` / `lease_ended`.
 *   - The **connection** belongs to this document: the host config (token, docGen), the frame
 *     transport and the credit loop. It is a module-scoped singleton so it survives
 *     `<StreamPreview>` unmounting and remounting; a remount sends `start` without a handshake.
 *     It ends with the document (reload, navigation, `pagehide`) or when the lease ends.
 *   - The **renderer** belongs to the component and is attached here only as a draw callback.
 *
 * Control is desired-state: the component says which mount epoch wants which tier and whether it
 * wants frames, and `sync()` sends the difference to the host over `_preview`. A new document
 * always needs a new handshake; a new mount never does.
 */
import { createMentraControlChannel, PreviewControlError } from "./controlChannel";
import { CreditLoop } from "./creditLoop";
import { sameTier } from "./tiers";
import { previewTrace, previewTraceWarn, previewTraceWarnLimited } from "./trace";
import { ackMessage, createPreviewTransport } from "./transport";
/** The only control protocol this SDK speaks. Anything else is reported as `unsupported`. */
export const PREVIEW_PROTOCOL_VERSION = 1;
/**
 * Immediate re-handshakes after a transport failure, per window. A burst past this waits
 * {@link RECONNECT_COOLDOWN_MS} and tries again, so a stuck ack cannot hide the preview for the
 * rest of the call.
 */
const RECONNECT_BUDGET = 3;
const RECONNECT_WINDOW_MS = 60000;
const RECONNECT_COOLDOWN_MS = 3000;
/** Immediate re-handshakes after the host answers a handshake as stale. */
const STALE_HANDSHAKE_RETRIES = 2;
const PORT_RELOAD_KEY = "mentra.preview.portReload";
const defaultDocumentReload = {
    request() {
        try {
            if (typeof window === "undefined" || window.sessionStorage.getItem(PORT_RELOAD_KEY))
                return false;
            window.sessionStorage.setItem(PORT_RELOAD_KEY, "1");
            window.location.reload();
            return true;
        }
        catch {
            return false;
        }
    },
    clear() {
        try {
            if (typeof window !== "undefined")
                window.sessionStorage.removeItem(PORT_RELOAD_KEY);
        }
        catch {
            // Storage unavailable: nothing was marked either.
        }
    },
};
function defaultListen(target, type, handler) {
    const node = target === "document"
        ? typeof document === "undefined"
            ? null
            : document
        : typeof window === "undefined"
            ? null
            : window;
    if (!node)
        return () => { };
    node.addEventListener(type, handler);
    return () => node.removeEventListener(type, handler);
}
function defaultIsVisible() {
    return typeof document === "undefined" || document.visibilityState !== "hidden";
}
function defaultAfter(ms, fn) {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
}
const NOTHING_APPLIED = { epoch: -1, tier: null, running: false };
export class PreviewConnection {
    constructor(deps) {
        this.deps = deps;
        this.detail = {};
        this.docGen = 0;
        this.config = null;
        this.transport = null;
        /** Bumped whenever the transport is dropped, so a stale async continuation can tell. */
        this.connectionGen = 0;
        this.mountEpochCounter = 0;
        this.latestEpoch = 0;
        this.sink = null;
        this.desired = null;
        this.applied = NOTHING_APPLIED;
        /** Epoch whose production the host halted on a non-recoverable error; not restarted until remount. */
        this.haltedEpoch = -1;
        this.handshaking = null;
        this.opChain = Promise.resolve();
        this.reconnectTimes = [];
        this.reconnectCooldown = null;
        this.paused = false;
        this.unsubscribers = [];
        this.counters = { handshakes: 0, reconnects: 0, staleReplies: 0, staleLocalOps: 0, tierChanges: 0 };
        this.createTransport = deps.createTransport ?? createPreviewTransport;
        this.now = deps.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
        this.isVisible = deps.isDocumentVisible ?? defaultIsVisible;
        this.after = deps.after ?? defaultAfter;
        this.documentReload = deps.documentReload ?? defaultDocumentReload;
        this.state = deps.channel ? "idle" : "unavailable";
        this.creditLoop = new CreditLoop({
            sendAck: (gen, seq) => this.transport?.sendText(ackMessage(gen, seq)),
            onParseError: (reason) => previewTraceWarnLimited(`parse:${reason}`, "parse_reject", { reason, docGen: this.docGen }),
        });
        if (deps.channel) {
            this.unsubscribers.push(deps.channel.onEvent((event) => this.handleHostEvent(event)));
            const listen = deps.listen ?? defaultListen;
            this.unsubscribers.push(listen("window", "pagehide", () => this.close("pagehide")));
            // A page restored from the back/forward cache is the same document with a dead transport.
            this.unsubscribers.push(listen("window", "pageshow", () => {
                if (this.state !== "closed")
                    return;
                this.setState("idle", { reason: "pageshow" });
                this.sync();
            }));
            this.unsubscribers.push(listen("document", "visibilitychange", () => this.handleVisibility()));
        }
    }
    get currentState() {
        return this.state;
    }
    get documentGeneration() {
        return this.docGen;
    }
    snapshot() {
        return { ...this.counters, page: this.creditLoop.snapshot() };
    }
    /** A fresh, strictly increasing epoch for a component mounting in this document. */
    nextMountEpoch() {
        this.mountEpochCounter += 1;
        return this.mountEpochCounter;
    }
    /**
     * Route frames to this component's renderer. The newest mount wins; an older sink detaching
     * later cannot remove a newer one.
     */
    attach(sink) {
        if (sink.mountEpoch < this.latestEpoch) {
            this.counters.staleLocalOps += 1;
            return () => { };
        }
        this.latestEpoch = sink.mountEpoch;
        this.sink = sink;
        this.creditLoop.setDraw((frame) => sink.draw(frame));
        sink.onState(this.state, { ...this.detail, paused: this.paused });
        return () => {
            if (this.sink !== sink)
                return;
            this.sink = null;
            this.creditLoop.setDraw(null);
        };
    }
    /** Declare what `mountEpoch` wants. Operations from a superseded epoch are ignored. */
    update(mountEpoch, state) {
        if (mountEpoch < this.latestEpoch) {
            this.counters.staleLocalOps += 1;
            previewTrace("stale_local_op", { mountEpoch, latestEpoch: this.latestEpoch });
            return;
        }
        this.latestEpoch = mountEpoch;
        this.desired = { epoch: mountEpoch, state };
        this.sync();
    }
    reportRendererError(mountEpoch, message) {
        this.creditLoop.recordError(message);
        if (this.state !== "open" || !this.config)
            return;
        void this.send({ cmd: "rendererError", mountEpoch, message }).catch(() => undefined);
    }
    /** End of document. The lease is untouched; a new document will handshake again. */
    close(reason) {
        if (this.state === "closed")
            return;
        previewTrace("connection_closed", { reason, docGen: this.docGen });
        this.clearReconnectCooldown();
        this.dropTransport();
        this.setState("closed", { reason });
    }
    /** Test seam: detach from the channel and document. */
    dispose() {
        for (const unsubscribe of this.unsubscribers.splice(0))
            unsubscribe();
        this.clearReconnectCooldown();
        this.dropTransport();
    }
    // ---------------------------------------------------------------------------
    sync() {
        this.opChain = this.opChain
            .then(() => this.syncOnce())
            .catch((error) => {
            previewTraceWarn("sync_failed", { error: error instanceof Error ? error.message : String(error) });
        });
    }
    wantsFrames() {
        const desired = this.desired;
        return !!desired && desired.state.running && desired.state.tier !== null && desired.epoch !== this.haltedEpoch;
    }
    async syncOnce() {
        const desired = this.desired;
        if (!desired)
            return;
        if (this.state !== "open") {
            // Hidden components never force a handshake; the next visible one will.
            if (!this.wantsFrames())
                return;
            if (!(await this.ensureOpen()))
                return;
        }
        const gen = this.connectionGen;
        const { epoch, state } = desired;
        if (state.tier && !sameTier(state.tier, this.applied.tier)) {
            const reply = await this.send({
                cmd: "configure",
                mountEpoch: epoch,
                boxWidth: state.boxWidth,
                boxHeight: state.boxHeight,
            });
            if (gen !== this.connectionGen || !this.accept(reply, "configure"))
                return;
            this.counters.tierChanges += 1;
            previewTrace("tier_sent", {
                mountEpoch: epoch,
                width: state.tier.width,
                height: state.tier.height,
                docGen: this.docGen,
            });
            this.applied = { ...this.applied, tier: state.tier };
        }
        const running = this.wantsFrames();
        if (running !== this.applied.running || (running && epoch !== this.applied.epoch)) {
            const reply = await this.send({ cmd: running ? "start" : "stop", mountEpoch: epoch });
            if (gen !== this.connectionGen || !this.accept(reply, running ? "start" : "stop"))
                return;
            this.applied = { ...this.applied, epoch, running };
        }
    }
    /** False when the host dropped the op as stale; our identity is then out of date. */
    accept(reply, cmd) {
        if (!reply)
            return false;
        if (!reply.stale)
            return true;
        this.counters.staleReplies += 1;
        previewTraceWarn("control_stale", { cmd, docGen: this.docGen });
        // The host no longer recognises this document's credential: start over with a handshake.
        this.dropTransport();
        this.setState("idle", { reason: "stale_identity" });
        this.scheduleReconnect("stale_identity");
        return false;
    }
    async send(request) {
        const channel = this.deps.channel;
        if (!channel)
            return null;
        try {
            const reply = await channel.request({ ...request, docGen: this.docGen, token: this.config?.token });
            return (reply ?? {});
        }
        catch (error) {
            const code = error instanceof PreviewControlError ? error.code : "transport_failed";
            previewTraceWarn("control_failed", { cmd: request.cmd, code, docGen: this.docGen });
            this.sink?.onError(code);
            return null;
        }
    }
    ensureOpen() {
        if (this.state === "open")
            return Promise.resolve(true);
        if (this.state === "unsupported" || this.state === "unavailable" || this.state === "closed") {
            return Promise.resolve(false);
        }
        if (!this.handshaking) {
            this.handshaking = this.handshake().finally(() => {
                this.handshaking = null;
            });
        }
        return this.handshaking;
    }
    async handshake(staleRetries = STALE_HANDSHAKE_RETRIES) {
        const channel = this.deps.channel;
        if (!channel)
            return false;
        const gen = this.connectionGen;
        const mountEpoch = this.desired?.epoch ?? 0;
        this.setState("handshaking");
        previewTrace("handshake_attempt", { docGen: this.docGen, mountEpoch });
        let result;
        try {
            result = (await channel.request({ cmd: "handshake", docGen: this.docGen, mountEpoch }));
        }
        catch (error) {
            const code = error instanceof PreviewControlError ? error.code : "transport_failed";
            const message = error instanceof Error ? error.message.slice(0, 120) : undefined;
            previewTraceWarn("handshake_failed", { code, message, docGen: this.docGen });
            // A bind that is not ready yet is reported as unsupported. That used to
            // stick for the whole document. Treat it like a transport error and try again.
            this.setState("error", { code });
            this.sink?.onError(code);
            if (this.isVisible() && this.wantsFrames())
                this.scheduleReconnect(code);
            return false;
        }
        if (gen !== this.connectionGen)
            return false;
        if (!result || typeof result !== "object") {
            this.setState("error", { code: "transport_failed" });
            return false;
        }
        if ("stale" in result) {
            // The docGen this page claimed (or the one minted for it mid-handshake) was superseded,
            // e.g. by the `ready` that follows `handshake_without_ready`. Ask again as a page that does
            // not know its document yet; the host answers with its current one.
            this.counters.staleReplies += 1;
            previewTraceWarn("handshake_stale", { docGen: this.docGen, staleRetries });
            this.docGen = 0;
            if (staleRetries > 0)
                return this.handshake(staleRetries - 1);
            this.setState("error", { reason: "stale_identity" });
            return false;
        }
        if (result.t === "waiting_for_lease") {
            if (typeof result.docGen === "number")
                this.docGen = result.docGen;
            previewTrace("waiting_for_lease", { docGen: this.docGen });
            this.setState("waiting_for_lease");
            return false;
        }
        return this.openTransport(result);
    }
    async openTransport(config) {
        if (config.protocolVersion !== PREVIEW_PROTOCOL_VERSION) {
            previewTraceWarn("handshake_rejected", { reason: "unsupported_version", protocolVersion: config.protocolVersion });
            this.setState("unsupported", { code: "unsupported" });
            this.sink?.onError("unsupported");
            return false;
        }
        this.docGen = config.docGen;
        this.config = config;
        this.counters.handshakes += 1;
        this.setState("connecting");
        const gen = ++this.connectionGen;
        let transport = null;
        try {
            transport = this.createTransport(config.transport, {
                url: config.url,
                portName: config.portName,
                token: config.token,
            });
            transport.onBinary((buffer) => this.creditLoop.handleBinary(buffer));
            transport.onError((reason) => this.handleTransportError(gen, reason));
            await transport.connect();
        }
        catch (error) {
            const reason = error.reason ?? "connect_failed";
            previewTraceWarn("transport_failed", { reason, docGen: this.docGen, transport: config.transport });
            // A connect can fail after the transport attached to the port: a retry must not leave it listening.
            transport?.close();
            if (gen === this.connectionGen) {
                this.config = null;
                this.setState("error", { code: "transport_failed", reason });
                this.sink?.onError("transport_failed");
                if (reason === "port_missing" && this.documentReload.request()) {
                    previewTraceWarn("port_reload", { docGen: this.docGen });
                    return false;
                }
                // Retried like a transport lost later, within the same budget and cooldown. After this
                // handshake has settled: a sync from inside it would only rejoin it.
                this.after(0, () => {
                    if (gen === this.connectionGen && this.state === "error" && this.isVisible() && this.wantsFrames()) {
                        this.scheduleReconnect(reason);
                    }
                });
            }
            return false;
        }
        if (gen !== this.connectionGen) {
            transport.close();
            return false;
        }
        this.transport = transport;
        this.applied = NOTHING_APPLIED;
        this.documentReload.clear();
        previewTrace("handshake_ok", {
            docGen: this.docGen,
            transport: config.transport,
            handshakes: this.counters.handshakes,
        });
        this.setState("open");
        return true;
    }
    handleTransportError(gen, reason) {
        if (gen !== this.connectionGen)
            return;
        previewTraceWarn("transport_closed", { reason, docGen: this.docGen });
        this.dropTransport();
        this.setState("error", { code: "transport_failed", reason });
        this.sink?.onError("transport_failed");
        // A socket the OS tore down while suspended is re-established on foreground instead.
        if (this.isVisible())
            this.scheduleReconnect(reason);
    }
    handleHostEvent(event) {
        switch (event.t) {
            case "lease_available":
                previewTrace("lease_available", { docGen: this.docGen, state: this.state });
                if (this.state === "waiting_for_lease" ||
                    this.state === "idle" ||
                    this.state === "error" ||
                    this.state === "unsupported") {
                    this.setState("idle");
                    // Hidden stays connected-but-stopped, so handshake as soon as anyone has mounted.
                    if (this.desired)
                        void this.ensureOpen().then((open) => open && this.sync());
                }
                return;
            case "lease_ended":
                previewTrace("lease_ended", { reason: event.reason, docGen: this.docGen });
                this.dropTransport();
                this.setState("waiting_for_lease", { reason: event.reason });
                if (event.reason === "source_ended")
                    this.sink?.onError("source_ended");
                return;
            case "error":
                if (typeof event.docGen === "number" && event.docGen !== this.docGen)
                    return;
                this.handleHostError(event.code);
                return;
            case "status":
                this.sink?.onStatus({ ...event, page: this.snapshot() });
                return;
            case "paused_background":
                this.paused = true;
                this.sink?.onState(this.state, { ...this.detail, paused: true });
                return;
            case "resumed":
                this.paused = false;
                this.sink?.onState(this.state, { ...this.detail, paused: false });
                return;
            case "config":
                if (event.docGen === this.docGen && this.state !== "open" && this.state !== "connecting") {
                    void this.openTransport(event).then((open) => open && this.sync());
                }
                return;
        }
    }
    handleHostError(code) {
        previewTraceWarn("host_error", { code, docGen: this.docGen });
        this.sink?.onError(code);
        if (code === "transport_failed" || code === "ack_timeout") {
            this.dropTransport();
            this.setState("error", { code });
            this.scheduleReconnect(code);
            return;
        }
        // The host halted production (pack_failed, diagnostics_disabled, ...). Restarting would only
        // hit the same failure; a new mount epoch may try again.
        this.applied = { ...this.applied, running: false };
        this.haltedEpoch = this.desired?.epoch ?? this.haltedEpoch;
    }
    handleVisibility() {
        const visible = this.isVisible();
        previewTrace("visibility", { visible, state: this.state, docGen: this.docGen });
        if (visible && (this.state === "error" || this.state === "idle"))
            this.sync();
    }
    scheduleReconnect(reason) {
        const at = this.now();
        this.reconnectTimes = this.reconnectTimes.filter((t) => at - t < RECONNECT_WINDOW_MS);
        if (this.reconnectTimes.length >= RECONNECT_BUDGET) {
            previewTraceWarn("reconnect_budget_exhausted", { reason, docGen: this.docGen });
            this.armReconnectCooldown(reason);
            return;
        }
        this.clearReconnectCooldown();
        this.reconnectTimes.push(at);
        this.counters.reconnects += 1;
        previewTrace("reconnect", { reason, docGen: this.docGen, reconnects: this.counters.reconnects });
        this.sync();
    }
    /** After a burst of failures, try once more instead of leaving the preview on the uplink card. */
    armReconnectCooldown(reason) {
        if (this.reconnectCooldown)
            return;
        this.reconnectCooldown = this.after(RECONNECT_COOLDOWN_MS, () => {
            this.reconnectCooldown = null;
            if (this.state !== "error" || !this.isVisible() || !this.wantsFrames())
                return;
            this.reconnectTimes = [];
            this.scheduleReconnect(reason);
        });
    }
    clearReconnectCooldown() {
        this.reconnectCooldown?.();
        this.reconnectCooldown = null;
    }
    dropTransport() {
        this.connectionGen += 1;
        const transport = this.transport;
        this.transport = null;
        this.config = null;
        this.applied = NOTHING_APPLIED;
        if (transport) {
            transport.close();
            previewTrace("transport_close", { docGen: this.docGen });
        }
    }
    setState(state, detail = {}) {
        this.state = state;
        this.detail = detail;
        this.sink?.onState(state, { ...detail, paused: this.paused });
    }
}
let shared = null;
/** The connection for this document, created on first use. */
export function getPreviewConnection() {
    if (!shared)
        shared = new PreviewConnection({ channel: createMentraControlChannel() });
    return shared;
}
/** Test seam: replace (or clear) the document singleton, as a reload would. */
export function setPreviewConnectionForTests(next) {
    shared?.dispose();
    shared = next;
}
//# sourceMappingURL=PreviewConnection.js.map