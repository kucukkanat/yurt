import { Button, Dialog, Icon, IconButton, Radio, Tooltip } from '@yurt/ui';
import { levelOf, NOTIFY_LEVELS, type NotifyLevel } from '@yurt/protocol';
import { useApp } from '../store';
import { channelTitle, useCurrent } from '../model';

const CHOICES: Record<NotifyLevel, { label: string; description: string }> = {
  all: { label: 'All messages', description: 'Every new message notifies you and counts in the badge.' },
  mentions: { label: 'Mentions', description: 'Only @mentions of you and agents asking for your approval.' },
  none: { label: 'Nothing', description: 'No notifications, badges or unread bold for this conversation.' },
};

/** How much the current conversation alerts me: what the bell in its header says, and what the dialog edits. */
function useLevel(): { code: string; ch: string; level: NotifyLevel } | null {
  const { route, state, identity } = useCurrent();
  if (!route.code || !route.ch || !state) return null;
  return { code: route.code, ch: route.ch, level: levelOf(state, identity.pub, route.ch) };
}

/** All / Mentions / Nothing for one conversation. A choice applies at once, on all my devices. */
export function AlertLevelPicker({ code, ch, level }: { code: string; ch: string; level: NotifyLevel }) {
  return (
    <fieldset data-testid="alert-level" style={{ margin: 0, padding: 0, border: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <legend style={{ padding: 0, marginBottom: 'var(--space-2)', fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>Notify me about</legend>
      {NOTIFY_LEVELS.map((l) => (
        <Radio
          key={l}
          name={'alert-level-' + ch}
          value={l}
          data-testid={'alert-level-' + l}
          label={CHOICES[l].label}
          description={CHOICES[l].description}
          checked={level === l}
          onChange={() => useApp.getState().setLevel(code, ch, l)}
        />
      ))}
      <span style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text-muted)' }}>Applies on all your devices.</span>
    </fieldset>
  );
}

/** The header's bell: opens this conversation's notification choice. Any conversation has one: channels, DMs, agent chats. */
export function AlertsButton() {
  const cur = useLevel();
  if (!cur) return null;
  const label = 'Notifications: ' + CHOICES[cur.level].label;
  return (
    <Tooltip content={label} placement="bottom">
      <IconButton icon="bell" label={label} size="sm" data-testid="alerts-button" active={cur.level === 'none'} onClick={() => useApp.getState().setDialog('alerts')} />
    </Tooltip>
  );
}

/** A quiet marker next to a conversation's title when it alerts nothing. */
export function QuietMark() {
  return <Icon name="bell" size={13} label="Notifications off" data-testid="quiet-mark" style={{ color: 'var(--text-subtle)', opacity: 0.6, flexShrink: 0 }} />;
}

export function AlertsDialog({ onClose }: { onClose: () => void }) {
  const cur = useLevel();
  const { state, identity } = useCurrent();
  if (!cur) return null;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Notifications"
      description={(state?.channels.has(cur.ch) ? '#' : '') + channelTitle(state, cur.ch, identity.pub)}
      width={420}
      footer={
        <Button variant="primary" onClick={onClose} data-testid="alerts-done">
          Done
        </Button>
      }
    >
      <AlertLevelPicker {...cur} />
    </Dialog>
  );
}
