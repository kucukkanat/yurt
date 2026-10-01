import { describe, expect, inject, it } from 'vitest';
import { commands, type Locator } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { App } from '../../ui/src/App';
import type { FixtureBridge } from './fixtures';

// The bridge's setup page in real Chromium, against two real bridges started by global-setup.ts: a busy one (agents
// working, waiting and failing; CLIs in every state) and a fresh install. Tests in a file run in order, and later
// ones see what earlier ones changed, like a person clicking through the page.

declare module 'vitest/browser' {
  interface BrowserCommands {
    freshDown: () => Promise<void>;
    freshUp: () => Promise<void>;
  }
}

const busy = inject('busy');
const fresh = inject('fresh');
const page = (b: FixtureBridge, token = b.admin) => render(<App url={b.url} token={token} />);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Waits until the element's text matches (the built-in matchers take strings only). */
const matches = (l: Locator, re: RegExp, timeout = 5000) => expect.poll(() => l.element().textContent ?? '', { timeout }).toMatch(re);
const valueMatches = (l: Locator, re: RegExp) => expect.poll(() => (l.element() as HTMLInputElement).value).toMatch(re);

/** Sends messages as the bridge page would, on a socket of its own: setup shortcuts, not what's under test. */
async function adminSend(b: FixtureBridge, msgs: unknown[]) {
  const s = new WebSocket(b.url);
  await new Promise((r) => (s.onopen = r));
  s.send(JSON.stringify({ t: 'hello', token: b.admin }));
  for (const m of msgs) s.send(JSON.stringify(m));
  await wait(300);
  s.close();
}

describe('before the bridge answers', () => {
  it('says it is connecting, keeps retrying, and stops when closed', async () => {
    const screen = await page({ url: 'ws://127.0.0.1:9/ws', admin: 'x', web: 'x' });
    await expect.element(screen.getByText('Connecting to the bridge…')).toBeVisible();
    await matches(screen.getByTestId('bridge-status'), /Reconnecting…/);
    await matches(screen.getByTestId('nav-agents'), /^\s*Agents$/); // no counts yet
    await wait(1700); // one retry
    await screen.unmount();
  });
});

describe('a bridge that says nothing the page can use', () => {
  it('ignores it and keeps waiting for a usable state', async () => {
    const screen = await page({ url: inject('odd'), admin: 'x', web: 'x' });
    await matches(screen.getByTestId('bridge-status'), /Running on 127\.0\.0\.1/);
    await wait(300);
    await expect.element(screen.getByText('Connecting to the bridge…')).toBeVisible();
    await screen.unmount();
  });
});

describe('a fresh install', () => {
  it('asks to link an identity and install a CLI first', async () => {
    const screen = await page(fresh);
    await matches(screen.getByTestId('identity'), /Not linked yet/);
    await expect.element(screen.getByText('Pair from Yurt to link your identity')).toBeVisible();
    await matches(screen.getByTestId('pairing-code'), /^\d{3} \d{3}$/);
    await screen.getByRole('button', { name: 'Install a CLI' }).click();
    await expect.element(screen.getByRole('heading', { name: 'Agent CLIs' })).toBeVisible();
    await matches(screen.getByTestId('runtime-copilot'), /not found on PATH/);
    await screen.getByTestId('nav-agents').click();
    await expect.element(screen.getByText('No agents yet.')).toBeVisible();
    await screen.getByRole('button', { name: 'New agent' }).click();
    await expect.element(screen.getByLabelText('Agent CLI')).toHaveValue('copilot'); // nothing installed: the first CLI
    await expect.element(screen.getByText('Install it under Agent CLIs first.')).toBeVisible();
    await valueMatches(screen.getByLabelText('Working folder'), /\/fresh-user\/yurt-agents\/$/);
    await screen.getByRole('button', { name: 'Back to agents' }).click();
    await screen.getByTestId('nav-workspaces').click();
    await expect.element(screen.getByText('None yet.')).toBeVisible();
    await screen.unmount();
  });

  it('shows a paired web app its state but no pairing code or logs', async () => {
    const screen = await page(fresh, fresh.web);
    await matches(screen.getByTestId('pairing-code'), /--- ---/);
    await screen.getByTestId('nav-activity').click();
    await expect.element(screen.getByText('Quiet so far.')).toBeVisible();
    await screen.unmount();
  });

  it('keeps what is on screen while the bridge restarts, and reconnects', async () => {
    const screen = await page(fresh);
    await matches(screen.getByTestId('bridge-status'), /Running on 127\.0\.0\.1/);
    await commands.freshDown();
    await matches(screen.getByTestId('bridge-status'), /Reconnecting…/);
    await screen.getByRole('button', { name: 'New code' }).click(); // nowhere to send it: nothing happens
    await expect.element(screen.getByTestId('pairing-code')).toBeVisible();
    await commands.freshUp();
    await matches(screen.getByTestId('bridge-status'), /Running on 127\.0\.0\.1/, 10_000);
    await screen.unmount();
  });
});

