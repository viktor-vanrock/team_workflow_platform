# ADR-0002: Jira как первая operational authority

**Статус:** Accepted  
**Дата:** 2026-08-27

## Контекст

Запрос может быть обнаружен вручную, через Mattermost или по Jira/GitLab event. Платформа хранит QA-specific state, но не должна становиться вторым task tracker и расходиться с Jira по status, assignee, priority или due date. Прямые вызовы Jira из domain code делают conflict handling, audit и замену Connector непоследовательными.

## Решение

1. Candidate сначала попадает в `Candidate Inbox`. Он не потребляет WIP/capacity и не запускает SLA.
2. Candidate становится принятым Work Item только после явного user confirmation и идемпотентного создания новой либо import/binding существующей `QA Request` в центральном Jira project из разрешённого issue type/JQL scope. Source Jira issues остаются context links и не заменяют центральную QA Request. Фактические Jira identity/version обязательны.
3. Jira канонически владеет workflow/status, assignee, priority, due date и Jira-native links/comments. Platform projection является read model и всегда показывает freshness/sync state.
4. Platform канонически владеет Intake Draft/Candidate metadata, QA Sessions, session plan/checklist, Attempts, Findings, Evidence Manifest, residual risk, approvals, Agent Runs и human sign-off.
5. Все Jira reads/writes идут через типизированный `JiraPort`, Connector Broker и Jira Connector. Domain Core, QA Pack, UI и Hermes не используют Jira SDK напрямую.
6. Jira write использует expected version/value, durable command/outbox, idempotency key и audit. Успех подтверждается Jira read или webhook; requested value не становится canonical до подтверждения.
7. Conflict прекращает write, обновляет projection и требует нового решения/approval для изменившегося эффекта. Human change в Jira имеет приоритет над stale projection.
8. При недоступной Jira Candidate/Draft можно сохранить, но нельзя объявить принятым Work Item или имитировать успешное operational transition.
9. QA Work Item может перейти в завершённое Jira-состояние при QA verdict `FAIL`: Jira completion сообщает о завершении QA-работы, а verdict — о результате продукта.

## Последствия

- Команды сохраняют существующие Jira workflow, историю и отчётность.
- UI и worker обязаны явно работать с pending/conflict/stale состояниями.
- Webhook inbox и reconciliation являются обязательными, а не оптимизацией.
- Platform outage не блокирует ручную работу в Jira; после восстановления projection пересобирается.
- Jira outage ограничивает приём новых подтверждённых запросов, но не уничтожает drafts и QA evidence.

## Отклонённые альтернативы

- **Platform как основной task tracker:** создаёт конкурирующий lifecycle и двусторонние конфликты.
- **Dual-master синхронизация:** не даёт детерминированного правила разрешения конфликтов.
- **Mattermost как intake/source of truth:** message delivery и edit history недостаточны для operational authority.
- **Optimistic local mutation без Jira confirmation:** показывает пользователю состояние, которого во внешней системе нет.
- **Прямой Jira SDK в Pack/Hermes:** обходит policy, idempotency, audit и version checks.

## Проверки соответствия

- Contract test доказывает создание ровно одного Jira issue при duplicate submit.
- Duplicate/out-of-order webhook не создаёт effect и не откатывает projection.
- Stale expected version возвращает conflict и не выполняет blind overwrite.
- Поиск по repository не обнаруживает Jira SDK imports вне Jira Connector package.
- При Jira 429/5xx UI показывает pending/error, outbox сохраняется, duplicate issue отсутствует.
- Reconciliation восстанавливает projection из Jira без platform-side status invention.
- E2E закрывает Work Item с verdict `FAIL`, не преобразуя verdict в PASS.

## Связанные документы

- [Конституция платформы](../../.specify/memory/constitution.md)
- [Master specification v2](../agentic-workspace-platform-master-spec-v2.md)
- [Feature 003: Jira operational authority](../../specs/003-jira-operational-authority/spec.md)
- [External integration request v2](../external-systems-integration-request-v2.md)
