# Запрос на подготовку внешних систем для QA-first запуска Agentic Workspace Platform

**Версия:** 2.0  
**Статус:** draft для согласования пилота  
**Область:** один QA Workspace, ограниченный набор пилотных проектов  
**Архитектурная модель расширения:** Competency Packs + независимые Connector Types + versioned Connector Profiles  
**Ключевой принцип:** Jira является operational source of truth для рабочих задач после их создания

---

## 1. Назначение документа

Документ определяет, что должны подготовить владельцы корпоративных систем для QA-first пилота Agentic Workspace Platform.

Он разделяет:

1. prerequisites для local-first разработки, не требующие корпоративных систем;
2. входные данные для спецификаций реальных connectors;
3. gate подключения ограниченного non-prod пилота;
4. gate production deployment платформы.

Документ не требует до начала пилота:

- подключения Analytics или Technical Writing;
- подключения всех продуктовых проектов;
- подготовки отдельного объектного хранилища;
- готовности реального model provider;
- доступа QA automation к product production;
- выдачи платформе глобальных административных прав.

---

## 2. Зафиксированная граница QA-first пилота

Пилот включает:

- один `QA Workspace` для функциональной команды тестирования;
- один центральный Jira project для QA requests;
- ограниченный список source Jira projects, содержащих исходные development/product issues;
- project-scoped Jira Defect Profiles для создания подтверждённых дефектов;
- ограниченный список GitLab projects и существующих test suites;
- Mattermost guided intake и уведомления;
- manual и automated Test Sessions;
- единый Project Registry с project-scoped Integration Bindings;
- corporate identity, Workspace membership и ProjectEntitlements;
- audit, logs, metrics и traces для интеграционных действий.

QA Pack предоставляет ровно один Work Type пилота — `qa.validation`. Один QA Work Item может иметь несколько отдельных `MANUAL` и `AUTOMATED` Test Sessions; mode всегда относится к Session, а не создаёт новый Work Type.

Количество пилотных проектов определяется фактической готовностью, а не архитектурным максимумом.

- [PILOT INPUT REQUIRED] Название и key центрального QA Workspace.
- [PILOT INPUT REQUIRED] Владелец QA Workspace и заместитель.
- [PILOT INPUT REQUIRED] Список из 1–3 пилотных Project Registry entries.
- [PILOT INPUT REQUIRED] QA Lead, который принимает pilot scope и результаты.
- [PILOT INPUT REQUIRED] Измеримые цели пилота и baseline: intake lead time, время до начала тестирования, доля связанных результатов, число duplicate external effects, иные KPI.

Численные KPI устанавливаются после baseline. Они не ослабляют жёсткие guardrails пилота:

- `0` cross-workspace/cross-project disclosures;
- `0` unauthorized external writes;
- `0` duplicate Jira issues/defects/pipeline effects из-за retry/replay;
- `100%` external writes имеют audit и correlation ID;
- `100%` финальных human verdicts имеют проверяемую signed evidence chain.

---

## 3. Архитектурные правила интеграций

### 3.1. Competency Pack и Connector Types

`QA Competency Pack` владеет:

- Work Type `qa.validation` и его intake schemas;
- Test Session, Automation Attempt, Finding, Defect Link и Suite Binding;
- QA UI/API/events;
- Definition of Ready и Definition of Done;
- QA approval policies/action definitions и agent skills.

Platform Core владеет Approval lifecycle, exact payload/version binding, policy enforcement, idempotency и audit. QA Pack не может обойти Core Approval Gateway.

Connector Types не содержат QA business logic. Они предоставляют логические capabilities:

```text
jira:
  work-tracker.discovery
  work-tracker.issue.read
  work-tracker.issue.create
  work-tracker.issue.comment
  work-tracker.issue.link
  work-tracker.issue.transition
  work-tracker.webhook
  work-tracker.reconciliation

gitlab:
  source-context.read
  test-executor.trigger
  test-executor.status
  artifact.ci-read
  test-executor.webhook

mattermost:
  guided-intake.command
  notification.send
  approval.callback.optional
```

В MVP Connector Types и QA Pack регистрируются статически и версионируются в monorepo. Hot loading, no-code marketplace и динамическая установка кода не входят в пилот.

### 3.2. Connection, Connector Mapping, Connector Profile и Project Integration Binding

`Connection` содержит endpoint, environment, service identity reference, TLS/network configuration и health state.

`Connector Mapping` — отдельная schema-bound immutable revision с exact Connector ref, classification и content hash. Core не интерпретирует vendor/domain mapping payload. Published Profile ссылается на Mapping через exact `{id, version}` и фиксирует проверенный `mappingContentHash`; изменение mapping требует новой Mapping и Profile revisions.

`Connector Profile` ограничивает конкретное использование Connection:

- external project/channel scope;
- разрешённые operations;
- field/status/result mappings;
- allowlists;
- policy и data classification;
- webhook/reconciliation settings;
- schema version.

`Project Integration Binding` является generic versioned contract и связывает Project с опубликованными profiles через typed capabilities/logical roles:

```text
workspaceId
projectId
version
state: DRAFT | VALIDATED | PUBLISHED | RETIRED
entries[]:
  capabilityKey
  exactContractVersion
  logicalRole
  environmentScope
  classificationCeilingKey
  profileRef { id, version }
  externalScope
configurationRefs[] (schema-bound)
resourceRefs[] (schema-bound)
schemaVersion
contentHash
resourceVersion
validationReportId (absent in DRAFT; exact successful immutable report after validation; excluded from contentHash)
```

Core трактует `logicalRole` как opaque Pack-owned key. Пилотная QA projection использует `QA_REQUEST_AUTHORITY`, `SOURCE_CONTEXT`, `DEFECT_DESTINATION`, `TEST_EXECUTION`, `ARTIFACT_SOURCE`, `MESSAGING`, но не превращает их в Core enum. QA-specific environment/suite/artifact-policy semantics хранятся в QA Pack Project Context и могут ссылаться из Core через generic schema-bound refs. Jira, GitLab и Mattermost names остаются только в Connector Profiles/external scopes, поэтому будущая интеграция добавляется новой capability/profile mapping без изменения contract.

Profile выбирается детерминированно по Workspace, Project, capability, logical role и environment. Если не найден ровно один активный совместимый binding, операция завершается безопасной ошибкой и не выбирает profile по догадке.

