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
  uploadFile,
  type WsTransport,
  type WorkspacePeer,
  type WsState,
  type Ev,
  type FileRef,
  type EventFields,
  type BridgeState,
  type Doc,
  type DocKind,
  type MeetSpec,
  type Msg,
  type Suggestion,
  type Note,
  type PollSpec,
  type TaskSetBody,
  type NotifyLevel,
  identityBackup,
  applySuggestion,
  docText,
  newId,
  notePutOp,
  noteRemoveOp,
  textOp,
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
import {
  DEFAULT_SETTINGS,
  legacyMutes,
  loadIdentity,
  loadSettings,
  loadWorkspaces,
  uploadServers,
  type Identity,
  type NetSettings,
  type Settings,
  type WsRecord,
} from './lib/stored';
import type { NewWorkspaceNet } from './lib/newNet';
import { backupConfig, docOf, ledgerFromText, ledgerOf, merge, missing, record, sameLedger, type Ledger } from './lib/backup';
import { viewOf } from './lib/collab';

export type { Settings, WsRecord } from './lib/stored';

/** Sections of the single Settings window: "you" (account and this device) and the current workspace. */
export type SettingsSection = 'profile' | 'identity' | 'preferences' | 'app' | 'connection' | 'agents' | 'ws-general' | 'ws-network' | 'ws-agents';
type PanelType = 'members' | 'profile' | 'thread' | 'pinned' | 'search' | 'work' | 'doc' | null;
interface Panel {
  type: PanelType;
  id?: string | undefined;
}
type DialogType = null | 'workspace' | 'channel' | 'invite' | 'settings' | 'channelSettings' | 'alerts' | 'jump' | 'collab';
/** The hub's tabs (the `work` panel): its `id` is one of these. */
export type WorkTab = 'tasks' | 'docs' | 'decisions' | 'saved';
/** What the create dialog makes, in which channel, and from which message (a task made from a message). */
export interface CollabForm {
  kind: 'task' | 'poll' | 'meet' | 'doc' | 'board';
  ch: string;
  src?: string | undefined;
  title?: string | undefined;
}
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
  /** The huddle panel is open, not collapsed to the dock; it opens whenever I join a huddle. */
  huddleOpen: boolean;
  editing: string | null;
  /** Ticks every 30 s so time-based UI (like the edit window) stays current. */
  clock: number;
  highlight: string | null;
  /** The browser offered to install Yurt (Chromium); lib/pwa.ts holds the offer. */
  installable: boolean;
  /** Running as the installed app, not in a browser tab (set at start, lib/pwa.ts isStandalone). */
  standalone: boolean;
  /** The create dialog's form (dialog `collab`). */
  collab: CollabForm | null;
  /** Following this member: the app goes where they look (lib/collab.ts followTarget). */
  following: string | null;
  /** Focus mode: others see it, and this device stays quiet (no notifications). */
  focus: boolean;
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
  /** How much `ch` alerts me (see levelOf in @yurt/protocol), for all my devices: published to myself. */
  setLevel(code: string, ch: string, level: NotifyLevel): void;
  publish<B>(code: string, f: Omit<EventFields<B>, 'ws'>): Ev<B> | undefined;
  /** False when nothing was sent (e.g. an upload failed), so the composer keeps the draft. */
  send(text: string, files: File[], parent?: string): Promise<boolean>;
  createChannel(name: string, topic: string): string | undefined;
  setTyping(ch: string | null): void;
  approve(req: string, option: string): void;
  /** Resolves false when the attachment couldn't be fetched. */
  fetchBlob(code: string, id: string): Promise<boolean>;
  setAgents(code: string, agentIds: string[]): void;
  /** A workspace's own network settings: relays and file servers. Saves and reconnects it. */
  updateConnection(code: string, change: NewWorkspaceNet): Promise<void>;

  /* Collaboration, in the current workspace. Everything is an ordinary event, so agents and peers see it alike. */
  openCollab(f: CollabForm): void;
  createTask(ch: string, title: string, o: { assignee?: string | undefined; due?: number | undefined; src?: string | undefined }): string | undefined;
  updateTask(id: string, patch: Omit<TaskSetBody, 'id'>): void;
  postPoll(ch: string, poll: PollSpec): void;
  vote(m: Msg, choices: number[]): void;
  postMeeting(ch: string, meet: MeetSpec): void;
  rsvp(m: Msg, going: 'yes' | 'no' | 'maybe'): void;
  decide(m: Msg, on: boolean): void;
  /** Makes a doc or board in `ch` and opens it. */
  createDoc(ch: string, title: string, kind: DocKind): string | undefined;
  renameDoc(id: string, title: string): void;
  /** Archives the doc on screen and goes back to the list. */
  archiveDoc(id: string): void;
  /** Saves a text doc's new content as one CRDT op (only what changed). */
  editDoc(d: Doc, text: string): void;
  /** Accepting applies the change to the doc too (if its text is still there). */
  resolveSuggestion(d: Doc, x: Suggestion, accept: boolean): void;
  putNote(d: Doc, note: Note): void;
  removeNote(d: Doc, noteId: string): void;
  /** Saves a message for later, or stops, privately (only my devices get it). */
  save(msgId: string, on: boolean): void;
  setFocus(on: boolean): void;
  /** The caret's line in a text doc, for others' cursors (none when I leave it). */
  setCursor(cur?: { doc: string; line: number }): void;
  follow(pub: string | null): void;
}

