# Feature Specification: Pilot Hardening & Conformance

> **Superseded для текущей v1:** Redis/S3 deployment inputs и
> `APPROVED_OBJECT_STORE` заменены PostgreSQL-only delivery и `GITLAB_ONLY` по
> [Feature 010](../010-remove-redis-s3/spec.md) и
> [ADR-0009](../../docs/adr/0009-v1-without-redis-s3.md).

**Feature ID:** `008-pilot-hardening-and-conformance`  
**Статус:** Локальная реализация и аудит; корпоративная сборка T025 и стендовая приёмка остаются открыты. Актуальные доказательства и статусы — в tasks.md и docs/runbooks/pilot-deployment-checklist.md.

**Приоритет:** P1  
**Зависимости:** `001`–`007`  
**Основные пользователи:** Platform Operator, Security Engineer, QA Lead, Product Owner, Pilot Sponsor

**Планирование:** [plan.md](plan.md), [tasks.md](tasks.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/README.md),
[quickstart.md](quickstart.md), [входные данные пилота](pilot-inputs.md).
Локальная инженерная готовность и фактическое прохождение корпоративного пилота
учитываются отдельно; локальный PASS не заменяет N2/P3 и наблюдаемый pilot review.

## Purpose

Подготовить QA-first платформу к ограниченному корпоративному пилоту: заменить локальные адаптеры реальными binding-профилями, доказать безопасность и восстановимость, проверить деградацию интеграций, зафиксировать baseline и принять решение о расширении использования.

## Scope

Спецификация закрывает hardening, conformance и пилотный rollout. Она не добавляет новые компетенции и не превращает пилот в production-wide rollout.

## User Scenarios & Testing

### Scenario 1 — Bind corporate infrastructure (P1)

Оператор подключает корпоративные OIDC, Vault-compatible secret store и observability stack, не меняя доменную логику или контракты feature-спек.

**Independent test**: пройти login, получить scoped secret в connector runtime и проследить одну заявку через trace/log/metric/audit correlation.

**Acceptance scenarios**:

1. Локальные adapters заменяются конфигурацией deployment profile, а не изменением доменной модели.
2. Секрет не появляется в UI, логах, событиях, evidence или persisted business state.
3. Один correlation ID связывает intake, Work Item, Jira write, session, evidence и notification.

### Scenario 2 — Survive connector failures predictably (P1)

Во время пилота Jira, GitLab, Mattermost или model provider становятся недоступны. Платформа применяет feature-scoped degradation и не подтверждает невыполненную внешнюю запись.

**Independent test**: выполнить fault-injection для каждого обязательного connector type и проверить матрицу деградации.

**Acceptance scenarios**:

1. Недоступность Mattermost сохраняет web/Jira работу и ставит уведомления в retry/outbox.
2. Недоступность GitLab запрещает новые automated sessions, но не ручные проверки.
3. Недоступность Jira блокирует authoritative write transitions, сохраняя drafts и диагностику.
4. Недоступность модели включает deterministic fallback и не блокирует управляемый человеком процесс.

### Scenario 3 — Prove security and tenant isolation (P1)

Security Engineer запускает негативные и adversarial тесты на cross-workspace/cross-project доступ, replay, forged approvals, webhook spoofing и утечки секретов.

**Independent test**: выполнить утверждённый security test pack и получить ноль успешных несанкционированных операций.

### Scenario 4 — Restore service without corrupting authority (P1)

Оператор восстанавливает платформу из резервной копии и повторно синхронизирует внешние системы. Idempotency и reconciliation не создают дублей Jira issues, defects или test runs.

**Independent test**: backup/restore в изолированном пилотном контуре с replay входящих событий.

### Scenario 5 — Run and evaluate the pilot (P1)

QA-команда выполняет реальные ручные и автоматические заявки, сначала измеряет baseline текущего процесса, затем сравнивает показатели платформы и проверяет guardrails.

**Independent test**: сформировать pilot report из системных метрик и выборочно подтверждённых операционных данных.

## Deployment Profiles

- **local**: fake Jira/GitLab/MM, локальная identity, in-memory/dev secret references, детерминированный Hermes fallback;
- **integration**: sandbox Jira/GitLab/MM, тестовый OIDC и secret store, реальная доставка webhooks;
- **pilot**: корпоративные Jira/GitLab/MM и OIDC, production-grade secret/observability bindings, ограниченный список проектов и пользователей.

Переход между профилями MUST происходить через конфигурацию и connector bindings. Доменный код и canonical contracts остаются одинаковыми.

## Failure & Degradation Matrix

