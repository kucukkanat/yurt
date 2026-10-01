import { EDIT_WINDOW_MS } from '@yurt/protocol';

/** Milliseconds left to edit or delete a message sent at `ts` (0 once the window has passed). */
export const editLeft = (ts: number, now: number): number => Math.min(EDIT_WINDOW_MS, Math.max(0, EDIT_WINDOW_MS - (now - ts)));

export function editLeftLabel(ms: number): string {
  if (ms <= 0) return 'editing closed';
  const min = Math.ceil(ms / 60_000);
  return ms < 60_000 ? 'less than a minute left' : min + ' min left';
}

const minutes = Math.round(EDIT_WINDOW_MS / 60_000);
export const EDIT_CLOSED = {
  title: 'This message can’t be changed anymore',
  description: `Messages can be edited or deleted for ${minutes} minutes after sending. You can post a correction in its thread instead.`,
};
