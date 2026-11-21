/**
 * @fileoverview DashboardAPI — deferred dashboard rendering surface.
 *
 * setContent warns once per instance and sends a fire-and-forget message.
 * The local runtime does not implement dashboard rendering. It sends no reply
 * without a request ID; requests with an ID receive NOT_IMPLEMENTED.
 */
import { MiniappRequestType } from "../protocol";
export class DashboardAPI {
    constructor(session) {
        this.session = session;
        this.warned = false;
    }
    setContent(mode, content) {
        if (!this.warned) {
            console.warn("[@mentra/miniapp] dashboard.setContent() is deferred in v1.");
            this.warned = true;
        }
        // No request ID: the runtime ignores this update without sending a result.
        this.session.sendOneShot({
            type: MiniappRequestType.DASHBOARD_CONTENT_UPDATE,
            mode,
            content,
        });
    }
}
//# sourceMappingURL=dashboard.js.map