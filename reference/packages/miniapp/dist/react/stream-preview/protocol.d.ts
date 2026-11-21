/**
 * Wire format for raw decoded-frame preview (`MFPV`): a 64-byte little-endian header followed by
 * a tightly packed 8-bit YUV payload.
 *
 * Nothing in this module may copy the payload. `parsePreviewFrame` returns `Uint8Array` views onto
 * the caller's ArrayBuffer and the renderer uploads those views straight to WebGL; a `.slice()`
 * anywhere in this path turns a zero-copy preview into a per-frame memcpy.
 *
 * Bad input is expected — a truncated or stale frame is a measurement, not an exception — so the
 * parser returns a discriminated union and never throws.
 *
 *   offset  size  field
 *        0     4  magic "MFPV"
 *        4     2  version u16
 *        6     2  headerLen u16
 *        8     4  payloadLen u32
 *       12     4  sessionGen u32
 *       16     4  frameSeq u32
 *       20     2  width u16
 *       22     2  height u16
 *       24     1  pixelFormat u8 (1 = I420, 2 = NV12)
 *       25     1  rotation u8 (quarter turns clockwise)
 *       26     1  colorMatrix u8 (0 unknown, 1 BT.601, 2 BT.709)
 *       27     1  colorRange u8 (0 unknown, 1 limited, 2 full)
 *       28     2  flags u16 (bit 0: the sender fell back on default colour metadata)
 *       30     2  reserved u16
 *       32     8  timestampNs i64 (native monotonic decode time, 0 when unknown)
 *       40     8  sentAtNs i64 (native monotonic at the send call)
 *       48    16  reserved
 */
/** Fixed header size. A sender that disagrees is rejected rather than guessed at. */
export declare const PREVIEW_FRAME_HEADER_BYTES = 64;
export declare const PREVIEW_FRAME_VERSION = 1;
/** ASCII "MFPV". */
export declare const PREVIEW_FRAME_MAGIC: readonly [77, 70, 80, 86];
/** Neither the glasses nor a phone camera reaches this; anything above it is a corrupt header. */
export declare const PREVIEW_FRAME_MAX_DIMENSION = 4096;
export declare const PIXEL_FORMAT_I420 = 1;
export declare const PIXEL_FORMAT_NV12 = 2;
export type PreviewPixelFormat = "i420" | "nv12";
export type PreviewColorMatrix = "bt601" | "bt709";
export type PreviewColorRange = "limited" | "full";
/**
 * One code per rejected frame, because "the frame was bad" is not a finding. A run that drops
 * frames on `truncated-payload` and one that drops them on `payload-size-mismatch` point at
 * different halves of the native sender.
 */
export type PreviewParseErrorReason = "short-buffer" | "bad-magic" | "unsupported-version" | "bad-header-length" | "bad-dimensions" | "unknown-pixel-format" | "payload-size-mismatch" | "truncated-payload";
export declare const PREVIEW_PARSE_ERROR_REASONS: readonly PreviewParseErrorReason[];
interface ParsedFrameBase {
    ok: true;
    sessionGen: number;
    frameSeq: number;
    width: number;
    height: number;
    /** Quarter turns clockwise, normalized to 0..3. */
    rotationQuarters: number;
    colorMatrix: PreviewColorMatrix;
    colorRange: PreviewColorRange;
    /** The header said "unknown" and BT.601 was assumed. */
    colorMatrixAssumed: boolean;
    /** The header said "unknown" and limited range was assumed. */
    colorRangeAssumed: boolean;
    /** Header flag bit 0: the native sender itself had to fall back on default colour metadata. */
    senderColorFallback: boolean;
    /**
     * Native monotonic clock, nanoseconds. Never subtract a `performance.now()` value from these:
     * the two clocks share no epoch. Only native-to-native differences mean anything.
     */
    timestampNs: bigint;
    sentAtNs: bigint;
    yStride: number;
    chromaWidth: number;
    chromaHeight: number;
    chromaStride: number;
    payloadLen: number;
}
export interface ParsedI420Frame extends ParsedFrameBase {
    pixelFormat: "i420";
    y: Uint8Array;
    u: Uint8Array;
    v: Uint8Array;
}
export interface ParsedNv12Frame extends ParsedFrameBase {
    pixelFormat: "nv12";
    y: Uint8Array;
    /** Interleaved U,V pairs: `chromaStride` is 2 × `chromaWidth` bytes. */
    uv: Uint8Array;
}
export type ParsedFrame = ParsedI420Frame | ParsedNv12Frame;
export interface PreviewParseError {
    ok: false;
    reason: PreviewParseErrorReason;
    /** Numbers the reason alone does not carry, for the log line. */
    detail?: string;
}
export type PreviewParseResult = ParsedFrame | PreviewParseError;
/** Chroma plane dimensions for 4:2:0, which both supported formats are. */
export declare function chromaDimensions(width: number, height: number): {
    width: number;
    height: number;
};
/** Bytes a tightly packed I420 or NV12 frame occupies. Both layouts are the same size. */
export declare function packedPayloadBytes(width: number, height: number): number;
/**
 * Validate a frame and expose its planes.
 *
 * The plane fields are views onto `buffer`, so they stay valid only as long as the caller holds
 * that buffer and nothing else writes into it.
 */
export declare function parsePreviewFrame(buffer: ArrayBuffer): PreviewParseResult;
export {};
//# sourceMappingURL=protocol.d.ts.map