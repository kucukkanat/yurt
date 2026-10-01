import { slug, type AgentConfig } from '@yurt/protocol';

/** A handle as the editor builds it while typing: lowercase letters, digits and single dashes, at most 24. */
export const autoHandle = (n: string) =>
  n
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);

/** Whether the editor may submit `a`: the same checks the bridge makes (src/config.ts sanitize), so it won't refuse it. */
export const canSave = (a: AgentConfig) => !!a.name.trim() && !!slug(a.handle).slice(0, 24) && ABSOLUTE.test(a.workdir) && (a.postIn.thread || a.postIn.channel);

/** A full path on macOS/Linux (/…) or Windows (C:\… or \\server\…), as path.isAbsolute accepts it on each. */
const ABSOLUTE = /^(\/|[A-Za-z]:[\\/]|\\\\)/;

/**
 * True once the bridge's state holds `a` as `agent.save` normalizes it (src/config.ts sanitize); a new agent must be
 * new. test/fuzz.test.ts checks this agrees with sanitize for every agent canSave lets through.
 */
export const isSaved = (a: AgentConfig, x: AgentConfig, before: readonly string[]) =>
  (a.id ? x.id === a.id : !before.includes(x.id)) &&
  x.handle === slug(a.handle).slice(0, 24) &&
  x.name === a.name.trim().slice(0, 40) &&
  x.runtime === a.runtime &&
  x.instructions === a.instructions.slice(0, 8000) &&
  x.respondTo.mentions === a.respondTo.mentions &&
  x.respondTo.replies === a.respondTo.replies &&
  x.postIn.thread === a.postIn.thread &&
  x.postIn.channel === a.postIn.channel &&
  x.discoverable === a.discoverable &&
  [...x.autoApprove].sort().join() === [...a.autoApprove].sort().join();
