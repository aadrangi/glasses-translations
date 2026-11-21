# AGENTS.md — glasses-translations

Handover notes for AI agents and humans working in `~/glasses-translations`.
Read this before touching anything; then read `README.md` (goal + next steps)
and `docs/pipeline-map.md` (component-by-component reference).

## What this project is

Seed for a standalone, fully-offline iOS app: Even Realities **G1** smart
glasses show live translations of surrounding speech. No Mentra cloud, no
server. It is seeded from the MentraOS monorepo (Apache-2.0) because Mentra is
deprecating G1 support and Even Realities has abandoned the hardware — this
repo is the preservation + port.

Target phone: iPhone 17 Pro Max (iOS 26+, Apple Intelligence capable, so the
on-device `Translation` framework is available).

## Environment facts (this dev box)

- Linux (Ubuntu, x86_64). **No Swift, Xcode, or CocoaPods here.** The vendored
  iOS SDK cannot be compiled on this machine; do not try to "fix" that.
  Swift/Xcode work happens later on a Mac with Xcode 16+ and
  CocoaPods (`pod`/`xcodebuild` absent here is expected).
- Node v22.23.3 via nvm; `bun` v1.4.5 installed globally via npm
  (`~/.nvm/.../bin/bun`). Network is available.
- **This repo is fully self-contained.** Nothing in it reads from or resolves
  through any other checkout. Provenance is recorded in `UPSTREAM.md` as
  `github.com/Mentra-Community/MentraOS` @ `12683aa66a3c...`; a re-sync means
  cloning that repo fresh from GitHub into a temp dir and diffing — never
  wiring imports or file references to another working tree.
- The phone is paired via USB for Xcode installs only on the Mac; sideloading
  the finished app uses the $99/yr Apple Developer Program.

## Layout

```
README.md                  goal, planned pipeline, next steps
docs/pipeline-map.md       every component: reuse vs build, BLE details, gotchas
UPSTREAM.md                provenance + the canonical list of OUR modifications
vendor/bluetooth-sdk/      MentraBluetoothSDK iOS sources, G1-only after the
                           2026-11-20 pruning (G1 driver, G1Text text-wall,
                           sherpa-onnx STT, LC3 decoder, xcframework)
reference/                 Bun workspace: Mentra miniapp SDK + engine closure
  bun.lock, package.json   workspace root — bun install / bun run typecheck
  tsconfig.json            maps @mentra/* imports to packages/*/src (no dist build)
  packages/                @mentra/miniapp, bluetooth-sdk (TS), cloud-protocol
  engine/src/...           engine closure (G1/simulated/none profiles, STT
                           wiring, settings store), mirrors upstream paths
  translation-miniapp/     the original Translation miniapp (behavioral spec)
```

## Commands

Everything runnable in this checkout (all verified 2026-11-20):

```bash
cd ~/glasses-translations/reference
bun install          # resolves everything locally + fetches pinned third-party
bun run typecheck    # tsc 6 strict over engine + packages + miniapp; must stay clean
```

