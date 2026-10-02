import { describe, expect, it } from 'vitest';
import { keyFromPhrase, newRecoveryPhrase, reduce, makeEvent, type Presence, type Task } from '@yurt/protocol';
import {
  STATUS_LABEL,
  agentsOn,
  dueLabel,
  followTarget,
  fromLocalInput,
  lineAt,
  meetLabel,
  openAt,
  pollOptions,
  presenceList,
  readUpTo,
  rsvpCounts,
  taskGroups,
  toLocalInput,
  viewOf,
  viewers,
} from '../src/lib/collab';

const DAY = 86_400_000;
const NOON = new Date(2030, 4, 4, 12, 0).getTime();

describe('due dates and meeting times', () => {
  it('say overdue, today, tomorrow or the date', () => {
    expect(dueLabel(NOON - 2 * DAY, NOON)).toMatchObject({ late: true, text: expect.stringMatching(/^Overdue · /) });
    expect(dueLabel(NOON - 2 * DAY, NOON, true)).toMatchObject({ late: false, text: expect.stringMatching(/^Due /) });
    expect(dueLabel(NOON - 60_000, NOON)).toEqual({ late: false, text: 'Due today' });
    expect(dueLabel(NOON + DAY, NOON)).toEqual({ late: false, text: 'Due tomorrow' });
    expect(dueLabel(NOON + 5 * DAY, NOON).text).toMatch(/^Due \S/);
  });

  it('say when a meeting is, and whether it is on', () => {
    expect(meetLabel(NOON + 60_000, 30, NOON)).toMatchObject({ phase: 'upcoming', text: expect.stringMatching(/^Today .+ · 30 min$/) });
    expect(meetLabel(NOON - 60_000, undefined, NOON)).toMatchObject({ phase: 'now', text: expect.stringMatching(/^Today /) });
    expect(meetLabel(NOON - 2 * 60 * 60_000, 30, NOON).phase).toBe('over');
    expect(meetLabel(NOON + 3 * DAY, 15, NOON).text).not.toMatch(/^Today/);
  });

  it('go to and from datetime-local fields', () => {
    expect(fromLocalInput(toLocalInput(NOON))).toBe(NOON);
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('not a date')).toBeNull();
  });
});

describe('tasks', () => {
  const task = (id: string, p: Partial<Task>): Task => ({ id, title: id, ch: 'general', a: 'x', ts: 1, status: 'open', updated: 1, log: [], ...p });
  it('group mine first, by due date, then others, then the recently done', () => {
    const mine = (a: string | undefined) => a === 'me';
    const g = taskGroups(
      [
        task('later', { assignee: 'me' }),
        task('soon', { assignee: 'me', due: 5 }),
        task('theirs', { assignee: 'you', ch: 'random' }),
        task('old-done', { status: 'done', updated: 2 }),
        task('new-done', { status: 'done', updated: 9 }),
      ],
      mine,
    );
    expect([g.mine, g.others, g.done].map((l) => l.map((t) => t.id))).toEqual([['soon', 'later'], ['theirs'], ['new-done', 'old-done']]);
    expect(taskGroups([task('theirs', { ch: 'random' })], mine, 'general').others).toEqual([]);
    expect(STATUS_LABEL.blocked).toBe('Blocked');
  });
});

describe('presence', () => {
  const p = (x: Partial<Presence>): Presence => ({ pub: 'a', st: 'online', ...x }) as Presence;
  it('names what I look at, and who else looks at it', () => {
    expect(viewOf({ ch: 'general' }, { type: 'doc', id: 'd1' })).toBe('doc:d1');
    expect(viewOf({ ch: 'general', thread: 't1' }, { type: null })).toBe('thread:t1');
    expect(viewOf({ ch: 'general' }, { type: 'doc' })).toBe('general');
    expect(viewOf({}, { type: null })).toBeNull();
    const list = [p({ pub: 'me', view: 'general' }), p({ pub: 'b', view: 'general' }), p({ pub: 'b', view: 'general' }), p({ pub: 'c', bridge: true, view: 'general' })];
    expect(viewers(list, 'general', 'me')).toEqual(['b']);
  });

  it('finds agents working on something, and copes without a peer', () => {
    const list = [p({ pub: 'o', bridge: true, agents: { scout: { working: 'general', on: 'doc:d1' }, idle: { working: null } } }), p({ pub: 'x', bridge: true }), p({ pub: 'o' })];
    expect(agentsOn(list, 'doc:d1')).toEqual(['o/scout']);
    expect(presenceList(undefined)).toEqual([]);
    expect(presenceList({ presence: new Map([['k', list[1] as Presence]]) })).toHaveLength(1);
  });

  it('follows into channels, threads and docs it can open', () => {
    const A = keyFromPhrase(newRecoveryPhrase());
    const ev = (t: Parameters<typeof makeEvent>[1]['t'], b: unknown, ch?: string) => makeEvent(A, { ws: 'W', t, b, ...(ch ? { ch } : {}) });
    const ch = ev('ch.create', { id: 'general', name: 'general' });
    const m = ev('msg', { text: 'hi' }, 'general');
    const s = reduce('W', [ch, m, ev('doc', { id: 'd1', title: 'Doc', ch: 'general' })], { creator: A.pub });
    expect(followTarget(s, 'general')).toEqual({ ch: 'general' });
    expect(followTarget(s, 'thread:' + m.id)).toEqual({ ch: 'general', thread: m.id });
    expect(followTarget(s, 'doc:d1')).toEqual({ ch: 'general', doc: 'd1' });
    for (const v of ['doc:nope', 'thread:nope', 'dm:a:b', null, undefined]) expect(followTarget(s, v)).toBeNull();
  });
});

describe('little helpers', () => {
  it('read marks take the latest from any of my devices', () => {
    const A = keyFromPhrase(newRecoveryPhrase());
    const s = reduce('W', [makeEvent(A, { ws: 'W', t: 'read', to: A.pub, b: { ch: 'general', ts: 50 } })]);
    expect(readUpTo(10, s, A.pub, 'general')).toBe(50);
    expect(readUpTo(90, s, A.pub, 'general')).toBe(90);
    expect(readUpTo(undefined, undefined, A.pub, 'general')).toBe(0);
  });

  it('count RSVPs, lines, poll options and where messages open', () => {
    expect(
      rsvpCounts(
        new Map([
          ['a', 'yes'],
          ['b', 'no'],
          ['c', 'yes'],
        ] as const),
      ),
    ).toEqual({ yes: ['a', 'c'], maybe: [], no: ['b'] });
    expect(rsvpCounts(undefined)).toEqual({ yes: [], maybe: [], no: [] });
    expect(lineAt('a\nb\nc', 3)).toBe(1);
    expect(pollOptions(' a \n\nb\na\n' + Array.from({ length: 12 }, (_, i) => 'o' + i).join('\n'))).toHaveLength(10);
    expect(openAt({ ch: 'general', parent: 'p' })).toEqual({ ch: 'general', thread: 'p' });
    expect(openAt({ ch: 'general' })).toEqual({ ch: 'general' });
  });
});
