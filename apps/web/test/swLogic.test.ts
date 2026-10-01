import { describe, expect, it } from 'vitest';
import { conversationUrl, isSkipWaiting, noticeDataOf, notifiesThroughWorker, openMessage, openOf } from '../src/lib/swLogic';
import { anything, fc } from './fuzz';

describe('the service worker’s decisions', () => {
  it('take over only when Workbox asks', () => {
    expect(isSkipWaiting({ type: 'SKIP_WAITING' })).toBe(true);
    expect(isSkipWaiting('skip-waiting')).toBe(false);
    fc.assert(
      fc.property(anything, (x) => {
        expect(isSkipWaiting(x)).toBe(false);
      }),
    );
  });

  it('open the conversation, in an open window or a new one', () => {
    const d = { code: 'K7QX2MPD', ch: 'dm:a:b' };
    expect(conversationUrl('https://x.example/yurt/', d)).toBe('https://x.example/yurt/#/w/K7QX2MPD/c/dm%3Aa%3Ab');
    expect(openOf(openMessage(d))).toEqual(d);
    expect(openOf({ ...openMessage(d), type: 'other' })).toBeNull();
    expect(noticeDataOf({ ...d, extra: 1 })).toEqual(d);
    expect(noticeDataOf({ code: 'K7QX2MPD' })).toBeNull();
    fc.assert(
      fc.property(anything, (x) => {
        expect(openOf(x)).toBeNull();
        expect(noticeDataOf(x)).toBeNull();
      }),
    );
  });

  it('notify through the worker only where it can show and close notifications (not Safari in a tab)', () => {
    const fn = () => undefined;
    expect(notifiesThroughWorker({ showNotification: fn, getNotifications: fn })).toBe(true);
    expect(notifiesThroughWorker({ showNotification: fn })).toBe(false);
    expect(notifiesThroughWorker({ getNotifications: fn })).toBe(false);
    expect(notifiesThroughWorker({ showNotification: fn, getNotifications: undefined })).toBe(false);
  });
});
