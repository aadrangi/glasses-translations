/**
 * @fileoverview DisplayManager — the glasses display, via `render()`.
 *
 * render(elements) is replace-the-frame scene rendering: each call describes
 * everything that should be on screen, the host diffs it against the previous
 * frame per device, and `render([])` clears. The legacy one-shot `show*`
 * layout methods were removed once nothing first-party or known-external
 * called them; hosts still accept the historical `miniapp_display` wire shape
 * from bundles packed with older SDKs.
 */
import { MiniappRequestType } from "../protocol";
export class DisplayManager {
    constructor(session) {
        this.session = session;
    }
    /**
     * Render a whole scene of positioned elements — replace-the-frame.
     *
     * Each call describes everything that should be on screen; the host diffs it
     * against the previous frame per device (elements with a stable `id` update
     * in place; elements you stop sending are removed). There is no lifecycle to
     * manage and no remove calls — `render([])` clears.
     *
     * Coordinates are raw pixels on the device's drawable canvas — read
     * `session.capabilities.display` (populated on the "ready" event) for the
     * real width/height and element budgets. Out-of-bounds boxes are clamped and
     * over-budget elements are dropped tail-first; both are reported via the
     * result, never silently.
     *
     * Awaiting is OPT-IN — a plain fire-and-forget call is fine. The returned
     * promise never rejects.
     *
     * @example
     * const result = await session.display.render([
     *   {type: "text",  id: "stats", box: {x: 12, y: 9, w: 200, h: 28}, text: "863 m  11 min"},
     *   {type: "image", id: "map",   box: {x: 335, y: 14, w: 150, h: 150}, data: mapPng},
     *   {type: "rect",  box: {x: 0, y: 0, w: 500, h: 220}, style: {radius: 4}},
     * ])
     * if (result.degraded) console.warn("dropped:", result.dropped)
     */
    render(elements, options = {}) {
        return this.session
            .sendRequest({
            type: MiniappRequestType.RENDER,
            view: options.view ?? "main",
            elements,
            durationMs: options.durationMs,
            includeTextLayout: options.includeTextLayout,
            ifDisplayToken: options.ifDisplayToken,
        })
            .catch((err) => ({
            status: "blocked",
            reason: typeof err === "object" && err !== null && "message" in err
                ? String(err.message)
                : String(err),
        }));
    }
}
//# sourceMappingURL=display.js.map