# UI state model

No database changes.

- LocalSession: existing accessToken, persona, context, grants. Token remains memory-only. Exchange clears previous subtree and failures never restore old content.
- Location: pathname/search stored via history subscription; same-origin route transitions preserve session. Unknown paths render an explicit fallback.
- Request selection: workspaceId + projectId + workItemId. No first-record fallback. A route/persona/request key fences nested state and async load sequence fences responses.
- Intake draft: immutable server draft ID and local submitted payload snapshot. EDITING → REVIEW → PROCESSING → CONFIRMED; request/status failures have explanatory recoverable state. REVIEW → EDITING invalidates old review. Once confirmation attempted, retain exact ID and use status/retry of that confirmation, not a replacement draft.
- Server status: success requires CONFIRMED plus work item ID. Timeout or transport failure cannot synthesize success/failure. Terminal command rejection is surfaced separately.
- View preferences: active section/tab and expanded diagnostics; not authoritative domain state.
