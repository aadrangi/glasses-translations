/**
 * The two ways raw frames reach this WebView, behind one interface.
 *
 * iOS has no way to hand a WebView binary without a copy through JavaScriptCore, so it gets a
 * loopback WebSocket. Android has `WebViewCompat.addWebMessageListener`, which delivers an
 * ArrayBuffer to a JS object the native side installs on `window`. Which one is in use is decided
 * by the host's config, never by the page.
 *
 * Reconnection is not here. Every failure is surfaced with its own reason and `PreviewConnection`
 * decides whether to handshake again.
 */
export interface PreviewTransport {
    connect(): Promise<void>;
    onBinary(cb: (buf: ArrayBuffer) => void): void;
    onError(cb: (reason: string) => void): void;
    sendText(json: string): void;
    close(): void;
}
/** Carries the machine-readable reason so a caller does not have to match on message text. */
export declare class PreviewTransportError extends Error {
    readonly reason: string;
    constructor(reason: string);
}
/** The Android-side object installed by `WebViewCompat.addWebMessageListener`. */
export interface PreviewWebMessagePort {
    postMessage(message: string): void;
    addEventListener(type: "message", handler: (event: {
        data: unknown;
    }) => void): void;
    removeEventListener?(type: "message", handler: (event: {
        data: unknown;
    }) => void): void;
}
/** Used when an older host config omits `portName`. */
export declare const DEFAULT_PREVIEW_PORT_NAME = "MentraFramePreviewPort";
/** `{t:"ack",gen,seq}` — the one message the consumer sends per frame. */
export declare function ackMessage(gen: number, seq: number): string;
/** iOS: a loopback WebSocket from the native host. */
export declare class WebSocketTransport implements PreviewTransport {
    private readonly url;
    private readonly token;
    private socket;
    private binaryHandler;
    private errorHandler;
    private opened;
    private closed;
    constructor(url: string, token: string);
    connect(): Promise<void>;
    onBinary(cb: (buf: ArrayBuffer) => void): void;
    onError(cb: (reason: string) => void): void;
    sendText(json: string): void;
    close(): void;
    private fail;
}
/** Android: the JS object native installs with `WebViewCompat.addWebMessageListener`. */
export declare class WebMessagePortTransport implements PreviewTransport {
    private readonly token;
    private readonly portName;
    private port;
    private binaryHandler;
    private errorHandler;
    private closed;
    private readonly listener;
    constructor(token: string, portName?: string);
    connect(): Promise<void>;
    onBinary(cb: (buf: ArrayBuffer) => void): void;
    onError(cb: (reason: string) => void): void;
    sendText(json: string): void;
    close(): void;
    private report;
}
export interface PreviewTransportOptions {
    url?: string;
    portName?: string;
    token: string;
}
/** Build the transport the host asked for. The page never picks on its own. */
export declare function createPreviewTransport(transport: "websocket" | "webmessage", options: PreviewTransportOptions): PreviewTransport;
//# sourceMappingURL=transport.d.ts.map