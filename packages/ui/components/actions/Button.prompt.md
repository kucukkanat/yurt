The main pressable action; use `primary` for the user's next step and `agent` when the click hands work to the AI.

```jsx
<Button iconRight="arrow-right" kbd="mod+enter">Run plan</Button>
<Button variant="agent" iconLeft="sparkles">Let the agent draft it</Button>
<Button variant="secondary" loading>Saving</Button>
```

- Variants: `primary`, `agent`, `secondary`, `ghost`, `inverse`, `danger`. One primary per view.
- Sizes: `sm` 32, `md` 40, `lg` 48px.
- `kbd` renders a keycap inside the button; always add it for the view's main action.
- Microinteraction: hover lifts 1px (spring), press sinks 1px and drops the lip shadow, `iconRight` nudges forward.
