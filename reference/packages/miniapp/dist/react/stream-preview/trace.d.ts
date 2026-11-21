/**
 * Page-side `PREVIEW_TRACE` lines.
 *
 * Same shape as the host and native layers: a literal grep marker, `phase=`, then `key=value`
 * pairs. The WebView console is forwarded to the host as `dev_log`, so these lines land in the
 * Mentra App log buffer next to the host's and ship with bug reports.
 *
 * Nothing here runs per frame. Per-frame facts are counters.
 */
/** Grep marker. Never build this by concatenation — a single grep must be exhaustive. */
export declare const PREVIEW_TRACE_MARKER = "PREVIEW_TRACE";
export type PreviewTraceFields = Record<string, string | number | boolean | null | undefined>;
type Sink = (line: string, level: "log" | "warn") => void;
/** Render one line. Exported for tests. */
export declare function formatPreviewTrace(phase: string, fields?: PreviewTraceFields): string;
export declare function previewTrace(phase: string, fields?: PreviewTraceFields): void;
export declare function previewTraceWarn(phase: string, fields?: PreviewTraceFields): void;
/** Warn once per key, then report how many were suppressed at most every 10 s. */
export declare function previewTraceWarnLimited(key: string, phase: string, fields?: PreviewTraceFields): void;
/** Test seam: capture lines and drive the clock. Pass nothing to restore the defaults. */
export declare function setPreviewTraceSinkForTests(next?: Sink, clock?: () => number): void;
export {};
//# sourceMappingURL=trace.d.ts.map