# Pipeline map: MentraOS translation stack (as of 2026-11-20)

What each piece of the Translation feature does, and what a standalone local
iOS app must reuse or replace.

## Today's path (cloud translation)

```
G1 left+right arm (BLE, Nordic UART Service UUIDs 6E400001/2/3-B5A3-F393-E0A9-E50E24DCCA9E)
  └─ sgcs/G1.swift            pair as "Even G1_<n>_L_/_R_", heartbeat, battery,
  └─ sgcs/G1Text.swift         text-wall (cmd 0x4E), sanitizer
  └─ mic: LC3 16 kHz frames in 200-byte slices (10x 20 ms) -> didReceiveMicLc3
       └─ Packages/CoreObjC/lc3_cpp.h decodes LC3 -> PCM (also used for phone mic)
Mentra App (React Native host)
  ├─ engine TranslationModule -> cloud-v2 websocket /ws/session + UDP audio
  └─ Soniox (cloud) does STT + one-way translation; results streamed back
       └─ engine DisplayProcessor + profiles/g1.ts wraps text to 576 px x 5 lines
            └─ G1Text text-wall command to the glasses
```

## Standalone local app (goal)

| Stage | Reuse | Notes |
| --- | --- | --- |
| Pair/own the G1 | `vendor/.../ios/Source/sgcs/G1.swift` | G1 accepts ONE BLE peer; quit Even Realities app first |
| Mic frames | `didReceiveMicLc3` event (`events/BluetoothEvents.swift`) | 20 ms LC3 frames, 16 kHz |
| LC3 -> PCM | `Packages/CoreObjC` (`lc3_cpp.h`) | already compiled into the pod |
| Speech -> text | `Source/stt/SherpaOnnxTranscriber.swift` + vendored `Packages/SherpaOnnx/sherpa-onnx.xcframework` | streaming zipformer models from https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/ (see `reference/STTModelManager.ts` for the URL list + a vosk HF model). Per-language models; add a language detector or let the user pick. |
| VAD (optional) | `Source/stt/SileroSpeechActivity.swift` + `Resources/SileroVad/silero_vad.onnx` | speech gating |
| Text -> translated text | **NEW — nothing in-repo.** Use Apple `Translation` framework (iOS 26, on-device, iPhone 17 Pro Max qualifies) or bundle CTranslate2/Argos | the only genuinely missing piece |
| Layout for G1 display | `Source/utils/G1Text.swift` (+ `reference/display/` TS profiles as the spec: 576 px, 5 lines, glyph widths, kinsoku) | native Swift path already embeds the metrics |
| Render | `G1.displayTextWall(...)` (cmd 0x4E), ~300 ms throttle | |

## CocoaPods surface (from MentraBluetoothSDK.podspec)

- Deps: `SWCompression ~> 4.8.0`, `SwiftProtobuf ~> 1.0`, `onnxruntime-objc 1.18.0`
- Mach1/Vuzix Z100 driver and the `UltraliteSDK` dep have been removed from
  this vendored copy (see `UPSTREAM.md`); upstream has them.
- Vendored: `Packages/SherpaOnnx/sherpa-onnx.xcframework` (53 MB)
- Resources: SileroVad model; `Resources/NimoFirmware` only needed for NIMO
  glasses — can drop.
- Other `Source/sgcs/*.swift` drivers (G2, MentraLive, Nex, Ar99, ...)
  can also be deleted for a G1-only build; `DeviceManager`/`SGCFactory` reference
  them, so prune carefully or keep them.

## Background operation

The Mentra App keeps BLE + mic alive with `UIBackgroundModes:
bluetooth-central, audio` (see `mobile/app.config.ts` upstream). A standalone
app needs the same modes to translate with the screen off.

## Gotchas

- G1 text sanitizer / embedded glyph set: unsupported characters must be
  mapped before send — see `reference/g1-character-support.md` and
  `Source/sgcs/G1TextSanitizer.swift`.
- Mic policy: glasses mic vs phone mic fallback — `reference/LocalSttFallbackCoordinator.ts`
  shows how the engine feeds PCM into the native recognizer.
- The G1 has no speaker; output is display-only.
- LC3 frame size differs per glasses (G1 = 20 ms, G2 = 40 ms).
