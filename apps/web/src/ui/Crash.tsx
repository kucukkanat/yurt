import { Component, type ReactNode } from 'react';
import { Button } from '@yurt/ui';

/** The error and where it came from. Chromium's stack starts with the message; Safari's is only the frames. */
const describe = (e: Error) => {
  const head = `${e.name}: ${e.message}`;
  const stack = e.stack ?? '';
  return stack.startsWith(head) ? stack : `${head}\n${stack}`;
};

// Boxed, because anything can be thrown, `null` and `undefined` included.
type State = { failure: { error: unknown } | null };

/**
 * Catches a render error anywhere in the app and shows it, with a reload. Without it React unmounts everything and
 * leaves only the page background: a black screen that says nothing, which is all a phone without devtools reports.
 */
export class Crash extends Component<{ children: ReactNode }, State> {
  override state: State = { failure: null };

  static getDerivedStateFromError(error: unknown): State {
    return { failure: { error } };
  }

  override render() {
    if (!this.state.failure) return this.props.children;
    const { error } = this.state.failure;
    const detail = error instanceof Error ? describe(error) : String(error);
    return (
      <div
        role="alert"
        data-testid="crash"
        style={{
          padding: 'var(--space-6) var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
          height: '100%',
          boxSizing: 'border-box',
          overflow: 'auto',
        }}
      >
        <h1 style={{ font: 'var(--type-heading)' }}>Something broke.</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)' }}>Your data is safe on this device. Reloading usually helps; if it doesn't, send us the details below.</p>
        <pre data-testid="crash-detail" style={{ margin: 0, font: 'var(--type-code)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'text' }}>
          {detail}
        </pre>
        <div>
          <Button data-testid="crash-reload" onClick={() => location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    );
  }
}
