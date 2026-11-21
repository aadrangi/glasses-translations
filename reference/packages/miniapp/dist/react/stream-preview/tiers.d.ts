/**
 * Preview sizing tiers.
 *
 * The page measures its box (CSS pixels × devicePixelRatio, after rotation) and only tells the
 * host when the quantized tier changes, so a resize storm costs at most one reconfigure per tier.
 * The host quantizes again with the same table and is the authority; native never upscales.
 */
export interface PreviewTier {
    width: number;
    height: number;
    maxFps: number;
}
/** Smallest first. The last entry is the ceiling until measurements justify raising it. */
export declare const PREVIEW_TIERS: readonly PreviewTier[];
/**
 * The smallest tier that covers the box, capped at the ceiling. A zero-area box means the preview
 * is hidden and returns null.
 */
export declare function quantizePreviewTier(boxWidth: number, boxHeight: number): PreviewTier | null;
export declare function sameTier(a: PreviewTier | null, b: PreviewTier | null): boolean;
//# sourceMappingURL=tiers.d.ts.map