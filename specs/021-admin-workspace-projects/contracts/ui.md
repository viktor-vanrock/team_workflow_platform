# Contract

Local persona session extends each workspaces item with effective workspace permissions, computed for that same human via existing policy. Existing API authorization remains authoritative. Backward-compatible UI fallback: current workspace may use existing workspacePermissions/grants when older sessions omit per-workspace permissions.

/projects/new shows «Рабочая область проекта» select with named allowed workspaces. READ options and POST registration use chosen workspace path; idempotency cache keys workspace+body. Changing destination clears owners/options/errors and ignores stale loads. MFA preserves destination. After cross-workspace success, switch own session to destination and open /projects/:id/onboarding. /projects, /projects/new and scoped onboarding precede domain contribution; workspace routes do not require an existing project.

Local /local/persona/exchange accepts only personaKey and an optional workspaceId locator. It validates the requested workspace against current durable membership; roles, actor, principalId, entitlements and projectId in the body are rejected with 400. A workspace locator is never authorization. Cross-workspace post-create navigation requires a refreshed session in the exact destination; lost membership retains the form and does not expose a link in the wrong scope.
