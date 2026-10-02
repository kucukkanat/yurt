import { describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { boardNotes, docText, notePutOp, textOp } from '@yurt/protocol';
import { createWorkspace, expectText, getPeer, me, member, startApp, until, useApp } from '../app';
import { must as mustBe } from '../../../../src/ui/must';
const must = <T,>(x: T | null | undefined, what = 'value'): T => mustBe(x, what);

// Tasks, polls, meetings, decisions, saved messages, docs and boards, and who's where: driven like a user would,
// with other members (and my bridge's agents) played by real peers on the local relay.
let code = '';
let bo: Awaited<ReturnType<typeof member>>;
let bridge: Awaited<ReturnType<typeof member>>;
const state = () => useApp.getState().states[code];
const hub = () => page.getByRole('complementary', { name: 'Hub' });
const docPanel = () => page.getByRole('complementary', { name: 'Doc' });
const dialog = () => page.getByRole('dialog');
const msg = (text: string | RegExp) => page.getByRole('article').filter({ hasText: text });
async function hover(text: string | RegExp) {
  const m = msg(text);
  await expect.element(m).toBeVisible();
  m.element().scrollIntoView({ block: 'center' });
  await m.hover();
  return m;
}
const openHub = async (tab: string) => {
  useApp.getState().setPanel({ type: 'work', id: tab });
  await expect.element(hub()).toBeVisible();
};
const tasks = () => [...(state()?.tasks.values() ?? [])];

describe('tasks', () => {
  it('start empty, and are made in the hub with an assignee and a due date', async () => {
    await startApp({ as: 'Ada' });
    code = await createWorkspace('Northwind');
    bo = await member(code, 'Bo');
    bridge = await member(code, 'bridge', me(), { profile: false });
    bridge.publish({ t: 'agent', b: { id: 'scout', name: 'Scout', handle: 'scout', runtime: 'copilot', replyIn: 'channel' } });
    await until(() => state()?.agents.size === 1);
    await page.getByTestId('hub-button').click();
    await expect.element(hub().getByText(/No tasks yet/)).toBeVisible();
    await hub().getByRole('button', { name: 'Task' }).click();
    await dialog().getByTestId('collab-create').click();
    await expect.element(dialog().getByText('Give it a title.')).toBeVisible();
    await dialog().getByLabelText('Title').fill('Write the launch brief');
    await dialog().getByLabelText('Assignee').selectOptions(bo.who.pub);
    await dialog().getByLabelText(/^Due/).fill('2030-05-04T10:00');
    await dialog().getByTestId('collab-create').click();
    await until(() => tasks().length === 1);
    expect(tasks()[0]).toMatchObject({ title: 'Write the launch brief', assignee: bo.who.pub, ch: 'general' });
    await expectText(hub(), /Everyone else’s · 1/);
    await expectText(hub(), /Due (4 May|May 4)/);
  });

  it('change status, assignee and due date, and keep their activity', async () => {
    const t = tasks()[0];
    if (!t) throw new Error('no task');
    const row = page.getByTestId('task-' + t.id);
    await row.getByRole('button', { name: /Write the launch brief/ }).click();
    await row.getByLabelText('Assignee').selectOptions(me().pub + '/scout');
    await until(() => state()?.tasks.get(t.id)?.assignee === me().pub + '/scout');
    await expectText(hub(), /Yours and your agents’ · 1/);
    await row.getByLabelText('Status').selectOptions('blocked');
    await until(() => state()?.tasks.get(t.id)?.status === 'blocked');
    await row.getByLabelText('Due').fill('');
    await until(() => state()?.tasks.get(t.id)?.due === undefined);
    // The agent reports back (through my bridge, signing as me).
    bridge.publish({ t: 'task.set', ag: 'scout', b: { id: t.id, status: 'doing', note: 'drafting now' } });
    await expectText(row.getByTestId('task-activity'), /Scout: In progress · drafting now/);
    await row.getByRole('checkbox').click();
    await until(() => state()?.tasks.get(t.id)?.status === 'done');
    await expectText(hub(), /Done · 1/);
    await row.getByLabelText('Assignee').selectOptions('');
    await until(() => state()?.tasks.get(t.id)?.assignee === undefined);
    await expectText(row.getByTestId('task-activity'), /unassigned/);
    await row.getByRole('checkbox').click(); // not done after all
    await until(() => state()?.tasks.get(t.id)?.status === 'open');
    await row.getByRole('button', { name: /Write the launch brief/ }).click(); // closes it
    await expect.element(row.getByLabelText('Status')).not.toBeInTheDocument();
  });

  it('show whose they are and when they’re late, for me and for others’ agents', async () => {
    bo.publish({ t: 'agent', b: { id: 'helper', name: 'Helper', handle: 'helper', runtime: 'copilot', replyIn: 'channel' } });
    await until(() => state()?.agents.size === 2);
    useApp.getState().createTask('general', 'Overdue thing', { assignee: me().pub, due: Date.now() - 3 * 86_400_000 });
    await expectText(hub(), /Overdue · /);
    await expectText(hub(), /Yours and your agents’ · 1/);
    const late = must(tasks().find((t) => t.title === 'Overdue thing'));
    await page
      .getByTestId('task-' + late.id)
      .getByRole('button', { name: /Overdue thing/ })
      .click();
    await page
      .getByTestId('task-' + late.id)
      .getByLabelText('Assignee')
      .selectOptions(bo.who.pub + '/helper');
    await until(() => state()?.tasks.get(late.id)?.assignee === bo.who.pub + '/helper');
    await expectText(page.getByTestId('task-' + late.id), /Helper/);
  });

  it('come from messages, and lead back to them', async () => {
    const m = await bo.say({ t: 'msg', ch: 'general', b: { text: 'Someone should book the venue' } });
    await hover('Someone should book the venue');
    await page.getByTestId('msg-task').click();
    await expect.element(dialog().getByLabelText('Title')).toHaveValue('Someone should book the venue');
    await dialog().getByTestId('collab-create').click();
    await until(() => tasks().some((t) => t.src === m.id));
    const t = tasks().find((x) => x.src === m.id);
    await openHub('tasks');
    await page
      .getByTestId('task-' + t?.id)
      .getByRole('button', { name: /book the venue/ })
      .click();
    await page
      .getByTestId('task-' + t?.id)
      .getByRole('button', { name: 'Open the conversation' })
      .click();
    await until(() => useApp.getState().route.thread === m.id);
    // From a reply in a thread: back to that thread.
    const reply = await bo.say({ t: 'msg', ch: 'general', b: { text: 'and the caterer', parent: m.id } });
    const fromReply = must(useApp.getState().createTask('general', 'Call the caterer', { src: reply.id }));
    useApp.getState().go({ code, ch: 'general' });
    await openHub('tasks');
    await page
      .getByTestId('task-' + fromReply)
      .getByRole('button', { name: /Call the caterer/ })
      .click();
    await page
      .getByTestId('task-' + fromReply)
      .getByRole('button', { name: 'Open the conversation' })
      .click();
    await until(() => useApp.getState().route.thread === m.id && useApp.getState().route.ch === 'general');
    // Only this channel's tasks.
    useApp.getState().go({ code, ch: 'general' });
    await openHub('tasks');
    await hub().getByLabelText('Only #general').click();
    await expectText(hub(), /book the venue/);
  });

  it('show which task an agent works on', async () => {
    const t = tasks()[0];
    bridge.setPresence({ st: 'online', bridge: true, agents: { scout: { working: 'general', on: 'task:' + t?.id } } });
    useApp.getState().setPanel({ type: 'members' });
    await expect.element(page.getByText(/Yours · on task “Write the launch brief”/)).toBeVisible();
    bridge.setPresence({ st: 'online', bridge: true, agents: { scout: { working: null } } });
  });

  it('are made in #general from a private conversation', async () => {
    useApp.getState().go({ code, ch: 'dm:' + [me().pub, bo.who.pub].sort().join(':') });
    await openHub('tasks');
    await hub().getByRole('button', { name: 'Task' }).click();
    await expect.element(dialog().getByText('In #general')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    useApp.getState().go({ code, ch: 'general' });
  });
});

describe('polls', () => {
  it('need a question and two options', async () => {
    await openHub('tasks');
    await hub().getByRole('button', { name: 'Poll' }).click();
    await dialog().getByTestId('collab-create').click();
    await expect.element(dialog().getByText('Ask a question.')).toBeVisible();
    await dialog().getByLabelText('Question').fill('Where to?');
    await dialog().getByTestId('poll-options').fill('Lisbon\n\nLisbon');
    await dialog().getByTestId('collab-create').click();
    await expect.element(dialog().getByText(/at least two options/)).toBeVisible();
    await dialog().getByTestId('poll-options').fill('Lisbon\nOslo\nRome');
    await dialog().getByTestId('collab-create').click();
    await expect.element(page.getByTestId('poll')).toBeVisible();
    // Several choices, closing later.
    useApp.getState().openCollab({ kind: 'poll', ch: 'general' });
    await dialog().getByLabelText('Question').fill('Which days?');
    await dialog().getByTestId('poll-options').fill('Mon\nTue');
    await dialog().getByLabelText('Allow several choices').click();
    await dialog()
      .getByLabelText(/^Closes/)
      .fill('2031-02-03T10:00');
    await dialog().getByTestId('collab-create').click();
    await until(() => [...(state()?.msgs.values() ?? [])].some((m) => m.poll?.q === 'Which days?' && m.poll.multi && !!m.poll.closes));
  });

  it('count votes live; mine can change or be taken back', async () => {
    const poll = page.getByTestId('poll').filter({ hasText: 'Where to?' });
    await poll.getByTestId('poll-option-1').click();
    await expectText(poll.getByTestId('poll-status'), /^1 vote$/);
    await poll.getByTestId('poll-option-2').click(); // one choice: moves my vote
    const m = [...(state()?.msgs.values() ?? [])].find((x) => x.poll?.q === 'Where to?');
    await until(
      () =>
        state()
          ?.votes.get(m?.id ?? '')
          ?.get(me().pub)?.[0] === 2,
    );
    bo.publish({ t: 'vote', b: { target: m?.id, choices: [2] } });
    await expectText(poll.getByTestId('poll-status'), /^2 votes$/);
    await poll.getByTestId('poll-option-2').click(); // takes mine back
    await expectText(poll.getByTestId('poll-status'), /^1 vote$/);
  });

  it('take several choices, and stop at their closing time', async () => {
    useApp.getState().postPoll('general', { q: 'Snacks?', options: ['Chips', 'Fruit'], multi: true });
    const poll = page.getByTestId('poll').filter({ hasText: 'Snacks?' });
    await poll.getByTestId('poll-option-0').click();
    await poll.getByTestId('poll-option-1').click();
    await expectText(poll.getByTestId('poll-status'), /1 vote · several choices/);
    await poll.getByTestId('poll-option-0').click();
    const m = [...(state()?.msgs.values() ?? [])].find((x) => x.poll?.q === 'Snacks?');
    await until(
      () =>
        state()
          ?.votes.get(m?.id ?? '')
          ?.get(me().pub)
          ?.join() === '1',
    );
    useApp.getState().postPoll('general', { q: 'Closed one', options: ['a', 'b'], closes: Date.now() - 1000 });
    useApp.getState().postPoll('general', { q: 'Open till later', options: ['a', 'b'], closes: Date.now() + 3_600_000 });
    await expectText(page.getByTestId('poll').filter({ hasText: 'Closed one' }).getByTestId('poll-status'), /closed/);
    await expect.element(page.getByTestId('poll').filter({ hasText: 'Closed one' }).getByTestId('poll-option-0')).toBeDisabled();
    await expectText(page.getByTestId('poll').filter({ hasText: 'Open till later' }).getByTestId('poll-status'), /closes /);
  });
});

describe('meetings', () => {
  it('need a start, and collect answers', async () => {
    await openHub('tasks');
    await hub().getByRole('button', { name: 'Meeting' }).click();
    await dialog().getByLabelText('Title').fill('Launch sync');
    await dialog().getByTestId('collab-create').click();
    await expect.element(dialog().getByText('Pick when it starts.')).toBeVisible();
    await dialog().getByLabelText('Starts').fill('2031-01-01T09:00');
    await dialog().getByLabelText('Minutes').fill('45');
    await dialog().getByLabelText('Title').click();
    await userEvent.keyboard('{Enter}'); // the form submits too
    const card = page.getByTestId('meeting').filter({ hasText: 'Launch sync' });
    await expectText(card, /45 min/);
    await card.getByTestId('rsvp-yes').click();
    await expectText(card.getByTestId('rsvp-yes'), /Going · 1/);
    await card.getByTestId('rsvp-maybe').click();
    await expectText(card.getByTestId('rsvp-maybe'), /Maybe · 1/);
    await expectText(card.getByTestId('rsvp-yes'), /Going · 0/);
  });

  it('show when they’re on now', async () => {
    useApp.getState().postMeeting('general', { title: 'Standup now', at: Date.now() - 60_000, dur: 15 });
    const card = page.getByTestId('meeting').filter({ hasText: 'Standup now' });
    await expect.element(card.getByText('Now')).toBeVisible();
  });

  it('end, and can leave their length out', async () => {
    useApp.getState().openCollab({ kind: 'meet', ch: 'general' });
    await dialog().getByLabelText('Title').fill('Last week’s retro');
    await dialog().getByLabelText('Starts').fill('2020-01-01T09:00');
    await dialog().getByLabelText('Minutes').fill('');
    await dialog().getByTestId('collab-create').click();
    await until(() => [...(state()?.msgs.values() ?? [])].some((m) => m.meet?.title === 'Last week’s retro' && m.meet.dur === undefined));
    await expect.element(page.getByTestId('meeting').filter({ hasText: 'Last week’s retro' }).getByTestId('meeting-when')).toBeVisible();
  });
});

describe('decisions and saved messages', () => {
  it('mark a message as decided, list it, and take it back', async () => {
    await bo.say({ t: 'msg', ch: 'general', b: { text: 'Lisbon it is, everyone agreed' } });
    await hover('Lisbon it is');
    await page.getByTestId('msg-decision').click();
    await expectText(msg('Lisbon it is').getByTestId('decision'), /Decided: Lisbon it is, everyone agreed · Ada/);
    await openHub('decisions');
    await hub()
      .getByRole('button', { name: /Lisbon it is/ })
      .first()
      .click();
    await until(() => useApp.getState().highlight !== null);
    await hover('Lisbon it is');
    await page.getByTestId('msg-decision').click();
    await expect.element(msg('Lisbon it is').getByTestId('decision')).not.toBeInTheDocument();
    // An agent can record one too.
    const agentSays = await bridge.say({ t: 'msg', ch: 'general', ag: 'scout', b: { text: 'Summary: we ship Friday' } });
    bridge.publish({ t: 'decide', ag: 'scout', b: { target: agentSays.id, text: 'Ship Friday', on: true } });
    await expectText(msg('Summary: we ship Friday').getByTestId('decision'), /Decided: Ship Friday · Scout/);
    // The log lists the latest first; its tab is one click away.
    useApp.getState().decide(must([...(state()?.msgs.values() ?? [])].find((m) => m.text.startsWith('Lisbon it is'))), true);
    await openHub('tasks');
    await hub()
      .getByRole('tab', { name: /Decided/ })
      .click();
    await expectText(hub(), /Lisbon it is.*Ship Friday/s);
  });

  it('save messages privately and list them', async () => {
    await openHub('saved');
    await expect.element(hub().getByText(/Save messages for later/)).toBeVisible();
    await hover('Someone should book the venue');
    await page.getByTestId('msg-save').click();
    await expect.element(page.getByText('Saved for later')).toBeVisible();
    await expectText(hub(), /book the venue/);
    await until(() => !!getPeer(code)?.queued.size === false);
    const ev = [...(getPeer(code)?.events.values() ?? [])].find((e) => e.t === 'save');
    expect(ev?.to).toBe(me().pub); // private to my own devices
    await hub().getByRole('button', { name: 'Remove from saved' }).click();
    await expect.element(hub().getByText(/Save messages for later/)).toBeVisible();
    // An agent's message, and a thread reply (which opens in its thread).
    await hover('Summary: we ship Friday');
    await page.getByTestId('msg-save').click();
    await expectText(hub(), /Scout · /);
    const reply = must([...(state()?.msgs.values() ?? [])].find((m) => m.text === 'and the caterer'));
    useApp.getState().save(reply.id, true);
    await expectText(hub(), /and the caterer/);
    await hub()
      .getByRole('button', { name: /and the caterer/ })
      .click();
    await until(() => useApp.getState().route.thread === reply.parent);
    useApp.getState().go({ code, ch: 'general' });
  });
});

describe('docs', () => {
  it('are written together: my typing and others’ edits merge', async () => {
    await openHub('docs');
    await expect.element(hub().getByText(/No docs or boards yet/)).toBeVisible();
    await hub().getByRole('button', { name: 'Doc' }).click();
    await dialog().getByLabelText('Title').fill('Launch plan');
    await dialog().getByTestId('collab-create').click();
    await expect.element(docPanel()).toBeVisible();
    await until(() => state()?.docs.size === 1);
    const d = [...(state()?.docs.values() ?? [])][0];
    if (!d) throw new Error('no doc');
    const area = page.getByTestId('doc-text');
    await area.fill('Goals\nShip in May');
    await until(() => docText(state()?.docs.get(d.id)?.ops ?? []) === 'Goals\nShip in May');
    // Bo appends at the same time; both survive.
    const ops = state()?.docs.get(d.id)?.ops ?? [];
    bo.publish({ t: 'doc.op', b: { doc: d.id, u: textOp(ops, 'Goals\nShip in May\nBudget: small') } });
    await expect.element(area).toHaveValue('Goals\nShip in May\nBudget: small');
    // Typing goes out when I leave the field, without waiting for the pause.
    await area.fill('Goals\nShip in May\nBudget: small\nRisks');
    await page.getByTestId('doc-title').click();
    await until(() => docText(state()?.docs.get(d.id)?.ops ?? []).endsWith('Risks'));
    await userEvent.keyboard('{Escape}');
  });

  it('show who’s in them and where their cursor is', async () => {
    const d = [...(state()?.docs.values() ?? [])][0];
    bo.setPresence({ st: 'online', view: 'doc:' + d?.id, cur: { doc: d?.id ?? '', line: 1 } });
    await expectText(page.getByTestId('doc-cursors'), /Bo · line 2/);
    await expect.element(page.getByTestId('doc-viewers')).toBeVisible();
    bridge.setPresence({ st: 'online', bridge: true, agents: { scout: { working: 'general', on: 'doc:' + d?.id } } });
    await expect.element(docPanel().getByText('Scout is working')).toBeVisible();
    await openHub('docs');
    await expectText(hub(), /2 here/);
    bridge.setPresence({ st: 'online', bridge: true, agents: { scout: { working: null } } });
  });

  it('take suggestions that I accept or reject', async () => {
    const d = [...(state()?.docs.values() ?? [])][0];
    if (!d) throw new Error('no doc');
    useApp.getState().setPanel({ type: 'doc', id: d.id });
    bridge.publish({ t: 'suggest', ag: 'scout', b: { doc: d.id, find: 'small', replace: 'modest', note: 'tone' } });
    bo.publish({ t: 'suggest', b: { doc: d.id, find: 'Goals', replace: 'Aims' } });
    await until(() => state()?.docs.get(d.id)?.suggestions.length === 2);
    await expect.element(page.getByTestId('suggestion').first()).toBeVisible();
    await expectText(page.getByTestId('suggestion').first(), /Scout suggests: tone/);
    await page.getByTestId('suggestion').first().getByTestId('suggestion-accept').click();
    await expect.element(page.getByTestId('doc-text')).toHaveValue('Goals\nShip in May\nBudget: modest\nRisks');
    await page.getByTestId('suggestion-reject').click();
    await until(
      () =>
        state()
          ?.docs.get(d.id)
          ?.suggestions.every((x) => x.status !== 'open') === true,
    );
    // A suggestion whose text is gone can't be accepted.
    bo.publish({ t: 'suggest', b: { doc: d.id, find: 'nowhere', replace: 'x' } });
    await page.getByTestId('suggestion-accept').click();
    await expect.element(page.getByText('That text has changed since')).toBeVisible();
  });

  it('send what I typed when I close them', async () => {
    const d = must([...(state()?.docs.values() ?? [])][0]);
    useApp.getState().setPanel({ type: 'doc', id: d.id });
    await page.getByTestId('doc-text').fill('Goals\nShip in May\nBudget: modest\nRisks\nOwner: Ada');
    useApp.getState().setPanel({ type: null });
    await until(() => docText(state()?.docs.get(d.id)?.ops ?? []).endsWith('Owner: Ada'));
    useApp.getState().setPanel({ type: 'doc', id: d.id });
    await expect.element(page.getByTestId('doc-text')).toHaveValue('Goals\nShip in May\nBudget: modest\nRisks\nOwner: Ada');
  });

  it('are listed, newest edit first, and open from the list', async () => {
    const d = must([...(state()?.docs.values() ?? [])][0]);
    useApp.getState().createDoc('general', 'Notes', 'text');
    await until(() => state()?.docs.size === 2);
    await docPanel().getByRole('button', { name: 'Back to docs' }).click();
    await expectText(hub(), /Notes.*Launch plan/s);
    await page.getByTestId('doc-' + d.id).click();
    await expect.element(page.getByTestId('doc-title')).toHaveTextContent('Launch plan');
  });

  it('can be renamed and archived', async () => {
    // Opening the title and leaving it as it was (or empty) changes nothing.
    await page.getByTestId('doc-title').click();
    await page.getByTestId('doc-text').click();
    await expect.element(page.getByTestId('doc-title')).toHaveTextContent('Launch plan');
    await page.getByTestId('doc-title').click();
    await docPanel().getByLabelText('Title').fill('');
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByTestId('doc-title')).toHaveTextContent('Launch plan');
    await page.getByTestId('doc-title').click();
    await docPanel().getByLabelText('Title').fill('Launch plan v2');
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByTestId('doc-title')).toHaveTextContent('Launch plan v2');
    await docPanel().getByRole('button', { name: 'Archive' }).click();
    await expect.element(hub()).toBeVisible();
    await expect.element(hub().getByText('Launch plan v2')).not.toBeInTheDocument();
    useApp.getState().archiveDoc(must([...(state()?.docs.values() ?? [])].find((x) => x.title === 'Notes')).id);
    await expect.element(hub().getByText(/No docs or boards yet/)).toBeVisible();
  });
});

