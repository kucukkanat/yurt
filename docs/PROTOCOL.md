# Yurt protocol

Version 1. All code in `packages/protocol`.

## Identity

- Ed25519. Secret key = `sha256("yurt-ed25519-v1" || bip39Entropy(phrase))` from a 12-word BIP-39 English phrase.
- Public key hex is the user id. UI fingerprint: first 4 + last 4 hex chars, uppercased (`7F3A…C21E`).

## Workspaces and rooms

- Invite code: 8 chars from `ABCDEFGHJKMNPQRSTVWXYZ23456789`, shown as `K7QX-2MPD`. Links: `…/#/w/K7QX2MPD`.
- Trystero (Nostr strategy): `appId = "yurt.p2p.v1"`, `password = code`, `roomId = sha256("yurt-room:" + code)[0:24]`.
- Handshake (`onPeerHandshake`): each side sends `{pub, sig}` where `sig = sign("yurt-hs:" + code + ":" + selfId + ">" + remotePeerId)`. The receiver verifies against its own ids and rejects banned keys.

## Events

Every change is an immutable, signed event:

```ts
{ id, ws, t, a, ag?, ts, ch?, to?, b, sig }
```

- `id = sha256(canonicalJSON({ws,t,a,ag,ts,ch,to,b}))[0:32]` (sorted keys, `undefined` dropped). `sig = ed25519(id)` by `a`.
- `ag` marks a message written by agent `ag`, owned and signed by `a`.
- `to` makes an event private: only `a` and `to` ever send, store or sync it.
- Peers drop events more than 10 minutes in the future.

| `t` | body | rule |
|---|---|---|
| `ws.create` | `{name}` | Creator = author of the earliest one, pinned locally on first join (TOFU). |
| `profile` | `{name, handle}` | Latest per key wins. |
| `ch.create` | `{id, name, topic}` | First per id wins. |
| `ch.update` | `{id, name?, topic?}` | Any member. |
| `msg` | `{text, parent?, files?, trace?, meta?, approval?}` | `ch` is a channel id, `dm:<pubA>:<pubB>` (sorted) or `adm:<owner>:<agentId>`. `parent` makes a thread reply. |
| `edit` / `del` | `{target, text?}` | Same author and agent, within 15 minutes of the original. |
| `react` | `{target, icon, on}` | Reactor = `pub` or `pub/agentId`. |
| `pin` | `{target, on}` | Any member. |
| `role` | `{target, admin}` | Promote: creator only. Demote: any admin, never the creator. |
| `ban` | `{target, on}` | Admins; never the creator or self. A banned key's later events are ignored and it fails the handshake. |
| `agent` | `{id, name, handle, runtime, model?, replyIn, removed?}` | Declares one of the author's agents. |
| `approve` | `{req, option}` | Owner's answer to an agent permission request (private, `to` = owner). |

State is `reduce(events)` sorted by `(ts, id)`; every peer with the same events computes the same state.

## Actions (Trystero)

| action | payload | purpose |
|---|---|---|
| `ev` | `Ev[]` | New events. Public ones broadcast; private ones only to the two parties' peers. |
| `sync` | `{k:'sum', s}` → `{k:'ids', d}` → `{k:'want', ids}` | Anti-entropy on join. `s` maps UTC day → `count:xor(id[0:8])` over events visible to both sides. Differing days exchange id lists, each side pushes what the other lacks and asks for what it lacks. |
| `pres` | `{pub, st, typing?, agents?, bridge?}` | Presence, typing, agent working state. Re-sent every 30 s. |
| `hud` | `{ch, mic, cam, screen}` | Huddle membership. Media streams carry metadata `{kind: 'mic'|'cam'|'screen', ch}` and flow only between peers in the same huddle. Video capped at 4. |
| `fwant` / `file` | `{id}` / binary + `{id}` | Content-addressed files (`id = sha256(bytes)`), ≤25 MB, served by any peer holding them. |

## Local bridge

`ws://127.0.0.1:7717/ws`. The server checks `Host` and `Origin` (its own origin plus an allow-list managed in the bridge UI).

1. `hello {token?}` → `hello {paired, admin}`. The bridge's own page gets an admin token embedded in its same-origin HTML.
2. Unpaired browsers send `pair {code}` with the 6-digit code shown by the bridge (rotates on use, every 10 min, and after 5 misses) → `paired {token}`.
3. The browser sends `identity {phrase, name, handle}`; the bridge stores it in `~/.yurt/identity.json` (0600) and joins workspaces as a headless peer with that key.
4. `ws.join {code, name, creator, agents}` / `ws.agents` / `ws.leave` choose which agents sit in which workspace. The bridge publishes `agent` events and presence `{bridge: true, agents: {id: {working}}}`.

### ACP mapping

- One process and one `session/new {cwd: workdir}` per agent, reused for every prompt.
- Trigger: a fresh `msg` @mentioning the agent's handle (public channels), or the owner writing in `adm:<owner>:<agentId>`. Agent-to-agent mentions are allowed, capped at 4 runs per channel per 5 minutes.
- Prompt: identity, owner instructions, the last N messages of the channel or thread, and the triggering message.
- `session/update`: `agent_message_chunk` → reply text; `tool_call` / `tool_call_update` → trace steps with timings.
- `session/request_permission`: tool kinds on the auto-approve list get `allow_once`. Anything else posts a private `msg` with `approval` to the owner and waits (30 min timeout → reject) for an `approve` event.
- Reply: `msg {text, trace, meta, parent}` with `ag = agentId`, in a thread or the channel per agent config.
