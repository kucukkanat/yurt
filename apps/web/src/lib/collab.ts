import type { Actor, Presence, Task, TaskStatus, WsState } from '@yurt/protocol';

/*
 * Decisions behind the collaboration views (tasks, polls, meetings, docs, presence), kept out of the components
 * so they're unit tested.
 */

export const STATUS_LABEL: Record<TaskStatus, string> = { open: 'To do', doing: 'In progress', blocked: 'Blocked', done: 'Done' };

const DAY = 24 * 60 * 60 * 1000;
const dayOf = (ms: number) => new Date(ms).toDateString();
const shortDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** "Overdue · 3 May", "Due today", "Due tomorrow", "Due 5 May". */
export function dueLabel(due: number, now: number, done = false): { text: string; late: boolean } {
  const late = !done && due < now && dayOf(due) !== dayOf(now);
  if (late) return { text: 'Overdue · ' + shortDate(due), late };
  if (dayOf(due) === dayOf(now)) return { text: 'Due today', late };
  if (dayOf(due) === dayOf(now + DAY)) return { text: 'Due tomorrow', late };
  return { text: 'Due ' + shortDate(due), late };
}

/** "Today 15:00 · 30 min", "Tue 3 Jun 09:30", and whether it's happening now or over. */
export function meetLabel(at: number, dur: number | undefined, now: number): { text: string; phase: 'upcoming' | 'now' | 'over' } {
  const end = at + (dur ?? 30) * 60_000;
  const day = dayOf(at) === dayOf(now) ? 'Today' : new Date(at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const phase = now < at ? 'upcoming' : now < end ? 'now' : 'over';
  return { text: day + ' ' + clock(at) + (dur ? ' · ' + dur + ' min' : ''), phase };
}

/** Tasks for the hub: mine first (open ones by due date), then everyone else's open ones, then the finished ones. */
export function taskGroups(tasks: Iterable<Task>, mine: (a: Actor | undefined) => boolean, ch?: string) {
  const list = [...tasks].filter((t) => !ch || t.ch === ch);
  const byDue = (a: Task, b: Task) => (a.due ?? Number.MAX_SAFE_INTEGER) - (b.due ?? Number.MAX_SAFE_INTEGER) || a.ts - b.ts;
  const open = list.filter((t) => t.status !== 'done').sort(byDue);
  return {
    mine: open.filter((t) => mine(t.assignee)),
    others: open.filter((t) => !mine(t.assignee)),
    done: list.filter((t) => t.status === 'done').sort((a, b) => b.updated - a.updated),
  };
}

/** How many said yes, maybe and no. */
export function rsvpCounts(answers: ReadonlyMap<Actor, 'yes' | 'no' | 'maybe'> | undefined): Record<'yes' | 'no' | 'maybe', Actor[]> {
  const out: Record<'yes' | 'no' | 'maybe', Actor[]> = { yes: [], maybe: [], no: [] };
  for (const [who, going] of answers ?? []) out[going].push(who);
  return out;
}

/** The view a member tells others about (presence `view`): a doc, a thread, or the conversation. */
export function viewOf(route: { ch?: string | undefined; thread?: string | undefined }, panel: { type: string | null; id?: string | undefined }): string | null {
  if (panel.type === 'doc' && panel.id) return 'doc:' + panel.id;
  if (route.thread) return 'thread:' + route.thread;
  return route.ch ?? null;
}

/** Everyone online in a workspace: its presence entries (none while it has no peer). */
export const presenceList = (peer: { presence: ReadonlyMap<string, Presence> } | undefined): Presence[] => [...(peer?.presence.values() ?? [])];

/** Other people looking at `view` (distinct, never me or a bridge). */
export function viewers(presence: Iterable<Presence>, view: string, me: string): string[] {
  const out = new Set<string>();
  for (const p of presence) if (!p.bridge && p.pub !== me && p.view === view) out.add(p.pub);
  return [...out];
}

/** Agents working on `on` (`doc:<id>`, `task:<id>`): their actor keys. */
export function agentsOn(presence: Iterable<Presence>, on: string): Actor[] {
  const out: Actor[] = [];
  for (const p of presence) if (p.bridge) for (const [id, a] of Object.entries(p.agents ?? {})) if (a.on === on) out.push(p.pub + '/' + id);
  return out;
}

/** Where `m` is opened: in its thread when it's a reply. */
export const openAt = (m: { ch: string; parent?: string | undefined }): { ch: string; thread?: string } => (m.parent ? { ch: m.ch, thread: m.parent } : { ch: m.ch });

/** Where to go to follow someone looking at `view`: a channel, a thread in it, or a doc (opened in the panel). */
export function followTarget(s: WsState, view: string | null | undefined): { ch: string; thread?: string; doc?: string } | null {
  if (!view) return null;
  if (view.startsWith('doc:')) {
    const d = s.docs.get(view.slice(4));
    return d ? { ch: d.ch, doc: d.id } : null;
  }
  if (view.startsWith('thread:')) {
    const m = s.msgs.get(view.slice(7));
    return m ? { ch: m.ch, thread: m.id } : null;
  }
  // Only public channels: a private conversation they're in isn't one I could open.
  return s.channels.has(view) ? { ch: view } : null;
}

/** When `ch` was last read, on this device or (synced privately) any of mine. */
export const readUpTo = (local: number | undefined, s: WsState | undefined, me: string, ch: string): number => Math.max(local ?? 0, s?.reads.get(me)?.get(ch) ?? 0);

/** The (0-based) line the caret at `pos` is on. */
export const lineAt = (text: string, pos: number): number => text.slice(0, pos).split('\n').length - 1;

/** Poll options from a form's lines: trimmed, no blanks or repeats, at most ten. */
export const pollOptions = (raw: string): string[] =>
  [
    ...new Set(
      raw
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ].slice(0, 10);

/** A `datetime-local` value (local time, minutes) for `ms`, and back; '' and null when empty or invalid. */
export const toLocalInput = (ms: number): string => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};
export const fromLocalInput = (v: string): number | null => {
  const t = v ? new Date(v).getTime() : Number.NaN;
  return Number.isFinite(t) ? t : null;
};