describe('boards', () => {
  it('hold notes that anyone adds, writes, recolors, moves and removes', async () => {
    useApp.getState().openCollab({ kind: 'board', ch: 'general' });
    await dialog().getByLabelText('Title').fill('Ideas');
    await dialog().getByTestId('collab-create').click();
    await expect.element(page.getByText(/An empty board/)).toBeVisible();
    await page.getByTestId('board-add').click();
    const d = [...(state()?.docs.values() ?? [])].find((x) => x.kind === 'board');
    if (!d) throw new Error('no board');
    const note = page.getByRole('textbox', { name: 'Note' });
    await note.fill('Rooftop party');
    await page.getByTestId('board').click({ position: { x: 400, y: 400 } });
    await expect.element(note).toHaveValue('Rooftop party');
    await page.getByRole('button', { name: 'Color pink' }).click();
    await until(() => (state()?.docs.get(d.id)?.ops.length ?? 0) >= 3);
    // Bo adds one from elsewhere.
    bo.publish({ t: 'doc.op', b: { doc: d.id, u: notePutOp(state()?.docs.get(d.id)?.ops ?? [], { id: 'zz', text: 'Boat trip', x: 300, y: 20, color: 'blue', by: bo.who.pub }) } });
    await expect.element(page.getByTestId('note-zz')).toBeVisible();
    // Drag the first note somewhere else (a click on its handle moves nothing).
    const before = state()?.docs.get(d.id)?.ops.length ?? 0;
    await page
      .getByTitle('Drag to move')
      .first()
      .click({ position: { x: 100, y: 6 } });
    await userEvent.dragAndDrop(page.getByTitle('Drag to move').first(), page.getByTestId('board'), { sourcePosition: { x: 100, y: 6 }, targetPosition: { x: 420, y: 300 } });
    await until(() => (state()?.docs.get(d.id)?.ops.length ?? 0) === before + 1);
    await page.getByTestId('note-zz').getByRole('button', { name: 'Remove note' }).click();
    await expect.element(page.getByTestId('note-zz')).not.toBeInTheDocument();
    await until(() => !boardNotes(state()?.docs.get(d.id)?.ops ?? []).some((n) => n.id === 'zz'));
    useApp.getState().removeNote(must(state()?.docs.get(d.id)), 'zz'); // already gone: nothing to send
    await openHub('docs');
    await expect.element(page.getByTestId('doc-' + d.id)).toBeVisible();
  });

  it('keep my typing in a note when someone else changes it meanwhile', async () => {
    const d = must([...(state()?.docs.values() ?? [])].find((x) => x.kind === 'board'));
    useApp.getState().setPanel({ type: 'doc', id: d.id });
    const note = page.getByRole('textbox', { name: 'Note' }).first();
    await note.fill('Mine, half typed');
    const first = must(state()?.docs.get(d.id)?.ops);
    const id = must(boardNotes(first)[0], 'a note').id;
    bo.publish({ t: 'doc.op', b: { doc: d.id, u: notePutOp(first, { id, text: 'Theirs', x: 20, y: 20, color: 'green', by: bo.who.pub }) } });
    await until(() => (state()?.docs.get(d.id)?.ops.length ?? 0) > first.length);
    await expect.element(note).toHaveValue('Mine, half typed');
  });
});

