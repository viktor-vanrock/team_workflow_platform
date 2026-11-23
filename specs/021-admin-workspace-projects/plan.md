# Implementation Plan: Администратор проектов всех областей

Branch: codex/workspace-wide-flow. Date: 2026-09-10. Spec: [spec.md](spec.md).

## Summary and technical context
TypeScript/Node24, existing Nest/TypeORM/PostgreSQL/React/MUI. Add an independent local bootstrap using PlatformAccessService.replace after profile/domain seeds. Derive allowed registration workspaces from current durable workspace authority in local session projection. Form owns its destination and reads existing scoped options. Common project routes precede specialized contribution routing. Add the COMMON project-registrar role; no new package or schema migration.

## Constitution Check
PASS before/after design: existing workspace memberships, narrow canonical registration role, project entitlements and classification enforced; no platform bypass. Existing audited access replacement plus deterministic idempotency and per-workspace marker. Normal registration step-up/transaction unchanged. Only owner.local enrollment changes, other principals preserved. No constitutional amendment required.

## Structure
- packages/runtime-composition/src/seed/owner-project-registrar-seed.ts and cli/seed.ts: independent marker, existing role union plus narrow project-registrar, revocation-preserving replay.
- packages/runtime-composition/src/security/workspace-role-catalog.ts and apps/api/src/extensions/onboarding/registry.application.ts: narrow role, permission-based registration, read-only registrar starter.
- apps/api/src/local/local-persona.controller.ts: verified workspace permissions in own session.
- apps/web/src/workspace/local-workspace.tsx/navigation.ts, routes/projects/project-create.tsx: target selection, common routes in docs, correct post-create navigation.
- tests/integration/021 and tests/e2e/021: grants/revoke/negative scope, form change and domain routing.
- tools/smoke/feature-021-live.mts and specs/021-admin-workspace-projects/: live evidence and retention.

## Execution and rollout
Research delegation was read-only per Spec Kit plan. Sequential implementation; tests before affected code. Test in disposable DB, then upgrade same stand without reset and check all active workspaces. Marker prevents repeated grant or resurrection; completed change request also protects crash-before-marker. Rollback UI/code preserves audit and assignments until explicit role revocation. No hooks configured.
