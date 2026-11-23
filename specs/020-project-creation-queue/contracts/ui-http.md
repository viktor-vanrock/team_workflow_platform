# UI and HTTP contract

GET /api/v1/workspaces/:workspaceId/projects/registration-options: authenticated current workspace system-administrator with project.register; corporate READ authorization does not require step-up. Returns schemaVersion 1 and named active-human owners, classification and established criticality choices. Uses existing non-enumerating error policy.
POST /api/v1/workspaces/:workspaceId/projects: existing published contract unchanged, fresh step-up and idempotency header; duplicate request replays, conflicting project key reports useful error. /projects/new consumes the published response projectId, refreshes own project permissions, links to /projects/:id/onboarding and /projects.

Queue: existing portfolio read endpoints and subject catalog retain authority. One accessible summary before role=list tasks; identical row structure, pending badge «Без приоритета», expandable details for computed state and optional lead actions. No movement controls for pending rows. Refresh both sources, only commit complete queue snapshot, clear stale results after failed/changed scope load. Keep existing public renderer callbacks compatible where possible.
