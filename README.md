# Yurt

Team chat that runs entirely in the browser. Workspaces, channels, DMs, threads, files and huddles travel directly between members over WebRTC ([Trystero](https://trystero.dev), Nostr signaling). There are no accounts and no server: you are an Ed25519 key, and a workspace is a signed event log that every member holds a copy of.

Optionally, `yurt-bridge` runs on your machine and brings your own coding agents (GitHub Copilot CLI, OpenCode, Codex, Claude Code, Pi) into rooms over the [Agent Client Protocol](https://agentclientprotocol.com).

```
apps/web            React + Vite app, deployed to GitHub Pages
packages/protocol   Events, signatures, reducer, sync, shared WorkspacePeer (web + bridge)
packages/ui         Agentic Design System components and tokens
packages/bridge     yurt-bridge: local agent host, headless peer, its own setup UI
docs/PROTOCOL.md    Wire formats and rules
e2e/                Playwright: two browsers, real P2P
```

## Two ways to carry a workspace

When you create a workspace you choose how its messages travel. The choice is fixed and travels with the invite link.

| | Live, peer to peer (Trystero) | Encrypted on Nostr relays |
|---|---|---|
| Where history lives | Only on members' devices | On relays, end-to-end encrypted |
| Messages arrive when nobody else is online | No, they sync when members overlap | Yes |
| Invite | Link (carries the workspace key) | Link (carries the workspace key) |
| Files | WebRTC, from members who are online | Encrypted on [Blossom](https://github.com/hzrd149/blossom) file servers |
| Voice and video | WebRTC | WebRTC, only if you turn it on in **Settings → Network** |

Invites are links only: the 8-character code is just an id, and a 256-bit key in the link's `#` fragment is what lets people in. Relays can't read Nostr workspaces: every event is sealed with that key, private messages get a second, pairwise key, and sizes and timestamps are blurred. Details and the threat model are in [docs/PROTOCOL.md](docs/PROTOCOL.md#nostr-transport). Set your own relays in **Settings → Network**.

## Run it

```sh
npm install
npm run dev          # http://localhost:5173
npm test             # protocol unit + integration tests (Vitest; local relay and real WebRTC, no network)
npm run e2e          # Playwright: P2P chat over public relays, encrypted relay history over a local relay
```

Open two browser profiles (or one normal + one private window), create a workspace in one and paste its invite link into the other.

## Deploy to GitHub Pages

1. Push to `main` on `kucukkanat/yurt`.
2. Repo **Settings → Pages → Source: GitHub Actions**.
3. `.github/workflows/pages.yml` tests, builds `apps/web` with base `/yurt/` and deploys. The site lands at `https://kucukkanat.github.io/yurt/`.

For a different repo name or a custom domain, set `YURT_BASE` (e.g. `/` for a custom domain) in the build step.

## Agents (optional)

```sh
npx yurt-bridge      # or: bunx yurt-bridge
```

That's the only terminal step. The bridge opens `http://127.0.0.1:7717`, where you install agent CLIs with one click, sign in to them, create agents (runtime, model, folder, instructions, what they may do without asking) and see live logs. Then in Yurt: **Add agents → enter the 6-digit code → pick agents for this workspace**.

- The bridge joins your workspaces as a headless peer using your key, so agents answer with the Yurt tab closed. Agent messages are signed by your key and carry an `agentId`; the UI shows them as "Priya's" agents.
- Agents reply when @mentioned, in a thread or in the channel (per agent), and in your private chat with them. They see the last N messages (per agent). Files attached to the message that triggers them are saved under `.yurt/files/` in the agent's folder so the agent can open them.
- Every tool call shows up in the room as an expandable trace. Tool kinds not on the agent's auto-approve list pause the run and ask you in your private chat with it, with a desktop notification.
- One ACP session per agent, kept alive across prompts.
- Config lives in `~/.yurt/` (JSON, written by the bridge UI; you never edit it).

Until `yurt-bridge` is published to npm, run it from the repo: `npm run bridge`. Publish with `npm publish -w packages/bridge` (the `prepublishOnly` script builds the UI and CLI).

### Runtime commands

The bridge launches each CLI's ACP mode. Adapters move fast, so check these against current docs before release (`packages/bridge/src/runtimes.ts`):

| Runtime | ACP command | Install |
|---|---|---|
| Copilot CLI | `copilot --acp` | `@github/copilot` |
| OpenCode | `opencode acp` | `opencode-ai` |
| Codex | `npx @zed-industries/codex-acp` | `@openai/codex` |
| Claude Code | `npx @zed-industries/claude-code-acp` | `@anthropic-ai/claude-code` |
| Pi | `npx pi-acp` | `@mariozechner/pi-coding-agent` |

## Things to know

- **Room size.** Every member connects to every other member. Designed for 2–10 people.
- **History** lives in IndexedDB and syncs from whoever is online when you join. If nobody is online, you wait.
- **Invite code = password.** The code derives the Trystero room id and encrypts signaling. Anyone with it can join and read history. Bans are signed by admins and enforced by every peer (banned keys fail the handshake and their new events are dropped).
- **DMs** are only ever sent to, stored by and synced between the two participants (and your own bridge, which shares your key).
- **Files** (≤25 MB) are content-addressed (SHA-256) and fetched from any peer that has them.
- **Huddles** are audio-first per channel, with video for up to 4 people and screen share.
- **TURN.** Defaults to the free Open Relay (rate-limited). Set your own under Settings → Network.
- **Browsers and the bridge.** Chrome may ask to allow access to devices on your local network the first time Yurt connects to `127.0.0.1:7717`. Safari may block `ws://127.0.0.1` from an https page; use Chrome, Edge, Firefox or Brave for agents.
- **Identity** is a 12-word recovery phrase. Enter it on another device to be the same person.
