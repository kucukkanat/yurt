import type React from 'react';
import { useState } from 'react';
import { Dialog, Button, Input, Tabs, Switch, Icon, Kbd, Avatar } from '@yurt/ui';
import {
  formatCode,
  dmChannel,
  agentDmChannel,
  guestDmChannel,
  agentPrefs,
  liveAgents,
  parseRelays,
  parseServers,
  DEFAULT_RELAYS,
  type WorkspacePeer,
  type WsState,
} from '@yurt/protocol';
import { useApp, type WsRecord } from '../store';
import { useCurrent, roster } from '../model';
import { defaultNewNet, netFromForm } from '../lib/newNet';
import { Settings, InviteBody, listError, rejected } from './Settings';
import { CollabDialog } from './Collab';

export function Dialogs() {
  const dialog = useApp((s) => s.dialog);
  const collab = useApp((s) => s.collab);
  const state = useApp((s) => (s.route.code ? s.states[s.route.code] : undefined));
  const close = () => useApp.getState().setDialog(null);
  return (
    <>
      <WorkspaceDialog open={dialog === 'workspace'} onClose={close} />
      {dialog === 'channel' && <ChannelDialog onClose={close} />}
      {dialog === 'invite' && <InviteDialog onClose={close} />}
      {dialog === 'settings' && <Settings onClose={close} />}
      {dialog === 'channelSettings' && <ChannelSettings onClose={close} />}
      {dialog === 'jump' && <JumpDialog onClose={close} />}
      {dialog === 'collab' && collab && state && <CollabDialog form={collab} state={state} onClose={close} />}
    </>
  );
}

export function CreateJoin({ onDone }: { onDone?: () => void }) {
  const [tab, setTab] = useState('create');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const app = useApp.getState();
  // The new workspace's own network settings, prefilled from the last workspace created.
  const settings = useApp((x) => x.settings);
  const [start] = useState(() => defaultNewNet(settings.lastNet));
  const [relays, setRelays] = useState(start.relays.join(', '));
  const [blossom, setBlossom] = useState(start.blossom.join(', '));
  const [netOpen, setNetOpen] = useState(false);
  const [netErr, setNetErr] = useState<{ relays?: string | undefined; blossom?: string | undefined }>({});
  const list = (urls: string[], none: string) => (urls.length ? urls.join(', ') : none);
  const summary = 'Relays: ' + list(parseRelays(relays), DEFAULT_RELAYS.join(', ')) + ' · Files: ' + list(parseServers(blossom), 'default servers');
  const create = async () => {
    if (!name.trim()) return setErr('Give it a name people will recognize.');
    const errs = { relays: listError(rejected(relays, parseRelays), 'a ws:// or wss:// relay'), blossom: listError(rejected(blossom, parseServers), 'an http(s) server') };
    setNetErr(errs);
    if (Object.values(errs).some(Boolean)) {
      setNetOpen(true);
      return;
    }
    // The form's values through the same rules as a workspace's Connection settings: emptied fields mean the built-in defaults.
    const net = netFromForm({ relays, blossom });
    await app.createWorkspace(name, net);
    onDone?.();
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Tabs
        items={[
          { id: 'create', label: 'Start a workspace', icon: 'plus' },
          { id: 'join', label: 'Join with a link', icon: 'log-in' },
        ]}
        value={tab}
        onChange={(t) => {
          setTab(t);
          setErr('');
        }}
        fullWidth
        label="Create or join"
      />
      {tab === 'create' ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await create();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <Input label="Workspace name" placeholder="Northwind design" value={name} onChange={(e) => setName(e.target.value)} error={err || undefined} autoFocus data-autofocus />
          <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>
            Messages are end-to-end encrypted and kept on Nostr relays, so they arrive even when no one else is online. Relays can’t read them.
          </span>
          <div
            data-testid="create-net"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
              padding: 'var(--space-3)',
              borderRadius: 'var(--radius-md)',
              border: 'var(--border-width) solid var(--border-subtle)',
              background: 'var(--surface-sunken)',
            }}
          >
            <button
              type="button"
              data-testid="create-net-toggle"
              aria-expanded={netOpen}
              onClick={() => setNetOpen(!netOpen)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: 0,
                border: 0,
                background: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                color: 'var(--text-body)',
              }}
            >
              <Icon name={netOpen ? 'chevron-down' : 'chevron-right'} size={16} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 'var(--fs-body-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-strong)' }}>Network settings</span>
                <span
                  data-testid="create-net-summary"
                  style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {summary}
                </span>
              </span>
            </button>
            {netOpen && (
              <>
                <Input
                  label="Relays"
                  placeholder="wss://nos.lol"
                  data-testid="create-relays"
                  error={netErr.relays}
                  value={relays}
                  hint="ws:// or wss:// URLs, separated by spaces or commas. Empty means wss://nos.lol."
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRelays(e.target.value)}
                />
                <Input
                  label="File servers (Blossom)"
                  optional
                  placeholder="https://blossom.example.com"
                  data-testid="create-blossom"
                  error={netErr.blossom}
                  value={blossom}
                  hint="Where your uploads in this workspace go. Leave empty for the defaults."
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBlossom(e.target.value)}
                />
              </>
            )}
            {netOpen && (
              <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>
                Members need a relay in common; the invite link carries the relays (file servers stay on this device). Starts from what you used last.
              </span>
            )}
          </div>
          <Button type="submit" variant="primary" iconRight="arrow-right" fullWidth>
            Create workspace
          </Button>
          <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>
            You get an invite link that carries the workspace key. Share it privately: anyone with it can read the history.
          </span>
        </form>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!(await app.joinWorkspace(code))) return setErr('Paste the whole invite link. Codes alone can’t be joined: they carry no key.');
            onDone?.();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <Input
            label="Invite link"
            placeholder="https://…/#/w/K7QX2MPD/k/…"
            data-testid="join-link"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            error={err || undefined}
            autoFocus
            data-autofocus
            style={{ fontFamily: 'var(--font-mono)' }}
          />
          <Button type="submit" variant="primary" iconRight="arrow-right" fullWidth>
            Join workspace
          </Button>
          <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>The link carries the workspace key, so keep it private.</span>
        </form>
      )}
    </div>
  );
}

function WorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Create or join a workspace" width={460}>
      {open && <CreateJoin onDone={onClose} />}
    </Dialog>
  );
}

function ChannelDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  return (
    <Dialog open onClose={onClose} title="New channel" width={460} description="Everyone in the workspace can see and join it.">
      <form
        onSubmit={(e) => {
          // Submitting needs a name: the button is disabled without one, which also blocks Enter.
          e.preventDefault();
          useApp.getState().createChannel(name, topic);
          onClose();
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <Input
          label="Name"
          iconLeft="hash"
          placeholder="launch-q4"
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
          autoFocus
          data-autofocus
        />
        <Input label="Topic" optional placeholder="What happens here" value={topic} onChange={(e) => setTopic(e.target.value)} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            Create channel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ChannelSettings({ onClose }: { onClose: () => void }) {
  const { route, state, rec } = useCurrent();
  const ch = state?.channels.get(route.ch || '');
  const [name, setName] = useState(ch?.name || '');
  const [topic, setTopic] = useState(ch?.topic || '');
  const code = route.code;
  if (!ch || !code) return null;
  const muted = !!rec?.muted.includes(ch.id);
  return (
    <Dialog
      open
      onClose={onClose}
      title={'#' + ch.name}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              useApp.getState().publish(code, { t: 'ch.update', b: { id: ch.id, name: name.trim() || ch.name, topic } });
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Input label="Name" iconLeft="hash" value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))} />
        <Input label="Topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What happens here" />
        <Switch
          checked={muted}
          onChange={() => useApp.getState().toggleMute(code, ch.id)}
          label="Mute channel"
          description="No notifications or unread bold. Mentions still count."
        />
      </div>
    </Dialog>
  );
}

type Item = { id: string; label: string; sub?: string; icon: React.ReactNode; go(): void };

const agentIcon = (name: string) => <Avatar name={name} kind="agent" size={20} decorative />;

