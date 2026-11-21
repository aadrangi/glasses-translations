# Upstream provenance

Everything in `vendor/` and `reference/` was copied (not moved) from the
MentraOS monorepo on 2026-11-20:

- Upstream repository: <https://github.com/Mentra-Community/MentraOS>
- Branch: `dev`
- Commit: `12683aa66a3c7dc39b4b0c4eaf73ad1d64bfb5dc`
- License: Apache-2.0 (see `UPSTREAM-LICENSE-APACHE-2.0.txt`)

This repository has **no dependency on any local MentraOS checkout** — every
needed file lives here. To re-sync later, clone the upstream URL above at the
recorded commit into a temporary directory and diff against these copies.

Keep this file (and the license file) with any redistribution of the vendored
code.

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
- 2026-11-20: G1-only + translation-only reduction of this repo:
  - `vendor/.../Source/sgcs/`: deleted the G2, Mentra Live, Mentra Nex, NIMO,
    AR99, Simulated, Frame and Vuzix drivers plus their support files
    (`G2Text`, `GlassesAudioSetupPolicy`, pairing/L2CAP/canvas/OTA state,
    `mentraos_ble.pb.swift`); deleted `controllers/R1.swift`,
    `Resources/NimoFirmware/`, and `Tests/` cases for removed classes.
  - `DeviceManager.swift`: SGC factory is G1-only; camera/gallery/button/AR99
    commands are kept as stubs that throw `unsupported_device` so the public
    API and the Expo adapter keep compiling.
  - `MentraBluetoothSDK.podspec`: dropped `SwiftProtobuf` and the NIMO firmware
    resource bundle (plus `UltraliteSDK` earlier). Remaining pod deps:
    `SWCompression`, `onnxruntime-objc`.
  - `reference/`: removed the `@mentra/miniapp-cli` package,
    `translation-miniapp/build.ts`, TTS/wake-word managers, and non-G1
    capability profiles; edited `types/hardware.ts` and
    `OfflineSpeechModelService.ts` to match. `bun run typecheck` verified.
  - NOT VERIFIED: Swift compilation (no toolchain on the Linux dev box).
    First Xcode build on a Mac may surface leftover references; fix pattern is
    the same stub-or-remove treatment used above.

| Local path | Upstream path |
| --- | --- |
| `vendor/bluetooth-sdk/ios/` | `mobile/modules/bluetooth-sdk/ios/` |
| `vendor/bluetooth-sdk/package.json` | `mobile/modules/bluetooth-sdk/package.json` |
| `reference/translation-miniapp/` | `miniapps/translation/` |
| `reference/engine/src/**` | `mobile/modules/engine/src/**` (33-file closure: display profiles, G1 capabilities, STT wiring, stores) |
| `reference/packages/miniapp/` | `mobile/modules/miniapp/` |
| `reference/packages/bluetooth-sdk/` | `mobile/modules/bluetooth-sdk/` (TS layer) |
| `reference/packages/cloud-protocol/` | `cloud-v2/packages/protocol/` |
| `reference/g1-character-support.md` | `notes/g1-character-support.md` |
