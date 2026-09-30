import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Icon, IconButton, Button, Tooltip, Kbd, Avatar, DayDivider, UnreadDivider, TypingIndicator, ConnectionBanner } from '@yurt/ui';
import type { Msg } from '@yurt/protocol';
import { useApp } from '../store';
import { useCurrent, roster, personFor, authorKey, channelTitle } from '../model';
import { fmtDay } from '../lib/format';
import { MessageItem, type MsgCtx } from './Message';
import { Composer } from './Composer';
import { HuddleStrip, HuddleStage, HuddleButton, HuddleDock } from './Huddle';

const GROUP_MS = 5 * 60 * 1000;

export function useTyping(ch: string) {
  const { peer, state, identity } = useCurrent();
  if (!peer) return [];
  const out: { name: string; kind: 'human' | 'agent' }[] = [];
  for (const [pid, pr] of peer.presence) {
    const who = peer.peers.get(pid);
    if (!who) continue;
    if (pr.typing === ch && !pr.bridge && who.pub !== identity.pub) out.push({ name: state?.profiles.get(who.pub)?.name || 'Someone', kind: 'human' });
    if (pr.bridge && pr.agents) for (const [id, a] of Object.entries(pr.agents)) if (a.working === ch) out.push({ name: state?.agents.get(who.pub + '/' + id)?.name || id, kind: 'agent' });
  }
  return out;
}

export function MessageList({ ids, ctx, lastRead, emptyState, highlight }: { ids: string[]; ctx: MsgCtx; lastRead: number; emptyState?: React.ReactNode; highlight?: string | null }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [away, setAway] = useState(false);
  const toBottom = (smooth?: boolean) => { const el = scroller.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); };
  useEffect(() => { if (!highlight) toBottom(false); }, []);
  useEffect(() => { if (!away) toBottom(false); }, [ids.length]);
  useEffect(() => {
    if (!highlight || !scroller.current) return;
    const el = scroller.current.querySelector<HTMLElement>('[data-mid="' + highlight + '"]');
    if (el) scroller.current.scrollTop = el.offsetTop - scroller.current.clientHeight / 3;
  }, [highlight]);
  const onScroll = () => { const el = scroller.current!; setAway(el.scrollHeight - el.scrollTop - el.clientHeight > 160); };
  const rows: React.ReactNode[] = [];
  let prev: Msg | null = null;
  let day = '';
  let unreadShown = false;
  for (const id of ids) {
    const m = ctx.state.msgs.get(id);
    if (!m) continue;
    const d = fmtDay(m.ts);
    if (d !== day) { day = d; prev = null; rows.push(<DayDivider key={'d' + id} label={d} />); }
    if (!unreadShown && lastRead && m.ts > lastRead && !(m.a === ctx.me && !m.ag)) { unreadShown = true; prev = null; rows.push(<UnreadDivider key={'u' + id} />); }
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
        <button type="button" onClick={() => toBottom(true)} style={{ position: 'absolute', left: '50%', bottom: 12, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 14px', borderRadius: 999, border: 0, background: 'var(--accent)', color: 'var(--text-on-accent)', font: '600 13px var(--font-body)', cursor: 'pointer', boxShadow: 'var(--shadow-md)', animation: 'ag-pop var(--dur-base) var(--ease-spring)' }}>
          <Icon name="arrow-down" size={14} />Jump to latest
        </button>
      )}
    </div>
  );
}

