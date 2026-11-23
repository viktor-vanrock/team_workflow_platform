# Implementation Plan: Local account cleanup

**Branch**: `codex/workspace-wide-flow` | **Date**: 2026-09-09 | **Spec**: [spec.md](spec.md)
**Input**: `specs/018-local-account-cleanup/spec.md`

## Summary

Remove diagnostic human personas from the deployable catalog and fake IdP. Split human login options from seeded principals so worker identity/permissions survive. Upgrade local seed to version 5 and revoke retired grants through immutable entitlement revisions. Preserve historical identities. A v4 → v5 upgrade only retires diagnostic access and updates the reader display name; retained grants and revisions are not reseeded. Reject service exchange at human session entry. Document workspace role scope and update affected regression fixtures.

## Technical Context

**Language/Version**: TypeScript 6, Node 24.20.0.
**Primary Dependencies**: Existing NestJS, TypeORM, React; no new dependencies.
**Storage**: PostgreSQL; existing membership/assignment/entitlement tables.
**Testing**: Vitest, disposable PostgreSQL, Playwright and live local checks.
**Target Platform**: Local Docker development deployment.
**Project Type**: Monorepo web application.
**Performance Goals**: No new request-time database scans beyond current session policy; one transactional seed upgrade.
**Constraints**: No volume reset; retain immutable history, service execution and two QA; deny-by-default policy unchanged.
**Scale/Scope**: 12 UI entries → 9 humans; 10 active seeded principals including worker; no new database schema or public permission.

## Constitution Check

Pre-research PASS: Workspace hard boundary, classification, exact approvals and history remain intact. This removes local access and does not alter production scope. Post-design PASS: transactional revision-based revocations, distinct approval actors, service retained, no global authority introduced.

## Project Structure

### Documentation (this feature)

`specs/018-local-account-cleanup/{spec,plan,research,data-model,quickstart,tasks,validation}.md`, `contracts/local-accounts.md`, `checklists/requirements.md`.

### Source Code (repository root)

- `packages/runtime-composition/src/security/local-security.ts`: catalog and seed/login separation.
- `packages/runtime-composition/src/seed/local-seed.ts`: seed v5 retirement.
- `apps/fake-idp/src/oidc.controller.ts`: issuance allowlist.
- `apps/api/src/local/local-persona.controller.ts`: human exchange guard.
- `apps/web/src/workspace/navigation.ts`: persona descriptions.
- `tests/unit/018/`, `tests/integration/018/`: issuance, retirement, data preservation.
- Existing affected tests in `tests/integration/017`, `tests/e2e/017`, `tests/e2e/001-acceptance.spec.ts`.
- `docs/user-guide/administration.md`: account composition and workspace scope.

**Structure Decision**: Extend existing local-only composition. No test-account opt-in in deployed runtime; classification tests use isolated fixtures with working personas.

## Complexity Tracking

No constitutional deviations or new dependencies.
