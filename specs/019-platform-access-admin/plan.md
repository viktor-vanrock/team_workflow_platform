# Implementation Plan: Platform access administration

**Date**: 2026-09-09 · **Spec**: spec.md · **Branch**: codex/workspace-wide-flow

## Summary
Add platform user administration, multiple workspace roles and verified corporate first-login registration. Existing business authorization remains scoped; the platform role controls management only.

2026-09-10 amendment: ADR-0015 / Constitution 3.0.0 replaces group bootstrap with one-time first corporate login administration and application-managed grants. Core migration 225 and PostgreSQL transaction/immutable singleton preserve concurrency, revocation and upgrade behavior. Legacy group-scoped identity is explicitly opt-in via `accessProvisioning: false`.

Local amendment: ADR-0016 / Constitution 3.1.0 replaces the fixed local seed grant with one-time local first-login administration. Core 230 archives old seed grants and adds an independent immutable local choice and unique assignment. Local login enrolls the elected human in project registration; workspace security remains in force.

## Technical Context
TypeScript/ESM, Node 24, pnpm 11, NestJS API, React/Vite UI, TypeORM/PostgreSQL, existing OIDC verifier/session storage, Vitest and Playwright. No new packages. Deploy additive migration to existing local Docker project without reset.

## Constitution Check
PASS: Explicit user decisions + ADR 0013/0015/0016 and constitution 3.1.0 approve separate platform authority and independent first corporate/local login bootstraps. Core remains competency-independent; runtime catalog composes domain roles. All business checks retain membership/roles/entitlement/classification intersection and DENY. Management writes are versioned, idempotent, audited and require verified identity and step-up. No token or secret enters UI/history. No business data deletion.

## Project Structure
- packages/platform-core/src/access/platform-access.ts — management context/types
- packages/platform-persistence-typeorm/src/migrations/core/0215-platform-access.ts — additive tables
- packages/runtime-composition/src/security/workspace-role-catalog.ts — assignable roles
- packages/runtime-composition/src/security/platform-access.ts — directory, assignments, provisioning
- packages/platform-runtime-nest/src/auth/corporate-session.service.ts — optional trusted session ports
- apps/api/src/access/ — local/corporate access controllers and module
- apps/web/src/workspace/access-administration.tsx — shared admin UI
- tests/integration/019/, tests/unit/019/, tests/e2e/019/ — boundary and behavior checks

## Design
See data-model.md and contracts/access.md. Directory includes active seeded humans and verified corporate arrivals. Local bootstrap is idempotent, global role has source and live revocation. User role edits create ALL_PROJECTS assignments and exact project entitlements, preserve DENY and unrelated grants. Pending users can read their own registration and assignments only. In application-managed mode corporate group mappings do not constrain stored business assignments; group-scoped behavior remains only in the explicit legacy mode.

## Delivery and validation
Foundation → US1 assignments → US2 HTTP/UI and dynamic access → US3 corporate first login → tests, docs, local deployment. Use disposable database fixtures for mutating checks, then read-only live checks and before/after retention snapshot. Validate root types/lint, relevant tests, architecture and web build once changes stabilize.

## Complexity Tracking
Separate management authority is required by user across workspace boundaries; adding PLATFORM to ResourceScope was rejected because it would weaken existing business invariants. Corporate actual endpoint configuration is deferred by user, not a blocker to implementation/testing.
