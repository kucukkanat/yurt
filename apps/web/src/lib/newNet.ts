import * as v from 'valibot';
import { DEFAULT_RELAYS, parseRelays, parseServers } from '@yurt/protocol';

/** What a new workspace starts with: its relays travel in the invite link; file servers stay on this device. */
export interface NewWorkspaceNet {
  relays: string[];
  blossom: string[];
}

const strings = v.array(v.string());
/** A stored `lastNet`; anything malformed is dropped, so the built-ins apply. */
export const LastNetSchema = v.fallback(v.optional(v.object({ relays: strings, blossom: strings })), undefined);

/** The create form's free text. */
export interface NetForm {
  relays: string;
  blossom: string;
}

/** No relays listed means the built-in ones; file servers may stay empty (the defaults apply at upload). */
export function netFromForm(f: NetForm): NewWorkspaceNet {
  const relays = parseRelays(f.relays);
  return { relays: relays.length ? relays : [...DEFAULT_RELAYS], blossom: parseServers(f.blossom) };
}

/** The form prefill: what the last new workspace used, else the built-ins. */
export const defaultNewNet = (last: NewWorkspaceNet | undefined): NewWorkspaceNet =>
  netFromForm({ relays: last?.relays.join(', ') ?? '', blossom: last?.blossom.join(', ') ?? '' });
