# Implementation Plan: Hermes service
**Branch**: `main` | **Date**: 2026-09-10 | **Spec**: [spec.md](spec.md)

## Summary
Отдельный stateless Node host обрабатывает шаг диалога. API читает разрешённый snapshot в короткой транзакции, вызывает Hermes вне блокировки, затем повторно проверяет права/version и сохраняет результат и receipt. Hermes вызывает OpenAI-compatible Chat Completions через существующий PinnedNetworkTransport; только draft + message, без tools и общей памяти. При ошибке — исходный локальный сценарий.

## Technical Context
**Language/Version**: TypeScript 6, Node 24.20.0, pnpm 11.21.0.
**Primary Dependencies**: существующий runtime-composition, Node HTTP, Nest API, PinnedNetworkTransport. Новых внешних пакетов нет.
**Storage**: существующие PostgreSQL project_registration_dialogues / project_dialogue_commands; сервис без DSN и миграций.
**Testing**: Vitest HTTP/model boundary и PostgreSQL integration; Docker image smoke, tsc, eslint, architecture.
**Target Platform**: Linux Docker и локальная разработка.
**Project Type**: внутренний web service.
**Performance Goals**: модель до 2 секунд, внутренний HTTP до 3 секунд (жёсткий максимум 5 секунд).
**Constraints**: ограниченные body/response, secret files, точный origin, запрет redirect, schema/identity validation. Production LLM только HTTPS + утверждённые CIDR/policy срок. Локальная модель fixture только в тесте.
**Scale/Scope**: первая QA установка, project dialogue, Mattermost project context и QA intake с явным подтверждением Jira; автономные Agent Runs вне scope.

## Constitution Check
PASS до и после дизайна, 3.1.0: сервис не является глобальным principal, не получает БД и connector credentials; предрегистрационный диалог не притворяется AgentRun с выдуманным projectId. Человек и DB authority остаются в API. Модель выдаёт только proposal, не изменяет RBAC/approvals/Jira/verdict. Запись идемпотентна и versioned; outage имеет локальный fallback. История остаётся в PostgreSQL, отдельной миграции нет. Корпоративная сетевая policy не ослабляется. Новый ADR с изменением инварианта не требуется.

## Project Structure
Документы: spec.md, plan.md, research.md, data-model.md, contracts/hermes.v1.md, quickstart.md, tasks.md, validation.md.
Исходники: apps/hermes/src/{main,server}.ts; packages/runtime-composition/src/hermes/{service-contract,service-config,service-client,project-model}.ts; apps/api/src/extensions/onboarding/project-dialogue.controller.ts; infra/deploy/compose.workspace.yml; infra/compose/docker-compose.local.yml; docs/deployment/hermes-service.md.
**Structure Decision**: общий reviewed образ с отдельной командой Hermes; HTTP сервер использует библиотечный порт без знания auth sessions. API-Hermes secret принадлежит только внутреннему соединению; модель имеет отдельный secret и network policy.

## Scope update — Mattermost, без RAG
Read-only ask и explicit test slash-команды идут в отдельный API adapter. Secret slash token, exact team/channel/connection, verified external_principal_binding и deny-aware currentAuthority. Один endpoint выбирает проект по уникальной конфигурации team/channel; сообщения не выбирают authority. Обычный bootstrap /awp не меняется. Сервис получает только bounded typed ProjectContext (карточка, исходная причина регистрации, stage/capability и количества опубликованных QA refs); никакого поиска или history. API повторно проверяет identity, permissions и context hash после модели, затем existing client_request_idempotency + QaIntakeDraftService.createInTransaction сохраняют один черновик. Ответ синхронный ephemeral, response_url игнорируется, отдельного внешнего POST нет. Это новый transport read/draft interface, не ослабление существующих signed callback contracts.

Preview показывает точную карточку и Jira target; HMAC ticket связан с автором, binding и snapshot на 10 минут. Confirm повторно проверяет authority, draft revision, QA policy и connector profile и атомарно ставит одну существующую CommandGateway request.create. Модель не получает signing secret. Полный provider-enabled runtime требуется для исполнения Jira; начальный workspace сохраняет черновик без имитации принятого Work Item.
