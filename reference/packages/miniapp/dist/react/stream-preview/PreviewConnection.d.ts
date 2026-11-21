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
import type { PreviewControlChannel } from "./controlChannel";
import { type CreditLoopStats } from "./creditLoop";
import type { ParsedFrame } from "./protocol";
import { type PreviewTier } from "./tiers";
import { type PreviewTransport, type PreviewTransportOptions } from "./transport";
/** The only control protocol this SDK speaks. Anything else is reported as `unsupported`. */
export declare const PREVIEW_PROTOCOL_VERSION = 1;
export type PreviewConnectionState = 
/** No handshake attempted yet in this document, or the lease ended and nobody wants frames. */
"idle" | "handshaking"
/** The host has no lease for this miniapp yet. Not an error: `lease_available` will follow. */
 | "waiting_for_lease" | "connecting" | "open"
/** A failure that a re-handshake may fix (transport lost, ack timeout, host refused). */
 | "error"
/** Terminal for this document: unknown protocol version or missing platform support. */
 | "unsupported"
/** Not running inside a Mentra App WebView. */
 | "unavailable" | "closed";
export interface PreviewConnectionStateDetail {
    code?: string;
    reason?: string;
    paused?: boolean;
}
/** What a mounted `<StreamPreview>` gives the connection. */
export interface PreviewSink {
    readonly mountEpoch: number;
    /** Submit one frame; null when the renderer has no usable context. */
    draw(frame: ParsedFrame): number | null;
    onState(state: PreviewConnectionState, detail: PreviewConnectionStateDetail): void;
    onStatus(status: Record<string, unknown>): void;
    onError(code: string): void;
}
export interface PreviewDesiredState {
    /** Rendered box in device pixels; only sent when `tier` changes. */
    boxWidth: number;
    boxHeight: number;
    /** Null means hidden (zero-size box). */
    tier: PreviewTier | null;
    /** False while the page is hidden (`visibilitychange`) or the component is unmounting. */
    running: boolean;
}
export interface PreviewConnectionCounters {
    handshakes: number;
    reconnects: number;
    staleReplies: number;
    staleLocalOps: number;
    tierChanges: number;
    page: CreditLoopStats;
}
export interface PreviewConnectionDeps {
    channel: PreviewControlChannel | null;
    createTransport?: (transport: "websocket" | "webmessage", options: PreviewTransportOptions) => PreviewTransport;
    now?: () => number;
    /** Document event hookup; defaults to the real `document`/`window`. */
    listen?: (target: "document" | "window", type: string, handler: () => void) => () => void;
    isDocumentVisible?: () => boolean;
    /** Delay helper. Returns a cancel function. Defaults to `setTimeout`. */
    after?: (ms: number, fn: () => void) => () => void;
    /** Reloads this document once, for a port the host added after it loaded. Defaults to the page's own. */
    documentReload?: PreviewDocumentReload;
}
/**
 * Android's WebMessage port exists only in documents created after the host added it. A document
 * that loaded before has none, and only a new document gets one.
 */
export interface PreviewDocumentReload {
    /** Reload now, unless this page already reloaded for the port without opening since. False when it did not. */
    request(): boolean;
    /** The transport opened: a later document missing its port may reload again. */
    clear(): void;
}
export declare class PreviewConnection {
    private readonly deps;
    private state;
    private detail;
    private docGen;
    private config;
    private transport;
    /** Bumped whenever the transport is dropped, so a stale async continuation can tell. */
    private connectionGen;
    private mountEpochCounter;
    private latestEpoch;
    private sink;
    private desired;
    private applied;
    /** Epoch whose production the host halted on a non-recoverable error; not restarted until remount. */
    private haltedEpoch;
    private handshaking;
    private opChain;
    private reconnectTimes;
    private reconnectCooldown;
    private paused;
    private readonly creditLoop;
    private readonly createTransport;
    private readonly now;
    private readonly isVisible;
    private readonly after;
    private readonly documentReload;
    private readonly unsubscribers;
    private counters;
    constructor(deps: PreviewConnectionDeps);
    get currentState(): PreviewConnectionState;
    get documentGeneration(): number;
    snapshot(): PreviewConnectionCounters;
    /** A fresh, strictly increasing epoch for a component mounting in this document. */
    nextMountEpoch(): number;
    /**
     * Route frames to this component's renderer. The newest mount wins; an older sink detaching
     * later cannot remove a newer one.
     */
    attach(sink: PreviewSink): () => void;
    /** Declare what `mountEpoch` wants. Operations from a superseded epoch are ignored. */
    update(mountEpoch: number, state: PreviewDesiredState): void;
    reportRendererError(mountEpoch: number, message: string): void;
    /** End of document. The lease is untouched; a new document will handshake again. */
    close(reason: string): void;
    /** Test seam: detach from the channel and document. */
    dispose(): void;
    private sync;
    private wantsFrames;
    private syncOnce;
    /** False when the host dropped the op as stale; our identity is then out of date. */
    private accept;
    private send;
    private ensureOpen;
    private handshake;
    private openTransport;
    private handleTransportError;
    private handleHostEvent;
    private handleHostError;
    private handleVisibility;
    private scheduleReconnect;
    /** After a burst of failures, try once more instead of leaving the preview on the uplink card. */
    private armReconnectCooldown;
    private clearReconnectCooldown;
    private dropTransport;
    private setState;
}
/** The connection for this document, created on first use. */
export declare function getPreviewConnection(): PreviewConnection;
/** Test seam: replace (or clear) the document singleton, as a reload would. */
export declare function setPreviewConnectionForTests(next: PreviewConnection | null): void;
//# sourceMappingURL=PreviewConnection.d.ts.map