# AGENTS.md

Guidance for AI coding agents (and humans) working in this repo. Read it before changing code.

## What this is

Yurt is a peer-to-peer team chat with optional AI agents. A Bun monorepo:

| Path | Package | What |
|---|---|---|
| `packages/protocol` | `@yurt/protocol` | Events, reducer, crypto, invites, transports (Trystero WebRTC, encrypted Nostr relays), Blossom files, Valibot schemas |
| `packages/bridge` | `yurt-bridge` | Local CLI: runs agent CLIs over ACP, headless workspace peer, its own setup UI (`ui/src`) |
| `packages/ui` | `@yurt/ui` | Design system: JSX components + `.d.ts` types, tokens |
| `apps/web` | `@yurt/web` | The React app (Vite, zustand), deployed to GitHub Pages |
| `e2e` | | Playwright specs |

Protocol details: `docs/PROTOCOL.md`. Product overview: `README.md`.

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
CI (`.github/workflows/pages.yml`) runs `quality`, `test`, both builds, a bridge smoke start, then E2E against the
production build (`vite preview`), and deploys `main` to Pages.

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

**Git**
- Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`…). Work on `main` unless asked to branch.
- Commit or push only when asked. Pushing `main` deploys the web app.

## Gotchas

- Node needs the browser-like `ws` WebSocket: `import '@yurt/protocol/node-ws'` (the bridge and tests already do).
- Old peers drop `agent` events without `replyIn`; keep sending it alongside `respondTo`/`postIn`.
- Private channels: `dm:<a>:<b>`, `adm:<owner>:<agentId>`, `gdm:<member>:<owner>:<agentId>`; routing and sealing
  depend only on the `a`/`to` pair.
- Web browser tests share one origin (IndexedDB, store), so that project runs files one at a time.
- The service worker (`apps/web/src/sw.ts`) and its page glue (`lib/swClient.ts`) only exist in the built app: keep
  their decisions in `lib/swLogic.ts` (unit tested) and check the wiring in `e2e/pwa.spec.ts`.
- Don't press the invite Share button in tests: `navigator.share` brings headless Chromium down on macOS.
