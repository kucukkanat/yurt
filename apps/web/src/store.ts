import { create } from 'zustand';
import {
  keyFromPhrase, newInviteCode, normalizeCode, formatCode, slug, mentions, sha256Buf, MAX_FILE_BYTES,
  parseInvite, parseRelays, DEFAULT_RELAYS, DEFAULT_SIGNAL_URLS, newNostrTransport, newTrysteroTransport, LEGACY_TRYSTERO, uploadFile, parseServers, DEFAULT_BLOSSOM,
  type KeyPair, type WsTransport, type Signaling, type WorkspacePeer, type WsState, type Ev, type FileRef, type EventFields, type BridgeState,
} from '@yurt/protocol';
import { kv, eventsDb, blobsDb } from './lib/db';
import { connect, getPeer, allPeers, disconnect, type NetSettings } from './lib/net';
import { bridge, type BridgeStatus } from './lib/bridge';
import { huddle, type HuddleView } from './lib/huddle';
import { notify } from './lib/format';

interface Identity extends KeyPair { phrase: string; name: string; handle: string }
/** What a new workspace starts with: shared by its members, so it travels in the invite link (except file servers). */
export type NewWorkspaceNet =
  | { kind: 'trystero'; signal: Signaling }
  | { kind: 'nostr'; relays: string[]; blossom: string[] };

/** The create step's starting point: Settings → Network defaults, emptied fields falling back to the built-ins. */
export function defaultNewNet(s: Settings, kind: WsTransport['kind']): NewWorkspaceNet {
  if (kind === 'nostr') {
    const relays = parseRelays(s.relays);
    return { kind, relays: relays.length ? relays : [...DEFAULT_RELAYS], blossom: parseServers(s.blossom) };
  }
  const urls = parseRelays(s.signalUrls);
  // Nostr signaling with no servers means nos.lol; trackers with none means the built-in public ones.
  return { kind, signal: { kind: s.signalKind, urls: urls.length || s.signalKind !== 'nostr' ? urls : [...DEFAULT_SIGNAL_URLS] } };
}

export type ConnectionChange =
  | { kind: 'nostr'; relays: string[]; blossom: string[] }
  | { kind: 'trystero'; signal: Signaling };
export interface WsRecord {
  code: string; name: string; transport: WsTransport; creator: string | null; lastRead: Record<string, number>; muted: string[];
  /** Blossom servers for this workspace's uploads; falls back to Settings, then the defaults. */
  blossom?: string[];
}
export interface Settings extends NetSettings { theme: 'dark' | 'light'; notifications: boolean }
interface Route { code?: string; ch?: string; thread?: string }
type PanelType = 'members' | 'profile' | 'thread' | 'pinned' | 'search' | null;
interface Panel { type: PanelType; id?: string }
type DialogType = null | 'workspace' | 'channel' | 'invite' | 'agent' | 'bridge' | 'settings' | 'channelSettings' | 'jump' | 'connection';
/** `onDismiss` runs once however the toast goes away: expired, closed, acted on, or pushed out by newer toasts. */
interface ToastT { id: number; tone?: 'neutral' | 'success' | 'agent' | 'human' | 'danger'; title: string; description?: string; actionLabel?: string; onAction?: () => void; onDismiss?: () => void; duration?: number }

// No TURN by default: a third-party relay would see who connects to whom. Opt in under Settings → Network.
const DEFAULT_SETTINGS: Settings = { theme: 'dark', notifications: false, turn: 'off', turnUrls: '', turnUser: '', turnPass: '', relays: DEFAULT_RELAYS.join(', '), webrtc: false, blossom: '', signalKind: 'nostr', signalUrls: DEFAULT_SIGNAL_URLS.join(', ') };

function parseHash(h = location.hash): Route {
  const p = h.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const r: Route = {};
  for (let i = 0; i < p.length; i += 2) {
    if (p[i] === 'w') r.code = normalizeCode(p[i + 1] || '') || undefined;
    if (p[i] === 'c') r.ch = p[i + 1];
    if (p[i] === 't') r.thread = p[i + 1];
  }
  return r;
}
function buildHash(r: Route): string {
  let h = '#/';
  if (r.code) h += 'w/' + r.code;
  if (r.code && r.ch) h += '/c/' + encodeURIComponent(r.ch);
  if (r.code && r.ch && r.thread) h += '/t/' + r.thread;
  return h;
}

