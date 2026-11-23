# Implementation Plan: Общая работа команды по всем проектам

Branch: `codex/workspace-wide-flow`; feature: [spec.md](spec.md); 2026-09-09.

## Technical Context

TypeScript 6 / React 19 / NestJS / TypeORM / PostgreSQL, existing local composition. No new dependencies. Tests: Vitest with disposable PostgreSQL, Playwright and role-by-role live HTTP/UI checks. Scope includes QA shell, authorization role compatibility and preserved technical-writing contribution.

## Summary

Replace global selected-project workflow with workspace queue and named entity navigation. Keep explicit project scope for every API action. Merge administrator and reader semantics, migrate live assignments and preserve historical identity and approvals. Gate UI actions by exact current permissions. Replace Hermes ID prompt with an authorized subject chooser.

## Constitution Check

- Workspace membership ∩ project entitlement ∩ permission ∩ classification retained; portfolio is an authorized projection, not a new security scope.
- Domain Core/Pack ownership retained; generic canonical role names and migration fields do not grant unrestricted access.
- Immutable history, Jira authority, exact approval, distinct-human approval and human verdict retained.
- Additional local technical-writing domain already authorized by constitution 2.0.1; its documents and workflow remain intact.
- No changed constitutional invariant; ADR records the role/UX change and migration consequences. No hooks configured.

## Design

1. Session includes authorized projects with per-project permissions and workspace grants. UI uses union only for discoverability; each entity page receives its exact project's permissions. Legacy selector endpoint stays compatible, UI never calls it.
2. Requests aggregate authorized backlog results with project labels; scoped detail URLs survive reload/login/back. Project selection exists only for entity creation or project-specific settings.
3. Workspace queue uses AUTHORIZED_PORTFOLIO and permission-gated move controls; task links open the correct request/candidate.
4. Canonical role helper accepts known historical aliases. New writes use system-administrator/reader. Migration preserves assignment scope, DENY, clearance and immutable records; local seed grants administrator union functions.
5. Breadcrumb builder derives actual parents from location and entity labels; no duplicate home/current page or stale project.
6. Shared entity catalog supplies Hermes choices, distinguishing drafts/candidates/requests with their projects. Selection invalidates previous results; server validates exact subject and permission.
7. Audit every persona, including same-role people, request/QA/lead/reader/admin, writing roles, service and isolated outsider. UI hidden/disabled controls must correspond to backend denial.

## Implementation and verification

Create tasks, implement roles and session foundation, then common lists/navigation/Hermes and action gates. Add focused regression tests for previously failing behavior, run affected security suites, typecheck/lint/build/architecture, deploy locally without reset, record role matrix with actual UI/API results. Preserve earlier features 015 and 016 and all user data.

Live verification found the local runtime has accepted requests but no priority projection yet. The queue also lists authorized accepted tasks without calculated priority, separately from ordered entries; it never invents SLA/order tokens or enables moves for them. This keeps existing work visible while project queue configuration is pending. Service identities receive diagnostic-only navigation.
