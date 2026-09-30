Toggle a setting that takes effect immediately (no save button).

```jsx
<Switch label="Auto-approve low-risk steps" tone="agent" defaultChecked />
<Switch size="sm" checked={dark} onChange={setDark} label="Dark mode" />
```

- `onChange` receives the new boolean, not an event.
- Use `tone="agent"` for toggles that change how much the agent may do on its own.