export interface AppState {
  ready: boolean;
  identity: Identity | null;
  workspaces: WsRecord[];
  settings: Settings;
  route: Route;
  states: Record<string, WsState>;
  tick: number;
  /** Bumped per blob id when its bytes land, so only that attachment reloads. */
  blobVer: Record<string, number>;
  blobProgress: Record<string, number>;
  panel: Panel;
  dialog: DialogType;
  toasts: ToastT[];
  bridgeStatus: BridgeStatus;
  bridgeState: BridgeState | null;
  huddle: HuddleView;
  online: boolean;
  drawer: boolean;
  editing: string | null;
  /** Ticks every 30 s so time-based UI (like the edit window) stays current. */
  clock: number;
  highlight: string | null;

  init(): Promise<void>;
  createIdentity(phrase: string, name: string, handle: string): Promise<void>;
  updateProfile(name: string, handle: string): Promise<void>;
  /** Saves and applies at once; returns how many workspaces were reconnected to pick up the change. */
  updateSettings(p: Partial<Settings>): Promise<number>;
  resetDevice(): Promise<void>;
  go(r: Route): void;
  setPanel(p: Panel): void;
  setDialog(d: DialogType): void;
  toast(t: Omit<ToastT, 'id'>): void;
  dismiss(id: number): void;
  /** A new workspace with its own network settings (the create step starts from `defaultNewNet`). */
  createWorkspace(name: string, net: NewWorkspaceNet): Promise<string>;
  joinWorkspace(input: string): Promise<boolean>;
  leaveWorkspace(code: string): Promise<void>;
  markRead(code: string, ch: string): void;
  toggleMute(code: string, ch: string): void;
  publish<B>(code: string, f: Omit<EventFields<B>, 'ws'>): Ev<B> | undefined;
  /** False when nothing was sent (e.g. an upload failed), so the composer keeps the draft. */
  send(text: string, files: File[], parent?: string): Promise<boolean>;
  createChannel(name: string, topic: string): string | undefined;
  setTyping(ch: string | null): void;
  approve(req: string, option: string): void;
  /** Resolves false when the attachment couldn't be fetched. */
  fetchBlob(code: string, id: string): Promise<boolean>;
  setAgents(code: string, agentIds: string[]): void;
  /** A workspace's own network settings: relays and file servers, or signaling. Saves and reconnects it. */
  updateConnection(code: string, change: ConnectionChange): Promise<void>;
}

let typingTimer: ReturnType<typeof setTimeout> | null = null;
let readTimer: ReturnType<typeof setTimeout> | null = null;
let toastId = 0;

function privateTarget(ch: string, me: string): string | undefined {
  if (ch.startsWith('dm:')) return ch.slice(3).split(':').find((k) => k !== me) || me;
  if (ch.startsWith('adm:')) return me;
  return undefined;
}

