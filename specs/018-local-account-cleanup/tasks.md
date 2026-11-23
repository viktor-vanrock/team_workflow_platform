# Tasks: Local account cleanup

**Input**: `specs/018-local-account-cleanup/` design artifacts.

## Phase 1: Setup

- [x] T001 Record scope and validated requirements in `specs/018-local-account-cleanup/spec.md` and `checklists/requirements.md`.

## Phase 2: Foundation

- [x] T002 Research catalog/worker/history boundaries and document design in `specs/018-local-account-cleanup/research.md`, `plan.md`, `data-model.md`, `contracts/local-accounts.md`.

## Phase 3: US1 — Working local team

Independent test: nine HUMAN options, retired issuance denied, SERVICE exchange denied, service principal available internally.

- [x] T003 [US1] Add account/IdP/session boundary tests in `tests/unit/018/local-accounts.spec.ts`.
- [x] T004 [US1] Remove diagnostic humans and separate seed options in `packages/runtime-composition/src/security/local-security.ts`; update catalog iteration in `packages/runtime-composition/src/seed/local-seed.ts`.
- [x] T005 [US1] Restrict retired token issuance and human session exchange in `apps/fake-idp/src/oidc.controller.ts` and `apps/api/src/local/local-persona.controller.ts`.
- [x] T006 [US1] Remove obsolete UI descriptions in `apps/web/src/workspace/navigation.ts` and update affected catalog/browser/seed fixtures under `tests/`.

## Phase 4: US2 — Existing installation upgrade

Independent test: fresh seed excludes retired identities, old seed revokes their grants, preserves historical rows and worker, second run unchanged.

- [x] T007 [US2] Add fresh/upgrade/idempotency/history tests in `tests/integration/018/local-account-cleanup.spec.ts`.
- [x] T008 [US2] Implement transactional seed v5 retirement in `packages/runtime-composition/src/seed/local-seed.ts`.
- [x] T009 [US2] Run affected DB/security/browser tests and record outcomes in `specs/018-local-account-cleanup/validation.md`.

## Phase 5: US3 — Workspace role scope

Independent test: known administrator cannot use role in foreign workspace; guide describes per-workspace assignments.

- [x] T010 [US3] Update reader/team/role scope in `docs/user-guide/administration.md` and `docs/user-guide/daily-work.md`.
- [x] T011 [US3] Preserve classification and known-principal scope denial coverage in `tests/integration/017/workspace-access.spec.ts` and `tests/integration/018/local-account-cleanup.spec.ts`.

## Phase 6: Validation and delivery

- [x] T012 Run typecheck, lint, formatting, architecture and relevant build; record results in `specs/018-local-account-cleanup/validation.md`.
- [x] T013 Upgrade existing local deployment without reset and verify live login, retired access, both QA, service and data retention; save evidence in `specs/018-local-account-cleanup/validation.md`.

## Dependencies and execution

T001 → T002 → US1 → US2 → US3 → final verification. T003 precedes implementation, T007 precedes seed retirement. No agent implementation delegation; research is complete. Within US1, IdP review and UI description review can be independent after catalog decision; within US2, fresh and upgrade assertions use separate fixtures; US3 documentation and scope tests are independent. MVP is US1; delivery includes all stories and existing-volume upgrade.
