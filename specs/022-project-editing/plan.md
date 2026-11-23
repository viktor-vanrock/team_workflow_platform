# Implementation Plan: Редактирование проектов

**Branch**: codex/workspace-wide-flow | **Date**: 2026-09-10 | **Spec**: [spec.md](spec.md)

## Summary
Добавить редактирование названия и общего списка ответственных через новую версию реестра проекта. Использовать существующие scoped authorization, MFA, idempotency, audit/outbox и onboarding revisions. Интерфейс общий для всех компетенций.

## Technical Context
- Language/Version: TypeScript, Node.js 24, React.
- Dependencies: существующие NestJS, TypeORM/PostgreSQL, platform-core factories; новых зависимостей нет.
- Storage: существующие projects, registry/onboarding revisions, entitlement revisions, audit_events, event_outbox и local_seed_markers.
- Testing: Vitest integration с disposable PostgreSQL, Playwright, local pilot smoke.
- Platform: browser + Node API, local Docker deployment.
- Performance: один scoped запрос карточки/справочника; транзакция сериализуется внутри workspace, без внешних вызовов.
- Constraints: сохранять бизнес-данные, исторические revisions и отзывы прав; не выдавать новые domain/integration permissions.
- Scope: 3 текущих workspace, 2 административные роли, все зарегистрированные и известные старые локальные проекты.

## Constitution Check
До исследования и после дизайна: PASS. Workspace остаётся security boundary; metadata.update пересекает membership, role, entitlement, classification. Детерминированная транзакция создаёт immutable revisions, audit и outbox. Текущая власть и MFA проверяются перед replay. Тесты авторизации и конфликтов обязательны. Новых пакетов, динамических компетенций, внешних записей и исключений нет.

## Project Structure
- apps/api/src/extensions/onboarding/project-metadata.application.ts — чтение/команда.
- apps/api/src/extensions/onboarding/onboarding.controller.ts — HTTP routes.
- apps/web/src/routes/projects/project-edit.tsx — форма и история.
- apps/web/src/workspace/{local-workspace,breadcrumbs}.tsx/ts — маршрутизация.
- packages/runtime-composition/src/security/workspace-role-catalog.ts — capability.
- packages/runtime-composition/src/seed/project-metadata-seed.ts — узкое обновление существующих local grants.
- packages/runtime-composition/src/pilot/development-seed.ts — известный исторический docs project.
- tests/integration/022, tests/e2e/022, tools/smoke/feature-022-live.mts.

## Complexity Tracking
Нет исключений. Общий реестр и текущие factory/repository используются повторно.
