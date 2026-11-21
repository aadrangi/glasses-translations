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
import { parsePreviewFrame } from "./protocol";
export class CreditLoop {
    constructor(options) {
        this.options = options;
        this.errorsByReason = new Map();
        this.idleWaiters = [];
        this.inFlightCount = 0;
        this.framesReceived = 0;
        this.drawsSubmitted = 0;
        this.acksSent = 0;
        this.parseErrors = 0;
        this.overlapped = 0;
        this.sequenceGaps = 0;
        this.skippedBySender = 0;
        this.lastSeq = null;
        this.lastGen = null;
        this.lastError = null;
        this.lastFrame = null;
        this.draw = options.draw;
    }
    /** Swap the renderer without touching the credit state. Null means frames are acked undrawn. */
    setDraw(draw) {
        this.draw = draw ?? undefined;
    }
    /** Frames currently being processed. The credit scheme means this is 0 or 1. */
    get inFlight() {
        return this.inFlightCount;
    }
    /** Entry point for the transport. Deliberately not awaited: the transport must not block. */
    handleBinary(buffer) {
        if (this.inFlightCount > 0)
            this.overlapped += 1;
        this.inFlightCount += 1;
        void this.process(buffer).finally(() => {
            this.inFlightCount -= 1;
            if (this.inFlightCount === 0) {
                const waiters = this.idleWaiters;
                this.idleWaiters = [];
                for (const resolve of waiters)
                    resolve();
            }
        });
    }
    /** Resolves once nothing is being processed. */
    idle() {
        if (this.inFlightCount === 0)
            return Promise.resolve();
        return new Promise((resolve) => this.idleWaiters.push(resolve));
    }
    recordError(reason) {
        this.lastError = reason;
    }
    snapshot() {
        const parseErrorsByReason = {};
        for (const [reason, count] of this.errorsByReason)
            parseErrorsByReason[reason] = count;
        return {
            framesReceived: this.framesReceived,
            drawsSubmitted: this.drawsSubmitted,
            acksSent: this.acksSent,
            parseErrors: this.parseErrors,
            parseErrorsByReason,
            overlapped: this.overlapped,
            sequenceGaps: this.sequenceGaps,
            skippedBySender: this.skippedBySender,
            lastError: this.lastError,
            lastFrame: this.lastFrame,
        };
    }
    reset() {
        this.framesReceived = 0;
        this.drawsSubmitted = 0;
        this.acksSent = 0;
        this.parseErrors = 0;
        this.overlapped = 0;
        this.sequenceGaps = 0;
        this.skippedBySender = 0;
        this.lastSeq = null;
        this.lastGen = null;
        this.lastError = null;
        this.lastFrame = null;
        this.errorsByReason.clear();
    }
    async process(buffer) {
        this.framesReceived += 1;
        const parsed = parsePreviewFrame(buffer);
        if (!parsed.ok) {
            // No ack: a frame this side could not read is not a frame it consumed, and acking it would
            // hide the fault behind a healthy-looking rate.
            this.parseErrors += 1;
            this.errorsByReason.set(parsed.reason, (this.errorsByReason.get(parsed.reason) ?? 0) + 1);
            this.lastError = parsed.detail ? `${parsed.reason} (${parsed.detail})` : parsed.reason;
            this.options.onParseError?.(parsed.reason, parsed.detail);
            return;
        }
        this.trackSequence(parsed);
        this.lastFrame = {
            gen: parsed.sessionGen,
            seq: parsed.frameSeq,
            width: parsed.width,
            height: parsed.height,
            pixelFormat: parsed.pixelFormat,
            rotationQuarters: parsed.rotationQuarters,
        };
        if (this.draw) {
            const submitMs = this.draw(parsed);
            if (submitMs === null)
                this.lastError = "draw_failed";
            else
                this.drawsSubmitted += 1;
        }
        // Ack last, after the draw has been submitted, so the credit the sender gets back means "this
        // side is done with that frame" rather than "this side received some bytes". A dead canvas
        // still acks: withholding credit would stall the sender on top of it.
        this.options.sendAck(parsed.sessionGen, parsed.frameSeq);
        this.acksSent += 1;
    }
    trackSequence(parsed) {
        if (this.lastGen !== parsed.sessionGen) {
            this.lastGen = parsed.sessionGen;
            this.lastSeq = parsed.frameSeq;
            return;
        }
        if (this.lastSeq !== null) {
            const delta = parsed.frameSeq - this.lastSeq;
            if (delta > 1) {
                this.sequenceGaps += 1;
                this.skippedBySender += delta - 1;
            }
        }
        this.lastSeq = parsed.frameSeq;
    }
}
//# sourceMappingURL=creditLoop.js.map