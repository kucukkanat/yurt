import React, { useMemo, useState } from 'react';
import { Icon, IconButton, Tooltip, Kbd, Badge, Avatar, DaemonStatus, Dialog, Button } from '@yurt/ui';
import { liveAgents, fingerprint, formatCode, agentDmChannel } from '@yurt/protocol';
import { useApp } from '../store';
import { useCurrent, unread, personFor, channelTitle } from '../model';
import { HuddleDock } from './Huddle';

function Row({ active, onClick, children, label, dim }: { active?: boolean; onClick: () => void; children: React.ReactNode; label?: string; dim?: boolean }) {
  const [h, setH] = useState(false);
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined} aria-label={label}
      onPointerEnter={() => setH(true)} onPointerLeave={() => setH(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 9, minHeight: 32, padding: '0 10px', border: 0, borderRadius: 8, width: '100%', cursor: 'pointer', font: 'inherit', fontSize: 14, textAlign: 'left', flexShrink: 0,
        background: active ? 'var(--surface-press)' : h ? 'var(--surface-hover)' : 'transparent', color: active ? 'var(--text-strong)' : 'var(--text-muted)', opacity: dim && !active ? 0.6 : 1, transition: 'background var(--dur-instant)' }}>
      {children}
    </button>
  );
}

function Section({ title, onAdd, addLabel, children }: { title: string; onAdd?: () => void; addLabel?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 4px 10px' }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-subtle)', lineHeight: '28px' }}>{title}</span>
        {onAdd && <IconButton icon="plus" label={addLabel || 'Add'} size="sm" onClick={onAdd} />}
      </div>
      {children}
    </div>
  );
}

const initialsOf = (s: string) => s.split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'Y';

export function Rail() {
  const workspaces = useApp((s) => s.workspaces);
  const states = useApp((s) => s.states);
  const route = useApp((s) => s.route);
  const identity = useApp((s) => s.identity)!;
  const { go, setDialog } = useApp.getState();
  return (
    <nav aria-label="Workspaces" style={{ width: 64, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '14px 0 12px', background: 'var(--surface-page)', borderRight: '1px solid var(--border-subtle)' }}>
      <span aria-hidden="true" style={{ font: '700 15px/1 var(--font-display)', letterSpacing: '-0.05em', color: 'var(--text-strong)', padding: '4px 0 6px' }}>yurt</span>
      {workspaces.map((w) => {
        const s = states[w.code];
        const active = route.code === w.code;
        let m = 0, n = 0;
        if (s && !active) for (const ch of s.channelMsgs.keys()) { if (w.muted.includes(ch)) continue; const u = unread(s, w, ch, identity.pub, identity.handle); m += u.m; n += u.n; }
        const name = s?.name || w.name;
        return (
          <Tooltip key={w.code} content={name} placement="bottom">
            <button type="button" onClick={() => go({ code: w.code })} aria-label={name + (m ? ', ' + m + ' mentions' : '')} aria-current={active ? 'page' : undefined}
              style={{ position: 'relative', width: 40, height: 40, borderRadius: 12, cursor: 'pointer', border: '1px solid ' + (active ? 'transparent' : 'var(--border-default)'),
                background: active ? 'var(--accent)' : 'var(--surface-card)', color: active ? 'var(--text-on-accent)' : 'var(--text-strong)', font: '700 15px/1 var(--font-display)', letterSpacing: '-0.03em',
                boxShadow: active ? 'var(--shadow-lip)' : 'none', transition: 'transform var(--dur-fast) var(--ease-spring)' }}>
              {initialsOf(name)}
              {n > 0 && !m && <span aria-hidden="true" style={{ position: 'absolute', left: -9, top: 15, width: 4, height: 8, borderRadius: 4, background: 'var(--text-strong)' }} />}
              {m > 0 && <Badge tone="human" variant="solid" size="sm" style={{ position: 'absolute', top: -6, right: -8 }}>{m}</Badge>}
            </button>
          </Tooltip>
        );
      })}
      <Tooltip content="Create or join a workspace" placement="bottom"><IconButton icon="plus" label="Create or join a workspace" onClick={() => setDialog('workspace')} /></Tooltip>
      <span style={{ flex: 1 }} />
      <Tooltip content="Settings" kbd="mod+," placement="top"><IconButton icon="settings" label="Settings" onClick={() => setDialog('settings')} /></Tooltip>
    </nav>
  );
}

