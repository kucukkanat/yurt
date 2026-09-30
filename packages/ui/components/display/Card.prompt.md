Base surface for grouped content; use `interactive` when the whole card is one click target.

```jsx
<Card padding="lg"><h3>Weekly digest</h3></Card>
<Card interactive onClick={open}>…</Card>
<Card variant="agent">Agent's suggestion…</Card>
```

- Variants: default (white + shadow-sm), outline, sunken, inverse, agent (volt tint for AI-authored content).
- Never nest cards more than one level; use `sunken` for the inner level.
