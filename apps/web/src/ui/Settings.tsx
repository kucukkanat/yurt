import type React from 'react';
import { useEffect, useReducer, useState } from 'react';
import { Dialog, Button, Input, Switch, Checkbox, Radio, Icon, Avatar, IconButton } from '@yurt/ui';
import { fingerprint, inviteHash, parseRelays, parseServers, signalingOf, formatCode, agentPrefs, type SignalKind } from '@yurt/protocol';
import { useApp, type SettingsSection } from '../store';
import { useCurrent, useMedia, prefsLine } from '../model';
import { bridge } from '../lib/bridge';
import type { NetSettings } from '../lib/net';
import { Row, Section } from './Nav';
import { ModeChip } from './Sidebar';

/**
 * The one Settings window. "You" holds your account and this device; the workspace group (only inside
 * a workspace) holds that workspace's settings, for its own network mode only.
 */

/** Entries of a free-text URL list that `parse` rejects, so a typo is reported instead of silently dropped. */
export const rejected = (text: string, parse: (s: string) => string[]) => text.split(/[\s,]+/).filter((t) => t && !parse(t).length);
export const listError = (bad: string[], what: string) => (bad.length ? 'Not ' + what + ': ' + bad.join(', ') : undefined);
function copy(text: string, what: string) {
  navigator.clipboard?.writeText(text).then(() => useApp.getState().toast({ tone: 'success', title: what + ' copied', duration: 2500 }));
}
type Turn = Pick<NetSettings, 'turn' | 'turnUrls' | 'turnUser' | 'turnPass'>;
const pickTurn = (s: Turn): Turn => ({ turn: s.turn, turnUrls: s.turnUrls, turnUser: s.turnUser, turnPass: s.turnPass });
const sameTurn = (a: Turn, b: Turn) => a.turn === b.turn && a.turnUrls === b.turnUrls && a.turnUser === b.turnUser && a.turnPass === b.turnPass;

const YOU: { id: SettingsSection; label: string; icon: React.ComponentProps<typeof Icon>['name'] }[] = [
  { id: 'profile', label: 'Profile', icon: 'user' },
  { id: 'identity', label: 'Identity', icon: 'key-round' },
  { id: 'preferences', label: 'Preferences', icon: 'bell' },
  { id: 'connection', label: 'Connection', icon: 'globe' },
  { id: 'agents', label: 'Agents & bridge', icon: 'sparkles' },
];
const WORKSPACE: typeof YOU = [
  { id: 'ws-general', label: 'General', icon: 'settings' },
  { id: 'ws-network', label: 'Network', icon: 'link' },
  { id: 'ws-agents', label: 'Agents', icon: 'sparkles' },
];

export function Settings({ onClose }: { onClose: () => void }) {
  const section = useApp((s) => s.settingsSection);
  const { route, state, rec } = useCurrent();
  const narrow = useMedia('(max-width: 760px)');
  // Narrow screens show the list first, then one section with a way back.
  const [listing, setListing] = useState(narrow);
  const inWs = !!route.code && !!rec;
  const items = [...YOU, ...(inWs ? WORKSPACE : [])];
  const current = items.find((i) => i.id === section) ?? YOU[0];
  const pick = (id: SettingsSection) => {
    useApp.setState({ settingsSection: id });
    setListing(false);
  };
  const nav = (
    <nav aria-label="Settings sections" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', width: narrow ? '100%' : 200, flexShrink: 0 }}>
      <Section title="You">
        {YOU.map((i) => (
          <Row key={i.id} active={!narrow && current.id === i.id} testId={'settings-nav-' + i.id} onClick={() => pick(i.id)}>
            <Icon name={i.icon} size={16} />
            <span>{i.label}</span>
          </Row>
        ))}
      </Section>
      {inWs && rec && (
        <Section title={state?.name || rec.name}>
          <ModeChip relayed={rec.transport.kind === 'nostr'} />
          {WORKSPACE.map((i) => (
            <Row key={i.id} active={!narrow && current.id === i.id} testId={'settings-nav-' + i.id} onClick={() => pick(i.id)}>
              <Icon name={i.icon} size={16} />
              <span>{i.label}</span>
            </Row>
          ))}
        </Section>
      )}
    </nav>
  );
  const body = (
    <div data-testid={'settings-section-' + current.id} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        {narrow && <IconButton icon="arrow-left" label="All settings" size="sm" data-testid="settings-back" onClick={() => setListing(true)} />}
        <h3 style={{ margin: 0, font: 'var(--weight-bold) var(--fs-body-lg)/1.2 var(--font-display)', color: 'var(--text-strong)' }}>
          {current.id.startsWith('ws-') ? (state?.name || rec?.name) + ' · ' : ''}
          {current.label}
        </h3>
      </div>
      <SectionBody id={current.id} />
    </div>
  );
  return (
    <Dialog open onClose={onClose} title="Settings" width={820}>
      <div data-testid="settings" style={{ display: 'flex', gap: 'var(--space-6)', alignItems: 'flex-start' }}>
        {narrow ? (
          listing ? (
            nav
          ) : (
            body
          )
        ) : (
          <>
            {nav}
            {body}
          </>
        )}
      </div>
    </Dialog>
  );
}

