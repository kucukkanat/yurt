import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, Button, Input, Tabs, Switch, Checkbox, Radio, Icon, Kbd, Avatar } from '@yurt/ui';
import { formatCode, fingerprint, dmChannel, agentDmChannel, liveAgents, inviteHash, type WsTransport } from '@yurt/protocol';
import { useApp } from '../store';
import { useCurrent, roster } from '../model';
import { bridge } from '../lib/bridge';

export function Dialogs() {
  const dialog = useApp((s) => s.dialog);
  const close = () => useApp.getState().setDialog(null);
  return (
    <>
      <WorkspaceDialog open={dialog === 'workspace'} onClose={close} />
      {dialog === 'channel' && <ChannelDialog onClose={close} />}
      {dialog === 'invite' && <InviteDialog onClose={close} />}
      {(dialog === 'agent' || dialog === 'bridge') && <AgentDialog onClose={close} mode={dialog} />}
      {dialog === 'settings' && <SettingsDialog onClose={close} />}
      {dialog === 'channelSettings' && <ChannelSettings onClose={close} />}
      {dialog === 'jump' && <JumpDialog onClose={close} />}
    </>
  );
}

function copy(text: string, what: string) {
  navigator.clipboard?.writeText(text).then(() => useApp.getState().toast({ tone: 'success', title: what + ' copied', duration: 2500 }));
}

export function CreateJoin({ onDone, initialTab = 'create' }: { onDone?: () => void; initialTab?: 'create' | 'join' }) {
  const [tab, setTab] = useState<string>(initialTab);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<WsTransport['kind']>('trystero');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const app = useApp.getState();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Tabs items={[{ id: 'create', label: 'Start a workspace', icon: 'plus' }, { id: 'join', label: 'Join with a link', icon: 'log-in' }]} value={tab} onChange={(t) => { setTab(t); setErr(''); }} fullWidth label="Create or join" />
      {tab === 'create' ? (
        <form onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return setErr('Give it a name people will recognize.'); await app.createWorkspace(name, kind); onDone?.(); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Input label="Workspace name" placeholder="Northwind design" value={name} onChange={(e) => setName(e.target.value)} error={err || undefined} autoFocus data-autofocus />
          <div role="radiogroup" aria-label="How messages travel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Radio name="transport" value="trystero" label="Live, peer to peer" description="Messages go straight between members’ browsers and are stored nowhere else. Members need to be online together to sync." checked={kind === 'trystero'} onChange={() => setKind('trystero')} data-testid="transport-trystero" />
            <Radio name="transport" value="nostr" label="Encrypted on Nostr relays" description="Relays keep end-to-end encrypted history, so messages arrive even when no one else is online. Relays can’t read them." checked={kind === 'nostr'} onChange={() => setKind('nostr')} data-testid="transport-nostr" />
          </div>
          <Button type="submit" variant="primary" iconRight="arrow-right" fullWidth>Create workspace</Button>
          <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>{kind === 'nostr'
            ? 'You get an invite link that carries the workspace key. Share it privately: anyone with it can read the history.'
            : 'You get an invite link that carries the workspace key. Share it privately: anyone with it can join.'}</span>
        </form>
      ) : (
        <form onSubmit={async (e) => { e.preventDefault(); if (!(await app.joinWorkspace(code))) return setErr('Paste the whole invite link. Codes alone can’t be joined: they carry no key.'); onDone?.(); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Input label="Invite link" placeholder="https://…/#/w/K7QX2MPD/k/…" data-testid="join-link" value={code} onChange={(e) => setCode(e.target.value)} error={err || undefined} autoFocus data-autofocus style={{ fontFamily: 'var(--font-mono)' }} />
          <Button type="submit" variant="primary" iconRight="arrow-right" fullWidth>Join workspace</Button>
          <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>The link carries the workspace key, so keep it private.</span>
        </form>
      )}
    </div>
  );
}

function WorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Dialog open={open} onClose={onClose} title="Create or join a workspace" width={460}>{open && <CreateJoin onDone={onClose} />}</Dialog>;
}

function ChannelDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  return (
    <Dialog open onClose={onClose} title="New channel" width={460} description="Everyone in the workspace can see and join it.">
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) { useApp.getState().createChannel(name, topic); onClose(); } }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Input label="Name" iconLeft="hash" placeholder="launch-q4" value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))} autoFocus data-autofocus />
        <Input label="Topic" optional placeholder="What happens here" value={topic} onChange={(e) => setTopic(e.target.value)} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!name.trim()}>Create channel</Button>
        </div>
      </form>
    </Dialog>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const { route, state, rec } = useCurrent();
  const code = route.code!;
  const transport = rec?.transport;
  const title = 'Invite to ' + (state?.name || rec?.name);
  if (!transport?.key) return (
    <Dialog open onClose={onClose} title={title} width={480} description="This workspace was created with a short code that anyone on the network can guess, so it can’t take new members safely.">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span data-testid="legacy-invite" style={{ fontSize: 14, color: 'var(--text-body)' }}>Create a new workspace and invite people there. Its link carries a key that can’t be guessed.</span>
        <div><Button variant="primary" iconLeft="plus" onClick={() => useApp.getState().setDialog('workspace')}>New workspace</Button></div>
      </div>
    </Dialog>
  );
  const link = location.origin + location.pathname + inviteHash({ code, transport: { ...transport, key: transport.key } });
  const description = transport.kind === 'nostr'
    ? 'This link contains the key that decrypts the workspace. Share it privately: anyone with it can read the whole history.'
    : 'This link contains the workspace key. Share it privately: anyone with it can join and sync the history.';
  return (
    <Dialog open onClose={onClose} title={title} width={480} description={description}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}><Input aria-label="Invite link" data-testid="invite-link" value={link} readOnly iconLeft="link" onFocus={(e) => e.target.select()} /></div>
          <Button variant="primary" iconLeft="copy" onClick={() => copy(link, 'Link')}>Copy link</Button>
        </div>
      </div>
    </Dialog>
  );
}