| Failure | Allowed | Blocked | Recovery behavior |
|---|---|---|---|
| Jira unavailable | draft intake, read cached state with staleness marker, manual notes | create/update authoritative issue, final transition requiring Jira | durable outbox, bounded retries, operator alert, reconciliation |
| GitLab unavailable | manual sessions, review existing evidence | start new automated session, fetch new pipeline result | mark capability degraded, resume only after probe |
| Mattermost unavailable | web intake, Jira-originated flow | chat intake/confirmation/notification delivery | queue notifications with deduplication and expiry |
| Model unavailable | deterministic forms/rules, human decisions | model-generated recommendation only | record fallback reason; no workflow outage |
| Artifact store unavailable | metadata capture, session remains reviewable | claim complete evidence package | retry upload; verdict cannot be finalized without required evidence |
| OIDC unavailable | existing short-lived session per policy | new login, privileged step-up | fail closed when session expires |

## Functional Requirements

### Corporate Bindings

- **FR-008-001**: Платформа MUST поддерживать environment-specific bindings для OIDC, secret store и observability без зависимости домена от конкретного вендора.
- **FR-008-002**: Pilot profile MUST использовать корпоративные Jira, GitLab и Mattermost как обязательные connector types.
- **FR-008-003**: Model provider и artifact store MAY быть отключены, если выбранный сценарий имеет детерминированный fallback и соблюдает evidence policy.
- **FR-008-004**: Конфигурация MUST проходить schema validation и secret-reference validation до запуска.
- **FR-008-005**: Deployment MUST запрещать default/test credentials и небезопасные callback URLs в pilot profile.

### Connector Conformance

- **FR-008-006**: Каждый connector MUST пройти capability, auth, mapping, idempotency, rate-limit, timeout и error-normalization tests.
- **FR-008-007**: Входящие webhooks MUST проверять подпись, freshness, replay key и project binding до создания события.
- **FR-008-008**: Исходящие writes MUST использовать idempotency key, expected version и durable outbox.
- **FR-008-009**: Reconciliation MUST находить missing, duplicate и divergent records, но не исправлять бизнес-решения без контролируемой команды.
- **FR-008-010**: Connector status MUST быть видим оператору на уровне capability и project binding.

### Security Hardening

- **FR-008-011**: Security pack MUST покрывать broken access control, IDOR, cross-project search/cache, forged approval, replay, webhook spoofing, injection и secret leakage.
- **FR-008-012**: Все privileged mutations MUST создавать неизменяемую audit запись с actor, scope, payload hash, decision и correlation ID.
- **FR-008-013**: Одобрение MUST повторно проверять единственную identity `actionKind + actionId`, payload hash, target, action-specific expected state, exact binding/profile refs, initiator/human approver, approver role/authorization basis, Workspace/Project scope, expiry и idempotency перед выполнением; consumption второго action ref запрещён.
- **FR-008-014**: Логи, traces и metrics MUST редактировать secrets, credentials, test data и персональные данные по политике.
- **FR-008-015**: Security scan критичных зависимостей и образов MUST не иметь незакрытых critical findings перед pilot gate.

### Reliability, Backup & Restore

- **FR-008-016**: Workflows MUST быть устойчивы к at-least-once delivery и повторному запуску worker.
- **FR-008-017**: Retry policy MUST быть bounded, классифицированной и не применяться к business/assertion failure.
- **FR-008-018**: Dead-letter items MUST иметь диагностический контекст, owner, возраст и безопасную replay command.
- **FR-008-019**: Backup MUST включать canonical state, audit, binding versions и evidence metadata; секреты резервируются средствами secret store.
- **FR-008-020**: Restore drill MUST подтверждать RPO/RTO, целостность подписей и отсутствие дублирующих внешних записей.
- **FR-008-021**: Disaster recovery и reconciliation MUST сохранять Jira как operational authority.

### Hermes & Skill Quality

- **FR-008-022**: Hermes recommendations MUST быть отделены от human decisions и содержать confidence/reason/source references, когда это применимо.
- **FR-008-023**: Набор эталонных intake/triage/evidence cases MUST проверять полноту, безопасность и отсутствие cross-item context leakage.
- **FR-008-024**: Каждый agent run MUST быть изолирован по workspace, project и точному subject (`DRAFT`, `CANDIDATE` или `WORK_ITEM`); запуск до создания work item не должен требовать фиктивный work item. Переходы subject сохраняют проверяемую lineage.
- **FR-008-025**: Prompt/model change MUST быть версионирован, тестироваться на эталонном наборе и иметь rollback path.
- **FR-008-026**: Model outage or low confidence MUST переводить обработку на deterministic rules/human review, а не останавливать заявку.

