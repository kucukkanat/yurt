import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  newRecoveryPhrase,
  keyFromPhrase,
  reduce,
  dmChannel,
  docText,
  textOp,
  applySuggestion,
  boardNotes,
  notePutOp,
  noteRemoveOp,
  pollTally,
  pollOpen,
  openTasksFor,
  actorParts,
  newId,
  ydoc,
  b64,
  parseOr,
  PresenceSchema,
  type Ev,
} from '../src';
import { eventClock, northwind } from './util';

const WS = 'K7QX2MPD';
const A = keyFromPhrase(newRecoveryPhrase());
const B = keyFromPhrase(newRecoveryPhrase());
const C = keyFromPhrase(newRecoveryPhrase());
const { ev, later } = eventClock(WS);
const BASE = northwind(ev, A, B);
const state = (evs: Ev[]) => reduce(WS, [...BASE, ...evs], { creator: A.pub });
const agentOf = (pub: string, id: string) => `${pub}/${id}`;

describe('tasks', () => {
  it('are made in a channel, assigned to people or agents, and changed by anyone', () => {
    const create = ev(A, 'task', { id: 't1', title: 'Ship it', ch: 'general', src: 'm1', assignee: agentOf(B.pub, 'scout'), due: 5 });
    const doing = ev(B, 'task.set', { id: 't1', status: 'doing', note: 'on it' }, { ag: 'scout' });
    const back = ev(B, 'task.set', { id: 't1', assignee: B.pub, status: 'blocked', note: 'needs a key', title: 'Ship it now', due: null });
    const s = state([create, doing, back]);
    const t = s.tasks.get('t1');
    expect(t).toMatchObject({ title: 'Ship it now', ch: 'general', src: 'm1', a: A.pub, assignee: B.pub, status: 'blocked', updated: back.ts });
    expect(t?.due).toBeUndefined();
    expect(t?.log).toEqual([
      { a: A.pub, ag: undefined, ts: create.ts, status: 'open', assignee: agentOf(B.pub, 'scout') },
      { a: B.pub, ag: 'scout', ts: doing.ts, status: 'doing', note: 'on it' },
      { a: B.pub, ag: undefined, ts: back.ts, status: 'blocked', assignee: B.pub, note: 'needs a key' },
    ]);
    expect(openTasksFor(s, B.pub).map((x) => x.id)).toEqual(['t1']);
    const unassigned = state([create, ev(A, 'task.set', { id: 't1', assignee: null, due: 9 })]).tasks.get('t1');
    expect(unassigned?.assignee).toBeUndefined();
    expect(unassigned?.due).toBe(9);
  });

  it('keep the first creation, need a real channel, and ignore changes to unknown tasks', () => {
    const s = state([
      ev(A, 'task', { id: 't1', title: 'First', ch: 'general' }),
      ev(B, 'task', { id: 't1', title: 'Second', ch: 'general' }),
      ev(A, 'task', { id: 't2', title: 'Nowhere', ch: 'nope' }),
      ev(A, 'task', { id: 't3', title: 'Bad assignee', ch: 'general', assignee: 'not-a-key' }),
      ev(A, 'task.set', { id: 'missing', status: 'done' }),
      ev(A, 'task.set', { id: 't1', status: 'finished' }),
    ]);
    expect(s.tasks.get('t1')?.title).toBe('First');
    expect(s.tasks.get('t1')?.status).toBe('open');
    expect(s.tasks.has('t2')).toBe(false);
    expect(s.tasks.get('t3')?.assignee).toBeUndefined();
  });

  it('apply changes whose author’s clock was behind the creator’s', () => {
    const set = ev(B, 'task.set', { id: 't1', status: 'done' });
    later(10_000);
    expect(state([set, ev(A, 'task', { id: 't1', title: 'x', ch: 'general' })]).tasks.get('t1')?.status).toBe('done');
  });

  it('sort an assignee’s open work by due date, then age', () => {
    const s = state([
      ev(A, 'task', { id: 'late', title: 'a', ch: 'general', assignee: C.pub }),
      ev(A, 'task', { id: 'soon', title: 'b', ch: 'general', assignee: C.pub, due: 10 }),
      ev(A, 'task', { id: 'older', title: 'c', ch: 'general', assignee: C.pub }),
      ev(A, 'task', { id: 'done', title: 'd', ch: 'general', assignee: C.pub }),
      ev(A, 'task.set', { id: 'done', status: 'done' }),
    ]);
    expect(openTasksFor(s, C.pub).map((t) => t.id)).toEqual(['soon', 'late', 'older']);
  });
});

