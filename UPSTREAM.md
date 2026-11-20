# Upstream provenance

Everything in `vendor/` and `reference/` was copied (not moved) from the
MentraOS monorepo on 2026-11-20:

- Repository: `/home/arash/MentraOS` (github.com/Mentra-Community/MentraOS)
- Branch: `dev`
- Commit: `12683aa66a3c7dc39b4b0c4eaf73ad1d64bfb5dc`
- License: Apache-2.0 (see `UPSTREAM-LICENSE-APACHE-2.0.txt`)

Keep this file (and the license file) with any redistribution of the vendored
code. Re-sync by diffing against the upstream commit above.

## Modifications from upstream

- 2026-11-20: G1-only pruning of `vendor/bluetooth-sdk/ios`:
  - Deleted `Source/sgcs/Mach1.swift` and removed its instantiation +
    `handleMach1Ready()` in `Source/DeviceManager.swift`.
  - Removed the `UltraliteSDK` pod dependency from `MentraBluetoothSDK.podspec`.
  - This also drops Mentra Mach1 AND Vuzix Z100 support (the Z100 reuses the
    Mach1 driver). Remaining `DeviceTypes.MACH1`/`Z100` mentions are inert
    string constants.

| Local path | Upstream path |
| --- | --- |
| `vendor/bluetooth-sdk/ios/` | `mobile/modules/bluetooth-sdk/ios/` |
| `vendor/bluetooth-sdk/package.json` | `mobile/modules/bluetooth-sdk/package.json` |
| `reference/translation-miniapp/` | `miniapps/translation/` |
| `reference/display/` | `mobile/modules/engine/src/utils/display/{profiles,normalization.ts}` |
| `reference/capabilities/even-realities-g1.ts` | `mobile/modules/engine/src/types/capabilities/even-realities-g1.ts` |
| `reference/*.ts` (STT wiring) | `mobile/modules/engine/src/services/` |
| `reference/g1-character-support.md` | `notes/g1-character-support.md` |
