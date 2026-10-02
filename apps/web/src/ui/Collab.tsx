import type React from 'react';
import { useEffect, useId, useState } from 'react';
import { Avatar, Badge, Button, Checkbox, Dialog, Icon, IconButton, Input, Select, Tabs, Tooltip, type IconName } from '@yurt/ui';
import {
  pollOpen,
  pollTally,
  liveAgents,
  agentKey,
  TASK_STATUSES,
  type Actor,
  type Msg,
  type Presence,
  type Task,
  type TaskStatus,
  type WorkspacePeer,
  type WsState,
} from '@yurt/protocol';
import { useApp, type CollabForm, type WorkTab } from '../store';
import { useCurrent, personFor, authorKey } from '../model';
import {
  STATUS_LABEL,
  agentsOn,
  dueLabel,
  followTarget,
  fromLocalInput,
  meetLabel,
  openAt,
  pollOptions,
  presenceList,
  rsvpCounts,
  taskGroups,
  toLocalInput,
  viewers,
} from '../lib/collab';
import { fmtTime, fmtDay } from '../lib/format';
import { must } from './must';

/* ---------- in messages ---------- */

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  marginTop: 6,
  padding: 12,
  maxWidth: 420,
  borderRadius: 14,
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface-card)',
};
const smallNote: React.CSSProperties = { fontSize: 12, color: 'var(--text-subtle)' };

/** Small stacked avatars for who voted or answered (the first four; the count says how many). */
function Faces({ who, state, peer, me }: { who: Actor[]; state: WsState; peer: WorkspacePeer | undefined; me: string }) {
  const people = who.slice(0, 4).map((k) => personFor(state, peer, k, me));
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }} title={people.map((p) => p.name).join(', ')}>
      {people.map((p, i) => (
        <Avatar key={p.id} name={p.name} kind={p.kind} self={p.self} size={18} decorative cutout="var(--surface-card)" style={{ marginLeft: i && -6 }} />
      ))}
    </span>
  );
}

/** A poll: options with live counts. Click to vote; click your choice again to take it back (multi: toggle each). */
export function PollCard({ m, state, peer, me }: { m: Msg & { poll: NonNullable<Msg['poll']> }; state: WsState; peer: WorkspacePeer | undefined; me: string }) {
  const now = useApp((s) => s.clock);
  const { poll } = m;
  const tally = pollTally(state, m.id);
  const mine = state.votes.get(m.id)?.get(me) ?? [];
  const open = pollOpen(poll.closes, Math.max(now, Date.now()));
  const pick = (i: number) => {
    const others = mine.filter((c) => c !== i);
    // Picking my choice again takes it back; otherwise it's added (several choices) or replaces mine.
    const next = mine.includes(i) ? others : poll.multi ? [...mine, i] : [i];
    useApp.getState().vote(m, next);
  };
  return (
    <div data-testid="poll" style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 650, color: 'var(--text-strong)' }}>
        <Icon name="gauge" size={15} />
        <span>{poll.q}</span>
      </div>
      {tally.options.map((o, i) => {
        const chosen = mine.includes(i);
        return (
          <button
            key={o.label}
            type="button"
            data-testid={'poll-option-' + i}
            aria-pressed={chosen}
            disabled={!open}
            onClick={() => pick(i)}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 10,
              border: chosen ? '1.5px solid var(--accent)' : '1px solid var(--border-subtle)',
              background: 'var(--surface-page)',
              cursor: open ? 'pointer' : 'default',
              overflow: 'hidden',
              font: 'inherit',
              textAlign: 'left',
              color: 'var(--text-body)',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                width: (100 * o.count) / Math.max(1, tally.total) + '%',
                background: 'var(--accent-soft)',
                transition: 'width var(--dur-base) var(--ease-out)',
              }}
            />
            <span style={{ position: 'relative', flex: 1 }}>{o.label}</span>
            <span style={{ position: 'relative' }}>
              <Faces who={o.voters} state={state} peer={peer} me={me} />
            </span>
            <span style={{ position: 'relative', font: '600 12px var(--font-mono)', color: 'var(--text-muted)' }}>{o.count}</span>
          </button>
        );
      })}
      <span style={smallNote} data-testid="poll-status">
        {tally.total} {tally.total === 1 ? 'vote' : 'votes'}
        {poll.multi && ' · several choices'}
        {poll.closes !== undefined && (open ? ' · closes ' + fmtDay(poll.closes) + ' ' + fmtTime(poll.closes) : ' · closed')}
      </span>
    </div>
  );
}

