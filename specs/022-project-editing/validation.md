# Validation — 022 Project editing

Spec Kit: specify → plan/research → tasks → implement. Branch codex/workspace-wide-flow; existing work preserved. Requirements checklist: 16/16 PASS. No extension hooks configured. Ignore files and architecture boundaries verified; no dependency/schema addition.

## Behavior

The common project catalog and onboarding page link to /projects/:id/edit when the current project grants metadata.update. The form preloads the name and active named workspace members, requires a reason and recent verified MFA, and shows immutable revision history (latest 50 versions, full history retained in storage). Key, workspace and classification remain immutable. Drafts survive MFA refresh, conflicts and transport errors; explicit reload replaces the draft. A successful identical retry returns its original result.

GET/PUT metadata operate in current project scope, including published /api/v1 aliases. Authorization is obtained before row locks and rechecked under transaction locks to avoid nested authorization deadlock. Mutation increments registry/onboarding versions, writes audit/outbox, clears old readiness gate refs, and retains binding/context/state/incident references. Existing approval exact refs become stale. Archived resources remain unavailable; suspended metadata can be maintained without resuming work.

The local permission upgrade adds only metadata.update to existing active administrator/registrar role rows and live matching entitlements. It preserves scope, expiry, classification, DENY and revoked/absent grants; repeats are no-ops. Existing legacy entitlement projections are adopted into the immutable journal transactionally. Known ALPHA-DOCS seed now receives the conservative historical registry/onboarding bootstrap without readiness or domain-data changes. Corporate role assignment uses the updated catalog; real Keycloak configuration remains deferred by the user.

## Automated evidence

- Five new PostgreSQL/HTTP scenarios pass: editing in all three workspaces, immutable history/hash/audit/replay/conflict, missing MFA/foreign owners/immutable fields/unauthorized roles, concurrent edits and suspended-state preservation, admin2 scope/current revocation, and upgrade/replay preserving prior grants/history.
- Existing 019/020/021 integration suites: all 17 existing tests pass. One corporate admission assertion failed transiently in the combined run; its isolated rerun passed all four cases without a product/test change. The combined run otherwise passed 21/22 including all five new cases.
- Published and corporate onboarding regression: 8 tests passed with container checks explicitly enabled.
- Browser: all 13 scenarios passed across 020/021/022 (three new editor scenarios, ten creation/queue/navigation regressions).
- TypeScript root check, focused ESLint with zero warnings, architecture graph (24 projects), web production build and git diff whitespace check pass.
- New API and browser tests first failed because the endpoints/form did not exist. Diagnostic errors exposed and resolved the row-lock order and created_by UUID column mismatch before rollout.

## Local rollout and retention

Updated awp-local-pilot-dev at http://localhost:55173 without reset; API, worker, web and dependencies healthy. Read-only live check: 9 personas × 5 projects = 45 scoped metadata checks. Admin1 reads editors in all three workspaces; admin2 only its functional workspace; other personas denied through HTTP and direct UI links. Documentation catalog/editor/onboarding breadcrumbs and 390px layout passed. No live project edits were performed; all positive mutations used disposable databases.

Evidence: live-checks.json; project-edit-desktop.png, project-edit-mobile.png, project-edit-docs.png; data-retention.json. All 19 retention assertions pass, including an unchanged repeat deployment. Four documents, six work items, 15 document-history rows, nine active people, memberships and all 76 prior audit records remain unchanged. Old registry/onboarding/entitlement revisions remain byte-identical. Exactly five existing role rows and eight existing entitlement rows receive the single capability; no grant identities are added. Project metadata is unchanged, with only ALPHA-DOCS registry version initialized conservatively.

Final localized UI rerun: 3/3 browser scenarios pass. Final live rerun: 45/45 metadata access checks and all nine UI personas pass. Repeated deployment changed no grants, membership, projects or existing immutable history. All 10 tasks are complete.

No commit or push performed.
