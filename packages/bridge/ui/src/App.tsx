import React, { useEffect, useRef, useState } from 'react';
import { Button, IconButton, Icon, Input, Select, Switch, Checkbox, Badge, Avatar, Toast, Kbd } from '@yurt/ui';
import { fingerprint, formatCode, slug, TOOL_KINDS, type BridgeState, type FromBridge, type ToBridge, type AgentConfig, type ToolKind, type RuntimeStatus } from '@yurt/protocol';

declare global { interface Window { __YURT_ADMIN__?: string } }

const WEB_APP = 'https://kucukkanat.github.io/yurt/';
type Log = Extract<FromBridge, { t: 'log' }>;

function useBridge() {
  const [state, setState] = useState<BridgeState | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [up, setUp] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  useEffect(() => {
    let dead = false;
    let t: ReturnType<typeof setTimeout>;
    const open = () => {
      const s = new WebSocket(`ws://${location.host}/ws`);
      ws.current = s;
      s.onopen = () => { setUp(true); s.send(JSON.stringify({ t: 'hello', token: window.__YURT_ADMIN__ })); };
      s.onmessage = (e) => {
        const m = JSON.parse(e.data) as FromBridge;
        if (m.t === 'state') setState(m.state);
        else if (m.t === 'log') setLogs((l) => [...l.slice(-399), m]);
        else if (m.t === 'error') setError(m.msg);
      };
      s.onclose = () => { setUp(false); if (!dead) t = setTimeout(open, 1500); };
    };
    open();
    return () => { dead = true; clearTimeout(t); ws.current?.close(); };
  }, []);
  const send = (m: ToBridge) => ws.current?.readyState === 1 && ws.current.send(JSON.stringify(m));
  return { state, logs, error, clearError: () => setError(null), up, send };
}

const TOOL_HELP: Record<ToolKind, string> = {
  read: 'Read files', search: 'Search files and code', think: 'Plan and reason', fetch: 'Fetch web pages',
  edit: 'Change files', move: 'Move or rename files', delete: 'Delete files', execute: 'Run commands', other: 'Anything else',
};
const SAFE: ToolKind[] = ['read', 'search', 'think', 'fetch'];

type Section = 'overview' | 'agents' | 'runtimes' | 'workspaces' | 'activity' | 'settings';

export function App() {
  const b = useBridge();
  const [sec, setSec] = useState<Section>('overview');
  const s = b.state;
  const nav: { id: Section; label: string; icon: any; count?: number }[] = [
    { id: 'overview', label: 'Overview', icon: 'gauge' },
    { id: 'agents', label: 'Agents', icon: 'sparkles', count: s?.agents.length },
    { id: 'runtimes', label: 'Agent CLIs', icon: 'terminal', count: s?.runtimes.filter((r) => r.installed).length },
    { id: 'workspaces', label: 'Workspaces', icon: 'layers', count: s?.workspaces.length },
    { id: 'activity', label: 'Activity', icon: 'history' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];
  return (
    <div style={{ display: 'flex', height: '100%', flexWrap: 'wrap' }}>
      <aside style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 10px', background: 'var(--surface-sunken)', borderRight: '1px solid var(--border-subtle)', boxSizing: 'border-box', minHeight: '100%' }}>
        <div style={{ padding: '0 10px', display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ font: '700 22px/1 var(--font-display)', letterSpacing: '-0.05em', color: 'var(--text-strong)' }}>yurt</span>
          <span style={{ fontSize: 13, color: 'var(--text-subtle)' }}>bridge {s?.version}</span>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {nav.map((n) => (
            <button key={n.id} type="button" onClick={() => setSec(n.id)} aria-current={sec === n.id ? 'page' : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 10, height: 34, padding: '0 10px', border: 0, borderRadius: 8, cursor: 'pointer', font: '500 14px var(--font-body)', textAlign: 'left', background: sec === n.id ? 'var(--surface-press)' : 'transparent', color: sec === n.id ? 'var(--text-strong)' : 'var(--text-muted)' }}>
              <Icon name={n.icon} size={16} /><span style={{ flex: 1 }}>{n.label}</span>
              {n.count != null && <span style={{ font: '400 11px var(--font-mono)', color: 'var(--text-subtle)' }}>{n.count}</span>}
            </button>
          ))}
        </nav>
        <span style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', fontSize: 12.5, color: 'var(--text-subtle)' }}>
          <span style={{ width: 8, height: 8, borderRadius: 9, background: b.up ? 'var(--volt-400)' : 'var(--ink-500)' }} />{b.up ? 'Running on 127.0.0.1' : 'Reconnecting…'}
        </div>
      </aside>
      <main style={{ flex: 1, minWidth: 320, height: '100%', overflow: 'auto' }}>
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '40px 28px 64px', display: 'flex', flexDirection: 'column', gap: 24 }}>
          {!s ? <div style={{ color: 'var(--text-muted)' }}>Connecting to the bridge…</div> : <>
            {sec === 'overview' && <Overview s={s} send={b.send} go={setSec} />}
            {sec === 'agents' && <Agents s={s} send={b.send} error={b.error} clearError={b.clearError} />}
            {sec === 'runtimes' && <Runtimes s={s} send={b.send} />}
            {sec === 'workspaces' && <WorkspacesView s={s} send={b.send} />}
            {sec === 'activity' && <Activity logs={b.logs} />}
            {sec === 'settings' && <Settings s={s} send={b.send} />}
          </>}
        </div>
      </main>
      {b.error && <div style={{ position: 'fixed', left: 0, right: 0, bottom: 20, display: 'flex', justifyContent: 'center' }}><Toast tone="danger" title={b.error} duration={5000} onClose={b.clearError} /></div>}
    </div>
  );
}

