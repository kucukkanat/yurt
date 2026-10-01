import { create } from 'zustand';
import { addressed } from './lib/private';
import {
  keyFromPhrase,
  newInviteCode,
  formatCode,
  slug,
  noticeFor,
  sha256Buf,
  MAX_FILE_BYTES,
  parseInvite,
  newNostrTransport,
  newTrysteroTransport,
  uploadFile,
  type WsTransport,
  type Signaling,
  type WorkspacePeer,
  type WsState,
  type Ev,
  type FileRef,
  type EventFields,
  type BridgeState,
} from '@yurt/protocol';
import { kv, eventsDb, blobsDb } from './lib/db';
import { connect, getPeer, allPeers, disconnect } from './lib/net';
import { bridge, type BridgeStatus } from './lib/bridge';
import { huddle, type HuddleView } from './lib/huddle';
import { askNotifications, errorText } from './lib/format';
import { announce, closeNotifications, type Notice } from './lib/notifications';
import { haptic } from './lib/haptics';
import { report } from './lib/diagnostics';
import { buildHash, parseHash, type Route } from './lib/route';
import { presenceNow } from './lib/visibility';
import { DEFAULT_SETTINGS, loadIdentity, loadSettings, loadWorkspaces, uploadServers, type Identity, type NetSettings, type Settings, type WsRecord } from './lib/stored';
import { rememberNet, type NewWorkspaceNet } from './lib/newNet';

export type { Settings, WsRecord } from './lib/stored';

type ConnectionChange = { kind: 'nostr'; relays: string[]; blossom: string[] } | { kind: 'trystero'; signal: Signaling };
/** Sections of the single Settings window: "you" (account and this device) and the current workspace. */
export type SettingsSection = 'profile' | 'identity' | 'preferences' | 'app' | 'connection' | 'agents' | 'ws-general' | 'ws-network' | 'ws-agents';
type PanelType = 'members' | 'profile' | 'thread' | 'pinned' | 'search' | null;
interface Panel {
  type: PanelType;
  id?: string | undefined;
}
type DialogType = null | 'workspace' | 'channel' | 'invite' | 'settings' | 'channelSettings' | 'jump';
/** `onDismiss` runs once however the toast goes away: expired, closed, acted on, or pushed out by newer toasts. */
interface ToastT {
  id: number;
  tone?: 'neutral' | 'success' | 'agent' | 'human' | 'danger' | undefined;
  title: string;
  description?: string | undefined;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
  onDismiss?: (() => void) | undefined;
  duration?: number | undefined;
}

/** What the app holds in memory (see initialState); AppState adds the actions. */
export interface AppData {
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
  settingsSection: SettingsSection;
  /** Settings was opened on a section asked for by name: narrow screens show it at once, not the list first. */
  settingsJump: boolean;
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
  /** The browser offered to install Yurt (Chromium); lib/pwa.ts holds the offer. */
  installable: boolean;
  /** Running as the installed app, not in a browser tab (set at start, lib/pwa.ts isStandalone). */
  standalone: boolean;
}