function SectionBody({ id }: { id: SettingsSection }) {
  switch (id) {
    case 'profile':
      return <ProfileSection />;
    case 'identity':
      return <IdentitySection />;
    case 'preferences':
      return <PreferencesSection />;
    case 'connection':
      return <ConnectionSection />;
    case 'agents':
      return <BridgeSection />;
    case 'ws-general':
      return <GeneralSection />;
    case 'ws-network':
      return <NetworkSection />;
    case 'ws-agents':
      return <WsAgentsSection />;
  }
}

const Muted = ({ children, testId }: { children: React.ReactNode; testId?: string }) => (
  <span data-testid={testId} style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text-muted)' }}>
    {children}
  </span>
);
const SubHead = ({ children }: { children: React.ReactNode }) => (
  <span
    style={{
      marginTop: 'var(--space-2)',
      fontSize: 'var(--fs-caption)',
      fontWeight: 'var(--weight-semibold)',
      letterSpacing: '.08em',
      textTransform: 'uppercase',
      color: 'var(--text-subtle)',
    }}
  >
    {children}
  </span>
);

/* ---------- You ---------- */

function ProfileSection() {
  const identity = useApp((s) => s.identity);
  const app = useApp.getState();
  const [name, setName] = useState(identity?.name ?? '');
  const [handle, setHandle] = useState(identity?.handle ?? '');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        app.updateProfile(name, handle);
        app.toast({ tone: 'success', title: 'Profile updated in every workspace', duration: 3000 });
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
    >
      <Input label="Display name" value={name} onChange={(e) => setName(e.target.value)} />
      <Input
        label="Handle"
        value={handle}
        onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^\w-]/g, ''))}
        hint="People @mention you with this."
        iconLeft="at-sign"
      />
      <div>
        <Button type="submit" variant="primary" disabled={!name.trim() || !handle.trim()}>
          Save profile
        </Button>
      </div>
    </form>
  );
}

function IdentitySection() {
  const identity = useApp((s) => s.identity);
  const app = useApp.getState();
  const [reveal, setReveal] = useState(false);
  const [reset, setReset] = useState(false);
  if (!identity) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <Avatar name={identity.name} self size={40} decorative />
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text-strong)' }}>Your key</div>
          <div style={{ font: '500 14px var(--font-mono)', color: 'var(--text-muted)' }}>{fingerprint(identity.pub)}</div>
        </div>
      </div>
      <Muted>Your recovery phrase is your account. Enter it on another device to be the same person there. Anyone with it can speak as you.</Muted>
      {reveal && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
            gap: 6,
            padding: 12,
            borderRadius: 16,
            background: 'var(--surface-sunken)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          {identity.phrase.split(' ').map((w, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a recovery phrase never reorders and may repeat a word, so its position is the identity
            <span key={i} style={{ font: '500 13.5px/1.4 var(--font-mono)', color: 'var(--text-strong)' }}>
              <span style={{ color: 'var(--text-subtle)' }}>{i + 1}.</span> {w}
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <Button variant="secondary" iconLeft={reveal ? 'eye-off' : 'eye'} onClick={() => setReveal(!reveal)}>
          {reveal ? 'Hide phrase' : 'Show recovery phrase'}
        </Button>
        {reveal && (
          <Button variant="ghost" iconLeft="copy" onClick={() => copy(identity.phrase, 'Recovery phrase')}>
            Copy
          </Button>
        )}
      </div>
      <DangerZone>
        <Muted>Remove your identity and every workspace from this browser. Other members keep their copies.</Muted>
        {reset ? (
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button variant="danger" iconLeft="trash-2" onClick={() => app.resetDevice()}>
              Erase this device
            </Button>
            <Button variant="ghost" onClick={() => setReset(false)}>
              Keep everything
            </Button>
          </div>
        ) : (
          <div>
            <Button variant="secondary" iconLeft="log-out" onClick={() => setReset(true)}>
              Sign out of this device
            </Button>
          </div>
        )}
      </DangerZone>
    </div>
  );
}