type P = { s: BridgeState; send: (m: ToBridge) => void };

const H1 = ({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    <h1 style={{ margin: 0, font: '700 36px/1.05 var(--font-display)', letterSpacing: '-0.045em', color: 'var(--text-strong)' }}>{children}</h1>
    {sub && <p style={{ margin: 0, fontSize: 15, color: 'var(--text-muted)', maxWidth: 620 }}>{sub}</p>}
  </div>
);

const CardBox = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{ padding: 20, borderRadius: 20, background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-sm)', ...style }}>{children}</div>
);

function Overview({ s, send, go }: P & { go: (x: Section) => void }) {
  const code = s.pairingCode || '------';
  const installed = s.runtimes.filter((r) => r.installed).length;
  return (
    <>
      <H1 sub="The bridge runs your agent CLIs locally and brings them into Yurt workspaces. Nothing here leaves this machine except the messages your agents post.">Your agents, your machine.</H1>
      <CardBox style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 20 }}>
        <div style={{ flex: 1, minWidth: 240, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-subtle)' }}>Pairing code</span>
          <span style={{ font: '500 44px/1 var(--font-mono)', letterSpacing: '.08em', color: 'var(--text-strong)' }}>{code.slice(0, 3)} {code.slice(3)}</span>
          <span style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>In Yurt, open <b>Settings → Agents &amp; bridge</b> and type this. It changes after each use.</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="primary" iconLeft="external-link" onClick={() => window.open(WEB_APP, '_blank')}>Open Yurt</Button>
          <Button variant="ghost" iconLeft="refresh-cw" onClick={() => send({ t: 'pair.rotate' })}>New code</Button>
        </div>
      </CardBox>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <CardBox>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {s.identity ? <Avatar name={s.identity.name} self size={36} decorative /> : <Icon name="key-round" size={22} style={{ color: 'var(--text-subtle)' }} />}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: 'var(--text-strong)' }}>{s.identity ? s.identity.name : 'Not linked yet'}</div>
              <div style={{ font: '400 12px var(--font-mono)', color: 'var(--text-subtle)' }}>{s.identity ? '@' + s.identity.handle + ' · ' + fingerprint(s.identity.pub) : 'Pair from Yurt to link your identity'}</div>
            </div>
          </div>
        </CardBox>
        <Stat icon="terminal" n={installed} of={s.runtimes.length} label="agent CLIs installed" onClick={() => go('runtimes')} />
        <Stat icon="sparkles" n={s.agents.length} label={s.agents.length === 1 ? 'agent' : 'agents'} onClick={() => go('agents')} />
      </div>
      {!s.agents.length && (
        <CardBox style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 220, fontSize: 14.5, color: 'var(--text-body)' }}>{installed ? 'Create your first agent: pick a CLI, a folder it works in, and what it may do without asking.' : 'Install an agent CLI first. One click, no terminal.'}</span>
          <Button variant="agent" iconLeft="sparkles" onClick={() => go(installed ? 'agents' : 'runtimes')}>{installed ? 'New agent' : 'Install a CLI'}</Button>
        </CardBox>
      )}
    </>
  );
}

