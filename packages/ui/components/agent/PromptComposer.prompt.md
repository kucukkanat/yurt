The main input for talking to the agent; one per view, anchored at the bottom of the conversation.

```jsx
<PromptComposer
  suggestions={['Plan my week', 'Summarize this doc']}
  context={<Tag icon="file-text" onRemove={rm}>brief.pdf</Tag>}
  running={isRunning} onStop={stop} onSubmit={send} />
```

- Keyboard: Enter send · Shift+Enter newline · Esc stop.
- Suggestions stagger in (50ms) and hide once the user types.
- While `running`, the border glows volt and Send becomes Stop — the user can always interrupt.
