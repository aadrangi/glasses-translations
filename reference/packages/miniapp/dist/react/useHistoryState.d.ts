/**
 * @fileoverview useHistoryState — `useState` whose changes are browser history
 * entries, so the phone's back gesture steps back through them.
 *
 * The host sends the back gesture (iOS edge swipe, Android back) to the
 * miniapp's WebView history first, and minimizes the miniapp only once that
 * history is empty. Screens, tabs and dialogs kept in plain React state never
 * create history, so back skips past them and minimizes the whole miniapp.
 * This hook keeps its value in `history.state` instead:
 *
 * - Setting a new value pushes a history entry. Back pops it, and the hook
 *   re-renders with the previous value.
 * - Setting the value back to what it was before its latest change(s) goes
 *   back instead of pushing. Closing a dialog with its own button therefore
 *   consumes the dialog's entry, and the next back gesture does not reopen it.
 *
 * Routers in hash or browser mode (react-router's `HashRouter`, wouter's
 * `useHashLocation`) already create history for pages; use this hook for UI
 * state that is not a route. Every hook on the page shares one history entry
 * per step, and `key` names the value within it, so components passing the
 * same key share the same value. Values are stored as structured clones.
 */
export type SetHistoryState<T> = (value: T | ((previous: T) => T)) => void;
/**
 * Like `useState`, but each change is a history entry that the phone's back
 * gesture undoes. `key` names the value in history state and must be unique
 * per piece of state on the page.
 *
 * ```tsx
 * const [tab, setTab] = useHistoryState<"home" | "settings">("tab", "home")
 * const [pickerOpen, setPickerOpen] = useHistoryState("languagePicker", false)
 * ```
 */
export declare function useHistoryState<T>(key: string, initialValue: T): [T, SetHistoryState<T>];
//# sourceMappingURL=useHistoryState.d.ts.map