Каждая Connection/Mapping/Profile/Binding revision после DRAFT pin’ит exact successful immutable Validation Report с matching scope, subject version и content hash; provenance ref исключён из semantic content hash. Published binding является immutable configuration. Отдельный platform-owned Project state хранит `onboardingStage=DRAFT|VALIDATING|SHADOW|PILOT_ACTIVE`, `qaCapabilityMode=MANUAL_ONLY|FULL_QA` и `projectOperationalState=ACTIVE|SUSPENDED`. External command pin’ит exact binding/profile refs и транзитивную Connection/Mapping chain; перед effect он повторно проверяет текущие mode/state и fingerprints. Suspension не переписывает binding history.

### 3.3. Обязательные и optional connectors

Для пилота обязательны Connector Types:

1. Jira;
2. GitLab;
3. Mattermost.

Обязательность Connector Type означает, что его согласованный pilot scenario должен быть реализован и проверен. Она не означает, что отказ одного connector останавливает весь QA Workspace.

Feature-scoped degradation:

| Недоступная capability | Что блокируется                                                           | Что продолжает работать                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jira write/read        | Создание/изменение Jira-owned Work Items и authoritative close transition | Intake Draft, существующие QA Sessions/evidence с явной pending/stale-marking; ручная работа в Jira остаётся доступна независимо и позже reconciles |
| GitLab test executor   | Новые automated Test Sessions и status sync                               | Intake, Jira workflow, manual Test Sessions, defect drafts, просмотр уже сохранённых artifact metadata                                              |
| Mattermost             | Chat intake, chat notifications и callbacks                               | Web intake, Jira workflow, QA UI, manual и automated sessions                                                                                       |
| Model provider         | Model-assisted suggestions                                                | Все deterministic и manual flows                                                                                                                    |
| GitLab artifact bytes  | Доступ после истечения GitLab retention                                   | Metadata, checksum, provenance и audit без платформенной копии bytes                                                                                |

Отдельное object storage не входит в первую версию; реальный model provider остаётся optional для QA pilot.

OIDC, Vault и observability являются platform plumbing, а не QA-specific connector dependencies.

Project capability и operational state задаются независимо:

- `qaCapabilityMode=MANUAL_ONLY` — Jira/manual QA доступны, validated GitLab suite binding отсутствует;
- `qaCapabilityMode=FULL_QA` — manual QA плюс validated GitLab automated validation;
- `projectOperationalState=ACTIVE|SUSPENDED`; при `SUSPENDED` новые writes/launches запрещены, история и расследование доступны, а предыдущий capability mode сохраняется до повторной проверки при resume.

Mattermost обязателен как pilot Connector Type, но его временная недоступность включает web fallback и не меняет QA mode.

---

## 4. Этапы и gates

### 4.1. Gate L0 — local-first development

Разработка platform core, QA Pack и connector contracts начинается без корпоративных endpoints и credentials.

Обязательны:

- stateful Mock Jira;
- stateful Mock GitLab;
- stateful Mock Mattermost;
- fake OIDC issuer;
- fake deterministic model provider;
- metadata-only manual evidence и GitLab artifact fixtures без object-store emulator;
- сценарии duplicate/out-of-order webhook, rate limit, timeout, permission denied и schema drift;
- seed одного QA Workspace и нескольких Project Registry entries;
- fake ProjectEntitlements с разными project scopes.

Внешние команды не являются блокером Gate L0.

### 4.2. Gate C1 — readiness для спецификации реального connector

До фиксации plan/tasks для конкретного real connector требуется metadata package, но не production credential.

Минимум:

- тип и версия внешней системы/API;
- non-prod endpoint или документированный API contract;
- утверждённая auth strategy;
- sample metadata/payloads без secrets;
- pilot scope и owner;
- expected permissions;
- rate-limit и webhook guarantees;
- data classification;
- известные ограничения.

### 4.3. Gate N2 — real non-prod connector

Для подключения real non-prod требуются:

- отдельная non-prod Connection;
- non-human service identity;
- Vault secret reference;
- ограниченный Connector Profile;
- network/TLS reachability;
- test webhook/callback;
- contract test evidence;
- credential revoke procedure;
- named system owner и incident contact.

### 4.4. Gate P3 — controlled QA pilot

Пилот включается только для опубликованных Project Integration Bindings. Новый проект не наследует доступ автоматически от QA Workspace.

Рекомендуемый rollout:

1. read/discovery и dry run;
2. Jira create/comment/link для одного проекта;
3. manual Test Session;
4. один GitLab smoke suite;
5. Mattermost guided intake и notification;
6. безопасные Hermes suggestions/comments;
7. дополнительные проекты по одному onboarding package за раз.

### 4.5. Gate R4 — production deployment платформы

Production deployment платформы не означает разрешение тестировать или изменять product production.

До Gate R4 необходимы:

- отдельные production Connections и credentials;
- security review и least-privilege evidence;
- backup/restore и reconciliation rehearsal;
- production rollout/rollback и kill switches;
- support/on-call ownership;
- retention и audit approval;
- verified environment isolation;
- запрет GitLab deployment jobs и product-production target environments в QA MVP profiles.

---

## 5. Corporate identity и ProjectEntitlements

### 5.1. Canonical human identity

Canonical platform principal определяется парой:

```text
(OIDC issuer, OIDC subject)
```

Email, display name и username не являются стабильным primary key.

Необходимо предоставить:

- [PILOT INPUT REQUIRED] OIDC issuer для non-prod.
- [PILOT INPUT REQUIRED] Immutable subject claim.
- [PILOT INPUT REQUIRED] Claims для login, display name и email, если разрешено.
- [PILOT INPUT REQUIRED] Groups/roles claims.
- [PILOT INPUT REQUIRED] Deactivation/offboarding semantics и ожидаемое время отзыва доступа.

### 5.2. Workspace membership и project access

Один QA Workspace не означает автоматический доступ ко всем проектам.

Backend authorization проверяет:

```text
Workspace membership/role
AND ProjectEntitlement
AND action policy
AND data-classification clearance
AND Connector Profile scope
```

ProjectEntitlement обязателен для каждого project-scoped доступа. До пилота необходимо определить:

- источник: OIDC group, explicit grant или hybrid;
- project role/action grants;
- owner выдачи доступа;
- expiration/review date;
- revoke/offboarding process;
- правила emergency access;
- audit requirements.

Connector Profile, JQL, channel membership и UI hiding не заменяют backend authorization.

### 5.3. External user bindings

Для действий, требующих external user reference, поддерживаются verified bindings:

```text
Platform principal -> Jira accountId
Platform principal -> GitLab userId
Platform principal -> Mattermost userId
```

Автоматическое связывание только по email или display name запрещено.

- [PILOT INPUT REQUIRED] Identity mapping owner.
- [PILOT INPUT REQUIRED] Approved verification method для каждого external system.
- [PILOT INPUT REQUIRED] Поведение при missing или conflicting binding.

