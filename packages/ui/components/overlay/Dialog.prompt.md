Blocking decision or focused sub-task; use sparingly — prefer inline ApprovalCard for agent approvals.

```jsx
<Dialog open={open} onClose={() => setOpen(false)} title="Delete this run?"
  description="Its trace and outputs go with it. Undo stays available for 10 seconds."
  footer={<><Button variant="ghost" onClick={close}>Keep it</Button><Button variant="danger" kbd="enter">Delete</Button></>} />
```

- Title is a question or a verb phrase. Buttons name the outcome ("Delete run"), never "OK".
- `inline` renders within a positioned parent (for demos).
