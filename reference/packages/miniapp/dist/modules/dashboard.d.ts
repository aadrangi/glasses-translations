/**
 * @fileoverview DashboardAPI — deferred dashboard rendering surface.
 *
 * setContent warns once per instance and sends a fire-and-forget message.
 * The local runtime does not implement dashboard rendering. It sends no reply
 * without a request ID; requests with an ID receive NOT_IMPLEMENTED.
 */
import { MiniappSession } from "../session";
export type DashboardMode = "main" | "expanded" | "always_on";
export declare class DashboardAPI {
    private readonly session;
    private warned;
    constructor(session: MiniappSession);
    setContent(mode: DashboardMode, content: string): void;
}
//# sourceMappingURL=dashboard.d.ts.map