# Исследование

## Основной запуск и env

**Решение**: Использовать `dev:pilot:up` как основной сценарий; foundation оставить дополнительным.
**Основание**: `tools/local/pilot-cli.mts` выбирает полный QA/Jira/GitLab/Mattermost, очередь,
onboarding и Collector; `tools/local/local.mts` собирает образ, применяет migrations и seed.
**Альтернативы**: Старый foundation не показывает все текущие возможности; ручной запуск всех
процессов требует отдельной БД/CA/env и не подходит как первый шаг.

`loadEnvironment()` читает process.env. Compose передаёт явный environment; корневой `.env`
используется только для подстановок Compose, а pilot launcher переопределяет перечисленные
в нём переменные. PostgreSQL не публикует host-порт. `.env.example` не является готовым
способом подключить host-процесс к Compose БД.

## Термины и расширение

**Решение**: Отдельные инструкции для Workspace платформы, Project, pnpm/Nx пакета и Pack.
**Основание**: Workspace создаётся local seed, публичного Workspace provisioning UI/API нет.
Project регистрируется через `/api/v1/workspaces/:workspaceId/projects` с текущими правами и
step-up. Seed версионируется, повтор уже применённой версии не добавит новый Workspace.
Для нового пакета нужны pnpm manifest, Nx project, TS alias и архитектурный registry.
**Альтернативы**: Инструкция «добавить папку» неполна; «создать Workspace в UI» неверна.

Исследованы `src/seed/local-seed.ts`, `src/security/local-security.ts`,
`src/qa/composition.ts`, `src/extensions/composition.ts` в runtime-composition,
`apps/api/src/extensions/onboarding/`, `tools/architecture/dependency-rules.mts`.

## Очистка scripts

**Решение**: Удалять вспомогательные aliases без исполняемых потребителей и дубликаты,
сохранять aliases, обязательные для CI и строгих catalogs. Для каждого удаления сохранить
точную команду запуска в руководстве миграции; проверить ссылки в активных runbooks.
**Основание**: Исходно 268 scripts. Feature 003–008 проверяют часть имён команд; GitHub CI
использует `ci:003` и `verify:003:evidence`. Одно совпадение префикса не означает избыточность.
**Альтернативы**: Удалить все numbered scripts — сломать contracts; перенести весь набор в
новый dispatcher — добавить лишний слой tooling вместо очистки.

Независимое исследование scripts и Workspace выполнено research agents в фазе speckit-plan.
Открытых архитектурных вопросов нет.
