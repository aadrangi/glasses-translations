/**
 * @fileoverview SystemModule — OS-level utilities (share, open URL, clipboard, download, QR scan).
 *
 * These bridge to native phone capabilities via LocalMiniappRuntime.
 */
import { MiniappSession } from "../session";
export interface ShareOptions {
    text?: string;
    /**
     * An http(s) link, or the `file://` uri of one of this miniapp's blobs
     * (`session.blob`). The host refuses any other file or scheme.
     */
    url?: string;
    title?: string;
    /** Base64-encoded file data for file sharing. */
    base64?: string;
    /** MIME type when sharing base64 data. */
    mimeType?: string;
    /** File name when sharing base64 data: one name; path separators become `_`. */
    filename?: string;
}
export interface ShareResult {
    success: boolean;
    cancelled?: boolean;
}
export interface DownloadOptions {
    /** An http: or https: URL to download from, OR base64 data. */
    url?: string;
    base64?: string;
    /** One file name; path separators become `_`. */
    filename?: string;
    mimeType?: string;
}
export interface DownloadResult {
    success: boolean;
    cancelled?: boolean;
}
export interface ScanQrOptions {
    /** Header title on the phone scanner overlay. */
    title?: string;
    /** Hint shown over the camera viewfinder. */
    hint?: string;
}
export type ScanQrResult = {
    data: string;
    cancelled?: false;
} | {
    cancelled: true;
    data?: undefined;
};
export declare class SystemModule {
    private readonly session;
    constructor(session: MiniappSession);
    /** Open the OS share sheet with the given content. */
    share(options: ShareOptions): Promise<ShareResult>;
    /** Open a URL in the system browser. Never opens local files or scripts (file:, content:, javascript:, data:). */
    openUrl(url: string): void;
    /** Copy text to the system clipboard. */
    copyToClipboard(text: string): Promise<void>;
    /** Download a file. Opens the OS share sheet so user can choose save location. */
    download(options: DownloadOptions): Promise<DownloadResult>;
    /**
     * Open the phone camera QR scanner as a host overlay. Does not unmount the
     * miniapp (so live sessions survive the scan). Resolves with the raw QR
     * payload, or `{cancelled: true}` if the user dismisses the scanner.
     */
    scanQr(options?: ScanQrOptions): Promise<ScanQrResult>;
}
//# sourceMappingURL=system.d.ts.map