function PreferencesSection() {
  const settings = useApp((s) => s.settings);
  const app = useApp.getState();
  const perm = 'Notification' in window ? Notification.permission : 'denied';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Switch
        checked={settings.notifications && perm === 'granted'}
        onChange={(on) => app.updateSettings({ notifications: on })}
        label="Desktop notifications"
        description={perm === 'denied' ? 'Blocked in browser settings for this site.' : 'For @mentions, direct messages and agent approvals while Yurt is in the background.'}
        disabled={perm === 'denied'}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>Theme</span>
        <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
          <Radio name="theme" value="dark" label="Dark" checked={settings.theme === 'dark'} onChange={() => app.updateSettings({ theme: 'dark' })} />
          <Radio name="theme" value="light" label="Light" checked={settings.theme === 'light'} onChange={() => app.updateSettings({ theme: 'light' })} />
        </div>
      </div>
    </div>
  );
}

/** How this device connects, in any workspace. Each workspace's own network is in its section. */
function ConnectionSection() {
  const settings = useApp((s) => s.settings);
  const app = useApp.getState();
  const inWs = !!useApp((s) => s.route.code);
  const [turn, setTurn] = useState<Turn>(() => pickTurn(settings));
  const [calls, setCalls] = useState(settings.webrtc);
  const save = async () => {
    const n = await app.updateSettings({ ...turn, webrtc: calls });
    app.toast({
      tone: 'success',
      title: 'Connection settings saved',
      duration: 4000,
      description: n ? 'Reconnected ' + n + (n === 1 ? ' workspace.' : ' workspaces.') : undefined,
    });
  };
  return (
    <div data-testid="network-device" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <Muted>These apply to every workspace on this device.{inWs ? ' This workspace’s own relays or signaling are under its Network section.' : ''}</Muted>
      <SubHead>Calls in Nostr relay workspaces</SubHead>
      <CallsSwitch on={calls} onChange={setCalls} />
      <SubHead>Direct connections (peer-to-peer workspaces and calls)</SubHead>
      <TurnFields value={turn} onChange={setTurn} />
      <div>
        <Button variant="primary" data-testid="network-save" onClick={save} disabled={calls === settings.webrtc && sameTurn(turn, pickTurn(settings))}>
          Save connection settings
        </Button>
      </div>
    </div>
  );
}

/** Starts looking for the bridge while a section that needs it is open. */
function useBridge() {
  const status = useApp((s) => s.bridgeStatus);
  const bs = useApp((s) => s.bridgeState);
  useEffect(() => {
    if (useApp.getState().bridgeStatus === 'off') bridge.start();
  }, []);
  return { status, bs };
}

