import type React from 'react';
import { useEffect, useReducer, useRef, useState } from 'react';
import { Icon, IconButton, Button, Tooltip, Kbd, Avatar, DayDivider, UnreadDivider, TypingIndicator, ConnectionBanner } from '@yurt/ui';
import { agentKey, parseGuestDm, type Channel, type Msg, type WorkspacePeer, type WsState } from '@yurt/protocol';
import { useApp } from '../store';
import { useCurrent, roster, personFor, authorKey, channelTitle, type Person } from '../model';
import { privateTarget } from '../lib/private';
import { fmtDay } from '../lib/format';
import { readUpTo } from '../lib/collab';
import { MessageItem, type MsgCtx } from './Message';
import { Composer, editLastMessage } from './Composer';
import { HuddleStrip, HuddleButton, HuddleDock } from './Huddle';
import { must } from './must';
import { Viewers, FollowBar } from './Collab';

const GROUP_MS = 5 * 60 * 1000;

export function useTyping(ch: string) {
  const { peer, state, identity } = useCurrent();
  if (!peer) return [];
  const out: { name: string; kind: 'human' | 'agent' }[] = [];
  for (const pr of peer.presence.values()) {
    if (pr.typing === ch && !pr.bridge && pr.pub !== identity.pub) out.push({ name: state?.profiles.get(pr.pub)?.name || 'Someone', kind: 'human' });
    if (pr.bridge && pr.agents)
      for (const [id, a] of Object.entries(pr.agents)) if (a.working === ch) out.push({ name: state?.agents.get(pr.pub + '/' + id)?.name || id, kind: 'agent' });
  }
  return out;
}

function MessageList({ ids, ctx, lastRead, emptyState, highlight }: { ids: string[]; ctx: MsgCtx; lastRead: number; emptyState?: React.ReactNode; highlight?: string | null }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [away, setAway] = useState(false);
  // The list is mounted whenever these run (effects, its own button).
  const toBottom = (smooth?: boolean) => {
    const el = must(scroller.current, 'the message list is mounted');
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };
  // Opens at the latest message (the list is keyed per conversation). A highlight, set just after navigating, scrolls itself below.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on mount only
  useEffect(() => toBottom(false), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows new messages only; scrolling away (`away`) must not snap back by itself
  useEffect(() => {
    if (!away) toBottom(false);
  }, [ids.length]);
  useEffect(() => {
    if (!highlight) return;
    const list = must(scroller.current, 'the message list is mounted');
    // Absent while its delete can still be undone: search lists it, but it isn't drawn.
    const el = list.querySelector<HTMLElement>('[data-mid="' + highlight + '"]');
    if (el) list.scrollTop = el.offsetTop - list.clientHeight / 3;
  }, [highlight]);
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setAway(el.scrollHeight - el.scrollTop - el.clientHeight > 160);
  };
  const rows: React.ReactNode[] = [];
  let prev: Msg | null = null;
  let day = '';
  let unreadShown = false;
  // Every id the reducer lists for a conversation is one of its messages.
  for (const m of ids.map((id) => ctx.state.msgs.get(id)).filter((x): x is Msg => !!x)) {
    const id = m.id;
    const d = fmtDay(m.ts);
    if (d !== day) {
      day = d;
      prev = null;
      rows.push(<DayDivider key={'d' + id} label={d} />);
    }
    if (!unreadShown && lastRead && m.ts > lastRead && !(m.a === ctx.me && !m.ag)) {
      unreadShown = true;
      prev = null;
      rows.push(<UnreadDivider key={'u' + id} />);
    }
    const continued = !!prev && authorKey(prev) === authorKey(m) && m.ts - prev.ts < GROUP_MS && !m.trace && !prev.deleted && !m.approval;
    rows.push(<MessageItem key={id} m={m} continued={continued} ctx={ctx} />);
    prev = m;
  }
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
      <div ref={scroller} onScroll={onScroll} role="log" aria-live="polite" style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: '12px 8px 16px' }}>
        {emptyState}
        {rows}
      </div>
      {away && (
        <button
          type="button"
          onClick={() => toBottom(true)}
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 12,
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            height: 32,
            padding: '0 14px',
            borderRadius: 999,
            border: 0,
            background: 'var(--accent)',
            color: 'var(--text-on-accent)',
            font: '600 13px var(--font-body)',
            cursor: 'pointer',
            boxShadow: 'var(--shadow-md)',
            animation: 'ag-pop var(--dur-base) var(--ease-spring)',
          }}
        >
          <Icon name="arrow-down" size={14} />
          Jump to latest
        </button>
      )}
    </div>
  );
}

