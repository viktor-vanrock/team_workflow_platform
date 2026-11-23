# Implementation Plan: Понятное рабочее пространство QA

**Branch**: `codex/013-guided-workspace-ux` | **Date**: 2026-09-08 | **Spec**: [spec.md](spec.md)
**Input**: `specs/013-guided-workspace-ux/spec.md`

## Summary

Заменить локальный экран демонстрации инфраструктуры рабочим каркасом: понятный вход, домашняя страница, навигация, отдельные создание и список QA-запросов. Существующие глубокие разделы сохраняются. Добавить пошаговый intake, явный выбор заявки, отмену устаревших чтений и доступные состояния. Backend и зависимости не меняются.

## Technical Context

**Language/Version**: TypeScript 6, React 19, Node 24.20.0, pnpm 11.21.0.
**Primary Dependencies**: React, Vite 8, MUI 9 через `@awp/platform-ui`; существующие QA UI contributions.
**Storage**: Сессия только в памяти React. Черновики и заявки в существующей PostgreSQL через API. Новых persistent browser credentials нет.
**Testing**: Playwright с реальным Vite и управляемыми HTTP fixtures; Vitest localization/architecture; ESLint, Prettier, tsc, production build; ручной реальный pilot.
**Target Platform**: Современный desktop/mobile браузер, основной локальный pilot.
**Project Type**: Web application in pnpm/Nx monorepo.
**Performance Goals**: Ленивая загрузка рабочих разделов; polling только текущего draft, прекращение при уходе/терминальном результате; не добавлять запросов ко всем проектам.
**Constraints**: Существующие grants и exact confirmation; отсутствие догадок об успехе; контекстная изоляция; русская локализация; keyboard/mobile.
**Scale/Scope**: Общий локальный shell, вход и справка, создание/список/detail, пояснения очереди и каталога; корпоративные маршруты сохраняются.

## Constitution Check

До исследования и после дизайна: PASS.

- I/IV: QA интерфейс остаётся в competency-qa, shell в web, общий визуальный слой в platform-ui; новых runtime/connector связей нет.
- II/V/VI: API, snapshot, idempotency, явная отправка и серверное подтверждение сохраняются; UI не создаёт operational state.
- III: Сессия и grants приходят с сервера; смена context размонтирует старые routes, поздние ответы игнорируются; новые права не выдаются.
- VII/VIII/IX: История, результаты, evidence, exact approvals не меняются; выбор заявки явно привязан к actions.
- X/XII: Локальный pilot использует прежние mocks и сеть. Corporate login/deep links не смешиваются с local.
- XI: Изменения browser presentation, optional UI props; database/API migration не требуется.

## Project Structure

### Documentation

`specs/013-guided-workspace-ux/`: spec.md, checklists/requirements.md, audit.md, plan.md, research.md, data-model.md, contracts/ui.md, quickstart.md, tasks.md, validation.md.

### Source Code

- `apps/web/src/App.tsx`: corporate route dispatch + local app entry.
- `apps/web/src/workspace/`: shell, persona entry/help, client navigation, existing developer tools, route rendering.
- `apps/web/src/routes/projects/project-catalog.tsx`: понятное назначение project stage и восстановление после ошибки.
- `apps/web/src/routes/qa/queue-workspace.tsx`: пояснения очереди, управление loading.
- `packages/platform-ui/src/workspace-theme.tsx`: общие theme/baseline, доступные размеры и typography.
- `packages/competency-qa/src/ui/intake.tsx`: immutable review, pending/result/recovery.
- `packages/competency-qa/src/ui/contribution.tsx`: request list/detail/create views, explicit selection and scope keys.
- `packages/competency-qa/src/ui/confirmed-backlog.tsx`: open action, human summary, optional diagnostics.
- `packages/competency-qa/src/ui/queue-workspace.tsx`: busy guards, empty state and optional diagnostics.
- `tests/e2e/013/workspace-browser.spec.ts`: observable journeys/race regressions.
- Existing localization registry/browser journeys updated for intentional navigation changes.

**Structure Decision**: Reuse installed MUI through platform-ui; no router dependency. A small browser history subscription handles same-origin navigation inside the shell while keeping tokens in memory. Scope-bound routes remount when persona/context changes. QA components own request selection and form semantics.

## Complexity Tracking

No constitutional exceptions or new infrastructure. Administrative workflow engines and corporate API changes are out of scope.