### 5.4. Service identities

Платформа использует non-human service identities и не хранит user PAT/tokens.

Общие правила:

- отдельные credentials для каждого environment;
- credentials находятся только в Vault/secret manager;
- agent/model не получает raw credentials;
- human initiator фиксируется в audit;
- external write выполняется service identity;
- scopes ограничены pilot projects/channels;
- expiration, rotation и emergency revoke обязательны.

Если external system требует delegated user impersonation, это отдельное security decision и не входит в default pilot.

---

## 6. Canonical QA intake

### 6.1. Источники intake

Пилот поддерживает:

- web intake через authenticated platform UI;
- guided Mattermost intake через `/awp create` и bot DM;
- allowlisted Jira/GitLab event discovery, создающий только Candidate для последующего подтверждения;
- обязательный controlled import существующей QA Request из центрального Jira project по строгому Connector Profile/JQL/issue-type policy.

Source Jira issue или GitLab MR являются context references, но не заменяют центральную QA Request issue. Jira/GitLab event не создаёт Work Item автоматически: Hermes уведомляет пользователя, а `CREATE|SNOOZE|IGNORE` проходит тот же versioned confirmation flow.

### 6.2. Intake lifecycle

```text
DRAFT
-> VALIDATING
-> NEEDS_INFO | READY_FOR_CONFIRMATION
-> CONFIRMED
-> OPERATIONAL_CREATE_PENDING
-> LINKED

Alternative:
-> FAILED_RETRYABLE
-> FAILED_FINAL
-> CANCELLED

Direct Jira QA Request:
CENTRAL_JIRA_ISSUE_CREATED
-> WEBHOOK_OR_RECONCILIATION
-> SCOPE_AND_IDEMPOTENCY_VALIDATION
-> IMPORTED_AND_BOUND
-> COMPLETENESS_CHECK
```

Flow:

1. Идентифицировать пользователя.
2. Показать только Project Registry entries, доступные по ProjectEntitlement.
3. Зафиксировать обязательный canonical `projectId` из Project Registry.
4. Собрать QA request type, goal/scope, source references, build, environment, roles, risk, test-data metadata, desired date и evidence references.
5. Детерминированно выбрать Project Integration Binding.
6. Выполнить schema/policy/readiness validation.
7. Получить read-only Jira/GitLab context через bound profiles.
8. Показать пользователю target Jira project/issue type и полный confirmation summary.
9. Подтвердить конкретную draft version.
10. Создать Jira issue через outbox/idempotent command.
11. Подтвердить создание повторным чтением Jira или webhook.
12. Закрыть draft и создать Work Item projection/external binding.
13. Отправить Mattermost notification в channel того же project scope.

LLM не выбирает Project Integration Binding, не обходит required fields и не создаёт Jira issue без policy-defined confirmation.

### 6.3. Минимальные QA intake fields

- Project Registry entry;
- QA request type;
- goal и acceptance outcome;
- source Jira issue/MR/build/commit references;
- target environment;
- test scope;
- roles/permissions needed;
- test-data readiness metadata;
- risk/criticality;
- desired due date;
- attachments/evidence references;
- requester;
- security classification.

- [PILOT INPUT REQUIRED] Required/optional matrix для центрального QA Request issue type.
- [PILOT INPUT REQUIRED] Project-specific mappings/дополнения к базовому DoR и versioned waiver policy. Базовый DoR из master/feature specification не является внешним выбором.
- [PILOT INPUT REQUIRED] Кто может подтвердить incomplete/high-risk intake.

---

## 7. Jira

### 7.1. Jira topology пилота

Используются три разных profile roles.

#### Central QA Request Profile

Создаёт и синхронизирует QA Request в одном центральном QA project.

- [PILOT INPUT REQUIRED] Jira base URL и edition/API version для non-prod.
- [PILOT INPUT REQUIRED] Central QA project key.
- [PILOT INPUT REQUIRED] QA Request issue type ID/name.
- Controlled import обязателен; `[PILOT INPUT REQUIRED]` — import JQL, issue type, project discriminator и field mappings.
- [PILOT INPUT REQUIRED] JQL scope.
- [PILOT INPUT REQUIRED] Field/status/priority/identity mappings.

#### Source Project Profiles

Дают read-only context и позволяют создавать согласованные links из QA Request в исходные issues.

- [PILOT INPUT REQUIRED] Allowlisted source project keys.
- [PILOT INPUT REQUIRED] Allowed source issue types.
- [PILOT INPUT REQUIRED] Read/JQL scopes.
- [PILOT INPUT REQUIRED] Allowed link types и direction.

Source profile по умолчанию не разрешает edit/transition/comment исходной development issue.

#### Defect Profiles

Создают дефекты только после QA confirmation.

- [PILOT INPUT REQUIRED] Defect target project для каждого Project Registry entry.
- [PILOT INPUT REQUIRED] Defect issue type и mandatory fields.
- [PILOT INPUT REQUIRED] Defect workflow/status mapping.
- [PILOT INPUT REQUIRED] QA Request/Test Session link type.
- [PILOT INPUT REQUIRED] Duplicate search policy.
- [PILOT INPUT REQUIRED] Роль, подтверждающая создание defect.

Defect Profile отделён от Central QA Request Profile, даже если они используют одну Connection.

### 7.2. Jira source of truth

После создания issue Jira владеет:

- status;
- assignee;
- reporter/requester representation;
- priority;
- due date;
- workflow;
- comments;
- issue links.

Platform хранит projection, sync state, mapping/profile version, QA domain extensions, agent runs, approvals и audit.

Любая запись Jira-owned field:

1. проходит backend authorization и policy check;
2. использует expected version/current value, где возможно;
3. получает idempotency key;
4. записывается в outbox;
5. выполняется Jira connector;
6. подтверждается re-read или webhook;
7. фиксируется в audit как requested и confirmed value.

### 7.3. Jira service identity scopes

Минимально необходимые права для exact pilot projects:

- Browse Projects/View Issues;
- read metadata, fields, priorities, statuses и transitions;
- Create Issues в central QA project;
- Edit только mapped fields;
- Add Comments только по profile policy;
- Create Issue Links только allowlisted types;
- Transition только allowlisted transitions;
- Create Issues в defect project только через approval-controlled Defect Profile;
- user lookup только через согласованный scoped mechanism, если требуется identity mapping;
- read changelog только при явной необходимости reconciliation/conflict handling.

Не выдаются runtime identity:

