# Implementation Plan: Создание проектов и единая очередь

**Branch**: `codex/workspace-wide-flow` | **Date**: 2026-09-09 | **Spec**: [spec.md](spec.md)
Spec Kit reports the feature slug as BRANCH; actual Git branch remains unchanged.

## Summary
Expose existing project registration in a dedicated local workspace route. Add a scoped named registration-options read through the existing onboarding authority service; preserve published POST and corporate policy ceilings. Render calculated and pending QA work through one compact list with summary first and optional details.

## Technical Context
- Language/version: TypeScript, Node 24.20.0, React 19.
- Dependencies: existing Nest, TypeORM/PostgreSQL, MUI platform-ui, Vite; no new packages.
- Storage: existing projects/registry/memberships/profiles/entitlements/idempotency/audit; no migration.
- Testing: Vitest with disposable PostgreSQL, Playwright browser journeys, live non-mutating role probes and visual screenshots.
- Platform/type: existing desktop/mobile web application and local Docker stand.
- Performance/scope: one creation form, one scoped options query, existing paged queue loads; 390/1440 px; no global restyling.
- Constraints: no real external providers, no reset, no branch switch, preserve prior 015–019 work.

## Constitution Check
PASS before and after design: workspace authority and classification remain server-side; platform role gives no registration rights; queue is a read model and never invents Jira state or priority. Existing registration step-up, audit, idempotency and team entitlement transaction reused. Names are display data only. Corporate read checks remain verified and scoped. No connector, schema, production scope or constitutional changes required.

## Project Structure
- apps/api/src/extensions/onboarding/{registry.application,onboarding.controller,corporate-onboarding.module}.ts: read options with current registration authority and optional READ corporate adapter.
- apps/web/src/routes/projects/{project-catalog,project-create}.tsx plus workspace/{local-workspace,breadcrumbs}.tsx/ts: route, form, step-up and session refresh.
- apps/web/src/routes/qa/queue-workspace.tsx and packages/competency-qa/src/ui/queue-workspace.tsx: normalize UI rows, complete/deduplicate queue snapshot, compact shared renderer.
- tests/integration/020, tests/e2e/020, tools/smoke/feature-020-live.mts: behavior and delivery evidence.
- docs/user-guide/administration.md, daily-work.md: current user flow.

## Delivery
US1 and US2 independently testable; implement sequentially after shared design. Research agent is read-only per Spec Kit plan; no implementation delegation. No extension hooks configured. Rollback by reverting only feature code; no schema/data rollback. Final stand upgrade without reset, compare old business rows and visually inspect both screens.