const GOING = [
  { id: 'yes', label: 'Going' },
  { id: 'maybe', label: 'Maybe' },
  { id: 'no', label: 'Can’t' },
] as const;
const PHASE_COLOR = { upcoming: 'var(--text-body)', now: 'var(--success-ink)', over: 'var(--text-subtle)' } as const;

/** A meeting: when, and who's coming. While it's on, the conversation's huddle button is the way in. */
export function MeetCard({ m, state, peer, me }: { m: Msg & { meet: NonNullable<Msg['meet']> }; state: WsState; peer: WorkspacePeer | undefined; me: string }) {
  const now = useApp((s) => s.clock);
  const answers = state.rsvps.get(m.id);
  const counts = rsvpCounts(answers);
  const mine = answers?.get(me);
  const when = meetLabel(m.meet.at, m.meet.dur, Math.max(now, Date.now()));
  return (
    <div data-testid="meeting" style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 650, color: 'var(--text-strong)' }}>
        <Icon name="calendar" size={15} />
        <span style={{ flex: 1 }}>{m.meet.title}</span>
        {when.phase === 'now' && (
          <Badge tone="success" live size="sm">
            Now
          </Badge>
        )}
      </div>
      <span data-testid="meeting-when" style={{ fontSize: 13, color: PHASE_COLOR[when.phase] }}>
        {when.text}
      </span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {GOING.map((g) => (
          <Button
            key={g.id}
            size="sm"
            variant={mine === g.id ? 'primary' : 'secondary'}
            data-testid={'rsvp-' + g.id}
            aria-pressed={mine === g.id}
            onClick={() => useApp.getState().rsvp(m, g.id)}
          >
            {g.label} · {counts[g.id].length}
          </Button>
        ))}
        <Faces who={counts.yes} state={state} peer={peer} me={me} />
      </div>
    </div>
  );
}

/** "Decided: …" under a message that settled something. */
export function DecisionNote({ m, state, peer, me }: { m: Msg; state: WsState; peer: WorkspacePeer | undefined; me: string }) {
  const d = state.decisions.get(m.id);
  return (
    d && (
      <div data-testid="decision" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 13, color: 'var(--success-ink)' }}>
        <Icon name="flag" size={13} />
        <span>
          <strong>Decided:</strong> {d.text} <span style={smallNote}>· {personFor(state, peer, authorKey(d), me).name}</span>
        </span>
      </div>
    )
  );
}

/** Extra message actions: save it, make it a task, record it as a decision (and take that back). */
export function collabActions(m: Msg, state: WsState, me: string): { id: string; icon: IconName; label: string; onSelect: () => void }[] {
  const app = useApp.getState();
  const saved = !!state.saved.get(me)?.includes(m.id);
  const decided = state.decisions.has(m.id);
  return [
    { id: 'save', icon: 'inbox', label: saved ? 'Remove from saved' : 'Save for later', onSelect: () => app.save(m.id, !saved) },
    // Tasks belong to channels; a private conversation's message can still be saved or decided.
    ...(state.channels.has(m.ch)
      ? [{ id: 'task', icon: 'list-checks' as const, label: 'Make a task', onSelect: () => app.openCollab({ kind: 'task', ch: m.ch, src: m.id, title: m.text.slice(0, 120) }) }]
      : []),
    { id: 'decision', icon: 'flag', label: decided ? 'Undo decision' : 'Mark as decision', onSelect: () => app.decide(m, !decided) },
  ];
}

