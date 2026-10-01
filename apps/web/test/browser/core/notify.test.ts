import { afterAll, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { askNotifications, notify } from '../../../src/lib/format';

afterAll(() => commands.setPermissions([], location.origin));

describe('desktop notifications', () => {
  it('stay off until the browser grants permission', async () => {
    await commands.setPermissions([], location.origin);
    expect(await askNotifications()).toBe(false); // the prompt is dismissed in a headless browser
    expect(await notify('Ada', 'hello', 'W:1')).toBeNull();
  });

  it('show once granted, and a click runs the action and closes it', async () => {
    await commands.setPermissions(['notifications'], location.origin);
    expect(await askNotifications()).toBe(true);
    let opened = 0;
    const n = await notify('Ada', 'hello', 'W:1', () => opened++);
    expect(n).toBeInstanceOf(Notification);
    expect([n?.body, n?.tag]).toEqual(['hello', 'W:1']);
    n?.dispatchEvent(new Event('click'));
    expect(opened).toBe(1);
    const plain = await notify('Bo', 'no action', 'W:2');
    plain?.dispatchEvent(new Event('click')); // nothing to run, still closes
    expect(plain?.title).toBe('Bo');
  });
});
