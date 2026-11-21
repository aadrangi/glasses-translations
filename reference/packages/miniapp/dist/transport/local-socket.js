/**
 * @fileoverview LocalSocket transport — browser fallback.
 *
 * When the miniapp runs in an external browser (Safari/Chrome, not inside the
 * MentraOS React Native WebView), it connects to a localhost WebSocket that
 * MentraOS exposes via MiniSockets.
 *
 * Default endpoint: ws://127.0.0.1:8765. Override via the `url` option for
 * dev / testing.
 */
const DEFAULT_URL = "ws://127.0.0.1:8765";
export class LocalSocketTransport {
    constructor(options = {}) {
        this.ws = null;
        /**
         * The socket an open() in progress is connecting. A later open() or close()
         * abandons it, so a socket that connects late cannot replace the active one.
         */
        this.connecting = null;
        this.messageHandler = null;
        this.disconnectHandler = null;
        this.url = options.url ?? DEFAULT_URL;
    }
    async open() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN)
            return;
        if (typeof WebSocket === "undefined") {
            throw new Error("LocalSocketTransport: browser WebSocket global not available");
        }
        this.abandonConnecting();
        await new Promise((resolve, reject) => {
            const ws = new WebSocket(this.url);
            this.connecting = ws;
            let settled = false;
            const settle = (fn) => {
                if (settled)
                    return;
                settled = true;
                fn();
            };
            ws.onopen = () => {
                if (this.connecting !== ws) {
                    settle(() => reject(new Error("LocalSocketTransport: open was superseded")));
                    return;
                }
                this.connecting = null;
                this.ws = ws;
                settle(() => resolve());
            };
            ws.onerror = (ev) => {
                settle(() => reject(new Error(`LocalSocketTransport: failed to connect to ${this.url}: ${String(ev)}`)));
            };
            ws.onmessage = (ev) => {
                if (this.ws !== ws)
                    return;
                const data = ev.data;
                if (typeof data === "string")
                    this.messageHandler?.(data);
            };
            ws.onclose = (ev) => {
                if (this.connecting === ws)
                    this.connecting = null;
                settle(() => reject(new Error(`LocalSocketTransport: closed before opening: ${ev.code} ${ev.reason}`)));
                // Only the active socket's close is a disconnect; an abandoned one was never in use.
                if (this.ws !== ws)
                    return;
                this.ws = null;
                this.disconnectHandler?.(`closed: ${ev.code} ${ev.reason}`);
            };
        });
    }
    send(raw) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error("LocalSocketTransport: not connected");
        }
        this.ws.send(raw);
    }
    onMessage(handler) {
        this.messageHandler = handler;
    }
    onDisconnect(handler) {
        this.disconnectHandler = handler;
    }
    close() {
        this.abandonConnecting();
        if (!this.ws)
            return;
        try {
            this.ws.close();
        }
        catch {
            // ignore
        }
        this.ws = null;
    }
    isOpen() {
        return !!this.ws && this.ws.readyState === WebSocket.OPEN;
    }
    abandonConnecting() {
        const ws = this.connecting;
        this.connecting = null;
        if (!ws)
            return;
        try {
            ws.close();
        }
        catch {
            // ignore
        }
    }
}
//# sourceMappingURL=local-socket.js.map