/** The side panel after navigating: a thread route opens its thread; leaving one closes the thread panel. */
const panelFor = (r: Route, cur: Panel): Panel => (r.thread ? { type: 'thread', id: r.thread } : cur.type === 'thread' ? { type: null } : cur);

/** A workspace's transport and file servers after a settings change. Its key stays. */
function changedTransport(t: WsTransport, change: NewWorkspaceNet): { transport: WsTransport; blossom?: string[] | undefined } {
  if (!change.relays.length) throw new Error('A workspace needs at least one relay');
  return { transport: { ...t, relays: change.relays }, blossom: change.blossom.length ? change.blossom : undefined };
}

/**
 * A fresh message worth a notification here: what notifies is decided by noticeFor (@yurt/protocol); this device adds that it's new (not a backfill) and not the conversation already on screen.
 */
function notificationFor(e: Ev, s: WsState, ctx: { me: Identity; route: Route; code: string }): Notice | null {
  // The reduced message, not the raw body: only what the reducer accepted is announced.
  const m = e.t === 'msg' && e.ch ? s.msgs.get(e.id) : undefined;
  if (!m || Date.now() - m.ts > 60_000) return null;
  if (!document.hidden && ctx.route.code === ctx.code && ctx.route.ch === m.ch) return null;
  const n = noticeFor(m, s, ctx.me.pub);
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
  huddleOpen: false,
  editing: null,
  clock: Date.now(),
  highlight: null,
  installable: false,
  standalone: false,
  collab: null,
  following: null,
  focus: false,
});