describe('a busy bridge', () => {
  it('overview: identity, pairing code and counts', async () => {
    const screen = await page(busy);
    await matches(screen.getByTestId('identity'), /Olu@olu · /);
    const code = screen.getByTestId('pairing-code');
    await matches(code, /^\d{3} \d{3}$/);
    const before = code.element().textContent;
    const copy = screen.getByTestId('pairing-copy');
    await copy.click();
    await matches(copy, /Copied/);
    expect(await navigator.clipboard.readText()).toBe(before?.replace(' ', ''));
    await screen.getByRole('button', { name: 'New code' }).click();
    await expect.poll(() => code.element().textContent).not.toBe(before);
    await matches(copy, /Copy$/); // a new code hasn't been copied yet
    await screen.getByRole('button', { name: 'Open Yurt' }).click();
    await expect.element(screen.getByRole('button', { name: /3\/5\s*agent CLIs installed/ })).toBeVisible();
    await matches(screen.getByTestId('nav-runtimes'), /Agent CLIs3/);
    await screen.getByRole('button', { name: /5\s*agents/ }).click();
    await expect.element(screen.getByRole('heading', { name: 'Agents' })).toBeVisible();
    await screen.getByTestId('nav-overview').click();
    await screen.getByRole('button', { name: /agent CLIs installed/ }).click();
    await expect.element(screen.getByRole('heading', { name: 'Agent CLIs' })).toBeVisible();
    await screen.unmount();
  });

  it('agent CLIs: every state, and installing, signing in and checking', async () => {
    const screen = await page(busy);
    await screen.getByTestId('nav-runtimes').click();
    const row = (id: string) => screen.getByTestId('runtime-' + id);
    await matches(row('copilot'), /v9\.9\.9.*Ready/);
    await matches(row('opencode'), /Sign in needed/);
    await matches(row('pi'), /installed.*Unchecked/);
    await matches(row('codex'), /not found on PATH.*Not installed/);
    await row('codex').getByRole('button', { name: 'Install' }).click();
    await matches(row('codex'), /Installing/);
    await matches(row('codex'), /Not installed/, 10_000); // npm failed
    await row('opencode').getByRole('button', { name: 'Sign in' }).click();
    await matches(row('opencode'), /Signing in/);
    await matches(row('opencode'), /Sign in needed/, 10_000);
    await row('copilot').getByRole('button', { name: 'Check again' }).click();
    await matches(row('copilot'), /Checking/);
    await matches(row('copilot'), /Ready/, 10_000);
    await screen.unmount();
  });

  it('agents: what each is doing and where', async () => {
    const screen = await page(busy);
    await screen.getByTestId('nav-agents').click();
    await matches(screen.getByTestId('agent-harper'), /Harper @harper.*Working.*1 workspace/);
    await matches(screen.getByTestId('agent-gatekeeper'), /Needs you/);
    await matches(screen.getByTestId('agent-locksmith'), /Error/);
    await matches(screen.getByTestId('agent-idler'), /GitHub Copilot CLI · gpt-x · .*2 workspaces/);
    await matches(screen.getByTestId('agent-lonely'), /Not in a workspace/);
    const online = screen.getByTestId('agent-online-lonely');
    await expect.element(online).toBeChecked();
    await online.click();
    await expect.element(online).not.toBeChecked();
    await expect.element(screen.getByText('Offline')).toBeVisible();
    await online.click();
    await expect.element(online).toBeChecked();
    await screen.unmount();
  });

  it('editing an agent saves and returns to the list; back and cancel leave it unchanged', async () => {
    const screen = await page(busy);
    await screen.getByTestId('nav-agents').click();
    await screen.getByTestId('agent-idler').click();
    await expect.element(screen.getByRole('heading', { name: 'Idler' })).toBeVisible();
    await screen.getByRole('button', { name: 'Back to agents' }).click();
    await screen.getByTestId('agent-idler').click();
    await screen.getByRole('button', { name: 'Cancel' }).click();
    await screen.getByTestId('agent-idler').click();
    await expect.element(screen.getByLabelText('Handle')).toHaveValue('idler');
    await screen.getByLabelText('Name').fill('Idler'); // an existing agent keeps its handle when renamed
    await screen.getByLabelText('Instructions').fill('Answer in one line.');
    await screen.getByTestId('agent-save').click();
    await expect.element(screen.getByRole('heading', { name: 'Agents' })).toBeVisible();
    await screen.unmount();
  });

  it('creating an agent: the form fills itself in, explains every choice, and reports a refusal', async () => {
    const screen = await page(busy);
    await screen.getByTestId('nav-agents').click();
    await screen.getByRole('button', { name: 'New agent' }).click();
    const name = screen.getByLabelText('Name');
    const handle = screen.getByLabelText('Handle');
    const folder = screen.getByLabelText('Working folder');
    const save = screen.getByTestId('agent-save');
    await expect.element(save).toBeDisabled();
    await name.fill('Scout Bot');
    await expect.element(handle).toHaveValue('scout-bot');
    await valueMatches(folder, /\/yurt-agents\/scout-bot$/);
    await name.fill('Scout Bot Two');
    await valueMatches(folder, /\/yurt-agents\/scout-bot-two$/);
    await handle.fill('Idler!'); // taken: the bridge will refuse it
    await name.fill('Scout');
    await expect.element(handle).toHaveValue('idler'); // typed handles stay put
    await folder.fill('/tmp/yurt-ui-agent-scout');
    await name.fill('Scout X');
    await expect.element(folder).toHaveValue('/tmp/yurt-ui-agent-scout'); // so does a chosen folder

    const cli = screen.getByLabelText('Agent CLI');
    await cli.selectOptions('opencode');
    await expect.element(screen.getByText('Needs sign-in under Agent CLIs.')).toBeVisible();
    await cli.selectOptions('codex');
    await expect.element(screen.getByText('Install it under Agent CLIs first.')).toBeVisible();
    await cli.selectOptions('copilot');
    await screen.getByLabelText(/^Model/).fill('gpt-test');
    await screen.getByLabelText('Instructions').fill('Scout things.');

    await screen.getByTestId('respond-mentions').click();
    await screen.getByTestId('respond-replies').click();
    await screen.getByTestId('post-channel').click();
    await expect.element(screen.getByText('Answers in the thread and also shows the answer in the channel.')).toBeVisible();
    await screen.getByTestId('post-thread').click();
    await expect.element(screen.getByText('Answers in the channel (or inside a thread when asked there).')).toBeVisible();
    await screen.getByTestId('post-channel').click();
    await expect.element(screen.getByText('Pick at least one.')).toBeVisible();
    await expect.element(save).toBeDisabled();
    await screen.getByTestId('post-thread').click();
    await expect.element(screen.getByText('Answers in a thread under the message.')).toBeVisible();
    await screen.getByTestId('agent-discoverable').click();
    await screen.getByLabelText('Context').fill('5');
    const all = screen.getByTestId('auto-approve-all');
    await all.click();
    await expect.element(screen.getByRole('checkbox', { name: /Run commands/ })).toBeChecked();
    await all.click();
    await expect.element(screen.getByRole('checkbox', { name: /Read files/ })).not.toBeChecked();
    await screen.getByRole('checkbox', { name: /Run commands/ }).click();
    await screen.getByRole('checkbox', { name: /Read files/ }).click();
    await screen.getByRole('checkbox', { name: /Read files/ }).click();
    await expect.element(all).not.toBeChecked();

    await save.click();
    await matches(screen.getByTestId('error-toast'), /Another agent already uses @idler/);
    await screen.getByRole('button', { name: 'Dismiss' }).click();
    await expect.element(screen.getByTestId('error-toast')).not.toBeInTheDocument();
    await handle.fill('scout');
    await save.click();
    // A new agent's id is its handle plus a random suffix.
    await matches(screen.getByRole('button', { name: /Scout X/ }), /Scout X @scout.*gpt-test/);
    await screen.unmount();
  });

  it('deleting an agent asks first', async () => {
    const screen = await page(busy);
    await screen.getByTestId('nav-agents').click();
    await screen.getByTestId('agent-lonely').click();
    await screen.getByRole('button', { name: 'Delete', exact: true }).click();
    await screen.getByRole('button', { name: 'Delete Lonely everywhere' }).click();
    await expect.element(screen.getByTestId('agent-lonely')).not.toBeInTheDocument();
    await screen.unmount();
  });

  it('workspaces: which agents sit in each, and leaving one', async () => {
    const screen = await page(busy);
    await screen.getByTestId('nav-workspaces').click();
    const busyWs = screen.getByTestId('workspace-BUSYWSPC');
    await matches(busyWs, /Busy.*BUSY-WSPC · \d+ peers/);
    const harper = busyWs.getByRole('checkbox', { name: 'Harper' });
    await expect.element(harper).toBeChecked();
    await harper.click();
    await expect.element(harper).not.toBeChecked();
    await harper.click();
    await expect.element(harper).toBeChecked();
    await screen.getByTestId('workspace-SPAREWSP').getByRole('button', { name: 'Leave' }).click();
    await expect.element(screen.getByTestId('workspace-SPAREWSP')).not.toBeInTheDocument();
    await screen.unmount();
  });

  it('activity: what happened, by level, with ACP traffic on request', async () => {
    const screen = await page(busy);
    await screen.getByTestId('nav-activity').click();
    const log = screen.getByTestId('activity');
    await expect.element(log.getByTestId('log-info').first()).toBeVisible();
    await expect.element(log.getByTestId('log-warn').first()).toBeVisible();
    await expect.element(log.getByTestId('log-error').first()).toBeVisible();
    await expect.element(log.getByTestId('log-acp').first()).not.toBeInTheDocument();
    await screen.getByRole('switch', { name: 'Show ACP traffic' }).click();
    await expect.element(log.getByTestId('log-acp').first()).toBeVisible();
    await screen.unmount();
  });

  it('settings: start on login, and which web apps may connect', async () => {
    const screen = await page(busy);
    await screen.getByTestId('nav-settings').click();
    // This bridge runs from source (tsx): there's no stable command to start at login, so the bridge refuses and says why.
    const onLogin = screen.getByRole('switch', { name: 'Start when I log in' });
    await expect.element(onLogin).toHaveAttribute('aria-checked', 'false');
    await onLogin.click();
    await screen.getByTestId('nav-activity').click();
    await matches(screen.getByTestId('activity'), /start on login failed: start on login needs the built bridge/);
    await screen.getByTestId('nav-settings').click();
    await expect.element(onLogin).toHaveAttribute('aria-checked', 'false');
    const origins = screen.getByRole('textbox');
    await origins.fill(`${(origins.element() as HTMLTextAreaElement).value}\nhttps://yurt.example.com/`);
    await screen.getByRole('button', { name: 'Save origins' }).click();
    await wait(300);
    await screen.getByTestId('nav-overview').click();
    await screen.getByTestId('nav-settings').click(); // a fresh view shows what the bridge kept
    await valueMatches(screen.getByRole('textbox'), /\nhttps:\/\/yurt\.example\.com$/);
    await screen.unmount();
  });

  it('with no agents left, suggests creating one', async () => {
    await adminSend(
      busy,
      ['harper', 'gatekeeper', 'locksmith', 'idler'].map((id) => ({ t: 'agent.remove', id })),
    );
    const screen = await page(busy);
    await screen.getByTestId('nav-agents').click();
    await screen.getByRole('button', { name: /Scout X/ }).click();
    await screen.getByRole('button', { name: 'Delete', exact: true }).click();
    await screen.getByRole('button', { name: 'Delete Scout X everywhere' }).click();
    await screen.getByTestId('nav-overview').click();
    await expect.element(screen.getByText(/Create your first agent/)).toBeVisible();
    await screen.getByRole('button', { name: 'New agent' }).click();
    await expect.element(screen.getByRole('heading', { name: 'Agents' })).toBeVisible();
    await screen.unmount();
  });
});
