import '../styles';
import {
  AgentActivity,
  AgentStep,
  ApprovalCard,
  Avatar,
  ChatMessage,
  ConnectionBanner,
  DaemonStatus,
  DayDivider,
  initials,
  MemberRow,
  Mention,
  MentionText,
  PresenceDot,
  TypingIndicator,
  UnreadDivider,
} from '@yurt/ui';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

describe('Avatar and PresenceDot', () => {
  it('speaks who it is: agents with owners, you, presence', async () => {
    const s = await render(
      <>
        <Avatar name="Scout" kind="agent" owner={{ name: 'Ada', self: false }} presence="online" working />
        <Avatar name="Rex" kind="agent" presence="offline" />
        <Avatar name="Ada Lovelace" self presence="away" />
        <Avatar name="Bo" />
        <Avatar name="" kind="agent" decorative />
      </>,
    );
    await expect.element(s.getByRole('img', { name: 'Scout, agent owned by Ada, online' })).toBeVisible();
    await expect.element(s.getByRole('img', { name: 'Rex, agent, offline' })).toBeVisible();
    await expect.element(s.getByRole('img', { name: 'Ada Lovelace (you), away' })).toBeVisible();
    await expect.element(s.getByRole('img', { name: 'Bo', exact: true })).toBeVisible();
    expect(initials('  grace brewster hopper ')).toBe('GB');
    // @ts-expect-error: the JS default for a missing name
    expect(initials()).toBe('');
  });

  it('draws every presence, falling back to offline', async () => {
    const s = await render(
      <>
        <PresenceDot />
        <PresenceDot status="away" cutout="" />
        <PresenceDot status="offline" />
        {/* @ts-expect-error: unknown status */}
        <PresenceDot status="bogus" />
      </>,
    );
    await expect.element(s.getByRole('img', { name: 'Online' })).toBeVisible();
    await expect.element(s.getByRole('img', { name: 'Away' })).toBeVisible();
    expect(s.getByRole('img', { name: 'Offline' }).elements()).toHaveLength(2);
  });
});