function Stat({ icon, n, of, label, onClick }: { icon: any; n: number; of?: number; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 20, borderRadius: 20, background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-sm)', cursor: 'pointer', textAlign: 'left', color: 'inherit' }}>
      <Icon name={icon} size={22} style={{ color: 'var(--text-subtle)' }} />
      <span style={{ font: '700 28px/1 var(--font-display)', color: 'var(--text-strong)' }}>{n}{of != null && <span style={{ fontSize: 16, color: 'var(--text-subtle)' }}>/{of}</span>}</span>
      <span style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>{label}</span>
    </button>
  );
}

function authBadge(r: RuntimeStatus) {
  if (r.busy) return <Badge tone="neutral" size="sm" live>{r.busy === 'installing' ? 'Installing' : r.busy === 'checking' ? 'Checking' : 'Signing in'}</Badge>;
  if (!r.installed) return <Badge tone="neutral" size="sm" variant="outline">Not installed</Badge>;
  if (r.auth === 'signed-in') return <Badge tone="success" size="sm" dot>Ready</Badge>;
  if (r.auth === 'signed-out') return <Badge tone="human" size="sm" icon="hand">Sign in needed</Badge>;
  return <Badge tone="warning" size="sm">Unchecked</Badge>;
}

function Runtimes({ s, send }: P) {
  return (
    <>
      <H1 sub="Yurt talks to these over the Agent Client Protocol. Install the ones you use; your agents pick one each.">Agent CLIs</H1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {s.runtimes.map((r) => (
          <CardBox key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: 16 }}>
            <Icon name="terminal" size={20} style={{ color: 'var(--text-subtle)' }} />
            <div style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-strong)' }}>{r.name}</span>
              <span style={{ font: '400 12px var(--font-mono)', color: 'var(--text-subtle)' }}>{r.installed ? (r.version ? 'v' + r.version : 'installed') : 'not found on PATH'}</span>
            </div>
            {authBadge(r)}
            <div style={{ display: 'flex', gap: 6 }}>
              {!r.installed && <Button size="sm" variant="primary" iconLeft="download" loading={r.busy === 'installing'} onClick={() => send({ t: 'runtime.install', id: r.id })}>Install</Button>}
              {r.installed && r.auth !== 'signed-in' && <Button size="sm" variant="primary" iconLeft="log-in" loading={r.busy === 'signing-in'} onClick={() => send({ t: 'runtime.login', id: r.id })}>Sign in</Button>}
              {r.installed && <IconButton icon="refresh-cw" label="Check again" size="sm" onClick={() => send({ t: 'runtime.check', id: r.id })} />}
            </div>
          </CardBox>
        ))}
      </div>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-subtle)' }}>Sign in opens the CLI’s own login, in your browser or a terminal window. Installs use npm (or Bun) globally; watch progress under Activity.</p>
    </>
  );
}

const blank = (s: BridgeState): AgentConfig => {
  const rt = s.runtimes.find((r) => r.installed)?.id || 'copilot';
  return { id: '', name: '', handle: '', runtime: rt, model: '', workdir: (s.home || '~') + '/yurt-agents/', instructions: '', autoApprove: [...SAFE], contextSize: 20,
    respondTo: { mentions: true, replies: false }, postIn: { thread: true, channel: false }, discoverable: false };
};

type SaveAck = { error: string | null; clearError: () => void };

