# ADR-0005: Hermes как координатор и модель точного Approval

**Статус:** Accepted — Decision 1 partially superseded by ADR-0008
**Дата:** 2026-08-27

**Частичное замещение:** ADR-0008 заменяет в пункте 1 только обязательный Work Item
subject на закрытый `DRAFT | CANDIDATE | WORK_ITEM` union. Остальные положения ADR-0005
сохраняют силу.

## Контекст

Один Hermes координирует QA requests для нескольких проектов, проверяет полноту и рекомендует priority/complexity. Если трактовать его как один глобальный principal с общей памятью или владельца очереди, он получит чрезмерный blast radius и сможет смешивать контекст проектов. Свободное approval вида «разрешить действие» не гарантирует, что исполнен именно показанный человеку effect.

## Решение

1. Hermes является одной логической agent definition/persona. Runtime горизонтально масштабируется; каждый Agent Run создаётся с immutable `workspaceId`, `projectId`, `workItemId`, initiator, skill/rules version и минимальным набором tool grants.
2. Свободная память между Project Scope запрещена. Jira descriptions/comments, GitLab content, Mattermost messages и artifacts считаются untrusted input и не могут изменять policy или grants.
3. Hermes автоматически может читать разрешённый контекст, проверять DoR/completeness, перечислять missing data, формировать plan/priority/complexity recommendations, собирать evidence package, группировать observations в Finding proposal, готовить defect draft и отправлять/ставить в outbox уведомления.
4. Recommendation не является operational state. Она хранится отдельно от Jira-owned/accepted value, содержит объяснение, confidence, facts и input version и становится stale после изменения входов.
5. Complexity представляется не одним scalar, а минимум как диапазон effort, scope breadth, environment/test-data complexity, uncertainty, automation availability и risk severity.
6. Очередь разделена на `Candidate Inbox → Confirmed Backlog → Ready Queue → Active WIP → Completed`. Candidate не запускает SLA и не занимает capacity. Межпроектное представление состоит из project lanes и portfolio view; Hermes предлагает risk/SLA ordering, окончательный override/order утверждает QA Lead.
7. Без второго approval авторизованный пользователь явной командой может запустить зарегистрированный stable smoke suite на разрешённом non-production target. Команда является authorization intent и фиксируется в audit.
8. Создание Jira defect из draft, Jira transition, assignment, изменение priority и due date требуют exact one-time Approval. Approval фиксирует initiator/approver, роль и authorization basis approver, единственную identity `actionKind + actionId`, target, action-specific payload hash (typed payload для Connector effect либо semantic candidate content hash для platform mutation без отдельного payload), expected state, Project Scope, exact binding/profile refs, expiry и idempotency key. Детализация ветвей Connector effect и platform mutation нормативно закреплена в ADR-0007.
9. Изменение target/payload/profile version, external version conflict, отзыв права или expiry аннулируют Approval. Callback из Mattermost является только transport/UI и проходит ту же backend identity/policy validation.
10. Hermes не подписывает QA Verdict, не принимает business priority, committed date, project access, production action или release/no-release решение.
11. LLM outage/invalid output переводит run в controlled failure/fallback и не блокирует deterministic/manual flow.

## Последствия

- Один узнаваемый координатор не означает общую security identity или memory.
- Пользователь видит источник и основания рекомендации и может отличить её от принятого значения.
- Approval можно воспроизвести и доказать как согласие с точным effect.
- Требуются recommendation staleness, policy engine и approval invalidation.
- Hermes не устраняет ответственность QA Lead и исполнителя, а сокращает сбор контекста и механические действия.

## Отклонённые альтернативы

- **Полностью автономный QA manager:** не имеет легитимной власти над бизнес-приоритетом и residual/release risk.
- **Один глобальный agent token/context:** создаёт cross-project leakage и чрезмерный blast radius.
- **Свободный tool calling:** позволяет prompt content выбирать действие и параметры вне typed policy.
- **Blanket approval на skill/run:** человек не подтверждает конкретный внешний effect.
- **Один opaque priority/complexity score:** скрывает несопоставимые входы и создаёт ложную точность.
- **Mattermost approval как самостоятельная авторизация:** обходит backend policy и identity checks.

## Проверки соответствия

- Agent Run не читает и не вызывает tools вне своего Project Scope.
- Prompt injection fixture не расширяет tool grants и фиксируется как policy denial.
- Изменение одного байта payload либо profile version аннулирует pending Approval.
- Duplicate Mattermost callback/Jira webhook выполняет внешний effect ровно один раз.
- Smoke run без явной user command отклоняется; разрешённая команда не требует второго approval.
- Jira defect/transition/assignment/priority/due-date write без exact Approval отклоняется.
- Recommendation становится stale при изменении факта, использованного в расчёте.
- При model timeout completeness/manual/Jira flows продолжаются детерминированно.
- Любая попытка production/release action отклоняется до Connector call.

## Связанные документы

- [Конституция платформы](../../.specify/memory/constitution.md)
- [Master specification v2](../agentic-workspace-platform-master-spec-v2.md)
- [Feature 004: Mattermost and Hermes intake](../../specs/004-mattermost-hermes-intake/spec.md)
- [External integration request v2](../external-systems-integration-request-v2.md)
- [ADR-0007: Action-specific exact Approval](0007-action-specific-exact-approval.md)
- [ADR-0008: Exact subject union for pre-acceptance Agent Runs](0008-agent-run-subject-union.md)
