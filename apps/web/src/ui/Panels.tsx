import React, { useMemo, useState } from 'react';
import { Icon, IconButton, Button, Avatar, Badge, MemberRow, Input, Kbd } from '@yurt/ui';
import { fingerprint, dmChannel, agentDmChannel, type Msg } from '@yurt/protocol';
import { useApp } from '../store';
import { useCurrent, roster, personFor, authorKey, channelTitle, type Person } from '../model';
import { fmtTime, fmtDay } from '../lib/format';
import { MessageItem, type MsgCtx } from './Message';
import { Composer } from './Composer';
import { useTyping } from './ChannelView';

export function RightPanel({ narrow }: { narrow: boolean }) {
  const panel = useApp((s) => s.panel);
  const { route } = useCurrent();
  const close = () => {
    if (panel.type === 'thread') useApp.getState().go({ code: route.code, ch: route.ch });
    useApp.getState().setPanel({ type: null });
  };
  const titles: Record<string, string> = { members: 'Members', profile: 'Profile', thread: 'Thread', pinned: 'Pinned', search: 'Search' };
  return (
    <aside aria-label={titles[panel.type!]} style={narrow
      ? { position: 'fixed', inset: 0, zIndex: 'var(--z-dialog)' as any, background: 'var(--surface-page)', display: 'flex', flexDirection: 'column', animation: 'ag-rise var(--dur-base) var(--ease-out)' }
      : { width: 'var(--layout-panel, 320px)', minWidth: 300, flexShrink: 0, borderLeft: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface-page)' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, height: 56, padding: '0 8px 0 18px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        <span style={{ flex: 1, font: '700 16px/1 var(--font-display)', letterSpacing: '-0.02em', color: 'var(--text-strong)' }}>{titles[panel.type!]}</span>
        <IconButton icon="x" label="Close (Esc)" size="sm" onClick={close} />
      </header>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {panel.type === 'members' && <Members />}
        {panel.type === 'profile' && panel.id && <Profile id={panel.id} />}
        {panel.type === 'thread' && panel.id && <Thread id={panel.id} />}
        {panel.type === 'pinned' && <Pinned />}
        {panel.type === 'search' && <Search />}
      </div>
    </aside>
  );
}

function Members() {
  const { state, peer, identity } = useCurrent();
  const people = roster(state, peer, identity.pub);
  const open = (p: Person) => useApp.getState().setPanel({ type: 'profile', id: p.id });
  const group = (title: string, list: Person[]) => list.length > 0 && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ padding: '8px 10px 4px', fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-subtle)' }}>{title} · {list.length}</div>
      {list.map((p) => (
        <MemberRow key={p.id} member={p as any} onClick={() => open(p)} cutout="var(--surface-page)"
          meta={p.kind === 'agent' ? (p.owner?.self ? 'Yours' : p.owner?.name + '’s') + (p.presence === 'offline' ? ' · machine off' : p.working ? ' · working' : '') : p.creator ? 'Creator' : p.admin ? 'Admin' : undefined} />
      ))}
    </div>
  );
  return (
    <div style={{ overflow: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {group('People', people.filter((p) => p.kind === 'human'))}
      {group('Agents', people.filter((p) => p.kind === 'agent'))}
      <div style={{ padding: '4px 10px' }}><Button variant="secondary" size="sm" iconLeft="user-plus" onClick={() => useApp.getState().setDialog('invite')}>Invite people</Button></div>
    </div>
  );
}

function Profile({ id }: { id: string }) {
  const { state, peer, identity, route } = useCurrent();
  const app = useApp.getState();
  const p = personFor(state, peer, id, identity.pub);
  const me = identity.pub;
  const iAmCreator = state?.creator === me;
  const iAmAdmin = !!state?.admins.has(me);
  const code = route.code!;
  const Line = ({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) => (
    <div style={{ display: 'flex', gap: 12, fontSize: 13.5, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ width: 96, color: 'var(--text-subtle)', flexShrink: 0 }}>{k}</span>
      <span style={{ color: 'var(--text-body)', fontFamily: mono ? 'var(--font-mono)' : undefined, fontSize: mono ? 12.5 : undefined, minWidth: 0, overflowWrap: 'anywhere' }}>{v}</span>
    </div>
  );
  return (
    <div style={{ overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Avatar name={p.name} kind={p.kind} self={p.self} owner={p.kind === 'agent' ? p.owner : undefined} presence={p.presence} working={p.working} size={72} decorative cutout="var(--surface-page)" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ font: '700 24px/1.1 var(--font-display)', letterSpacing: '-0.035em', color: 'var(--text-strong)' }}>{p.name}</span>
          {p.kind === 'agent' && <Badge tone="agent" size="sm" icon="sparkles">Agent</Badge>}
          {p.creator && <Badge tone="accent" size="sm" icon="crown">Creator</Badge>}
          {!p.creator && p.admin && <Badge tone="accent" size="sm" icon="shield-check">Admin</Badge>}
          {p.banned && <Badge tone="danger" size="sm" icon="ban">Banned</Badge>}
        </div>
        <span style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>@{p.handle} · {p.presence === 'online' ? 'Online' : p.presence === 'away' ? 'Away' : 'Offline'}</span>
      </div>
      <div>
        {p.kind === 'agent' ? <>
          <Line k="Owner" v={p.owner?.self ? 'You' : p.owner?.name} />
          <Line k="Runtime" v={p.runtime || '—'} />
          <Line k="Runs on" v={(p.owner?.self ? 'Your' : p.owner?.name + '’s') + ' machine'} />
          <Line k="Owner key" v={fingerprint(p.pub)} mono />
        </> : <Line k="Key" v={fingerprint(p.pub)} mono />}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {p.kind === 'human' && <Button variant="primary" size="sm" iconLeft="message-square" onClick={() => app.go({ code, ch: dmChannel(me, p.pub) })}>{p.self ? 'Notes to self' : 'Message'}</Button>}
        {p.kind === 'agent' && p.owner?.self && <>
          <Button variant="agent" size="sm" iconLeft="lock" onClick={() => app.go({ code, ch: agentDmChannel(me, p.agentId!) })}>Message privately</Button>
          <Button variant="secondary" size="sm" iconLeft="external-link" onClick={() => window.open('http://127.0.0.1:7717/', '_blank')}>Configure</Button>
        </>}
      </div>
      {p.kind === 'human' && !p.self && iAmAdmin && !p.creator && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-subtle)' }}>Moderation</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {iAmCreator && !p.admin && !p.banned && <Button size="sm" variant="secondary" iconLeft="shield-check" onClick={() => app.publish(code, { t: 'role', b: { target: p.pub, admin: true } })}>Make admin</Button>}
            {p.admin && <Button size="sm" variant="secondary" onClick={() => app.publish(code, { t: 'role', b: { target: p.pub, admin: false } })}>Remove admin</Button>}
            {p.banned
              ? <Button size="sm" variant="secondary" onClick={() => app.publish(code, { t: 'ban', b: { target: p.pub, on: false } })}>Unban</Button>
              : <Button size="sm" variant="danger" iconLeft="ban" onClick={() => {
                  const e = app.publish(code, { t: 'ban', b: { target: p.pub, on: true } });
                  const pids = peer?.peerIdsFor([p.pub]) || [];
                  pids.forEach((pid) => (peer?.room?.getPeers()[pid] as RTCPeerConnection | undefined)?.close());
                  app.toast({ title: p.name + ' is banned', description: 'Their new messages are dropped by every member.', actionLabel: 'Undo', onAction: () => e && app.publish(code, { t: 'ban', b: { target: p.pub, on: false } }) });
                }}>Ban</Button>}
          </div>
        </div>
      )}
    </div>
  );
}