function BridgeSection() {
  const { status, bs } = useBridge();
  return (
    <div data-testid="bridge-section" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <Muted>
        yurt-bridge connects Yurt to agent CLIs on this machine (Copilot CLI, OpenCode, Codex, Claude Code, Pi). Agents are optional; they speak in public, so everyone sees their
        work.
      </Muted>
      {status === 'connected' && bs ? (
        <>
          <BridgeLine version={bs.version} agents={bs.agents.length} />
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Button variant="secondary" iconLeft="external-link" onClick={() => window.open('http://127.0.0.1:7717/', '_blank')}>
              Open bridge setup
            </Button>
            <Button variant="ghost" data-testid="bridge-forget" onClick={() => bridge.forget()}>
              Forget this bridge
            </Button>
          </div>
        </>
      ) : status === 'unpaired' ? (
        <PairForm />
      ) : (
        <InstallSteps />
      )}
    </div>
  );
}

const BridgeLine = ({ version, agents }: { version: string; agents: number }) => (
  <div data-testid="bridge-status" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13, color: 'var(--text-muted)' }}>
    <span style={{ width: 8, height: 8, borderRadius: 9, background: 'var(--volt-400)', boxShadow: '0 0 0 3px rgba(210,255,46,.18)' }} />
    yurt-bridge {version} on this machine · {agents} {agents === 1 ? 'agent' : 'agents'}
  </div>
);

function PairForm() {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr('');
        const ok = await bridge.pair(pin.replace(/\D/g, ''));
        setBusy(false);
        if (!ok) setErr('That code didn’t match. Check the bridge page for the current one.');
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
    >
      <span style={{ fontSize: 14, color: 'var(--text-body)' }}>The bridge is running. Enter the 6-digit code it shows so only this browser can talk to it.</span>
      <Input
        label="Pairing code"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123 456"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        error={err || undefined}
        autoFocus
        data-autofocus
        style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.2em' }}
      />
      <div>
        <Button type="submit" variant="primary" loading={busy} disabled={pin.replace(/\D/g, '').length !== 6}>
          Pair
        </Button>
      </div>
    </form>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li style={{ display: 'flex', gap: 12, fontSize: 14, color: 'var(--text-body)' }}>
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: 999,
          background: 'var(--surface-sunken)',
          border: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          font: '600 12px var(--font-mono)',
          flexShrink: 0,
        }}
      >
        {n}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </li>
  );
}

function InstallSteps() {
  const cmd = 'npx yurt-bridge';
  return (
    <ol data-testid="bridge-install" style={{ display: 'flex', flexDirection: 'column', gap: 14, margin: 0, padding: 0, listStyle: 'none' }}>
      <Step n={1}>
        Open a terminal and run
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 8,
            padding: '8px 8px 8px 14px',
            borderRadius: 12,
            background: 'var(--surface-sunken)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <code style={{ flex: 1, font: '500 14px var(--font-mono)', color: 'var(--text-strong)' }}>{cmd}</code>
          <Button size="sm" variant="secondary" iconLeft="copy" onClick={() => copy(cmd, 'Command')}>
            Copy
          </Button>
        </div>
        <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--text-subtle)' }}>
          Needs Node 20+ or Bun. <code style={{ fontFamily: 'var(--font-mono)' }}>bunx yurt-bridge</code> works too.
        </div>
      </Step>
      <Step n={2}>
        A setup page opens at <span style={{ fontFamily: 'var(--font-mono)' }}>127.0.0.1:7717</span>. It installs agent CLIs and lets you create agents. No config files.
      </Step>
      <Step n={3}>
        <>Come back here and enter the pairing code it shows.</>
      </Step>
      <li style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-subtle)' }}>
        <Icon name="loader" size={14} style={{ animation: 'ag-spin 1s linear infinite' }} />
        Looking for the bridge on this machine…
      </li>
    </ol>
  );
}

/* ---------- Workspace ---------- */

const DangerZone = ({ children }: { children: React.ReactNode }) => (
  <div
    data-testid="danger-zone"
    style={{
      marginTop: 'var(--space-2)',
      paddingTop: 'var(--space-3)',
      borderTop: 'var(--border-width) solid var(--border-subtle)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-2)',
    }}
  >
    {children}
  </div>
);