/** What the open route shows: one kind per conversation, each with everything its view needs (nothing optional). */
type Conversation =
  | { kind: 'channel'; channel: Channel }
  | { kind: 'dm'; other: Person }
  | { kind: 'agent'; agent: Person }
  // A member's private chat with someone else's agent; its owner can read along but not write.
  | { kind: 'guest'; agent: Person; owner: Person; member: Person; ownerView: boolean };

function conversationOf(state: WsState, peer: WorkspacePeer | undefined, ch: string, me: string): Conversation | null {
  const person = (key: string) => personFor(state, peer, key, me);
  if (ch.startsWith('dm:')) return { kind: 'dm', other: person(must(privateTarget(ch, me), 'a DM names the other side')) };
  if (ch.startsWith('adm:')) {
    const [, owner, id = ''] = ch.split(':'); // a route can be any text: "adm:<owner>" without an agent id still renders
    return { kind: 'agent', agent: person(agentKey(must(owner, 'an adm: route has an owner part'), id)) };
  }
  const g = parseGuestDm(ch);
  if (g) return { kind: 'guest', agent: person(agentKey(g.owner, g.agentId)), owner: person(g.owner), member: person(g.member), ownerView: g.owner === me };
  const channel = state.channels.get(ch);
  return channel ? { kind: 'channel', channel } : null;
}

/** The hint under the composer: connection trouble first, then who can see this conversation. */
function composerNote(c: Conversation, net: { online: boolean; connected: boolean }): React.ReactNode {
  if (!net.online) return 'Offline · sends when a relay is reachable';
  if (!net.connected) return 'Relays unreachable · sends when one is back';
  if (c.kind === 'guest')
    return c.agent.presence === 'offline'
      ? c.agent.name + ' answers when ' + c.owner.name + '’s machine is on'
      : 'Only you and ' + c.owner.name + ', who runs ' + c.agent.name + ', see this';
  if (c.kind === 'agent') return c.agent.presence === 'offline' ? c.agent.name + ' is off. Start yurt-bridge to get replies.' : 'Only you and ' + c.agent.name + ' see this';
  return c.kind === 'dm' ? 'Private between you two' : <>Type @ to mention a person or agent</>;
}

function composerPlaceholder(c: Conversation, title: string): string {
  if (c.kind === 'guest') return 'Message ' + c.agent.name;
  if (c.kind === 'agent') return 'Message ' + title + ' privately';
  return c.kind === 'dm' ? 'Message ' + title : 'Message #' + title;
}

function EmptyState({ c }: { c: Conversation }) {
  const app = useApp.getState();
  switch (c.kind) {
    case 'guest': {
      const { agent, owner, member, ownerView } = c;
      return (
        <Intro
          avatar={
            <Avatar name={agent.name} kind="agent" owner={{ name: owner.name, self: ownerView }} presence={agent.presence} size={56} decorative cutout="var(--surface-page)" />
          }
          title={ownerView ? member.name + ' and ' + agent.name : 'You and ' + agent.name}
          body={
            agent.name +
            ' is ' +
            (ownerView ? 'your agent' : owner.name + '’s agent') +
            '. It runs ' +
            (agent.runtime || 'an agent CLI') +
            ' on ' +
            (ownerView ? 'your' : owner.name + '’s') +
            ' machine and answers here while that machine is on.'
          }
        />
      );
    }
    case 'agent':
      return (
        <Intro
          avatar={<Avatar name={c.agent.name} kind="agent" owner={{ name: 'You', self: true }} presence={c.agent.presence} size={56} decorative cutout="var(--surface-page)" />}
          title={'You and ' + c.agent.name}
          body={
            'Only you can see this chat. ' +
            c.agent.name +
            ' runs ' +
            (c.agent.runtime || 'an agent CLI') +
            ' on your machine through yurt-bridge, with the tools you allowed there.'
          }
        />
      );
    case 'dm':
      return (
        <Intro
          avatar={<Avatar name={c.other.name} self={c.other.self} presence={c.other.presence} size={56} decorative cutout="var(--surface-page)" />}
          title={c.other.self ? 'Notes to yourself' : 'You and ' + c.other.name}
          body={c.other.self ? 'Drafts, links, reminders. Only you see these.' : 'Only the two of you can read this conversation. Relays keep it end-to-end encrypted.'}
        />
      );
    case 'channel':
      return (
        <Intro
          title={'#' + c.channel.name + ' is ready'}
          body="Invite people with a link, then add an agent. Everyone here sees everything said, agents included."
          actions={
            <>
              <Button variant="primary" iconLeft="user-plus" onClick={() => app.setDialog('invite')}>
                Invite people
              </Button>
              <Button variant="agent" iconLeft="sparkles" onClick={() => app.openSettings('ws-agents')}>
                Add agent
              </Button>
            </>
          }
        />
      );
  }
}

const titleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  font: '700 16px/1.2 var(--font-display)',
  letterSpacing: '-0.02em',
  color: 'var(--text-strong)',
};
// The conversation's name is the page's one level-one heading; it keeps the header's look.
const h1Reset: React.CSSProperties = { margin: 0, font: 'inherit', minWidth: 0 };
const subtitleStyle: React.CSSProperties = { fontSize: 12, color: 'var(--text-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

/** Avatar, title and subtitle of a private conversation. */
function PrivateTitle({ avatar, title, subtitle, testId }: { avatar: React.ReactNode; title: string; subtitle: string; testId?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
      {avatar}
      <div style={{ minWidth: 0, lineHeight: 1.25 }}>
        <h1 style={{ ...h1Reset, ...titleStyle }}>
          {title}
          <Icon name="lock" size={13} label="Private" style={{ color: 'var(--text-subtle)' }} />
        </h1>
        <div data-testid={testId} style={subtitleStyle}>
          {subtitle}
        </div>
      </div>
    </div>
  );
}

const presenceLine = (p: Person) => (p.presence === 'online' ? 'Online' : p.presence === 'away' ? 'Away' : 'Offline · messages sync when they’re back');

function ConversationTitle({ c, title, narrow, muted }: { c: Conversation; title: string; narrow: boolean; muted: boolean }) {
  switch (c.kind) {
    case 'guest':
      return (
        <PrivateTitle
          avatar={<Avatar name={c.agent.name} kind="agent" presence={c.agent.presence} working={c.agent.working} size={28} decorative />}
          title={c.ownerView ? title : c.agent.name}
          subtitle={c.ownerView ? 'Your agent · ' + c.member.name + ' started this chat' : c.owner.name + '’s agent'}
          testId="guest-dm-subtitle"
        />
      );
    case 'agent':
      return (
        <PrivateTitle
          avatar={<Avatar name={c.agent.name} kind="agent" presence={c.agent.presence} working={c.agent.working} size={28} decorative />}
          title={title}
          subtitle={'Private · ' + (c.agent.runtime || 'agent') + ' on your machine'}
        />
      );
    case 'dm':
      return (
        <PrivateTitle avatar={<Avatar name={c.other.name} self={c.other.self} presence={c.other.presence} size={28} decorative />} title={title} subtitle={presenceLine(c.other)} />
      );
    case 'channel':
      return (
        <h1 style={{ ...h1Reset, flex: 1 }}>
          {/* Named by what it shows (the channel); it opens the channel's settings dialog. */}
          <button
            type="button"
            aria-haspopup="dialog"
            data-testid="channel-settings"
            onClick={() => useApp.getState().setDialog('channelSettings')}
            style={{
              display: 'block',
              width: '100%',
              minWidth: 0,
              lineHeight: 1.25,
              textAlign: 'left',
              padding: 0,
              border: 0,
              background: 'none',
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            <span style={{ ...titleStyle, gap: 4, whiteSpace: 'nowrap', overflow: 'hidden' }}>
              <Icon name="hash" size={16} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.channel.name}</span>
              {muted && <Icon name="bell" size={13} label="Muted" style={{ color: 'var(--text-subtle)', opacity: 0.6 }} />}
              <Icon name="chevron-down" size={14} style={{ color: 'var(--text-subtle)' }} />
            </span>
            {!narrow && c.channel.topic && <span style={{ ...subtitleStyle, display: 'block' }}>{c.channel.topic}</span>}
          </button>
        </h1>
      );
  }
}

/** Pins, invite and "Add agent": only channels have them. With a side panel open there's less room: icons only. */
function ChannelActions({ ch, narrow, panelType, togglePanel }: { ch: string; narrow: boolean; panelType: string | null; togglePanel: (t: 'pinned') => void }) {
  const state = useCurrent().state;
  const app = useApp.getState();
  const pinnedN = state?.pins.get(ch)?.size || 0;
  const addAgent = <IconButton icon="sparkles" label="Add agent" variant="agent" size="sm" onClick={() => app.openSettings('ws-agents')} />;
  if (narrow) return addAgent;
  if (panelType)
    return (
      <>
        <IconButton icon="pin" label={'Pinned, ' + pinnedN} size="sm" active={panelType === 'pinned'} onClick={() => togglePanel('pinned')} />
        {addAgent}
      </>
    );
  return (
    <>
      <Tooltip content={'Pinned · ' + pinnedN} placement="bottom">
        <IconButton icon="pin" label={'Pinned, ' + pinnedN} size="sm" active={panelType === 'pinned'} onClick={() => togglePanel('pinned')} />
      </Tooltip>
      <Tooltip content="Invite people" placement="bottom">
        <IconButton icon="user-plus" label="Invite people" size="sm" onClick={() => app.setDialog('invite')} />
      </Tooltip>
      <Button variant="agent" size="sm" iconLeft="sparkles" onClick={() => app.openSettings('ws-agents')}>
        Add agent
      </Button>
    </>
  );
}

function MembersButton({ people, narrow, active, onClick }: { people: Person[]; narrow: boolean; active: boolean; onClick: () => void }) {
  const humans = people.filter((p) => p.kind === 'human').length;
  const agents = people.length - humans;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={'Members: ' + humans + ' people, ' + agents + ' agents'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: 32,
        padding: '0 10px 0 5px',
        borderRadius: 999,
        border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border-subtle)'),
        background: active ? 'var(--accent-soft)' : 'transparent',
        cursor: 'pointer',
        color: 'var(--text-muted)',
        font: '500 12.5px var(--font-body)',
        flexShrink: 0,
        marginLeft: 2,
      }}
    >
      <span style={{ display: 'flex' }}>
        {people.slice(0, 3).map((m, i) => (
          <Avatar
            key={m.id}
            name={m.name}
            kind={m.kind}
            self={m.self}
            size={22}
            decorative
            style={{ marginLeft: i ? -7 : 0, borderRadius: 999, boxShadow: '0 0 0 2px var(--surface-page)' }}
          />
        ))}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        {humans}
        <Icon name="user" size={12} />
      </span>
      {agents > 0 && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          {agents}
          <Icon name="sparkles" size={12} style={{ color: 'var(--agent-ink)' }} />
        </span>
      )}
      {!narrow && <Kbd keys="mod+i" size="sm" />}
    </button>
  );
}

