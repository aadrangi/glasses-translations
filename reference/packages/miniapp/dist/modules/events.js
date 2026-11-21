/**
 * @fileoverview EventManager — internal subscription registry + escape hatch.
 *
 * Most miniapp authors should NOT touch this directly. Use the typed methods
 * on domain modules instead:
 *   - session.transcription.on(...)
 *   - session.mic.onAudioChunk(...) / onVoiceActivity(...)
 *   - session.input.onButtonPress(...)
 *   - session.imu.onHeadPosition(...)
 *   - session.location.onUpdate(...)
 *   - session.glasses.onBattery(...) / onConnection(...)
 *   - session.phone.notifications.on(...) / session.phone.onBattery(...)
 *
 * This module's only public method is `subscribe(rawStreamType, handler)` —
 * a forward-compat escape hatch for new event types not yet wrapped on a
 * domain module. Officially undocumented; the typed methods on domain
 * modules are the canonical surface.
 *
 * Internally, EventManager owns:
 *   1. The ref-count map deduplicates upstream stream demand. Transcription
 *      updates also carry private listener identities, so the runtime can
 *      preserve a separate content boundary for each handler.
 *   2. Inbound event fan-out via `_forwardEvent(streamType, data)`, called
 *      by MiniappSession.handleIncoming when an EVENT envelope arrives.
 *
 * Domain modules call back into the session via session._subscribe(...) which
 * in turn delegates to this class — the session is the integration point;
 * domain modules don't see this class directly.
 */
