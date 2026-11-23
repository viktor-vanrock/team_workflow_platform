# Implementation Plan: Общая предметная команда и навигация

**Branch**: `codex/016-shared-domain-team` | **Date**: 2026-09-09 | **Spec**: [spec.md](spec.md)

## Summary

Настоящие ссылки в shell; отдельный выбор проекта без выхода; две личности QA с одной ролью. Удалить аудитора из каталога/IdP и активных связей существующего seed. Явное workspace-назначение ALL_PROJECTS материализует проектные entitlement revisions при регистрации, сохраняя текущую DenyByDefault policy.

## Technical Context

**Language/Version**: TypeScript 6, React 19, Node 24 (целевой runtime).
**Primary Dependencies**: существующие NestJS, TypeORM, PostgreSQL, MUI, Vite; без новых зависимостей.
**Storage**: PostgreSQL; forward migration 0205 добавляет явный all-projects scope и потолок классификации workspace-role assignment.
**Testing**: Vitest, реальные PostgreSQL seed/registration/security integration, Playwright shell, typecheck, lint, build.
**Target Platform**: существующее web-приложение, локальный стенд и корпоративная авторизация.
**Project Type**: TypeScript monorepo.
**Performance Goals**: выдача прав только при seed/регистрации, без фонового опроса или записи на чтении; переключение проекта одним действием.
**Constraints**: сохранять UUID существующих участников, immutable history, explicit deny, classification, approvals; старые subject keys остаются совместимыми и больше не обозначают ограничение проекта.
**Scale/Scope**: одна QA область, два исполнителя, несколько проектов; роли различаются функциональными permissions. Новую предметную область с её данными эта feature не добавляет.

## Constitution Check

| Gate | Before research | After design |
| --- | --- | --- |
| III workspace ∩ entitlement ∩ role ∩ classification | PASS | PASS — явные per-project grants, общий scope только источник назначения |
| IV domain/core ownership | PASS | PASS — QA role keys/permissions, generic storage |
| II/VI/VII operational authority/approvals/verdict | PASS | PASS — сохранены |
| IX/X deterministic, audit, local-first | PASS | PASS — revisioned grants, local IdP, сохраняется audit |
| XI compatibility/migration | PASS | PASS — expand migration + seed version, повторяемое обновление |

## Project Structure

- `apps/web/src/workspace/{local-workspace,navigation}.tsx`: ссылки/контекст/переключение.
- `apps/api/src/local/local-persona.controller.ts`: server-checked projects list and selection.
- `packages/runtime-composition/src/{security/local-security,seed/local-seed}.ts`: shared role personas, stable UUIDs, seed upgrade.
- `packages/platform-persistence-typeorm/src/migrations/core/0205-workspace-team-access.ts`: explicit all-projects scope.
- `apps/api/src/extensions/onboarding/registry.application.ts`: atomic team grants in starter set.
- `packages/runtime-composition/src/security/corporate-identity.ts`: optional explicit all-projects group mapping still narrowed by exact persisted grants.
- `tests/{unit,integration,e2e}/016/`: focused conformance.

## Execution Strategy

Spec → research → contracts/data model/quickstart → tasks → navigation → auditor cleanup → shared grants/session/project selection → verification/docs. Research of authorization performed by read-only agent as required by speckit-plan. No hooks configured. No constitutional amendment required.

## Integration with feature 015

Existing technical-writing worktree changes are incorporated to preserve the live deployment. Constitution 2.0.1 and ADR-0010 come from that previously completed feature; this feature uses ADR-0011. Base seed upgrade runs independently of higher-level pack markers. Both domain test suites must pass.

## Live validation fixes

Project selection uses `POST /local/persona/projects/:projectId` with an empty body, preserving the existing prohibition on authoritative fields in client bodies. Live breadcrumb checks exposed incomplete historical seed snapshots. The local bootstrap now appends canonical registry/onboarding snapshots only for the four known seed projects and the exact legacy format. Prior immutable revisions remain; readiness, gates and operational state are preserved. This is a local seed compatibility repair, not a relaxation of verified reads.

The dependency review explicitly pins the technical-writing workspace importer additions. External package and snapshot sets are unchanged; hash and full-baseline verification, including rejection of forged additions, remain enabled.