function Agents({ s, send, error, clearError }: P & SaveAck) {
  const [edit, setEdit] = useState<AgentConfig | null>(null);
  if (edit) return <AgentEditor s={s} send={send} error={error} clearError={clearError} agent={edit} onDone={() => setEdit(null)} />;
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}><H1 sub="Each agent is a CLI, a folder, instructions and a permission list. Add them to workspaces from Yurt.">Agents</H1></div>
        <Button variant="agent" iconLeft="plus" onClick={() => setEdit(blank(s))}>New agent</Button>
      </div>
      {!s.agents.length && <CardBox><span style={{ fontSize: 14.5, color: 'var(--text-muted)' }}>No agents yet.</span></CardBox>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {s.agents.map((a) => {
          const rooms = s.workspaces.filter((w) => w.agents.includes(a.id));
          return (
            <button key={a.id} type="button" onClick={() => setEdit(a)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 16, borderRadius: 20, background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-sm)', cursor: 'pointer', textAlign: 'left', color: 'inherit', flexWrap: 'wrap' }}>
              <Avatar name={a.name} kind="agent" presence="online" working={a.status === 'working'} size={36} decorative />
              <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-strong)' }}>{a.name} <span style={{ fontWeight: 400, color: 'var(--text-subtle)' }}>@{a.handle}</span></span>
                <span style={{ font: '400 12px var(--font-mono)', color: 'var(--text-subtle)', overflowWrap: 'anywhere' }}>{s.runtimes.find((r) => r.id === a.runtime)?.name}{a.model ? ' · ' + a.model : ''} · {a.workdir}</span>
              </div>
              {a.status === 'working' && <Badge tone="agent" size="sm" live>Working</Badge>}
              {a.status === 'waiting' && <Badge tone="human" size="sm" icon="hand">Needs you</Badge>}
              {a.status === 'error' && <Badge tone="danger" size="sm">Error</Badge>}
              <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>{rooms.length ? rooms.length + (rooms.length === 1 ? ' workspace' : ' workspaces') : 'Not in a workspace'}</span>
              <Icon name="chevron-right" size={16} style={{ color: 'var(--text-subtle)' }} />
            </button>
          );
        })}
      </div>
    </>
  );
}

/** True once the bridge's state holds `a` as `agent.save` normalizes it (server.ts sanitize); a new agent must be new. */
const isSaved = (a: AgentConfig, x: AgentConfig, before: readonly string[]) =>
  (a.id ? x.id === a.id : !before.includes(x.id)) && x.handle === slug(a.handle || a.name).slice(0, 24) && x.name === a.name.trim().slice(0, 40) && x.runtime === a.runtime
  && x.instructions === a.instructions.slice(0, 8000) && JSON.stringify([x.respondTo, x.postIn, x.discoverable]) === JSON.stringify([a.respondTo, a.postIn, a.discoverable]) && [...x.autoApprove].sort().join() === [...a.autoApprove].sort().join();

