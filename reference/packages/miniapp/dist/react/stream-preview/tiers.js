/**
 * Preview sizing tiers.
 *
 * The page measures its box (CSS pixels × devicePixelRatio, after rotation) and only tells the
 * host when the quantized tier changes, so a resize storm costs at most one reconfigure per tier.
 * The host quantizes again with the same table and is the authority; native never upscales.
 */
/** Smallest first. The last entry is the ceiling until measurements justify raising it. */
export const PREVIEW_TIERS = [
    { width: 320, height: 180, maxFps: 15 },
    { width: 640, height: 360, maxFps: 15 },
];
/**
 * The smallest tier that covers the box, capped at the ceiling. A zero-area box means the preview
 * is hidden and returns null.
 */
export function quantizePreviewTier(boxWidth, boxHeight) {
    if (!(boxWidth > 0) || !(boxHeight > 0))
        return null;
    for (const tier of PREVIEW_TIERS) {
        if (tier.width >= boxWidth && tier.height >= boxHeight)
            return tier;
    }
    return PREVIEW_TIERS[PREVIEW_TIERS.length - 1];
}
export function sameTier(a, b) {
    if (a === b)
        return true;
    if (!a || !b)
        return false;
    return a.width === b.width && a.height === b.height && a.maxFps === b.maxFps;
}
//# sourceMappingURL=tiers.js.map