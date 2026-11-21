# reference/ — importable Mentra reference code

Self-contained Bun workspace. The `@mentra/*` packages that upstream resolves
through the MentraOS monorepo are vendored here under `packages/`, and
`tsconfig.json` `paths` maps every `@mentra/*` import straight to the vendored
`src/` (no `dist/` build needed).

```
engine/src/...                transitive closure of the engine files we care
                              about (G1 capabilities, display profiles,
                              on-device STT wiring, settings store) — paths
                              mirror upstream mobile/modules/engine/src/...
packages/miniapp/             @mentra/miniapp — miniapp SDK (session, display,
                              translation modules; what the Translation app calls)
packages/bluetooth-sdk/       @mentra/bluetooth-sdk — TS layer over the native
                              iOS SDK in ../vendor/bluetooth-sdk/ios
packages/miniapp-cli/         @mentra/miniapp-cli — build/pack tooling
packages/cloud-protocol/      @mentra/cloud-protocol — shared wire types
translation-miniapp/          the Translation miniapp itself
```

## Usage

```bash
bun install        # links workspace packages + fetches third-party deps
bun run typecheck  # tsc across engine, packages, and the miniapp
```

Modifications vs upstream (see also ../UPSTREAM.md):
- `@mentra/cloud-protocol` dep rewritten to `workspace:*` in the two packages
  that depend on it, so bun links the vendored copy instead of fetching from
  npm.
- `prepare` build scripts removed from the vendored package.json files (they
  invoke the expo-module toolchain to build `dist/`; unnecessary here since
  `tsconfig.json` maps every `@mentra/*` import straight to `src/`).
- `@mentra/bluetooth-sdk/internal` maps to `src/_internal.ts` in tsconfig,
  mirroring the package's `exports` map.

Verified 2026-11-20: `bun install && bun run typecheck` passes clean
(TypeScript ^6.0.2, strict — the same compiler the MentraOS root pins).

Third-party deps (react, react-native, zustand, ...) are declared, not vendored;
`bun install` fetches them (versions pinned to what MentraOS used at the
vendored commit).