/* ---------- the hub (work panel) ---------- */

/** Everyone a task can go to: people, then agents. */
function assignees(state: WsState, peer: WorkspacePeer | undefined, me: string): { value: string; label: string }[] {
  const people = [...state.profiles.keys()].filter((k) => !state.bans.has(k)).map((k) => personFor(state, peer, k, me));
  const agents = liveAgents(state).map((a) => personFor(state, peer, agentKey(a.owner, a.id), me));
  return [
    { value: '', label: 'Nobody yet' },
    ...people.map((p) => ({ value: p.id, label: p.name + (p.self ? ' (you)' : '') })),
    ...agents.map((p) => ({ value: p.id, label: p.name + ' · ' + (p.owner?.self ? 'your agent' : p.owner?.name + '’s agent') })),
  ];
}

const STATUS_TONE: Record<TaskStatus, 'neutral' | 'agent' | 'danger' | 'success'> = { open: 'neutral', doing: 'agent', blocked: 'danger', done: 'success' };
const STATUS_OPTIONS = TASK_STATUSES.map((value) => ({ value, label: STATUS_LABEL[value] }));
const isStatus = (x: string): x is TaskStatus => Object.hasOwn(STATUS_LABEL, x);

interface HubCtx {
  state: WsState;
  peer: WorkspacePeer | undefined;
  me: string;
  code: string;
  presence: Presence[];
}

