import { create } from 'zustand';
import {
  keyFromPhrase, newInviteCode, normalizeCode, formatCode, slug, mentions, sha256Buf, MAX_FILE_BYTES,
  type KeyPair, type WsState, type Ev, type FileRef, type EventFields, type BridgeState,
} from '@yurt/protocol';
import { kv, eventsDb, blobsDb } from './lib/db';
import { connect, getPeer, allPeers, disconnect, type NetSettings } from './lib/net';
import { bridge, type BridgeStatus } from './lib/bridge';
import { huddle, type HuddleView } from './lib/huddle';
import { notify } from './lib/format';

export interface Identity extends KeyPair { phrase: string; name: string; handle: string }
export interface WsRecord { code: string; name: string; creator: string | null; lastRead: Record<string, number>; muted: string[]; joinedAt: number }
export interface Settings extends NetSettings { theme: 'dark' | 'light'; notifications: boolean }
export interface Route { code?: string; ch?: string; thread?: string }
export type PanelType = 'members' | 'profile' | 'thread' | 'pinned' | 'search' | null;
export interface Panel { type: PanelType; id?: string }
export type DialogType = null | 'workspace' | 'channel' | 'invite' | 'agent' | 'bridge' | 'settings' | 'channelSettings' | 'jump';
export interface ToastT { id: number; tone?: 'neutral' | 'success' | 'agent' | 'human' | 'danger'; title: string; description?: string; actionLabel?: string; onAction?: () => void; duration?: number }

const DEFAULT_SETTINGS: Settings = { theme: 'dark', notifications: false, turn: 'default', turnUrls: '', turnUser: '', turnPass: '', relays: '' };

export function parseHash(h = location.hash): Route {
  const p = h.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const r: Route = {};
  for (let i = 0; i < p.length; i += 2) {
    if (p[i] === 'w') r.code = normalizeCode(p[i + 1] || '') || undefined;
    if (p[i] === 'c') r.ch = p[i + 1];
    if (p[i] === 't') r.thread = p[i + 1];
  }
  return r;
}
export function buildHash(r: Route): string {
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
  blobTick: number;
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
  highlight: string | null;

  init(): Promise<void>;
  createIdentity(phrase: string, name: string, handle: string): Promise<void>;
  updateProfile(name: string, handle: string): Promise<void>;
  updateSettings(p: Partial<Settings>): Promise<void>;
  resetDevice(): Promise<void>;
  go(r: Route): void;
  setPanel(p: Panel): void;
  setDialog(d: DialogType): void;
  toast(t: Omit<ToastT, 'id'>): void;
  dismiss(id: number): void;
  createWorkspace(name: string): Promise<string>;
  joinWorkspace(input: string): Promise<boolean>;
  leaveWorkspace(code: string): Promise<void>;
  markRead(code: string, ch: string): void;
  toggleMute(code: string, ch: string): void;
  publish<B>(code: string, f: Omit<EventFields<B>, 'ws'>): Ev<B> | undefined;
  send(text: string, files: File[], parent?: string): Promise<void>;
  createChannel(name: string, topic: string): string | undefined;
  setTyping(ch: string | null): void;
  approve(req: string, option: string): void;
  fetchBlob(id: string): void;
  setAgents(code: string, agentIds: string[]): void;
}

let typingTimer: ReturnType<typeof setTimeout> | null = null;
let readTimer: ReturnType<typeof setTimeout> | null = null;
let toastId = 0;