function AgentDialog({ onClose, mode }: { onClose: () => void; mode: 'agent' | 'bridge' }) {
  const status = useApp((s) => s.bridgeStatus);
  const bs = useApp((s) => s.bridgeState);
  const { route, state, identity } = useCurrent();
  const code = route.code;
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const inWs = bs?.workspaces.find((w) => w.code === code)?.agents || [];
  const [picked, setPicked] = useState<string[]>(inWs);
  useEffect(() => { setPicked(inWs); }, [bs?.workspaces.length, code]);
  useEffect(() => { if (status === 'off') bridge.start(); }, []);
  const cmd = 'npx yurt-bridge';
  let body: React.ReactNode;
  let footer: React.ReactNode = null;
  if (status === 'connected' && bs) {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
          <span style={{ width: 8, height: 8, borderRadius: 9, background: 'var(--volt-400)', boxShadow: '0 0 0 3px rgba(210,255,46,.18)' }} />
          yurt-bridge {bs.version} on this machine · {bs.agents.length} {bs.agents.length === 1 ? 'agent' : 'agents'}
        </div>
        {mode === 'agent' && code && (bs.agents.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 13.5, color: 'var(--text-body)' }}>Pick which of your agents join <b>{state?.name}</b>. They reply when someone @mentions them.</span>
            {bs.agents.map((a) => (
              <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 14, border: '1px solid ' + (picked.includes(a.id) ? 'var(--agent-ink)' : 'var(--border-subtle)'), background: picked.includes(a.id) ? 'var(--agent-soft)' : 'var(--surface-card)', cursor: 'pointer' }}>
                <Checkbox checked={picked.includes(a.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, a.id] : picked.filter((x) => x !== a.id))} aria-label={a.name} />
                <Avatar name={a.name} kind="agent" presence="online" size={28} decorative />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>{a.name} <span style={{ fontWeight: 400, color: 'var(--text-subtle)' }}>@{a.handle}</span></span>
                  <span style={{ font: '400 11.5px/1.3 var(--font-mono)', color: 'var(--text-subtle)' }}>{a.runtime}{a.model ? ' · ' + a.model : ''} · replies in {a.replyIn}</span>
                </span>
              </label>
            ))}
          </div>
        ) : <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>No agents yet. Create one in the bridge’s setup page: pick a runtime, a folder and what it’s allowed to do.</span>)}
      </div>
    );
    footer = <>
      <Button variant="ghost" iconLeft="external-link" onClick={() => window.open('http://127.0.0.1:7717/', '_blank')}>Open bridge setup</Button>
      {mode === 'agent' && code && bs.agents.length > 0 && <Button variant="agent" iconLeft="sparkles" onClick={() => { useApp.getState().setAgents(code, picked); useApp.getState().toast({ tone: 'agent', title: picked.length ? picked.length + (picked.length === 1 ? ' agent joins ' : ' agents join ') + (state?.name || '') : 'Agents removed from ' + (state?.name || '') }); onClose(); }}>Save</Button>}
      {mode === 'bridge' && <Button variant="secondary" onClick={() => { bridge.forget(); onClose(); }}>Forget this bridge</Button>}
    </>;
  } else if (status === 'unpaired') {
    body = (
      <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(''); const ok = await bridge.pair(pin.replace(/\D/g, '')); setBusy(false); if (!ok) setErr('That code didn’t match. Check the bridge page for the current one.'); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ fontSize: 14, color: 'var(--text-body)' }}>The bridge is running. Enter the 6-digit code it shows so only this browser can talk to it.</span>
        <Input label="Pairing code" inputMode="numeric" autoComplete="one-time-code" placeholder="123 456" value={pin} onChange={(e) => setPin(e.target.value)} error={err || undefined} autoFocus data-autofocus style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.2em' }} />
        <Button type="submit" variant="primary" loading={busy} disabled={pin.replace(/\D/g, '').length !== 6} fullWidth>Pair</Button>
      </form>
    );
  } else {
    body = (
      <ol style={{ display: 'flex', flexDirection: 'column', gap: 14, margin: 0, padding: 0, listStyle: 'none' }}>
        {[
          <>Open a terminal and run<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '8px 8px 8px 14px', borderRadius: 12, background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)' }}><code style={{ flex: 1, font: '500 14px var(--font-mono)', color: 'var(--text-strong)' }}>{cmd}</code><Button size="sm" variant="secondary" iconLeft="copy" onClick={() => copy(cmd, 'Command')}>Copy</Button></div><div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--text-subtle)' }}>Needs Node 20+ or Bun. <code style={{ fontFamily: 'var(--font-mono)' }}>bunx yurt-bridge</code> works too.</div></>,
          <>A setup page opens at <span style={{ fontFamily: 'var(--font-mono)' }}>127.0.0.1:7717</span>. It installs agent CLIs and lets you create agents. No config files.</>,
          <>Come back here and enter the pairing code it shows.</>,
        ].map((c, i) => (
          <li key={i} style={{ display: 'flex', gap: 12, fontSize: 14, color: 'var(--text-body)' }}>
            <span style={{ width: 24, height: 24, borderRadius: 999, background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '600 12px var(--font-mono)', flexShrink: 0 }}>{i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>{c}</div>
          </li>
        ))}
        <li style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-subtle)' }}>
          <Icon name="loader" size={14} style={{ animation: 'ag-spin 1s linear infinite' }} />Looking for the bridge on this machine…
        </li>
      </ol>
    );
  }
  return (
    <Dialog open onClose={onClose} width={520} footer={footer}
      title={mode === 'agent' ? 'Add agents' : 'Local bridge'}
      description={mode === 'agent' ? 'Agents are optional. They run on your machine with your agent CLI, and speak in public: everyone sees their work.' : 'yurt-bridge connects Yurt to agent CLIs on this machine (Copilot CLI, OpenCode, Codex, Claude Code, Pi).'}>
      {body}
    </Dialog>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const identity = useApp((s) => s.identity)!;
  const settings = useApp((s) => s.settings);
  const app = useApp.getState();
  const [tab, setTab] = useState('profile');
  const [name, setName] = useState(identity.name);
  const [handle, setHandle] = useState(identity.handle);
  const [reveal, setReveal] = useState(false);
  const [reset, setReset] = useState(false);
  const [net, setNet] = useState(settings);
  const perm = 'Notification' in window ? Notification.permission : 'denied';
  return (
    <Dialog open onClose={onClose} title="Settings" width={600}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Tabs items={[{ id: 'profile', label: 'Profile', icon: 'user' }, { id: 'identity', label: 'Identity', icon: 'key-round' }, { id: 'prefs', label: 'Preferences', icon: 'bell' }, { id: 'network', label: 'Network', icon: 'globe' }]} value={tab} onChange={setTab} size="sm" label="Settings sections" />
        {tab === 'profile' && (
          <form onSubmit={(e) => { e.preventDefault(); app.updateProfile(name, handle); app.toast({ tone: 'success', title: 'Profile updated in every workspace', duration: 3000 }); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Input label="Display name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input label="Handle" value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^\w-]/g, ''))} hint="People @mention you with this." iconLeft="at-sign" />
            <div><Button type="submit" variant="primary" disabled={!name.trim() || !handle.trim()}>Save profile</Button></div>
          </form>
        )}
        {tab === 'identity' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar name={identity.name} self size={40} decorative />
              <div><div style={{ fontWeight: 600, color: 'var(--text-strong)' }}>Your key</div><div style={{ font: '500 14px var(--font-mono)', color: 'var(--text-muted)' }}>{fingerprint(identity.pub)}</div></div>
            </div>
            <span style={{ fontSize: 14, color: 'var(--text-body)' }}>Your recovery phrase is your account. Enter it on another device to be the same person there. Anyone with it can speak as you.</span>
            {reveal ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 6, padding: 12, borderRadius: 16, background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)' }}>
                {identity.phrase.split(' ').map((w, i) => <span key={i} style={{ font: '500 13.5px/1.4 var(--font-mono)', color: 'var(--text-strong)' }}><span style={{ color: 'var(--text-subtle)' }}>{i + 1}.</span> {w}</span>)}
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="secondary" iconLeft={reveal ? 'eye-off' : 'eye'} onClick={() => setReveal(!reveal)}>{reveal ? 'Hide phrase' : 'Show recovery phrase'}</Button>
              {reveal && <Button variant="ghost" iconLeft="copy" onClick={() => copy(identity.phrase, 'Recovery phrase')}>Copy</Button>}
            </div>
            <div style={{ paddingTop: 14, borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>Remove your identity and every workspace from this browser. Other members keep their copies.</span>
              {reset
                ? <div style={{ display: 'flex', gap: 8 }}><Button variant="danger" iconLeft="trash-2" onClick={() => app.resetDevice()}>Erase this device</Button><Button variant="ghost" onClick={() => setReset(false)}>Keep everything</Button></div>
                : <div><Button variant="secondary" iconLeft="log-out" onClick={() => setReset(true)}>Sign out of this device</Button></div>}
            </div>
          </div>
        )}
        {tab === 'prefs' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Switch checked={settings.notifications && perm === 'granted'} onChange={(on) => app.updateSettings({ notifications: on })} label="Desktop notifications"
              description={perm === 'denied' ? 'Blocked in browser settings for this site.' : 'For @mentions, direct messages and agent approvals while Yurt is in the background.'} disabled={perm === 'denied'} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>Theme</span>
              <div style={{ display: 'flex', gap: 16 }}>
                <Radio name="theme" value="dark" label="Dark" checked={settings.theme === 'dark'} onChange={() => app.updateSettings({ theme: 'dark' })} />
                <Radio name="theme" value="light" label="Light" checked={settings.theme === 'light'} onChange={() => app.updateSettings({ theme: 'light' })} />
              </div>
            </div>
          </div>
        )}
        {tab === 'network' && (
          <form onSubmit={(e) => { e.preventDefault(); app.updateSettings(net); app.toast({ title: 'Network settings saved', description: 'Reload to reconnect with them.', actionLabel: 'Reload', onAction: () => location.reload() }); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span style={{ fontSize: 14, color: 'var(--text-body)' }}>Some networks block direct connections. A TURN relay forwards encrypted traffic when that happens, but whoever runs it sees your IP address and who you talk to. Off by default.</span>
            <Radio name="turn" value="default" label="Free public relay" description="Open Relay by Metered. Its operator sees your IP address and who you connect to (not content). Rate-limited." checked={net.turn === 'default'} onChange={() => setNet({ ...net, turn: 'default' })} />
            <Radio name="turn" value="custom" label="My own TURN server" checked={net.turn === 'custom'} onChange={() => setNet({ ...net, turn: 'custom' })} />
            {net.turn === 'custom' && <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 30 }}>
              <Input label="TURN URLs" placeholder="turn:turn.example.com:3478" value={net.turnUrls} onChange={(e) => setNet({ ...net, turnUrls: e.target.value })} />
              <div style={{ display: 'flex', gap: 8 }}><Input label="Username" value={net.turnUser} onChange={(e) => setNet({ ...net, turnUser: e.target.value })} /><Input label="Credential" type="password" value={net.turnPass} onChange={(e) => setNet({ ...net, turnPass: e.target.value })} /></div>
            </div>}
            <Radio name="turn" value="off" label="Direct only (STUN)" checked={net.turn === 'off'} onChange={() => setNet({ ...net, turn: 'off' })} />
            <Switch checked={net.webrtc} onChange={(on) => setNet({ ...net, webrtc: on })} label="Allow WebRTC for voice and video in relay workspaces" data-testid="webrtc-switch"
              description="Off: relay workspaces use only Nostr, and calls are unavailable. On: calls connect directly, so people in a call see each other’s IP addresses." />
            <Input label="Blossom file servers" optional placeholder="https://blossom.example.com" data-testid="blossom-servers" hint="Where relay workspaces keep encrypted files. Leave empty for the defaults." value={net.blossom} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNet({ ...net, blossom: e.target.value })} />
            <Input label="Nostr relays" optional placeholder="wss://relay.example.com" hint="Used to find peers, and as the relays for new encrypted relay workspaces. Leave empty for the defaults." value={net.relays} onChange={(e) => setNet({ ...net, relays: e.target.value })} />
            <div><Button type="submit" variant="primary">Save network settings</Button></div>
          </form>
        )}
      </div>
    </Dialog>
  );
}

function ChannelSettings({ onClose }: { onClose: () => void }) {
  const { route, state, rec } = useCurrent();
  const ch = state?.channels.get(route.ch || '');
  const [name, setName] = useState(ch?.name || '');
  const [topic, setTopic] = useState(ch?.topic || '');
  if (!ch || !route.code) return null;
  const muted = !!rec?.muted.includes(ch.id);
  return (
    <Dialog open onClose={onClose} title={'#' + ch.name} width={460}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => { useApp.getState().publish(route.code!, { t: 'ch.update', b: { id: ch.id, name: name.trim() || ch.name, topic } }); onClose(); }}>Save</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Input label="Name" iconLeft="hash" value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))} />
        <Input label="Topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What happens here" />
        <Switch checked={muted} onChange={() => useApp.getState().toggleMute(route.code!, ch.id)} label="Mute channel" description="No notifications or unread bold. Mentions still count." />
      </div>
    </Dialog>
  );
}