function TaskRow({ t, hub, open, toggle }: { t: Task; hub: HubCtx; open: boolean; toggle: () => void }) {
  const now = useApp((s) => s.clock);
  const app = useApp.getState();
  const { state, peer, me, code } = hub;
  const who = t.assignee && personFor(state, peer, t.assignee, me);
  const due = t.due && dueLabel(t.due, Math.max(now, Date.now()), t.status === 'done');
  const src = t.src && state.msgs.get(t.src);
  return (
    <div data-testid={'task-' + t.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Checkbox aria-label={'Done: ' + t.title} checked={t.status === 'done'} onChange={(e) => app.updateTask(t.id, { status: e.target.checked ? 'done' : 'open' })} />
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          style={{ flex: 1, minWidth: 0, padding: 0, border: 0, background: 'none', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'var(--text-body)' }}
        >
          <span style={{ display: 'block', fontWeight: 600, textDecoration: t.status === 'done' ? 'line-through' : undefined }}>{t.title}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            <Badge tone={STATUS_TONE[t.status]} size="sm" live={agentsOn(hub.presence, 'task:' + t.id).length > 0}>
              {STATUS_LABEL[t.status]}
            </Badge>
            {who && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                <Avatar name={who.name} kind={who.kind} self={who.self} owner={who.owner} size={16} decorative />
                {who.self ? 'You' : who.name}
              </span>
            )}
            {due && <span style={{ fontSize: 12, color: due.late ? 'var(--danger-ink)' : 'var(--text-subtle)' }}>{due.text}</span>}
            <span style={smallNote}>#{state.channels.get(t.ch)?.name}</span>
          </span>
        </button>
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 28 }}>
          <Select
            label="Assignee"
            size="sm"
            value={t.assignee ?? ''}
            options={assignees(state, peer, me)}
            onChange={(e) => app.updateTask(t.id, { assignee: e.target.value || null })}
          />
          <Select
            label="Status"
            size="sm"
            value={t.status}
            options={STATUS_OPTIONS}
            onChange={(e) => isStatus(e.target.value) && app.updateTask(t.id, { status: e.target.value })}
          />
          <Input
            label="Due"
            size="sm"
            type="datetime-local"
            value={t.due ? toLocalInput(t.due) : ''}
            onChange={(e) => app.updateTask(t.id, { due: fromLocalInput(e.target.value) })}
          />
          {src && (
            <Button size="sm" variant="ghost" iconLeft="message-square" onClick={() => app.go({ code, ch: src.ch, thread: src.parent ?? src.id })}>
              Open the conversation
            </Button>
          )}
          <ol data-testid="task-activity" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {t.log.map((c) => {
              const by = personFor(state, peer, authorKey(c), me);
              const what = [
                c.status && STATUS_LABEL[c.status],
                c.assignee !== undefined && (c.assignee ? '→ ' + personFor(state, peer, c.assignee, me).name : 'unassigned'),
                c.note,
              ].filter(Boolean);
              return (
                <li key={c.ts + by.id} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-subtle)' }}>{fmtTime(c.ts)}</span> {by.name}: {what.join(' · ')}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

function Group({ title, children, n }: { title: string; n: number; children: React.ReactNode }) {
  return (
    n > 0 && (
      <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h2 style={{ margin: 0, padding: '4px 2px', fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-subtle)' }}>
          {title} · {n}
        </h2>
        {children}
      </section>
    )
  );
}

function Empty({ icon, text }: { icon: IconName; text: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '32px 12px', color: 'var(--text-subtle)', textAlign: 'center', fontSize: 13 }}>
      <Icon name={icon} size={22} />
      {text}
    </div>
  );
}

function TasksTab({ hub, ch }: { hub: HubCtx; ch: string }) {
  const [here, setHere] = useState(false);
  // Which task is open, here rather than in the row: a change can move it to another group (a new row).
  const [open, setOpen] = useState<string | null>(null);
  const { state, me } = hub;
  const mine = (a: Actor | undefined) => !!a && (a === me || a.startsWith(me + '/'));
  const g = taskGroups(state.tasks.values(), mine, here ? ch : undefined);
  const row = (t: Task) => <TaskRow key={t.id} t={t} hub={hub} open={open === t.id} toggle={() => setOpen((o) => (o === t.id ? null : t.id))} />;
  return (
    <>
      <Checkbox label={'Only #' + state.channels.get(ch)?.name} checked={here} onChange={(e) => setHere(e.target.checked)} />
      {!g.mine.length && !g.others.length && !g.done.length && <Empty icon="list-checks" text="No tasks yet. Make one here, or from any message (its actions)." />}
      <Group title="Yours and your agents’" n={g.mine.length}>
        {g.mine.map(row)}
      </Group>
      <Group title="Everyone else’s" n={g.others.length}>
        {g.others.map(row)}
      </Group>
      <Group title="Done" n={g.done.length}>
        {g.done.slice(0, 20).map(row)}
      </Group>
    </>
  );
}

const rowButton: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px',
  borderRadius: 12,
  border: '1px solid var(--border-subtle)',
  background: 'none',
  cursor: 'pointer',
  font: 'inherit',
  textAlign: 'left',
  color: 'var(--text-body)',
};
const DOC_ICON = { text: 'file-text', board: 'layers' } as const;

function DocsTab({ hub }: { hub: HubCtx }) {
  const { state, me, presence } = hub;
  const docs = [...state.docs.values()].filter((d) => !d.archived).sort((a, b) => b.updated - a.updated);
  return (
    <>
      {!docs.length && <Empty icon="file-text" text="No docs or boards yet. Write one together, with agents too." />}
      {docs.map((d) => {
        const here = viewers(presence, 'doc:' + d.id, me).length + agentsOn(presence, 'doc:' + d.id).length;
        return (
          <button key={d.id} type="button" data-testid={'doc-' + d.id} onClick={() => useApp.getState().setPanel({ type: 'doc', id: d.id })} style={rowButton}>
            <Icon name={DOC_ICON[d.kind]} size={16} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 600 }}>{d.title}</span>
              <span style={smallNote}>
                #{state.channels.get(d.ch)?.name} · edited {fmtDay(d.updated)} {fmtTime(d.updated)}
                {d.suggestions.some((x) => x.status === 'open') && ' · suggestions waiting'}
              </span>
            </span>
            {here > 0 && (
              <Badge tone="success" live size="sm">
                {here} here
              </Badge>
            )}
          </button>
        );
      })}
    </>
  );
}

