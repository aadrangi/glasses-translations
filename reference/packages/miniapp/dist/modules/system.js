/**
 * @fileoverview SystemModule — OS-level utilities (share, open URL, clipboard, download, QR scan).
 *
 * These bridge to native phone capabilities via LocalMiniappRuntime.
 */
import { MiniappRequestType } from "../protocol";
export class SystemModule {
    constructor(session) {
        this.session = session;
    }
    /** Open the OS share sheet with the given content. */
    async share(options) {
        const result = await this.session.sendRequest({
            type: MiniappRequestType.SHARE,
            ...options,
        });
        return result ?? { success: false };
    }
    /** Open a URL in the system browser. Never opens local files or scripts (file:, content:, javascript:, data:). */
    openUrl(url) {
        this.session.sendOneShot({
            type: MiniappRequestType.OPEN_URL,
            url,
        });
    }
    /** Copy text to the system clipboard. */
    async copyToClipboard(text) {
        await this.session.sendRequest({
            type: MiniappRequestType.COPY_CLIPBOARD,
            text,
        });
    }
    /** Download a file. Opens the OS share sheet so user can choose save location. */
    async download(options) {
        const result = await this.session.sendRequest({
            type: MiniappRequestType.DOWNLOAD,
            ...options,
        });
        return result ?? { success: false };
    }
    /**
     * Open the phone camera QR scanner as a host overlay. Does not unmount the
     * miniapp (so live sessions survive the scan). Resolves with the raw QR
     * payload, or `{cancelled: true}` if the user dismisses the scanner.
     */
    async scanQr(options = {}) {
        const result = await this.session.sendRequest({
            type: MiniappRequestType.SCAN_QR,
            ...options,
        }, { timeoutMs: 0 });
        return result ?? { cancelled: true };
    }
}
//# sourceMappingURL=system.js.map