function AgentEditor({ s, send, error, clearError, agent, onDone }: P & SaveAck & { agent: AgentConfig; onDone: () => void }) {
  const [a, setA] = useState<AgentConfig>(agent);
  // The bridge has no save ack: success shows up as a state holding the saved agent, failure as an error.
  // So the editor stays open until one of those arrives, and keeps the user's input on failure.
  const [saving, setSaving] = useState<{ before: string[] } | null>(null);
  useEffect(() => {
    if (!saving) return;
    if (error) setSaving(null);
    else if (s.agents.some((x) => isSaved(a, x, saving.before))) onDone();
  }, [s, error]);
  const [handleTouched, setHandleTouched] = useState(!!agent.id);
  const [confirmDel, setConfirmDel] = useState(false);
  const up = (p: Partial<AgentConfig>) => setA((x) => ({ ...x, ...p }));
  const isNew = !agent.id;
  const noPlacement = !a.postIn.thread && !a.postIn.channel;
  const autoHandle = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  const setName = (name: string) => up({ name, ...(handleTouched ? {} : { handle: autoHandle(name) }), ...(isNew && a.workdir.endsWith('/yurt-agents/' + a.handle) || a.workdir.endsWith('/yurt-agents/') ? { workdir: (s.home || '~') + '/yurt-agents/' + autoHandle(name) } : {}) });
  const rt = s.runtimes.find((r) => r.id === a.runtime);
  return (
    <form data-testid="agent-editor" onSubmit={(e) => { e.preventDefault(); clearError(); setSaving({ before: s.agents.map((x) => x.id) }); send({ t: 'agent.save', agent: a }); }} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <IconButton icon="arrow-left" label="Back to agents" onClick={onDone} />
        <H1>{isNew ? 'New agent' : a.name}</H1>
      </div>
      <CardBox style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <Input label="Name" placeholder="Scout" value={a.name} onChange={(e) => setName(e.target.value)} autoFocus />
          <Input label="Handle" iconLeft="at-sign" value={a.handle} onChange={(e) => { setHandleTouched(true); up({ handle: autoHandle(e.target.value) }); }} hint="People @mention this in rooms." />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <Select label="Agent CLI" value={a.runtime} onChange={(e) => up({ runtime: e.target.value as any })}
            options={s.runtimes.map((r) => ({ value: r.id, label: r.name + (r.installed ? '' : ' (not installed)') }))}
            hint={rt && !rt.installed ? 'Install it under Agent CLIs first.' : rt?.auth === 'signed-out' ? 'Needs sign-in under Agent CLIs.' : undefined} />
          <Input label="Model" optional placeholder="CLI default" value={a.model || ''} onChange={(e) => up({ model: e.target.value })} />
        </div>
        <Input label="Working folder" iconLeft="folder" value={a.workdir} onChange={(e) => up({ workdir: e.target.value })} hint="Full path. Created if missing. The agent reads and writes here." style={{ fontFamily: 'var(--font-mono)' }} />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>Instructions</span>
          <textarea value={a.instructions} onChange={(e) => up({ instructions: e.target.value })} rows={5} placeholder="You research competitors and answer with sources. Keep replies under 120 words."
            style={{ resize: 'vertical', padding: '10px 14px', borderRadius: 12, border: '1.5px solid var(--border-default)', background: 'var(--surface-card)', color: 'var(--text-body)', font: '400 14px/1.55 var(--font-body)', outline: 'none' }} />
        </label>
      </CardBox>
      <CardBox style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-strong)' }}>In rooms</span>
        <div role="group" aria-label="Answers when" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-body)' }}>Answers when</span>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <Checkbox label="Someone @mentions it" data-testid="respond-mentions" checked={a.respondTo.mentions} onChange={(e) => up({ respondTo: { ...a.respondTo, mentions: e.target.checked } })} />
            <Checkbox label="Someone replies in a thread it's part of" description="No @ needed for follow-ups" data-testid="respond-replies" checked={a.respondTo.replies} onChange={(e) => up({ respondTo: { ...a.respondTo, replies: e.target.checked } })} />
          </div>
        </div>
        <div role="group" aria-label="Posts" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-body)' }}>Posts its answer</span>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <Checkbox label="In a thread" data-testid="post-thread" checked={a.postIn.thread} onChange={(e) => up({ postIn: { ...a.postIn, thread: e.target.checked } })} />
            <Checkbox label="In the channel" data-testid="post-channel" checked={a.postIn.channel} onChange={(e) => up({ postIn: { ...a.postIn, channel: e.target.checked } })} />
          </div>
          <span style={{ fontSize: 12.5, color: noPlacement ? 'var(--danger-ink)' : 'var(--text-subtle)' }}>
            {noPlacement ? 'Pick at least one.' : a.postIn.thread && a.postIn.channel ? 'Answers in the thread and also shows the answer in the channel.' : a.postIn.thread ? 'Answers in a thread under the message.' : 'Answers in the channel (or inside a thread when asked there).'}
          </span>
        </div>
        <Switch label="Discoverable" data-testid="agent-discoverable" checked={a.discoverable} onChange={(on) => up({ discoverable: on })}
          description="Others in the workspace can find this agent and message it directly. You can read those conversations, and they're told so. Off: they can only @mention it in channels and reply to its messages." />
        <Input label="Context" type="number" min={1} max={200} value={String(a.contextSize)} onChange={(e) => up({ contextSize: Number(e.target.value) })} suffix={<span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>recent messages</span>} hint="How many recent messages from the channel or thread the agent sees when mentioned." />
      </CardBox>
      <CardBox style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-strong)' }}>Allowed without asking</span>
          <span style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>Anything unchecked pauses the agent and asks you in your private chat with it, with a notification.</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          {TOOL_KINDS.map((k) => (
            <Checkbox key={k} label={TOOL_HELP[k]} description={k} checked={a.autoApprove.includes(k)} onChange={(e) => up({ autoApprove: e.target.checked ? [...a.autoApprove, k] : a.autoApprove.filter((x) => x !== k) })} />
          ))}
        </div>
      </CardBox>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button type="submit" variant="agent" iconLeft="check" data-testid="agent-save" loading={!!saving} disabled={!a.name.trim() || !a.handle || !a.workdir.trim() || noPlacement}>{isNew ? 'Create agent' : 'Save changes'}</Button>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <span style={{ flex: 1 }} />
        {!isNew && (confirmDel
          ? <Button variant="danger" iconLeft="trash-2" onClick={() => { send({ t: 'agent.remove', id: a.id }); onDone(); }}>Delete {a.name} everywhere</Button>
          : <Button variant="ghost" iconLeft="trash-2" onClick={() => setConfirmDel(true)}>Delete</Button>)}
      </div>
    </form>
  );
}