/** A list of messages to jump to (decisions, saved). */
function MsgLinks({ items, code, empty, icon, unsave }: { items: { m: Msg; label: string }[]; code: string; empty: string; icon: IconName; unsave?: boolean }) {
  const app = useApp.getState();
  const open = (m: Msg) => {
    app.go({ code, ...openAt(m) });
    useApp.setState({ highlight: m.id });
  };
  return (
    <>
      {!items.length && <Empty icon={icon} text={empty} />}
      {items.map(({ m, label }) => (
        <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button type="button" onClick={() => open(m)} style={{ ...rowButton, flex: 1, minWidth: 0, flexDirection: 'column', alignItems: 'stretch', gap: 2, padding: '8px 10px' }}>
            <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
            <span style={{ ...smallNote, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.text}</span>
          </button>
          {unsave && <IconButton icon="x" size="sm" label="Remove from saved" onClick={() => app.save(m.id, false)} />}
        </div>
      ))}
    </>
  );
}

const TABS: { id: WorkTab; label: string; icon: IconName }[] = [
  { id: 'tasks', label: 'Tasks', icon: 'list-checks' },
  { id: 'docs', label: 'Docs', icon: 'file-text' },
  { id: 'decisions', label: 'Decided', icon: 'flag' },
  { id: 'saved', label: 'Saved', icon: 'inbox' },
];
const isTab = (x: string | undefined): x is WorkTab => TABS.some((t) => t.id === x);
const CREATE: { kind: CollabForm['kind']; label: string; icon: IconName }[] = [
  { kind: 'task', label: 'Task', icon: 'list-checks' },
  { kind: 'poll', label: 'Poll', icon: 'gauge' },
  { kind: 'meet', label: 'Meeting', icon: 'calendar' },
  { kind: 'doc', label: 'Doc', icon: 'file-text' },
  { kind: 'board', label: 'Board', icon: 'layers' },
];

/** The hub: tasks, docs and boards, the decision log and my saved messages, plus making new ones. */
export function WorkPanel({ tab, state, code }: { tab: string | undefined; state: WsState; code: string }) {
  const { peer, identity, route } = useCurrent();
  const app = useApp.getState();
  const cur = isTab(tab) ? tab : 'tasks';
  const me = identity.pub;
  const hub: HubCtx = { state, peer, me, code, presence: presenceList(peer) };
  // New things go in the channel on screen, or #general from a private conversation.
  const ch = route.ch && state.channels.has(route.ch) ? route.ch : 'general';
  const decisions = [...state.decisions.values()].sort((a, b) => b.ts - a.ts).map((d) => ({ m: must(state.msgs.get(d.target), 'a decision is on a message'), label: d.text }));
  const saved = (state.saved.get(me) ?? [])
    .map((id) => state.msgs.get(id))
    .filter((m): m is Msg => m?.deleted === false)
    .reverse()
    .map((m) => ({ m, label: personFor(state, peer, authorKey(m), me).name + ' · ' + fmtDay(m.ts) }));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
        {CREATE.map((c) => (
          <Button key={c.kind} size="sm" variant="secondary" iconLeft={c.icon} onClick={() => app.openCollab({ kind: c.kind, ch })}>
            {c.label}
          </Button>
        ))}
      </div>
      <div style={{ padding: '8px 12px 0' }}>
        <Tabs
          size="sm"
          fullWidth
          label="Hub sections"
          value={cur}
          onChange={(id) => app.setPanel({ type: 'work', id })}
          items={TABS.map((t) => ({ ...t, ...(t.id === 'tasks' ? { count: [...state.tasks.values()].filter((x) => x.status !== 'done').length } : {}) }))}
        />
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {cur === 'tasks' && <TasksTab hub={hub} ch={ch} />}
        {cur === 'docs' && <DocsTab hub={hub} />}
        {cur === 'decisions' && <MsgLinks items={decisions} code={code} icon="flag" empty="Nothing decided yet. Mark a message or a poll as a decision to log it here." />}
        {cur === 'saved' && <MsgLinks items={saved} code={code} icon="inbox" empty="Save messages for later. Only you see them, on all your devices." unsave />}
      </div>
    </div>
  );
}

