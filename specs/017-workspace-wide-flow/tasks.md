# Tasks: Общая работа команды

Input: spec.md, plan.md, research.md, data-model.md, contracts/ui-api.md, quickstart.md. Tests explicitly required by user.

## Setup
- [x] T001 Remove newly initialized OpenSpec scaffold and complete Spec Kit 017 artifacts in specs/017-workspace-wide-flow/.
- [x] T002 Research shared queue, role compatibility and UI access gaps; record in specs/017-workspace-wide-flow/research.md.

## Foundation and US2 — unified roles
Goal: canonical administrator/reader with preserved people and authorization. Independent test: migration and aliases preserve DENY, clearance and distinct-human approval.
- [x] T003 Add canonical role compatibility tests in tests/unit/017/ and migration/access tests in tests/integration/017/.
- [x] T004 Implement canonical roles and update checks/producers in packages/platform-core/src/, packages/runtime-composition/src/onboarding/, apps/api/src/extensions/onboarding/ and corporate-identity.ts.
- [x] T005 Migrate live roles and upgrade local assignments/grants in packages/platform-persistence-typeorm/src/migrations/core/ and packages/runtime-composition/src/seed/local-seed.ts; unify catalog and labels.
- [x] T006 Add authorized per-project session permissions and workspace subject catalog in apps/api/src/local/; preserve classification and domain boundaries.

## US1 — common workflow
Goal: both QA users work from one queue and request list. Independent test: ALPHA/BETA items and correct links without a global project selector.
- [x] T007 Add multi-project and isolation tests in tests/integration/017/ and tests/e2e/017/.
- [x] T008 Fix workspace portfolio authority in packages/runtime-composition/src/security/local-queue-authority.ts; allow human readers to view the authorized queue.
- [x] T009 Replace project queue mode with workspace queue, labels and task links in apps/web/src/routes/qa/queue-workspace.tsx and packages/competency-qa/src/ui/queue-workspace.tsx.
- [x] T010 Implement common requests and entity-scoped routes/form project choice in apps/web/src/workspace/ and apps/web/src/routes/qa/; remove global project selection.

## US3 — breadcrumbs
Goal: correct URL hierarchy and history. Independent test: home/list/detail/project/docs, deep-link login and back/forward.
- [x] T011 Implement breadcrumb/location helpers and tests in apps/web/src/workspace/ and tests/unit/017/; integrate in local-workspace.tsx.
- [x] T012 Cover browser history and direct links in tests/e2e/017/.

## US4 — Hermes
Goal: understandable named subject choice without ID entry. Independent test: select across projects and types, no stale proposals or hidden subjects.
- [x] T013 Implement authorized subject chooser/explanation in apps/web/src/routes/qa/hermes-proposals.tsx with tests in tests/e2e/017/.

## US5 — access review
Goal: each role's controls and routes match real access. Independent test: explicit allowed/denied role matrix.
- [x] T014 Gate queue, onboarding, candidates, automation and request-detail actions in apps/web/src/routes/ and packages/competency-qa/src/ui/; fix menu permission mismatches.
- [x] T015 Exercise every persona and direct forbidden routes in tests/e2e/017/ and live app; document actual matrix in specs/017-workspace-wide-flow/role-access.md.

## Verification and delivery
- [x] T016 Update current user guides and docs/adr/0012-workspace-wide-flow.md; retain historical specs.
- [x] T017 Run affected tests, typecheck, lint, formatting, build and architecture; record specs/017-workspace-wide-flow/validation.md.
- [x] T018 Upgrade local deployment without reset; verify data retention, common queue, breadcrumbs, Hermes and per-role access; complete tasks.

## Dependencies and execution
T001–T002 → T003–T006 → US1 → US3/US4 → US5 → verification. Research ran independently under Spec Kit planning; implementation edits are sequential. Browser role cases are independently testable after shared fixtures. All user stories are required, common queue is the first usable slice.
