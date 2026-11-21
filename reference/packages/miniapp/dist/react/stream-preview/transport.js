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
import { previewTrace, previewTraceWarn } from "./trace";
/** Carries the machine-readable reason so a caller does not have to match on message text. */
export class PreviewTransportError extends Error {
    constructor(reason) {
        super(reason);
        this.name = "PreviewTransportError";
        this.reason = reason;
    }
}
/** Used when an older host config omits `portName`. */
export const DEFAULT_PREVIEW_PORT_NAME = "MentraFramePreviewPort";
/** `{t:"ack",gen,seq}` — the one message the consumer sends per frame. */
export function ackMessage(gen, seq) {
    return JSON.stringify({ t: "ack", gen, seq });
}
function helloMessage(token) {
    return JSON.stringify({ t: "hello", token });
}
/** iOS: a loopback WebSocket from the native host. */
export class WebSocketTransport {
    constructor(url, token) {
        this.url = url;
        this.token = token;
        this.socket = null;
        this.binaryHandler = null;
        this.errorHandler = null;
        this.opened = false;
        this.closed = false;
    }
    connect() {
        return new Promise((resolve, reject) => {
            let socket;
            try {
                socket = new WebSocket(this.url);
            }
            catch (error) {
                previewTraceWarn("transport_error", {
                    transport: "websocket",
                    reason: "websocket_unavailable",
                    error: error instanceof Error ? error.message : String(error),
                });
                reject(new PreviewTransportError("websocket_unavailable"));
                return;
            }
            socket.binaryType = "arraybuffer";
            this.socket = socket;
            socket.onopen = () => {
                this.opened = true;
                try {
                    // `connect()` must not resolve before the host knows who we are, or the first frames
                    // would race the hello and be dropped by the sender as unauthenticated.
                    socket.send(helloMessage(this.token));
                }
                catch {
                    this.fail("hello_send_failed");
                    reject(new PreviewTransportError("hello_send_failed"));
                    return;
                }
                previewTrace("transport_open", { transport: "websocket" });
                resolve();
            };
            socket.onmessage = (event) => {
                // Text frames are not this channel: control lives on the `_preview` UI channel.
                if (event.data instanceof ArrayBuffer)
                    this.binaryHandler?.(event.data);
            };
            socket.onerror = () => {
                const reason = this.opened ? "websocket_error" : "websocket_connect_error";
                this.fail(reason);
                if (!this.opened)
                    reject(new PreviewTransportError(reason));
            };
            socket.onclose = (event) => {
                const reason = this.opened ? `websocket_closed:${event.code}` : `websocket_closed_before_open:${event.code}`;
                this.fail(reason);
                if (!this.opened)
                    reject(new PreviewTransportError(reason));
            };
        });
    }
    onBinary(cb) {
        this.binaryHandler = cb;
    }
    onError(cb) {
        this.errorHandler = cb;
    }
    sendText(json) {
        const socket = this.socket;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            this.fail("send_while_closed");
            return;
        }
        try {
            socket.send(json);
        }
        catch {
            this.fail("send_failed");
        }
    }
    close() {
        this.closed = true;
        const socket = this.socket;
        this.socket = null;
        if (!socket)
            return;
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        try {
            socket.close();
        }
        catch {
            // A socket that never opened throws here on some engines; the transport is gone either way.
        }
    }
    fail(reason) {
        // A close the caller asked for is not a failure.
        if (this.closed)
            return;
        this.errorHandler?.(reason);
    }
}
/** Android: the JS object native installs with `WebViewCompat.addWebMessageListener`. */
export class WebMessagePortTransport {
    constructor(token, portName = DEFAULT_PREVIEW_PORT_NAME) {
        this.token = token;
        this.portName = portName;
        this.port = null;
        this.binaryHandler = null;
        this.errorHandler = null;
        this.closed = false;
        this.listener = (event) => {
            if (event.data instanceof ArrayBuffer) {
                this.binaryHandler?.(event.data);
                return;
            }
            if (typeof event.data !== "string")
                this.report("port_unexpected_payload");
        };
    }
    connect() {
        const port = typeof window === "undefined"
            ? undefined
            : window[this.portName];
        if (!port)
            return Promise.reject(new PreviewTransportError("port_missing"));
        this.port = port;
        port.addEventListener("message", this.listener);
        try {
            port.postMessage(helloMessage(this.token));
        }
        catch {
            port.removeEventListener?.("message", this.listener);
            this.port = null;
            return Promise.reject(new PreviewTransportError("hello_send_failed"));
        }
        previewTrace("transport_open", { transport: "webmessage" });
        return Promise.resolve();
    }
    onBinary(cb) {
        this.binaryHandler = cb;
    }
    onError(cb) {
        this.errorHandler = cb;
    }
    sendText(json) {
        const port = this.port;
        if (!port) {
            this.report("send_while_closed");
            return;
        }
        try {
            port.postMessage(json);
        }
        catch {
            this.report("send_failed");
        }
    }
    close() {
        this.closed = true;
        this.port?.removeEventListener?.("message", this.listener);
        this.port = null;
    }
    report(reason) {
        if (this.closed)
            return;
        this.errorHandler?.(reason);
    }
}
/** Build the transport the host asked for. The page never picks on its own. */
export function createPreviewTransport(transport, options) {
    if (transport === "websocket") {
        if (!options.url)
            throw new PreviewTransportError("missing_url");
        return new WebSocketTransport(options.url, options.token);
    }
    return new WebMessagePortTransport(options.token, options.portName);
}
//# sourceMappingURL=transport.js.map