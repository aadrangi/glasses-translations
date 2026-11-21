import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
/**
 * @fileoverview MentraProvider — optional root provider for miniapp apps.
 *
 * Opt-in conveniences that would otherwise require boilerplate in every
 * miniapp. Currently:
 *   - Keeps `<html class="dark">` in sync with the host's color scheme so the
 *     shared theme CSS switches automatically.
 *   - Calls `mentra.ready()` once the app has mounted, which lifts the host's
 *     splash and fires the background's `session.ui.onOpen` handlers.
 *
 * Usage:
 *   createRoot(root).render(
 *     <MentraProvider>
 *       <App />
 *     </MentraProvider>
 *   )
 *
 * Each convenience is controllable via props so miniapps that manage these
 * things themselves can opt out without forking the provider.
 */
import { useEffect } from "react";
import { useColorScheme } from "./useColorScheme";
function getBridge() {
    if (typeof window === "undefined")
        return null;
    return window.mentra ?? null;
}
export function MentraProvider({ children, syncColorScheme = true, autoReady = true }) {
    const scheme = useColorScheme();
    useEffect(() => {
        if (autoReady)
            getBridge()?.ready?.();
    }, [autoReady]);
    // Runs during render — before children paint, before effects fire.
    if (syncColorScheme && typeof document !== "undefined") {
        const el = document.documentElement;
        const shouldBeDark = scheme === "dark";
        if (el.classList.contains("dark") !== shouldBeDark) {
            el.classList.toggle("dark", shouldBeDark);
        }
    }
    return _jsx(_Fragment, { children: children });
}
//# sourceMappingURL=MentraProvider.js.map