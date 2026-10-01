import fs from 'node:fs';
import path from 'node:path';

/** Where attachments land inside an agent's working folder. */
const FILES_DIR = path.join('.yurt', 'files');

/** A name that can't leave its folder: no separators, no leading dots, only plain characters. */
export function safeName(name: string): string {
  const base = path
    .basename(name.replace(/\\/g, '/'))
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 120);
  return base || 'file';
}

/**
 * Writes an attachment to `<workdir>/.yurt/files/<msgId>/<name>` and returns that path relative
 * to `workdir`, which is how the agent is told about it.
 */
export function saveAttachment(workdir: string, msgId: string, name: string, bytes: ArrayBuffer): string {
  const root = path.resolve(workdir, FILES_DIR);
  // Both parts are single plain names (no separators, no leading dots), so this stays inside root;
  // test/fuzz.test.ts checks that for arbitrary names.
  const file = path.join(root, safeName(msgId), safeName(name));
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, Buffer.from(bytes), { mode: 0o600 });
  return path.relative(path.resolve(workdir), file);
}
