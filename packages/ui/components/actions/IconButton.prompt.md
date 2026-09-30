Icon-only action for toolbars and composers; always give it a `label`.

```jsx
<IconButton icon="paperclip" label="Attach file" />
<IconButton icon="arrow-up" label="Send" variant="primary" round />
<IconButton icon="panel-left" label="Toggle sidebar" active />
```

- Shares variants with Button. Default `ghost`.
- Press squashes to 92% on a spring; icon grows 8% on hover.
- `active` = toggle state (cobalt soft fill, `aria-pressed`).