### Pilot Operation

- **FR-008-027**: До установки численных целей команда MUST измерить baseline текущего процесса на согласованном наборе заявок.
- **FR-008-028**: Pilot cohort MUST быть ограничен именованными проектами, пользователями, каналами и периодом.
- **FR-008-029**: Pilot dashboard MUST показывать flow time, queue age, SLA, rework, blocked time, automation share, flaky/infra rate и connector reliability.
- **FR-008-030**: Метрики эффективности MUST сопровождаться неизменяемыми guardrails безопасности и целостности.
- **FR-008-031**: Расширение пилота MUST требовать формального review результатов, incidents, operator load и открытых рисков.

## Non-Negotiable Pilot Guardrails

- ноль подтверждённых cross-workspace или cross-project раскрытий;
- ноль несанкционированных внешних write operations;
- ноль дублирующих Jira issues/defects/test runs из-за retry/replay;
- 100% внешних writes имеют audit и correlation ID;
- 100% финальных human verdicts имеют проверяемую evidence chain;
- ни один agent recommendation не становится priority, verdict, defect или release decision без требуемого human action;
- секреты не присутствуют в persisted business state, логах или evidence.

Нарушение любого guardrail останавливает расширение пилота и запускает incident review независимо от показателей скорости.

## Baseline & Pilot Measures

До пилота фиксируются определения, источник и текущие значения:

- время от intake до подтверждённой заявки;
- время до triage и до начала первой сессии;
- полное время QA Request и доля blocked time;
- процент возврата на уточнение;
- доля ручных/автоматических сессий;
- assertion, infra, timeout и flaky-suspected rates;
- число дефектов и доля отклонённых/duplicate findings;
- operator toil и число ручных reconciliation действий;
- доступность и latency каждой connector capability.

Целевые значения и минимальный размер выборки заполняются после baseline и утверждаются pilot sponsor и QA Lead до сравнительной фазы.

## Rollout Gates

1. **Local gate**: все feature acceptance tests проходят на fake connectors.
2. **Integration gate**: sandbox conformance, webhook security и failure injection пройдены.
3. **Security gate**: adversarial pack, dependency/image scans и access matrix пройдены.
4. **Recovery gate**: backup/restore/reconciliation drill пройден в пределах утверждённых RPO/RTO.
5. **Shadow gate**: система обрабатывает копию потока без authoritative writes; расхождения разобраны.
6. **Limited pilot gate**: реальные writes разрешены только pilot cohort с on-call и rollback procedure.
7. **Review gate**: baseline comparison, incidents, guardrails и открытые риски представлены sponsor.

## Success Criteria

- **SC-008-001**: Все обязательные connectors проходят conformance suite в integration и pilot profiles.
- **SC-008-002**: Failure injection подтверждает заявленную feature-scoped degradation без потери canonical state.
- **SC-008-003**: Security pack не находит успешного bypass workspace/project/role/classification boundary.
- **SC-008-004**: Restore drill укладывается в утверждённые после discovery RPO/RTO и не создаёт внешних дублей.
- **SC-008-005**: Каждый pilot Work Item трассируется от intake до Jira, sessions, evidence и notifications по correlation ID.
- **SC-008-006**: Ни один non-negotiable guardrail не нарушен за утверждённый период пилота.
- **SC-008-007**: Pilot report содержит baseline, выборку, результаты, ограничения и обоснованное решение continue/adjust/stop.

## Pilot Inputs Required

- `[PILOT INPUT REQUIRED]` OIDC issuer/client/group mappings и требования step-up authentication.
- `[PILOT INPUT REQUIRED]` Vault/secret-store paths, auth method, rotation and break-glass process.
- `[PILOT INPUT REQUIRED]` Observability endpoints, retention, alert routing и on-call owners.
- `[PILOT INPUT REQUIRED]` Sandbox и pilot endpoints Jira/GitLab/Mattermost.
- `[PILOT INPUT REQUIRED]` Webhook public route, сертификаты и allowlists.
- `[PILOT INPUT REQUIRED]` RPO/RTO, backup location и restore owner.
- `[PILOT INPUT REQUIRED]` Security scanning tools и severity policy.
- `[PILOT INPUT REQUIRED]` Pilot cohort, календарное окно, baseline method и sponsor.
- `[PILOT INPUT REQUIRED]` Incident, rollback, suspension и communications runbooks.

## Out of Scope

- company-wide production rollout;
- новые Competency Packs помимо QA;
- автономные release decisions;
- оптимизация модели по данным без отдельного governance;
- замена Jira, GitLab, Mattermost, IAM или secret-management платформ.