export interface AppState extends AppData {
  /** Starts the app. `clockMs` (how often time-based views refresh) is only shortened by tests, like LinkTiming. */
  init(opts?: { clockMs?: number }): Promise<void>;
  createIdentity(phrase: string, name: string, handle: string): Promise<void>;
  updateProfile(name: string, handle: string): Promise<void>;
  /** Saves and applies at once; returns how many workspaces were reconnected to pick up the change. */
  updateSettings(p: Partial<Settings>): Promise<number>;
  resetDevice(): Promise<void>;
  go(r: Route): void;
  setPanel(p: Panel): void;
  setDialog(d: DialogType): void;
  /** Opens the single Settings window, on `section` or wherever it was last. */
  openSettings(section?: SettingsSection): void;
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

/** The side panel after navigating: a thread route opens its thread; leaving one closes the thread panel. */
const panelFor = (r: Route, cur: Panel): Panel => (r.thread ? { type: 'thread', id: r.thread } : cur.type === 'thread' ? { type: null } : cur);

/** A workspace's transport after a settings change, refusing changes that don't fit its (fixed) mode. */
function changedTransport(t: WsTransport, change: ConnectionChange): { transport: WsTransport; blossom?: string[] | undefined } {
  if (t.kind === 'nostr') {
    if (change.kind !== 'nostr') throw new Error('A relay workspace’s settings are its relays and file servers');
    if (!change.relays.length) throw new Error('A relay workspace needs at least one relay');
    return { transport: { ...t, relays: change.relays }, blossom: change.blossom.length ? change.blossom : undefined };
  }
  if (change.kind !== 'trystero') throw new Error('A peer-to-peer workspace’s setting is its signaling');
  // The default (Nostr, built-in servers) is stored as no signal, matching new workspaces and short links.
  const { signal: _old, ...rest } = t;
  return { transport: change.signal.kind === 'nostr' && !change.signal.urls.length ? rest : { ...rest, signal: change.signal } };
}

/** A desktop notification for a fresh message, if it's for me (a mention or any direct message) and I'm not looking at it. */
/**
 * A fresh message worth a notification here: what notifies is decided by noticeFor (@yurt/protocol); this device adds that it's new (not a backfill) and not the conversation already on screen.
 */
function notificationFor(e: Ev, s: WsState, ctx: { me: Identity; route: Route; code: string; muted: readonly string[] }): Notice | null {
  // The reduced message, not the raw body: only what the reducer accepted is announced.
  const m = e.t === 'msg' && e.ch ? s.msgs.get(e.id) : undefined;
  if (!m || Date.now() - m.ts > 60_000) return null;
  if (!document.hidden && ctx.route.code === ctx.code && ctx.route.ch === m.ch) return null;
  const n = noticeFor(m, s, ctx.me.pub, ctx.muted);
  return n && { ...n, code: ctx.code, tag: ctx.code + ':' + m.id };
}

/** Everything the app holds in memory before `init` loads saved data; a device reset returns to it. */
const initialState = (): AppData => ({
  ready: false,
  identity: null,
  workspaces: [],
  settings: DEFAULT_SETTINGS,
  route: parseHash(location.hash),
  states: {},
  tick: 0,
  blobVer: {},
  blobProgress: {},
  panel: { type: null },
  dialog: null,
  settingsSection: 'profile',
  settingsJump: false,
  toasts: [],
  bridgeStatus: 'off',
  bridgeState: null,
  huddle: huddle.view,
  online: navigator.onLine,
  drawer: false,
  editing: null,
  clock: Date.now(),
  highlight: null,
  installable: false,
  standalone: false,
});

let typingTimer: ReturnType<typeof setTimeout> | null = null;
let readTimer: ReturnType<typeof setTimeout> | null = null;
let toastId = 0;

export const useApp = create<AppState>((set, get) => {
  // App-state writes run in the background, so a failure (e.g. a newer app version upgraded the database in another
  // tab) must be reported here, never left unhandled. One toast while saving keeps failing, not one per write.
  let saveFailing = false;
  const persist = (key: string, value: unknown) =>
    kv.set(key, value).then(
      () => {
        saveFailing = false;
      },
      (err: unknown) => {
        report('device', 'error', 'Couldn’t save ' + key + ': ' + errorText(err));
        if (saveFailing) return;
        saveFailing = true;
        get().toast({ tone: 'danger', title: 'Couldn’t save on this device', description: errorText(err), duration: 10_000 });
      },
    );
  const saveWs = (ws: WsRecord[]) => {
    set({ workspaces: ws });
    void persist('workspaces', ws);
  };
  const patchWs = (code: string, p: Partial<WsRecord>) => saveWs(get().workspaces.map((w) => (w.code === code ? { ...w, ...p } : w)));
  const profilePublished = new Set<string>();

  const onFresh = (code: string, s: WsState, fresh: Ev[], me: Identity) => {
    const { route, settings, workspaces } = get();
    const muted = workspaces.flatMap((w) => (w.code === code ? w.muted : []));
    for (const e of fresh) {
      const n = notificationFor(e, s, { me, route, code, muted });
      if (!n) continue;
      // In my hand and looking elsewhere in the app: a buzz says something arrived for me.
      if (!document.hidden) haptic('notice');
      if (settings.notifications) void announce(n, () => get().go({ code, ch: n.ch }));
    }
  };

  /**
   * Stores attachments locally and, in relay workspaces (`servers` given), uploads them to Blossom sealed with a
   * per-file key. Null when an upload failed: a message whose attachment nobody could open isn't sent.
   */
  const attach = async (files: File[], servers: readonly string[] | null): Promise<FileRef[] | null> => {
    const refs: FileRef[] = [];
    for (const f of files) {
      const buf = await f.arrayBuffer();
      const id = await sha256Buf(buf);
      await blobsDb.put(id, buf);
      const ref: FileRef = { id, name: f.name, size: f.size, type: f.type || 'application/octet-stream' };
      try {
        refs.push(servers ? { ...ref, blob: await uploadFile(servers, new Uint8Array(buf)) } : ref);
      } catch (err) {
        // The composer keeps the draft for a retry.
        get().toast({ tone: 'danger', title: 'Couldn’t upload ' + f.name, description: errorText(err), duration: 10_000 });
        return null;
      }
    }
    return refs;
  };

  /** Connects a workspace as `me`. */
  const connectAs = (me: Identity, rec: WsRecord): WorkspacePeer => {
    const peer: WorkspacePeer = connect(rec.code, me, rec.creator, rec.transport, get().settings, {
      onState: (code, s, fresh) => {
        // A replaced (reconnected) or left peer may still finish loading; its late state must not land. A live
        // peer always has an identity (a device reset disconnects every peer); the current one, after renames.
        const current = getPeer(code) === peer ? get().identity : null;
        if (!current) return;
        set((st) => ({ states: { ...st.states, [code]: s } }));
        if (s.name && get().workspaces.some((w) => w.code === code && w.name !== s.name)) patchWs(code, { name: s.name });
        if (!profilePublished.has(code)) {
          const p = s.profiles.get(current.pub);
          if (!p || p.name !== current.name || p.handle !== current.handle) peer.publish({ t: 'profile', b: { name: current.name, handle: current.handle } });
          profilePublished.add(code);
        }
        onFresh(code, s, fresh, current);
      },
      onPeers: () => set((st) => ({ tick: st.tick + 1 })),
      onCreator: (code, pub) => patchWs(code, { creator: pub }),
      // After a rotation, remember the newest key: invite links use it, and it opens all earlier ones.
      // Only relay workspaces rotate, so only their records change.
      onKey: (code, key) => saveWs(get().workspaces.map((w) => (w.code === code && w.transport.kind === 'nostr' ? { ...w, transport: { ...w.transport, key } } : w))),
      onBlob: (id) => set((st) => ({ blobVer: { ...st.blobVer, [id]: (st.blobVer[id] ?? 0) + 1 } })),
      onBlobProgress: (id, p) => set((st) => ({ blobProgress: { ...st.blobProgress, [id]: p } })),
      onJoinError: (code, d) => report(code, 'join', d),
      // Fail loud: a device that can't save or store files must say so, not just log it.
      onError: (code, msg) => {
        report(code, 'error', msg);
        get().toast({ tone: 'danger', title: msg, duration: 10_000 });
      },
    });
    peer.setPresence({ st: presenceNow() });
    return peer;
  };
  /** Connects a workspace once there's an identity to connect as (before onboarding, nothing connects). */
  const connectWs = (rec: WsRecord) => {
    const me = get().identity;
    if (me) connectAs(me, rec);
  };
  // Forget "profile published" with the connection, so a rejoin publishes the profile again.
  const disconnectWs = (code: string) => {
    disconnect(code);
    profilePublished.delete(code);
  };
  const reconnect = async (codes: string[]) => {
    if (codes.includes(get().huddle.code ?? '')) await huddle.leave();
    for (const rec of get().workspaces.filter((w) => codes.includes(w.code))) {
      disconnectWs(rec.code);
      connectWs(rec);
    }
    set((st) => ({ tick: st.tick + 1 }));
  };
  const startBridge = (id: Identity) => bridge.autoStart({ phrase: id.phrase, name: id.name, handle: id.handle });

  const applyTheme = (t: Settings['theme']) => {
    document.documentElement.dataset.theme = t;
  };

  // An invite link carries the workspace key in its hash. Hold it in memory only and take it out of
  // the address bar and history at once, so it never lands in synced browser history.
  // It survives only until it's used or the route moves to another workspace: a later route never reuses it.
  let pendingInvite: { code: string | undefined; hash: string } | null = null;
  // The first route of a page load came from outside (a pasted or clicked link); later ones are in-app navigation.
  let entry = true;
  const onRoute = async () => {
    const r = parseHash(location.hash);
    if (location.hash.includes('/k/')) {
      pendingInvite = { code: r.code, hash: location.hash };
      history.replaceState(null, '', buildHash(r));
    }
    if (pendingInvite && pendingInvite.code !== r.code) pendingInvite = null;
    set({ route: r, drawer: false, highlight: null, panel: panelFor(r, get().panel) });
    if (!get().identity) return; // onboarding: keep the invite for createIdentity
    const invite = pendingInvite;
    const fromOutside = entry;
    pendingInvite = null;
    entry = false;
    if (!r.code || get().workspaces.some((w) => w.code === r.code)) return;
    if (await get().joinWorkspace(invite?.hash ?? location.hash)) return;
    // A keyless invite link (or an old code-only link someone opened) gets an explanation; in-app
    // navigation to a workspace you've left (history back, a stale link) just goes home.
    if (invite || fromOutside)
      get().toast({ tone: 'danger', title: 'This link can’t be joined', description: 'It has no workspace key. Ask a member for a fresh invite link.', duration: 10_000 });
    get().go({});
  };

  return {
    ...initialState(),

    async init({ clockMs = 30_000 } = {}) {
      const [identity, workspaces, settings] = await Promise.all([
        kv.get('identity').then(loadIdentity),
        kv.get('workspaces').then(loadWorkspaces),
        kv.get('settings').then(loadSettings),
      ]);
      applyTheme(settings.theme);
      set({ identity, workspaces, settings, ready: true });
      // On each (re)connect, drop workspaces the bridge still runs but this app has left, e.g. while the bridge was down.
      let reconciled = false;
      const reconcile = (state: BridgeState) => {
        const mine = new Set(get().workspaces.map((w) => w.code));
        for (const w of state.workspaces) if (!mine.has(w.code)) bridge.send({ t: 'ws.leave', code: w.code });
        // ...and re-send the rest with the app's current transport: the bridge only meets members over the
        // workspace's own signaling or relays, which may have changed here while it was down.
        for (const w of state.workspaces) if (mine.has(w.code)) get().setAgents(w.code, w.agents);
      };
      bridge.subscribe((status, state) => {
        set({ bridgeStatus: status, bridgeState: state });
        const connected = status === 'connected' && !!state;
        if (connected && !reconciled) reconcile(state);
        reconciled = connected;
      });
      huddle.subscribe((v) => {
        set({ huddle: v });
        // Outside a huddle there's no dock to show the error in (e.g. mic denied on join), so toast it.
        if (v.error && !v.ch) {
          get().toast({ tone: 'danger', title: 'Couldn’t join the huddle', description: v.error });
          huddle.clearError();
        }
      });
      setInterval(() => set({ clock: Date.now() }), clockMs);
      window.addEventListener('hashchange', onRoute);
      window.addEventListener('online', () => set({ online: true }));
      window.addEventListener('offline', () => set({ online: false }));
      document.addEventListener('visibilitychange', () => {
        for (const p of allPeers()) p.setPresence({ st: presenceNow() });
      });
      if (identity) {
        get().workspaces.forEach(connectWs);
        startBridge(identity);
      }
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
      for (const p of allPeers()) p.publish({ t: 'profile', b: { name: identity.name, handle: identity.handle } });
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
      const affected = get()
        .workspaces.filter((w) => (w.transport.kind === 'trystero' ? turn : changed('webrtc') || (settings.webrtc && turn)))
        .map((w) => w.code);
      if (affected.length) await reconnect(affected);
      if (p.theme) applyTheme(p.theme);
      // Turning notifications on asks the browser; a refusal turns the setting back off.
      if (p.notifications && !(await askNotifications())) {
        set({ settings: { ...get().settings, notifications: false } });
        await kv.set('settings', get().settings);
      }
      return affected.length;
    },

    async resetDevice() {
      await huddle.leave();
      for (const w of get().workspaces) disconnectWs(w.code);
      // Wipe every store: identity, workspaces, settings, marks, the bridge token, history and files.
      await bridge.forget();
      await Promise.all([kv.clear(), eventsDb.clear(), blobsDb.clear()]);
      // Then start over in place, as a first visit: onboarding, default settings, nothing in memory.
      profilePublished.clear();
      pendingInvite = null;
      history.replaceState(null, '', '#/');
      applyTheme(DEFAULT_SETTINGS.theme);
      set({ ...initialState(), route: {}, ready: true });
    },

    go(r) {
      location.hash = buildHash(r);
    },
    setPanel(panel) {
      set({ panel });
    },
    setDialog(dialog) {
      set({ dialog });
    },
    openSettings(section) {
      // Workspace sections only exist inside a workspace; elsewhere fall back to the first "you" section.
      const want = section ?? get().settingsSection;
      const settingsSection = want.startsWith('ws-') && !get().route.code ? 'profile' : want;
      set({ dialog: 'settings', settingsSection, settingsJump: settingsSection === section });
    },
    toast(t) {
      const id = ++toastId;
      const toasts = get().toasts;
      for (const x of toasts.slice(0, -2)) get().dismiss(x.id); // at most 3 on screen; pushed-out ones are dismissed properly
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
      const me = get().identity;
      if (!me) throw new Error('Create your identity before a workspace');
      const transport = net.kind === 'nostr' ? newNostrTransport(net.relays) : newTrysteroTransport(net.signal);
      const rec: WsRecord = {
        code,
        name: name.trim(),
        transport,
        creator: me.pub,
        lastRead: {},
        muted: [],
        ...(net.kind === 'nostr' && net.blossom.length ? { blossom: net.blossom } : {}),
      };
      saveWs([...get().workspaces, rec]);
      // Remember these settings: they prefill the next workspace created in this mode.
      const settings = { ...get().settings, lastNet: rememberNet(get().settings.lastNet, net) };
      set({ settings });
      await kv.set('settings', settings);
      const p = connectAs(me, rec);
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
      set((s) => {
        const { [code]: _x, ...states } = s.states;
        return { states };
      });
      get().go({});
    },

    markRead(code, ch) {
      const rec = get().workspaces.find((w) => w.code === code);
      if (!rec) return;
      closeNotifications(code, ch);
      const lastRead = { ...rec.lastRead, [ch]: Date.now() };
      set({ workspaces: get().workspaces.map((w) => (w.code === code ? { ...w, lastRead } : w)) });
      if (readTimer) clearTimeout(readTimer);
      readTimer = setTimeout(() => void persist('workspaces', get().workspaces), 500);
    },

    toggleMute(code, ch) {
      const rec = get().workspaces.find((w) => w.code === code);
      if (!rec) return;
      patchWs(code, { muted: rec.muted.includes(ch) ? rec.muted.filter((c) => c !== ch) : [...rec.muted, ch] });
    },

    publish(code, f) {
      return getPeer(code)?.publish(f);
    },

    async send(text, files, parent) {
      const { route, identity } = get();
      // A route can point at a workspace I've just left: nothing is sent, so the composer keeps the draft.
      const rec = get().workspaces.find((w) => w.code === route.code);
      if (!rec || !route.ch || !identity) return false;
      const big = files.find((f) => f.size > MAX_FILE_BYTES);
      if (big) {
        get().toast({ tone: 'danger', title: big.name + ' is over 25 MB', description: 'Remove it and share a link instead.' });
        return false;
      }
      const refs = await attach(files, uploadServers(rec));
      if (!refs) return false;
      if (!text && !refs.length) return false;
      get().publish(rec.code, {
        t: 'msg',
        ch: route.ch,
        ...addressed(route.ch, identity.pub),
        b: { text, ...(parent ? { parent } : {}), ...(refs.length ? { files: refs } : {}) },
      });
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

    async fetchBlob(code, id) {
      return !!(await getPeer(code)?.fetchFile(id));
    },

    setAgents(code, agentIds) {
      const rec = get().workspaces.find((w) => w.code === code);
      if (!rec) return;
      // The record's name follows the workspace's own (see onState).
      bridge.send({ t: 'ws.join', code, name: rec.name, transport: rec.transport, creator: rec.creator, agents: agentIds });
    },

    async updateConnection(code, change) {
      const rec = get().workspaces.find((w) => w.code === code);
      if (!rec) throw new Error('Unknown workspace');
      patchWs(code, changedTransport(rec.transport, change));
      await reconnect([code]);
      // The bridge runs its own peer for this workspace: move it to the same signaling or relays.
      const onBridge = get().bridgeState?.workspaces.find((w) => w.code === code);
      if (onBridge) get().setAgents(code, onBridge.agents);
    },
  };
});
