/**
 * @fileoverview PhoneModule — phone device-state events.
 *
 * Mirrors cloud SDK v3's PhoneManager structure. Sub-namespaced by concern:
 *
 *   session.phone.notifications.{on, hasPermission, stop}
 *   session.phone.calendar.{listEvents, hasPermission}
 *   session.phone.onBattery(...)                          // stays flat
 *
 * Imperative phone-OS calls (share, openUrl, copyToClipboard, download) live
 * on `session.system` — different shape (one-shot calls vs. event subs) so
 * we don't conflate them.
 *
 * `phone.notifications.onDismissed` is Android-only. iOS doesn't expose
 * notification-dismiss callbacks to apps (Apple privacy restriction);
 * subscribing on iOS is a no-op even though the API is present.
 */
import { MiniappSession } from "../session";
import type { BatteryData, NotificationDismissedData, PhoneNotificationData, UnsubscribeFn } from "./events";
declare class TrackedSubs {
    private readonly unsubs;
    protected track(unsub: UnsubscribeFn): UnsubscribeFn;
    stop(): void;
}
export declare class PhoneNotificationsModule extends TrackedSubs {
    private readonly session;
    constructor(session: MiniappSession);
    on(handler: (data: PhoneNotificationData) => void): UnsubscribeFn;
    /**
     * Subscribe to dismiss events for phone notifications. Fires when the user
     * dismisses (swipes away or clears) a notification.
     *
     * **Android only.** iOS does not expose dismiss callbacks to apps (Apple
     * privacy restriction); subscribing on iOS succeeds but no events ever
     * fire. The matching `notifications.on()` post-event still works on both
     * platforms.
     */
    onDismissed(handler: (data: NotificationDismissedData) => void): UnsubscribeFn;
    /** True iff `READ_NOTIFICATIONS` is declared in the miniapp's manifest. */
    get hasPermission(): boolean;
}
export interface CalendarListOptions {
    /** Inclusive start of the query window. */
    startsAt: string | Date;
    /** Exclusive end of the query window. Must be after startsAt. */
    endsAt: string | Date;
    /** Maximum events to return. Defaults to 50 and may not exceed 100. */
    limit?: number;
}
export interface CalendarEvent {
    /** Stable occurrence id, unique across calendars and recurring instances. */
    id: string;
    calendarId: string;
    title: string;
    /** ISO 8601 start time. All-day events preserve their calendar timezone offset. */
    startsAt: string;
    /** ISO 8601 end time. All-day events preserve their calendar timezone offset. */
    endsAt: string;
    timezone?: string;
    allDay: boolean;
    location?: string;
    notes?: string;
    url?: string;
    /** Deduplicated HTTPS links found in the event URL, location, and notes. */
    links: string[];
}
export interface CalendarListResult {
    events: CalendarEvent[];
    /** True when more matching events existed than the requested limit. */
    truncated: boolean;
}
export declare class PhoneCalendarModule {
    private readonly session;
    constructor(session: MiniappSession);
    /**
     * Read calendar events in a bounded window. CALENDAR must be declared in
     * miniapp.json and granted before the miniapp opens.
     */
    listEvents(options: CalendarListOptions): Promise<CalendarListResult>;
    /** True iff `CALENDAR` is declared in the miniapp's manifest. */
    get hasPermission(): boolean;
}
export interface PhoneWifiEnableResult {
    /** True/false on Android. On iOS, true if connected to Wi-Fi, otherwise null. */
    enabled: boolean | null;
    /** The user cancelled the prompt, or did not return from Settings within five minutes. */
    cancelled: boolean;
}
export declare class PhoneModule {
    private readonly session;
    readonly notifications: PhoneNotificationsModule;
    readonly calendar: PhoneCalendarModule;
    constructor(session: MiniappSession);
    /**
     * Read phone Wi-Fi availability, independent of internet or glasses Wi-Fi.
     * Android reads the radio switch. iOS has no public radio-state API: a Wi-Fi
     * connection returns true; otherwise null (unknown), never false.
     */
    isWifiEnabled(): Promise<boolean | null>;
    /**
     * Present a host prompt with an optional user-facing reason, then open the
     * Android Wi-Fi panel or iOS Settings. Resolves after returning and rechecking
     * Wi-Fi; cancellation is explicit. Already-enabled Wi-Fi resolves immediately.
     * A null result permits trying the normal system hotspot join on iOS; it does
     * not confirm that Wi-Fi is on. This never toggles Wi-Fi or joins a network.
     * Older hosts reject with NOT_IMPLEMENTED. Call from a user-initiated flow.
     */
    requestWifiEnable(reason?: string): Promise<PhoneWifiEnableResult>;
    /**
     * Phone battery events. Stays flat (not sub-namespaced) — single event,
     * no extra surface.
     */
    onBattery(handler: (data: BatteryData) => void): UnsubscribeFn;
}
export {};
//# sourceMappingURL=phone.d.ts.map