function Thread({ id }: { id: string }) {
  const { state, peer, identity, route } = useCurrent();
  const [, setN] = useState(0);
  const people = useMemo(() => roster(state, peer, identity.pub), [state, peer?.presence.size]);
  const typing = useTyping(route.ch || '');
  const parent = state?.msgs.get(id);
  if (!state || !parent) return <div style={{ padding: 20, fontSize: 14, color: 'var(--text-muted)' }}>This thread syncs once a member who has it is online.</div>;
  const ctx: MsgCtx = { state, peer, me: identity.pub, handle: identity.handle.toLowerCase(), roster: people, code: route.code!, inThread: true, forceRender: () => setN((x) => x + 1) };
  return (
    <>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 0 12px' }}>
        <MessageItem m={parent} continued={false} ctx={ctx} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-subtle)' }}>{parent.replies.length} {parent.replies.length === 1 ? 'reply' : 'replies'}</span>
          <span style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
        </div>
        {parent.replies.map((rid, i) => {
          const m = state.msgs.get(rid)!;
          const prev = i ? state.msgs.get(parent.replies[i - 1]) : undefined;
          return <MessageItem key={rid} m={m} ctx={ctx} continued={!!prev && authorKey(prev) === authorKey(m) && m.ts - prev.ts < 300000 && !m.trace} />;
        })}
      </div>
      <div style={{ padding: '0 12px 12px' }}>
        {typing.length > 0 && <div style={{ fontSize: 12, color: 'var(--text-subtle)', padding: '0 4px 6px' }}>{typing.map((t) => t.name).join(', ')} {typing.length === 1 ? 'is' : 'are'} typing…</div>}
        <Composer members={people.filter((m) => !m.self)} placeholder="Reply in thread" onSend={(t, f) => useApp.getState().send(t, f, id)} onTyping={() => useApp.getState().setTyping(route.ch || null)} autoFocus />
      </div>
    </>
  );
}

