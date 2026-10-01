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

Invites are links only: the 8-character code is just an id, and a 256-bit key in the link's `#` fragment is what lets people in. Relays can't read Nostr workspaces: every event is sealed with that key, private messages get a second, pairwise key, and sizes and timestamps are blurred. Details and the threat model are in [docs/PROTOCOL.md](docs/PROTOCOL.md#nostr-transport). **Settings** is one window, opened from the gear in the workspace rail (or <kbd>⌘/Ctrl ,</kbd>):

- **You**: profile, identity, preferences, **Connection** (this device only: TURN, and whether it joins voice and video calls in relay workspaces) and **Agents & bridge**.
- **The current workspace** (shown with its mode chip): **General** (mode, invite link, leave), **Network** (only its own mode: a peer-to-peer workspace's signaling, or a relay workspace's relays with live status and file servers) and **Agents**. The workspace menu jumps straight into these.

A workspace's network is chosen when it's created: after picking a mode, a collapsed *Network settings* row sets its signaling, or its relays and file servers, starting from what you used last. The mode is fixed after that; members need a signaling server or relay in common, and invite links carry the workspace's current list.

## Run it

```sh
bun install
bun run dev          # http://localhost:5173
bun run test         # protocol + bridge unit/integration tests (Vitest; local relay, Blossom server and real WebRTC, no network)
bun run e2e          # Playwright: P2P chat over public relays, relay workspaces over a local relay and Blossom server
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
- Per agent, tick what it answers (@mentions, replies to its messages, or both) and where it posts (in a thread, in the channel, or both: a thread reply that also shows in the channel). It always answers in your private chat with it. Agents see the last N messages (per agent). Files attached to the message that triggers them are saved under `.yurt/files/` in the agent's folder so the agent can open them.
- **Discoverable** agents can be found by other members (⌘K, the agent's profile) and messaged privately. Those chats run on your machine, so you can read them, and the sender is told so. Each member gets their own agent session. Agents that aren't discoverable can only be @mentioned in channels or replied to.
- Every tool call shows up in the room as an expandable trace. Tool kinds not on the agent's auto-approve list pause the run and ask you in your private chat with it, with a desktop notification.
- One ACP session per agent, kept alive across prompts.
- Config lives in `~/.yurt/` (JSON, written by the bridge UI; you never edit it).

Until `yurt-bridge` is published to npm, run it from the repo: `bun run bridge`. Publish with `npm publish -w packages/bridge` (the `prepublishOnly` script builds the UI and CLI).

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

- **Room size.** In peer-to-peer workspaces every member connects to every other member. Designed for 2–10 people.
- **History** lives in IndexedDB. Peer-to-peer workspaces sync it from whoever is online (if nobody is, you wait); relay workspaces fetch the whole encrypted history from relays, even when nobody else is online.
- **The invite link is the key.** Anyone holding it can join and read the full history, including messages from before they joined. Bans are signed by admins and enforced by every peer: all of a banned key's events are hidden and it's disconnected. In relay workspaces a ban also rotates the workspace key, so the removed member can't read anything new (they keep what they already had), and old invite links stop letting anyone into new conversations.
- **DMs** are sealed with a key only the two participants can derive (and your own bridge, which shares your key); other members, including later joiners, can't read them.
- **Files** (≤25 MB) are content-addressed (SHA-256): fetched from online peers in peer-to-peer workspaces, or from Blossom servers (sealed with a per-file key) in relay workspaces.
- **Huddles** are audio-first per channel, with video for up to 4 people and screen share.
- **Editing.** Your messages can be edited or deleted for 15 minutes; the Edit action shows the time left. After that it turns into a lock that explains why and offers to reply in the thread instead.
- **Tab icon.** The favicon reflects what's going on: a red count for unread mentions and DMs, a dot for other unread messages, a green ring while you're in a call, a green dot when a call is happening elsewhere, and greyed out when offline. It decorates whatever favicon the page declares, so replacing the icon keeps working.
- **TURN.** Off by default (a TURN operator sees who connects to whom). Opt into the free Open Relay or your own server under Settings → Network → WebRTC.
- **Browsers and the bridge.** Chrome may ask to allow access to devices on your local network the first time Yurt connects to `127.0.0.1:7717`. Safari may block `ws://127.0.0.1` from an https page; use Chrome, Edge, Firefox or Brave for agents.
- **Identity** is a 12-word recovery phrase. Enter it on another device to be the same person.
