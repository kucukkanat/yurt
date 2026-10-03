import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import type { Event as NostrEvent } from 'nostr-tools/core';
import type { Ev } from './types';
import type { JoinInvite } from './invite';
import { sign, verify, type KeyPair } from './crypto';
import { verifyEvent } from './events';
import { open, seal, workspaceKeys } from './seal';
import { GrantSchema, GrantWrapperSchema, JoinRequestSchema, parseBody, parseOr } from './schemas';
import { FUZZ_S, KIND_EVENT } from './transports/nostr';

/*
 * Join approval. An invite link carries a join key `jk`, not the workspace key, so a leaked link lets nobody in:
 * - the joiner seals a signed request with `jk` and posts it under the invite's lobby tag (`tag` derived from `jk`);
 * - admins' devices listen on the lobby tags of the workspace's open invites and show the requests;
 * - an admin who lets someone in seals the current workspace key to them with their pair key (salted by `jk`) under
 *   the joiner's lobby inbox. Anyone with the link can post there, so the joiner only takes a key from the creator
 *   (pinned by the link) or from an admin who shows the creator's signed `role` event that made them one.
 * Lobby events look like any workspace's: kind 4344, an opaque `y` tag, padded ciphertext, a one-off signer.
 */

/** A request to join, checked: signed by `pub`, for this workspace and invite. */
export interface JoinReq {
  pub: string;
  name: string;
  handle: string;
  /** When it was asked (ms, the joiner's clock). */
  ts: number;
  /** The invite it came through. */
  jk: string;
}

const reqMsg = (code: string, tag: string, r: { p: string; n: string; h?: string | undefined; t: number }) =>
  `yurt-join:${code}:${tag}:${r.t}:${r.p}:${JSON.stringify([r.n, r.h ?? ''])}`;

const parse = (s: string | null): unknown => {
  if (s === null) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** A request's sealed content, for the invite's lobby tag. */
export function sealJoinRequest(kp: KeyPair, code: string, jk: string, who: { name: string; handle: string }, ts = Date.now()): string {
  const lk = workspaceKeys(jk);
  const r = { p: kp.pub, n: who.name, h: who.handle, t: ts };
  return seal(lk.enc, lk.tag, JSON.stringify({ ...r, s: sign(kp.sec, reqMsg(code, lk.tag, r)) }));
}

/** Opens a lobby event's content; null unless it's a well-formed request signed by the key it names. */
export function openJoinRequest(code: string, jk: string, content: string): JoinReq | null {
  const lk = workspaceKeys(jk);
  const r = parseOr(JoinRequestSchema, parse(open(lk.enc, lk.tag, content)));
  if (!r || !verify(r.p, reqMsg(code, lk.tag, r), r.s)) return null;
  return { pub: r.p, name: r.n, handle: r.h ?? '', ts: r.t, jk };
}

/** The current workspace `key` for `to`, sealed so only they can open it. `proof` shows a non-creator admin is one. */
export function sealGrant(kp: KeyPair, jk: string, to: string, key: string, proof?: Ev): string {
  const lk = workspaceKeys(jk);
  const c = seal(lk.pair(kp.sec, to), lk.tag, JSON.stringify({ key, ...(proof ? { proof } : {}) }));
  return seal(lk.enc, lk.tag, JSON.stringify({ a: kp.pub, c }));
}

/** Whether `proof` is the creator's signed `role` event making `admin` an admin of `code`. */
export function provesAdmin(code: string, creator: string | null, admin: string, proof: unknown): proof is Ev {
  if (!verifyEvent(proof) || proof.ws !== code || proof.t !== 'role' || proof.a !== creator) return false;
  const b = parseBody('role', proof.b);
  return b?.target === admin && b.admin;
}

/** A grant's workspace key, if it opens for me and comes from the creator or a proven admin. */
export function openGrant(kp: KeyPair, invite: JoinInvite, content: string): { key: string; by: string } | null {
  const lk = workspaceKeys(invite.join);
  const w = parseOr(GrantWrapperSchema, parse(open(lk.enc, lk.tag, content)));
  if (!w) return null;
  let inner: string | null;
  try {
    inner = open(lk.pair(kp.sec, w.a), lk.tag, w.c);
  } catch {
    return null; // 64 hex characters that aren't a curve point: junk
  }
  const g = parseOr(GrantSchema, parse(inner));
  if (!g || (w.a !== invite.creator && !provesAdmin(invite.code, invite.creator, w.a, g.proof))) return null;
  return { key: g.key, by: w.a };
}

/** Lobby events are backdated like workspace events, and each is signed by a one-off key. */
export const lobbyEvent = (tag: string, content: string): NostrEvent =>
  finalizeEvent({ kind: KIND_EVENT, created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * FUZZ_S), tags: [['y', tag]], content }, generateSecretKey());

export interface JoinOpts {
  invite: JoinInvite;
  kp: KeyPair;
  /** How the joiner introduces themselves to admins. */
  who: { name: string; handle: string };
  /** An admin let me in: `key` is the workspace key to join with. Called at most once. */
  onGranted(key: string, by: string): void;
  /** Try posting the request again this often while no relay took it. Default 15 s. */
  retryMs?: number | undefined;
}

/**
 * Asks to join through an invite and waits for an admin's answer. Lives until `leave()`: a request stays on the
 * relays, so the answer is found whenever this runs again (e.g. after a reload).
 */
export class JoinClient {
  private pool = new SimplePool({ enableReconnect: true });
  private closeSub: () => void;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private done = false;

  constructor(private o: JoinOpts) {
    const lk = workspaceKeys(o.invite.join);
    const sub = this.pool.subscribe([...o.invite.relays], { kinds: [KIND_EVENT], '#y': [lk.inbox(o.kp.pub)] }, { onevent: (e) => this.onEvent(e) });
    this.closeSub = () => sub.close();
    this.ask(lobbyEvent(lk.tag, sealJoinRequest(o.kp, o.invite.code, o.invite.join, o.who)));
  }

  /** Posts the request until a relay takes it. */
  private ask(ne: NostrEvent) {
    void Promise.allSettled(this.pool.publish([...this.o.invite.relays], ne)).then((rs) => {
      if (this.done || rs.some((r) => r.status === 'fulfilled')) return;
      this.retry = setTimeout(() => this.ask(ne), this.o.retryMs ?? 15_000);
    });
  }

  private onEvent(ne: NostrEvent) {
    // The pool drops copies of an event it already delivered, and leave() closes it, so this lets me in once.
    const g = openGrant(this.o.kp, this.o.invite, ne.content);
    if (!g) return;
    this.leave();
    this.o.onGranted(g.key, g.by);
  }

  leave() {
    this.done = true;
    clearTimeout(this.retry);
    this.closeSub();
    this.pool.destroy();
  }
}
