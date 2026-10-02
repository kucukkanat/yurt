# Yurt protocol

Version 1. All code in `packages/protocol`.

## Identity

- Ed25519. Secret key = `sha256("yurt-ed25519-v1" || bip39Entropy(phrase))` from a 12-word BIP-39 English phrase.
- Public key hex is the user id. UI fingerprint: first 4 + last 4 hex chars, uppercased (`7F3A…C21E`).

## Workspaces and rooms

- Workspace id: 8 chars from `ABCDEFGHJKMNPQRSTVWXYZ23456789`, shown as `K7QX-2MPD`. It is **not a secret** and can't be used to join.
- Workspace key `wk`: 32 random bytes made at creation. Every secret below derives from it (see [Keys](#keys)).
- Each workspace has a **transport**, chosen at creation and fixed: `trystero` (events travel peer to peer; history lives only on members' devices) or `nostr` (events are end-to-end encrypted and stored on relays; see [Nostr transport](#nostr-transport)).
- Invites are links only: `…/#/w/<id>/k/<key>[/s/<method>,<urls>]` (Trystero) or `…/#/w/<id>/k/<key>/n/<relays>` (Nostr), optionally followed by `/o/<creator pub>`. `<key>` is `wk` in base64url; `<relays>` is a URI-encoded comma list, or `-` for the defaults (`wss://nos.lol`). Links without a valid key, or with an unknown signaling method, are refused.
- `/s/` is a Trystero workspace's **signaling**: how members find each other. `<method>` is `nostr` (Nostr relays) or `torrent` (WebSocket BitTorrent trackers), followed by optional server URLs (none = the strategy's built-in public servers). New workspaces default to `nostr,wss://nos.lol`; absent means `nostr` with Trystero's built-in relays (older links). Members only meet over the same method and a shared server, so it belongs to the workspace, not to each member.
- `/o/` pins the creator: joiners take the creator from the link instead of trusting the first `ws.create` they see, so a forged or backdated `ws.create` can't make someone else the creator. Links without it fall back to trust on first use.
- The key lives only in the `#` fragment, which browsers never send to a server. On load the app keeps the invite in memory and removes it from the address bar and history (`history.replaceState`), so it can't end up in synced browser history.
- WebRTC room (Trystero, using the workspace's signaling; relay workspaces signal calls over their own relays): `appId = HKDF(wk, "app")`, `roomId = HKDF(wk, "room")`, `password = HKDF(wk, "room-pw")`. Nothing in the signaling identifies the app or the workspace, and the room can't be found or joined without the key.
- **Legacy workspaces** (created before keys) have only the code: `appId = "yurt.p2p.v1"`, `password = code`, `roomId = sha256("yurt-room:" + code)[0:24]`. That's brute-forceable from public relay traffic (~39 bits), so they keep working for existing members but can't be joined anew; the app asks members to recreate them.
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
| `ws.create` | `{name}` | Creator = the pubkey pinned by the invite link (`/o/`), else the author of the earliest one, pinned on first join. |
| `profile` | `{name, handle}` | Latest per key wins. |
| `ch.create` | `{id, name, topic}` | First per id wins. |
| `ch.update` | `{id, name?, topic?}` | Any member. |
| `msg` | `{text, parent?, alsoInChannel?, files?, trace?, meta?, approval?, poll?, meet?}` | `ch` is a channel id, `dm:<pubA>:<pubB>` (sorted), `adm:<owner>:<agentId>` (an owner and their agent) or `gdm:<member>:<owner>:<agentId>` (a member and someone else's agent). `parent` makes a thread reply; `alsoInChannel: true` on a thread reply also lists it in the channel. |
| `edit` / `del` | `{target, text?}` | Same author and agent, not before the original. The 15-minute edit window is advisory: authors choose `ts`, so only honest clients can enforce it. |
| `react` | `{target, icon, on}` | Reactor = `pub` or `pub/agentId`. |
| `pin` | `{target, on}` | Any member. |
| `role` | `{target, admin}` | Promote: creator only. Demote: the creator demotes admins; never the creator. |
| `ban` | `{target, on}` | Admins ban non-admins; only the creator bans an admin; never the creator or self. **All** of a banned key's events are ignored whatever their timestamps (so backdating can't slip past a ban), connected peers are dropped, and it fails the handshake. Un-ban restores them. |
| `agent` | `{id, name, handle, runtime, model?, replyIn, respondTo?, postIn?, discoverable?, removed?}` | Declares one of the author's agents. `respondTo {mentions, replies}`: what triggers it. `postIn {thread, channel}`: where it answers (both = a thread reply also in the channel). `discoverable`: other members may DM it. `replyIn` (`'thread'` when `postIn.thread`, else `'channel'`) is kept for older peers, which drop agent events without it; when the newer fields are missing or malformed they are derived from it (mentions on, replies off, not discoverable). |
| `approve` | `{req, option}` | Owner's answer to an agent permission request (private, `to` = owner). |
| `rekey` | `{epoch, keys, history}` | Relay workspaces: replaces the workspace key (see [Key rotation](#key-rotation)). Counts when its author has ever been made an admin (or is the creator) and isn't banned; the earliest `(ts, id)` wins an epoch. |
| `task` | `{id, title, ch, src?, assignee?, due?}` | First per id wins; `ch` must be a channel. `assignee` is an actor: `pub`, or `pub/agentId` for an agent. `src` is the message it was made from. |
| `task.set` | `{id, title?, assignee?, due?, status?, note?}` | Any member or agent. `status` ∈ `open`, `doing`, `blocked`, `done`; `assignee: null` / `due: null` clear them. Every change (and its `note`) is kept as the task's activity. |
| `vote` | `{target, choices}` | On a `msg` with `poll`. Latest per actor wins; an empty list takes the vote back; one choice unless `poll.multi`. Votes with `ts ≥ poll.closes` don't count. |
| `rsvp` | `{target, going}` | On a `msg` with `meet`; `going` ∈ `yes`, `no`, `maybe`. Latest per actor wins. |
| `decide` | `{target, text, on}` | Marks a message as a decision (`text`, or the message's text when empty), or takes that back. |
| `doc` | `{id, title, ch, kind}` | A shared doc (`kind: 'text'`) or board (`'board'`) in a channel. First per id wins. |
| `doc.set` | `{id, title?, archived?}` | Rename or archive. An archived doc takes no more ops or suggestions. |
| `doc.op` | `{doc, u}` | A [Yjs](https://yjs.dev) update (base64url, ≤ 256 KiB). A doc's content is all its ops merged; Yjs merges them the same in any order. Text docs are one `Y.Text` (`text`); boards a `Y.Map` (`notes`) of `{text, x, y, color, by}`, each checked when read. |
| `suggest` | `{doc, find, replace, note?}` | A proposed change to a text doc: replace the first `find` (empty: append). The event id is the suggestion's id. |
| `suggest.res` | `{target, accept}` | Accepts or rejects an open suggestion. People only (no `ag`): an agent can't accept its own. Accepting clients also send the `doc.op` that applies it. |
| `save` | `{target, on}` | A message saved for later. Only counts with `to` = the author and no `ch`: it reaches only the author's own devices (and bridge). |
| `read` | `{ch, ts}` | Read up to `ts` in `ch`, for the author's other devices (`to` = author). The latest `ts` wins. |

A `msg` can carry a **poll** `{q, options (2–10), multi?, closes?}` or a **meeting** `{title, at, dur?}` (minutes); its `text` repeats the question or title for apps that predate them. `vote`, `rsvp` and `decide` on a message in a private conversation must be addressed like it (`to`, between the same two keys), so they never reach the rest of the workspace. Changes (`task.set`, `vote`, `rsvp`, `decide`, `doc.*`, `suggest*`) are applied after everything else, in `(ts, id)` order, so a change whose author's clock was behind its target still lands. Peers that predate these types reject them as unknown, so they just don't see them.

State is `reduce(events)`: roles and bans are computed first, then the remaining events are applied in `(ts, id)` order, skipping banned authors. Every peer with the same events computes the same state. Events must be well formed (string fields, integer `ts`, known `t`) and bodies are treated as untrusted: a malformed field is ignored, and no single event can abort the reduction. Messages in `dm:`/`adm:` channels must be addressed (`to`) to the other party and written by one of them; approvals count only from the owner (no `ag`). In `gdm:<member>:<owner>:<agentId>` the member writes to the owner (no `ag`) and the owner writes only as that agent (`ag = agentId`) to the member; member and owner must differ, and approvals are dropped. Transports route and seal it like a DM between member and owner, so other members never receive it. Whether an agent is discoverable is enforced by the bridge (it doesn't answer otherwise) and the UI, not the reducer, so history survives a settings change.

## Actions (Trystero)

**Transports don't mix.** Trystero workspaces use this WebRTC room for everything. Nostr workspaces use Nostr for everything (events, presence, files via [Blossom](#files-on-blossom)); only `hud` and media streams may use a WebRTC room, and only if the user turned on *Allow WebRTC for voice and video* in Settings → Network. Without that opt-in a Nostr workspace has no WebRTC room at all, and neither does the bridge.

| action | payload | purpose |
|---|---|---|
| `ev` | `Ev[]` | New events. Public ones broadcast; private ones only to the two parties' peers. |
| `sync` | `{k:'sum', s}` → `{k:'ids', d}` → `{k:'want', ids}` | Anti-entropy on join. `s` maps UTC day → `count:xor(id[0:8])` over events visible to both sides. Differing days exchange id lists, each side pushes what the other lacks and asks for what it lacks. |
| `pres` | `{pub, st, typing?, agents?, bridge?, rtc?, view?, focus?, cur?}` | Presence, typing, agent working state (`agents: {id: {working, on?}}`, `on` = `task:<id>` or `doc:<id>`), what the member is looking at (`view`: a channel id, `thread:<msgId>` or `doc:<id>`; others can follow it), focus mode, and the caret's line in a doc (`cur {doc, line}`). Re-sent every 30 s. |
| `hud` | `{ch, mic, cam, screen}` | Huddle membership. Media streams carry metadata `{kind: 'mic'|'cam'|'screen', ch}` and flow only between peers in the same huddle. Video capped at 4. |
| `fwant` / `file` | `{id}` / binary + `{id}` | Trystero workspaces only. Content-addressed files (`id = sha256(bytes)`), ≤25 MB. A file is requested from, and served only to, peers who can see a `msg` that attaches it, so DM files stay within the pair even if a member asks directly. Pending requests are re-sent as peers join, for up to a minute. |

## Nostr transport

Relays store and forward; they never see plaintext, member keys or the invite code.

### Keys

With `HKDF-SHA256(ikm = wk, info = "yurt-<name>-v1")`:

| name | bytes | use |
|---|---|---|
| `enc` | 32 | XChaCha20-Poly1305 key for everything members share |
| `tag` | 16 (hex) | relay index tag for the workspace |
| `inbox:<pub>` | 16 (hex) | a member's mailbox tag for private events |
| `app` / `room` / `room-pw` | 16 / 12 / 32 (hex) | WebRTC app id / room id / password (both transports) |

A private pair's key is `HKDF(ikm = X25519(edToMontgomery(mySec), edToMontgomery(theirPub)), salt = wk, info = "yurt-dm-v1")`; both sides derive the same key.

**Sealing.** `seal(key, text) = base64url(nonce24 ‖ XChaCha20-Poly1305(key, nonce, aad = tag, u32be(len) ‖ text ‖ zeros))`. The plaintext is padded to 256 B, 1 KiB, 4 KiB, 16 KiB, 64 KiB, then 64 KiB steps, so sizes only reveal a bucket. Anything that fails to open is ignored, since tags are shared with anyone who knows them.

**Nostr events.** One `["y", <tag>]` tag each. `created_at` is backdated by a random 0–2 h.

| kind | stored | signed by | content |
|---|---|---|---|
| `4344` | yes | session key | Public event: `seal(enc, JSON(ev))`, `y = tag`. |
| `4344` | yes | one-off key per copy | Private event (`to` set): two copies, one tagged `y = inbox(to)` and one `y = inbox(a)`, each `seal(enc, JSON({a, to, c: seal(pairKey, JSON(ev))}))`. |
| `24344` | no (ephemeral) | session key | Presence: `seal(enc, JSON({j, t, s}))` with `j = JSON(presence)`, `s = ed25519("yurt-pres:" + code + ":" + t + ":" + j)`; dropped when `t` is more than 150 s off. Sent on change and every 60 s, but only while the member is in the foreground, needs the room, or is a bridge. |

The session key is a fresh random secp256k1 key per app session, never the member's identity (a shared key would also let any member file NIP-09 deletions for everyone). Private copies use one-off keys, so a relay can't link the two inboxes as a pair or tie a DM to the session's other traffic.

The inner Yurt event keeps its own Ed25519 signature and passes the same validation as on Trystero, so relays can't forge or alter events.

**Sync.** Clients subscribe live to `{kinds: [4344, 24344], "#y": [tag, inbox(me)], since: now − 2 h}` and then page each relay backwards on its own cursor (`limit` 500; a relay is done when a page brings nothing new, so relays with a lower cap are still read fully) from now to `mark − 1 day`. `mark` is when the last complete backfill finished; it's 0 on first join, so **a new member fetches the whole history**. The day of margin covers backdating and senders with skewed clocks, since `created_at` is theirs. Backfill re-runs whenever relays come back. After it, any of my own recent events the relays don't have (the app closed before an ack) are re-sent.

**Delivery.** A public event leaves "queued" when the first relay acks it; a private one when both of its copies are acked. Unacked events retry every 15 s while offline. A relay that refuses an event (`OK false`, other than rate limiting) gets 3 tries, then the refusal is reported once and the event stays queued without further retries.

**Calls (opt-in).** With the WebRTC opt-in, a member in a huddle sets `rtc: true` in presence; opted-in members who see it join the room, and everyone leaves after 60 s without it. The room signals over the workspace's own relays. Members without the opt-in never join, so they can't take part in calls.

### Files on Blossom

Nostr workspaces keep attachments on [Blossom](https://github.com/hzrd149/blossom) servers (BUD-01/02), chosen per workspace in its Connection view, else in Settings → Network (default: `blossom.primal.net`, `nostr.download`, `files.sovbit.host`). Only `https://` servers are used (plain `http://` only in local development), so a member can't point others at internal addresses.

- **Sealing.** Each file gets a fresh random 32-byte key: `cipher = sealBytes(fileKey, aad = "yurt-file-v1", bytes)`, padded like everything else. Its Blossom id is `sha256(cipher)`.
- **Upload.** `PUT /upload` to every server, authorized by a kind `24242` event (`t=upload`, `x=<hash>`, 5-minute `expiration`) signed by a one-off key. It succeeds if any server accepts; otherwise the message isn't sent.
- **Reference.** The message's `FileRef` carries `blob: {key, hash, servers}` next to `id = sha256(plaintext)`. It travels inside the encrypted event, so only people who can read the message can fetch and open the file; DM files stay within the pair.
- **Download.** `GET /<hash>` from the listed servers in turn (with `t=get` auth for servers that want it), each with a 60 s timeout, abandoning bodies larger than a sealed 25 MB file. The ciphertext must hash to `hash`, decrypt under `key`, and the plaintext must hash to `id`, so a server can't substitute content. Malformed references from other members are ignored.

### Key rotation

Banning someone in a relay workspace also rotates the workspace key, so they can't read anything posted afterwards.

- **Chain.** A workspace's keys form a chain: the invite key, then one key per `rekey`. Each device rebuilds its chain from the key it holds plus the rekeys in its log; nothing else is stored.
- **Rekey body.** The admin picks a fresh random key `wk'` and publishes `{epoch: n+1, keys, history}`:
  - `keys[pub] = seal(pair(adminSec, pub; salt = current key), "yurt-rekey-v1", wk')` for every remaining member (`members(state)`: everyone with a profile who isn't banned, plus the admin).
  - `history = seal(enc(wk'), "yurt-rekey-history-v1", JSON([{key, epoch}…]))`: every earlier key, so whoever holds `wk'` can read the whole history.
- **Publishing.** The rekey is sent under the key it replaces, so current members receive it, and under `wk'`, so someone who joins later with an invite carrying `wk'` finds it (and through `history`, every earlier key).
- **Adopting.** A member opens its entry with the pair key salted by any key it holds, and accepts `wk'` only if `wk'` opens `history`. It then listens on the tags of every key it holds (fetching new tags' history in full) and writes with the key of the highest-epoch valid rekey it can open. Keys from rekeys that don't count are still used for reading, which is harmless.
- **Concurrent rotations.** If two admins rotate at once, the earliest `(ts, id)` rekey wins the epoch for writing. The loser's key still reads, so nothing either wrote is lost.
- **Removed.** A member who can't open a valid rekey newer than its write key is locked out (`WorkspacePeer.lockedOut`). The app says so; the fix is a fresh invite link.
- **WebRTC.** The call room's credentials derive from the write key, so a rotation also moves calls to a room the removed member can't find.
- **Limits.** Nothing takes back what a removed member already read or downloaded, and relays keep old ciphertext. Unbanning doesn't restore access; send a new invite. Rotation isn't used in Trystero workspaces, where a ban already stops all delivery.

### Identity backup

The recovery phrase restores the identity's key; the workspaces it belongs to come back from an encrypted note on the
default relays (`wss://nos.lol`, fixed: a fresh device knows nothing else). Everything derives from the identity's
secret `sec` with HKDF: a separate secp256k1 key `HKDF(sec, "backup-nostr")` signs the note, so relays never see the
identity's public key; it's addressed by `d = HKDF(sec, "backup-d")[0:16]`; and sealed like workspace events with
`HKDF(sec, "backup-enc")`. Kind 30078 (NIP-78, addressable), so relays keep only the newest.

The content is `{v: 1, ws: {<code>: {at, ws}}}`: per workspace, its latest change in ms, `ws` being what rejoining takes
(code, name, transport with its current key, creator, file servers) or `null` once left. Read positions and mutes stay
on each device. Devices merge by the newest `at` per workspace, so they sync in any order and a workspace left on one
device isn't restored by another's older copy; one already present elsewhere isn't removed from that device. A device
loads before it saves, and never saves after a load no relay answered, so one that couldn't read the backup can't
replace it. It syncs on start, after importing a phrase, on reconnect, and shortly after the workspace list changes.

### Threat model

**A relay operator** sees IP addresses, when events arrive, coarse size buckets, backdated `created_at`, the workspace tag, inbox tags that receive private events, and throwaway pubkeys (one per session, one per private copy). It does **not** see the id or key, names, channels, contents, member identities, or which inboxes talk to each other, beyond what arrival timing suggests.

**The backup relays** see one padded, encrypted note per identity, updated when its workspace list changes, under a
pubkey that is in no workspace. Not the identity or its workspaces; the padded size hints only roughly at how many.

**Anyone else on Nostr** can read the same stored events as the operator (minus IPs and arrival times) but can't find a workspace without its tag, and sees only padded, backdated ciphertext.

**Blossom servers** (Nostr workspaces) see IP addresses, when files are uploaded and fetched, padded ciphertext sizes and one-off pubkeys. Not names, contents, or which workspace or message a file belongs to.

**Signaling relays and STUN/TURN servers** (WebRTC: always in Trystero workspaces, only during opted-in calls in Nostr ones) see IP addresses and connection timing. Signaling topics derive from the key and don't identify Yurt. TURN is off by default; the bridge never uses it. STUN servers (Trystero's defaults) see your IP address whenever a room is joined.

**Members** see everything in the workspace while they're members, and each other's IP addresses while in the same WebRTC room. A removed member keeps what it already had, but nothing written after its removal's key rotation. They can tell which inboxes receive private events and, by opening the outer wrapper, who the pair is, but never the contents. DM files only go to the pair.

**Known limits.**
- Removal is forward-only: a removed member keeps everything from before its ban, and the relays keep the old ciphertext. A member who never published a profile when a rotation happens isn't among the recipients and needs a new invite.
- Relays see arrival times and IP addresses; use a VPN or Tor to hide the latter.
- The kinds `4344`/`24344` are specific to Yurt, so a relay can tell that *some* Yurt workspace uses it, though not which or whose.
- Relays can drop or withhold events. Use several; clients publish to all of them. Retention is up to each relay's and Blossom server's policy: a file can disappear even though its message remains.

## Local bridge

`ws://127.0.0.1:7717/ws`. The server checks `Host` and `Origin` (its own origin plus an allow-list managed in the bridge UI).

1. `hello {token?}` → `hello {paired, admin}`. The bridge's own page gets an admin token embedded in its same-origin HTML.
2. Unpaired browsers send `pair {code}` with the 6-digit code shown by the bridge (rotates on use, every 10 min, and after 5 misses) → `paired {token}`.
3. The browser sends `identity {phrase, name, handle}`; the bridge stores it in `~/.yurt/identity.json` (0600) and joins workspaces as a headless peer with that key.
4. `ws.join {code, name, transport?, creator, agents}` (a missing `transport` means a legacy Trystero workspace; a later join with the same kind and key but different relays updates the bridge's relays) / `ws.agents` / `ws.leave` choose which agents sit in which workspace. The bridge publishes `agent` events and presence `{bridge: true, agents: {id: {working, on?}}}`.

### Yurt tools (MCP)

Agents work with tasks, polls, decisions, docs, boards, meetings and the owner's saved messages through an [MCP](https://modelcontextprotocol.io) server named `yurt` that the bridge passes in `session/new`'s `mcpServers` (main sessions only: a guest DM's session gets none, since the tools reach the whole workspace). It's a stdio server: `~/.yurt/mcp-proxy.mjs`, run with the bridge's own Node or Bun, forwards each JSON-RPC line to `POST http://127.0.0.1:7717/mcp` with `Authorization: Bearer <token>`. The token is random per session and forgotten when it ends; requests with an `Origin` (any web page) are refused. Tools act on the agent's current run's workspace and publish ordinary events signed by the owner's key with `ag` = the agent, so they need no bridge to be seen. Tool calls go through the agent CLI's own permission prompts, which reach the owner as approvals like any other tool.

Tools: `list_channels`, `read_messages`, `list_tasks`, `create_task`, `update_task`, `create_poll`, `vote`, `record_decision`, `list_decisions`, `list_docs`, `read_doc`, `create_doc`, `suggest_edit` (agents propose text changes; people accept them), `add_note`, `schedule_meeting`, `rsvp`, `list_saved`.

### ACP mapping

- One process and one `session/new {cwd: workdir}` per agent, reused for every prompt. Each member DMing a discoverable agent gets a separate session, so nothing from the owner's chats or other members' leaks into theirs.
- Triggers (fresh events only): a `task` or `task.set` that assigns a task to the agent (not one the agent gave itself, nor a done one; agent-made assignments count toward the chain cap below); an @mention of the agent's handle in a channel when `respondTo.mentions`; a reply in a thread the agent started or answered in when `respondTo.replies` (no @ needed, never its own messages); the owner writing in `adm:<owner>:<agentId>`; a member writing in `gdm:<member>:<owner>:<agentId>` while the agent is in that workspace and `discoverable`. Agent-written triggers are capped at 4 runs per channel per 5 minutes.
- Prompt: identity, owner instructions, the last N messages of the channel or thread, and the triggering message. A task's prompt has the task, its notes, who assigned it and the conversation it came from; the run marks an open task `doing` and reports in the source message's thread (else the task's channel).
- `session/update`: `agent_message_chunk` → reply text; `tool_call` / `tool_call_update` → trace steps with timings.
- `session/request_permission`: tool kinds on the auto-approve list get `allow_once`. Anything else posts a private `msg` with `approval` to the owner and waits (30 min timeout → reject) for an `approve` event.
- Attachments: the triggering message's files are fetched (Blossom in Nostr workspaces, WebRTC in Trystero ones) and written to `<workdir>/.yurt/files/<msgId>/<name>` (dirs `0700`, files `0600`; names reduced to plain characters and kept inside that folder). The prompt lists `name → path`, or `name (couldn't download)`. Earlier messages' files are listed by name only.
- Reply: `msg {text, trace, meta, parent?, alsoInChannel?}` with `ag = agentId`. DMs stay flat (`to` = the owner, or the member in a guest DM). Elsewhere `postIn` decides: thread only → in the trigger's thread (starting one); channel only → top level, or inside the thread the trigger is already in; both → in the thread with `alsoInChannel: true`.