- Jira global/project administrator без отдельного обоснования;
- Delete Issues;
- Manage Users/Global Permissions;
- workflow/field configuration changes;
- arbitrary attachment access;
- доступ к projects вне published profiles.

Sandbox cleanup выполняет отдельная janitor/admin процедура, а не runtime identity.

- [PILOT INPUT REQUIRED] Jira auth mechanism и service identity owner.
- [PILOT INPUT REQUIRED] Permission evidence/export для каждого profile scope.
- [PILOT INPUT REQUIRED] Reporter/requester model: verified Reporter mapping или service Reporter + mapped requester field.

### 7.4. Jira webhooks и reconciliation

Требуемые события в пределах profile scope:

- issue created/updated/transitioned/assigned;
- comment created/updated, если comment sync включён;
- issue linked/unlinked;
- deletion/archive signal, если доступен.

Webhook требования:

- raw-body signature или утверждённая platform-specific verification;
- connection-bound secret;
- secret rotation procedure;
- event ID либо stable payload hash;
- timestamp/replay window, если поддерживается;
- retry policy и timeout;
- source network allowlist как дополнительная, но не единственная защита;
- duplicate и out-of-order handling;
- manual test delivery/replay method.

Reconciliation обязателен даже при webhook-first sync:

- incremental JQL/cursor;
- projection freshness target;
- mapping/schema drift check;
- conflict detection;
- rate budget/backoff;
- alert на sustained lag/error.

- [PILOT INPUT REQUIRED] Jira webhook capabilities и signature mechanism.
- [PILOT INPUT REQUIRED] Reconciliation frequency и JQL incremental strategy.
- [PILOT INPUT REQUIRED] Jira API rate budget.

### 7.5. Jira non-prod acceptance

- [ ] Metadata discovery работает для central, source и defect profiles.
- [ ] Dry run показывает target project/type/fields без write.
- [ ] Одна QA Request создаётся и подтверждается re-read/webhook.
- [ ] Duplicate submit не создаёт вторую issue.
- [ ] Source link создаётся только разрешённого типа.
- [ ] Устаревшая команда завершается conflict, а не blind overwrite.
- [ ] Defect не создаётся до QA approval.
- [ ] Runtime identity не может удалить issue или изменить Jira configuration.
- [ ] Webhook duplicate/out-of-order не откатывает projection.
- [ ] Reconciliation восстанавливает пропущенное update.

---

## 8. GitLab и нормализованный QA pipeline contract

### 8.1. Назначение

GitLab используется для:

- чтения project/MR/commit/build context;
- запуска существующих allowlisted test pipelines;
- получения normalized status;
- чтения artifact metadata/links;
- связи pipeline с QA Work Item и Test Session.

Платформа не изменяет repository, `.gitlab-ci.yml`, protected branches или deployment configuration.

### 8.2. GitLab Project Profile

Для каждого Project Registry entry требуется отдельный profile:

- [PILOT INPUT REQUIRED] GitLab base URL и API version.
- [PILOT INPUT REQUIRED] Numeric project ID и canonical path.
- [PILOT INPUT REQUIRED] Default/allowed refs.
- [PILOT INPUT REQUIRED] Pipeline trigger mechanism.
- [PILOT INPUT REQUIRED] Allowlisted suites.
- [PILOT INPUT REQUIRED] Allowed target environments: DEV/TEST/PREPROD subset.
- [PILOT INPUT REQUIRED] Allowed browsers/devices.
- [PILOT INPUT REQUIRED] Runner owner, image, network scope и concurrency.
- [PILOT INPUT REQUIRED] Artifact retention/max size/access model.

Product production environments и deployment jobs не входят в QA pilot allowlist.

### 8.3. Нормализованный trigger contract

Exact transport может использовать GitLab variables/API fields, но логическая request schema версионируется. Значения ниже иллюстративны и не являются corporate inputs:

```json
{
  "contractVersion": 1,
  "workspaceId": "uuid",
  "projectId": "uuid",
  "workItemId": "uuid",
  "jiraIssueKey": "QA-123",
  "testSessionId": "uuid",
  "correlationId": "uuid",
  "idempotencyKey": "opaque-stable-key",
  "bindingRef": { "id": "binding-uuid", "version": 3 },
  "profileRef": { "id": "gitlab-profile-uuid", "version": 2 },
  "suiteId": "registered-suite-id",
  "suiteVersion": "immutable-version-or-commit",
  "suiteHash": "sha256:...",
  "environmentId": "environment-uuid",
  "environmentRevision": 7,
  "browser": "chromium",
  "sourceIssueKey": "PROD-42",
  "mergeRequestRef": "project-id!123",
  "commitSha": "full-immutable-sha",
  "buildRef": "immutable-build-reference",
  "testDataRef": "opaque-versioned-reference",
  "accountLeaseRef": "opaque-expiring-reference",
  "scopeSnapshotHash": "sha256:...",
  "triggerSource": "user|agent|schedule"
}
```

Требования:

- неизвестные fields/values отклоняются согласно versioning policy;
- suite, environment, browser и ref проверяются по profile allowlist;
- arbitrary variables, commands, URLs и secrets не принимаются;
- один idempotency key не запускает второй pipeline;
- pipeline metadata содержит Work Item/Test Session/correlation references;
- retry использует исходный request key и отдельный attempt number;
- cancellation и timeout имеют определённую семантику.

### 8.4. Нормализованный result contract

Pipeline публикует machine-readable result. IDs и числа ниже иллюстративны:

```json
{
  "contractVersion": 1,
  "idempotencyKey": "opaque-stable-key",
  "attempt": 1,
  "result": "PASS|ASSERTION_FAILED|INFRA_FAILED|TIMEOUT|CANCELLED|INCOMPLETE",
  "retryable": false,
  "errorCode": null,
  "pipelineId": 1001,
  "jobId": 2001,
  "commitSha": "...",
  "buildRef": "...",
  "startedAt": "...",
  "finishedAt": "...",
  "durationSeconds": 120,
  "summary": {
    "total": 20,
    "passed": 19,
    "failed": 1,
    "skipped": 0
  },
  "artifacts": []
}
```

`ASSERTION_FAILED` и `INFRA_FAILED` определяются только детерминированными technical codes/rules. Semantic verdict, flaky classification, residual risk и release recommendation подтверждает QA.
Поле `retryable` является только provider hint; право на retry определяет platform policy по canonical `INFRA_FAILED` и allowlisted error code.

Automatic retry:

- максимум один раз;
- только для allowlisted `INFRA_FAILED` codes;
- никогда для `ASSERTION_FAILED`;
- audit связывает оба attempts;
- превышение resource/cost limit запрещает retry.