function JumpDialog({ onClose }: { onClose: () => void }) {
  const { route, state, peer, identity } = useCurrent();
  const workspaces = useApp((s) => s.workspaces);
  const app = useApp.getState();
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const me = identity.pub;
  type Item = { id: string; label: string; sub?: string; icon: React.ReactNode; go(): void };
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const code = route.code;
    if (state && code) {
      for (const c of state.channels.values()) out.push({ id: 'c' + c.id, label: c.name, sub: c.topic, icon: <Icon name="hash" size={16} />, go: () => app.go({ code, ch: c.id }) });
      for (const p of roster(state, peer, me)) {
        if (p.kind === 'human') out.push({ id: 'p' + p.id, label: p.name + (p.self ? ' (you)' : ''), sub: '@' + p.handle, icon: <Avatar name={p.name} self={p.self} presence={p.presence} size={20} decorative />, go: () => app.go({ code, ch: dmChannel(me, p.pub) }) });
      }
      for (const a of liveAgents(state).filter((x) => x.owner === me)) out.push({ id: 'a' + a.id, label: a.name, sub: 'Your agent · private chat', icon: <Avatar name={a.name} kind="agent" size={20} decorative />, go: () => app.go({ code, ch: agentDmChannel(me, a.id) }) });
    }
    for (const w of workspaces) if (w.code !== route.code) out.push({ id: 'w' + w.code, label: w.name, sub: 'Workspace · ' + formatCode(w.code), icon: <Icon name="layers" size={16} />, go: () => app.go({ code: w.code }) });
    const s = q.trim().toLowerCase();
    return (s ? out.filter((i) => i.label.toLowerCase().includes(s) || i.sub?.toLowerCase().includes(s)) : out).slice(0, 12);
  }, [q, state, workspaces]);
  const choose = (i: Item | undefined) => { if (i) { i.go(); onClose(); } };
  return (
    <Dialog open onClose={onClose} width={560} dismissible>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: -20 }}>
        <Input autoFocus data-autofocus iconLeft="search" placeholder="Jump to a channel, person or workspace" aria-label="Jump to" value={q}
          onChange={(e) => { setQ(e.target.value); setIdx(0); }}
          onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, items.length - 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); } if (e.key === 'Enter') { e.preventDefault(); choose(items[idx]); } }} />
        <div role="listbox" aria-label="Results" style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 380, overflow: 'auto' }}>
          {items.map((i, n) => (
            <button key={i.id} type="button" role="option" aria-selected={n === idx} onMouseEnter={() => setIdx(n)} onClick={() => choose(i)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, height: 40, padding: '0 10px', border: 0, borderRadius: 10, cursor: 'pointer', textAlign: 'left', background: n === idx ? 'var(--surface-press)' : 'transparent', color: 'var(--text-body)' }}>
              <span style={{ display: 'flex', color: 'var(--text-subtle)' }}>{i.icon}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>{i.label}</span>
              {i.sub && <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.sub}</span>}
              {n === idx && <Kbd keys="enter" size="sm" />}
            </button>
          ))}
          {!items.length && <div style={{ padding: 12, fontSize: 14, color: 'var(--text-muted)' }}>No match for “{q}”.</div>}
        </div>
      </div>
    </Dialog>
  );
}