/** The workspace's invite link, also used by the quick Invite dialog. */
export function InviteBody() {
  const { route, rec, peer } = useCurrent();
  const code = route.code;
  const t = rec?.transport;
  if (!code || !t) return null;
  if (!t.key)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <span data-testid="legacy-invite" style={{ fontSize: 14, color: 'var(--text-body)' }}>
          This workspace was created with a short code that anyone on the network can guess, so it can’t take new members safely. Create a new workspace and invite people there.
        </span>
        <div>
          <Button variant="primary" iconLeft="plus" onClick={() => useApp.getState().setDialog('workspace')}>
            New workspace
          </Button>
        </div>
      </div>
    );
  // A rotation may have landed before the record caught up; the peer always knows the current key.
  const link = location.origin + location.pathname + inviteHash({ code, transport: { ...t, key: peer?.inviteKey ?? t.key }, creator: rec?.creator ?? undefined });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Input aria-label="Invite link" data-testid="invite-link" value={link} readOnly iconLeft="link" onFocus={(e) => e.target.select()} />
        </div>
        <Button variant="primary" iconLeft="copy" onClick={() => copy(link, 'Link')}>
          Copy link
        </Button>
      </div>
      <Muted>
        {t.kind === 'nostr'
          ? 'The link contains the key that decrypts the workspace. Share it privately: anyone with it can read the whole history.'
          : 'The link contains the workspace key. Share it privately: anyone with it can join and sync the history.'}
      </Muted>
    </div>
  );
}

function GeneralSection() {
  const { route, state, rec } = useCurrent();
  const app = useApp.getState();
  const [leaving, setLeaving] = useState(false);
  const code = route.code;
  if (!code || !rec) return null;
  const relayed = rec.transport.kind === 'nostr';
  const name = state?.name || rec.name;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <Fact k="Name" v={name} />
      <Fact k="Workspace id" v={formatCode(code)} />
      <Fact
        k="Network"
        testId="ws-mode"
        v={
          <>
            <ModeChip relayed={relayed} />{' '}
            <span style={{ display: 'block', marginTop: 'var(--space-1)', color: 'var(--text-subtle)' }}>
              Chosen when the workspace was created, and fixed: members on different modes can’t reach each other.
            </span>
          </>
        }
      />
      <SubHead>Invite</SubHead>
      <InviteBody />
      <DangerZone>
        <Muted>
          Leaving makes this device forget the workspace and its history. To come back you need an invite link;{' '}
          {relayed ? 'history then comes back from the relays.' : 'history then syncs back from members who are online.'}
        </Muted>
        {leaving ? (
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button
              variant="danger"
              iconLeft="log-out"
              data-testid="ws-leave-confirm"
              onClick={() => {
                app.setDialog(null);
                app.leaveWorkspace(code);
              }}
            >
              Leave {name}
            </Button>
            <Button variant="ghost" onClick={() => setLeaving(false)}>
              Stay
            </Button>
          </div>
        ) : (
          <div>
            <Button variant="secondary" iconLeft="log-out" data-testid="ws-leave" onClick={() => setLeaving(true)}>
              Leave workspace
            </Button>
          </div>
        )}
      </DangerZone>
    </div>
  );
}

const Fact = ({ k, v, testId }: { k: string; v: React.ReactNode; testId?: string }) => (
  <div style={{ display: 'flex', gap: 'var(--space-3)', fontSize: 'var(--fs-body-sm)' }}>
    <span style={{ width: 110, flexShrink: 0, color: 'var(--text-subtle)' }}>{k}</span>
    <span data-testid={testId} style={{ color: 'var(--text-body)', minWidth: 0 }}>
      {v}
    </span>
  </div>
);

/** What's wrong with typed network settings, per field; every value undefined means they can be saved. */
function networkErrors(nostr: boolean, f: { relays: string; blossom: string; sigUrls: string }): { relays?: string; blossom?: string; signal?: string } {
  if (!nostr) return { signal: listError(rejected(f.sigUrls, parseRelays), 'a ws:// or wss:// server') };
  return {
    relays: listError(rejected(f.relays, parseRelays), 'a ws:// or wss:// relay') ?? (parseRelays(f.relays).length ? undefined : 'Add at least one ws:// or wss:// relay.'),
    blossom: listError(rejected(f.blossom, parseServers), 'an http(s) server'),
  };
}