describe('polls', () => {
  const pollMsg = (extra: object = {}) => ev(A, 'msg', { text: 'Lunch?', poll: { q: 'Lunch?', options: ['Pizza', 'Sushi', 'Tacos'], ...extra } }, { ch: 'general' });

  it('count the latest vote per member or agent, one choice unless multi', () => {
    const p = pollMsg();
    const s = state([
      p,
      ev(A, 'vote', { target: p.id, choices: [1, 0] }),
      ev(B, 'vote', { target: p.id, choices: [2] }),
      ev(B, 'vote', { target: p.id, choices: [0, 9] }),
      ev(B, 'vote', { target: p.id, choices: [1] }, { ag: 'scout' }),
      ev(C, 'vote', { target: p.id, choices: [2] }),
      ev(C, 'vote', { target: p.id, choices: [] }),
    ]);
    expect(pollTally(s, p.id)).toEqual({
      options: [
        { label: 'Pizza', count: 2, voters: [A.pub, B.pub] },
        { label: 'Sushi', count: 1, voters: [agentOf(B.pub, 'scout')] },
        { label: 'Tacos', count: 0, voters: [] },
      ],
      total: 3,
    });
    expect(s.votes.get(p.id)?.get(A.pub)).toEqual([0]);
  });

  it('keep several choices on multi polls, and stop counting once closed', () => {
    const p = pollMsg({ multi: true });
    const open = state([p, ev(A, 'vote', { target: p.id, choices: [2, 0, 2] })]);
    expect(open.votes.get(p.id)?.get(A.pub)).toEqual([0, 2]);
    const closed = pollMsg({ closes: 1 });
    expect(state([closed, ev(B, 'vote', { target: closed.id, choices: [0] })]).votes.size).toBe(0);
    expect(pollOpen(undefined, 5)).toBe(true);
    expect(pollOpen(5, 4)).toBe(true);
    expect(pollOpen(5, 5)).toBe(false);
  });

  it('closes at its own time, whatever the voter’s clock says now', () => {
    const p = pollMsg();
    const at = p.ts + 5000;
    const q = ev(A, 'msg', { text: 'q', poll: { q: 'q', options: ['a', 'b'], closes: at } }, { ch: 'general' });
    const early = ev(B, 'vote', { target: q.id, choices: [0] });
    later(10_000);
    const late = ev(C, 'vote', { target: q.id, choices: [1] });
    expect(pollTally(state([q, early, late]), q.id).options.map((o) => o.count)).toEqual([1, 0]);
  });

  it('drop malformed polls and votes on anything else', () => {
    const bad = ev(A, 'msg', { text: 'x', poll: { q: 'x', options: ['only one'] } }, { ch: 'general' });
    const plain = ev(A, 'msg', { text: 'plain' }, { ch: 'general' });
    const s = state([
      bad,
      plain,
      ev(B, 'vote', { target: bad.id, choices: [0] }),
      ev(B, 'vote', { target: plain.id, choices: [0] }),
      ev(B, 'vote', { target: 'nope', choices: [0] }),
    ]);
    expect(s.msgs.get(bad.id)?.poll).toBeUndefined();
    expect(s.votes.size).toBe(0);
    expect(pollTally(s, 'nope')).toEqual({ options: [], total: 0 });
  });

  it('keep DM votes as private as the poll', () => {
    const ch = dmChannel(A.pub, B.pub);
    const p = ev(A, 'msg', { text: 'q', poll: { q: 'q', options: ['a', 'b'] } }, { ch, to: B.pub });
    const s = state([
      p,
      ev(B, 'vote', { target: p.id, choices: [0] }), // public: would leak the vote to the workspace
      ev(C, 'vote', { target: p.id, choices: [1] }, { to: B.pub }), // not one of the pair
      ev(B, 'vote', { target: p.id, choices: [1] }, { to: A.pub }),
    ]);
    expect(pollTally(s, p.id).options.map((o) => o.count)).toEqual([0, 1]);
    const pub = pollMsg();
    expect(state([pub, ev(B, 'vote', { target: pub.id, choices: [0] }, { to: A.pub })]).votes.size).toBe(0);
  });

  it('ignore votes on deleted polls', () => {
    const p = pollMsg();
    expect(state([p, ev(A, 'del', { target: p.id }), ev(B, 'vote', { target: p.id, choices: [0] })]).votes.size).toBe(0);
  });
});

