Shows the agent is actively working; always pair with a concrete label of what it is doing.

```jsx
<ThinkingIndicator label="Comparing 3 vendor quotes" detail="8s" />
<ThinkingIndicator variant="orb" size="sm" label="Listening" />
```

- Never leave an agent silent for >400ms — show this, then replace it with AgentStep rows as steps resolve.