- [PILOT INPUT REQUIRED] Versioned variable mapping в GitLab.
- [PILOT INPUT REQUIRED] Result/error-code taxonomy и owner.
- [PILOT INPUT REQUIRED] Retryable infrastructure codes.
- [PILOT INPUT REQUIRED] Timeout, concurrency, cancellation и cost/resource limits.

### 8.5. GitLab service identity scopes

Разрешаются только:

- read project metadata;
- read repository default/allowed refs и MR metadata;
- trigger exact allowlisted pipeline;
- read pipeline/job status;
- read artifact metadata/download link;
- receive/verify webhook через отдельный endpoint.

Не разрешаются:

- push code;
- create/merge MR;
- edit CI configuration;
- read secret CI variable values;
- modify protected branches;
- run deployment jobs;
- access projects вне profile.

Для пилота предпочтителен project access token/bot вместо broad group token.

- [PILOT INPUT REQUIRED] Auth mechanism, token scopes, owner, expiration и rotation.
- [PILOT INPUT REQUIRED] Кто отдельно настраивает webhooks, если runtime token не имеет admin scope.

### 8.6. GitLab webhook и acceptance

Webhook события:

- pipeline status;
- job status при необходимости normalized result;
- optional MR event только для bound project enrichment.

Webhook проверяется по secret/signature, external project ID, connection/profile scope, event ID и replay policy.

- [ ] Platform читает bound project/MR/commit metadata.
- [ ] Только allowlisted suite/ref/environment запускается.
- [ ] Duplicate command/webhook не создаёт второй Test Session/pipeline effect.
- [ ] Product failure и infrastructure error различаются по contract.
- [ ] Один allowlisted infra retry работает, второй запрещён.
- [ ] Product-production target/deploy job недоступен.
- [ ] Artifact metadata/links доступны только project-entitled user.
- [ ] GitLab outage не блокирует manual Test Session и Jira workflow.

---

## 9. Mattermost guided Hermes intake

### 9.1. Scope пилота

Mattermost является обязательным pilot Connector Type для:

- guided creation of Intake Draft;
- missing-information prompts;
- create/status notifications;
- links back to platform/Jira.

Mattermost не является source of truth. Недоступность Mattermost не блокирует web intake, Jira или QA execution.

Approval callbacks и direct suite commands включаются только после отдельного security acceptance.

### 9.2. Guided flow

```text
/awp create
-> verify command signature and Mattermost user binding
-> resolve ProjectEntitlements
-> choose/confirm project
-> choose QA request type
-> collect required structured fields
-> Hermes deterministic/model-assisted completeness suggestion
-> show target Jira project/type and final summary
-> explicit confirmation of draft version
-> platform submits idempotent Jira create command
-> return Jira/platform link asynchronously
```

Hermes может использовать deterministic rules без real model provider. Model-assisted wording/classification является optional.

Запрещено:

- создавать Jira issue из произвольного chat message без confirmation;
- принимать project/profile только из free text;
- читать всю историю channel без явного approved use case;
- публиковать чувствительные descriptions/evidence в public channel;
- выполнять `/smoke <project>` без существующего Work Item/Test Session, project authorization и allowlisted GitLab profile;
- считать Mattermost username/email достаточным identity binding.

### 9.3. Mattermost Project Profile

Для каждого pilot project:

- [PILOT INPUT REQUIRED] Mattermost team ID.
- [PILOT INPUT REQUIRED] Intake channel ID и classification.
- [PILOT INPUT REQUIRED] Notification channel ID и classification.
- [PILOT INPUT REQUIRED] Lead/escalation channel ID.
- [PILOT INPUT REQUIRED] Public/private status и allowed audience.
- [PILOT INPUT REQUIRED] Allowed commands и notification templates.
- [PILOT INPUT REQUIRED] Mention/quiet-hours/digest policy.
- [PILOT INPUT REQUIRED] Разрешены ли interactive approval callbacks.

Предпочтителен отдельный project intake channel. Общий channel допустим только при явном project selection, одинаковой data classification и отсутствии раскрытия данных между ProjectEntitlements.

### 9.4. Mattermost bot и callbacks

Требования:

- отдельный bot/service credential per environment;
- membership только в bound channels;
- signing secret/token через Vault;
- signature validation over raw payload;
- timestamp/replay window;
- immediate acknowledgement + async result;
- verified Mattermost user ID -> OIDC principal binding;
- current Workspace role/ProjectEntitlement revalidation для каждого action;
- single-use, expiring callback nonce для approvals;
- full audit of initiator, project, draft/action version и result;
- approval callback привязан к exact action, action-specific payload hash (полный typed payload для Connector effect либо semantic candidate content hash для platform mutation без отдельного payload), target, expected state (external version/state для Connector effect либо candidate resource version/content hash + aggregate current-state snapshot для platform mutation), Project Binding/Profile version, actor, approver role/authorization basis, expiry и idempotency key; backend повторно проверяет всё перед effect.

Один bot для нескольких pilot projects допустим только при одинаковой classification и доказанном channel isolation. Иначе создаются отдельные instances/bots.

### 9.5. Mattermost acceptance

- [ ] Bot работает только в allowlisted pilot channels.
- [ ] Guided intake создаёт Draft, но не Jira issue до confirmation.
- [ ] Пользователь видит только разрешённые проекты.
- [ ] Повтор callback/command не создаёт duplicate issue/action.
- [ ] Notification уходит только в channel bound project.
- [ ] Подмена Mattermost user ID/expired callback отклоняется.
- [ ] При outage web/Jira/manual QA остаются доступны.

---

## 10. OIDC, Vault и observability как platform plumbing

### 10.1. Corporate OIDC

Для non-prod и production регистрируются отдельные clients.

- [PILOT INPUT REQUIRED] Issuer URL, client ID и JWKS endpoint для non-prod.
- [PILOT INPUT REQUIRED] Redirect/post-logout URIs.
- [PILOT INPUT REQUIRED] Confidential/public client mode, PKCE и secret delivery.
- [PILOT INPUT REQUIRED] Scopes, claims и group mapping.
- [PILOT INPUT REQUIRED] Session/access/refresh token lifetime.
- [PILOT INPUT REQUIRED] Deactivation and group-change propagation SLA.

Fake OIDC физически отключается в production configuration.

### 10.2. Vault / secret manager

Требуются secret references, например:

```text
/awp/<env>/jira/<instance-key>
/awp/<env>/gitlab/<instance-key>
/awp/<env>/mattermost/<instance-key>
/awp/<env>/oidc
/awp/<env>/object-storage/<instance-key>
/awp/<env>/model-provider/<instance-key>
/awp/<env>/webhook-secrets/<connector>/<instance-key>
```

