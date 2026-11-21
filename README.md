# glasses-translations

Standalone-project seed for an iPhone app that translates speech locally onto
Even Realities G1 glasses — no Mentra cloud, no server.

- `AGENTS.md` — handover notes for the next agent session (environment,
  commands, rules). Read it first if you are an agent.
- `UPSTREAM.md` — provenance (MentraOS commit, Apache-2.0) + re-sync notes
- `docs/pipeline-map.md` — what every component does and what to reuse vs build
- `vendor/bluetooth-sdk/` — Mentra Bluetooth SDK iOS sources: the G1 BLE driver
  (`sgcs/G1.swift`), text-wall renderer (`utils/G1Text.swift`), on-device
  sherpa-onnx STT (`Source/stt/`), LC3 decoder (`Packages/CoreObjC`), vendored
  `sherpa-onnx.xcframework`. Podspec: `vendor/bluetooth-sdk/ios/MentraBluetoothSDK.podspec`
- `reference/` — importable Bun workspace: the Translation miniapp, the
  `@mentra/miniapp` / `@mentra/bluetooth-sdk` / `@mentra/miniapp-cli` /
  `@mentra/cloud-protocol` packages, and the engine files (G1 display profiles,
  capabilities, on-device STT wiring). All `@mentra/*` imports resolve locally:
  `cd reference && bun install && bun run typecheck` passes clean.

## Planned pipeline

G1 mic (BLE LC3) → decode → sherpa-onnx STT → Apple `Translation` framework
(iOS 26, on-device) → `G1Text` text-wall → glasses display.

The only component that does not exist upstream is the translation step;
everything else is vendored here.

## Next steps

1. New Xcode app target + CocoaPods pointing at `vendor/bluetooth-sdk/ios`
   (see podspec deps in `docs/pipeline-map.md`; drop `UltraliteSDK`/Mach1).
2. Use `MentraBluetoothSDK` publicly: scan/connect, subscribe `didReceiveMicLc3`,
   render via the display/text-wall API.
3. Download a sherpa-onnx streaming model (URLs in
   `reference/engine/src/services/STTModelManager.ts`)
   and feed decoded PCM into the recognizer.
4. Add `TranslationSession` (Apple Translation framework) between STT and display.
5. Enable `bluetooth-central` + `audio` background modes for screen-off use.
6. Sign for your device with the Apple Developer Program ($99/yr).
