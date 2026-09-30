Switch between views of the same context; the active indicator slides between tabs on a spring.

```jsx
<Tabs items={[{ id: 'plan', label: 'Plan' }, { id: 'trace', label: 'Trace', count: 12 }, { id: 'out', label: 'Output' }]} />
<Tabs variant="underline" items={…} onChange={setView} />
<Tabs fullWidth items={…} />
```

- `pill` for in-panel switches (2–5 items); `underline` for page sections.
- Keyboard: ←/→ selects, Home/End jump. Only the active tab is in the tab order.
- **Overflow is handled for you** — never wrap tabs onto two lines or truncate labels. If they don't fit: the row scrolls sideways (touch, trackpad, wheel-free), edges fade to signal more, chevron buttons page by 70% of the width, and the selected tab is always scrolled fully into view. Keyboard users don't need the chevrons — arrow keys scroll as they select.
- `fullWidth` stretches tabs evenly on wide containers and falls back to scrolling on narrow ones.
- More than ~7 sections on mobile? Consider a Select instead.
