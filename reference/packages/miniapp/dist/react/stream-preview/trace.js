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
export const PREVIEW_TRACE_MARKER = "PREVIEW_TRACE";
const REDACTED = "<redacted>";
const SENSITIVE_KEYS = ["token", "secret", "password", "authorization", "url", "meetingurl"];
/** Repeated identical warnings: log the first, then a count at most this often. */
const RATE_LIMIT_WINDOW_MS = 10000;
function defaultSink(line, level) {
    if (typeof console === "undefined")
        return;
    if (level === "warn")
        console.warn(line);
    else
        console.log(line);
}
let sink = defaultSink;
let now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
function isSensitive(key) {
    const lower = key.toLowerCase();
    return SENSITIVE_KEYS.some((sensitive) => lower.includes(sensitive));
}
/** Render one line. Exported for tests. */
export function formatPreviewTrace(phase, fields = {}) {
    const parts = [`[${PREVIEW_TRACE_MARKER}]`, `layer=page`, `phase=${phase}`];
    for (const [key, value] of Object.entries(fields)) {
        if (value === undefined)
            continue;
        const rendered = isSensitive(key) ? REDACTED : String(value).replace(/\s+/g, "_");
        parts.push(`${key}=${rendered}`);
    }
    parts.push(`t=${Math.round(now())}`);
    return parts.join(" ");
}
export function previewTrace(phase, fields) {
    sink(formatPreviewTrace(phase, fields), "log");
}
export function previewTraceWarn(phase, fields) {
    sink(formatPreviewTrace(phase, fields), "warn");
}
const rateLimited = new Map();
/** Warn once per key, then report how many were suppressed at most every 10 s. */
export function previewTraceWarnLimited(key, phase, fields) {
    const at = now();
    const entry = rateLimited.get(key);
    if (!entry) {
        rateLimited.set(key, { firstAt: at, suppressed: 0 });
        previewTraceWarn(phase, fields);
        return;
    }
    entry.suppressed += 1;
    if (at - entry.firstAt >= RATE_LIMIT_WINDOW_MS) {
        previewTraceWarn(phase, { ...fields, repeated: entry.suppressed });
        entry.firstAt = at;
        entry.suppressed = 0;
    }
}
/** Test seam: capture lines and drive the clock. Pass nothing to restore the defaults. */
export function setPreviewTraceSinkForTests(next, clock) {
    sink = next ?? defaultSink;
    now = clock ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    rateLimited.clear();
}
//# sourceMappingURL=trace.js.map