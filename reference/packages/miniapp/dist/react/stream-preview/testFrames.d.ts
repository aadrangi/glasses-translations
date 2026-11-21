/**
 * Build `MFPV` frames for tests. Lives beside the parser so the golden-bytes test and the parser
 * cannot drift apart silently. Not exported from the package entry.
 */
import { type PreviewPixelFormat } from "./protocol";
export interface BuildPreviewFrameOptions {
    width?: number;
    height?: number;
    pixelFormat?: PreviewPixelFormat;
    sessionGen?: number;
    frameSeq?: number;
    rotationQuarters?: number;
    /** Raw header codes so a test can send "unknown" (0) and check the fallback. */
    colorMatrixCode?: number;
    colorRangeCode?: number;
    flags?: number;
    timestampNs?: bigint;
    sentAtNs?: bigint;
    /** Byte written into every sample of each plane, so plane views can be told apart. */
    fill?: {
        y?: number;
        u?: number;
        v?: number;
    };
    /** Deliberate corruption, for the rejection tests. Every field overrides what would be written. */
    corrupt?: {
        magic?: readonly number[];
        version?: number;
        headerLen?: number;
        payloadLen?: number;
        /** Payload bytes actually appended, independent of the declared `payloadLen`. */
        payloadBytes?: number;
        pixelFormatCode?: number;
    };
}
/** Build a wire-format frame. */
export declare function buildPreviewFrame(options?: BuildPreviewFrameOptions): ArrayBuffer;
//# sourceMappingURL=testFrames.d.ts.map