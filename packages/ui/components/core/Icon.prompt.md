Renders a Lucide stroke icon from the bundled set. Use it for every glyph in the UI; don't use emoji or hand-drawn SVG.

```jsx
<Icon name="sparkles" size={18} />
<Icon name="shield-check" label="Verified" color="var(--success)" />
```

- `size` 16 (dense UI), 18 (buttons), 20 (default), 24 (empty states).
- Decorative by default (`aria-hidden`). Pass `label` when the icon carries meaning on its own.
- Names: see `IconName` in Icon.d.ts. To add one, copy it from lucide-static into `assets/icons/` and regenerate `icons-data.js`.
