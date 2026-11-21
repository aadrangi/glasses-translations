/**
 * The reserved `_preview` UI channel, as seen from the page.
 *
 * The Mentra App answers this channel itself; it never reaches the miniapp's background. Requests
 * ride `mentra.request`, and host events arrive on `mentra.on("_preview")`. Every control request
 * carries the page identity (`docGen`, `token`, `mountEpoch`) so the host can drop operations
 * from a document or a component that has since been replaced.
 */
import { PREVIEW_UI_CHANNEL } from "../../protocol";
/** A `_preview` request the host refused. `code` is a preview error code. */
export class PreviewControlError extends Error {
    constructor(code, message) {
        super(message ?? code);
        this.name = "PreviewControlError";
        this.code = code;
    }
}
/** Host replies are local and fast; this only bounds a host that never answers. */
const REQUEST_TIMEOUT_MS = 10000;
function mentraGlobal() {
    const candidate = globalThis.mentra;
    if (!candidate || typeof candidate.request !== "function" || typeof candidate.on !== "function")
        return null;
    return candidate;
}
/** The channel over the injected `window.mentra` bridge. Null outside a Mentra App WebView. */
export function createMentraControlChannel() {
    const mentra = mentraGlobal();
    if (!mentra)
        return null;
    return {
        async request(request) {
            try {
                return await mentra.request(PREVIEW_UI_CHANNEL, request, { timeout: REQUEST_TIMEOUT_MS });
            }
            catch (error) {
                const value = (error ?? {});
                const code = typeof value.code === "string"
                    ? value.code
                    : value.name === "MentraRpcTimeoutError"
                        ? "transport_failed"
                        : "unsupported";
                throw new PreviewControlError(code, typeof value.message === "string" ? value.message : undefined);
            }
        },
        onEvent(cb) {
            return mentra.on(PREVIEW_UI_CHANNEL, (payload) => {
                if (payload && typeof payload === "object" && typeof payload.t === "string") {
                    cb(payload);
                }
            });
        },
    };
}
//# sourceMappingURL=controlChannel.js.map