Требования:

- platform service identity читает только необходимые paths;
- list других namespaces запрещён;
- secrets не попадают в repository, DB, logs, audit payloads, prompts или artifact URLs;
- runtime refresh/rotation поддерживается без раскрытия secret;
- доступ к secrets аудируется;
- emergency revoke проверяется в non-prod;
- fallback при недоступности Vault является fail-closed либо использует явно утверждённый short-lived cache; plaintext fallback запрещён.

- [PILOT INPUT REQUIRED] Secret manager product/endpoint/auth method.
- [PILOT INPUT REQUIRED] Path owner и access policy approver.
- [PILOT INPUT REQUIRED] Rotation/expiration/revoke SLA.

### 10.3. Observability

Минимальные logs/metrics/traces обязательны даже без подключения всех corporate backends.

Каждая цепочка содержит:

- workspaceId;
- projectId;
- actor ID/service identity ID;
- Connection/Connector Profile version;
- Jira key/pipeline ID/message reference;
- correlation/trace/idempotency IDs;
- duration/result class/retry count;
- redacted error code.

Минимальные alerts:

- Jira/GitLab/Mattermost connection unavailable;
- repeated 401/403/429/5xx;
- webhook/outbox backlog;
- projection freshness breach;
- duplicate/replay rejection spike;
- runner unavailable;
- artifact publication/access failure;
- worker/PostgreSQL unavailable;
- cross-project authorization denial anomaly.

- [PILOT INPUT REQUIRED] Log ingestion endpoint/index/retention/masking policy.
- [PILOT INPUT REQUIRED] Prometheus scrape/push model, labels, dashboard owner и alerts channel.
- [PILOT INPUT REQUIRED] OTLP endpoint, sampling и sensitive-payload policy.
- [PILOT INPUT REQUIRED] Support/on-call contacts.

---

## 11. Evidence, artifacts и data controls

### 11.1. Default storage

Для CI-generated pilot evidence default — GitLab Artifacts:

- machine-readable result;
- JUnit/JSON report;
- Playwright report;
- trace;
- screenshots/video on failure, если разрешено;
- console/network evidence после redaction;
- Newman report.

Platform хранит metadata/link, а не копирует тяжёлые файлы по умолчанию.

### 11.2. Mandatory artifact metadata

Каждый artifact descriptor содержит:

- type;
- source project/pipeline/job;
- Work Item/Test Session;
- owner;
- checksum/integrity value;
- created/expiry time;
- retention class;
- security classification;
- access policy;
- content scan/redaction status;
- current availability state.

Expired artifact отображается как expired metadata record, а не исчезает без следа.

### 11.3. Evidence security decisions

- [PILOT INPUT REQUIRED] Допустимые data classifications для Jira descriptions, GitLab logs и Mattermost messages.
- [PILOT INPUT REQUIRED] Может ли evidence содержать PII/customer data.
- [PILOT INPUT REQUIRED] Правила удаления cookies, authorization headers, tokens и secrets из trace/network/console logs.
- [PILOT INPUT REQUIRED] Screenshot/video redaction или запрет для чувствительных environments.
- [PILOT INPUT REQUIRED] Malware/quarantine/content scanning standard.
- [PILOT INPUT REQUIRED] Retention по artifact type/classification.
- [PILOT INPUT REQUIRED] Кто имеет право download и share artifact.
- [PILOT INPUT REQUIRED] Legal/audit hold requirements.

### 11.4. Test accounts и test data

Project Registry хранит только metadata и opaque references.

Запрещено хранить в Registry, Intake Draft, agent memory, Mattermost или prompts:

- passwords;
- access tokens;
- cookies/session exports;
- raw customer datasets;
- secret test-data values.

- [PILOT INPUT REQUIRED] Test-account provisioning/broker mechanism.
- [PILOT INPUT REQUIRED] Test-data creation/reset/masking owner и procedure.
- [PILOT INPUT REQUIRED] Expiration/review для access metadata.
- [PILOT INPUT REQUIRED] Какие роли/fixtures доступны каждому pilot project/environment.

---

## 12. Artifact storage boundary первой версии

В первой версии действует только `GITLAB_ONLY`. GitLab хранит CI artifact bytes,
а платформа хранит scoped metadata, checksum, provenance, retention status и audit.
Платформа не копирует bytes и не принимает произвольные binary attachments.

Если GitLab не удовлетворяет retention, size, immutability или access requirements,
это блокирует соответствующий сценарий либо становится отдельной будущей feature.
Нельзя неявно добавить bucket, credentials или второй storage authority в v1.

---

## 13. Optional Hermes model provider

Guided Hermes intake должен работать с deterministic schema/rules без real model provider.

Real provider включается только для согласованных optional scenarios:

- completeness wording/suggestion;
- risk/suite recommendation;
- summarization;
- structured draft assistance.

Provider не выполняет deterministic connector operations и не расширяет tool permissions.

До включения требуется:

- [PILOT INPUT REQUIRED] Provider/runtime endpoint и owner.
- [PILOT INPUT REQUIRED] Model IDs, limits, timeout/rate/cost budget.
- [PILOT INPUT REQUIRED] Allowed data classifications и data residency.
- [PILOT INPUT REQUIRED] Retention/training/logging policy.
- [PILOT INPUT REQUIRED] Prompt injection/content boundary policy.
- [PILOT INPUT REQUIRED] Fallback/disable procedure.

Безопасность:

- provider не получает Jira/GitLab/Mattermost/Vault credentials;
- restricted content не передаётся в неутверждённый контур;
- external Jira/MR/artifact content считается untrusted input;
- Tool Gateway валидирует structured actions, scope, policy, rate limit и idempotency;
- critical action требует approval;
- timeout/invalid output не блокирует manual flow.

Отсутствие real provider не блокирует QA pilot.

---

## 14. Network, DNS, TLS и runtime

### 14.1. Inbound

Разрешаются только environment-specific routes:

- Jira webhook -> platform Jira endpoint;
- GitLab webhook -> platform GitLab endpoint;
- Mattermost command/callback -> platform Mattermost endpoint;
- user browser/OIDC redirect -> web/API;
- approved probes -> health/metrics endpoints.

### 14.2. Outbound

- worker -> allowlisted Jira endpoint;
- worker -> allowlisted GitLab endpoint;
- worker -> allowlisted Mattermost endpoint;
- platform -> OIDC/JWKS;
- platform -> Vault;
- platform -> observability endpoints;
- Hermes runtime -> approved model endpoint only if enabled;
- Hermes runtime -> platform Tool Gateway; no direct Jira/GitLab/Mattermost credentials or unrestricted egress.

