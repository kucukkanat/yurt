Brief confirmation after something happened — almost always with an Undo.

```jsx
<Toast tone="success" title="Sent to 14 people" actionLabel="Undo" onAction={undo} duration={6000} onClose={hide} />
<Toast tone="agent" title="Draft ready" description="3 edits since your last version" />
```

- Every destructive or outward-facing agent action gets a toast with Undo instead of a confirm dialog.
- Stack max 3, newest at bottom, 8px apart.
