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
- 2026-11-20: `reference/` workspace fixes (see `reference/README.md`):
  `@mentra/cloud-protocol` rewritten to `workspace:*`; `prepare` scripts
  stripped from the vendored package.json files.

| Local path | Upstream path |
| --- | --- |
| `vendor/bluetooth-sdk/ios/` | `mobile/modules/bluetooth-sdk/ios/` |
| `vendor/bluetooth-sdk/package.json` | `mobile/modules/bluetooth-sdk/package.json` |
| `reference/translation-miniapp/` | `miniapps/translation/` |
| `reference/engine/src/**` | `mobile/modules/engine/src/**` (33-file closure: display profiles, G1 capabilities, STT wiring, stores) |
| `reference/packages/miniapp/` | `mobile/modules/miniapp/` |
| `reference/packages/bluetooth-sdk/` | `mobile/modules/bluetooth-sdk/` (TS layer) |
| `reference/packages/miniapp-cli/` | `sdk/miniapp-cli/` |
| `reference/packages/cloud-protocol/` | `cloud-v2/packages/protocol/` |
| `reference/g1-character-support.md` | `notes/g1-character-support.md` |