function ResultRow({ m, onClick }: { m: Msg; onClick: () => void }) {
  const { state, peer, identity } = useCurrent();
  const a = personFor(state, peer, authorKey(m), identity.pub);
  const [h, setH] = useState(false);
  return (
    <button type="button" onClick={onClick} onPointerEnter={() => setH(true)} onPointerLeave={() => setH(false)}
      style={{ display: 'flex', gap: 10, textAlign: 'left', padding: '10px 12px', border: '1px solid var(--border-subtle)', borderRadius: 14, background: h ? 'var(--surface-hover)' : 'var(--surface-card)', cursor: 'pointer', width: '100%' }}>
      <Avatar name={a.name} kind={a.kind} size={24} decorative />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}><b style={{ color: 'var(--text-strong)' }}>{a.name}</b> · {m.ch.includes(':') ? channelTitle(state, m.ch, identity.pub) : '#' + channelTitle(state, m.ch, identity.pub)} · {fmtDay(m.ts)} {fmtTime(m.ts)}</span>
        <span style={{ fontSize: 13.5, color: 'var(--text-body)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as any}>{m.text || m.files.map((f) => f.name).join(', ')}</span>
      </span>
    </button>
  );
}

function openMsg(code: string, m: Msg) {
  const app = useApp.getState();
  if (m.parent) app.go({ code, ch: m.ch, thread: m.parent });
  else { app.go({ code, ch: m.ch }); setTimeout(() => useApp.setState({ highlight: m.id }), 50); }
}

function Pinned() {
  const { state, route } = useCurrent();
  const ids = [...(state?.pins.get(route.ch || '') || [])];
  const msgs = ids.map((id) => state!.msgs.get(id)).filter((m): m is Msg => !!m && !m.deleted).sort((a, b) => b.ts - a.ts);
  return (
    <div style={{ overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {!msgs.length && <div style={{ padding: 8, fontSize: 14, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="pin" size={16} />Hover a message and pin it to keep it here.</div>}
      {msgs.map((m) => <ResultRow key={m.id} m={m} onClick={() => openMsg(route.code!, m)} />)}
    </div>
  );
}

function Search() {
  const { state, route, identity } = useCurrent();
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!state || s.length < 2) return [];
    const out: Msg[] = [];
    for (const m of state.msgs.values()) {
      if (m.deleted) continue;
      if (m.ch.startsWith('dm:') && !m.ch.includes(identity.pub)) continue;
      if (m.text.toLowerCase().includes(s) || m.files.some((f) => f.name.toLowerCase().includes(s))) out.push(m);
    }
    return out.sort((a, b) => b.ts - a.ts).slice(0, 100);
  }, [q, state]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div style={{ padding: 12 }}>
        <Input autoFocus iconLeft="search" placeholder="Search this workspace" aria-label="Search this workspace" value={q} onChange={(e) => setQ(e.target.value)} suffix={q ? <span style={{ font: '400 11px var(--font-mono)', color: 'var(--text-subtle)' }}>{results.length}</span> : <Kbd keys="mod+f" size="sm" />} />
      </div>
      <div style={{ overflow: 'auto', padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {q.trim().length >= 2 && !results.length && <div style={{ fontSize: 14, color: 'var(--text-muted)', padding: 8 }}>Nothing on this device matches “{q}”. Search covers history synced here.</div>}
        {results.map((m) => <ResultRow key={m.id} m={m} onClick={() => openMsg(route.code!, m)} />)}
      </div>
    </div>
  );
}
