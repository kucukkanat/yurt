Chip for context the agent will use (files, links, people) and for filter toggles.

```jsx
<Tag icon="file-text" onRemove={() => {}}>Q3-brief.pdf</Tag>
<Tag selected onClick={toggle}>This week</Tag>
```

- Static, filter (`onClick` + `selected`), or removable (`onRemove`).
- Remove button is keyboard reachable; Backspace/Delete also removes.