import { EventEmitter } from "eventemitter3";
import { makeRequestId } from "../envelope";
import { MiniappRequestType, MiniappStreamType } from "../protocol";
import { resolveSpeechProcessing } from "./speechProcessing";
// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
export class EventManager {
    constructor(session) {
        this.session = session;
        this.listenerScope = makeRequestId();
        this.listenerSeq = 0;
        this.transcriptionListeners = new Map();
        this.retireListeners = new Set();
        this.emitter = new EventEmitter();
        /** Stream -> ref count. Outbound SUBSCRIBE tracks active streams and routing changes. */
        this.refCounts = new Map();
    }
    /**
     * Generic subscribe. `stream` is the raw wire value, including any language
     * suffix like `"transcription:en-US"`. Forward-compat escape hatch for new
     * event types not yet wrapped on a domain module. Most authors should use
     * typed methods on domain modules instead.
     *
     * Stream names beginning with `_` (e.g. `_ui` for the session.ui bus) are
     * INTERNAL — they ride the local _forwardEvent fan-out and never appear in
     * the outbound SUBSCRIBE list. Native already knows to deliver UI envelopes
     * via a separate envelope `type`; the EventManager only routes them
     * locally.
     *
     * `processing` applies to transcription streams only.
     */
    subscribe(stream, handler, options = {}) {
        const isInternal = stream.startsWith("_");
        const isTranscription = stream.startsWith(`${MiniappStreamType.TRANSCRIPTION}:`);
        const processing = isTranscription ? resolveSpeechProcessing(options, "events.subscribe(options)") : "preferCloud";
        const localOnly = processing === "localOnly";
        const listenerId = isTranscription ? `${this.listenerScope}:${++this.listenerSeq}` : undefined;
        let active = true;
        const listener = (data, route) => {
            if (!active)
                return;
            if (isTranscription) {
                // The host tags every transcription event with the class it is for.
                // Hosts that predate routed transcription events omit `route`. Treat
                // those events as the cloud path so a localOnly listener can never
                // accidentally receive cloud text.
                if (localOnly ? route !== "forceLocal" && route !== "all" : route === "forceLocal")
                    return;
            }
            handler(data);
        };
        this.emitter.on(stream, listener);
        const retire = () => {
            active = false;
        };
        this.retireListeners.add(retire);
        if (listenerId)
            this.transcriptionListeners.set(listenerId, { stream, processing, invoke: listener });
        if (!isInternal) {
            const before = this.refCounts.get(stream) ?? 0;
            this.refCounts.set(stream, before + 1);
            // Every transcription listener is registered with the host by id.
            if (isTranscription || before === 0)
                this.sendSubscriptionUpdate();
        }
        return () => {
            if (!active)
                return;
            retire();
            this.retireListeners.delete(retire);
            if (listenerId)
                this.transcriptionListeners.delete(listenerId);
            this.emitter.off(stream, listener);
            if (isInternal)
                return;
            const current = this.refCounts.get(stream) ?? 0;
            if (current <= 1) {
                this.refCounts.delete(stream);
            }
            else {
                this.refCounts.set(stream, current - 1);
            }
            if (isTranscription || current <= 1)
                this.sendSubscriptionUpdate();
        };
    }
    /** Unsubscribe every handler on every stream this EventManager owns. */
    unsubscribeAll() {
        for (const retire of this.retireListeners)
            retire();
        this.retireListeners.clear();
        this.transcriptionListeners.clear();
        this.emitter.removeAllListeners();
        this.refCounts.clear();
        this.sendSubscriptionUpdate();
    }
    // -------------------------------------------------------------------------
    // Internal — called by MiniappSession when EVENT arrives from phone
    // -------------------------------------------------------------------------
    /** @internal */
    _forwardEvent(stream, data, transcriptionRoute, listenerId) {
        if (stream.startsWith(`${MiniappStreamType.TRANSCRIPTION}:`))
            data = withTranscriptionSource(data);
        if (listenerId !== undefined) {
            const listener = this.transcriptionListeners.get(listenerId);
            if (listener && (listener.stream === stream || listener.stream === "transcription:auto"))
                listener.invoke(data, transcriptionRoute);
            return;
        }
        this.emitter.emit(stream, data, transcriptionRoute);
        // Wildcard fan-out: handlers register under wildcard patterns
        // ("transcription:auto", "translation:*:<target>", …) but the host
        // delivers events under the CONCRETE stream key
        // ("transcription:en-US", "translation:en:es"). Re-emit on every
        // pattern the concrete key satisfies — the same pattern set
        // LocalMiniappRuntime.forwardEvent matches on the host side —
        // otherwise a wildcard subscriber never fires.
        if (stream.startsWith("transcription:") && stream !== "transcription:auto") {
            this.emitter.emit("transcription:auto", data, transcriptionRoute);
        }
        else if (stream.startsWith("translation:")) {
            const parts = stream.split(":");
            const patterns = new Set(["translation:auto"]);
            if (parts.length === 3) {
                const [, source, target] = parts;
                patterns.add("translation:*:*");
                patterns.add(`translation:*:${target}`);
                patterns.add(`translation:${source}:*`);
            }
            patterns.delete(stream); // exact key already emitted above
            for (const pattern of patterns) {
                this.emitter.emit(pattern, data);
            }
        }
    }
    sendSubscriptionUpdate() {
        const subscriptions = [];
        for (const stream of this.refCounts.keys()) {
            if (stream === MiniappStreamType.LOCATION_UPDATE)
                subscriptions.push({ stream: "location_stream", rate: "realtime" });
            else if (!stream.startsWith(`${MiniappStreamType.TRANSCRIPTION}:`))
                subscriptions.push(stream);
        }
        // One entry per transcription stream and processing its listeners ask for.
        const transcription = new Set();
        for (const { stream, processing } of this.transcriptionListeners.values()) {
            const key = `${processing} ${stream}`;
            if (transcription.has(key))
                continue;
            transcription.add(key);
            subscriptions.push({ stream, ...processingOnWire(processing) });
        }
        this.session.sendOneShot({
            type: MiniappRequestType.SUBSCRIBE,
            subscriptions,
            transcriptionListeners: [...this.transcriptionListeners].map(([id, { stream, processing }]) => ({
                id,
                stream,
                ...processingOnWire(processing),
            })),
        });
    }
}
/**
 * The wire form of a transcription listener's processing. Hosts before
 * `processing` (Mentra App 3.4.0) read only `forceLocal`, so `localOnly` keeps
 * sending it: there a localOnly listener still never gets cloud text.
 */
function processingOnWire(processing) {
    return processing === "localOnly" ? { processing, forceLocal: true } : { processing };
}
/**
 * Hosts before `source` (Mentra App 3.4.0) leave it out. Their on-device
 * transcripts carry `type: "local_transcription"`, their cloud ones do not.
 */
function withTranscriptionSource(data) {
    if (typeof data !== "object" || data === null)
        return data;
    const event = data;
    if (event.source === "cloud" || event.source === "local")
        return data;
    return { ...event, source: event.type === "local_transcription" ? "local" : "cloud" };
}
//# sourceMappingURL=events.js.map