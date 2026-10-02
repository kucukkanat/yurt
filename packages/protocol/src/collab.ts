import * as Y from 'yjs';
import * as v from 'valibot';
import type { Actor } from './types';
import type { WsState, Task } from './reduce';
import { b64, unb64 } from './seal';

/*
 * Collaboration helpers shared by the web app and the bridge (whose agents use them through MCP tools).
 * Docs are Yjs documents whose updates travel as `doc.op` events: Yjs merges them the same way in any
 * order, so peers that meet late (Trystero) or read relays out of order (Nostr) converge.
 */

/** `pub/agentId` → its parts; a plain `pub` has no agent. */
export function actorParts(actor: Actor): { pub: string; agentId?: string } {
  const i = actor.indexOf('/');
  return i < 0 ? { pub: actor } : { pub: actor.slice(0, i), agentId: actor.slice(i + 1) };
}

/** A Yjs document rebuilt from a doc's ops. An op that doesn't decode is skipped, like any bad event. */
export function ydoc(ops: readonly string[]): Y.Doc {
  const d = new Y.Doc();
  for (const u of ops)
    try {
      Y.applyUpdate(d, unb64(u));
    } catch {
      /* a malformed update from a peer: ignored */
    }
  return d;
}

/** The Yjs updates `change` makes to the document rebuilt from `ops` (none if it changed nothing). */
function changes(ops: readonly string[], change: (d: Y.Doc) => void): Uint8Array[] {
  const d = ydoc(ops);
  const out: Uint8Array[] = [];
  d.on('update', (u: Uint8Array) => out.push(u));
  d.transact(() => change(d));
  return out;
}
/** Those changes as one op; null when there were none. */
const opFor = (ops: readonly string[], change: (d: Y.Doc) => void): string | null => {
  const us = changes(ops, change);
  return us.length ? b64(Y.mergeUpdates(us)) : null;
};

const TEXT = 'text';

export const docText = (ops: readonly string[]): string => ydoc(ops).getText(TEXT).toString();

/**
 * The op that turns a text doc into `next`. It replaces only the span that differs (common prefix and suffix
 * kept), so edits made at the same time elsewhere in the doc survive the merge.
 */
export function textOp(ops: readonly string[], next: string): string | null {
  return opFor(ops, (d) => {
    const t = d.getText(TEXT);
    const cur = t.toString();
    let p = 0;
    while (p < cur.length && p < next.length && cur[p] === next[p]) p++;
    let q = 0;
    while (q < cur.length - p && q < next.length - p && cur[cur.length - 1 - q] === next[next.length - 1 - q]) q++;
    if (cur.length - p - q) t.delete(p, cur.length - p - q);
    if (next.length - p - q) t.insert(p, next.slice(p, next.length - q));
  });
}

/** `text` with a suggestion applied: the first `find` replaced, or `replace` appended when `find` is empty. Null if `find` is gone. */
export function applySuggestion(text: string, find: string, replace: string): string | null {
  if (!find) return text ? text.replace(/\n*$/, '\n') + replace : replace;
  const i = text.indexOf(find);
  return i < 0 ? null : text.slice(0, i) + replace + text.slice(i + find.length);
}

/* ---------- boards ---------- */

export const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green', 'purple'] as const;
const NoteSchema = v.object({
  text: v.pipe(v.string(), v.maxLength(2000)),
  x: v.pipe(v.number(), v.finite()),
  y: v.pipe(v.number(), v.finite()),
  color: v.fallback(v.picklist(NOTE_COLORS), 'yellow'),
  by: v.fallback(v.string(), ''),
});
export type Note = v.InferOutput<typeof NoteSchema> & { id: string };

const NOTES = 'notes';

/** A board's sticky notes, oldest id first. Entries come from peers, so each is checked. */
export function boardNotes(ops: readonly string[]): Note[] {
  const out: Note[] = [];
  ydoc(ops)
    .getMap(NOTES)
    .forEach((val, id) => {
      const r = v.safeParse(NoteSchema, val);
      if (r.success) out.push({ ...r.output, id });
    });
  return out.sort((a, b) => Number(a.id > b.id) - Number(a.id < b.id));
}

/** The op that adds or replaces note `n` (last writer wins per note). Setting a value always makes one. */
export const notePutOp = (ops: readonly string[], n: Note): string =>
  b64(
    Y.mergeUpdates(
      changes(ops, (d) => {
        const { id, ...rest } = n;
        d.getMap(NOTES).set(id, rest);
      }),
    ),
  );

export const noteRemoveOp = (ops: readonly string[], id: string): string | null =>
  opFor(ops, (d) => {
    const notes = d.getMap(NOTES);
    if (notes.has(id)) notes.delete(id);
  });

/* ---------- reading state ---------- */

/** A poll's options with their votes and voters, and how many voted in all. */
export function pollTally(s: WsState, msgId: string): { options: { label: string; count: number; voters: Actor[] }[]; total: number } {
  const votes = s.votes.get(msgId) ?? new Map<Actor, number[]>();
  const options = (s.msgs.get(msgId)?.poll?.options ?? []).map((label, i) => {
    const voters = [...votes].filter(([, cs]) => cs.includes(i)).map(([who]) => who);
    return { label, count: voters.length, voters };
  });
  return { options, total: votes.size };
}

/** Whether a poll still takes votes at `now`. */
export const pollOpen = (closes: number | undefined, now: number): boolean => closes === undefined || now < closes;

/** Tasks assigned to `actor` that aren't done, by due date (none last), then age. */
export function openTasksFor(s: WsState, actor: Actor): Task[] {
  return [...s.tasks.values()]
    .filter((t) => t.assignee === actor && t.status !== 'done')
    .sort((a, b) => (a.due ?? Number.MAX_SAFE_INTEGER) - (b.due ?? Number.MAX_SAFE_INTEGER) || a.ts - b.ts);
}

/** A fresh id for a task or doc: random, so two members creating one at once never collide. */
export const newId = (): string => b64(crypto.getRandomValues(new Uint8Array(9)));
