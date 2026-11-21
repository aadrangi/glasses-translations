/**
 * registerMiniapp — entry hook for the background JSContext.
 *
 * The MentraJS host loads the polyfill (which installs __dispatch /
 * __deliver / timers / fetch / etc.), then evaluates the miniapp's
 * background bundle. After both scripts have evaluated successfully,
 * the host delivers a single `{kind: "init", sessionId}` envelope.
 * The polyfill turns that into a call to `__mentraInitCallback(sessionId)`.
 *
 * This module wires that callback to:
 *   1. Construct a `MiniappSession` (DispatchTransport picks itself
 *      automatically because `__dispatch` is on globalThis).
 *   2. Call the user-supplied handler synchronously so subscriptions
 *      are registered before any host events fan out.
 *   3. Call `session.connect()` so the host receives CONNECT and the
 *      first CONNECT_ACK populates `userId`, `capabilities`, etc. A host that
 *      has not answered within `connectTimeoutMs` gets CONNECT again; that is
 *      a stalled host, not a miniapp crash.
 *   4. Send READY once the handler's returned promise settles. Hosts that
 *      advertise `hostFeatures.initReady` keep the UI closed until then.
 *
 * The handler runs once per spawn. If the host kills + respawns the
 * JSContext (crash recovery, dev reload), the polyfill + bundle are
 * re-evaluated and the handler fires again with a fresh session.
 */
import { MiniappSession, NotConnectedError } from "../session";
/** A later init replaces the session: disconnecting it ends its handshake, so it neither retries nor reports. */
function releaseBackgroundSession(g) {
    const previous = g.__mentraBackgroundSession;
    g.__mentraBackgroundSession = undefined;
    previous?.disconnect();
}
/**
 * Register the miniapp's startup handler. Call once at the top level of
 * `src/background/index.ts`. Top-level side effects are fine, but the
 * vast majority of setup should live inside the handler so it can run
 * with a connected session.
 *
 * Return the handler's startup promise (don't `void` it): the Mentra App
 * shows its splash and holds UI requests until it settles, so register
 * `session.ui.handle` handlers before any slow await.
 *
 * @example
 *   registerMiniapp((session) => {
 *     session.transcription.on((tx) => {
 *       session.display.render([{type: "text", id: "tx", box, text: tx.text}])
 *     })
 *   })
 */
export function registerMiniapp(handler, options = {}) {
    const g = globalThis;
    releaseBackgroundSession(g);
    g.__mentraInitCallback = (sessionId) => {
        releaseBackgroundSession(g);
        const session = new MiniappSession(options);
        g.__mentraBackgroundSession = session;
        // Before the handler runs, so its own connect() or waitForReady() shares the retried handshake.
        session.retryHandshakeOnTimeout();
        // The handler's returned promise defines readiness: the host keeps the UI
        // closed until it settles, so handlers registered after an await still
        // exist before the first UI request arrives.
        session.announceInitReady(sessionId);
        let initSettled = Promise.resolve();
        // Fire the user handler first so any session.* subscriptions get
        // registered before the CONNECT_ACK fan-out lands.
        try {
            const result = handler(session);
            if (result && typeof result.then === "function") {
                initSettled = result.then(() => undefined, (err) => {
                    // eslint-disable-next-line no-console
                    console.error("[mentra-miniapp] registerMiniapp handler rejected:", err);
                });
            }
        }
        catch (err) {
            // eslint-disable-next-line no-console
            console.error("[mentra-miniapp] registerMiniapp handler threw:", err);
        }
        const connected = session.connect();
        // A failed handler still reports READY: its UI must not stay closed.
        void Promise.all([connected, initSettled]).then(() => session.reportInitReady(), () => {
            /* connect failure is reported below */
        });
        connected.catch((err) => {
            // Replaced by a later init, or disconnected during the handshake: a
            // deliberate teardown, not a crash.
            if (g.__mentraBackgroundSession !== session || err instanceof NotConnectedError)
                return;
            // eslint-disable-next-line no-console
            console.error("[mentra-miniapp] session.connect() rejected:", err);
            // Surface to the host's crash controller as a structured uncaught
            // error so the existing backoff + crashloop machinery handles it.
            // Repeated connect failures eventually flip the miniapp to
            // CRASHLOOP_DISABLED, which the host turns into a user-facing
            // alert + automatic incident report.
            try {
                const message = err instanceof Error ? err.message : String(err);
                const stack = err instanceof Error && err.stack ? err.stack : "";
                g.__hostError?.(JSON.stringify({ message: `session.connect() failed: ${message}`, stack }));
            }
            catch {
                /* host bridge missing in tests — ignore */
            }
        });
    };
}
//# sourceMappingURL=register.js.map