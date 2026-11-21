export function getCapsuleHeaderPaddingRight(capsuleMenu, viewportWidth, safeAreaRight, rightGap) {
    const capsuleOffsetFromContentRight = viewportWidth - capsuleMenu.left - safeAreaRight;
    return Math.max(rightGap, capsuleOffsetFromContentRight + rightGap);
}
//# sourceMappingURL=capsuleHeaderLayout.js.map