export const useApp = create<AppState>((set, get) => {
  const saveWs = (ws: WsRecord[]) => { set({ workspaces: ws }); kv.set('workspaces', ws); };
  const patchWs = (code: string, p: Partial<WsRecord>) => saveWs(get().workspaces.map((w) => (w.code === code ? { ...w, ...p } : w)));
  const profilePublished = new Set<string>();

  const onFresh = (code: string, s: WsState, fresh: Ev[]) => {
    const { identity, route, settings, workspaces } = get();
    if (!identity || !fresh.length) return;
    const rec = workspaces.find((w) => w.code === code);
    for (const e of fresh) {
      if (e.t !== 'msg' || !e.ch || (e.a === identity.pub && !e.ag) || Date.now() - e.ts > 60_000) continue;
      if (rec?.muted.includes(e.ch)) continue;
      const text = String(e.b?.text || '');
      const forMe = mentions(text).includes(identity.handle.toLowerCase()) || e.ch.startsWith('dm:') || e.ch.startsWith('adm:');
      if (!forMe) continue;
      const here = !document.hidden && route.code === code && route.ch === e.ch;
      if (here || !settings.notifications) continue;
      const author = e.ag ? s.agents.get(e.a + '/' + e.ag)?.name || 'Agent' : s.profiles.get(e.a)?.name || 'Someone';
      const where = e.ch.startsWith('dm:') || e.ch.startsWith('adm:') ? author : author + ' in #' + (s.channels.get(e.ch)?.name || '');
      notify(e.b?.approval ? author + ' needs you' : where, e.b?.approval ? e.b.approval.title : text.slice(0, 140), () => get().go({ code, ch: e.ch }));
    }
  };

  const connectWs = (rec: WsRecord) => {
    const { identity, settings } = get();
    if (!identity) return;
    // A replaced (reconnected) or left peer may still finish loading; its late state must not land.
    const live = () => getPeer(rec.code) === peer;
    const peer: WorkspacePeer = connect(rec.code, identity, rec.creator, rec.transport, settings, {
      onState: (code, s, fresh) => {
        if (!live()) return;
        set((st) => ({ states: { ...st.states, [code]: s } }));
        const r = get().workspaces.find((w) => w.code === code);
        if (r && s.name && r.name !== s.name) patchWs(code, { name: s.name });
        const me = get().identity;
        if (me && !profilePublished.has(code)) {
          const p = s.profiles.get(me.pub);
          if (!p || p.name !== me.name || p.handle !== me.handle) peer.publish({ t: 'profile', b: { name: me.name, handle: me.handle } });
          profilePublished.add(code);
        }
        onFresh(code, s, fresh);
      },
      onPeers: () => set((st) => ({ tick: st.tick + 1 })),
      onCreator: (code, pub) => patchWs(code, { creator: pub }),
      // After a rotation, remember the newest key: invite links use it, and it opens all earlier ones.
      onKey: (code, key) => { const w = get().workspaces.find((x) => x.code === code); if (w?.transport.kind === 'nostr') patchWs(code, { transport: { ...w.transport, key } }); },
      onBlob: (id) => set((st) => ({ blobVer: { ...st.blobVer, [id]: (st.blobVer[id] ?? 0) + 1 } })),
      onBlobProgress: (id, p) => set((st) => ({ blobProgress: { ...st.blobProgress, [id]: p } })),
    });
    peer.setPresence({ st: document.hidden ? 'away' : 'online' });
  };
  // Forget "profile published" with the connection, so a rejoin publishes the profile again.
  const disconnectWs = (code: string) => { disconnect(code); profilePublished.delete(code); };
  const reconnect = async (codes: string[]) => {
    if (codes.includes(get().huddle.code ?? '')) await huddle.leave();
    for (const code of codes) {
      const rec = get().workspaces.find((w) => w.code === code);
      if (rec) { disconnectWs(code); connectWs(rec); }
    }
    set((st) => ({ tick: st.tick + 1 }));
  };
  const startBridge = (id: Identity) => bridge.autoStart({ phrase: id.phrase, name: id.name, handle: id.handle });

  const applyTheme = (t: Settings['theme']) => { document.documentElement.dataset.theme = t; };

  // An invite link carries the workspace key in its hash. Hold it in memory only and take it out of
  // the address bar and history at once, so it never lands in synced browser history.
  // It survives only until it's used or the route moves to another workspace: a later route never reuses it.
  let pendingInvite: { code: string | undefined; hash: string } | null = null;
  // The first route of a page load came from outside (a pasted or clicked link); later ones are in-app navigation.
  let entry = true;
  const onRoute = async () => {
    const r = parseHash();
    if (location.hash.includes('/k/')) { pendingInvite = { code: r.code, hash: location.hash }; history.replaceState(null, '', buildHash(r)); }
    if (pendingInvite && pendingInvite.code !== r.code) pendingInvite = null;
    set({ route: r, drawer: false, highlight: null, panel: r.thread ? { type: 'thread', id: r.thread } : get().panel.type === 'thread' ? { type: null } : get().panel });
    if (!get().identity) return; // onboarding: keep the invite for createIdentity
    const invite = pendingInvite;
    const fromOutside = entry;
    pendingInvite = null;
    entry = false;
    if (!r.code || get().workspaces.some((w) => w.code === r.code)) return;
    if (await get().joinWorkspace(invite?.hash ?? location.hash)) return;
    // A keyless invite link (or an old code-only link someone opened) gets an explanation; in-app
    // navigation to a workspace you've left (history back, a stale link) just goes home.
    if (invite || fromOutside) get().toast({ tone: 'danger', title: 'This link can’t be joined', description: 'It has no workspace key. Ask a member for a fresh invite link.', duration: 10_000 });
    get().go({});
  };

  return {
    ready: false, identity: null, workspaces: [], settings: DEFAULT_SETTINGS, route: parseHash(), states: {}, tick: 0, blobVer: {}, blobProgress: {},
    panel: { type: null }, dialog: null, toasts: [], bridgeStatus: 'off', bridgeState: null, huddle: huddle.view, online: navigator.onLine, drawer: false, editing: null, clock: Date.now(), highlight: null,

    async init() {
      const [identity, workspaces, settings] = await Promise.all([kv.get<Identity>('identity'), kv.get<WsRecord[]>('workspaces'), kv.get<Settings>('settings')]);
      const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
      applyTheme(s.theme);
      // Records from before transports existed are Trystero workspaces.
      set({ identity: identity || null, workspaces: (workspaces || []).map((w) => ({ ...w, transport: w.transport ?? LEGACY_TRYSTERO })), settings: s, ready: true });
      // On each (re)connect, drop workspaces the bridge still runs but this app has left, e.g. while the bridge was down.
      let reconciled = false;
      bridge.subscribe((status, state) => {
        set({ bridgeStatus: status, bridgeState: state });
        if (status !== 'connected' || !state) { reconciled = false; return; }
        if (reconciled) return;
        reconciled = true;
        const mine = new Set(get().workspaces.map((w) => w.code));
        for (const w of state.workspaces) if (!mine.has(w.code)) bridge.send({ t: 'ws.leave', code: w.code });
      });
      huddle.subscribe((v) => {
        set({ huddle: v });
        // Outside a huddle there's no dock to show the error in (e.g. mic denied on join), so toast it.
        if (v.error && !v.ch) { get().toast({ tone: 'danger', title: 'Couldn’t join the huddle', description: v.error }); huddle.clearError(); }
      });
      setInterval(() => set({ clock: Date.now() }), 30_000);
      window.addEventListener('hashchange', onRoute);
      window.addEventListener('online', () => set({ online: true }));
      window.addEventListener('offline', () => set({ online: false }));
      document.addEventListener('visibilitychange', () => allPeers().forEach((p) => p.setPresence({ st: document.hidden ? 'away' : 'online' })));
      if (identity) { get().workspaces.forEach(connectWs); startBridge(identity); }
      await onRoute();
    },

    async createIdentity(phrase, name, handle) {
      const kp = keyFromPhrase(phrase);
      const identity: Identity = { ...kp, phrase, name: name.trim(), handle: handle.trim().toLowerCase() };
      await kv.set('identity', identity);
      set({ identity });
      get().workspaces.forEach(connectWs);
      startBridge(identity);
      await onRoute();
    },

    async updateProfile(name, handle) {
      const id = get().identity;
      if (!id) return;
      const identity = { ...id, name: name.trim(), handle: handle.trim().toLowerCase() };
      await kv.set('identity', identity);
      set({ identity });
      allPeers().forEach((p) => p.publish({ t: 'profile', b: { name: identity.name, handle: identity.handle } }));
      bridge.setIdentity({ phrase: identity.phrase, name: identity.name, handle: identity.handle });
    },

    async updateSettings(p) {
      const prev = get().settings;
      const settings = { ...prev, ...p };
      set({ settings });
      await kv.set('settings', settings);
      // Reconnect just the workspaces whose live connection depends on what changed, so nothing needs a reload.
      // Relay, file server and signaling defaults only shape new workspaces and uploads; TURN and the calls
      // switch are how this device connects now.
      const changed = (k: keyof NetSettings) => p[k] !== undefined && p[k] !== prev[k];
      const turn = changed('turn') || changed('turnUrls') || changed('turnUser') || changed('turnPass');
      const affected = get().workspaces.filter((w) => w.transport.kind === 'trystero' ? turn : changed('webrtc') || (settings.webrtc && turn)).map((w) => w.code);
      if (affected.length) await reconnect(affected);
      if (p.theme) applyTheme(p.theme);
      if (p.notifications && 'Notification' in window && Notification.permission === 'default') {
        const r = await Notification.requestPermission();
        if (r !== 'granted') { set({ settings: { ...get().settings, notifications: false } }); await kv.set('settings', get().settings); }
      }
      return affected.length;
    },

    async resetDevice() {
      await huddle.leave();
      get().workspaces.forEach((w) => disconnectWs(w.code));
      // Wipe every store: identity, workspaces, settings, marks, the bridge token, history and files.
      await bridge.forget();
      await Promise.all([kv.clear(), eventsDb.clear(), blobsDb.clear()]);
      location.hash = '#/';
      location.reload();
    },

    go(r) { location.hash = buildHash(r); },
    setPanel(panel) { set({ panel }); },
    setDialog(dialog) { set({ dialog }); },
    toast(t) {
      const id = ++toastId;
      const toasts = get().toasts;
      toasts.slice(0, -2).forEach((x) => get().dismiss(x.id)); // at most 3 on screen; pushed-out ones are dismissed properly
      set((s) => ({ toasts: [...s.toasts, { duration: 5000, ...t, id }] }));
    },
    dismiss(id) {
      const t = get().toasts.find((x) => x.id === id);
      if (!t) return;
      set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
      t.onDismiss?.();
    },

    async createWorkspace(name, net) {
      const code = newInviteCode();
      const me = get().identity!;
      const transport = net.kind === 'nostr' ? newNostrTransport(net.relays) : newTrysteroTransport(net.signal);
      const rec: WsRecord = { code, name: name.trim(), transport, creator: me.pub, lastRead: {}, muted: [],
        ...(net.kind === 'nostr' && net.blossom.length ? { blossom: net.blossom } : {}) };
      saveWs([...get().workspaces, rec]);
      connectWs(rec);
      const p = getPeer(code)!;
      p.publish({ t: 'ws.create', b: { name: rec.name } });
      p.publish({ t: 'ch.create', b: { id: 'general', name: 'general', topic: 'Everyone, everything' } });
      get().go({ code, ch: 'general' });
      return code;
    },

    async joinWorkspace(input) {
      const inv = parseInvite(input);
      if (!inv) return false;
      const { code, transport } = inv;
      if (!get().workspaces.some((w) => w.code === code)) {
        // The link names the creator, so moderation trusts them from the start instead of whoever claims it first.
        const rec: WsRecord = { code, name: formatCode(code), transport, creator: inv.creator ?? null, lastRead: {}, muted: [] };
        saveWs([...get().workspaces, rec]);
        connectWs(rec);
      }
      if (get().route.code !== code) get().go({ code });
      return true;
    },

    async leaveWorkspace(code) {
      if (get().huddle.code === code) await huddle.leave();
      disconnectWs(code);
      // Blobs aren't indexed by workspace: drop the ones this workspace's messages attach and no other workspace does.
      const fileIds = (st: WsState | undefined) => [...(st?.msgs.values() ?? [])].flatMap((m) => m.files.map((f) => f.id));
      const kept = new Set(Object.entries(get().states).flatMap(([c, st]) => (c === code ? [] : fileIds(st))));
      await Promise.all([eventsDb.deleteWs(code), kv.del('mark:' + code), blobsDb.del(fileIds(get().states[code]).filter((id) => !kept.has(id)))]);
      bridge.send({ t: 'ws.leave', code });
      saveWs(get().workspaces.filter((w) => w.code !== code));
      set((s) => { const { [code]: _x, ...states } = s.states; return { states }; });
      get().go({});
    },

    markRead(code, ch) {
      const rec = get().workspaces.find((w) => w.code === code);
      if (!rec) return;
      const lastRead = { ...rec.lastRead, [ch]: Date.now() };
      set({ workspaces: get().workspaces.map((w) => (w.code === code ? { ...w, lastRead } : w)) });
      if (readTimer) clearTimeout(readTimer);
      readTimer = setTimeout(() => kv.set('workspaces', get().workspaces), 500);
    },

    toggleMute(code, ch) {
      const rec = get().workspaces.find((w) => w.code === code);
      if (!rec) return;
      patchWs(code, { muted: rec.muted.includes(ch) ? rec.muted.filter((c) => c !== ch) : [...rec.muted, ch] });
    },

    publish(code, f) { return getPeer(code)?.publish(f); },

    async send(text, files, parent) {
      const { route, identity, settings } = get();
      if (!route.code || !route.ch || !identity) return false;
      const rec = get().workspaces.find((w) => w.code === route.code);
      const relayed = rec?.transport.kind === 'nostr';
      const fromSettings = parseServers(settings.blossom);
      const servers = rec?.blossom?.length ? rec.blossom : fromSettings.length ? fromSettings : DEFAULT_BLOSSOM;
      const big = files.find((f) => f.size > MAX_FILE_BYTES);
      if (big) { get().toast({ tone: 'danger', title: big.name + ' is over 25 MB', description: 'Remove it and share a link instead.' }); return false; }
      const refs: FileRef[] = [];
      for (const f of files) {
        const buf = await f.arrayBuffer();
        const id = await sha256Buf(buf);
        await blobsDb.put(id, buf);
        const ref: FileRef = { id, name: f.name, size: f.size, type: f.type || 'application/octet-stream' };
        if (!relayed) { refs.push(ref); continue; }
        // Relay workspaces carry files over Blossom, sealed with a per-file key.
        try { refs.push({ ...ref, blob: await uploadFile(servers, new Uint8Array(buf)) }); }
        catch (err) {
          // Don't send a message whose attachment nobody could open; the composer keeps the draft for a retry.
          get().toast({ tone: 'danger', title: 'Couldn’t upload ' + f.name, description: err instanceof Error ? err.message : String(err), duration: 10_000 });
          return false;
        }
      }
      if (!text && !refs.length) return false;
      get().publish(route.code, { t: 'msg', ch: route.ch, to: privateTarget(route.ch, identity.pub), b: { text, parent, files: refs.length ? refs : undefined } });
      get().setTyping(null);
      return true;
    },

    createChannel(name, topic) {
      const code = get().route.code;
      const s = code && get().states[code];
      if (!code || !s) return;
      let id = slug(name) || 'channel';
      while (s.channels.has(id)) id = slug(name) + '-' + Math.random().toString(36).slice(2, 5);
      get().publish(code, { t: 'ch.create', b: { id, name: slug(name) || name, topic } });
      get().go({ code, ch: id });
      return id;
    },

    setTyping(ch) {
      const p = getPeer(get().route.code);
      if (!p) return;
      if (p.myPresence.typing !== ch) p.setPresence({ typing: ch });
      if (typingTimer) clearTimeout(typingTimer);
      if (ch) typingTimer = setTimeout(() => p.setPresence({ typing: null }), 4000);
    },

    approve(req, option) {
      const { route, identity } = get();
      if (!route.code || !route.ch || !identity) return;
      get().publish(route.code, { t: 'approve', ch: route.ch, to: identity.pub, b: { req, option } });
    },

    async fetchBlob(code, id) { return !!(await getPeer(code)?.fetchFile(id)); },

    setAgents(code, agentIds) {
      const rec = get().workspaces.find((w) => w.code === code);
      if (!rec) return;
      bridge.send({ t: 'ws.join', code, name: get().states[code]?.name || rec.name, transport: rec.transport, creator: rec.creator, agents: agentIds });
    },

    async updateConnection(code, change) {
      const rec = get().workspaces.find((w) => w.code === code);
      if (!rec) throw new Error('Unknown workspace');
      const t = rec.transport;
      if (t.kind === 'nostr') {
        if (change.kind !== 'nostr') throw new Error('A relay workspace’s settings are its relays and file servers');
        if (!change.relays.length) throw new Error('A relay workspace needs at least one relay');
        patchWs(code, { transport: { ...t, relays: change.relays }, blossom: change.blossom.length ? change.blossom : undefined });
      } else {
        if (change.kind !== 'trystero') throw new Error('A peer-to-peer workspace’s setting is its signaling');
        // The default (Nostr, built-in servers) is stored as no signal, matching new workspaces and short links.
        const { signal: _old, ...rest } = t;
        patchWs(code, { transport: change.signal.kind === 'nostr' && !change.signal.urls.length ? rest : { ...rest, signal: change.signal } });
      }
      await reconnect([code]);
    },
  };
});
