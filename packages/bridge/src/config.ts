import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { agentPrefs, type AgentConfig, type BridgeWorkspace, type WsTransport } from '@yurt/protocol';

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
  workspaces: (BridgeWorkspace & { creator?: string | null; transport?: WsTransport })[];
}

export interface StoredIdentity {
  phrase: string;
  name: string;
  handle: string;
}

// Origins can't carry a path, so this admits every GitHub Pages site of this user, not just /yurt.
// Accepted risk: any of them can still only reach the pairing prompt, which is rate limited and
// locks out (server.ts), and nothing else works without a paired token.
const DEFAULT_ORIGINS = ['https://kucukkanat.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173'];

function ensure() {
  for (const d of [HOME, WS_DIR, BLOB_DIR]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, v: unknown) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function loadConfig(): Config {
  ensure();
  const c = readJson<Partial<Config>>(CONFIG) || {};
  const cfg: Config = {
    adminToken: c.adminToken || crypto.randomBytes(24).toString('hex'),
    tokens: c.tokens || [],
    startOnLogin: !!c.startOnLogin,
    allowedOrigins: c.allowedOrigins ?? DEFAULT_ORIGINS, // [] is a deliberate "no web apps"
    // Agents saved before triggers/placement existed only had `replyIn`; fill the new fields from it.
    agents: (c.agents || []).map((a) => ({ ...withoutReplyIn(a), ...agentRoomPrefs(a as unknown as Record<string, unknown>) })),
    workspaces: c.workspaces || [],
  };
  writeJson(CONFIG, cfg);
  return cfg;
}

export const saveConfig = (c: Config) => writeJson(CONFIG, c);
export const loadIdentity = () => readJson<StoredIdentity>(IDENTITY);
export const saveIdentity = (i: StoredIdentity) => writeJson(IDENTITY, i);

const bools = <K extends string>(x: unknown, keys: readonly K[]): Record<K, boolean> | undefined => {
  if (typeof x !== 'object' || x === null) return undefined;
  const o = x as Record<string, unknown>;
  return keys.every((k) => typeof o[k] === 'boolean') ? (Object.fromEntries(keys.map((k) => [k, o[k] as boolean])) as Record<K, boolean>) : undefined;
};

/** An agent's room settings from untrusted or older input: older configs only had `replyIn`. */
export function agentRoomPrefs(a: Record<string, unknown>): Pick<AgentConfig, 'respondTo' | 'postIn' | 'discoverable'> {
  return agentPrefs({
    replyIn: a.replyIn === 'channel' ? 'channel' : 'thread',
    respondTo: bools(a.respondTo, ['mentions', 'replies'] as const),
    postIn: bools(a.postIn, ['thread', 'channel'] as const),
    discoverable: a.discoverable === true,
  });
}

const withoutReplyIn = (a: AgentConfig): AgentConfig => {
  const { replyIn: _old, ...rest } = a as AgentConfig & { replyIn?: unknown };
  return rest;
};
