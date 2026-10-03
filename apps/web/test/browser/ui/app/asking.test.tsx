import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { formatCode, joinHash, keyFromPhrase, newInviteCode, newNostrTransport, newRecoveryPhrase, newWorkspaceKey, type JoinInvite } from '@yurt/protocol';
import { kv } from '../../../../src/lib/db';
import { expectText, member, relayUrl, startApp, until, useApp } from '../app';

const phrase = newRecoveryPhrase();
const ada = keyFromPhrase(phrase);

/** Bo's workspace, with an open invite link: what Ada asks to join with. */
async function bosPlace(name: string) {
  const code = newInviteCode();
  const transport = newNostrTransport([relayUrl()]);
  const bo = await member(code, 'Bo', undefined, { transport, creator: null });
  bo.publish({ t: 'ws.create', b: { name } });
  bo.publish({ t: 'ch.create', b: { id: 'general', name: 'general' } });
  const jk = newWorkspaceKey();
  bo.publish({ t: 'invite', b: { jk, on: true } });
  const invite: JoinInvite = { code, join: jk, relays: transport.relays, creator: bo.who.pub };
  return { bo, code, invite };
}
const asked = (bo: Awaited<ReturnType<typeof bosPlace>>['bo']) => until(() => bo.joinRequests.some((r) => r.pub === ada.pub), 20_000, 'Bo sees Ada asking');

describe('asking to join', () => {
  it('keeps waiting across a restart, and goes in once an admin lets me in', async () => {
    const first = await bosPlace('First');
    await startApp({
      seed: async () => {
        await kv.set('identity', { ...ada, phrase, name: 'Ada', handle: 'ada' });
        await kv.set('joins', [first.invite]);
      },
    });
    expect({ me: useApp.getState().identity?.pub, joins: useApp.getState().joins.length }).toEqual({ me: ada.pub, joins: 1 });
    await expectText(page.getByTestId('join-pending'), new RegExp('Asked to join ' + formatCode(first.code) + '.*Waiting for an admin to let you in'));
    await asked(first.bo);
    first.bo.admit(ada.pub, true);
    await until(() => useApp.getState().route.ch === 'general', 20_000, 'in #general');
    expect(useApp.getState().joins).toEqual([]);
    // The same link again just opens it.
    await useApp.getState().joinWorkspace(joinHash(first.invite));
    expect(useApp.getState().route.code).toBe(first.code);
    // Not an admin here: no key rotation, and members can still make links.
    expect(useApp.getState().rotateKey(first.code)).toBe(false);
    await expect.element(page.getByText('Only admins can rotate the workspace key.')).toBeVisible();
    useApp.getState().openSettings('ws-general');
    await expect.element(page.getByTestId('invite-create')).toBeVisible();
    await expect.element(page.getByTestId('rotate-key')).not.toBeInTheDocument();
    useApp.getState().setDialog(null);
  });

  it('waits on the home page, and can stop waiting', async () => {
    const second = await bosPlace('Second');
    location.hash = joinHash(second.invite);
    await until(() => useApp.getState().joins.length === 1, 10_000, 'asking');
    await until(() => !useApp.getState().route.code, 10_000, 'home');
    expect(location.hash).not.toContain('/j/');
    // Back to it in the app: still waiting, so home again. Asking twice changes nothing.
    useApp.getState().go({ code: second.code });
    await until(() => !useApp.getState().route.code, 10_000, 'home again');
    expect(await useApp.getState().joinWorkspace(joinHash(second.invite))).toBe(true);
    expect(useApp.getState().joins).toHaveLength(1);
    await page.getByTestId('join-cancel').click();
    await expect.element(page.getByTestId('join-pending')).not.toBeInTheDocument();
    expect(await kv.get('joins')).toEqual([]);
  });

  it('says so when let in while I’m elsewhere', async () => {
    const third = await bosPlace('Third');
    await useApp.getState().joinWorkspace(joinHash(third.invite));
    const elsewhere = useApp.getState().workspaces[0]?.code ?? '';
    useApp.getState().go({ code: elsewhere });
    await asked(third.bo);
    third.bo.admit(ada.pub, true);
    await expect.element(page.getByTestId('join-granted')).toBeVisible();
    expect(useApp.getState().route.code).toBe(elsewhere);
    await page.getByTestId('join-granted').getByRole('button', { name: 'Open' }).click();
    await until(() => useApp.getState().route.code === third.code, 10_000, 'opened');
  });
});
