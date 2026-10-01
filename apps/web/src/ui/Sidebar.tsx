import type React from 'react';
import { useId, useMemo, useState } from 'react';
import { Icon, IconButton, Tooltip, Kbd, Badge, Avatar, DaemonStatus } from '@yurt/ui';
import { liveAgents, fingerprint, formatCode, agentDmChannel, agentKey, parseGuestDm, type WsState } from '@yurt/protocol';
import { useApp, type WsRecord } from '../store';
import { useCurrent, unread, personFor, channelTitle, othersOnline } from '../model';
import { HuddleDock } from './Huddle';
import { Row, Section } from './Nav';
import { must } from './must';

const initialsOf = (s: string) =>
  s
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || 'Y';

/** Unread messages and mentions across a workspace's unmuted conversations. */
function workspaceUnread(s: WsState, w: WsRecord, me: { pub: string; handle: string }) {
  let m = 0;
  let n = 0;
  for (const ch of s.channelMsgs.keys()) {
    if (w.muted.includes(ch)) continue;
    const u = unread(s, w, ch, me.pub, me.handle);
    m += u.m;
    n += u.n;
  }
  return { m, n };
}

function RailButton({ w, state, active, me }: { w: WsRecord; state: WsState | undefined; active: boolean; me: { pub: string; handle: string } }) {
  const { go } = useApp.getState();
  const { m, n } = state && !active ? workspaceUnread(state, w, me) : { m: 0, n: 0 };
  const name = state?.name || w.name;
  return (
    <Tooltip content={name} placement="bottom">
      <button
        type="button"
        onClick={() => go({ code: w.code })}
        aria-label={name + (m ? ', ' + m + ' mentions' : '')}
        aria-current={active ? 'page' : undefined}
        style={{
          position: 'relative',
          width: 40,
          height: 40,
          borderRadius: 12,
          cursor: 'pointer',
          border: '1px solid ' + (active ? 'transparent' : 'var(--border-default)'),
          background: active ? 'var(--accent)' : 'var(--surface-card)',
          color: active ? 'var(--text-on-accent)' : 'var(--text-strong)',
          font: '700 15px/1 var(--font-display)',
          letterSpacing: '-0.03em',
          boxShadow: active ? 'var(--shadow-lip)' : 'none',
          transition: 'transform var(--dur-fast) var(--ease-spring)',
        }}
      >
        {initialsOf(name)}
        {n > 0 && !m && <span aria-hidden="true" style={{ position: 'absolute', left: -9, top: 15, width: 4, height: 8, borderRadius: 4, background: 'var(--text-strong)' }} />}
        {m > 0 && (
          <Badge tone="human" variant="solid" size="sm" style={{ position: 'absolute', top: -6, right: -8 }}>
            {m}
          </Badge>
        )}
      </button>
    </Tooltip>
  );
}

export function Rail() {
  const workspaces = useApp((s) => s.workspaces);
  const states = useApp((s) => s.states);
  const route = useApp((s) => s.route);
  const identity = must(
    useApp((s) => s.identity),
    'The workspace rail only shows after onboarding',
  );
  const { setDialog, openSettings } = useApp.getState();
  return (
    <nav
      aria-label="Workspaces"
      style={{
        width: 64,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        padding: '14px 0 12px',
        background: 'var(--surface-page)',
        borderRight: '1px solid var(--border-subtle)',
      }}
    >
      <span aria-hidden="true" style={{ font: '700 15px/1 var(--font-display)', letterSpacing: '-0.05em', color: 'var(--text-strong)', padding: '4px 0 6px' }}>
        yurt
      </span>
      {workspaces.map((w) => (
        <RailButton key={w.code} w={w} state={states[w.code]} active={route.code === w.code} me={identity} />
      ))}
      <Tooltip content="Create or join a workspace" placement="bottom">
        <IconButton icon="plus" label="Create or join a workspace" onClick={() => setDialog('workspace')} />
      </Tooltip>
      <span style={{ flex: 1 }} />
      {/* The only Settings button: always here (in the drawer on narrow screens), inside a workspace or not. */}
      <Tooltip content="Settings" kbd="mod+," placement="top">
        <IconButton icon="settings" label="Settings" data-testid="settings-button" onClick={() => openSettings()} />
      </Tooltip>
    </nav>
  );
}