There is no lint config or CI yet, and no app target — the Xcode project has
not been created (that is next-step #1 in README.md). `vendor/.../ios/Tests/`
holds the surviving upstream XCTest files (G1 pairing/text-sanitizer, audio,
analytics, STT traits); the deleted-device tests were removed with their
drivers. They only run on a Mac — use them as executable spec, and expect to
prune a couple of cross-device cases there.

## Rules for working here

1. **`UPSTREAM.md` is the contract.** Anything under `vendor/` and
   `reference/packages/` / `reference/engine/` is upstream code; if you modify
   it, record the change there (format: date + what + why). The current
   modification list (driver pruning, podspec changes, workspace rewrites) is
   maintained there — keep it complete.
2. **G1 only — and it is enforced in code.** The other glasses drivers were
   deleted in the 2026-11-20 reduction: SGC factory in `DeviceManager.swift`
   instantiates only `G1()`, and the Mentra Live/AR99 camera, gallery, button,
   volume and OTA commands are stubs that throw `unsupported_device`. Do not
   re-add drivers, `UltraliteSDK`, or `SwiftProtobuf`. Remaining
   `DeviceTypes.G2`/`LIVE`/... mentions are inert string constants; a couple of
   public wrappers (`connectSimulated`, AR99 stubs) remain only to keep the
   Expo adapter compiling — runtime: logs/rejects.
3. **Typecheck must keep passing** (`bun run typecheck` in `reference/`, exit
   0). `@mentra/*` imports resolve through `reference/tsconfig.json` `paths` —
   never introduce the packages' unbuilt `dist/` expectations or a `baseUrl`
   (deprecated in TS 6; use `./`-prefixed path values).
4. **Do not re-add `prepare` scripts** to vendored packages; they invoke the
   expo toolchain and break `bun install`.
5. Vendored iOS code changes should be kept minimal and Mac-compilable; you
   cannot verify Swift compiles here — say so explicitly in your summary
   instead of claiming it builds.
6. `node_modules/` is gitignored; `reference/bun.lock` is committed. The
   53 MB `sherpa-onnx.xcframework` is committed on purpose (abandoned-hardware
   preservation) — never replace it with a download step.

## State of the tree after the 2026-11-20 reduction (findings)

**Swift side (`vendor/bluetooth-sdk`) — grep-verified only, NEVER compiled.**
There is no Swift toolchain here; the first Mac `xcodebuild`/`pod install` is
the acceptance check. If it complains about a deleted symbol, the fix pattern
is: delete the reference, or stub it to throw
`BluetoothSdkError(code: "unsupported_device", …)` — and log the edit in
`UPSTREAM.md`.

Deliberate leftovers, do not "fix" without reading this list:
- `DeviceManager` stubs throwing `unsupported_device`: AR99 OTA/factory-reset,
  gallery server/mode, touch-gesture defaults, button photo/video settings,
  camera FOV (+legacy/override) / tuning / warm-up, and the Mentra Live K900
  volume commands. `connectSimulated` and `cancelAr99Ota` log/reject only.
- The `MentraBluetoothSDK` public wrappers and the Expo adapter
  (`BluetoothSdkModule.swift`) still expose those stubbed APIs — kept so the
  adapter compiles; they reject at runtime.
- `ConnectOptions.enableTransportBridging` is now an inert option (was a
  Mentra Live transport bridge); `requiresAncs` likewise for G1.
- `SGCManager.sendGalleryMode()` (no args, protocol default no-op, G1 no-ops
  it) is a DIFFERENT member from the removed
  `sendGalleryMode(requestId:enabled:)` — not a leftover.
- Device name string enums (`DeviceModels.swift`, `Constants.swift`) and
  `GeneratedChangelogCatalog.swift` still mention removed devices: data only.
- The podspec's macOS `exclude_files` still lists deleted paths: CocoaPods
  treats non-matching filters as no-ops.
- Pod deps are now only `SWCompression ~> 4.8.0` + `onnxruntime-objc 1.18.0`
  (plus `ExpoModulesCore` solely under `MENTRA_BLUETOOTH_SDK_INCLUDE_EXPO_ADAPTER=1`).

**TS side (`reference/`):**
- The engine closure keeps the settings-store chain
  (`stores/settings` → `GlassesReadiness` → storage/mmkv) and the
  `simulated`/`none` capability profiles ON PURPOSE: they exist so the
  glasses-mic → native-recognizer wiring reference
  (`services/LocalSttFallbackCoordinator.ts`) typechecks, and `none`/
  `simulated` are the `hardware.ts` fallback profiles. They are reference, not
  features to port.
- Removed with typecheck kept green: `@mentra/miniapp-cli`,
  `translation-miniapp/build.ts`, TTS + wake-word model managers, and all
  non-G1 capability profiles (`types/hardware.ts` and
  `OfflineSpeechModelService.ts` were edited to match).

**Repo state:** branch `main`, local only — **no git remote is configured**;
ask before pushing anywhere. History: seed → reference workspace → AGENTS.md →
G1-only reduction.

## Domain facts worth knowing cold

- G1 BLE: Even's protocol rides Nordic UART UUIDs `6E400001/2/3-B5A3-F393-…`;
  scans for `Even G1_<n>_L_`/`_R_`, needs BOTH arms. The glasses accept only
  ONE BLE host — the Even Realities phone app must be uninstalled/disconnected.
- Glasses mic: LC3, 16 kHz, 20 ms frames (~20 bytes) delivered in 200-byte NUS
  slices of 10 frames (`didReceiveMicLc3`). Decode with
  `vendor/.../Packages/CoreObjC` (`lc3_cpp.h`).
- Display: 576 px wide, max 5 lines, green monochrome, text-wall command
  `0x4E` (~300 ms throttle), kinsoku + embedded-glyph sanitization required —
  see `docs/pipeline-map.md` and `reference/g1-character-support.md`.
- The ONLY missing piece upstream ever had is local translation; add it with
  Apple's `Translation` framework (`TranslationSession`, iOS 26). STT was
  cloud Soniox; local replacement is sherpa-onnx (per-language streaming
  models; URLs in `reference/engine/src/services/STTModelManager.ts`).
- No speaker on G1 — display output only. Screen-off use needs
  `UIBackgroundModes: bluetooth-central, audio`.

## Suggested next steps (order from README.md)

1. Mac: Xcode app target + Podfile referencing
   `vendor/bluetooth-sdk/ios/MentraBluetoothSDK.podspec` (pods: SWCompression
   ~>4.8.0, onnxruntime-objc 1.18.0). Treat the first `xcodebuild` as the
   verification step for the G1-only Swift pruning (UPSTREAM.md lists what was
   cut and where leftovers may hide).
2. Wire connect → `didReceiveMicLc3` → LC3 decode → sherpa-onnx → 
   `TranslationSession` → text-wall render.
3. Later: consider migrating the UI ideas from `reference/translation-miniapp`
   (language picker, display settings), which is the behavioral spec for the
   feature.
