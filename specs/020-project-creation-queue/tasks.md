# Tasks: Создание проектов и единая очередь

Input: spec.md, plan.md, research.md, data-model.md, contracts/ui-http.md.

## Phase 1 — Setup
- [x] T001 Complete specification and quality checklist in specs/020-project-creation-queue/spec.md and checklists/requirements.md.

## Phase 2 — Foundation
- [x] T002 Record researched authority, compatibility and display contracts in specs/020-project-creation-queue/plan.md, research.md, data-model.md and contracts/ui-http.md.

## Phase 3 — US1: Project creation (P1)
Independent check: named form creates one draft; repeat stays one; two QA inherit access; nonadmins cannot list owners/create.
- [x] T003 [US1] Add scoped options and registration integration checks in tests/integration/020/project-creation.spec.ts.
- [x] T004 [US1] Add scoped named options and conflict handling in apps/api/src/extensions/onboarding/registry.application.ts, onboarding.controller.ts and corporate-onboarding.module.ts.
- [x] T005 [US1] Add creation journey checks in tests/e2e/020/project-queue-browser.spec.ts and register tests/browser-test-files.ts.
- [x] T006 [US1] Implement form and navigation in apps/web/src/routes/projects/project-create.tsx, project-catalog.tsx and workspace/local-workspace.tsx, breadcrumbs.ts.

## Phase 4 — US2: Unified queue (P1)
Independent check: mixed/pending/empty/paged queues have summary first, one row per task, correct links and role controls at 390/1440 px.
- [x] T007 [US2] Add mixed queue, pagination/refresh and narrow viewport checks in tests/e2e/020/project-queue-browser.spec.ts.
- [x] T008 [US2] Implement complete refresh and shared compact queue rows in apps/web/src/routes/qa/queue-workspace.tsx and packages/competency-qa/src/ui/queue-workspace.tsx.

## Phase 5 — Delivery
- [x] T009 Update user instructions in docs/user-guide/administration.md and daily-work.md.
- [x] T010 Run behavior/regression tests, typecheck, lint, architecture and build; record specs/020-project-creation-queue/validation.md.
- [x] T011 Upgrade local stand without reset, verify live roles and layout in tools/smoke/feature-020-live.mts; record screenshots/data retention in specs/020-project-creation-queue/.

## Dependencies and execution
T001→T002→US1→US2→delivery. Write story checks before code. US1 backend/browser checks may run together; US2 browser/architecture checks may run together once implementation is complete. Changes to shared files stay sequential. MVP is US1, both accepted stories are required for final delivery. No implementation delegation or extension hooks. All tasks follow checkbox/ID/story/path format.