/** People (a DM each), my agents (their private chat), others' discoverable agents (a guest DM). */
function conversationItems(state: WsState, peer: WorkspacePeer | undefined, me: string, code: string): Item[] {
  const go = (ch: string) => () => useApp.getState().go({ code, ch });
  const people = roster(state, peer, me)
    .filter((p) => p.kind === 'human')
    .map((p) => ({
      id: 'p' + p.id,
      label: p.name + (p.self ? ' (you)' : ''),
      sub: '@' + p.handle,
      icon: <Avatar name={p.name} self={p.self} presence={p.presence} size={20} decorative />,
      go: go(dmChannel(me, p.pub)),
    }));
  const agents = liveAgents(state).flatMap((a): Item[] => {
    const icon = agentIcon(a.name);
    if (a.owner === me) return [{ id: 'a' + a.id, label: a.name, sub: 'Your agent · private chat', icon, go: go(agentDmChannel(me, a.id)) }];
    // Someone else's agent only when its owner made it discoverable; the rest are reached by @mention.
    if (!agentPrefs(a).discoverable) return [];
    return [
      {
        id: 'g' + a.owner + a.id,
        label: a.name,
        sub: (state.profiles.get(a.owner)?.name || 'Someone') + '’s agent · discoverable',
        icon,
        go: go(guestDmChannel(me, a.owner, a.id)),
      },
    ];
  });
  return [...people, ...agents];
}

/** Everything ⌘K can jump to: this workspace's channels and conversations, then the other workspaces. */
function jumpItems(state: WsState | undefined, peer: WorkspacePeer | undefined, me: string, code: string | undefined, workspaces: WsRecord[]): Item[] {
  const app = useApp.getState();
  const here: Item[] =
    state && code
      ? [
          ...[...state.channels.values()].map((c) => ({ id: 'c' + c.id, label: c.name, sub: c.topic, icon: <Icon name="hash" size={16} />, go: () => app.go({ code, ch: c.id }) })),
          ...conversationItems(state, peer, me, code),
        ]
      : [];
  const elsewhere = workspaces
    .filter((w) => w.code !== code)
    .map((w) => ({ id: 'w' + w.code, label: w.name, sub: 'Workspace · ' + formatCode(w.code), icon: <Icon name="layers" size={16} />, go: () => app.go({ code: w.code }) }));
  return [...here, ...elsewhere];
}

function JumpDialog({ onClose }: { onClose: () => void }) {
  const { route, state, peer, identity } = useCurrent();
  const workspaces = useApp((s) => s.workspaces);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const me = identity.pub;
  const s = q.trim().toLowerCase();
  const all = jumpItems(state, peer, me, route.code, workspaces);
  // Rebuilt every render (useCurrent re-renders on each tick), so names and presence are never stale.
  const items = (s ? all.filter((i) => i.label.toLowerCase().includes(s) || i.sub?.toLowerCase().includes(s)) : all).slice(0, 12);
  const choose = (i: Item | undefined) => {
    if (i) {
      i.go();
      onClose();
    }
  };
  return (
    <Dialog open onClose={onClose} width={560} label="Jump to" dismissible>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: -20 }}>
        <Input
          autoFocus
          data-autofocus
          iconLeft="search"
          placeholder="Jump to a channel, person or workspace"
          aria-label="Jump to"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIdx((i) => Math.min(i + 1, items.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIdx((i) => Math.max(i - 1, 0));
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              choose(items[idx]);
            }
          }}
        />
        <div role="listbox" aria-label="Results" style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 380, overflow: 'auto' }}>
          {items.map((i, n) => (
            <button
              key={i.id}
              type="button"
              role="option"
              aria-selected={n === idx}
              onMouseEnter={() => setIdx(n)}
              onClick={() => choose(i)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                height: 40,
                padding: '0 10px',
                border: 0,
                borderRadius: 10,
                cursor: 'pointer',
                textAlign: 'left',
                background: n === idx ? 'var(--surface-press)' : 'transparent',
                color: 'var(--text-body)',
              }}
            >
              <span style={{ display: 'flex', color: 'var(--text-subtle)' }}>{i.icon}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>{i.label}</span>
              {i.sub && (
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {i.sub}
                </span>
              )}
              {n === idx && <Kbd keys="enter" size="sm" />}
            </button>
          ))}
          {!items.length && <div style={{ padding: 12, fontSize: 14, color: 'var(--text-muted)' }}>No match for “{q}”.</div>}
        </div>
      </div>
    </Dialog>
  );
}

/** The quick share action; the same link lives in Settings → workspace → General. */
function InviteDialog({ onClose }: { onClose: () => void }) {
  const { state, rec } = useCurrent();
  return (
    <Dialog open onClose={onClose} title={'Invite to ' + (state?.name || rec?.name)} width={480}>
      <InviteBody />
    </Dialog>
  );
}
