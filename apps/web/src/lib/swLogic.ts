import * as v from 'valibot';
import { parseOr } from '@yurt/protocol';
import { buildHash } from './route';

/**
 * The service worker's decisions, kept pure so they're tested without a worker (src/sw.ts only wires them to events).
 */

/** What every notification carries, so a click knows where to go. */
export interface NoticeData {
  code: string;
  ch: string;
}

/** Workbox's request to take over now (`messageSkipWaiting()`, when the user accepts "Reload" on a new version). */
export const isSkipWaiting = (m: unknown) => !!parseOr(v.object({ type: v.literal('SKIP_WAITING') }), m);

/** The address that opens a notification's conversation, under the app's own scope. */
export const conversationUrl = (scope: string, d: NoticeData) => scope + buildHash({ code: d.code, ch: d.ch });

/** The message the worker posts to an open window to show a conversation; `openOf` reads it back there. */
const OPEN = 'yurt:open';
export const openMessage = (d: NoticeData) => ({ type: OPEN, code: d.code, ch: d.ch });
const OpenSchema = v.object({ type: v.literal(OPEN), code: v.pipe(v.string(), v.nonEmpty()), ch: v.pipe(v.string(), v.nonEmpty()) });
export const openOf = (m: unknown): NoticeData | null => {
  const o = parseOr(OpenSchema, m);
  return o && { code: o.code, ch: o.ch };
};
/** A notification's data, as stored by the app or the worker (both use NoticeData). */
export const noticeDataOf = (d: unknown): NoticeData | null => {
  const o = parseOr(v.object({ code: v.pipe(v.string(), v.nonEmpty()), ch: v.pipe(v.string(), v.nonEmpty()) }), d);
  return o && { code: o.code, ch: o.ch };
};