const bannerStyle: React.CSSProperties = {
  padding: '6px 16px',
  background: 'var(--surface-raised)',
  borderBottom: '1px solid var(--border-subtle)',
  font: '500 13px/1.3 var(--font-body)',
  color: 'var(--text-body)',
};

/** Who can read a guest DM, said up front: the agent's owner runs it, so they can. */
function GuestNotice({ c }: { c: Extract<Conversation, { kind: 'guest' }> }) {
  return (
    <div role="note" data-testid="guest-dm-notice" style={{ ...bannerStyle, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', background: 'var(--agent-soft)' }}>
      <Icon name="eye" size={14} style={{ color: 'var(--agent-ink)', flexShrink: 0 }} />
      {c.ownerView
        ? c.member.name + ' is talking to your agent ' + c.agent.name + '. Only the two of you see this.'
        : 'Conversations with ' + c.agent.name + ' are visible to ' + c.owner.name + ', who runs it.'}
    </div>
  );
}

/** Freezes "last read" on entering a conversation, so the New divider stays put while you read; marks it read as messages arrive. */
function useReadMarks(code: string, ch: string, count: number): number {
  const { rec, state, identity } = useCurrent();
  const lastRead = readUpTo(rec?.lastRead[ch], state, identity.pub, ch);
  const [entryRead, setEntryRead] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: captured once per conversation on purpose; later reads must not move the divider
  useEffect(() => {
    setEntryRead(lastRead);
  }, [code, ch]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `count` re-marks the conversation read as new messages arrive while it's open
  useEffect(() => {
    const mark = () => !document.hidden && useApp.getState().markRead(code, ch);
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [code, ch, count]);
  return entryRead;
}

/** Files dropped on a conversation; they belong to it (`at`), never to the next one opened. */
function useFileDrop(at: string) {
  const [dropped, setDropped] = useState<{ at: string; files: File[] } | undefined>();
  const [dragging, setDragging] = useState(false);
  return {
    dragging,
    files: dropped?.at === at ? dropped.files : undefined,
    handlers: {
      onDragOver: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      },
      onDragLeave: (e: React.DragEvent) => e.currentTarget === e.target && setDragging(false),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) setDropped({ at, files });
      },
    },
  };
}

/** Status lines above the messages: removed from the workspace, guest-DM visibility, connection. */
function Banners({ c, online }: { c: Conversation; online: boolean }) {
  const { peer } = useCurrent();
  return (
    <>
      {peer?.lockedOut && (
        <div role="status" data-testid="removed-banner" style={bannerStyle}>
          You no longer receive new messages here: you were removed, or your invite predates a key change. Ask a member for a new invite link.
        </div>
      )}
      {c.kind === 'guest' && <GuestNotice c={c} />}
      <ConnectionBanner state={!online ? 'offline' : !peer?.connected ? 'reconnecting' : 'online'} queued={peer?.queued.size || 0} />
    </>
  );
}

function ComposerArea(p: {
  c: Conversation;
  code: string;
  ch: string;
  draftKey: string;
  narrow: boolean;
  people: Person[];
  dropFiles?: File[] | undefined;
  placeholder: string;
  note: React.ReactNode;
}) {
  const typing = useTyping(p.ch);
  const app = useApp.getState();
  return (
    <div style={{ padding: p.narrow ? '0 10px 10px' : '0 20px 16px', flexShrink: 0 }}>
      {p.narrow && (
        <div style={{ paddingBottom: 8 }}>
          <HuddleDock />
        </div>
      )}
      <TypingIndicator people={typing} style={{ padding: '0 4px 6px' }} />
      {p.c.kind === 'guest' && p.c.ownerView ? (
        <div data-testid="guest-dm-readonly" style={{ padding: '10px 4px', fontSize: 13, color: 'var(--text-subtle)' }}>
          {p.c.agent.name} answers here for you. You can read along; to talk to {p.c.member.name} yourself, message them directly.
        </div>
      ) : (
        // Keyed per conversation so a draft or attachment can never be sent somewhere else.
        <Composer
          key={p.draftKey}
          members={p.people.filter((m) => !m.self)}
          dropFiles={p.dropFiles}
          autoFocus
          placeholder={p.placeholder}
          note={p.note}
          onTyping={() => app.setTyping(p.ch)}
          onSend={(t, f) => app.send(t, f)}
          onArrowUp={() => editLastMessage(p.code, p.ch)}
        />
      )}
    </div>
  );
}

export function ChannelView({ narrow }: { narrow: boolean }) {
  const { route, state } = useCurrent();
  // Mounted for a conversation route; nothing to show until its workspace's state exists (loading, or an unknown link).
  if (!state || !route.code || !route.ch) return null;
  return <Conversation narrow={narrow} code={route.code} ch={route.ch} state={state} />;
}

function Conversation({ narrow, code, ch, state }: { narrow: boolean; code: string; ch: string; state: WsState }) {
  const { rec, identity, peer } = useCurrent();
  const panel = useApp((s) => s.panel);
  const online = useApp((s) => s.online);
  const highlight = useApp((s) => s.highlight);
  const app = useApp.getState();
  const [, force] = useReducer((x: number) => x + 1, 0);
  const draftKey = code + '/' + ch;
  const drop = useFileDrop(draftKey);
  const me = identity.pub;
  const ids = state.channelMsgs.get(ch) || [];
  const entryRead = useReadMarks(code, ch, ids.length);

  const c = conversationOf(state, peer, ch, me);
  if (!c) return <Centered title="Channel not synced yet" body="It shows up once it arrives from the workspace’s relays." />;
  // useCurrent re-renders on every tick, so the roster is always current.
  const people = roster(state, peer, me);
  const ctx: MsgCtx = { state, peer, me, handle: identity.handle.toLowerCase(), roster: people, code, forceRender: force };
  const title = channelTitle(state, ch, me);
  const togglePanel = (type: 'members' | 'pinned' | 'search' | 'work') => app.setPanel(panel.type === type ? { type: null } : { type });
  // The relays hold messages, so being alone is fine; only unreachable relays matter.
  const note = composerNote(c, { online, connected: !!peer?.connected });
  const huddles = c.kind === 'channel' || c.kind === 'dm';
  return (
    <section
      aria-label={c.kind === 'channel' ? '#' + title : 'Conversation with ' + title}
      {...drop.handlers}
      style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: 56,
          padding: narrow ? '0 8px' : '0 12px 0 20px',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}
      >
        {narrow && <IconButton icon="menu" label="Open sidebar" size="sm" onClick={() => useApp.setState({ drawer: true })} />}
        <ConversationTitle c={c} title={title} narrow={narrow} muted={!!rec?.muted.includes(ch)} />
        <Viewers view={ch} />
        {huddles && <HuddleButton ch={ch} />}
        <Tooltip content="Hub: tasks, docs, decisions, saved" placement="bottom">
          <IconButton
            icon="list-checks"
            label="Hub"
            size="sm"
            data-testid="hub-button"
            active={panel.type === 'work' || panel.type === 'doc'}
            onClick={() => togglePanel('work')}
          />
        </Tooltip>
        <Tooltip content="Search" kbd="mod+f" placement="bottom">
          <IconButton icon="search" label="Search" size="sm" active={panel.type === 'search'} onClick={() => togglePanel('search')} />
        </Tooltip>
        {c.kind === 'channel' && <ChannelActions ch={ch} narrow={narrow} panelType={panel.type} togglePanel={togglePanel} />}
        {huddles && <MembersButton people={people} narrow={narrow || panel.type === 'doc'} active={panel.type === 'members'} onClick={() => togglePanel('members')} />}
      </header>
      <FollowBar />
      <Banners c={c} online={online} />
      <HuddleStrip ch={ch} />
      <MessageList key={code + ch} ids={ids} ctx={ctx} lastRead={entryRead} emptyState={ids.length ? null : <EmptyState c={c} />} highlight={highlight} />
      <ComposerArea c={c} code={code} ch={ch} draftKey={draftKey} narrow={narrow} people={people} dropFiles={drop.files} placeholder={composerPlaceholder(c, title)} note={note} />
      {drop.dragging && (
        <div
          style={{
            position: 'absolute',
            inset: 8,
            borderRadius: 20,
            border: '2px dashed var(--accent)',
            background: 'color-mix(in oklab, var(--accent) 8%, transparent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            font: '700 20px var(--font-display)',
            color: 'var(--text-strong)',
          }}
        >
          Drop to share · up to 25 MB each
        </div>
      )}
    </section>
  );
}

function Intro({ avatar, title, body, actions }: { avatar?: React.ReactNode; title: string; body: string; actions?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12, padding: '32px 16px 20px' }}>
      {avatar}
      <div style={{ font: '700 28px/1.1 var(--font-display)', letterSpacing: '-0.04em', color: 'var(--text-strong)' }}>{title}</div>
      <div style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 520, textWrap: 'pretty' }}>{body}</div>
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  );
}

function Centered({ title, body }: { title: string; body?: string }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32, textAlign: 'center' }}>
      <div style={{ font: '700 26px/1.1 var(--font-display)', letterSpacing: '-0.04em', color: 'var(--text-strong)' }}>{title}</div>
      {body && <div style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 440 }}>{body}</div>}
    </div>
  );
}