describe('meetings and decisions', () => {
  it('collect RSVPs, latest per member or agent', () => {
    const m = ev(A, 'msg', { text: 'Sync', meet: { title: 'Sync', at: 1_800_000_000_000, dur: 30 } }, { ch: 'general' });
    const plain = ev(A, 'msg', { text: 'hi' }, { ch: 'general' });
    const s = state([
      m,
      plain,
      ev(B, 'rsvp', { target: m.id, going: 'maybe' }),
      ev(B, 'rsvp', { target: m.id, going: 'yes' }),
      ev(B, 'rsvp', { target: m.id, going: 'no' }, { ag: 'scout' }),
      ev(C, 'rsvp', { target: plain.id, going: 'yes' }),
      ev(C, 'rsvp', { target: m.id, going: 'sure' }),
    ]);
    expect(s.msgs.get(m.id)?.meet).toEqual({ title: 'Sync', at: 1_800_000_000_000, dur: 30 });
    expect([...(s.rsvps.get(m.id) ?? [])]).toEqual([
      [B.pub, 'yes'],
      [agentOf(B.pub, 'scout'), 'no'],
    ]);
    expect(s.rsvps.has(plain.id)).toBe(false);
  });

  it('record decisions on messages, and take them back', () => {
    const m = ev(A, 'msg', { text: 'We ship Friday' }, { ch: 'general' });
    const s = state([m, ev(B, 'decide', { target: m.id, text: '', on: true }, { ag: 'scout' })]);
    expect(s.decisions.get(m.id)).toMatchObject({ target: m.id, ch: 'general', text: 'We ship Friday', a: B.pub, ag: 'scout' });
    expect(state([m, ev(A, 'decide', { target: m.id, text: 'Friday it is', on: true })]).decisions.get(m.id)?.text).toBe('Friday it is');
    expect(state([m, ev(A, 'decide', { target: m.id, text: 'x', on: true }), ev(B, 'decide', { target: m.id, text: '', on: false })]).decisions.size).toBe(0);
    expect(state([ev(A, 'decide', { target: 'nope', text: 'x', on: true })]).decisions.size).toBe(0);
  });
});

