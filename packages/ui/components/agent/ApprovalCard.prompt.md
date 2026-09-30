Pause point where the agent asks permission before an outward-facing, costly or irreversible action.

```jsx
<ApprovalCard
  title="Send invoice #1042 to Acme"
  description="Drafted from the signed SOW. Due in 30 days."
  risk="medium"
  changes={[{ label: 'Amount', after: '$4,800.00' }, { label: 'Due date', before: 'Net 45', after: 'Net 30' }]}
  onApprove={send} onEdit={edit} onReject={skip} />
```

- Render inline in the trace, right where the agent paused — not as a modal.
- Always show the concrete diff. `risk="high"` for anything that can't be undone.
- After a decision pass `status` to collapse it; keep `onUndo` available.
