# Validation — feature 016

Date: 2026-09-09. Branch: `codex/016-shared-domain-team`.
Runtime: Node 24.20.0, pnpm 11.21.0; existing local Docker database was upgraded without reset.

## Automated checks

| Check | Actual result |
| --- | --- |
| `pnpm exec vitest run tests/unit tests/contract/008/backward-compatibility.spec.ts tests/integration/security/acceptance/at-003-local-security.spec.ts tests/integration/security/008/corporate-identity.spec.ts --maxWorkers=2` | 87 files, 401 tests passed |
| `AWP_RUN_CONTAINER_TESTS=true pnpm exec vitest run tests/integration/015 tests/integration/016 tests/unit/015 tests/unit/016 tests/integration/security/acceptance/at-003-local-security.spec.ts tests/integration/security/008/corporate-identity.spec.ts --maxWorkers=1` | 7 files, 33 tests passed |
| Final historical bootstrap plus shared-team database tests (`tests/integration/007/local-project-bootstrap.spec.ts tests/integration/016`) | 3 files, 6 tests passed |
| Playwright `tests/e2e/013 tests/e2e/014 tests/e2e/016` | 17 tests passed |
| Final Playwright 016 after resource-path selector correction | 4 tests passed |
| Root TypeScript check (`pnpm exec tsc --noEmit`) | Passed, including final bootstrap repair |
| ESLint | Full repository passed; subsequently changed files passed again |
| Formatting and `git diff --check` | Passed for changed files |
| `pnpm --filter @awp/web build` | Passed |
| `pnpm architecture` | Accepted 24 projects; no deep imports, cycles or dynamic loading |

The focused database tests verify distinct stable QA identities with the same role and live QA execution permission in ALPHA/BETA, authorization after DENY/revocation, foreign/suspended scopes, removal of historical auditor relationships, registration of new projects with revisioned starter grants, and idempotent replay. The bootstrap test uses the same verified reader as the project page, checks old and new snapshots coexist, and preserves suspension on restart.

The full regression initially exposed an outdated dependency-review hash after including the existing technical-writing module. Its exact internal importer additions are now pinned; additional tests reject forged importer metadata and altered workspace links. No external package versions changed.

## Local verification

The HTTP project selector was checked against the running guard, rather than only mocked browser responses. Both QA accounts retain their identity and `qa-executor` role while selecting ALPHA/BETA, have `qa.session.execute`, and can read each project's backlog. The updated check also verifies each breadcrumb target through the UI-facing project endpoint. Results are recorded in `live-check.json`.

Final live result: both QA accounts successfully read both project pages after canonical bootstrap repair. Browser checks confirmed QA 1 and QA 2 selection, BETA without another login, and working home/project/catalog breadcrumb links. Docker update finished successfully and all application services reported healthy.

Before upgrade: 4 documents, 6 work items, base seed version 2.
After the final update: 4 documents, 6 work items, base seed version 3; zero auditor role assignments, memberships, and active entitlements. The retired identity is retained solely for historical attribution.

Both `writer.docs` and `lead.docs` continue to see the 4 existing documents in their technical-writing workspace. The finished feature 015 was incorporated from its existing worktree so this update preserves that deployed subject area.

## Scope of evidence

The local app and disposable database paths were exercised. Corporate group mapping was validated through policy tests; a real corporate identity provider was not contacted. Suspended projects and foreign workspaces remain restricted. Historical readiness is not inferred from the new team grants.
