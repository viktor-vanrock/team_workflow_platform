# ADR-0006: Project Integration Binding, target snapshot и версионирование

**Статус:** Accepted  
**Дата:** 2026-08-27

## Контекст

Один QA Workspace обслуживает несколько проектов, у которых различаются Jira project/workflow, GitLab repository/pipeline, Mattermost channels, environments, suites, credentials и retention. Workspace-wide mutable configuration может направить команду в чужой проект или сделать исторический evidence невоспроизводимым. Jira, GitLab и Mattermost обязательны в pilot deployment, но их одновременная доступность не гарантируется.

## Решение

1. Каждый Project Scope имеет versioned `Project Integration Binding`, связывающий abstract capabilities QA Pack с опубликованными Jira, GitLab и Mattermost Connector Profiles, schema-bound Connector Mappings, environment records, suite bindings и artifact policy.
2. Connection/Mapping/Profile/Binding проходит состояния draft → validated → published → retired. Успешный validate атомарно pin’ит exact immutable Validation Report с matching scope/subject/content hash; failed report оставляет DRAFT без ссылки, а provenance ref исключён из semantic content hash. Published version неизменяема; изменение создаёт новую version. Publish под stable-header lock атомарно retire-ит current и публикует candidate. Retired transitive dependency остаётся доступной только через уже published pin/started effect recovery и не выбирается новым draft. Rollback публикует новую проверенную совместимую version без переписывания истории.
3. Connector credentials хранятся только как secret references и имеют минимальный project/environment scope. Credential value не попадает в Binding, DB dumps, logs, prompt или target snapshot.
4. Candidate discovery разрешена из Mattermost/manual input и Jira/GitLab events, но выбранные Project Scope и Jira binding подтверждаются пользователем до принятия Work Item. Hermes может предложить project, но не подтверждает его самостоятельно.
5. Каждый внешний command фиксирует effective Binding/Profile/Connection chain как exact immutable refs `{id, version}`. Смена effective chain до первого invocation аннулирует Approval либо завершает `NOT_REQUIRED` command как `CONFIGURATION_DRIFT`, всегда без effect; после начала effect recovery использует только прежний pin и тот же idempotency key. Выполненные runs сохраняют фактически использованные refs навсегда.
6. Каждый Attempt создаёт immutable target snapshot: exact Project Integration Binding ref и Connector Profile refs `{id, version}`, source issue/MR refs, build/commit/digest, environment ID/revision, suite/checklist version/hash, test-data/account lease reference и correlation IDs. Живые aliases вроде `latest`, `test` или default branch не являются достаточным snapshot.
7. Production target отсутствует в разрешённых pilot bindings. Запрет дублируется service credential scope, Connector Policy, CI allowlist и network policy.
8. Jira, GitLab и Mattermost должны быть настроены в pilot deployment, но не входят в одну distributed transaction:
   - Jira unavailable: Candidate/Draft сохраняется, принятый Work Item не выдумывается;
   - GitLab unavailable: AUTOMATED Session ожидает/error, MANUAL Sessions продолжаются;
   - Mattermost unavailable: Jira/QA flow продолжается, сообщения остаются в outbox.
9. Pack manifest, Work Type definition, schemas/rules, Connector API, event payload и Profile schema имеют независимые semantic versions. Изменение backward-compatible по умолчанию; breaking change требует migration/compatibility policy, rehearsal, rollback и отдельный ADR.
10. Исторические Work Items/Sessions/Evidence не переинтерпретируются новой definition/profile version. Database breaking changes выполняются expand/contract.
11. Каждый Connector имеет stateful local/test mock и contract suite. Mock воспроизводит success, permission denial, timeout/rate limit/5xx, duplicate/out-of-order event и schema drift, если сценарий поддерживается системой.

## Последствия

- Один Workspace безопасно использует разные project mappings и credentials.
- Evidence можно связать с точной конфигурацией и target, существовавшими во время Attempt.
- Любое profile изменение создаёт версии и compatibility burden вместо тихой mutation.
- Недоступность Mattermost или GitLab деградирует только зависимую часть flow.
- Local development и CI не требуют корпоративных systems, но scheduled contract tests против non-prod sandbox остаются нужны для обнаружения mock drift.

## Отклонённые альтернативы

- **Один Workspace-wide Connector Profile:** не выражает project-specific scopes и увеличивает blast radius.
- **Mutable published profile:** делает audit и воспроизводимость недостоверными.
- **Live lookup без version pin:** исторический run начинает ссылаться на новую конфигурацию.
- **Строковые environment/suite aliases:** допускают запуск на другом target под тем же именем.
- **Одна синхронная транзакция Jira+GitLab+Mattermost:** недостижима без distributed commit и делает notification outage блокирующим.
- **Production flag только в UI:** обходится API/worker и не является security control.
- **Breaking change без migration:** silently reinterpret-ирует historical evidence и pending commands.

## Проверки соответствия

- Published Binding/Profile нельзя обновить in place; новая конфигурация получает новую version.
- VALIDATED/PUBLISHED/RETIRED revision без exact successful `validationReportId` либо с mismatched scope/subject/hash отклоняется; DRAFT не содержит provenance ref.
- Work Item, command, Attempt и Evidence показывают фактически использованные versions.
- Effective chain change аннулирует pending Approval или terminally fails `NOT_REQUIRED` command и никогда не перенаправляет уже подготовленный effect.
- Target snapshot не принимает `latest`, непинованный branch или environment name без revision.
- Connector другого Project Scope недоступен даже при подмене profile ID.
- Jira/GitLab/Mattermost degraded-mode tests подтверждают указанное частичное продолжение flow.
- Local critical E2E проходит только с mocks; real non-prod contract suite обнаруживает schema drift.
- Backward compatibility и migration rehearsal входят в CI/release gate.
- Production target/credential вызывает policy denial до внешнего вызова.

## Связанные документы

- [Конституция платформы](../../.specify/memory/constitution.md)
- [Master specification v2](../agentic-workspace-platform-master-spec-v2.md)
- [Feature 007: Project onboarding, evidence and security](../../specs/007-project-onboarding-evidence-security/spec.md)
- [Feature 008: Pilot hardening and conformance](../../specs/008-pilot-hardening-and-conformance/spec.md)
- [External integration request v2](../external-systems-integration-request-v2.md)
- [ADR-0007: Action-specific exact Approval](0007-action-specific-exact-approval.md)
