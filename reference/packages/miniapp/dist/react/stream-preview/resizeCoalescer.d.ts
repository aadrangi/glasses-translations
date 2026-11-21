/**
 * Collapse a stream of box measurements into the few that matter.
 *
 * A layout animation fires ResizeObserver every frame. Bursts inside one frame are merged with
 * `requestAnimationFrame`, and a size is only applied once it has held still for the settle
 * window. Hiding (a zero box) and the first measurement apply at once: the first so the preview
 * starts without a delay, hiding so production stops as soon as nobody can see it.
 */
export interface PreviewBox {
    width: number;
    height: number;
}
export interface ResizeCoalescerOptions {
    apply: (box: PreviewBox) => void;
    settleMs?: number;
    requestFrame?: (cb: () => void) => unknown;
    setTimer?: (cb: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
}
export declare const RESIZE_SETTLE_MS = 250;
export declare class ResizeCoalescer {
    private readonly options;
    private latest;
    private lastApplied;
    private framePending;
    private timer;
    private cancelled;
    private readonly settleMs;
    private readonly requestFrame;
    private readonly setTimer;
    private readonly clearTimer;
    constructor(options: ResizeCoalescerOptions);
    push(box: PreviewBox): void;
    cancel(): void;
    private applyLatest;
    private clearSettle;
}
//# sourceMappingURL=resizeCoalescer.d.ts.map