Small pill for status and metadata; pick the tone by who owns the state (agent, human, system).

```jsx
<Badge tone="agent" live>Working</Badge>
<Badge tone="human" icon="hand">Needs you</Badge>
<Badge tone="success" variant="solid">Done</Badge>
```

- Tones: neutral, accent, agent, human, success, warning, danger.
- `live` pulses the dot — reserve for in-progress states.