### 14.3. Required metadata

- [PILOT INPUT REQUIRED] DNS names и callback URLs per environment.
- [PILOT INPUT REQUIRED] Platform outbound IP/network ranges.
- [PILOT INPUT REQUIRED] TLS certificate/rotation и corporate CA chain.
- [PILOT INPUT REQUIRED] Proxy settings/exclusions.
- [PILOT INPUT REQUIRED] Firewall owners/change lead time.
- [PILOT INPUT REQUIRED] Request/body size/timeouts.
- [PILOT INPUT REQUIRED] Non-prod namespace, registry, PostgreSQL, backup и maintenance owner.

---

## 15. Environment matrix

| Capability/System | Local                         | Integration test        | Non-prod pilot                   | Preprod                                       | Production platform                                   |
| ----------------- | ----------------------------- | ----------------------- | -------------------------------- | --------------------------------------------- | ----------------------------------------------------- |
| Jira              | Mock Hub                      | Mock Hub contract tests | Restricted Jira sandbox/projects | Restricted production-like profiles           | Separate production instance/profile; least privilege |
| GitLab            | Mock Hub                      | Mock Hub contract tests | Exact pilot projects/runners     | Production-like runner/profile without deploy | No product-production/deploy capability in QA MVP     |
| Mattermost        | Mock Hub                      | Mock Hub contract tests | Pilot channels/bot               | Preprod channels/bot                          | Separate production bot/profile                       |
| OIDC              | Fake issuer                   | Fake issuer             | Corporate test IdP               | Corporate preprod IdP                         | Corporate IdP; fake auth disabled                     |
| Secrets           | Local test secrets only       | Ephemeral CI secrets    | Corporate Vault non-prod         | Corporate Vault preprod                       | Corporate Vault production                            |
| Artifacts         | Mock GitLab metadata/bytes    | CI artifacts            | GitLab Artifacts                 | GitLab Artifacts                              | GitLab Artifacts for v1                               |
| Model             | Fake deterministic provider   | Fake scenarios          | Optional approved provider       | Optional                                      | Optional approved provider                            |
| Observability     | Local logs/optional collector | CI logs/traces          | Corporate non-prod stack         | Corporate preprod stack                       | Corporate production stack                            |

Для каждого environment Connections, credentials, webhooks и profiles создаются отдельно. Production connection не может быть выбран local/non-prod profile.

---

## 16. Per-project onboarding package

Каждый pilot project подключается отдельным versioned package.

### 16.1. Project Registry

- [PILOT INPUT REQUIRED] Project key/name/description.
- [PILOT INPUT REQUIRED] Business owner, technical owner, QA owner.
- [PILOT INPUT REQUIRED] Security classification.
- [PILOT INPUT REQUIRED] Allowed QA members/groups или ProjectEntitlement source.
- [PILOT INPUT REQUIRED] DEV/TEST/PREPROD references и owners.
- [PILOT INPUT REQUIRED] Test accounts/data metadata references.
- [PILOT INPUT REQUIRED] Last/next verification dates.

### 16.2. Jira package

- central QA profile ID/version и mapping;
- allowed source projects/JQL/link types;
- defect target/profile ID/version/approval;
- fields/statuses/transitions/priorities;
- identity mapping rules;
- webhook/reconciliation scope;
- permission evidence;
- rate/known limitations.

### 16.3. GitLab package

- numeric project ID/path/default/allowed refs;
- GitLab profile ID/version;
- existing suite IDs and owner;
- normalized input/result contract mapping;
- runner/environment/network readiness;
- token scope evidence;
- webhook configuration;
- artifact policy;
- retry/error taxonomy.

### 16.4. Mattermost package

- team/channel IDs and classification;
- Mattermost profile ID/version;
- bot membership evidence;
- Mattermost user binding method;
- allowed commands/templates;
- notification/escalation policy;
- callback/signature/replay policy.

### 16.5. Data and acceptance package

- onboarding stage, effective `qaCapabilityMode` и `projectOperationalState`;
- evidence classification/redaction/retention;
- test-account/test-data procedure;
- project-specific DoR/DoD exceptions;
- happy-path acceptance case;
- permission-denied case;
- outage/retry case;
- named acceptance owner.

Integration Administrator готовит и валидирует binding; QA Lead фиксирует functional acceptance. Publish/retire требует exact approval Workspace Owner с `project.admin` entitlement и separation of duties. Emergency suspend разрешён Integration Administrator как fail-safe explicit command с reason/incident/audit; resume требует probes, incident disposition и exact Workspace Owner approval.

---

## 17. Pilot reference inputs

Следующий блок должен быть заполнен до Gate P3.

```text
QA Workspace key: [PILOT INPUT REQUIRED]
QA Workspace owner: [PILOT INPUT REQUIRED]
Pilot start/end dates: [PILOT INPUT REQUIRED]
Pilot KPI/baseline/target: [PILOT INPUT REQUIRED]

Central QA Jira project: [PILOT INPUT REQUIRED]
Central QA issue type: [PILOT INPUT REQUIRED]
Central QA workflow owner: [PILOT INPUT REQUIRED]

Pilot Project Registry entries: [PILOT INPUT REQUIRED]
Source Jira projects per entry: [PILOT INPUT REQUIRED]
Defect Jira project/profile per entry: [PILOT INPUT REQUIRED]
GitLab project/suite per entry: [PILOT INPUT REQUIRED]
Mattermost channels per entry: [PILOT INPUT REQUIRED]

OIDC non-prod owner/issuer: [PILOT INPUT REQUIRED]
Vault non-prod owner/endpoint: [PILOT INPUT REQUIRED]
Observability owner/endpoints: [PILOT INPUT REQUIRED]
Security/data owner: [PILOT INPUT REQUIRED]
On-call/support channel: [PILOT INPUT REQUIRED]

ProjectEntitlement source/group-to-project grant mapping: [PILOT INPUT REQUIRED]
Test case/plan source of truth: [PILOT INPUT REQUIRED]
Artifact classification/retention: [PILOT INPUT REQUIRED]
Product-production access explicitly disabled: [PILOT INPUT REQUIRED]

Optional S3 enabled and rationale: [PILOT INPUT REQUIRED]
Optional real model enabled and rationale: [PILOT INPUT REQUIRED]
```

---

## 18. Readiness checklists

### 18.1. Local-first readiness

