# Tasks: Общая предметная команда и навигация

**Input**: spec.md, plan.md, research.md, data-model.md, contracts/ui-api.md, quickstart.md
**Tests**: required by FR-009; authorization/upgrade and browser behavior.

## Phase 1: Setup

- [x] T001 Create and validate Spec Kit artifacts in specs/016-shared-domain-team/.

## Phase 2: Foundation

- [x] T002 Inspect authorization, seed and navigation; verify repository ignore files and document design in specs/016-shared-domain-team/research.md.

## Phase 3: US1 — Navigable breadcrumbs

Goal: all path items navigate. Independent test: native links reach home, project and section.

- [x] T003 [US1] Implement accessible native breadcrumb links in apps/web/src/workspace/local-workspace.tsx.
- [x] T004 [US1] Add browser navigation assertions in tests/e2e/016/shared-team-browser.spec.ts.

## Phase 4: US2 — Auditor retirement

Goal: remove role and live relationships. Independent test: old login fails and upgraded seed contains no auditor grants.

- [x] T005 [US2] Add retirement/seed upgrade checks in tests/integration/016/shared-team.spec.ts.
- [x] T006 [US2] Remove auditor from packages/runtime-composition/src/security/local-security.ts, apps/fake-idp/src/oidc.controller.ts, apps/web/src/workspace/navigation.ts and packages/platform-ui/src/localization/ru.ts.
- [x] T007 [US2] Reconcile existing auditor relationships and stable persona ordinals in packages/runtime-composition/src/seed/local-seed.ts.

## Phase 5: US3 — Shared domain team

Goal: two QA people, one role, all workspace projects including future registration.
Independent test: each executor switches ALPHA/BETA; new project grants included atomically; foreign/revoked access denied.

- [x] T008 [US3] Add migration and access/registration tests in tests/integration/016/shared-team.spec.ts and tests/unit/016/.
- [x] T009 [US3] Add explicit ALL_PROJECTS assignment scope and classification ceiling in packages/platform-persistence-typeorm/src/migrations/core/0205-workspace-team-access.ts and core/index.ts.
- [x] T010 [US3] Seed workspace roles, two QA identities and exact project grants in packages/runtime-composition/src/seed/local-seed.ts and security/local-security.ts.
- [x] T011 [US3] Materialize revisioned team starter grants during registration in apps/api/src/extensions/onboarding/registry.application.ts.
- [x] T012 [US3] Extend corporate group mapping with explicit ALL_PROJECTS scope and retained live entitlement checks in packages/runtime-composition/src/security/corporate-identity.ts.
- [x] T013 [US3] Resolve authorized project list/permissions and guarded project selection in apps/api/src/local/local-persona.controller.ts.
- [x] T014 [US3] Add independent project selector, clear route state and update labels in apps/web/src/workspace/local-workspace.tsx and navigation.ts.
- [x] T015 [US3] Verify two-person switching and failure handling in tests/e2e/016/shared-team-browser.spec.ts; update affected previous browser expectations.

## Phase 6: Polish and verification

- [x] T016 Update active role documentation in docs/user-guide/ and docs/runbooks/interface-guide.md.
- [x] T017 Run appropriate test suites, typecheck, lint, formatting, architecture and web build; record results in specs/016-shared-domain-team/validation.md.
- [x] T018 Apply migrations/seed to local runtime without reset, verify changed behavior and finalize specs/016-shared-domain-team/tasks.md.

- [x] T019 Preserve the completed technical-writing module and verify its document workflow and domain boundary in packages/competency-tech-writing/, tests/integration/015/ and tests/unit/015/; always run base seed upgrades in packages/runtime-composition/src/cli/seed.ts.
- [x] T020 Repair verified reading of legacy local project pages by appending canonical bootstrap snapshots in packages/runtime-composition/src/pilot/historical-onboarding.ts, preserving old revisions, conservative readiness and suspended state; verify tests/integration/007/local-project-bootstrap.spec.ts and live breadcrumb targets.

## Dependencies and parallel opportunities

T001 → T002 → US1 → US2 → US3 → verification. T003/T004 are MVP navigation slice; all three stories required by user. US2 and US3 share seed/catalog files, execute sequentially. Corporate policy tests and browser tests can run independently after implementation; no parallel edits to shared files.

## Implementation strategy

Deliver links first, then retirement, then explicit shared access and project selection. Preserve existing identities/history, write migration-compatible changes, validate upgraded and fresh state, and apply locally without resetting data.
