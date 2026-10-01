import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as v from 'valibot';
import { agentPrefs, parseOr, slug, type AgentConfig, type BridgeWorkspace, type WsTransport } from '@yurt/protocol';
import { compact } from './compact';
import { log } from './log';
import { errorMessage } from './util';
import { AgentDraftSchema, ConfigFileSchema, IdentityFileSchema, RUNTIME_ID_LIST, type AgentDraft, type StoredIdentity } from './schemas';

export type { StoredIdentity } from './schemas';

export const HOME = process.env.YURT_HOME || path.join(os.homedir(), '.yurt');
export const WS_DIR = path.join(HOME, 'workspaces');
export const BLOB_DIR = path.join(HOME, 'blobs');
const CONFIG = path.join(HOME, 'config.json');
const IDENTITY = path.join(HOME, 'identity.json');

export interface Config {
  adminToken: string;
  tokens: string[];
  startOnLogin: boolean;
  allowedOrigins: string[];
  agents: AgentConfig[];
  // A Nostr transport holds the workspace key; config.json is written 0600 for that reason (and the phrase).
  workspaces: (BridgeWorkspace & { creator?: string | null; transport: WsTransport })[];
}

// Origins can't carry a path, so this admits every GitHub Pages site of this user, not just /yurt.
// Accepted risk: any of them can still only reach the pairing prompt, which is rate limited and
// locks out (server.ts), and nothing else works without a paired token.
const DEFAULT_ORIGINS = ['https://kucukkanat.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173'];

function ensure() {
  for (const d of [HOME, WS_DIR, BLOB_DIR]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
}

/** A file's JSON, or undefined when it's missing or not JSON (the schemas then fall back to defaults). */
function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function writeJson(file: string, value: unknown) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Stored agents go through the same checks as saved ones; one the bridge can't run is dropped with a warning. */
function storedAgent(raw: Record<string, unknown>): AgentConfig[] {
  try {
    return [sanitize(raw)];
  } catch (e) {
    log('warn', 'bridge', `dropped an agent from config.json (${errorMessage(e)}): ${JSON.stringify(raw).slice(0, 200)}`);
    return [];
  }
}

export function loadConfig(): Config {
  ensure();
  const c = v.parse(ConfigFileSchema, readJson(CONFIG));
  const cfg: Config = {
    adminToken: c.adminToken ?? crypto.randomBytes(24).toString('hex'),
    tokens: c.tokens,
    startOnLogin: c.startOnLogin,
    allowedOrigins: c.allowedOrigins ?? DEFAULT_ORIGINS,
    // Agents saved before triggers/placement existed only had `replyIn`; sanitize fills the new fields from it.
    agents: c.agents.flatMap(storedAgent),
    workspaces: c.workspaces.map((w) => compact(w)),
  };
  writeJson(CONFIG, cfg);
  return cfg;
}

export const saveConfig = (c: Config) => writeJson(CONFIG, c);
export const loadIdentity = (): StoredIdentity | null => parseOr(IdentityFileSchema, readJson(IDENTITY));
export const saveIdentity = (i: StoredIdentity) => writeJson(IDENTITY, i);

/** An agent's room settings from untrusted or older input: older configs only had `replyIn`. */
const agentRoomPrefs = (a: AgentDraft): Pick<AgentConfig, 'respondTo' | 'postIn' | 'discoverable'> =>
  agentPrefs(compact({ replyIn: a.replyIn ?? ('thread' as const), respondTo: a.respondTo, postIn: a.postIn, discoverable: a.discoverable === true }));

/** Validates an agent from the (paired, but still untrusted) UI or from config.json, and migrates older shapes. */
export function sanitize(raw: unknown): AgentConfig {
  const a = parseOr(AgentDraftSchema, raw);
  if (!a) throw new Error('Invalid agent');
  if (!v.is(v.picklist(RUNTIME_ID_LIST), a.runtime)) throw new Error('Unknown runtime');
  const name = a.name.trim().slice(0, 40);
  if (!name) throw new Error('Give the agent a name');
  const handle = slug(a.handle || name).slice(0, 24);
  if (!handle) throw new Error('Give the agent a handle');
  if (!path.isAbsolute(a.workdir)) throw new Error('Pick a folder with a full path');
  if (a.postIn && !a.postIn.thread && !a.postIn.channel) throw new Error('Pick where the agent posts: in a thread, in the channel, or both');
  return {
    id: a.id || handle + '-' + crypto.randomBytes(2).toString('hex'),
    name,
    handle,
    runtime: a.runtime,
    ...compact({ model: a.model?.trim() || undefined }),
    workdir: path.resolve(a.workdir),
    instructions: a.instructions.slice(0, 8000),
    autoApprove: a.autoApprove,
    contextSize: Math.max(1, Math.min(200, Math.round(Number(a.contextSize) || 20))),
    ...agentRoomPrefs(a),
    online: a.online !== false, // configs from before the switch had no field: they were online
  };
}
