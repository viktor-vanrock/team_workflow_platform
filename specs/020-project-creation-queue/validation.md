# Validation — 020 Project creation and unified queue

Validated 2026-09-10. Workflow: Spec Kit specify → plan → tasks → implement. Actual branch remains codex/workspace-wide-flow; no OpenSpec, new dependencies, migrations or constitutional changes.

## Delivered behavior

- /projects/new is available from the project catalog to workspace administrators. Named active-HUMAN owners, canonical classifications, established STANDARD criticality, required field checks, reason and explicit local step-up.
- Existing published registration command is reused; server-side workspace authority, live owners, idempotency, conflict handling and automatic common-team entitlements remain authoritative. Global platform bootstrap alone does not grant registration.
- Success refreshes the session/project catalog and offers project onboarding. Lost responses preserve the draft and exact idempotency key. Catalog reads finish paged results so later projects remain discoverable.
- Queue summary precedes one list. Calculated and pending tasks use the same compact row structure. Pending rows cannot be moved. Details preserve computed/Jira state and exact lead command inputs.
- Queue refresh updates subjects and the full paged queue snapshot; stale cursors restart at most twice; duplicates are removed and aborted loads cannot replace current state. Failed sources show recovery instead of stale rows.

## Verification

| Check | Result |
|---|---|
| New scoped registration integration | 3 passed: named options without MFA, current roles/owners, repeat/conflict, team access and revocation |
| Existing shared-team registration | 1 passed |
| Existing published onboarding HTTP contract | 6 passed on two PostgreSQL versions |
| Corporate onboarding HTTP | 2 passed on two PostgreSQL versions, including options before MFA and narrowed policy denial |
| Browser scenarios 016/017/019/020 | 23 passed (6 new); MFA/retry draft, role denial, common queue links, mixed/paged list at 390/1440 px, recovery/empty state, stale cursor restart, existing access admin/navigation |
| Root TypeScript | Passed |
| ESLint | Changed implementation, tests and smoke runner passed with zero warnings |
| Architecture | 24 projects accepted; no deep imports, cycles or dynamic loading |
| Web production build | Passed |
| Formatting / git diff whitespace | Passed for changed files |

## Regression fixture maintenance

Older tests assumed integration-administrator was distinct from workspace-owner and a newly registered project excluded the second administrator. Their narrow corporate policy now uses qa-executor to exclude the unified administrator role; project-resource denials retain the published non-enumerating 404 response. Registration verifies inherited administrator access followed by explicit live revocation. The published contract fixture has complete onboarding data only for its controlled project, so unrelated bare seed projects are excluded from that fixture principal's catalog. These are test-only setup changes; deployed authority was not relaxed.

## Live verification and retained data

Existing awp-local-pilot-dev stand upgraded without reset: http://localhost:55173. Live read/UI checks passed for all nine people. Registration options are 200 for both workspace administrators and 404 for others. Seven functional-team identities also exercised protected registration: existing ALPHA key returns PROJECT_KEY_CONFLICT (409) for administrators and a resource denial (404) for other roles. No live projects or assignments were created by the checks. Successful writes run against disposable test databases.

Evidence: live-checks.json; queue-live.png, queue-mobile.png, project-create-live.png, project-create-mobile.png. Visual inspection confirmed shared compact rows, summary first, named form selectors and no horizontal page overflow on narrow viewports.

All 12 retention checks passed in data-retention.json: existing 4 documents, 6 tasks, 15 document-history rows, all 74 audit rows, 9 active people, internal worker and retained entitlements preserved. No retired test users reintroduced.

## Scope and compatibility

Real corporate Keycloak connection remains deferred by the user. Corporate registration-options READ preserves verified group/basis policy and does not require step-up; registration writes still require it. Public POST shape unchanged. The form creates a DRAFT project; integration setup/readiness is a separate existing flow. Existing registration stores the unique responsible-person set, not a persistent per-responsibility matrix; the form explains that behavior.

No extension hooks are configured. No commit or push was performed.

All 11 implementation tasks and all 16 specification checklist items are complete.