describe('Mention', () => {
  it('renders room, self, agent and human chips, clickable when handled', async () => {
    const onMention = vi.fn();
    const members = [
      { id: 'me', handle: 'ada', kind: 'human' as const },
      { id: 'bot', handle: 'Scout', kind: 'agent' as const },
      { id: 'x', kind: 'human' as const },
    ];
    const s = await render(
      // @ts-expect-error: a member without a handle (from a JS caller) is never matched
      <MentionText text="hi @room @here @ada @scout @nobody and @" members={members} meId="me" onMention={onMention} />,
    );
    await s.getByRole('button', { name: '@Scout' }).hover();
    await s.getByRole('button', { name: '@Scout' }).click();
    expect(onMention).toHaveBeenCalledWith(members[1]);
    await userEvent.unhover(s.getByRole('button', { name: '@Scout' }));
    await expect.element(s.getByText(/@nobody/)).toBeVisible();
    const plain = await render(
      <>
        {/* @ts-expect-error: a member without a handle (from a JS caller) is never matched */}
        <MentionText text="plain @ada" members={members} />
        {/* @ts-expect-error: JS defaults for missing text and members */}
        <MentionText />
        <Mention handle="x" kind={'odd' as 'human'} />
        <Mention handle="plain" />
      </>,
    );
    await plain.getByText('@ada').first().hover();
    expect(plain.container.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('MemberRow', () => {
  it('describes agents, owners and presence, and highlights on hover when clickable', async () => {
    const onClick = vi.fn();
    const s = await render(
      <>
        <MemberRow member={{ name: 'Scout', handle: 'scout', kind: 'agent', owner: { name: 'Ada', self: false } }} onClick={onClick} />
        <MemberRow member={{ name: 'Mine', handle: 'mine', kind: 'agent', owner: { name: 'Me', self: true } }} active />
        <MemberRow member={{ name: 'Lone', handle: 'lone', kind: 'agent' }} />
        <MemberRow member={{ name: 'Away', handle: 'aw', presence: 'away' }} />
        <MemberRow member={{ name: 'Gone', handle: 'go', presence: 'offline' }} trailing={<span>t</span>} />
        <MemberRow member={{ name: 'Me', handle: 'me', presence: 'online', self: true }} meta="custom" />
      </>,
    );
    const row = s.getByRole('button', { name: /Scout/ });
    await row.hover();
    await row.click();
    expect(onClick).toHaveBeenCalled();
    await userEvent.unhover(row);
    for (const t of ["Ada's agent", 'Yours', 'Agent', 'Away', 'Offline', 'custom']) await expect.element(s.getByText(t, { exact: true }).first()).toBeVisible();
    await s.getByText('Lone').hover();
  });
});

describe('AgentStep and AgentActivity', () => {
  it('shows each status and expands its details', async () => {
    const s = await render(
      <>
        {(['queued', 'running', 'done', 'waiting', 'error', 'skipped'] as const).map((st) => (
          <AgentStep key={st} status={st} title={'Step ' + st} detail={'about ' + st} tool="edit" meta="1.2s" />
        ))}
        {/* @ts-expect-error: unknown status falls back to done */}
        <AgentStep status="bogus" title="Odd" last />
        <AgentStep title="With details" defaultOpen>
          <p>inner</p>
        </AgentStep>
      </>,
    );
    await expect.element(s.getByText('— Needs you')).toBeInTheDocument();
    const exp = s.getByRole('button', { name: /With details/ });
    await expect.element(exp).toHaveAttribute('aria-expanded', 'true');
    await exp.click();
    await expect.element(exp).toHaveAttribute('aria-expanded', 'false');
    await userEvent.tab();
    await expect.element(s.getByRole('button', { name: /Step done/ })).toBeDisabled();
  });

  it('opens a run trace and summarizes it', async () => {
    const steps = [
      { title: 'Read', status: 'done' as const },
      { title: 'Write', status: 'running' as const },
    ];
    const s = await render(
      <>
        <AgentActivity steps={steps} meta="3s" running />
        <AgentActivity summary="2 steps" steps={steps} defaultOpen />
      </>,
    );
    const toggle = s.getByRole('button', { name: /2 steps/ }).first();
    await toggle.hover();
    await toggle.click();
    await expect.element(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.unhover(toggle);
    const empty = await render(<AgentActivity />);
    await expect.element(empty.getByRole('button', { name: /0 steps/ })).toBeVisible();
  });
});

describe('ApprovalCard', () => {
  it('approves with mod+Enter, declines with Escape, and offers edit', async () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const onEdit = vi.fn();
    const s = await render(
      <ApprovalCard
        title="Edit README"
        description="Adds a section"
        risk="high"
        changes={[
          { label: 'File', after: 'README.md' },
          { label: 'Lines', before: '10', after: '14' },
        ]}
        onApprove={onApprove}
        onReject={onReject}
        onEdit={onEdit}
      />,
    );
    const card = s.getByRole('region', { name: 'Approval needed: Edit README' });
    (card.element() as HTMLElement).focus();
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{Escape}');
    expect(onApprove).toHaveBeenCalledTimes(2);
    expect(onReject).toHaveBeenCalledTimes(1);
    await s.getByRole('button', { name: /Edit first/ }).click();
    expect(onEdit).toHaveBeenCalled();
    await s.getByRole('button', { name: /Approve/ }).click();
    await s.getByRole('button', { name: /Not now/ }).click();
  });

  it('works without handlers or shortcuts and shows the decided states', async () => {
    const onUndo = vi.fn();
    const s = await render(
      <>
        {/* @ts-expect-error: unknown risk falls back to medium */}
        <ApprovalCard title={<b>rich</b>} risk="bogus" shortcuts={false} />
        <ApprovalCard title="Ok" status="approved" onUndo={onUndo} />
        <ApprovalCard title="No" status="rejected" />
      </>,
    );
    const card = s.getByRole('region', { name: 'Approval needed:' });
    (card.element() as HTMLElement).focus();
    await userEvent.keyboard('{Escape}');
    await expect.element(s.getByText('Approved · Ok')).toBeVisible();
    await expect.element(s.getByText('Declined · No')).toBeVisible();
    await s.getByRole('button', { name: /Undo/ }).click();
    expect(onUndo).toHaveBeenCalled();
    const bare = await render(<ApprovalCard title="Bare" />);
    (bare.getByRole('region', { name: 'Approval needed: Bare' }).element() as HTMLElement).focus();
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await userEvent.keyboard('{Escape}');
  });
});

describe('ChatMessage', () => {
  const ada = { name: 'Ada', handle: 'ada', id: 'a', self: true, presence: 'online' as const };
  const scout = { name: 'Scout', kind: 'agent' as const, owner: { name: 'Bo' } };

  it('shows a full message: header, mentions, attachments, activity, reactions, replies and actions', async () => {
    const h = { onReact: vi.fn(), onPin: vi.fn(), onReply: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onAuthor: vi.fn(), onReplies: vi.fn(), onMention: vi.fn() };
    const s = await render(
      <ChatMessage
        author={ada}
        time="10:42"
        text="hi @ada"
        members={[{ id: 'a', handle: 'ada', kind: 'human' }]}
        meId="a"
        edited
        pinned
        tone="mention"
        reactions={[
          { icon: 'heart', count: 2, mine: true },
          { icon: 'eye', count: 1 },
        ]}
        attachments={[
          { name: 'a.png', size: '1 KB', kind: 'image' },
          { name: 'b.txt', size: '2 KB' },
        ]}
        activity={{ summary: '1 step', steps: [{ title: 'Read' }] }}
        replies={{ count: 2, last: 'Last reply 10:50', people: [ada, scout] }}
        editLabel="Edit · 4m left"
        {...h}
      />,
    );
    const msg = s.getByRole('article', { name: 'Ada, 10:42' });
    await msg.hover();
    await s.getByRole('button', { name: 'React', exact: true }).hover();
    await s.getByRole('button', { name: 'React', exact: true }).click();
    expect(h.onReact).toHaveBeenLastCalledWith('thumbs-up');
    await s.getByRole('button', { name: 'Add reaction' }).click();
    await s.getByRole('menu', { name: 'Pick a reaction' }).getByRole('button', { name: 'check' }).click();
    expect(h.onReact).toHaveBeenLastCalledWith('circle-check');
    await s.getByRole('button', { name: 'Unpin' }).click();
    await s.getByRole('button', { name: 'Reply in thread' }).click();
    await s.getByTestId('msg-edit').click();
    await s.getByTestId('msg-delete').hover();
    await s.getByTestId('msg-delete').click();
    for (const f of [h.onPin, h.onReply, h.onEdit, h.onDelete]) expect(f).toHaveBeenCalled();
    await s.getByRole('button', { name: 'heart 2' }).click();
    expect(h.onReact).toHaveBeenLastCalledWith('heart');
    await s.getByRole('button', { name: /2 replies/ }).click();
    expect(h.onReplies).toHaveBeenCalled();
    await s.getByRole('button', { name: 'Open profile: Ada' }).click();
    await s.getByRole('button', { name: 'Ada', exact: true }).click();
    expect(h.onAuthor).toHaveBeenCalledTimes(2);
    await s.getByRole('button', { name: '@ada' }).click();
    expect(h.onMention).toHaveBeenCalled();
    // Focus moving within the message keeps the toolbar; leaving the message hides it.
    await userEvent.unhover(msg);
    (msg.element() as HTMLElement).focus();
    await expect.element(s.getByRole('toolbar')).toBeVisible();
    (s.getByRole('button', { name: 'React', exact: true }).element() as HTMLElement).focus();
    (msg.element() as HTMLElement).blur();
    (document.activeElement as HTMLElement | null)?.blur();
    await expect.element(s.getByRole('toolbar')).not.toBeInTheDocument();
  });

  it('covers the other shapes: continued, agent, locked, queued, failed, editor and children', async () => {
    const onLocked = vi.fn();
    const s = await render(
      <>
        <ChatMessage author={{ ...ada, self: true }} time="1" text="locked" locked onLocked={onLocked} highlighted />
        <ChatMessage author={scout} time="2" tone="agent" status="queued" reactions={[{ icon: 'eye', count: 1 }]}>
          <i>child body</i>
        </ChatMessage>
        <ChatMessage author={{ name: 'Mine', kind: 'agent', owner: { name: 'Me', self: true } }} status="failed" text="mine" replies={{ count: 1 }} />
        <ChatMessage author={{ name: 'Cont' }} continued text="cont" />
        <ChatMessage author={{ name: 'Ed' }} editor={<textarea aria-label="editing" />} actions={false} />
        {/* @ts-expect-error: unknown tone gets no tint */}
        <ChatMessage author={{ name: 'Odd' }} text="odd" tone="bogus" />
      </>,
    );
    await s.getByRole('article', { name: 'Ada, 1' }).hover();
    await s.getByTestId('msg-edit-locked').click();
    expect(onLocked).toHaveBeenCalled();
    await expect.element(s.getByText('Sends when you reconnect')).toBeVisible();
    await expect.element(s.getByText('Not delivered · Retry')).toBeVisible();
    await expect.element(s.getByText('yours')).toBeVisible();
    await expect.element(s.getByText("Bo's")).toBeVisible();
    await expect.element(s.getByText('child body')).toBeVisible();
    await expect.element(s.getByRole('textbox', { name: 'editing' })).toBeVisible();
    await s.getByRole('article', { name: 'Mine' }).hover();
    await expect.element(s.getByRole('button', { name: /1 reply$/ })).toBeVisible();
    await s.getByRole('button', { name: 'eye 1' }).click(); // no onReact: nothing happens
    await s.getByRole('article', { name: 'Odd' }).hover();
    await s.getByRole('button', { name: 'Open profile: Odd' }).click(); // no onAuthor
  });

  it('draws the dividers', async () => {
    const s = await render(
      <>
        <UnreadDivider />
        <UnreadDivider label="2 new" />
        <DayDivider label="Today" />
      </>,
    );
    for (const t of ['New', '2 new', 'Today']) await expect.element(s.getByText(t)).toBeVisible();
    expect(s.container.querySelectorAll('hr')).toHaveLength(3);
  });
});

describe('Status lines', () => {
  it('summarizes who is typing or writing', async () => {
    const s = await render(
      <>
        <TypingIndicator />
        <TypingIndicator people={[{ name: 'Ada', kind: 'human' }]} />
        <TypingIndicator
          people={[
            { name: 'Ada', kind: 'human' },
            { name: 'Bo', kind: 'human' },
          ]}
        />
        <TypingIndicator
          people={[
            { name: 'Ada', kind: 'human' },
            { name: 'Bo', kind: 'human' },
            { name: 'Cy', kind: 'human' },
          ]}
        />
        <TypingIndicator people={[{ name: 'Scout', kind: 'agent' }]} />
        <TypingIndicator
          people={[
            { name: 'Scout', kind: 'agent' },
            { name: 'Rex', kind: 'agent' },
          ]}
        />
      </>,
    );
    for (const t of ['is typing', 'are typing', 'is writing', 'are writing']) await expect.element(s.getByText(new RegExp(t + '$')).first()).toBeVisible();
    await expect.element(s.getByText('Ada and 2 others')).toBeVisible();
  });

  it('explains being offline or reconnecting, with retry', async () => {
    const onRetry = vi.fn();
    const s = await render(
      <>
        <ConnectionBanner />
        <ConnectionBanner queued={1} onRetry={onRetry} />
        <ConnectionBanner queued={3} />
        <ConnectionBanner state="reconnecting" peers={1} />
        <ConnectionBanner state="reconnecting" peers={4} />
        <ConnectionBanner state="reconnecting" />
        <ConnectionBanner state="online" />
      </>,
    );
    await s.getByRole('button', { name: 'Retry' }).click();
    expect(onRetry).toHaveBeenCalled();
    for (const t of [
      'Messages you write will send when a peer is reachable',
      '1 message will send when a peer is reachable',
      '3 messages will send when a peer is reachable',
      'Reconnecting to 1 peer',
      'Reconnecting to 4 peers',
    ])
      await expect.element(s.getByText(t)).toBeVisible();
    expect(s.getByRole('status').elements()).toHaveLength(6);
  });

  it('shows the bridge daemon state', async () => {
    const onClick = vi.fn();
    const s = await render(
      <>
        <DaemonStatus version="0.1.0" port={7717} agents="2 agents" onClick={onClick} />
        <DaemonStatus status="connected" />
        <DaemonStatus status="connecting" />
        <DaemonStatus status="missing" />
        {/* @ts-expect-error: unknown status reads as missing */}
        <DaemonStatus status="bogus" />
      </>,
    );
    const b = s.getByRole('button', { name: 'Local agent daemon: Agents ready, v0.1.0 · :7717' });
    await b.hover();
    await b.click();
    await userEvent.unhover(b);
    expect(onClick).toHaveBeenCalled();
    await expect.element(s.getByRole('button', { name: 'Local agent daemon: Looking for bridge' })).toBeVisible();
    await expect.element(s.getByRole('button', { name: 'Local agent daemon: Agents off, Set up' })).toBeVisible();
    await expect.element(s.getByRole('button', { name: 'Local agent daemon: Agents ready', exact: true })).toBeVisible();
  });
});