/* ---------- making things ---------- */

const TITLES: Record<CollabForm['kind'], string> = { task: 'New task', poll: 'New poll', meet: 'Schedule a meeting', doc: 'New doc', board: 'New board' };

interface Fields {
  title: string;
  options: string;
  multi: boolean;
  when: string;
  dur: string;
  assignee: string;
}

type Maker = (ch: string, title: string, f: Fields, at: number | null, src: string | undefined) => string | null;
/** Each kind's maker: makes it, or says what's missing. */
const MAKERS: Record<CollabForm['kind'], Maker> = {
  task: (ch, title, f, at, src) => {
    useApp.getState().createTask(ch, title, { assignee: f.assignee, ...(at && { due: at }), src });
    return null;
  },
  poll: (ch, q, f, at) => {
    const options = pollOptions(f.options);
    if (options.length < 2) return 'Give at least two options, one per line.';
    useApp.getState().postPoll(ch, { q, options, ...(f.multi && { multi: true }), ...(at && { closes: at }) });
    return null;
  },
  meet: (ch, title, f, at) => {
    if (!at) return 'Pick when it starts.';
    // A length outside 1 min – 1 day (or none) leaves it out: the card then assumes half an hour.
    const minutes = Number(f.dur);
    useApp.getState().postMeeting(ch, { title, at, ...(minutes >= 1 && minutes <= 1440 && { dur: Math.round(minutes) }) });
    return null;
  },
  doc: (ch, title) => {
    useApp.getState().createDoc(ch, title, 'text');
    return null;
  },
  board: (ch, title) => {
    useApp.getState().createDoc(ch, title, 'board');
    return null;
  },
};

/** Makes what the form describes, or says what's missing. */
function make(form: CollabForm, f: Fields): string | null {
  const title = f.title.trim();
  if (!title) return form.kind === 'poll' ? 'Ask a question.' : 'Give it a title.';
  return MAKERS[form.kind](form.ch, title, f, fromLocalInput(f.when), form.src);
}

const textarea: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 12,
  border: '1px solid var(--border-default)',
  background: 'var(--surface-card)',
  color: 'var(--text-body)',
  font: '400 14px/1.5 var(--font-body)',
};
const WHEN_LABEL = { task: 'Due', poll: 'Closes', meet: 'Starts' } as const;

