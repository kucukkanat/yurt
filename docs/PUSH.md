# Web Push: options

A design note, not a spec: nothing here is implemented. Today notifications come from the running app
(`lib/notifications.ts`, shown through the service worker so phones accept them), so a closed app hears nothing.
Waking a closed web app needs Web Push, and Web Push needs *someone* online to send it. This note compares who that
can be, what they learn, and recommends one.

## Constraints

- **Web Push** ([RFC 8030](https://datatracker.ietf.org/doc/html/rfc8030)) goes through the browser's own push
  service (Google FCM for Chrome, Mozilla autopush, Apple for Safari); the app can't choose another one. The sender
  authenticates with a VAPID key ([RFC 8292](https://datatracker.ietf.org/doc/html/rfc8292)) that the subscription was
  made with, and encrypts the payload to the device ([RFC 8291](https://datatracker.ietf.org/doc/html/rfc8291)), so
  the push service sees only timing and size. Payloads are capped at about 4 KB.
- **Every push must show a notification** (`userVisibleOnly: true` is mandatory in Chrome, Firefox and Safari).
  Chrome shows a generic "updated in the background" notice when the worker shows none (unless a window is focused);
  Safari revokes the subscription after a few silent pushes. So the sender must already know a push is worth showing:
  "push everything and let the worker decide" doesn't work.
- **iOS/iPadOS**: Web Push only in an installed (Home Screen) app, iOS 16.4+, permission asked from a user gesture.
  iOS 18.4+ adds [Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/): the payload is a
  JSON notification the system shows by itself; with `mutable: true` the worker may replace it first, and if the worker
  fails the declared notification still shows, with no revocation penalty.
- **What a watcher can see in Yurt.** Public events carry only the workspace tag `y = tag`; who is mentioned, the
  channel and the text are inside the seal. Private events (DMs, agent DMs, approvals) carry `y = inbox(to)`, plus a
  second copy at `inbox(a)` for the sender's own devices. `created_at` is backdated by up to 2 h, so only arrival time
  is meaningful. So without plaintext, the only targeted signal is "something arrived in my inbox".
- **No server of ours.** Yurt is serverless by design (GitHub Pages + public relays + Blossom). Any push sender is a
  new always-on party; it should be optional, self-hostable and trusted with as little as possible.

## Options

| Option | Works today | Who's online | Learns | Verdict |
|---|---|---|---|---|
| Status quo (app open/backgrounded) | yes | the app | nothing | keep as the default |
| Periodic Background Sync | Chrome/Android only, installed, ~12 h minimum | the browser | nothing | useless for chat |
| Relay webhooks: [NIP-9a](https://github.com/nostr-protocol/nips/pull/2194) (kind 30390 `relay`/`filter`/`callback`), [npb](https://github.com/coracle-social/npb) | open PR, few relays | the relay | filter → callback URL, in clear | revisit when relays support it |
| Event Watcher API ([#1528](https://github.com/nostr-protocol/nips/pull/1528), Amethyst) | closed in 2025 | a watcher server | — | dead |
| Native push relays ([damus notepush](https://github.com/damus-io/notepush), APNs/FCM tokens + NIP-98) | yes | vendor server | pubkey + device token | native apps only |
| Generic Nostr→Web Push server ([nostr-notification-server](https://github.com/mmalmi/nostr-notification-server): filters, VAPID, NIP-98) | yes | a server | filter, push endpoint, the signing pubkey | close fit, but NIP-98 ties it to a Nostr key and it doesn't know Yurt's rules |
| ntfy / UnifiedPush | yes | ntfy server | topic, timing | delivery only: browsers can't use ntfy as their push service; useful as an extra *sink* for Android users without Google |
| Yurt push gateway (below) | to build | a small server, self-hostable | inbox tags, relays, endpoint, timing | **recommended** |
| The bridge sends pushes | to build | the owner's bridge machine | everything (it already holds the key) | good extra for always-on bridges, not a general answer |

## Recommended: a small Yurt push gateway

A single-file Bun service (also runnable as `yurt-bridge push` so self-hosters already have it) that holds
**registrations**, keeps live subscriptions to the listed relays, and turns matching events into Web Push messages.
It never holds a workspace key or identity, and it is off until the user sets a gateway URL (like TURN).

**Registration.** `POST /register {endpoint, keys, vapid, relays, tags}` → `{id, secret}`; later
`PUT`/`DELETE /register/<id>` with that secret. No NIP-98: signing with the identity (or anything stable) would link
the device to a Yurt member. `tags` are the device's `inbox(me)` per workspace (and, after phase 2, `ping(me)`).

**VAPID per device.** The app generates the P-256 VAPID key pair itself, subscribes with its public half and hands the
private half to the gateway. The gateway then needs no long-lived key, several gateways (or a gateway and a bridge) can
serve one subscription, and leaving a gateway is just rotating the key and resubscribing. (A browser registration has
one push subscription, so a gateway-owned key would pin the device to one gateway.)

**Sending.** For each new kind-`4344` event on a registered tag (live only, deduplicated by event id):
- Payload: the sealed Nostr `content` and event id when it fits in ~3.5 KB (the 256 B and 1 KiB buckets, so most
  messages), else the id and relay only. Encrypted to the device by RFC 8291 as usual.
- Headers: `Topic` = a hash of the tag so undelivered pushes for one inbox collapse into the newest; `Urgency: high`
  for inbox events; a short `TTL`.
- Per-registration rate limit and coalescing (a burst of DMs is one push).
- For Safari 18.4+, the payload is a declarative notification ("New message", opens the app) with `mutable: true` and
  the sealed data alongside, so a failing worker still shows something and never costs the subscription.

**The service worker on `push`.** The app already keeps the identity and workspaces (with their keys) in IndexedDB,
which the worker can read. It opens the outer seal with `enc`, the inner one with the pair key, validates the inner
signature, applies the app's own rules (mutes, focus mode, a focused window already showing that conversation), and
shows the real title and text with the same `tag` the app uses, so the in-app and pushed notifications replace each
other. If anything fails (payload too big, keys gone, stale workspace key) it shows a generic "New message in <app>"
that opens the app; it may also fetch the event by id from the relay within the push event's lifetime. Nothing
decrypted ever leaves the device. The decision logic belongs in `lib/swLogic.ts` (unit tested) per AGENTS.md.

**Protocol changes it needs.**
1. *Own copies.* The sender's copy of a private event is tagged `inbox(a)`, so the sender's own phone would be pushed
   for every DM it sends. Tag self-copies `outbox(a)` (`HKDF(wk, "yurt-outbox:<pub>-v1")`, subscribed alongside
   `inbox(me)`); old clients keep reading `inbox(a)` copies during a transition. Cost: a relay can tell a sender's copy
   from a recipient's.
2. *Mentions and replies (phase 2).* They're public events, invisible to the gateway. The sender adds a tiny private
   `ping {ref}` event to `inbox(mentioned)` (or a separate `ping(me)` tag so users can register DMs only), sealed with
   the pair key. Old peers drop the unknown `t`. Cost: relays and the recipient's gateway see that the inbox got
   something, which they already see for DMs. Plain channel traffic stays unpushed; "all messages" pushes would need a
   gateway watching the workspace tag, which is noisy and leaks the workspace's whole activity timing to the gateway.

### What each party learns (threat-model delta)

- **The gateway**: the device's IP and push endpoint (an Apple/Google/Mozilla URL, stable per device), the relays and
  inbox tags it watches, and the arrival time and size bucket of every private event to them. One registration
  covering several workspaces links those inboxes as one person, which relays alone can't do; use one gateway per
  trust domain (e.g. the team runs its own) or one registration per workspace. It can't read, forge or alter
  anything: payloads stay sealed and signed. A malicious gateway can drop pushes (availability) or spam generic ones.
- **The push service** (Apple, Google, Mozilla): the gateway's IP, the device, timing and size of the encrypted push.
  No tags, no content.
- **Relays**: unchanged, except the outbox/ping changes above.
- **The device**: no new exposure; the worker reads keys the app already stores.

`docs/PROTOCOL.md`'s threat model gets a "push gateway" paragraph when this ships.

### Rough implementation steps

1. Protocol: `outbox(a)` self-copies with a read transition; `inbox`/`outbox` in the sync filter; tests in
   `packages/protocol`.
2. Gateway: `packages/push` (or a `yurt-bridge push` command): registration store (JSON or SQLite), relay pool
   reusing `@yurt/protocol`'s Nostr transport, Web Push sender (RFC 8291 encryption + VAPID JWT with `@noble/curves`),
   Topic/TTL/Urgency, rate limit, delete on `404`/`410` from the push service. Tested against the local relay and a
   tiny local push-service endpoint (no mocks).
3. Web app: Settings → Notifications → "Push gateway" (off by default, URL field, test button), per-device VAPID key in
   IndexedDB, `pushManager.subscribe`, register/unregister with the inbox tags of every workspace, re-register when
   workspaces, relays or keys change (rekeys change the tags).
4. Service worker: `push` handler (decrypt, rules, show; generic fallback) and `pushsubscriptionchange`
   (resubscribe and re-register); logic in `lib/swLogic.ts`, wiring checked in `e2e/pwa.spec.ts` with a local gateway.
5. Phase 2: `ping` events for mentions and thread replies, with a per-device "DMs only / DMs and mentions" choice.
6. Docs: README (notifications paragraph), PROTOCOL.md (outbox, ping, gateway threat model), AGENTS.md (package).
7. Later: if NIP-9a lands on the relays Yurt uses, the gateway can shrink to a callback → Web Push adapter, with the
   same filter.
