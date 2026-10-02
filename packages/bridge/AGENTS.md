# AGENTS.md — yurt-bridge

Read the root `AGENTS.md` first; this file only adds what is specific to publishing the bridge.

## Why the npm release drifts

`yurt-bridge` is published to npm, but `@yurt/protocol` and `@yurt/ui` are devDependencies that tsup and Vite
**bundle into `dist`**. A fix in `packages/protocol` or `packages/ui` therefore changes what users run, even when
nothing under `packages/bridge` changed. `git log -- packages/bridge` alone will not show it.

## Rule

Any commit that changes `packages/bridge`, `packages/protocol` or `packages/ui` source (not tests, docs or CI)
ships in a bridge release. Bump `version` in `package.json` (semver: `fix` → patch, `feat` → minor, breaking →
major) and publish once the local gate is green (`bun run quality && bun run test && bun run build &&
bun run bridge:build && bun run e2e`).

## Checking for drift

Diff the published bundle against a fresh build; any difference means a release is due:

```sh
cd packages/bridge
npm view yurt-bridge version                       # what npm has
npm pack yurt-bridge@latest --pack-destination /tmp/yb && tar -xzf /tmp/yb/yurt-bridge-*.tgz -C /tmp/yb
bun run build && diff -r /tmp/yb/package/dist dist  # empty output: no drift
git log --oneline --since="$(npm view yurt-bridge time.modified)" -- . ../protocol ../ui
```

## Releasing

```sh
cd packages/bridge
npm pkg set version=<next>
npm publish                                        # prepublishOnly builds the UI and the CLI
git commit -am "chore(bridge): release <next>" && git push
```

Publish only from a clean `main` whose gate passed, so the tarball matches a pushed commit.
