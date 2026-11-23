# Tasks: Platform access administration

Input: spec.md, plan.md, research.md, data-model.md, contracts/access.md, quickstart.md.

## Phase 1 — Setup
- [x] T001 Record accepted platform scope in docs/adr/0013-platform-access-administration.md and .specify/memory/constitution.md.
- [x] T002 Complete Spec Kit artifacts and checklist in specs/019-platform-access-admin/.

## Phase 2 — Foundation
- [x] T003 Add management types and additive migration in packages/platform-core/src/access/platform-access.ts and packages/platform-persistence-typeorm/src/migrations/core/0215-platform-access.ts.
- [x] T004 Define domain role catalog and idempotent active-user/bootstrap seed in packages/runtime-composition/src/security/workspace-role-catalog.ts and packages/runtime-composition/src/seed/platform-access-seed.ts.

## Phase 3 — US1: Multiple roles (P1)
Independent check: two roles in QA plus documentation role; remove one with existing token; conflict/replay and DENY remain correct.
- [x] T005 [US1] Add assignment, revocation and concurrency tests in tests/integration/019/platform-access.spec.ts.
- [x] T006 [US1] Implement atomic audited role management in packages/runtime-composition/src/security/platform-access.ts.
- [x] T007 [US1] Replace seed-persona permission caps with live authorization in apps/api/src/local/local-persona.controller.ts, local-qa-authorization.ts, tech-writing.service.ts and packages/runtime-composition/src/security/local-queue-authority.ts.
- [x] T008 [US1] Enforce live legacy authorization and identity self-approval checks in apps/api/src/local/local-walking-skeleton.controller.ts.

## Phase 4 — US2: Platform authority and UI (P1)
Independent check: platform-only identity can manage all workspaces but cannot read tasks; ordinary workspace admin cannot read directory.
- [x] T009 [US2] Add transport authorization tests in tests/integration/019/corporate-access.spec.ts and tools/smoke/feature-019-live.mts.
- [x] T010 [US2] Wire local and corporate management controllers in apps/api/src/access/ and apps/api/src/app.module.ts.
- [x] T011 [US2] Build named user and multiple-role editor in apps/web/src/workspace/access-administration.tsx with version conflicts and history.
- [x] T012 [US2] Add platform navigation, workspace membership selection and session refresh in apps/web/src/workspace/local-workspace.tsx and navigation.ts.

## Phase 5 — US3: Corporate first login (P1)
Independent check: verified unknown user becomes pending with no grants; group + durable global assignment required; revoked global role stays revoked.
- [x] T013 [US3] Add provisioning, group and step-up tests in tests/integration/019/corporate-access.spec.ts.
- [x] T014 [US3] Extend optional verified-login/platform ports in packages/platform-runtime-nest/src/auth/corporate-session.service.ts and runtime corporate bindings.
- [x] T015 [US3] Add corporate pending/access UI and deployment configuration guide in apps/web/src/workspace/corporate-access.tsx and docs/deployment/configuration.md.

## Phase 6 — Verification and delivery
- [x] T016 Add browser role-edit and denial checks in tests/e2e/019/access-browser.spec.ts.
- [x] T017 Update role and administration guides in docs/user-guide/administration.md and docs/user-guide/daily-work.md.
- [x] T018 Run appropriate tests, types, lint, architecture and build; record evidence in specs/019-platform-access-admin/validation.md.
- [x] T019 Upgrade existing local stand without reset; verify user/data retention and live UI in specs/019-platform-access-admin/.

## Dependencies and execution
T001–T004 precede all stories. US1 service precedes US2 HTTP/UI; US3 uses the same management service. Tests precede implementation of their story. Within stories shared files run sequentially. Independent test commands can run concurrently; no implementation agents are required. Incrementally validate each story and finish all three before delivery. No hooks configured.
