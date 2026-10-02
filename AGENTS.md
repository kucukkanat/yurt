# AGENTS.md

Guidance for AI coding agents (and humans) working in this repo. Read it before changing code.

## What this is

Yurt is a serverless, end-to-end encrypted team chat with optional AI agents. A Bun monorepo:

| Path | Package | What |
|---|---|---|
| `packages/protocol` | `@yurt/protocol` | Events, reducer, collaboration (tasks, polls, Yjs docs and boards: `collab.ts`), crypto, invites, the encrypted Nostr relay transport, Blossom files, WebRTC call rooms (Trystero), Valibot schemas |
| `packages/bridge` | `yurt-bridge` | Local CLI: runs agent CLIs over ACP, gives them Yurt tools over MCP (`mcp.ts`), headless workspace peer, its own setup UI (`ui/src`) |
| `packages/ui` | `@yurt/ui` | Design system: JSX components + `.d.ts` types, tokens |
| `apps/web` | `@yurt/web` | The React app (Vite, zustand), deployed to GitHub Pages |
| `e2e` | | Playwright specs |
| `.claude/skills/native-web-app` | | Generic agent skill: making any web app/PWA feel native (references + starter templates). Not built or linted here (excluded in `biome.json`, `knip.json`, `.jscpd.json`) |

Protocol details: `docs/PROTOCOL.md`. Product overview: `README.md`. Web Push options (design note, not built):
`docs/PUSH.md`.

Every workspace is a Nostr relay workspace: events and presence go over its relays, files over Blossom. WebRTC
(Trystero, signaled over the workspace's relays) is only for calls: voice, video and screen sharing. The bridge never
uses WebRTC.

## Commands

```sh
bun install
bun run dev            # web app on http://localhost:5173
bun run bridge         # build the bridge UI and run the bridge from source
bun run test           # unit + integration tests, all packages, with coverage gates
bun run e2e            # Playwright against the production build (service worker included), desktop + phone projects
bun run quality        # typecheck (incl. tests and e2e) + Knip + jscpd + Biome (warnings fail)
bun run format         # apply Biome formatting
bun run build && bun run bridge:build
```

Per package: `cd <pkg> && bunx vitest run [file]`; web projects: `bunx vitest run --project unit|browser`.
CI (`.github/workflows/pages.yml`) runs, in parallel jobs: `quality` + both builds + a bridge smoke start; each
package's tests (the web suite split across three machines by `test/sequencer.ts`, then merged with its coverage
gate); and E2E against the production build (`vite preview`). It deploys `main` to
Pages once the build and tests pass. Shared setup (Bun, Node, cached Chromium) is `.github/actions/setup`.

## Rules

**Code**
- TypeScript, maximum strictness (see `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, …). No `any`, no non-null `!`, no casts that lie.
- Everything from outside the process is `unknown` until a Valibot schema accepts it: network events, presence,
  call metadata, agent (ACP) output, bridge ↔ browser messages, files on disk, IndexedDB, URLs. Reuse the schemas
  exported by `@yurt/protocol` (`parseBody`, `parseOr`, `PresenceSchema`, …) before writing new ones.
- The reducer is lenient per field: a malformed field is dropped, one bad event never aborts the reduction.
- Functional and immutable where practical; fewest clear lines; comment the *why*, not the *what*.
- Styling uses design tokens; UI elements get `data-testid`s.
- Biome is the linter/formatter. Suppressions need a specific reason: `// biome-ignore lint/<rule>: <why>`.

**Tests**
- No mocks. Tests use real things: the local Nostr relay and Blossom server (`packages/protocol/test`), real
  WorkspacePeers, the fake ACP agent (`packages/bridge/test/fixtures/fake-acp.mjs`, a real tiny agent), real
  Chromium via Vitest browser mode for components.
- Coverage gates in each `vitest.config.ts`: protocol and bridge 100% on every metric; web at measured floors that
  may only go up. Prefer deleting unreachable branches over ignore comments; any ignore needs a reason comment.
- Fuzz tests (fast-check) use a fixed seed so failures reproduce.
- Shared helpers live in `packages/protocol/test/util.ts`, `packages/bridge/test/helpers.ts`, `e2e/helpers.ts`.
  E2E pages run axe + html-validate through `checkPage()`.
- Unit/integration (`bun run test`) and E2E (`bun run e2e`) stay separate commands.
- **Huddles (calls): no E2E or browser tests that use the camera, video, screen sharing or microphone.** Unit test
  what can be tested without media (pure helpers, state, rules such as the video cap). Don't add media tests to
  close the call UI's coverage gap; that gap is accepted.
- Mutation testing (Stryker) was tried and removed: too slow. Don't reintroduce it.

**Docs**
- Every change updates the docs it affects in the same commit: `README.md` (what users see), `docs/PROTOCOL.md` (wire
  formats, rules, threat model) and this file (layout, rules, gotchas). Stale docs count as a bug.

**Git**
- Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`…). Work on `main` unless asked to branch.
- Commit or push only when asked. Pushing `main` deploys the web app.

## Gotchas

- Node needs the browser-like `ws` WebSocket: `import '@yurt/protocol/node-ws'` (the bridge and tests already do).
- Old peers drop `agent` events without `replyIn`; keep sending it alongside `respondTo`/`postIn`.
- Collaboration features are plain events (and presence fields): they must work without the bridge. Agents reach them only
  through the bridge's MCP tools, which publish the same events as the UI.
- A poll or meeting `msg` repeats its question or title in `text` for older apps; keep it.
- Private channels: `dm:<a>:<b>`, `adm:<owner>:<agentId>`, `gdm:<member>:<owner>:<agentId>`; routing and sealing
  depend only on the `a`/`to` pair.
- Web browser tests share one origin (IndexedDB, store), so that project runs files one at a time.
- The service worker (`apps/web/src/sw.ts`) and its page glue (`lib/swClient.ts`) only exist in the built app: keep
  their decisions in `lib/swLogic.ts` (unit tested) and check the wiring in `e2e/pwa.spec.ts`.
- The npm `yurt-bridge` bundles `@yurt/protocol` and `@yurt/ui`: source changes in any of the three need a bridge
  release. See `packages/bridge/AGENTS.md`.
- Don't press the invite Share button in tests: `navigator.share` brings headless Chromium down on macOS.
- iOS zooms into focused fields under 16px. `packages/ui/tokens/base.css` forces 16px on fields for coarse pointers and
  disables double-tap zoom (`touch-action: manipulation`); don't "fix" it with `maximum-scale` in the viewport (that
  blocks pinch zoom and fails axe).
- The iOS keyboard pans the page instead of resizing it. `lib/viewport.ts` (`viewportVars`, unit tested) sizes and
  moves the app to the visible area only while a keyboard is up (`--app-height`, `--app-top`, `--safe-bottom: 0`);
  otherwise CSS `100%` stands, because an installed iOS app's visual viewport can be short by the status bar.
