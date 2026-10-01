/*
 * When a direct message rings: someone starts (or is in) a huddle in a DM with me that I'm not in. Pure, so the rules
 * are tested without sound; lib/ringer.ts plays it.
 */

/** A huddle in a DM with me, and who's in it. */
export interface Call {
  code: string;
  ch: string;
  from: string;
}

/** How long a call rings before it gives up: long enough to notice, short enough not to nag. */
export const RING_MS = 30_000;

export const callKey = (c: { code: string; ch: string }) => c.code + '/' + c.ch;

/** The DM huddles in a workspace that include me, from who is in which huddle (one call per DM). */
export function dmCalls(code: string, me: string, huddles: Iterable<{ pub: string; ch: string | null }>): Call[] {
  const calls = new Map<string, Call>();
  for (const { pub, ch } of huddles) {
    if (!ch?.startsWith('dm:') || pub === me) continue;
    const pair = ch.slice(3).split(':');
    if (pair.includes(me) && pair.includes(pub) && !calls.has(ch)) calls.set(ch, { code, ch, from: pub });
  }
  return [...calls.values()];
}

/** The call ringing now, since when, and the calls that already rang (answered, silenced or rung out). */
export interface RingState {
  ringing: Call | null;
  since: number;
  heard: ReadonlySet<string>;
}

export const QUIET: RingState = { ringing: null, since: 0, heard: new Set() };

/**
 * What rings given the calls going on now and the one I'm in (`joined`, a call key). A call rings once: it's heard
 * after I join it, silence it or let it ring out, and stays heard while it lasts. Only a call that ended and started
 * again rings again.
 */
export function nextRing(s: RingState, calls: readonly Call[], joined: string | null, now: number): RingState {
  const live = new Set(calls.map(callKey));
  const heard = new Set([...s.heard].filter((k) => live.has(k)));
  if (joined) heard.add(joined);
  const current = s.ringing && callKey(s.ringing);
  if (current && live.has(current)) {
    if (!heard.has(current) && now - s.since < RING_MS) return { ringing: s.ringing, since: s.since, heard };
    heard.add(current); // answered or rung out
  }
  const next = calls.find((c) => !heard.has(callKey(c)));
  return next ? { ringing: next, since: now, heard } : { ringing: null, since: 0, heard };
}

/** Stops the ringing call; it doesn't ring again while it lasts. */
export const silence = (s: RingState): RingState => (s.ringing ? { ringing: null, since: 0, heard: new Set([...s.heard, callKey(s.ringing)]) } : s);
