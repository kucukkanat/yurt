import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { safeName, saveAttachment } from '../src/files';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yurt-files-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe('agent attachments', () => {
  it('saves into .yurt/files/<msg>/<name> and returns a path relative to the agent folder', () => {
    const rel = saveAttachment(dir, 'msg1', 'report.pdf', bytes('pdf bytes'));
    expect(rel).toBe(path.join('.yurt', 'files', 'msg1', 'report.pdf'));
    expect(fs.readFileSync(path.join(dir, rel), 'utf8')).toBe('pdf bytes');
    expect(fs.statSync(path.join(dir, rel)).mode & 0o777).toBe(0o600);
  });

  it('keeps hostile names inside the folder', () => {
    for (const name of ['../../etc/passwd', '..\\..\\x.txt', '/abs/path.sh', '.bashrc', '', 'a/../../b']) {
      const rel = saveAttachment(dir, '../msg', name, bytes('x'));
      expect(rel.startsWith(path.join('.yurt', 'files') + path.sep)).toBe(true);
      expect(path.resolve(dir, rel).startsWith(path.resolve(dir, '.yurt', 'files'))).toBe(true);
    }
  });

  it('sanitizes names to plain characters', () => {
    expect(safeName('../../etc/passwd')).toBe('passwd');
    expect(safeName('.env')).toBe('_env');
    expect(safeName('a<b>|c?.txt')).toBe('a_b_c_.txt');
    expect(safeName('')).toBe('file');
    expect(safeName('x'.repeat(300))).toHaveLength(120);
  });
});