/** This workspace's own network, for its mode only. Device settings (TURN, calls) are under You → Connection. */
function NetworkSection() {
  const { route, rec, peer } = useCurrent();
  const app = useApp.getState();
  // Relay sockets and peers come and go without an app event, so poll their status while this is open.
  const [, refresh] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, []);
  const t = rec?.transport;
  const sig = t ? signalingOf(t) : { kind: 'nostr' as const, urls: [] };
  const [relays, setRelays] = useState(t?.kind === 'nostr' ? t.relays.join(', ') : '');
  const [blossom, setBlossom] = useState(rec?.blossom?.join(', ') ?? '');
  const [sigKind, setSigKind] = useState<SignalKind>(sig.kind);
  const [sigUrls, setSigUrls] = useState(sig.urls.join(', '));
  const [err, setErr] = useState<{ relays?: string; blossom?: string; signal?: string }>({});
  const [busy, setBusy] = useState(false);
  const code = route.code;
  if (!rec || !t || !code) return null;
  const nostr = t.kind === 'nostr';
  const save = async () => {
    const errs = networkErrors(nostr, { relays, blossom, sigUrls });
    setErr(errs);
    if (Object.values(errs).some(Boolean)) return;
    setBusy(true);
    try {
      await app.updateConnection(
        code,
        nostr ? { kind: 'nostr', relays: parseRelays(relays), blossom: parseServers(blossom) } : { kind: 'trystero', signal: { kind: sigKind, urls: parseRelays(sigUrls) } },
      );
    } catch (e) {
      setErr({ [nostr ? 'relays' : 'signal']: e instanceof Error ? e.message : String(e) });
      return;
    } finally {
      setBusy(false);
    }
    app.toast({ tone: 'success', title: 'Network settings saved', description: 'Reconnected. Invite links now carry this workspace’s ' + (nostr ? 'relays.' : 'signaling.') });
  };
  const toDevice = (
    <Button variant="ghost" size="sm" iconRight="arrow-right" onClick={() => app.openSettings('connection')}>
      Calls and TURN on this device
    </Button>
  );
  const saveButton = (
    <div>
      <Button variant="primary" loading={busy} onClick={save} data-testid="connection-save">
        Save and reconnect
      </Button>
    </div>
  );
  if (!nostr)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <Fact k="Mode" testId="connection-kind" v="Peer-to-peer (WebRTC)" />
        <Fact k="Connected" testId="connection-peers" v={(peer?.peers.size ?? 0) + ((peer?.peers.size ?? 0) === 1 ? ' member right now' : ' members right now')} />
        {!t.key && <Fact k="Invite" testId="connection-legacy" v="Legacy code-only workspace: anyone who guesses its short code can find the room. It can’t take new members." />}
        <SubHead>Signaling</SubHead>
        <SignalFields prefix="ws" kind={sigKind} urls={sigUrls} error={err.signal} onKind={setSigKind} onUrls={setSigUrls} />
        <Muted testId="connection-note">
          Members only find each other over the same method and at least one shared server. New invite links carry these; members who joined earlier keep theirs until they open a
          new link.
        </Muted>
        {saveButton}
        <div>{toDevice}</div>
      </div>
    );
  const status = peer?.relayStatus() ?? new Map<string, boolean>();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <Fact k="Mode" testId="connection-kind" v="Nostr relays" />
      <ul
        data-testid="connection-relay-list"
        aria-label="Relay status"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-1)',
          margin: 0,
          padding: 'var(--space-2) var(--space-3)',
          listStyle: 'none',
          borderRadius: 'var(--radius-md)',
          background: 'var(--surface-sunken)',
          border: 'var(--border-width) solid var(--border-subtle)',
        }}
      >
        {t.relays.map((u) => {
          const on = status.get(u) === true;
          return (
            <li
              key={u}
              data-testid="relay-status"
              data-relay={u}
              data-connected={String(on)}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--fs-body-sm)' }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 'var(--space-2)',
                  height: 'var(--space-2)',
                  borderRadius: 'var(--radius-pill)',
                  background: on ? 'var(--success)' : 'var(--danger)',
                  flexShrink: 0,
                }}
              />
              <code style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', font: 'var(--fs-mono) var(--font-mono)', color: 'var(--text-strong)' }}>{u}</code>
              <span style={{ color: on ? 'var(--success-ink)' : 'var(--danger-ink)' }}>{on ? 'Connected' : 'Disconnected'}</span>
            </li>
          );
        })}
      </ul>
      <Input
        label="Relays"
        placeholder="wss://nos.lol"
        data-testid="connection-relays"
        error={err.relays}
        value={relays}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRelays(e.target.value)}
        hint="ws:// or wss:// URLs, separated by spaces or commas."
      />
      <Input
        label="File servers (Blossom)"
        optional
        placeholder="https://blossom.example.com"
        data-testid="connection-blossom"
        error={err.blossom}
        value={blossom}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBlossom(e.target.value)}
        hint="Where your uploads in this workspace go. Leave empty for the defaults."
      />
      <Muted testId="connection-note">
        Members only reach each other through relays they share, so keep at least one relay in common. New invite links carry this list; members who joined earlier keep their own.
      </Muted>
      {saveButton}
      <div>{toDevice}</div>
    </div>
  );
}

