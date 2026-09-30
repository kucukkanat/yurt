import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { AgentConfig, BridgeWorkspace, WsTransport } from '@yurt/protocol';

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

export interface StoredIdentity { phrase: string; name: string; handle: string }

export const DEFAULT_ORIGINS = ['https://kucukkanat.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173'];

function ensure() {
  for (const d of [HOME, WS_DIR, BLOB_DIR]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
}

function readJson<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return null; }
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
    allowedOrigins: c.allowedOrigins?.length ? c.allowedOrigins : DEFAULT_ORIGINS,
    agents: c.agents || [],
    workspaces: c.workspaces || [],
  };
  writeJson(CONFIG, cfg);
  return cfg;
}

export const saveConfig = (c: Config) => writeJson(CONFIG, c);
export const loadIdentity = () => readJson<StoredIdentity>(IDENTITY);
export const saveIdentity = (i: StoredIdentity) => writeJson(IDENTITY, i);