let typingTimer: ReturnType<typeof setTimeout> | null = null;
/** `here`'s address for events only my own devices get. */
const SELF = Symbol('self');
/** When each conversation's read mark last went to my other devices (code/ch → ms). */
const readSynced = new Map<string, number>();
/** Read marks reach my other devices at most this often per conversation. */
const READ_SYNC_MS = 30_000;
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
  // The identity's workspace list, backed up on Nostr relays (lib/backup.ts): every change is recorded at once
  // and synced shortly after, so a burst of changes is one save. Syncs run one at a time.
  let ledger: Ledger = {};
  let backupTimer: ReturnType<typeof setTimeout> | undefined;
  let backupQueue = Promise.resolve();
  const saveLedger = (next: Ledger) => {
    ledger = next;
    void persist('backup', docOf(next));
  };
  const syncBackupNow = async () => {
    const me = get().identity;
    if (!me) return;
    const vault = identityBackup(me.sec, backupConfig.relays);
    try {
      const theirs = ledgerFromText(await vault.load());
      if (get().identity !== me) return; // the device was reset meanwhile
      const merged = merge(ledger, theirs);
      if (!sameLedger(merged, ledger)) saveLedger(merged);
      const add = missing(ledger, get().workspaces);
      if (add.length) {
        saveWs([...get().workspaces, ...add]);
        add.forEach(connectWs);
        get().toast({ title: add.length === 1 ? 'Restored a workspace from your backup' : `Restored ${add.length} workspaces from your backup` });
      }
      // Saved only after a load succeeded: a device that couldn't read the backup must not replace it.
      if (!sameLedger(ledger, theirs)) await vault.save(JSON.stringify(docOf(ledger)));
    } catch (err) {
      // Offline, or no relay reachable: the next change, start or reconnect tries again.
      report('backup', 'error', 'Couldn’t sync the workspace backup: ' + errorText(err));
    } finally {
      vault.close();
    }
  };
  const syncBackup = () => {
    backupQueue = backupQueue.then(syncBackupNow);
    return backupQueue;
  };
  const saveWs = (ws: WsRecord[]) => {
    const next = record(ledger, get().workspaces, ws, Date.now());
    set({ workspaces: ws });
    void persist('workspaces', ws);
    if (sameLedger(next, ledger)) return;
    saveLedger(next);
    clearTimeout(backupTimer);
    backupTimer = setTimeout(() => void syncBackup(), backupConfig.delayMs);
  };
  const patchWs = (code: string, p: Partial<WsRecord>) => saveWs(get().workspaces.map((w) => (w.code === code ? { ...w, ...p } : w)));
  const profilePublished = new Set<string>();

  const onFresh = (code: string, s: WsState, fresh: Ev[], me: Identity) => {
    const { route, settings } = get();
    for (const e of fresh) {
      const n = notificationFor(e, s, { me, route, code });
      if (!n) continue;
      // In my hand and looking elsewhere in the app: a buzz says something arrived for me.
      if (!document.hidden) haptic('notice');
      if (settings.notifications && !get().focus) void announce(n, () => get().go({ code, ch: n.ch }));
    }
  };

  /**
   * Stores attachments locally and uploads them to Blossom sealed with a per-file key. Null when an upload failed: a
   * message whose attachment nobody could open isn't sent.
   */
  const attach = async (files: File[], servers: readonly string[]): Promise<FileRef[] | null> => {
    const refs: FileRef[] = [];
    for (const f of files) {
      const buf = await f.arrayBuffer();
      const id = await sha256Buf(buf);
      await blobsDb.put(id, buf);
      const ref: FileRef = { id, name: f.name, size: f.size, type: f.type || 'application/octet-stream' };
      try {
        refs.push({ ...ref, blob: await uploadFile(servers, new Uint8Array(buf)) });
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
      onKey: (code, key) => saveWs(get().workspaces.map((w) => (w.code === code ? { ...w, transport: { ...w.transport, key } } : w))),
      onBlob: (id) => set((st) => ({ blobVer: { ...st.blobVer, [id]: (st.blobVer[id] ?? 0) + 1 } })),
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
  /** Tells the current workspace what I'm looking at (presence `view`), for "who's here" and following. */
  const syncView = () => {
    const { route, panel } = get();
    const p = getPeer(route.code);
    const view = viewOf(route, panel);
    if (p && p.myPresence.view !== view) p.setPresence({ view, ...(panel.type === 'doc' ? {} : { cur: undefined }) });
  };
  /**
   * Publishes in the current workspace, if any. `to` addresses it: within a private conversation (its channel id:
   * to the other side), or to myself (my other devices only).
   */
  const here = <B>(f: Omit<EventFields<B>, 'ws'>, to?: string | typeof SELF) => {
    const { route, identity } = get();
    if (!route.code || !identity) return undefined;
    const aim = to === SELF ? { to: identity.pub } : to ? addressed(to, identity.pub) : {};
    return get().publish(route.code, { ...f, ...aim });
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
    syncView();
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
      const [identity, rawWorkspaces, settings, savedLedger] = await Promise.all([
        kv.get('identity').then(loadIdentity),
        kv.get('workspaces'),
        kv.get('settings').then(loadSettings),
        kv.get('backup'),
      ]);
      const workspaces = loadWorkspaces(rawWorkspaces);
      // Before the backup existed nothing was recorded: everything this device has counts as joined now.
      if (savedLedger === undefined) saveLedger(record({}, [], workspaces, Date.now()));
      else ledger = ledgerOf(savedLedger);
      applyTheme(settings.theme);
      set({ identity, workspaces, settings, ready: true });
      // On each (re)connect, drop workspaces the bridge still runs but this app has left, e.g. while the bridge was down.
      let reconciled = false;
      const reconcile = (state: BridgeState) => {
        const mine = new Set(get().workspaces.map((w) => w.code));
        for (const w of state.workspaces) if (!mine.has(w.code)) bridge.send({ t: 'ws.leave', code: w.code });
        // ...and re-send the rest with the app's current transport: the bridge only meets members over the
        // workspace's own relays, which may have changed here while it was down.
        for (const w of state.workspaces) if (mine.has(w.code)) get().setAgents(w.code, w.agents);
      };
      bridge.subscribe((status, state) => {
        set({ bridgeStatus: status, bridgeState: state });
        const connected = status === 'connected' && !!state;
        if (connected && !reconciled) reconcile(state);
        reconciled = connected;
      });
      huddle.subscribe((v) => {
        const was = get().huddle;
        // Joining a huddle (or moving to another) opens its panel; staying in one keeps it as the user left it.
        set({ huddle: v, ...(v.ch && (v.ch !== was.ch || v.code !== was.code) ? { huddleOpen: true } : {}) });
        // Outside a huddle there's no dock to show the error in (e.g. mic denied on join), so toast it.
        if (v.error && !v.ch) {
          get().toast({ tone: 'danger', title: 'Couldn’t join the huddle', description: v.error });
          huddle.clearError();
        }
      });
      setInterval(() => set({ clock: Date.now() }), clockMs);
      window.addEventListener('hashchange', onRoute);
      window.addEventListener('online', () => {
        set({ online: true });
        void syncBackup();
      });
      window.addEventListener('offline', () => set({ online: false }));
      document.addEventListener('visibilitychange', () => {
        for (const p of allPeers()) p.setPresence({ st: presenceNow() });
      });
      if (identity) {
        get().workspaces.forEach(connectWs);
        // Mutes from before alert levels were kept on this device only: they become the synced level "none", once.
        const mutes = legacyMutes(rawWorkspaces);
        for (const [code, chs] of mutes) for (const ch of chs) get().setLevel(code, ch, 'none');
        if (mutes.size) void persist('workspaces', get().workspaces);
        startBridge(identity);
        void syncBackup();
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
      // An imported phrase brings back the workspaces it belongs to (in the background: relays may be slow).
      void syncBackup();
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
      // TURN and the calls switch are how this device connects now; TURN matters only while calls are allowed.
      const changed = (k: keyof NetSettings) => p[k] !== undefined && p[k] !== prev[k];
      const turn = changed('turn') || changed('turnUrls') || changed('turnUser') || changed('turnPass');
      const affected = changed('webrtc') || (settings.webrtc && turn) ? get().workspaces.map((w) => w.code) : [];
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
      clearTimeout(backupTimer);
      ledger = {};
      history.replaceState(null, '', '#/');
      applyTheme(DEFAULT_SETTINGS.theme);
      set({ ...initialState(), route: {}, ready: true });
    },

    go(r) {
      location.hash = buildHash(r);
    },
    setPanel(panel) {
      set({ panel });
      syncView();
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
      const transport = newNostrTransport(net.relays);
      const rec: WsRecord = {
        code,
        name: name.trim(),
        transport,
        creator: me.pub,
        lastRead: {},
        ...(net.blossom.length ? { blossom: net.blossom } : {}),
      };
      saveWs([...get().workspaces, rec]);
      // Remember these settings: they prefill the next new workspace.
      const settings = { ...get().settings, lastNet: net };
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
        const rec: WsRecord = { code, name: formatCode(code), transport, creator: inv.creator ?? null, lastRead: {} };
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
      const at = Date.now();
      const lastRead = { ...rec.lastRead, [ch]: at };
      set({ workspaces: get().workspaces.map((w) => (w.code === code ? { ...w, lastRead } : w)) });
      if (readTimer) clearTimeout(readTimer);
      readTimer = setTimeout(() => void persist('workspaces', get().workspaces), 500);
      // My other devices learn it too (privately: addressed to myself), at most every READ_SYNC_MS per conversation.
      const me = get().identity?.pub;
      const key = code + '/' + ch;
      if (me && at - (readSynced.get(key) ?? 0) >= READ_SYNC_MS) {
        readSynced.set(key, at);
        get().publish(code, { t: 'read', to: me, b: { ch, ts: at } });
      }
    },

    setLevel(code, ch, level) {
      const me = get().identity?.pub;
      if (me) get().publish(code, { t: 'notify', to: me, b: { ch, level } });
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

    openCollab(collab) {
      set({ collab, dialog: 'collab' });
    },

    createTask(ch, title, o) {
      const id = newId();
      const e = here({
        t: 'task',
        b: { id, title: title.trim(), ch, ...(o.src ? { src: o.src } : {}), ...(o.assignee ? { assignee: o.assignee } : {}), ...(o.due ? { due: o.due } : {}) },
      });
      return e && id;
    },
    updateTask(id, patch) {
      here({ t: 'task.set', b: { id, ...patch } });
    },
    postPoll(ch, poll) {
      here({ t: 'msg', ch, b: { text: poll.q, poll } }, ch);
    },
    vote(m, choices) {
      here({ t: 'vote', b: { target: m.id, choices } }, m.ch);
    },
    postMeeting(ch, meet) {
      here({ t: 'msg', ch, b: { text: meet.title, meet } }, ch);
    },
    rsvp(m, going) {
      here({ t: 'rsvp', b: { target: m.id, going } }, m.ch);
    },
    decide(m, on) {
      here({ t: 'decide', b: { target: m.id, text: '', on } }, m.ch);
    },
    createDoc(ch, title, kind) {
      const id = newId();
      if (!here({ t: 'doc', b: { id, title: title.trim(), ch, kind } })) return undefined;
      get().setPanel({ type: 'doc', id });
      return id;
    },
    renameDoc(id, title) {
      here({ t: 'doc.set', b: { id, title: title.trim() } });
    },
    archiveDoc(id) {
      here({ t: 'doc.set', b: { id, archived: true } });
      get().setPanel({ type: 'work', id: 'docs' });
    },
    editDoc(d, text) {
      const u = textOp(d.ops, text);
      if (u) here({ t: 'doc.op', b: { doc: d.id, u } });
    },
    resolveSuggestion(d, x, accept) {
      const next = accept ? applySuggestion(docText(d.ops), x.find, x.replace) : null;
      if (accept && next === null) {
        get().toast({ tone: 'danger', title: 'That text has changed since', description: 'Edit the doc by hand, or reject the suggestion.' });
        return;
      }
      here({ t: 'suggest.res', b: { target: x.id, accept } });
      if (next !== null) get().editDoc(d, next);
    },
    putNote(d, note) {
      here({ t: 'doc.op', b: { doc: d.id, u: notePutOp(d.ops, note) } });
    },
    removeNote(d, noteId) {
      const u = noteRemoveOp(d.ops, noteId);
      if (u) here({ t: 'doc.op', b: { doc: d.id, u } });
    },
    save(msgId, on) {
      here({ t: 'save', b: { target: msgId, on } }, SELF);
      get().toast(on ? { title: 'Saved for later', description: 'Find it under Saved in the hub, on all your devices.' } : { title: 'Removed from saved' });
    },
    setFocus(focus) {
      set({ focus });
      for (const p of allPeers()) p.setPresence({ focus: focus || undefined });
    },
    setCursor(cur) {
      const p = getPeer(get().route.code);
      if (p && JSON.stringify(p.myPresence.cur) !== JSON.stringify(cur)) p.setPresence({ cur });
    },
    follow(following) {
      set({ following });
    },

    async updateConnection(code, change) {
      const rec = get().workspaces.find((w) => w.code === code);
      if (!rec) throw new Error('Unknown workspace');
      patchWs(code, changedTransport(rec.transport, change));
      await reconnect([code]);
      // The bridge runs its own peer for this workspace: move it to the same relays.
      const onBridge = get().bridgeState?.workspaces.find((w) => w.code === code);
      if (onBridge) get().setAgents(code, onBridge.agents);
    },
  };
});
