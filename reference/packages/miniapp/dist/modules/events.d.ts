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
import { MiniappSession } from "../session";
import { type SpeechProcessingOptions } from "./speechProcessing";
export type UnsubscribeFn = () => void;
/**
 * @internal Delivery class the host tags a transcription event with. Hosts
 * address each event to the listeners that should get it; SDKs from before
 * `processing` filter on this tag instead: `"forceLocal"` reaches `localOnly`
 * listeners, `"default"` the others, `"all"` everyone.
 */
export type TranscriptionEventRoute = "default" | "forceLocal" | "all";
export interface TranscriptionData {
    text: string;
    isFinal: boolean;
    language?: string;
    /** Where the text was transcribed: `"cloud"`, or `"local"` for the phone's on-device model. */
    source: "cloud" | "local";
}
export interface TranslationData {
    text: string;
    isFinal: boolean;
    sourceLanguage: string;
    targetLanguage: string;
    /** Source-language text of the same utterance, when the provider supplies it. */
    originalText?: string;
    /** Stable id correlating interim + final results of one utterance. */
    utteranceId?: string;
    /** Speaker id when the provider reports diarization. */
    speakerId?: string;
}
export interface ButtonPressData {
    buttonId: string;
    pressType: "short" | "long";
}
export interface HeadPositionData {
    position: "up" | "down";
}
export interface AccelData {
    /** Accelerometer axes in g (gravity-normalized). */
    x: number;
    y: number;
    z: number;
    /** Unix ms timestamp of the reading. */
    timestamp: number;
}
export interface LocationData {
    lat: number;
    lng: number;
    /** Accuracy in meters, if the platform reported it. */
    accuracy?: number;
    /** Unix ms timestamp of the fix. */
    timestamp?: number;
    /** Set when this event is a response to a single-location request. */
    correlationId?: string;
}
export interface HeadingData {
    /** Compass heading in degrees, 0 = north, 90 = east. */
    degrees: number;
}
export interface BatteryData {
    level: number;
    charging: boolean;
}
export interface ConnectionData {
    connected: boolean;
    modelName?: string;
}
/** Glasses Wi-Fi state. `connected` is false on glasses without Wi-Fi or when offline. */
export interface WifiData {
    /** Glasses are on Bluetooth AND on Wi-Fi — what streaming actually needs. */
    connected: boolean;
    /**
     * The phone↔glasses Bluetooth link on its own. When this is false the
     * glasses may well still be on Wi-Fi; `connected` is false only because the
     * phone cannot see them. Wait for the link — do not send the user to
     * Wi-Fi setup. Absent on hosts older than the field.
     */
    linkConnected?: boolean;
    ssid?: string;
    localIp?: string;
}
export interface PhoneNotificationData {
    /** Stable id from the phone's notification listener. */
    notificationId: string;
    /** Human app name (e.g. "Messages"). */
    app: string;
    title: string;
    content: string;
    /** Android priority string; empty on iOS. */
    priority: string;
    timestamp: number;
    /** Reverse-DNS package/bundle id of the originating app. */
    packageName: string;
}
export interface NotificationDismissedData {
    /** Same id as the matching post event from `notifications.on(...)`. */
    notificationId: string;
    /** Android NotificationKey. More stable than notificationId across reposts. */
    notificationKey?: string;
    /** Reverse-DNS package/bundle id of the originating app. */
    packageName?: string;
    /** Unix ms timestamp of the dismissal. */
    timestamp: number;
}
export interface VadData {
    /** True while the user is speaking (voice detected), false when silent. */
    status: boolean;
    /** 0 while speaking; on a silence event, how long the audio has already been silent. */
    silentForMs?: number;
    /** Unix epoch milliseconds of the transition, when the host reports it. */
    timestamp?: number;
}
export interface TouchData {
    /** The gesture: single_tap, double_tap, triple_tap, long_press, swipe_up, or swipe_down. */
    kind: "single_tap" | "double_tap" | "triple_tap" | "long_press" | "swipe_up" | "swipe_down" | string;
}
export interface AudioChunkData {
    /** PCM or LC3, base64-encoded. Format depends on phone's mic mode. */
    data: string;
    sampleRate?: number;
    format?: string;
}
export declare class EventManager {
    private readonly session;
    private readonly listenerScope;
    private listenerSeq;
    private transcriptionListeners;
    private retireListeners;
    private readonly emitter;
    /** Stream -> ref count. Outbound SUBSCRIBE tracks active streams and routing changes. */
    private readonly refCounts;
    constructor(session: MiniappSession);
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
    subscribe(stream: string, handler: (data: unknown) => void, options?: SpeechProcessingOptions): UnsubscribeFn;
    /** Unsubscribe every handler on every stream this EventManager owns. */
    unsubscribeAll(): void;
    /** @internal */
    _forwardEvent(stream: string, data: unknown, transcriptionRoute?: TranscriptionEventRoute, listenerId?: string): void;
    private sendSubscriptionUpdate;
}
//# sourceMappingURL=events.d.ts.map