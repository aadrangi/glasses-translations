/**
 * The reserved `_preview` UI channel, as seen from the page.
 *
 * The Mentra App answers this channel itself; it never reaches the miniapp's background. Requests
 * ride `mentra.request`, and host events arrive on `mentra.on("_preview")`. Every control request
 * carries the page identity (`docGen`, `token`, `mountEpoch`) so the host can drop operations
 * from a document or a component that has since been replaced.
 */
/** `injectFault` is honoured only in debug builds or with the host's hidden developer setting. */
export type PreviewCommand = "handshake" | "configure" | "start" | "stop" | "rendererError" | "injectFault";
export interface PreviewControlRequest {
    cmd: PreviewCommand;
    /** 0 until the first handshake has told the page which document it is. */
    docGen: number;
    token?: string;
    mountEpoch: number;
    /** `configure` only: rendered box in device pixels, after rotation. */
    boxWidth?: number;
    boxHeight?: number;
    /** `rendererError` only. */
    message?: string;
    /** `injectFault` only: `ack_delay`, `ack_drop`, `transport_close`, `pack_throw`, `sink_throw`, `clear`. */
    kind?: string;
    ms?: number;
}
export interface PreviewDocumentConfig {
    t: "config";
    protocolVersion: number;
    transport: "webmessage" | "websocket";
    url?: string;
    portName?: string;
    token: string;
    docGen: number;
}
/** `stale`: the host minted a newer document while this handshake was in flight. */
export type PreviewHandshakeResult = PreviewDocumentConfig | {
    t: "waiting_for_lease";
    docGen: number;
} | {
    t?: undefined;
    stale: true;
};
/** Reply to configure/start/stop. `stale` means the host dropped it; that is not an error. */
export interface PreviewControlReply {
    applied?: boolean;
    stale?: boolean;
}
export type PreviewHostEvent = PreviewDocumentConfig | ({
    t: "status";
} & Record<string, unknown>) | {
    t: "lease_available";
} | {
    t: "lease_ended";
    reason: string;
} | {
    t: "error";
    code: string;
    docGen?: number;
} | {
    t: "paused_background";
} | {
    t: "resumed";
};
/** A `_preview` request the host refused. `code` is a preview error code. */
export declare class PreviewControlError extends Error {
    readonly code: string;
    constructor(code: string, message?: string);
}
export interface PreviewControlChannel {
    request(request: PreviewControlRequest): Promise<unknown>;
    onEvent(cb: (event: PreviewHostEvent) => void): () => void;
}
/** The channel over the injected `window.mentra` bridge. Null outside a Mentra App WebView. */
export declare function createMentraControlChannel(): PreviewControlChannel | null;
//# sourceMappingURL=controlChannel.d.ts.map