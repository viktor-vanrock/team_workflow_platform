# Tasks: Администратор проектов всех областей

Input: spec.md, plan.md, research.md, data-model.md, contracts/ui.md.

## Setup and foundation
- [x] T001 Complete Spec Kit artifacts and checklist in specs/021-admin-workspace-projects/.

## US1 — Project registration assignments (P1)
Independent check: admin1 creates in all three scopes; admin2 denied in additional scopes; replay/explicit revoke preserved.
- [x] T002 [US1] Add assignment, registration and replay tests in tests/integration/021/workspace-projects.spec.ts.
- [x] T003 [US1] Implement limited role, registration starter and independent enrollment in packages/runtime-composition/src/seed/owner-project-registrar-seed.ts and cli/seed.ts.
- [x] T004 [US1] Add effective own workspace permissions in apps/api/src/local/local-persona.controller.ts.

## US2 — Destination and domain UI (P1)
Independent check: select documentation from functional, reset owners and preserve draft through MFA; creation posts to correct scope and opens resulting project.
- [x] T005 [US2] Add scope selection/contribution/denial browser tests in tests/e2e/021/workspace-projects-browser.spec.ts and tests/browser-test-files.ts.
- [x] T006 [US2] Implement destination selector, cache isolation and result scope in apps/web/src/routes/projects/project-create.tsx.
- [x] T007 [US2] Fix common routes, scope and domain admin landing in apps/web/src/workspace/local-workspace.tsx and navigation.ts.

## Delivery
- [x] T008 Update docs/user-guide/administration.md; run types, lint, tests, architecture/build and record specs/021-admin-workspace-projects/validation.md.
- [x] T009 Upgrade stand without reset and check all roles/domains with tools/smoke/feature-021-live.mts; preserve unrelated grants and business data.

Dependencies: T001 → US1 → US2 → delivery. Independent test commands can run concurrently; edits are sequential. Tests precede affected implementation. No implementation agents/hooks. Both stories required; no new schema.
