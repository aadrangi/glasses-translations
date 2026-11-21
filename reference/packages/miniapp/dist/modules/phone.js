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
import { MiniappRequestType, MiniappStreamType } from "../protocol";
class TrackedSubs {
    constructor() {
        this.unsubs = new Set();
    }
    track(unsub) {
        this.unsubs.add(unsub);
        return () => {
            this.unsubs.delete(unsub);
            unsub();
        };
    }
    stop() {
        for (const u of this.unsubs) {
            try {
                u();
            }
            catch {
                /* ignore */
            }
        }
        this.unsubs.clear();
    }
}
export class PhoneNotificationsModule extends TrackedSubs {
    constructor(session) {
        super();
        this.session = session;
    }
    on(handler) {
        return this.track(this.session._subscribe(MiniappStreamType.PHONE_NOTIFICATION, handler));
    }
    /**
     * Subscribe to dismiss events for phone notifications. Fires when the user
     * dismisses (swipes away or clears) a notification.
     *
     * **Android only.** iOS does not expose dismiss callbacks to apps (Apple
     * privacy restriction); subscribing on iOS succeeds but no events ever
     * fire. The matching `notifications.on()` post-event still works on both
     * platforms.
     */
    onDismissed(handler) {
        return this.track(this.session._subscribe(MiniappStreamType.PHONE_NOTIFICATION_DISMISSED, handler));
    }
    /** True iff `READ_NOTIFICATIONS` is declared in the miniapp's manifest. */
    get hasPermission() {
        return this.session._hasManifestPermission("READ_NOTIFICATIONS");
    }
}
export class PhoneCalendarModule {
    constructor(session) {
        this.session = session;
    }
    /**
     * Read calendar events in a bounded window. CALENDAR must be declared in
     * miniapp.json and granted before the miniapp opens.
     */
    listEvents(options) {
        const startsAt = normalizeCalendarDate(options?.startsAt, "startsAt");
        const endsAt = normalizeCalendarDate(options?.endsAt, "endsAt");
        return this.session.sendRequest({
            type: MiniappRequestType.CALENDAR_LIST_EVENTS,
            startsAt,
            endsAt,
            ...(options.limit === undefined ? {} : { limit: options.limit }),
        });
    }
    /** True iff `CALENDAR` is declared in the miniapp's manifest. */
    get hasPermission() {
        return this.session._hasManifestPermission("CALENDAR");
    }
}
function normalizeCalendarDate(value, field) {
    const date = value instanceof Date ? value : new Date(value ?? "");
    if (Number.isNaN(date.getTime()))
        throw new TypeError(`${field} must be a valid Date or ISO 8601 string`);
    return date.toISOString();
}
export class PhoneModule {
    constructor(session) {
        this.session = session;
        this.notifications = new PhoneNotificationsModule(session);
        this.calendar = new PhoneCalendarModule(session);
    }
    /**
     * Read phone Wi-Fi availability, independent of internet or glasses Wi-Fi.
     * Android reads the radio switch. iOS has no public radio-state API: a Wi-Fi
     * connection returns true; otherwise null (unknown), never false.
     */
    isWifiEnabled() {
        return this.session.sendRequest({ type: MiniappRequestType.PHONE_IS_WIFI_ENABLED });
    }
    /**
     * Present a host prompt with an optional user-facing reason, then open the
     * Android Wi-Fi panel or iOS Settings. Resolves after returning and rechecking
     * Wi-Fi; cancellation is explicit. Already-enabled Wi-Fi resolves immediately.
     * A null result permits trying the normal system hotspot join on iOS; it does
     * not confirm that Wi-Fi is on. This never toggles Wi-Fi or joins a network.
     * Older hosts reject with NOT_IMPLEMENTED. Call from a user-initiated flow.
     */
    requestWifiEnable(reason) {
        return this.session.sendRequest({ type: MiniappRequestType.PHONE_REQUEST_WIFI_ENABLE, reason }, { timeoutMs: 0 });
    }
    /**
     * Phone battery events. Stays flat (not sub-namespaced) — single event,
     * no extra surface.
     */
    onBattery(handler) {
        return this.session._subscribe(MiniappStreamType.PHONE_BATTERY, handler);
    }
}
//# sourceMappingURL=phone.js.map