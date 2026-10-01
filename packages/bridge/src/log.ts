import type { FromBridge } from '@yurt/protocol';

type Entry = Extract<FromBridge, { t: 'log' }>;
const ring: Entry[] = [];
const subs = new Set<(e: Entry) => void>();

export function log(level: Entry['level'], src: string, msg: string) {
  const e: Entry = { t: 'log', at: Date.now(), level, src, msg: msg.length > 4000 ? msg.slice(0, 4000) + '…' : msg };
  ring.push(e);
  if (ring.length > 500) ring.shift();
  if (level !== 'acp') {
    const line = `[${new Date(e.at).toLocaleTimeString()}] ${src}: ${msg}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }
  for (const f of subs) f(e);
}

export const recentLogs = () => ring.slice(-200);
export const onLog = (f: (e: Entry) => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