/** One conversation in the sidebar: bold when unread, a badge for mentions, headphones when a call is on. */
function ChannelRow({ ch, label, icon, inCall }: { ch: string; label: React.ReactNode; icon: React.ReactNode; inCall: boolean }) {
  const { route, state, rec, identity } = useCurrent();
  const active = route.ch === ch;
  const muted = rec?.muted.includes(ch);
  const u = state && !active ? unread(state, rec, ch, identity.pub, identity.handle) : { n: 0, m: 0 };
  const bold = u.n > 0 && !muted;
  return (
    <Row active={active} dim={muted} onClick={() => useApp.getState().go({ code: route.code, ch })}>
      {icon}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontWeight: bold ? 700 : active ? 600 : 500,
          color: bold ? 'var(--text-strong)' : undefined,
        }}
      >
        {label}
      </span>
      {inCall && <Icon name="headphones" size={14} style={{ color: 'var(--agent-ink)' }} />}
      {u.m > 0 && !muted && (
        <Badge tone="human" variant="solid" size="sm">
          {u.m}
        </Badge>
      )}
    </Row>
  );
}

/** The workspace name, its mode chip and the menu under it. */
function WorkspaceMenu({ name, relayed, others }: { name: string; relayed: boolean; others: number }) {
  const { setDialog, openSettings } = useApp.getState();
  const [menu, setMenu] = useState(false);
  const menuId = useId();
  // A disclosure (a button that shows a list of buttons), not an ARIA menu: Tab moves through it like any buttons.
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        data-testid="ws-menu-button"
        onClick={() => setMenu((m) => !m)}
        aria-expanded={menu}
        aria-controls={menu ? menuId : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          height: 40,
          padding: '0 8px 0 10px',
          border: 0,
          borderRadius: 10,
          background: menu ? 'var(--surface-press)' : 'transparent',
          cursor: 'pointer',
          color: 'var(--text-strong)',
          textAlign: 'left',
        }}
      >
        <span
          style={{ flex: 1, minWidth: 0, font: '700 19px/1.1 var(--font-display)', letterSpacing: '-0.04em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {name}
        </span>
        <Icon name="chevron-down" size={16} style={{ color: 'var(--text-subtle)' }} />
      </button>
      <ModeChip relayed={relayed} onClick={() => openSettings('ws-network')} />
      {menu && (
        // biome-ignore lint/a11y/noStaticElementInteractions: closing when the pointer leaves is a pointer convenience; keyboard users close it with its toggle or by choosing an item
        <div
          id={menuId}
          data-testid="ws-menu"
          onMouseLeave={() => setMenu(false)}
          style={{
            position: 'absolute',
            top: 44,
            left: 0,
            right: 0,
            zIndex: 30,
            padding: 6,
            borderRadius: 14,
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-lg)',
            animation: 'ag-rise var(--dur-fast) var(--ease-out)',
          }}
        >
          <div data-testid="ws-online" style={{ padding: '6px 10px 8px', font: '400 11.5px/1.4 var(--font-mono)', color: 'var(--text-subtle)' }}>
            {others ? others + (others === 1 ? ' other member' : ' other members') + ' online' : 'No other members online'}
          </div>
          <Row
            onClick={() => {
              setMenu(false);
              setDialog('invite');
            }}
          >
            <Icon name="user-plus" size={16} />
            <span>Invite people</span>
          </Row>
          <Row
            onClick={() => {
              setMenu(false);
              setDialog('channel');
            }}
          >
            <Icon name="hash" size={16} />
            <span>New channel</span>
          </Row>
          {/* Shortcuts into the single Settings window. */}
          <Row
            testId="menu-settings"
            onClick={() => {
              setMenu(false);
              openSettings('ws-general');
            }}
          >
            <Icon name="settings" size={16} />
            <span>Workspace settings</span>
          </Row>
          <Row
            testId="menu-connection"
            onClick={() => {
              setMenu(false);
              openSettings('ws-network');
            }}
          >
            <Icon name="globe" size={16} />
            <span>Network settings</span>
          </Row>
          <Row
            testId="menu-leave"
            onClick={() => {
              setMenu(false);
              openSettings('ws-general');
            }}
          >
            <Icon name="log-out" size={16} />
            <span style={{ color: 'var(--danger-ink)' }}>Leave workspace</span>
          </Row>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const { route, state, rec, identity, peer } = useCurrent();
  const bridgeStatus = useApp((s) => s.bridgeStatus);
  const bridgeState = useApp((s) => s.bridgeState);
  const { setDialog, openSettings } = useApp.getState();
  const me = identity.pub;
  const channels = useMemo(() => (state ? [...state.channels.values()].sort((a, b) => a.name.localeCompare(b.name)) : []), [state]);
  const dms = useMemo(() => (state ? [...state.channelMsgs.keys()].filter((k) => (k.startsWith('dm:') && k.includes(me)) || parseGuestDm(k)?.member === me) : []), [state, me]);
  // Other members' conversations with my discoverable agents, listed under each agent.
  const guestChats = useMemo(
    () =>
      state
        ? [...state.channelMsgs.keys()].flatMap((k) => {
            const g = parseGuestDm(k);
            return g && g.owner === me && g.member !== me ? [{ ch: k, ...g }] : [];
          })
        : [],
    [state, me],
  );
  const myAgents = state ? liveAgents(state).filter((a) => a.owner === me) : [];
  const huddleChs = new Set<string>();
  if (peer) for (const h of peer.huddles.values()) if (h.ch) huddleChs.add(h.ch);
  const code = must(route.code, 'The sidebar only shows inside a workspace');
  const wsName = state?.name || rec?.name || formatCode(code);
  const daemon = bridgeStatus === 'connected' ? 'connected' : bridgeStatus === 'connecting' ? 'connecting' : 'missing';
  const nAgents = bridgeState?.agents.length;
  const relayed = rec?.transport.kind === 'nostr';
  const others = othersOnline(peer, me);

  const chRow = (ch: string, label: React.ReactNode, icon: React.ReactNode) => <ChannelRow key={ch} ch={ch} label={label} icon={icon} inCall={huddleChs.has(ch)} />;

  return (
    <aside
      aria-label="Workspace"
      style={{
        width: 'var(--layout-sidebar)',
        maxWidth: 'calc(100vw - 64px)',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        padding: '12px 10px 12px',
        background: 'var(--surface-sunken)',
        borderRight: '1px solid var(--border-subtle)',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      <WorkspaceMenu name={wsName} relayed={relayed} others={others} />
      <button
        type="button"
        onClick={() => setDialog('jump')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 34,
          margin: '0 2px',
          padding: '0 8px 0 10px',
          borderRadius: 10,
          border: '1px solid var(--border-subtle)',
          background: 'var(--surface-card)',
          color: 'var(--text-subtle)',
          font: '400 13px var(--font-body)',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <Icon name="search" size={15} />
        <span style={{ flex: 1, textAlign: 'left' }}>Jump to…</span>
        <Kbd keys="mod+k" size="sm" />
      </button>
      <nav aria-label="Channels and messages" style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0, overflow: 'auto', flex: 1 }}>
        <Section title="Channels" onAdd={() => setDialog('channel')} addLabel="New channel">
          {!state?.channels.size && (
            <div style={{ padding: '4px 10px', fontSize: 13, color: 'var(--text-subtle)' }}>{relayed ? 'Syncing from relays…' : 'Syncs when a member is online'}</div>
          )}
          {channels.map((c) => chRow(c.id, c.name, <Icon name="hash" size={16} style={{ color: 'var(--text-subtle)' }} />))}
        </Section>
        <Section title="Direct messages" onAdd={() => setDialog('jump')} addLabel="New direct message">
          {dms.map((ch) => {
            const g = parseGuestDm(ch);
            if (g) {
              const p = personFor(state, peer, agentKey(g.owner, g.agentId), me);
              return chRow(
                ch,
                channelTitle(state, ch, me),
                <Avatar name={p.name} kind="agent" presence={p.presence} working={p.working} size={20} decorative cutout="var(--surface-sunken)" />,
              );
            }
            const other =
              ch
                .slice(3)
                .split(':')
                .find((k) => k !== me) || me;
            const p = personFor(state, peer, other, me);
            return chRow(
              ch,
              channelTitle(state, ch, me) + (other === me ? ' (you)' : ''),
              <Avatar name={p.name} self={p.self} presence={p.presence} size={20} decorative cutout="var(--surface-sunken)" />,
            );
          })}
          {!dms.length && (
            <div style={{ padding: '4px 10px', fontSize: 13, color: 'var(--text-subtle)' }}>
              Press <Kbd keys="mod+k" size="sm" /> to message someone
            </div>
          )}
        </Section>
        <Section title="Your agents" onAdd={() => openSettings('ws-agents')} addLabel="Add agent">
          {myAgents.map((a) => {
            const p = personFor(state, peer, a.owner + '/' + a.id, me);
            return [
              chRow(
                agentDmChannel(me, a.id),
                a.name,
                <Avatar name={a.name} kind="agent" presence={p.presence} working={p.working} size={20} decorative cutout="var(--surface-sunken)" />,
              ),
              ...guestChats
                .filter((g) => g.agentId === a.id)
                .map((g) => {
                  const who = personFor(state, peer, g.member, me);
                  return chRow(
                    g.ch,
                    <span data-testid="guest-chat-row" style={{ paddingLeft: 'var(--space-4)' }}>
                      {who.name}
                    </span>,
                    <Avatar name={who.name} presence={who.presence} size={16} decorative cutout="var(--surface-sunken)" />,
                  );
                }),
            ];
          })}
          {!myAgents.length && <div style={{ padding: '4px 10px', fontSize: 13, color: 'var(--text-subtle)' }}>Optional. Runs on your machine.</div>}
        </Section>
      </nav>
      <HuddleDock />
      <DaemonStatus
        status={daemon}
        version={bridgeState?.version}
        port={7717}
        agents={nAgents != null ? nAgents + (nAgents === 1 ? ' agent' : ' agents') : undefined}
        onClick={() => openSettings('agents')}
      />
      {/* You: opens your profile in Settings (the gear in the rail is the one Settings button). */}
      <button
        type="button"
        data-testid="me-row"
        aria-label="Your profile and settings"
        onClick={() => openSettings('profile')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 4px 0 6px',
          border: 0,
          borderTop: '1px solid var(--border-subtle)',
          background: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          font: 'inherit',
        }}
      >
        <Avatar name={identity.name} self presence="online" size={30} cutout="var(--surface-sunken)" />
        <span style={{ display: 'block', flex: 1, lineHeight: 1.25, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--text-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {identity.name}
          </span>
          <span
            style={{ display: 'block', font: '400 11px/1.3 var(--font-mono)', color: 'var(--text-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            @{identity.handle} · {fingerprint(me)}
          </span>
        </span>
      </button>
    </aside>
  );
}

/** Which network mode this workspace uses; fixed at creation. Clicking opens its network settings. */
export function ModeChip({ relayed, onClick }: { relayed: boolean; onClick?: () => void }) {
  const style: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-1)',
    alignSelf: 'flex-start',
    margin: '2px 0 0 10px',
    padding: '2px 8px',
    borderRadius: 'var(--radius-pill)',
    border: 'var(--border-width) solid var(--border-subtle)',
    background: 'var(--surface-card)',
    color: 'var(--text-muted)',
    font: '500 11.5px/1.4 var(--font-body)',
    cursor: onClick ? 'pointer' : 'default',
  };
  const body = (
    <>
      <Icon name={relayed ? 'database' : 'users'} size={12} />
      {relayed ? 'Nostr relays' : 'Peer-to-peer'}
    </>
  );
  return onClick ? (
    <button type="button" data-testid="mode-chip" onClick={onClick} title="Network mode (set when the workspace was created)" style={style}>
      {body}
    </button>
  ) : (
    <span data-testid="mode-chip" style={style}>
      {body}
    </span>
  );
}
