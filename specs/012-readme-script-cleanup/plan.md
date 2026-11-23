# Implementation Plan: README и сокращение команд разработки

**Branch**: `main` | **Date**: 2026-09-07 | **Spec**: [spec.md](spec.md)

**Input**: `specs/012-readme-script-cleanup/spec.md`

## Summary

Заменить исторический обзор features руководством для разработчика на русском: назначение,
полный локальный pilot, env, архитектура, расширения, команды и диагностика. Сократить
корневые scripts только после проверки потребителей; редкие команды документировать через
их исходные Node/Nx entrypoints, сохранив действующие CI-контракты.

## Technical Context

**Language/Version**: Markdown, JSON; существующие TypeScript/Node 24.20.0.
**Primary Dependencies**: pnpm 11.21.0, Nx, Docker Compose, Prettier, ESLint; версии не меняются.
**Storage**: Изменений БД нет; описывается PostgreSQL 18.6 и versioned seed.
**Testing**: Проверка ссылок/команд/env, существующие проверки catalogs, формат, lint/typecheck,
безопасный `dev:pilot -- up --plan` и `docker compose config`.
**Target Platform**: Локальная среда разработчика; корпоративная конфигурация через ссылки на runbooks.
**Project Type**: pnpm/Nx monorepo, API/worker/web и статические расширения.
**Performance Goals**: Не применяются: runtime не изменяется.
**Constraints**: Не удалять реализацию gates, не ломать CI и не обещать отсутствующий provisioning UI.
**Scale/Scope**: README, корневой package.json, связанные инструкции команд и пакет Spec Kit.

## Constitution Check

До исследования: PASS. Изменения редакционные, конституция 2.0.0 не меняется.

- Сохраняются Workspace/Project scope, default-deny, Jira authority, human verdict и approvals.
- Новый Pack подключается статически; Core и Pack не получают прямых provider зависимостей.
- Основной запуск использует локальные adapters; локальная готовность не считается корпоративной.
- Удаление aliases не удаляет conformance tests и audit/evidence gates.

После проектирования: PASS; отсутствующие Workspace UI и полный corporate host явно обозначены.

## Project Structure

### Documentation (this feature)

```text
specs/012-readme-script-cleanup/
├── spec.md
├── checklists/requirements.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/developer-commands.md
├── quickstart.md
└── tasks.md
```

### Source Code (repository root)

```text
README.md                         # основной русскоязычный вход
package.json                      # сокращённый набор scripts
.env.example                      # пояснения загрузки без изменения значений
docs/runbooks/                    # инструкции и замены удалённых aliases
specs/001-*/quickstart.md          # сохранённое имя общего gate
specs/009-*/quickstart.md          # прямой запуск browser-проверки
tests/contract/003/documentation-status.spec.ts # русские формулировки README
```

**Structure Decision**: Сохранить архитектуру tools и runtime. Изменять связанные runbooks
только для согласования удалённых команд. Новые runtime wrappers не нужны.

## Уточнение: разделение настроек окружений

В README сначала описывается реальный NON_PROD: env API/worker, отдельные build-time env web
и env Collector. Все defaults и test fixtures вынесены в docs/runbooks/local-environment.md.
Корневой .env.example явно помечен локальным; docs/deployment/templates/runtime.env.example
содержит сгруппированные настройки корпоративного стенда. Runtime и значения env не меняются.
Проверка: покрытие ключей обоих примеров, ссылки, формат и затронутые documentation contracts.