export function ChannelView({ narrow }: { narrow: boolean }) {
  const { route, state, rec, identity, peer } = useCurrent();
  const panel = useApp((s) => s.panel);
  const online = useApp((s) => s.online);
  const highlight = useApp((s) => s.highlight);
  const hud = useApp((s) => s.huddle);
  const app = useApp.getState();
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [drop, setDrop] = useState<File[] | undefined>();
  const [dragging, setDragging] = useState(false);
  const code = route.code!;
  const ch = route.ch!;
  const me = identity.pub;
  const isDm = ch.startsWith('dm:');
  const isAgentDm = ch.startsWith('adm:');
  const channel = state?.channels.get(ch);
  const people = useMemo(() => roster(state, peer, me), [state, peer?.peers.size, me, useApp.getState().tick]);
  const ids = state?.channelMsgs.get(ch) || [];
  const typing = useTyping(ch);

  // Freeze "last read" when entering a channel so the New divider stays put while you read.
  const [entryRead, setEntryRead] = useState(0);
  useEffect(() => { setEntryRead(rec?.lastRead[ch] || 0); }, [code, ch]);
  useEffect(() => {
    const mark = () => !document.hidden && app.markRead(code, ch);
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [code, ch, ids.length]);

  if (!state) return null;
  const agentKeyForDm = isAgentDm ? ch.split(':')[1] + '/' + ch.split(':')[2] : '';
  const agent = isAgentDm ? personFor(state, peer, agentKeyForDm, me) : null;
  const dmOther = isDm ? ch.slice(3).split(':').find((k) => k !== me) || me : '';
  const other = isDm ? personFor(state, peer, dmOther, me) : null;
  if (!isDm && !isAgentDm && !channel) {
    return <Centered title="Channel not synced yet" body="It shows up once a member who has it comes online." />;
  }
  const ctx: MsgCtx = { state, peer, me, handle: identity.handle.toLowerCase(), roster: people, code, forceRender: force };
  const title = channelTitle(state, ch, me);
  const humans = people.filter((p) => p.kind === 'human');
  const agents = people.filter((p) => p.kind === 'agent');
  const pinnedN = state.pins.get(ch)?.size || 0;
  const togglePanel = (type: 'members' | 'pinned' | 'search') => app.setPanel(panel.type === type ? { type: null } : { type });
  const nobody = (peer?.peers.size || 0) === 0;
  const note = !online ? 'Offline · sends when a peer is reachable'
    : isAgentDm ? (agent?.presence === 'offline' ? agent.name + ' is off. Start yurt-bridge to get replies.' : 'Only you and ' + agent?.name + ' see this')
    : nobody ? 'No one else is online · sends when someone joins'
    : isDm ? 'Private between you two' : <>Type @ to mention a person or agent</>;

  const emptyState = ids.length ? null : isAgentDm ? (
    <Intro avatar={<Avatar name={agent!.name} kind="agent" owner={{ name: 'You', self: true }} presence={agent!.presence} size={56} decorative cutout="var(--surface-page)" />}
      title={'You and ' + agent!.name} body={'Only you can see this chat. ' + agent!.name + ' runs ' + (agent!.runtime || 'an agent CLI') + ' on your machine through yurt-bridge, with the tools you allowed there.'} />
  ) : isDm ? (
    <Intro avatar={<Avatar name={other!.name} self={other!.self} presence={other!.presence} size={56} decorative cutout="var(--surface-page)" />}
      title={other!.self ? 'Notes to yourself' : 'You and ' + other!.name} body={other!.self ? 'Drafts, links, reminders. Only you see these.' : 'Only the two of you hold this conversation. It syncs directly between your devices.'} />
  ) : (
    <Intro title={'#' + channel!.name + ' is ready'} body="Invite people with a link or code, then add an agent. Everyone here sees everything said, agents included."
      actions={<><Button variant="primary" iconLeft="user-plus" onClick={() => app.setDialog('invite')}>Invite people</Button><Button variant="agent" iconLeft="sparkles" onClick={() => app.setDialog('agent')}>Add agent</Button></>} />
  );

  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDragging(false); const fs = Array.from(e.dataTransfer.files || []); if (fs.length) setDrop(fs); };

  return (
    <section aria-label={isDm || isAgentDm ? 'Conversation with ' + title : '#' + title} onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }} onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)} onDrop={onDrop}
      style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 6, height: 56, padding: narrow ? '0 8px' : '0 12px 0 20px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        {narrow && <IconButton icon="menu" label="Open sidebar" size="sm" onClick={() => useApp.setState({ drawer: true })} />}
        {isAgentDm || isDm ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
            {isAgentDm ? <Avatar name={agent!.name} kind="agent" presence={agent!.presence} working={agent!.working} size={28} decorative /> : <Avatar name={other!.name} self={other!.self} presence={other!.presence} size={28} decorative />}
            <div style={{ minWidth: 0, lineHeight: 1.25 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, font: '700 16px/1.2 var(--font-display)', letterSpacing: '-0.02em', color: 'var(--text-strong)' }}>{title}<Icon name="lock" size={13} style={{ color: 'var(--text-subtle)' }} /></div>
              <div style={{ fontSize: 12, color: 'var(--text-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{isAgentDm ? 'Private · ' + (agent!.runtime || 'agent') + ' on your machine' : other!.presence === 'online' ? 'Online' : other!.presence === 'away' ? 'Away' : 'Offline · messages sync when they’re back'}</div>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => app.setDialog('channelSettings')} aria-label="Channel settings" style={{ minWidth: 0, flex: 1, lineHeight: 1.25, textAlign: 'left', padding: 0, border: 0, background: 'none', cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, font: '700 16px/1.2 var(--font-display)', letterSpacing: '-0.02em', color: 'var(--text-strong)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              <Icon name="hash" size={16} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{channel!.name}</span>
              {rec?.muted.includes(ch) && <Icon name="bell" size={13} style={{ color: 'var(--text-subtle)', opacity: 0.6 }} />}
              <Icon name="chevron-down" size={14} style={{ color: 'var(--text-subtle)' }} />
            </div>
            {!narrow && channel!.topic && <div style={{ fontSize: 12, color: 'var(--text-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{channel!.topic}</div>}
          </button>
        )}
        {!isAgentDm && <HuddleButton ch={ch} />}
        <Tooltip content="Search" kbd="mod+f" placement="bottom"><IconButton icon="search" label="Search" size="sm" active={panel.type === 'search'} onClick={() => togglePanel('search')} /></Tooltip>
        {!narrow && !isDm && !isAgentDm && <Tooltip content={'Pinned · ' + pinnedN} placement="bottom"><IconButton icon="pin" label={'Pinned, ' + pinnedN} size="sm" active={panel.type === 'pinned'} onClick={() => togglePanel('pinned')} /></Tooltip>}
        {!isDm && !isAgentDm && !narrow && <Tooltip content="Invite people" placement="bottom"><IconButton icon="user-plus" label="Invite people" size="sm" onClick={() => app.setDialog('invite')} /></Tooltip>}
        {!isDm && !isAgentDm && (narrow
          ? <IconButton icon="sparkles" label="Add agent" variant="agent" size="sm" onClick={() => app.setDialog('agent')} />
          : <Button variant="agent" size="sm" iconLeft="sparkles" onClick={() => app.setDialog('agent')}>Add agent</Button>)}
        {!isAgentDm && (
          <button type="button" onClick={() => togglePanel('members')} aria-pressed={panel.type === 'members'} aria-label={'Members: ' + humans.length + ' people, ' + agents.length + ' agents'}
            style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 10px 0 5px', borderRadius: 999, border: '1px solid ' + (panel.type === 'members' ? 'var(--accent)' : 'var(--border-subtle)'), background: panel.type === 'members' ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer', color: 'var(--text-muted)', font: '500 12.5px var(--font-body)', flexShrink: 0, marginLeft: 2 }}>
            <span style={{ display: 'flex' }}>{people.slice(0, 3).map((m, i) => <Avatar key={m.id} name={m.name} kind={m.kind} self={m.self} size={22} decorative style={{ marginLeft: i ? -7 : 0, borderRadius: 999, boxShadow: '0 0 0 2px var(--surface-page)' }} />)}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>{humans.length}<Icon name="user" size={12} /></span>
            {agents.length > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>{agents.length}<Icon name="sparkles" size={12} style={{ color: 'var(--agent-ink)' }} /></span>}
            {!narrow && <Kbd keys="mod+i" size="sm" />}
          </button>
        )}
      </header>
      <ConnectionBanner state={online ? 'online' : 'offline'} queued={peer?.queued.size || 0} />
      <HuddleStrip ch={ch} />
      {hud.code === code && hud.ch === ch && <HuddleStage />}
      <MessageList key={code + ch} ids={ids} ctx={ctx} lastRead={entryRead} emptyState={emptyState} highlight={highlight} />
      <div style={{ padding: narrow ? '0 10px 10px' : '0 20px 16px', flexShrink: 0 }}>
        {narrow && <div style={{ paddingBottom: 8 }}><HuddleDock /></div>}
        <TypingIndicator people={typing} style={{ padding: '0 4px 6px' }} />
        <Composer members={people.filter((m) => !m.self)} dropFiles={drop} autoFocus
          placeholder={isAgentDm ? 'Message ' + title + ' privately' : isDm ? 'Message ' + title : 'Message #' + title}
          note={note} onTyping={() => app.setTyping(ch)} onSend={(t, f) => app.send(t, f)} />
      </div>
      {dragging && (
        <div style={{ position: 'absolute', inset: 8, borderRadius: 20, border: '2px dashed var(--accent)', background: 'color-mix(in oklab, var(--accent) 8%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', font: '700 20px var(--font-display)', color: 'var(--text-strong)' }}>
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
      <div style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 520, textWrap: 'pretty' as any }}>{body}</div>
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  );
}

export function Centered({ title, body, children }: { title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32, textAlign: 'center' }}>
      <div style={{ font: '700 26px/1.1 var(--font-display)', letterSpacing: '-0.04em', color: 'var(--text-strong)' }}>{title}</div>
      {body && <div style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 440 }}>{body}</div>}
      {children}
    </div>
  );
}

