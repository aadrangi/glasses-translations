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
import { Transport, TransportDisconnectHandler, TransportMessageHandler } from "./types";
export interface LocalSocketTransportOptions {
    url?: string;
}
export declare class LocalSocketTransport implements Transport {
    private url;
    private ws;
    /**
     * The socket an open() in progress is connecting. A later open() or close()
     * abandons it, so a socket that connects late cannot replace the active one.
     */
    private connecting;
    private messageHandler;
    private disconnectHandler;
    constructor(options?: LocalSocketTransportOptions);
    open(): Promise<void>;
    send(raw: string): void;
    onMessage(handler: TransportMessageHandler): void;
    onDisconnect(handler: TransportDisconnectHandler): void;
    close(): void;
    isOpen(): boolean;
    private abandonConnecting;
}
//# sourceMappingURL=local-socket.d.ts.map