export function privateTarget(ch: string, me: string): string | undefined {
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
    const peer = connect(rec.code, identity, rec.creator, settings, {
      onState: (code, s, fresh) => {
        set((st) => ({ states: { ...st.states, [code]: s } }));
        const r = get().workspaces.find((w) => w.code === code);
        if (r && s.name && r.name !== s.name) patchWs(code, { name: s.name });
        const me = get().identity;
        if (me && !profilePublished.has(code)) {
          const p = s.profiles.get(me.pub);
          if (!p || p.name !== me.name || p.handle !== me.handle) getPeer(code)?.publish({ t: 'profile', b: { name: me.name, handle: me.handle } });
          profilePublished.add(code);
        }
        onFresh(code, s, fresh);
      },
      onPeers: () => set((st) => ({ tick: st.tick + 1 })),
      onCreator: (code, pub) => patchWs(code, { creator: pub }),
      onBlob: () => set((st) => ({ blobTick: st.blobTick + 1 })),
      onBlobProgress: (id, p) => set((st) => ({ blobProgress: { ...st.blobProgress, [id]: p } })),
    });
    peer.setPresence({ st: document.hidden ? 'away' : 'online' });
  };

  const applyTheme = (t: Settings['theme']) => { document.documentElement.dataset.theme = t; };

  const onRoute = async () => {
    const r = parseHash();
    set({ route: r, drawer: false, highlight: null, panel: r.thread ? { type: 'thread', id: r.thread } : get().panel.type === 'thread' ? { type: null } : get().panel });
    if (r.code && get().identity && !get().workspaces.some((w) => w.code === r.code)) await get().joinWorkspace(r.code);
  };

  return {
    ready: false, identity: null, workspaces: [], settings: DEFAULT_SETTINGS, route: parseHash(), states: {}, tick: 0, blobTick: 0, blobProgress: {},
    panel: { type: null }, dialog: null, toasts: [], bridgeStatus: 'off', bridgeState: null, huddle: huddle.view, online: navigator.onLine, drawer: false, editing: null, highlight: null,

    async init() {
      const [identity, workspaces, settings] = await Promise.all([kv.get<Identity>('identity'), kv.get<WsRecord[]>('workspaces'), kv.get<Settings>('settings')]);
      const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
      applyTheme(s.theme);
      set({ identity: identity || null, workspaces: workspaces || [], settings: s, ready: true });
      bridge.subscribe((status, state) => set({ bridgeStatus: status, bridgeState: state }));
      huddle.subscribe((v) => set({ huddle: v }));
      window.addEventListener('hashchange', onRoute);
      window.addEventListener('online', () => set({ online: true }));
      window.addEventListener('offline', () => set({ online: false }));
      document.addEventListener('visibilitychange', () => allPeers().forEach((p) => p.setPresence({ st: document.hidden ? 'away' : 'online' })));
      if (identity) {
        (workspaces || []).forEach(connectWs);
        bridge.autoStart({ phrase: identity.phrase, name: identity.name, handle: identity.handle });
      }
      await onRoute();
    },

    async createIdentity(phrase, name, handle) {
      const kp = keyFromPhrase(phrase);
      const identity: Identity = { ...kp, phrase, name: name.trim(), handle: handle.trim().toLowerCase() };
      await kv.set('identity', identity);
      set({ identity });
      get().workspaces.forEach(connectWs);
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
      const settings = { ...get().settings, ...p };
      set({ settings });
      await kv.set('settings', settings);
      if (p.theme) applyTheme(p.theme);
      if (p.notifications && 'Notification' in window && Notification.permission === 'default') {
        const r = await Notification.requestPermission();
        if (r !== 'granted') { set({ settings: { ...settings, notifications: false } }); kv.set('settings', { ...settings, notifications: false }); }
      }
    },

    async resetDevice() {
      await huddle.leave();
      for (const w of get().workspaces) { disconnect(w.code); await eventsDb.deleteWs(w.code); }
      await Promise.all([kv.del('identity'), kv.del('workspaces'), bridge.forget()]);
      location.hash = '#/';
      location.reload();
    },

    go(r) { location.hash = buildHash(r); },
    setPanel(panel) { set({ panel }); },
    setDialog(dialog) { set({ dialog }); },
    toast(t) { const id = ++toastId; set((s) => ({ toasts: [...s.toasts.slice(-2), { duration: 5000, ...t, id }] })); },
    dismiss(id) { set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })); },

    async createWorkspace(name) {
      const code = newInviteCode();
      const me = get().identity!;
      const rec: WsRecord = { code, name: name.trim(), creator: me.pub, lastRead: {}, muted: [], joinedAt: Date.now() };
      saveWs([...get().workspaces, rec]);
      connectWs(rec);
      const p = getPeer(code)!;
      p.publish({ t: 'ws.create', b: { name: rec.name } });
      p.publish({ t: 'ch.create', b: { id: 'general', name: 'general', topic: 'Everyone, everything' } });
      get().go({ code, ch: 'general' });
      return code;
    },

    async joinWorkspace(input) {
      const code = normalizeCode(input);
      if (!code) return false;
      if (!get().workspaces.some((w) => w.code === code)) {
        const rec: WsRecord = { code, name: formatCode(code), creator: null, lastRead: {}, muted: [], joinedAt: Date.now() };
        saveWs([...get().workspaces, rec]);
        connectWs(rec);
      }
      if (get().route.code !== code) get().go({ code });
      return true;
    },

    async leaveWorkspace(code) {
      if (get().huddle.code === code) await huddle.leave();
      disconnect(code);
      await eventsDb.deleteWs(code);
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
      const { route, identity } = get();
      if (!route.code || !route.ch || !identity) return;
      const refs: FileRef[] = [];
      for (const f of files) {
        if (f.size > MAX_FILE_BYTES) { get().toast({ tone: 'danger', title: f.name + ' is over 25 MB', description: 'Share a link instead.' }); continue; }
        const buf = await f.arrayBuffer();
        const id = await sha256Buf(buf);
        await blobsDb.put(id, buf);
        refs.push({ id, name: f.name, size: f.size, type: f.type || 'application/octet-stream' });
      }
      if (!text && !refs.length) return;
      get().publish(route.code, { t: 'msg', ch: route.ch, to: privateTarget(route.ch, identity.pub), b: { text, parent, files: refs.length ? refs : undefined } });
      get().setTyping(null);
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

    fetchBlob(id) { allPeers().forEach((p) => p.requestBlob(id)); },

    setAgents(code, agentIds) {
      const rec = get().workspaces.find((w) => w.code === code);
      if (!rec) return;
      bridge.send({ t: 'ws.join', code, name: get().states[code]?.name || rec.name, creator: rec.creator, agents: agentIds });
    },
  };
});
