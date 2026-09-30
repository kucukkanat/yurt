Single-line text field with built-in label, hint and error messaging.

```jsx
<Input label="Workspace name" hint="Shown to your team" />
<Input iconLeft="search" placeholder="Search runs" suffix={<Kbd keys="mod+k" />} />
<Input label="Budget" error="Needs to be above $0" />
```

- Always pass `label` (or `aria-label`). Errors say what to do, not what went wrong.
- `suffix` for units, keycaps or a clear button.
