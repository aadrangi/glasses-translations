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
import { type ReactNode } from "react";
export interface MentraProviderProps {
    children: ReactNode;
    /**
     * Toggle `document.documentElement.classList` "dark" to match the host's
     * current color scheme. The toggle runs synchronously during render so
     * children paint with the correct class on first mount — no flash.
     *
     * Default: true. Set to false if your app owns the `dark` class itself
     * (e.g. you integrate a theming library like next-themes).
     */
    syncColorScheme?: boolean;
    /**
     * Call `mentra.ready()` after the first mount. A parent's effects run after
     * its children's, so every `mentra.on` subscription the app makes on mount
     * is attached before the background is told the UI is open. Without
     * `ready()` the host keeps its splash up and reports the miniapp as failed.
     *
     * Default: true. Set to false to call `mentra.ready()` yourself, e.g. to keep
     * the splash up until the first screen has its data.
     */
    autoReady?: boolean;
}
export declare function MentraProvider({ children, syncColorScheme, autoReady }: MentraProviderProps): import("react").JSX.Element;
//# sourceMappingURL=MentraProvider.d.ts.map