export function Sidebar() {
  const { route, state, rec, identity, peer } = useCurrent();
  const bridgeStatus = useApp((s) => s.bridgeStatus);
  const bridgeState = useApp((s) => s.bridgeState);
  const { go, setDialog, leaveWorkspace } = useApp.getState();
  const [menu, setMenu] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const me = identity.pub;
  const channels = useMemo(() => (state ? [...state.channels.values()].sort((a, b) => a.name.localeCompare(b.name)) : []), [state]);
  const dms = useMemo(() => (state ? [...state.channelMsgs.keys()].filter((k) => k.startsWith('dm:') && k.includes(me)) : []), [state, me]);
  const myAgents = state ? liveAgents(state).filter((a) => a.owner === me) : [];
  const huddleChs = new Set<string>();
  if (peer) for (const h of peer.huddles.values()) if (h.ch) huddleChs.add(h.ch);
  const code = route.code!;
  const wsName = state?.name || rec?.name || formatCode(code);
  const openCh = (ch: string) => go({ code, ch });
  const daemon = bridgeStatus === 'connected' ? 'connected' : bridgeStatus === 'connecting' ? 'connecting' : 'missing';
  const nAgents = bridgeState?.agents.length;

  const chRow = (ch: string, label: React.ReactNode, icon: React.ReactNode, key?: string) => {
    const active = route.ch === ch;
    const muted = rec?.muted.includes(ch);
    const u = state && !active ? unread(state, rec, ch, me, identity.handle) : { n: 0, m: 0 };
    const bold = u.n > 0 && !muted;
    return (
      <Row key={key || ch} active={active} dim={muted} onClick={() => openCh(ch)}>
        {icon}
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: bold ? 700 : active ? 600 : 500, color: bold ? 'var(--text-strong)' : undefined }}>{label}</span>
        {huddleChs.has(ch) && <Icon name="headphones" size={14} style={{ color: 'var(--agent-ink)' }} />}
        {u.m > 0 && !muted && <Badge tone="human" variant="solid" size="sm">{u.m}</Badge>}
      </Row>
    );
  };

  return (
    <aside style={{ width: 'var(--layout-sidebar)', maxWidth: 'calc(100vw - 64px)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16, padding: '12px 10px 12px', background: 'var(--surface-sunken)', borderRight: '1px solid var(--border-subtle)', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ position: 'relative' }}>
        <button type="button" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu"
          style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', height: 40, padding: '0 8px 0 10px', border: 0, borderRadius: 10, background: menu ? 'var(--surface-press)' : 'transparent', cursor: 'pointer', color: 'var(--text-strong)', textAlign: 'left' }}>
          <span style={{ flex: 1, minWidth: 0, font: '700 19px/1.1 var(--font-display)', letterSpacing: '-0.04em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wsName}</span>
          <Icon name="chevron-down" size={16} style={{ color: 'var(--text-subtle)' }} />
        </button>
        {menu && (
          <div role="menu" onMouseLeave={() => setMenu(false)} style={{ position: 'absolute', top: 44, left: 0, right: 0, zIndex: 30, padding: 6, borderRadius: 14, background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-lg)', animation: 'ag-rise var(--dur-fast) var(--ease-out)' }}>
            <div style={{ padding: '6px 10px 8px', font: '400 11.5px/1.4 var(--font-mono)', color: 'var(--text-subtle)' }}>{peer?.presence.size || 0} online</div>
            <Row onClick={() => { setMenu(false); setDialog('invite'); }}><Icon name="user-plus" size={16} /><span>Invite people</span></Row>
            <Row onClick={() => { setMenu(false); setDialog('channel'); }}><Icon name="hash" size={16} /><span>New channel</span></Row>
            <Row onClick={() => { setMenu(false); setLeaving(true); }}><Icon name="log-out" size={16} /><span style={{ color: 'var(--danger-ink)' }}>Leave workspace</span></Row>
          </div>
        )}
      </div>
      <button type="button" onClick={() => setDialog('jump')} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, margin: '0 2px', padding: '0 8px 0 10px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--surface-card)', color: 'var(--text-subtle)', font: '400 13px var(--font-body)', cursor: 'pointer', flexShrink: 0 }}>
        <Icon name="search" size={15} /><span style={{ flex: 1, textAlign: 'left' }}>Jump to…</span><Kbd keys="mod+k" size="sm" />
      </button>
      <nav aria-label="Channels and messages" style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0, overflow: 'auto', flex: 1 }}>
        <Section title="Channels" onAdd={() => setDialog('channel')} addLabel="New channel">
          {!state?.channels.size && <div style={{ padding: '4px 10px', fontSize: 13, color: 'var(--text-subtle)' }}>Syncs when a member is online</div>}
          {channels.map((c) => chRow(c.id, c.name, <Icon name="hash" size={16} style={{ color: 'var(--text-subtle)' }} />))}
        </Section>
        <Section title="Direct messages" onAdd={() => setDialog('jump')} addLabel="New direct message">
          {dms.map((ch) => {
            const other = ch.slice(3).split(':').find((k) => k !== me) || me;
            const p = personFor(state, peer, other, me);
            return chRow(ch, channelTitle(state, ch, me) + (other === me ? ' (you)' : ''), <Avatar name={p.name} self={p.self} presence={p.presence} size={20} decorative cutout="var(--surface-sunken)" />);
          })}
          {!dms.length && <div style={{ padding: '4px 10px', fontSize: 13, color: 'var(--text-subtle)' }}>Press <Kbd keys="mod+k" size="sm" /> to message someone</div>}
        </Section>
        <Section title="Your agents" onAdd={() => setDialog('agent')} addLabel="Add agent">
          {myAgents.map((a) => {
            const p = personFor(state, peer, a.owner + '/' + a.id, me);
            return chRow(agentDmChannel(me, a.id), a.name, <Avatar name={a.name} kind="agent" presence={p.presence} working={p.working} size={20} decorative cutout="var(--surface-sunken)" />);
          })}
          {!myAgents.length && <div style={{ padding: '4px 10px', fontSize: 13, color: 'var(--text-subtle)' }}>Optional. Runs on your machine.</div>}
        </Section>
      </nav>
      <HuddleDock />
      <DaemonStatus status={daemon} version={bridgeState?.version} port={7717} agents={nAgents != null ? nAgents + (nAgents === 1 ? ' agent' : ' agents') : undefined} onClick={() => setDialog('bridge')} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 4px 0 6px', borderTop: '1px solid var(--border-subtle)' }}>
        <Avatar name={identity.name} self presence="online" size={30} cutout="var(--surface-sunken)" />
        <div style={{ flex: 1, lineHeight: 1.25, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{identity.name}</div>
          <div style={{ font: '400 11px/1.3 var(--font-mono)', color: 'var(--text-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>@{identity.handle} · {fingerprint(me)}</div>
        </div>
        <Tooltip content="Settings" kbd="mod+," placement="top"><IconButton icon="settings" label="Settings" size="sm" onClick={() => setDialog('settings')} /></Tooltip>
      </div>
      <Dialog open={leaving} onClose={() => setLeaving(false)} title={'Leave ' + wsName + '?'} width={440}
        description="This device forgets the workspace and its history. Rejoin any time with the code; history syncs back from members who are online."
        footer={<><Button variant="ghost" onClick={() => setLeaving(false)}>Stay</Button><Button variant="danger" iconLeft="log-out" onClick={() => { setLeaving(false); leaveWorkspace(code); }}>Leave workspace</Button></>} />
    </aside>
  );
}
