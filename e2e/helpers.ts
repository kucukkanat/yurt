import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { HtmlValidate } from 'html-validate';

// The local relay and Blossom server started by playwright.config.ts.
export const RELAY = 'ws://127.0.0.1:7777';
export const BLOSSOM = 'http://127.0.0.1:7778';

/** Creates an identity in the onboarding flow, then either starts a workspace or joins the one in the URL. */
export async function onboard(page: Page, name: string, finish: 'Start chatting' | 'Join workspace' = 'Start chatting') {
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('I saved my recovery phrase somewhere safe').click();
  await page.getByRole('button', { name: finish }).click();
}

/**
 * Points new workspaces at the local relay and file server, through the same IndexedDB settings the create form
 * writes (`lastNet`, which prefills it). `extra` sets other settings the same way (e.g. the theme).
 */
export async function pointAtLocalRelay(page: Page, extra: Record<string, unknown> = {}) {
  await page.goto('./');
  await page.evaluate(
    ({ relays, servers, extra }) =>
      new Promise<void>((res, rej) => {
        const r = indexedDB.open('yurt', 1);
        r.onsuccess = () => {
          const t = r.result.transaction('kv', 'readwrite');
          const kv = t.objectStore('kv');
          const get = kv.get('settings');
          get.onsuccess = () => kv.put({ ...(get.result || {}), lastNet: { relays: [relays], blossom: [servers] }, ...extra }, 'settings');
          t.oncomplete = () => res();
          t.onerror = () => rej(t.error);
        };
        r.onerror = () => rej(r.error);
      }),
    { relays: RELAY, servers: BLOSSOM, extra },
  );
  await page.reload();
}

/** Creates a workspace from the onboarding/home form and waits for its #general. */
export async function createWorkspace(page: Page, name: string) {
  await page.getByLabel('Workspace name').fill(name + ' ' + Date.now());
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/#\/w\/[A-Z0-9]{8}\/c\/general/);
}

/**
 * Reads this member's invite link from the Invite dialog (making one if they have none yet), then closes it with
 * Escape (handled while focus is inside). The link lets people ask to join; an admin lets them in (see `letIn`).
 */
export async function inviteLink(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Invite people' }).first().click();
  const field = page.getByTestId('invite-link');
  await expect(field.or(page.getByTestId('invite-create'))).toBeVisible();
  if (!(await field.isVisible())) await page.getByTestId('invite-create').click();
  const link = await field.inputValue();
  await field.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return link;
}

/** `admin` lets `name`, who asked to join, in from the members panel, then closes the panel. */
export async function letIn(admin: Page, name: string) {
  const panel = admin.getByRole('complementary', { name: 'Members' });
  if (!(await panel.isVisible()))
    await admin
      .getByRole('button', { name: /^Members/ })
      .first()
      .click();
  await admin.getByTestId('join-request').filter({ hasText: name }).getByTestId('join-admit').click({ timeout: 30_000 });
  await admin.getByRole('button', { name: 'Close (Esc)' }).click();
}

/** A new person opens `link` in `page`, onboards as `name` and waits; `admin` lets them in, and they land in #general. */
export async function joinVia(admin: Page, page: Page, link: string, name: string) {
  await page.goto(link);
  await onboard(page, name, 'Join workspace');
  await expect(page.getByTestId('join-pending')).toBeVisible();
  await letIn(admin, name);
  await expect(page.getByRole('textbox', { name: 'Message #general' })).toBeVisible({ timeout: 30_000 });
}

// The rendered DOM of a single-page app, validated as HTML. Overrides only where React/SPA output can't comply:
const html = new HtmlValidate({
  extends: ['html-validate:recommended'],
  rules: {
    // Inline styles are how components apply design tokens (CSS variables); there is no stylesheet per component.
    'no-inline-style': 'off',
    // page.content() serializes the live DOM, so these follow the serializer, not our source: void elements without
    // "/>", boolean and empty attributes written as `disabled=""`, and whitespace as the browser keeps it.
    'void-style': 'off',
    'attribute-boolean-style': ['error', { style: 'empty' }],
    'attribute-empty-style': ['error', { style: 'empty' }],
    'no-trailing-whitespace': 'off',
    // React's useId makes ids like ":r1:"; HTML5 allows any id without spaces (the default enforces HTML4's rules).
    'valid-id': ['error', { relaxed: true }],
    // The ⌘K results are a typeahead listbox driven from a text field; a native <select> can't filter as you type.
    'prefer-native-element': ['error', { exclude: ['listbox'] }],
  },
});

/**
 * Fails on any accessibility violation (axe-core: WCAG 2.1 A/AA and best practices) or invalid HTML (html-validate)
 * on the page as it is right now. `label` names the screen in the failure message.
 */
export async function checkPage(page: Page, label: string) {
  // A named step, so reports and traces show which screen failed.
  await test.step('check ' + label, async () => {
    // Animations snap to their end state (the UI honours reduced motion), so contrast is measured on settled pixels.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
    // Each node with axe's own reason (e.g. the measured contrast ratio and colors), so a failure says what to change.
    const why = (n: { failureSummary?: string | undefined }) => (n.failureSummary ?? '').split('\n').slice(1).join(' ').trim();
    const a11y = axe.violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.target.join(' ') + ' — ' + why(n)).join('\n    ')}`);
    expect.soft(a11y, label + ': accessibility violations').toEqual([]);
    const report = await html.validateString(await page.content());
    const invalid = report.results.flatMap((r) => r.messages.filter((m) => m.severity === 2).map((m) => `${m.ruleId}: ${m.message} (${m.selector ?? 'line ' + m.line})`));
    expect.soft(invalid, label + ': invalid HTML').toEqual([]);
  });
}