describe('docs', () => {
  const doc = (kind?: string, id = 'd1') => ev(A, 'doc', { id, title: 'Spec', ch: 'general', ...(kind ? { kind } : {}) });

  it('merge edits from everyone into one text, whatever order they arrive in', () => {
    const d = doc();
    const first = textOp([], 'Hello world');
    expect(first).not.toBeNull();
    const ops = [first ?? ''];
    const mine = textOp(ops, 'Hello brave world') ?? '';
    const theirs = textOp(ops, 'Hello world!') ?? '';
    const evs = [d, ev(A, 'doc.op', { doc: 'd1', u: ops[0] }), ev(A, 'doc.op', { doc: 'd1', u: mine }), ev(B, 'doc.op', { doc: 'd1', u: theirs }, { ag: 'scout' })];
    const s = state(evs);
    const sd = s.docs.get('d1');
    expect(sd && docText(sd.ops)).toBe('Hello brave world!');
    expect(docText([...(sd?.ops ?? [])].reverse())).toBe('Hello brave world!');
    expect(sd?.editors).toEqual([A.pub, agentOf(B.pub, 'scout')]);
    expect(sd?.kind).toBe('text');
    expect(textOp(sd?.ops ?? [], 'Hello brave world!')).toBeNull();
    expect(docText([...(sd?.ops ?? []), textOp(sd?.ops ?? [], 'Bye') ?? ''])).toBe('Bye');
  });

  it('skip ops that don’t decode, and docs and ops that don’t belong', () => {
    const d = doc('weird');
    const u = textOp([], 'x') ?? '';
    const s = state([
      d,
      doc(undefined, 'd2'),
      ev(B, 'doc', { id: 'd1', title: 'Again', ch: 'general', kind: 'board' }),
      ev(A, 'doc', { id: 'd3', title: 'Nowhere', ch: 'nope' }),
      ev(A, 'doc.op', { doc: 'nope', u }),
      ev(A, 'doc.op', { doc: 'd1', u: 'not base64!' }),
      ev(A, 'doc.op', { doc: 'd1', u: 'AAAA' }),
      ev(A, 'doc.op', { doc: 'd1', u }),
    ]);
    expect(s.docs.get('d1')?.title).toBe('Spec');
    expect(s.docs.get('d1')?.kind).toBe('text');
    expect(s.docs.has('d3')).toBe(false);
    expect(s.docs.get('d1')?.ops).toHaveLength(2);
    expect(docText(s.docs.get('d1')?.ops ?? [])).toBe('x');
  });

  it('rename and archive; archived docs take no edits or suggestions', () => {
    const s = state([
      doc(),
      ev(B, 'doc.set', { id: 'd1', title: 'Spec v2' }),
      ev(B, 'doc.set', { id: 'nope', title: 'x' }),
      ev(A, 'doc.set', { id: 'd1', archived: true }),
      ev(A, 'doc.op', { doc: 'd1', u: textOp([], 'x') ?? '' }),
      ev(A, 'suggest', { doc: 'd1', find: '', replace: 'x' }),
    ]);
    expect(s.docs.get('d1')).toMatchObject({ title: 'Spec v2', archived: true, ops: [], suggestions: [] });
  });

  it('take suggestions that people accept or reject, never agents', () => {
    const sug = ev(B, 'suggest', { doc: 'd1', find: 'teh', replace: 'the', note: 'typo' }, { ag: 'scout' });
    const other = ev(B, 'suggest', { doc: 'd1', find: '', replace: 'More' });
    const onBoard = ev(B, 'suggest', { doc: 'b1', find: '', replace: 'x' });
    const s = state([
      doc(),
      doc('board', 'b1'),
      sug,
      other,
      onBoard,
      ev(B, 'suggest.res', { target: sug.id, accept: true }, { ag: 'scout' }),
      ev(C, 'suggest.res', { target: sug.id, accept: true }),
      ev(A, 'suggest.res', { target: sug.id, accept: false }),
      ev(B, 'suggest.res', { target: other.id, accept: false }),
    ]);
    expect(s.docs.get('d1')?.suggestions.map((x) => [x.status, x.by, x.note, x.ag])).toEqual([
      ['accepted', C.pub, 'typo', 'scout'],
      ['rejected', B.pub, undefined, undefined],
    ]);
    expect(s.docs.get('b1')?.suggestions).toEqual([]);
  });

  it('apply suggestions to text', () => {
    expect(applySuggestion('teh cat', 'teh', 'the')).toBe('the cat');
    expect(applySuggestion('a', 'zz', 'b')).toBeNull();
    expect(applySuggestion('', '', 'first')).toBe('first');
    expect(applySuggestion('a\n\n', '', 'b')).toBe('a\nb');
  });
});