/** One dialog for making a task, poll, meeting, doc or board in a channel. */
export function CollabDialog({ form, state, onClose }: { form: CollabForm; state: WsState; onClose: () => void }) {
  const { peer, identity } = useCurrent();
  const [f, setF] = useState<Fields>({ title: form.title ?? '', options: '', multi: false, when: '', dur: '30', assignee: '' });
  const [err, setErr] = useState('');
  // The footer's Create button submits this form, so Enter in any field does too.
  const formId = useId();
  const field = (p: Partial<Fields>) => {
    setF((x) => ({ ...x, ...p }));
    setErr('');
  };
  const submit = () => {
    const problem = make(form, f);
    setErr(problem ?? '');
    if (!problem) onClose();
  };
  const when = form.kind === 'task' || form.kind === 'poll' || form.kind === 'meet' ? form.kind : null;
  return (
    <Dialog
      open
      onClose={onClose}
      title={TITLES[form.kind]}
      description={'In #' + state.channels.get(form.ch)?.name + (form.src ? ', from a message' : '')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} data-testid="collab-create">
            Create
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <Input
          label={form.kind === 'poll' ? 'Question' : 'Title'}
          value={f.title}
          data-autofocus
          maxLength={200}
          onChange={(e) => field({ title: e.target.value })}
          error={err || undefined}
        />
        {form.kind === 'task' && (
          <Select label="Assignee" value={f.assignee} options={assignees(state, peer, identity.pub)} onChange={(e) => field({ assignee: e.target.value })} />
        )}
        {form.kind === 'poll' && (
          <>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>
              Options, one per line
              <textarea value={f.options} rows={4} data-testid="poll-options" onChange={(e) => field({ options: e.target.value })} style={textarea} />
            </label>
            <Checkbox label="Allow several choices" checked={f.multi} onChange={(e) => field({ multi: e.target.checked })} />
          </>
        )}
        {when && <Input label={WHEN_LABEL[when]} optional={when !== 'meet'} type="datetime-local" value={f.when} onChange={(e) => field({ when: e.target.value })} />}
        {form.kind === 'meet' && <Input label="Minutes" type="number" min={1} max={1440} value={f.dur} onChange={(e) => field({ dur: e.target.value })} />}
      </form>
    </Dialog>
  );
}

/* ---------- presence ---------- */

/** Who else is looking at this conversation or doc. */
export function Viewers({ view, testId = 'viewers' }: { view: string; testId?: string }) {
  const { state, peer, identity } = useCurrent();
  const here = viewers(presenceList(peer), view, identity.pub).map((k) => personFor(state, peer, k, identity.pub));
  return (
    here.length > 0 && (
      <Tooltip content={here.map((p) => p.name).join(', ') + (here.length === 1 ? ' is here' : ' are here')} placement="bottom">
        <span data-testid={testId} style={{ display: 'inline-flex', alignItems: 'center' }}>
          <span className="ag-sr-only">{here.length} here</span>
          {here.slice(0, 3).map((p, i) => (
            <Avatar key={p.id} name={p.name} presence="online" size={22} decorative cutout="var(--surface-page)" style={{ marginLeft: i && -6 }} />
          ))}
        </span>
      </Tooltip>
    )
  );
}

/** Follow someone: go wherever they look in this workspace, until I stop. */
export function FollowButton({ pub }: { pub: string }) {
  const following = useApp((s) => s.following) === pub;
  return (
    <Button variant="secondary" size="sm" iconLeft="eye" data-testid="follow" onClick={() => useApp.getState().follow(following ? null : pub)}>
      {following ? 'Stop following' : 'Follow'}
    </Button>
  );
}

/** While I follow someone, go where they look; a bar says so and stops it. */
export function FollowBar() {
  const following = useApp((s) => s.following);
  const { state, peer, identity, route } = useCurrent();
  const theirs = presenceList(peer).find((p) => p.pub === following && !p.bridge);
  const target = state && followTarget(state, theirs?.view);
  const key = target ? [target.ch, target.thread, target.doc].join('|') : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `target`, which is a new object on every render
  useEffect(() => {
    if (!target) return;
    const app = useApp.getState();
    app.go({ code: route.code, ch: target.ch, thread: target.thread });
    if (target.doc) app.setPanel({ type: 'doc', id: target.doc });
  }, [key]);
  return (
    following && (
      <div role="status" data-testid="follow-bar" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'var(--accent-soft)', fontSize: 13 }}>
        <Icon name="eye" size={14} />
        <span style={{ flex: 1 }}>
          Following {personFor(state, peer, following, identity.pub).name}
          {!theirs && ' · they’re not here right now'}
        </span>
        <Button size="sm" variant="ghost" onClick={() => useApp.getState().follow(null)}>
          Stop following
        </Button>
      </div>
    )
  );
}
