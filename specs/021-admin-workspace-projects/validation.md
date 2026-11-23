# Validation — 021 Cross-workspace project creation

Spec Kit: specification → plan/research → tasks → implementation. Existing branch codex/workspace-wide-flow; no OpenSpec, schema migration or constitutional amendment.

## Delivered behavior

Admin1 (owner.local) retains the existing administrator assignment in the functional workspace and receives the narrow COMMON project-registrar role in additional active local workspaces. This role has exactly project.register, project.catalog.read and project.onboarding.read. It is visible in the role editor. Access administration remains a separate platform role. The bootstrap uses existing audited/versioned access replacement with per-workspace markers and deterministic request keys; replay, explicit revocation and crash-before-marker do not recreate grants. New active local workspaces enroll on the next deployment.

Registration uses current workspace permission, membership, classification and verified session authority. The registrar's new-project starter is read-only; it does not create a full administrator role or grant entitlement management. Existing administrator behavior and shared-team inheritance remain intact.

The creation form lists allowed workspace names, reloads owners when destination changes, retains unscoped draft fields and MFA state, isolates idempotency by workspace/body and opens the new project in its actual workspace. Common project pages work in documentation; a registrar's home shows projects without reading documents. Lost target membership after creation cannot produce an onboarding link in the previous workspace.

The existing local exchange controller previously rejected its own workspace selector with HTTP 500. It now accepts an exact personaKey/workspaceId allowlist and verifies membership in storage. Attempts to supply roles, actor, principalId, projectId or entitlements return 400; selecting another user's workspace returns 403. The generic business-command anti-authority guard remains unchanged.

## Automated verification

| Check | Result |
|---|---|
| New PostgreSQL/HTTP scenarios | 4 passed: creation in three workspaces, narrow grants and forbidden operations, replay/new empty workspace, explicit revoke/crash marker, real exchange HTTP selection/denials |
| Existing access administration and registration (019/020) | 14 passed |
| Published onboarding and corporate HTTP API | 8 passed, container suite explicitly enabled, two PostgreSQL versions |
| New browser scenarios | 4 passed: target owners/MFA/navigation, admin2 scope, documentation common pages, membership lost after save |
| Existing navigation/access browser suites (017/019) | 15 passed |
| Existing creation/queue browser suite (020) | 6 passed |
| Root TypeScript | Passed |
| Focused ESLint | Passed with zero warnings |
| Architecture | 24 projects accepted |
| Web production build | Passed |
| Git diff whitespace | Passed |

The HTTP selector failure was reproduced in a real controller test before the fix; the regression then passed. Successful project creation is tested only in disposable databases. Live checks are read-only for projects.

## Live rollout

Existing awp-local-pilot-dev stand updated without reset at http://localhost:55173. All nine personas passed UI and registration-options checks across three workspaces (27 scoped API checks). Admin1 sees three named creation destinations; admin2 sees only its existing workspace. Other roles receive 404 for registration-options. Admin1's additional workspace sessions contain exactly the three registrar permissions. Documentation home/catalog and the 390px creation form were inspected visually.

Evidence: live-checks.json, project-workspaces.png, project-workspaces-mobile.png, documentation-projects.png and data-retention.json. All 18 retention assertions passed: existing projects, all original entitlements, other users' role rows, admin1's functional roles, 4 documents, 6 work items, 15 document-history rows and all 74 existing audit records are unchanged. Nine active people and the internal service worker remain. Exactly two additional role assignments were introduced, both project-registrar with the three documented permissions. Repeating deployment changed no assignments.

The catalog can include legacy domain projects without a generic onboarding snapshot; this change does not initialize or alter their existing domain data. Newly registered projects have the normal DRAFT onboarding snapshot, verified in HTTP tests. Shared-team inheritance continues to follow existing ALL_PROJECTS assignments; project-specific assignments retain their scope.

Real corporate Keycloak configuration remains deferred by the user. No live projects were created by verification, and no commit or push was performed. All nine tasks and all specification checklist items are complete.