describe('boards', () => {
  it('hold sticky notes that anyone adds, moves and removes', () => {
    const add1 = notePutOp([], { id: 'n2', text: 'Idea', x: 10, y: 20, color: 'pink', by: A.pub });
    const add2 = notePutOp([add1], { id: 'n1', text: 'Other', x: 0, y: 0, color: 'blue', by: B.pub });
    const moved = notePutOp([add1, add2], { id: 'n2', text: 'Idea', x: 50, y: 60, color: 'pink', by: A.pub });
    const ops = [add1, add2, moved];
    expect(boardNotes(ops).map((n) => [n.id, n.x, n.color])).toEqual([
      ['n1', 0, 'blue'],
      ['n2', 50, 'pink'],
    ]);
    expect(boardNotes([...ops, noteRemoveOp(ops, 'n1') ?? ''])).toHaveLength(1);
    expect(noteRemoveOp(ops, 'missing')).toBeNull();
  });

  it('skip notes that peers wrote badly, and default missing colors', () => {
    const d = new Y.Doc();
    const notes = d.getMap('notes');
    notes.set('zz', { text: 'last', x: 0, y: 0 });
    notes.set('bad', { text: 5 });
    notes.set('ok', { text: 'hi', x: 1, y: 2, color: 'neon' });
    const ops = [b64(Y.encodeStateAsUpdate(d))];
    expect(boardNotes(ops).map((n) => [n.id, n.color, n.by])).toEqual([
      ['ok', 'yellow', ''],
      ['zz', 'yellow', ''],
    ]);
    expect(ydoc(ops).getMap('notes').size).toBe(3);
  });
});

describe('private to my devices', () => {
  it('saved messages and read markers only count when addressed to myself', () => {
    const s = state([
      ev(A, 'save', { target: 'm1', on: true }, { to: A.pub }),
      ev(A, 'save', { target: 'm2', on: true }, { to: A.pub }),
      ev(A, 'save', { target: 'm1', on: false }, { to: A.pub }),
      ev(A, 'save', { target: 'm3', on: true }, { to: A.pub }),
      ev(A, 'save', { target: 'm9', on: true }), // public: would tell everyone what I saved
      ev(A, 'save', { target: 'm9', on: true }, { to: A.pub, ch: 'general' }),
      ev(B, 'save', { target: 'm9', on: true }, { to: A.pub }),
      ev(A, 'read', { ch: 'general', ts: 50 }, { to: A.pub }),
      ev(A, 'read', { ch: 'general', ts: 20 }, { to: A.pub }),
      ev(A, 'read', { ch: 'random', ts: 7 }, { to: A.pub }),
      ev(A, 'read', { ch: 'general', ts: 99 }),
    ]);
    expect(s.saved.get(A.pub)).toEqual(['m2', 'm3']);
    expect(s.saved.has(B.pub)).toBe(false);
    expect([...(s.reads.get(A.pub) ?? [])]).toEqual([
      ['general', 50],
      ['random', 7],
    ]);
  });
});

describe('helpers', () => {
  it('split actors and make ids', () => {
    expect(actorParts(A.pub)).toEqual({ pub: A.pub });
    expect(actorParts(agentOf(A.pub, 'scout'))).toEqual({ pub: A.pub, agentId: 'scout' });
    expect(newId()).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(newId()).not.toBe(newId());
  });

  it('parse what members are looking at and their caret', () => {
    expect(parseOr(PresenceSchema, { pub: A.pub, view: 'doc:d1', focus: true, cur: { doc: 'd1', line: 3 }, agents: { scout: { working: 'general', on: 'task:t1' } } })).toEqual({
      pub: A.pub,
      st: 'online',
      typing: undefined,
      agents: { scout: { working: 'general', on: 'task:t1' } },
      bridge: undefined,
      rtc: undefined,
      view: 'doc:d1',
      focus: true,
      cur: { doc: 'd1', line: 3 },
    });
    expect(parseOr(PresenceSchema, { pub: A.pub, view: 5, focus: 'yes', cur: { doc: 'd1', line: -1 } })).toMatchObject({ view: undefined, focus: undefined, cur: undefined });
  });
});