- [ ] QA Pack и connector contracts можно разрабатывать без VPN/corporate endpoints.
- [ ] Mock Jira/GitLab/Mattermost/fake OIDC поднимаются воспроизводимо.
- [ ] Project-scoped profiles и entitlements представлены в seed data.
- [ ] Canonical intake работает end-to-end с mocks.
- [ ] Manual и automated Test Session scenarios работают.
- [ ] Duplicate/out-of-order/rate-limit/outage/conflict scenarios воспроизводимы.
- [ ] Real model/S3 не требуются.

### 18.2. Real connector specification readiness

- [ ] Для connector получены API/version/auth metadata и sample payloads.
- [ ] Logical capability contract и adapter boundary утверждены.
- [ ] Required operations/scopes и forbidden operations перечислены.
- [ ] Profile schema/versioning/error mappings определены.
- [ ] Webhook verification/replay/reconciliation правила определены.
- [ ] Data classification и audit requirements определены.
- [ ] Contract tests существуют против Mock Hub.

### 18.3. Non-prod QA pilot readiness

- [ ] Заполнен Pilot Reference Inputs block.
- [ ] Опубликованы bindings только для approved pilot projects.
- [ ] OIDC principal и ProjectEntitlements проверены.
- [ ] Jira central/source/defect profiles проходят discovery/dry run.
- [ ] GitLab normalized pipeline contract проходит contract test.
- [ ] Mattermost guided draft требует explicit confirmation.
- [ ] Service identities имеют separate non-prod minimal scopes.
- [ ] Secrets находятся в Vault и emergency revoke проверен.
- [ ] Webhook signatures/replay/dedup/out-of-order проверены.
- [ ] Evidence redaction/classification/access/retention согласованы.
- [ ] Manual fallback и connector kill switches проверены.
- [ ] Audit trace восстанавливает цепочку user -> draft -> binding -> external calls -> result.
- [ ] S3/model absence не блокирует pilot.

### 18.4. Per-project onboarding readiness

- [ ] Project Registry metadata и owners заполнены.
- [ ] ProjectEntitlements и data-classification grants утверждены для каждого пилотного principal/project; всеобщий доступ выражен только явными entitlement grants.
- [ ] Jira source/defect scopes ограничены.
- [ ] GitLab project/suite/environment allowlists утверждены.
- [ ] Mattermost channels/classification утверждены.
- [ ] Test accounts/data metadata готовы без raw secrets.
- [ ] Happy path, permission denial и outage acceptance evidence приложены.
- [ ] Binding version approved и rollback target известен.

### 18.5. Production platform readiness

- [ ] Отдельные production identities/credentials/instances созданы.
- [ ] Fake auth и local profiles физически отключены.
- [ ] Product-production GitLab environments/deploy jobs недоступны.
- [ ] Least-privilege review не выявил broad admin/group scopes.
- [ ] Backup/restore/reconciliation rehearsal завершён.
- [ ] Rollout, rollback, profile disable и credential revoke проверены.
- [ ] SLO/alerts/on-call/support ownership утверждены.
- [ ] Audit/retention/data policies утверждены.
- [ ] Production change request содержит pilot evidence и known limitations.

---

## 19. Ответственность внешних владельцев и платформенной команды

### 19.1. Внешние владельцы предоставляют

- system/API/auth metadata;
- pilot-scoped service identities;
- secret references через Vault;
- project/channel/runner configuration;
- webhook/callback setup;
- network/TLS routes;
- permission evidence;
- data/retention/security decisions;
- test delivery и acceptance evidence;
- owner/support/revoke contacts.

### 19.2. Platform team предоставляет

- callback/webhook URLs;
- connector capability contracts;
- exact requested operation scopes;
- profile schemas и mapping drafts;
- Jira create/source/defect profile templates;
- GitLab normalized input/result contracts;
- Mattermost guided flow/command/callback contracts;
- OIDC claims и identity-binding requirements;
- Vault secret names без values;
- correlation/idempotency conventions;
- Mock Hub scenarios и contract tests;
- non-prod acceptance protocol;
- rollout/rollback/kill-switch procedure.

---

## 20. Формат подтверждения готовности

Для каждой Connection и каждого Project Integration Binding владелец предоставляет:

```text
System / connector type: [PILOT INPUT REQUIRED]
Environment: [PILOT INPUT REQUIRED]
Connection key: [PILOT INPUT REQUIRED]
Owner: [PILOT INPUT REQUIRED]
Technical / revoke contact: [PILOT INPUT REQUIRED]
Base URL / endpoint: [PILOT INPUT REQUIRED]
Service identity: [PILOT INPUT REQUIRED]
Secret reference: [PILOT INPUT REQUIRED]
Allowed external scope: [PILOT INPUT REQUIRED]
Allowed operations: [PILOT INPUT REQUIRED]
Forbidden operations: [PILOT INPUT REQUIRED]
Project Integration Binding/version: [PILOT INPUT REQUIRED]
Webhook/callback verification: [PILOT INPUT REQUIRED]
Reconciliation/fallback: [PILOT INPUT REQUIRED]
Network/TLS status: [PILOT INPUT REQUIRED]
Data classification/retention: [PILOT INPUT REQUIRED]
Contract and acceptance evidence: [PILOT INPUT REQUIRED]
Known limitations: [PILOT INPUT REQUIRED]
Expiration/rotation date: [PILOT INPUT REQUIRED]
Rollback/disable procedure: [PILOT INPUT REQUIRED]
Readiness decision: [PILOT INPUT REQUIRED]
```

Незаполненный production confirmation не блокирует local-first development. Он блокирует только включение соответствующей real Connection/Connector Profile в production.

---

## 21. Итоговый pilot gate

QA-first pilot считается готовым, когда:

1. выбран один QA Workspace и ограниченный список pilot projects;
2. ProjectEntitlements и data-classification policy предотвращают cross-project leakage во всех UI/API/search/queue/export paths;
3. central QA Jira issue создаётся ровно один раз и остаётся canonical operational record;
4. source issues читаются/связываются только в allowlisted projects;
5. defect создаётся только через project Defect Profile после QA confirmation;
6. один allowlisted GitLab suite выполняет normalized pipeline contract;
7. Mattermost guided intake создаёт confirmed Draft, а его outage не блокирует web/Jira;
8. OIDC, Vault и observability обеспечивают identity, secret boundary и audit chain;
9. service identities имеют минимальные project-scoped permissions;
10. webhooks проверяются, дедуплицируются и дополняются reconciliation;
11. evidence не раскрывает secrets/PII и доступно только project-entitled users;
12. manual fallback, connector degradation и kill switches проверены;
13. Analytics, Technical Writing, S3 и real model provider не являются условиями pilot readiness.
