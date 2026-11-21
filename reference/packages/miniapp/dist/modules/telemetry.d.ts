/**
 * @fileoverview TelemetryModule (`session.telemetry`): a miniapp's own analytics, shown in its organization's Fleet
 * Management.
 *
 * `capture(event, properties?)` sends one fire-and-forget message to the Mentra App and returns nothing. It never throws
 * and never waits. The SDK checks nothing: the Mentra App attributes the event to this miniapp and applies the limits
 * (names, values, 25 properties, the rate), and on a Mentra App without the `telemetry` host feature it does nothing.
 * Before the handshake says which, it holds the latest 100 captures and sends them once it knows.
 */
import type { MiniappSession } from "../session";
export type TelemetryValue = string | number | boolean;
export type TelemetryProperties = Record<string, TelemetryValue>;
export declare class TelemetryModule {
    private readonly session;
    private held;
    private waiting;
    constructor(session: MiniappSession);
    /**
     * Captures one event, in the style of PostHog: `session.telemetry.capture("call_ended", {platform: "teams",
     * duration_s: 312})`. Names are lowercase letters, digits and underscores; values are flat. Never personal data: no
     * names, emails, phone numbers, typed text or content.
     */
    capture(event: string, properties?: TelemetryProperties): void;
}
//# sourceMappingURL=telemetry.d.ts.map