function WorkspacesView({ s, send }: P) {
  return (
    <>
      <H1 sub="The bridge stays in these workspaces so your agents answer even with the Yurt tab closed. Add workspaces from Yurt → Settings → (workspace) → Agents.">Workspaces</H1>
      {!s.workspaces.length && <CardBox><span style={{ fontSize: 14.5, color: 'var(--text-muted)' }}>None yet.</span></CardBox>}
      {s.workspaces.map((w) => (
        <CardBox key={w.code} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ flex: 1, font: '700 18px/1.2 var(--font-display)', letterSpacing: '-0.03em', color: 'var(--text-strong)' }}>{w.name}</span>
            <span style={{ font: '400 12px var(--font-mono)', color: 'var(--text-subtle)' }}>{formatCode(w.code)} · {w.peers || 0} peers</span>
            <Button size="sm" variant="ghost" iconLeft="log-out" onClick={() => send({ t: 'ws.leave', code: w.code })}>Leave</Button>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {s.agents.map((a) => (
              <Checkbox key={a.id} label={a.name} checked={w.agents.includes(a.id)} onChange={(e) => send({ t: 'ws.agents', code: w.code, agents: e.target.checked ? [...w.agents, a.id] : w.agents.filter((x) => x !== a.id) })} />
            ))}
          </div>
        </CardBox>
      ))}
    </>
  );
}

function Activity({ logs }: { logs: Log[] }) {
  const [acp, setAcp] = useState(false);
  const list = logs.filter((l) => acp || l.level !== 'acp').slice().reverse();
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}><H1 sub="What the bridge and your agents did, newest first.">Activity</H1></div>
        <Switch checked={acp} onChange={setAcp} label="Show ACP traffic" size="sm" />
      </div>
      <div style={{ borderRadius: 20, background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', padding: 12, font: '400 12px/1.6 var(--font-mono)', maxHeight: '65vh', overflow: 'auto' }}>
        {!list.length && <div style={{ color: 'var(--text-subtle)' }}>Quiet so far.</div>}
        {list.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, color: l.level === 'error' ? 'var(--danger-ink)' : l.level === 'warn' ? 'var(--warning-ink, var(--text-body))' : l.level === 'acp' ? 'var(--text-subtle)' : 'var(--text-body)' }}>
            <span style={{ color: 'var(--text-subtle)', flexShrink: 0 }}>{new Date(l.at).toLocaleTimeString()}</span>
            <span style={{ color: 'var(--text-muted)', flexShrink: 0, minWidth: 70 }}>{l.src}</span>
            <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{l.msg}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function Settings({ s, send }: P) {
  const [origins, setOrigins] = useState(s.allowedOrigins.join('\n'));
  return (
    <>
      <H1>Settings</H1>
      <CardBox style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Switch checked={s.startOnLogin} onChange={(on) => send({ t: 'startOnLogin', on })} label="Start when I log in" description="Agents stay reachable after a restart. Runs in the background without opening this page." />
      </CardBox>
      <CardBox style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-strong)' }}>Web apps allowed to connect</span>
        <span style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>One origin per line. Add yours if you host Yurt somewhere else. Each browser still needs the pairing code.</span>
        <textarea value={origins} onChange={(e) => setOrigins(e.target.value)} rows={4} spellCheck={false}
          style={{ resize: 'vertical', padding: '10px 14px', borderRadius: 12, border: '1.5px solid var(--border-default)', background: 'var(--surface-card)', color: 'var(--text-body)', font: '400 13px/1.6 var(--font-mono)', outline: 'none' }} />
        <div><Button variant="primary" onClick={() => send({ t: 'origins', list: origins.split('\n') })}>Save origins</Button></div>
      </CardBox>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-subtle)' }}>Stop the bridge with <Kbd keys="ctrl+c" size="sm" /> in its terminal. Everything it knows lives in ~/.yurt.</p>
    </>
  );
}