describe('who’s where', () => {
  it('shows who else is in a channel, and follows them', async () => {
    useApp.getState().setPanel({ type: null });
    bo.setPresence({ st: 'online', view: 'general' });
    const cy = await member(code, 'Cy');
    cy.setPresence({ st: 'online', view: 'general' });
    await expectText(page.getByTestId('viewers'), /2 here/);
    useApp.getState().setPanel({ type: 'profile', id: bo.who.pub });
    await page.getByTestId('follow').click();
    await expect.element(page.getByTestId('follow-bar')).toBeVisible();
    const root = await bo.say({ t: 'msg', ch: 'general', b: { text: 'look at this thread' } });
    bo.setPresence({ st: 'online', view: 'thread:' + root.id });
    await until(() => useApp.getState().route.thread === root.id);
    const board = [...(state()?.docs.values() ?? [])].find((x) => x.kind === 'board');
    bo.setPresence({ st: 'online', view: 'doc:' + board?.id });
    await until(() => useApp.getState().panel.type === 'doc');
    useApp.getState().setPanel({ type: 'profile', id: bo.who.pub });
    await expectText(page.getByTestId('follow'), /Stop following/);
    await page.getByTestId('follow').click();
    await expect.element(page.getByTestId('follow-bar')).not.toBeInTheDocument();
    // Following someone who isn't here (yet).
    useApp.getState().follow('f'.repeat(64));
    await expectText(page.getByTestId('follow-bar'), /they’re not here right now/);
    await page.getByRole('button', { name: 'Stop following' }).click();
    await expect.element(page.getByTestId('follow-bar')).not.toBeInTheDocument();
  });

  it('tells others I’m in focus mode, and sees theirs', async () => {
    await page.getByTestId('focus-toggle').click();
    await until(() => getPeer(code)?.myPresence.focus === true);
    bo.setPresence({ st: 'online', focus: true });
    useApp.getState().setPanel({ type: 'profile', id: bo.who.pub });
    await expect.element(page.getByText(/in focus mode, may answer later/)).toBeVisible();
    useApp.getState().setPanel({ type: 'members' });
    await expect.element(page.getByText('Creator · Focusing')).toBeVisible();
    await expect.element(page.getByText('Focusing', { exact: true })).toBeVisible();
    await page.getByTestId('focus-toggle').click();
    await until(() => !getPeer(code)?.myPresence.focus);
  });

  it('makes nothing outside a workspace', async () => {
    useApp.getState().go({});
    await until(() => !useApp.getState().route.code);
    expect(useApp.getState().createDoc('general', 'Nowhere', 'text')).toBeUndefined();
    expect(useApp.getState().createTask('general', 'Nowhere', {})).toBeUndefined();
    useApp.getState().go({ code, ch: 'general' });
  });

  it('keeps what I read in step across my devices', async () => {
    useApp.getState().go({ code, ch: 'general' });
    await until(() => [...(getPeer(code)?.events.values() ?? [])].some((e) => e.t === 'read'));
    // Another of my devices read #random up to now: it isn't unread here either.
    bo.publish({ t: 'ch.create', b: { id: 'random', name: 'random' } });
    await bo.say({ t: 'msg', ch: 'random', b: { text: 'over here' } });
    await expect
      .element(
        page
          .getByRole('link', { name: /random/ })
          .or(page.getByRole('button', { name: /random/ }))
          .first(),
      )
      .toBeVisible();
    bridge.publish({ t: 'read', to: me().pub, b: { ch: 'random', ts: Date.now() } });
    await until(() => (state()?.reads.get(me().pub)?.get('random') ?? 0) > 0);
  });
});