function WsAgentsSection() {
  const { status, bs } = useBridge();
  const { route, state } = useCurrent();
  const app = useApp.getState();
  const code = route.code;
  // What the bridge has saved for this workspace. Unsaved picks reset only when that changes (another workspace,
  // the bridge's list arriving, a save), not on every bridge status update.
  const saved = (bs?.workspaces.find((w) => w.code === code)?.agents ?? []).join(',');
  const [picked, setPicked] = useState<string[]>(() => (saved ? saved.split(',') : []));
  useEffect(() => {
    setPicked(saved ? saved.split(',') : []);
  }, [saved]);
  if (!code) return null;
  if (status !== 'connected' || !bs)
    return (
      <div data-testid="ws-agents-nobridge" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <Muted>Agents run on your machine through yurt-bridge. Set it up once, then pick which agents join this workspace here.</Muted>
        <div>
          <Button variant="agent" iconLeft="sparkles" onClick={() => app.openSettings('agents')}>
            Set up the bridge
          </Button>
        </div>
      </div>
    );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <BridgeLine version={bs.version} agents={bs.agents.length} />
      {bs.agents.length ? (
        <>
          <span style={{ fontSize: 13.5, color: 'var(--text-body)' }}>
            Pick which of your agents join <b>{state?.name}</b>. Each one answers as set up in the bridge.
          </span>
          {bs.agents.map((a) => (
            <div
              key={a.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 12px',
                borderRadius: 14,
                border: '1px solid ' + (picked.includes(a.id) ? 'var(--agent-ink)' : 'var(--border-subtle)'),
                background: picked.includes(a.id) ? 'var(--agent-soft)' : 'var(--surface-card)',
              }}
            >
              {/* Checkbox brings its own <label>; the details get a second one pointing at the same input (labels can't nest). */}
              <Checkbox
                id={'ws-agent-' + a.id}
                checked={picked.includes(a.id)}
                onChange={(e) => setPicked(e.target.checked ? [...picked, a.id] : picked.filter((x) => x !== a.id))}
                aria-label={a.name}
              />
              <label htmlFor={'ws-agent-' + a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, cursor: 'pointer' }}>
                <Avatar name={a.name} kind="agent" presence="online" size={28} decorative />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>
                    {a.name} <span style={{ fontWeight: 400, color: 'var(--text-subtle)' }}>@{a.handle}</span>
                  </span>
                  <span style={{ font: '400 11.5px/1.3 var(--font-mono)', color: 'var(--text-subtle)' }}>
                    {a.runtime}
                    {a.model ? ' · ' + a.model : ''} · {prefsLine(agentPrefs({ replyIn: 'thread', ...a }))}
                  </span>
                </span>
              </label>
            </div>
          ))}
          <div>
            <Button
              variant="agent"
              iconLeft="sparkles"
              onClick={() => {
                app.setAgents(code, picked);
                app.toast({
                  tone: 'agent',
                  title: picked.length
                    ? picked.length + (picked.length === 1 ? ' agent joins ' : ' agents join ') + (state?.name || '')
                    : 'Agents removed from ' + (state?.name || ''),
                });
              }}
            >
              Save
            </Button>
          </div>
        </>
      ) : (
        <Muted>No agents yet. Create one in the bridge’s setup page: pick a runtime, a folder and what it’s allowed to do.</Muted>
      )}
    </div>
  );
}

