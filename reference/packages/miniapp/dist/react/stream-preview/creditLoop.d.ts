/**
 * Consumer side of the one-frame credit scheme.
 *
 * The native sender holds exactly one frame in flight and will not send the next until this side
 * acknowledges the last, so there is no queue anywhere and a slow consumer shows up as a lower
 * frame rate rather than as growing latency. This module is the half that makes that true: parse,
 * draw, ack — and never hold a reference to a frame after its ack.
 *
 * Durations here would be `performance.now()` and describe JavaScript only; the header's
 * `timestampNs` / `sentAtNs` are a native monotonic clock with a different epoch. End-to-end
 * latency is measured natively (it sees both the send and the ack on one clock).
 */
import { type ParsedFrame, type PreviewParseErrorReason } from "./protocol";
export interface CreditLoopFrameSummary {
    gen: number;
    seq: number;
    width: number;
    height: number;
    pixelFormat: string;
    rotationQuarters: number;
}
export interface CreditLoopStats {
    framesReceived: number;
    drawsSubmitted: number;
    acksSent: number;
    parseErrors: number;
    parseErrorsByReason: Partial<Record<PreviewParseErrorReason, number>>;
    /**
     * Frames that arrived while another was still being processed. Native guarantees one at a time,
     * so any value above zero means the credit scheme is broken.
     */
    overlapped: number;
    /** Frames the sender skipped, counted from gaps in the header sequence. */
    sequenceGaps: number;
    skippedBySender: number;
    lastError: string | null;
    lastFrame: CreditLoopFrameSummary | null;
}
export interface CreditLoopOptions {
    sendAck: (gen: number, seq: number) => void;
    /**
     * Submit the frame. Returns the submit duration in ms, or null when there is no renderer (the
     * component is unmounted or its GL context is lost). The frame is acked either way.
     */
    draw?: (frame: ParsedFrame) => number | null;
    /** Called once per rejected frame, before anything else happens to it. */
    onParseError?: (reason: PreviewParseErrorReason, detail?: string) => void;
}
export declare class CreditLoop {
    private readonly options;
    private readonly errorsByReason;
    private idleWaiters;
    private inFlightCount;
    private framesReceived;
    private drawsSubmitted;
    private acksSent;
    private parseErrors;
    private overlapped;
    private sequenceGaps;
    private skippedBySender;
    private lastSeq;
    private lastGen;
    private lastError;
    private lastFrame;
    private draw;
    constructor(options: CreditLoopOptions);
    /** Swap the renderer without touching the credit state. Null means frames are acked undrawn. */
    setDraw(draw: CreditLoopOptions["draw"] | null): void;
    /** Frames currently being processed. The credit scheme means this is 0 or 1. */
    get inFlight(): number;
    /** Entry point for the transport. Deliberately not awaited: the transport must not block. */
    handleBinary(buffer: ArrayBuffer): void;
    /** Resolves once nothing is being processed. */
    idle(): Promise<void>;
    recordError(reason: string): void;
    snapshot(): CreditLoopStats;
    reset(): void;
    private process;
    private trackSequence;
}
//# sourceMappingURL=creditLoop.d.ts.map