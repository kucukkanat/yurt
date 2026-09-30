A single step in the agent's visible plan/trace — use a stack of these instead of an opaque spinner.

```jsx
<AgentStep status="done" title="Found 3 flights under $400" tool="flights.search" meta="2.1s" />
<AgentStep status="running" title="Checking seat availability" tool="united.api" />
<AgentStep status="waiting" title="Pay $362 with Visa ••4410?" detail="I'll hold the fare for 20 minutes" />
<AgentStep status="queued" title="Add to calendar" last />
```

- Statuses: queued (dashed), running (volt, pulsing), done (ink ✓, pops), waiting (coral ✋ — human needed), error, skipped.
- Put evidence (sources, diffs, raw output) in `children`; it expands with a chevron. Status is also spoken via sr-only text.