/* ---------- Shared fields ---------- */

/** TURN is a device setting: it applies to every peer-to-peer workspace and to calls. */
function TurnFields({ value: v, onChange }: { value: Turn; onChange: (t: Turn) => void }) {
  const set = (p: Partial<Turn>) => onChange({ ...pickTurn(v), ...p });
  return (
    <div data-testid="turn-fields" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <Muted>
        Some networks block direct connections. A TURN relay forwards encrypted traffic when that happens, but whoever runs it sees your IP address and who you talk to.
      </Muted>
      <Radio
        name="turn"
        value="off"
        data-testid="turn-off"
        label="Direct only (STUN)"
        description="No relay in the middle. Fails on some strict networks."
        checked={v.turn === 'off'}
        onChange={() => set({ turn: 'off' })}
      />
      <Radio
        name="turn"
        value="default"
        data-testid="turn-default"
        label="Free public TURN relay"
        description="Open Relay by Metered. Its operator sees your IP address and who you connect to (not content). Rate-limited."
        checked={v.turn === 'default'}
        onChange={() => set({ turn: 'default' })}
      />
      <Radio name="turn" value="custom" data-testid="turn-custom" label="My own TURN server" checked={v.turn === 'custom'} onChange={() => set({ turn: 'custom' })} />
      {v.turn === 'custom' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', paddingLeft: 'var(--space-8)' }}>
          <Input
            label="TURN URLs"
            placeholder="turn:turn.example.com:3478"
            data-testid="turn-urls"
            value={v.turnUrls}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ turnUrls: e.target.value })}
          />
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Input label="Username" data-testid="turn-user" value={v.turnUser} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ turnUser: e.target.value })} />
            <Input
              label="Credential"
              type="password"
              data-testid="turn-pass"
              value={v.turnPass}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ turnPass: e.target.value })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** How peer-to-peer members find each other (Trystero signaling). */
export function SignalFields({
  prefix,
  kind,
  urls,
  error,
  onKind,
  onUrls,
}: {
  prefix: string;
  kind: SignalKind;
  urls: string;
  error?: string;
  onKind: (k: SignalKind) => void;
  onUrls: (u: string) => void;
}) {
  return (
    <div data-testid={prefix + '-signal'} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <Radio
        name={prefix + '-signal-kind'}
        value="nostr"
        data-testid={prefix + '-signal-nostr'}
        label="Nostr relays"
        description="Connection offers travel through Nostr relays."
        checked={kind === 'nostr'}
        onChange={() => onKind('nostr')}
      />
      <Radio
        name={prefix + '-signal-kind'}
        value="torrent"
        data-testid={prefix + '-signal-torrent'}
        label="BitTorrent trackers"
        description="Connection offers travel through WebSocket BitTorrent trackers."
        checked={kind === 'torrent'}
        onChange={() => onKind('torrent')}
      />
      <Input
        label={kind === 'nostr' ? 'Signaling relays' : 'Trackers'}
        optional
        data-testid={prefix + '-signal-urls'}
        error={error}
        placeholder={kind === 'nostr' ? 'wss://nos.lol' : 'wss://tracker.openwebtorrent.com'}
        hint={
          kind === 'nostr' ? 'ws:// or wss:// URLs, separated by spaces or commas. Empty means wss://nos.lol.' : 'ws:// or wss:// URLs. Empty means the built-in public trackers.'
        }
        value={urls}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUrls(e.target.value)}
      />
    </div>
  );
}

function CallsSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <Switch
      checked={on}
      onChange={onChange}
      label="Voice and video calls"
      data-testid="webrtc-switch"
      description="Calls are the only thing Nostr relay workspaces send over WebRTC. Off keeps this device on Nostr alone; on lets you join calls, and people in a call see each other’s IP addresses."
    />
  );
}
