# Agentic Workspace Platform

## Master Specification v2 — QA-first

**Статус:** нормативная продуктовая и техническая спецификация / spec-of-specs  
**Редакция:** 2  
**Целевой стек:** TypeScript, NestJS, React, PostgreSQL
**Пилотная компетенция:** QA  
**Пилотные внешние системы:** Jira, GitLab, Mattermost

---

## 1. Назначение и нормативный язык

Документ определяет продуктовую границу, доменную модель, архитектурные инварианты, безопасность, интеграционные контракты, локальный контур и декомпозицию Agentic Workspace Platform на независимые feature-specifications.

Документ является `spec-of-specs`. Он не заменяет `spec.md`, `plan.md` и `tasks.md` отдельных features и не должен передаваться в реализацию целиком.

Слова **ОБЯЗАН**, **ЗАПРЕЩЕНО**, **ДОЛЖЕН** обозначают нормативное требование. Слова **рекомендуется** и **может** обозначают допустимый default или расширение.

Значение `[PILOT INPUT REQUIRED]` обозначает внешний факт, который должна предоставить пилотная организация: URL, ID, field mapping, service identity, лимит, владелец или аналогичный параметр. Это не открытый продуктовый вопрос.

Пометка `[PILOT INPUT REQUIRED] (after baseline)` обозначает числовую цель, которую запрещено выдумывать до измерения согласованного pilot baseline.

---

## 2. Продуктовое видение

Agentic Workspace Platform — внутренняя Jira-centric платформа приёма, маршрутизации, выполнения и контроля рабочих запросов разных функциональных команд.

Платформа унифицирует:

- intake и подтверждение заявки;
- Workspace, роли и доступ;
- Project Registry и доступ к проектам;
- очереди, WIP и SLA;
- внешние подключения и их безопасное использование;
- approvals, audit и observability;
- агентную координацию через Hermes;
- ссылки на результаты и доказательства выполнения.

Платформа не унифицирует доменную работу насильно. Каждая компетенция поставляется как **Competency Pack**, содержащий один или несколько **Work Types**, свои сущности, правила готовности и завершения, UI-вклады и Hermes skills.

Jira является operational source of truth пилота. Архитектурный инвариант Core сформулирован шире: у каждого Work Item существует ровно один активный binding к системе, владеющей его операционным lifecycle. В QA-пилоте такую capability предоставляет только Jira Connector.

---

## 3. Зафиксированный QA-first scope

### 3.1. Входит в пилот

- один центральный Workspace типа `functional_group` для общей QA-команды;
- целевая модель обслуживания нескольких продуктовых проектов из одной очереди;
- reference pilot с одним web/API Project, одним Jira workflow, одним non-production environment, одним stable smoke suite и одним QA Lead, после которого проекты подключаются последовательно;
- ProjectEntitlement как обязательная project-level граница внутри Workspace;
- один Competency Pack `qa`;
- один Work Type `qa.validation`;
- manual и automated Test Sessions в рамках одного QA Work Item;
- центральный Jira project для QA requests;
- ссылки на source issues, Merge Requests, builds и defects продуктовых проектов;
- запуск только зарегистрированных GitLab CI suites в разрешённых non-production environments;
- Mattermost как предпочтительный канал intake, уточнений и уведомлений;
- web UI как полный fallback и административный интерфейс;
- один логический Hermes QA Coordinator с ограниченным каталогом skills;
- deterministic fallback для всех критических операций;
- локально воспроизводимые Jira, GitLab, Mattermost и model scenarios;
- аудит всей цепочки от пользователя до внешнего результата.

### 3.2. Явно не входит в QA-пилот

- Analytics Competency Pack;
- Technical Writing Competency Pack;
- production-grade Analytics или Writing Work Types, forms, workflows и artifacts;
- dynamic plugin loading и установка кода Pack/Connector во время runtime;
- no-code конструктор произвольных workflows;
- замена Jira собственным task tracker;
- полноценный test-case management system с пошаговым исполнением тысяч cases;
- генерация или автоматическое исправление тестового кода;
- автономное создание defects без человеческого подтверждения;
- автоматический product verdict по результату pipeline;
- production deployments или тестовые действия в production;
- произвольные shell-команды агента;
- обязательный процент code coverage.

Analytics и Technical Writing могут быть добавлены после пилота отдельными Packs. Их добавление не должно требовать изменения базовой таблицы Work Item, Connector Framework, Workspace authorization или audit primitives.

### 3.3. Критерий продуктовой ценности пилота

Пилот должен доказать, что одна QA-команда может безопасно обслуживать несколько проектов через единый поток:

```text
Mattermost/Web intake
→ Jira QA Request
→ readiness и triage
→ MANUAL и/или AUTOMATED Test Sessions
→ human review
→ evidence и defects
→ residual risk
→ подтверждённый Jira terminal status
```

---

## 4. Термины

| Термин                    | Определение                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace                 | Жёсткая граница membership, конфигурации, очередей, policies, connections и audit.                                                           |
| Project                   | Обслуживаемый продукт или сервис внутри QA Workspace.                                                                                        |
| ProjectEntitlement        | Явное разрешение principal работать с конкретным Project и набором действий. Membership без entitlement недостаточен.                        |
| Competency Pack           | Статически подключаемый модуль доменной компетенции, содержащий Work Types, сущности, rules, APIs, UI contributions и skills.                |
| Work Type                 | Версионируемое предложение внутри Pack с intake schema, readiness/DoD, capabilities и artifact policy.                                       |
| Intake Candidate          | Обнаруженная потенциальная QA-работа, которая ещё не подтверждена человеком, не создаёт Jira issue и не потребляет SLA/WIP.                  |
| Intake Draft              | Platform-owned черновик до создания центральной Jira QA issue.                                                                               |
| Work Item                 | Нормализованное представление принятой рабочей заявки. Операционный lifecycle принадлежит Jira.                                              |
| Operational Binding       | Runtime-связь Work Item с конкретной Jira issue.                                                                                             |
| Connector                 | Статически зарегистрированная реализация одной или нескольких typed external capabilities.                                                   |
| Connection                | Техническое подключение к экземпляру внешней системы с secret reference и network settings.                                                  |
| Connector Mapping         | Schema-bound immutable revision opaque mapping payload; Core версионирует и хэширует её, а Pack/Connector определяют и валидируют семантику. |
| Connector Profile         | Workspace-scoped правила использования Connection: exact Mapping refs, policies, scopes и error handling.                                    |
| ProjectIntegrationBinding | Версионируемый published package одного Project: Connector Profiles, external scopes, environments, suites и artifact policy.                |
| Test Session              | Самостоятельно исполнимая и проверяемая часть QA scope в режиме MANUAL или AUTOMATED.                                                        |
| Automation Attempt        | Одна идемпотентная попытка запуска зарегистрированного CI suite.                                                                             |
| Evidence Manifest         | Неизменяемая версия метаданных доказательств Test Session; binaries остаются во внешнем storage.                                             |
| Hermes Skill              | Версионируемый ограниченный сценарий с typed input/output, разрешёнными tools и approval policy.                                             |
| Agent Run                 | Аудируемый запуск Hermes Skill с correlation ID.                                                                                             |
| Projection                | Локальная read model внешнего состояния; никогда не является каноном для Jira/GitLab-owned данных.                                           |

---

## 5. Архитектурные принципы

1. **Jira owns pilot operational state.** Статус, assignee, priority, due date и основной lifecycle QA Work Item берутся из Jira.
2. **Workspace is a hard boundary.** Любой use case и query проверяет Workspace membership на backend.
3. **ProjectEntitlement is mandatory.** В одном центральном QA Workspace доступ дополнительно ограничивается Project.
4. **Competency Pack owns domain semantics.** Core не содержит QA-specific root model.
5. **Work Type is not an execution mode.** `qa.validation` допускает несколько MANUAL/AUTOMATED sessions.
6. **Typed connectors, not a universal connector.** Внешние эффекты выражаются через capability-specific ports.
7. **No Pack-to-Connector dependency.** QA Pack не импортирует Jira/GitLab/Mattermost code или vendor SDK.
8. **Static monorepo MVP.** Pack и Connector регистрируются composition root при сборке; runtime code loading запрещён.
9. **Idempotency and audit by default.** Webhook, queue consumer и external write безопасны при повторе.
10. **Human verdict.** Pipeline предоставляет technical outcome; QA verdict и residual risk подтверждает человек.
11. **Human control.** Consequential actions требуют policy-defined approval или явной авторизованной команды.
12. **Deterministic core.** RBAC, entitlement, mappings, sync, queue, SLA, trigger, retry и audit не зависят от LLM.
13. **Local-first.** Каждая pilot integration имеет contract-compatible mock и failure scenarios.
14. **Backward-compatible contracts.** API, events, Work Type definitions, mappings и migrations версионируются.
15. **Secrets and data boundaries.** Credentials не попадают в код, БД, logs, artifacts manifest или prompts.

---

## 6. Статический monorepo и направление зависимостей

```text
packages/platform-contracts
├── packages/competency-sdk
│   └── packages/competency-qa
├── packages/connector-sdk
│   ├── packages/connector-jira
│   ├── packages/connector-gitlab
│   ├── packages/connector-mattermost
│   └── packages/connector-mock
└── packages/platform-core

apps/api | apps/worker | apps/web | apps/mock-hub
└── composition-root
    ├── platform-core
    ├── competency-qa
    └── registered connectors
```

Обязательные правила архитектуры:

- `platform-core` компилируется и тестируется без QA Pack;
- Pack зависит только от `competency-sdk` и стабильных platform contracts;
- Connector зависит только от `connector-sdk` и стабильных platform contracts;
- Pack не импортирует конкретный Connector;
- Connector не импортирует Pack;
- Packs не импортируют друг друга в MVP;
- только composition root знает полный набор Packs и Connectors;
- module-owned tables доступны другим модулям только через application ports;
- architecture tests блокируют запрещённые imports;
- отключение Work Type запрещает новый intake, но сохраняет чтение истории;
- удаление Pack с историческими данными из deployable artifact запрещено без migration/archive procedure.

Runtime-процессы:

- `web` — React UI;
- `api` — synchronous commands, queries, auth и webhook ingress;
- `worker` — outbox/inbox, connector calls, reconciliation, Hermes runs и scheduled jobs;
- `mock-hub` — только local/test;
- PostgreSQL — durable state;
- PostgreSQL — также единственный authority для command delivery, leases, retry и scheduling первой версии.

---

## 7. Границы Core, Pack и Connector Framework

### 7.1. Platform Core владеет

- identity references, Workspace, membership и role bindings;
- Project Registry и ProjectEntitlement;
- Pack/Work Type registration и enablement;
- Intake Candidate и Intake Draft lifecycle;
- базовым Work Item и внешними entity bindings;
- queue, normalized status, WIP и SLA mechanism;
- capability registry и generic assignment contract;
- Connection, schema-bound Connector Mapping, Connector Profile и ProjectIntegrationBinding lifecycle;
- approval, audit, correlation, inbox/outbox и idempotency;
- artifact metadata/access/retention abstraction;
- Agent Runtime, Skill Registry, Tool Gateway и Agent Run;
- versioned API/event envelopes;
- feature flags и operational health.

Core не знает `TestSession`, suite semantics, residual risk, QA DoR/DoD, Jira field IDs, GitLab variables или Mattermost payload shape.

### 7.2. QA Competency Pack владеет

- `qa.validation` definition и versioned intake schema;
- QA request taxonomy;
- QA readiness, DoD и session start guards;
- QaRequestExtension;
- TestSession, PlanItem, Observation, AutomationAttempt, Finding, DefectLink и QA Verdict;
- QA capabilities, permissions и domain events;
- QA-specific project context;
- QA UI routes/tabs и API use cases;
- QA artifact kinds и Evidence Manifest rules;
- QA Hermes skills и structured action schemas;
- Pack-owned migrations, fixtures и conformance tests.

Pack объявляет требуемые connector capabilities, но не выбирает vendor и не получает credentials.

### 7.3. Connector Framework владеет

- typed capability contracts;
- registry Connectors и boot-time compatibility validation;
- Connection/Mapping/Profile schemas;
- secret references и environment boundaries;
- health, discovery, validation и dry-run;
- generic versioned mapping engine;
- command dispatch/status;
- webhook ingress envelope, signature/replay protection;
- retry, backoff, rate limits, inbox/outbox и idempotency;
- reconciliation scheduling;
- integration audit, metrics и traces.

Typed capabilities пилота:

```text
operational-work-item   # Jira
source-context         # GitLab
ci-pipeline            # GitLab
artifact-reference     # GitLab artifacts
messaging              # Mattermost
```

Будущие capabilities, не обязательные пилоту: `artifact-storage`, `identity-provider`, `model-provider`.

Конкретный Connector владеет vendor auth schema, API client, discovery, request/response mapping, error taxonomy, webhook parser и reconciliation cursor. Он не принимает доменные QA-решения.

Connection, Connector Mapping, Connector Profile и ProjectIntegrationBinding проходят `DRAFT → VALIDATED → PUBLISHED → RETIRED`. Published version неизменяема; rollback публикует новую совместимую проверенную version, не переписывая historical bindings/commands.

### 7.4. Владение mapping

- QA Pack объявляет logical fields: `qa.environment`, `qa.build`, `qa.residualRisk` и другие.
- Core хранит published Connector Profile и mapping versions.
- Connector обнаруживает и валидирует external targets: Jira fields/statuses, GitLab projects/jobs, Mattermost channels.
- QA Pack не содержит `customfield_*`, Jira project key или GitLab token scope.
- Connector не решает, обязательно ли logical field по QA DoR.

---

## 8. Workspace, Project и ProjectEntitlement

### 8.1. Центральный QA Workspace

Пилот использует один Workspace:

```text
kind: functional_group
key: qa-central
enabled work types: [qa.validation]
```

Все пилотные продукты представлены отдельными Project Registry entries. Глубокая Workspace hierarchy и cross-workspace handoff не входят в пилот.

### 8.2. Workspace hard boundary

- пользователь обязан иметь active Workspace membership;
- все queries и commands содержат `workspaceId` либо получают его из проверенного entity;
- backend проверяет membership до чтения entity;
- frontend filtering не является security control;
- глобальный администратор не получает автоматический доступ к содержимому Workspace;
- Workspace Agent использует отдельную service identity.

### 8.3. ProjectEntitlement

В одном Workspace membership является необходимым, но недостаточным условием доступа к project-scoped данным.

Нормативная формула доступа: `WorkspaceMembership AND ProjectEntitlement AND RolePermission AND DataClassification`. Любое отсутствующее или несовместимое условие даёт deny; Connector Profile scope является дополнительным ограничением, а не заменой этой формулы.

```typescript
interface ProjectEntitlement {
  id: string;
  workspaceId: string;
  projectId: string;
  principalType: "USER" | "GROUP" | "SERVICE";
  principalId: string;
  effect: "ALLOW" | "DENY";
  permissions: ProjectPermission[];
  classificationCeiling?: string;
  validFrom?: string;
  validUntil?: string;
  source: "MANUAL" | "GROUP_MAPPING" | "BOOTSTRAP";
  createdBy: string;
}
```

Минимальные permissions:

```text
project.request.create
project.request.read
project.queue.read
project.session.create
project.session.execute
project.verdict.sign
project.pipeline.trigger
project.defect.confirm
project.integration.use
project.admin
```

Правила:

- explicit `DENY` имеет приоритет;
- permission проверяется на backend до чтения, записи, tool call и artifact access;
- queue сначала фильтруется по entitlement, затем ранжируется;
- Hermes имеет явные SERVICE entitlements и не наследует доступ пользователя;
- async consumer/scheduled job восстанавливает Workspace/Project scope из durable payload и повторно проверяет grant перед read/write/external effect;
- Mattermost command выполняется с effective permissions отправителя, а не bot user;
- classification artifact не может превышать `classificationCeiling` principal;
- cross-project link и provider URL не передают entitlement; artifact resolve/download повторно проверяет current access, а short-lived URL не является самостоятельным правом;
- wildcard entitlement допускается только как явная запись для QA Lead/authorized service и аудируется.

### 8.4. Роли

| Роль                      | Основные полномочия                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace Owner           | Membership, Work Type enablement, queue/SLA policy, Workspace-scoped profiles; не получает доступ к restricted project content автоматически. |
| QA Lead                   | Cross-project planning, WIP, assignment, expedite/override, DoR/evidence waiver, high-risk verdict и final close approval.                    |
| QA Executor               | Планирование и выполнение разрешённых sessions, evidence, human classification Findings, ordinary verdict и explicit pipeline launch.         |
| Requester                 | Создание/подтверждение drafts, ответы на уточнения, просмотр своих/разрешённых requests.                                                      |
| Project Viewer            | Read-only доступ к явно разрешённому Project; авторство request само по себе не даёт queue/environment/artifact access.                       |
| Hermes service principal  | Не является человеческой ролью; каждый Agent Run получает derived project-scoped tool grants и не может approve действие.                     |
| Integration Administrator | Connections, secrets references и connector health; не получает project content автоматически.                                                |
| Auditor                   | Read-only audit/security events в утверждённом scope.                                                                                         |

Один человек может иметь несколько ролей. QA Executor подписывает обычный Verdict; high/critical Verdict, waiver или policy override подтверждает отличный от инициатора QA Lead.

---

## 9. Project Registry и ProjectIntegrationBinding

### 9.1. Project

Core Project хранит только общие данные:

```typescript
interface Project {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  status: "DRAFT" | "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  businessOwnerId: string;
  technicalOwnerId: string;
  functionalOwnerId: string;
  criticality: string;
  securityClassification: string;
  lastVerifiedAt?: string;
  nextVerificationAt?: string;
  verificationStatus: "CURRENT" | "DUE" | "NEEDS_REVIEW";
}
```

QA-specific context хранится Pack: allowed test environments, role/test-data metadata, suite semantic bindings и verification rules. Credentials и raw test data там запрещены.

### 9.2. ProjectIntegrationBinding

В концептуальных TypeScript-фрагментах используются два разных класса версий:

```typescript
type SemVer = string; // ^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$

interface IntegerVersionRef {
  id: string;
  version: number;
}
```

`SemVer` применяется к Pack/Work Type/contract artifacts; монотонная integer version — к хранимым immutable revisions Connection/Mapping/Profile/Binding.

```typescript
interface ProjectIntegrationBindingVersion {
  bindingId: string;
  workspaceId: string;
  projectId: string;
  version: number;
  state: "DRAFT" | "VALIDATED" | "PUBLISHED" | "RETIRED";
  entries: Array<{
    logicalRole: string; // opaque Pack-owned key, не Core enum
    capabilityKey: string;
    exactContractVersion: string;
    environmentScope: "LOCAL" | "NON_PROD" | "PREPROD" | "PLATFORM_PROD";
    classificationCeilingKey: string;
    profileRef: { id: string; version: number };
    externalScope: SchemaBoundValue;
  }>;
  configurationRefs?: SchemaBoundResourceRef[];
  resourceRefs?: SchemaBoundResourceRef[];
  schemaVersion: number;
  contentHash: string;
  resourceVersion: number;
  validationReportId?: string; // forbidden in DRAFT; exact successful report in later states; excluded from contentHash
  validatedAt?: string;
  publishedAt?: string;
  retiredAt?: string;
}
```

Каждый `externalScope` и generic resource/configuration reference содержит schema ID/version/digest и валидируется соответствующей JSON Schema. Произвольный непроверенный JSON запрещён. QA-specific environment, suite и artifact-policy semantics живут в QA Pack Project Context и ссылаются из Core только через generic schema-bound refs; `suiteBindingRefs`/`artifactPolicyRef` не являются полями Core.

Значения `QA_REQUEST_AUTHORITY`, `SOURCE_CONTEXT`, `DEFECT_DESTINATION`, `TEST_EXECUTION`, `ARTIFACT_SOURCE` и `MESSAGING` определяются только QA Pack. Они не являются Core enum или обязательными conformance vectors feature 001; Core проверяет opaque Pack-owned `logicalRole` по зарегистрированному schema/manifest.

Domain command указывает требуемые `capability + logicalRole`, а Connector Broker детерминированно разрешает их через pinned ProjectIntegrationBinding. Pack и Hermes не передают произвольный profile ID.

Инварианты:

- у Project существует не более одной текущей `PUBLISHED` version;
- внутри published Project binding tuple `projectId + environmentScope + capability + logicalRole` уникален; одна capability может использовать несколько Profiles в разных logical roles, а один logical role — разные typed capabilities;
- published version неизменяема; изменение создаёт новую version, rollback публикует ранее проверенную совместимую configuration без переписывания истории;
- command, Work Item, Attempt и Evidence pin’ят exact binding/profile refs `{id, version}` для audit/replay;
- binding не содержит secret value;
- каждая Connection/Mapping/Profile/Binding revision после DRAFT pin’ит exact successful immutable Validation Report; provenance ref исключён из semantic content hash;
- validation failure не изменяет последнюю published version и блокирует публикацию draft;
- центральный Jira QA project используется всеми Projects, а binding содержит project discriminator, source-link policy и defect destination;
- `QA_REQUEST_AUTHORITY`, `SOURCE_CONTEXT` и `DEFECT_DESTINATION` могут ссылаться на разные Jira Profiles, даже если реализуют одну capability `operational-work-item`;
- GitLab binding содержит только allowlisted repositories, suites, variables и environments;
- Mattermost binding может направлять несколько Projects в общий intake channel и разные notification/escalation channels.
- live aliases `latest`, default branch без commit, строковое environment name без revision и mutable suite reference не являются достаточным TargetSnapshot;
- изменение binding/profile ref аннулирует pending Approval/command до внешнего effect и требует повторной validation.

### 9.3. Configuration и runtime binding

`ProjectIntegrationBinding` — конфигурация. `ExternalEntityBinding` — runtime-связь конкретной entity с внешним объектом:

```typescript
interface ExternalEntityBinding {
  id: string;
  workspaceId: string;
  projectId: string;
  entityType: string; // зарегистрированный Core- или Pack-owned opaque key
  entityId: string;
  profileRef: IntegerVersionRef;
  bindingRef: IntegerVersionRef;
  externalEntityType: string;
  externalEntityId: string;
  externalDisplayKey?: string;
  externalVersion?: string;
  syncState: "PENDING" | "SYNCED" | "ERROR" | "CONFLICT" | "MAPPING_REQUIRED";
  lastSyncedAt?: string;
}
```

---

## 10. Source-of-truth matrix

| Данные                                               | Канонический владелец            | Platform storage                                         |
| ---------------------------------------------------- | -------------------------------- | -------------------------------------------------------- |
| Intake Candidate                                     | Platform Core                    | Canonical discovery/decision record; не operational work |
| Intake Draft до submit                               | Platform Core                    | Canonical draft                                          |
| Workspace/membership/roles                           | Platform Core                    | Canonical                                                |
| Project/ProjectEntitlement                           | Platform Core                    | Canonical, versioned/audited                             |
| Pack/Work Type definition                            | Static source artifact           | Registered immutable metadata + version                  |
| Work Type enablement                                 | Platform Core                    | Canonical Workspace configuration                        |
| Work Item status/assignee/priority/due date          | Jira                             | Projection/cache                                         |
| Jira comments, links, history                        | Jira                             | Reference/projection where required                      |
| Operational Binding                                  | Platform Core                    | Canonical binding to Jira issue                          |
| Connection/Mapping/Profile/ProjectIntegrationBinding | Platform Core                    | Canonical, versioned                                     |
| Credentials                                          | Secret manager                   | Secret reference only                                    |
| QA request extension/DoR/DoD assessment              | QA Pack                          | Canonical domain state                                   |
| TestSession/PlanItem/Observation/Finding lifecycle   | QA Pack                          | Canonical domain state                                   |
| QA Verdict/residual risk                             | QA Pack, human-signed            | Canonical domain decision; не release decision           |
| AutomationAttempt intent/idempotency                 | QA Pack/Core command log         | Canonical request and audit                              |
| Pipeline/job actual state                            | GitLab                           | Projection                                               |
| Repository/MR/commit                                 | GitLab                           | Reference/projection                                     |
| Artifact binary                                      | GitLab Artifacts in pilot        | Metadata/reference/checksum only                         |
| Evidence Manifest                                    | QA Pack/Platform artifact module | Canonical, append-only versions                          |
| Mattermost message                                   | Mattermost                       | Message/channel reference only                           |
| Approval                                             | Platform Core                    | Canonical                                                |
| Agent Run/tool invocation                            | Platform Core                    | Canonical audit runtime                                  |
| Inbox/outbox/idempotency                             | Platform Core                    | Canonical durable state                                  |
| Queue ranking                                        | Platform Core                    | Derived deterministic projection                         |

Любая запись Jira-owned поля проходит command log/outbox, проверку RBAC и entitlement, expected version/current value, внешний write и подтверждение чтением Jira или webhook. Blind overwrite запрещён.

---

## 11. Доменная модель Core

### 11.1. IntakeCandidate и IntakeDraft

`IntakeCandidate` создаётся allowlisted Jira/GitLab trigger или Mattermost/manual discovery. Он хранит `workspaceId`, `projectId`, source entity/version, trigger version, proposed Work Type, deduplication key, minimal summary и actor/source.

```text
DISCOVERED → PENDING_CONFIRMATION
PENDING_CONFIRMATION → CONVERTED | SNOOZED | IGNORED | EXPIRED
SNOOZED → PENDING_CONFIRMATION | EXPIRED
```

Candidate не создаёт Jira issue, не запускает SLA и не потребляет WIP. Hermes может предложить Candidate и Project, но Project и Jira target подтверждает человек. `CONVERTED` создаёт versioned IntakeDraft; повтор trigger не создаёт duplicate Candidate.

Минимальные поля:

```text
id, workspaceId, candidateProjectId, workTypeKey, workTypeDefinitionVersion (SemVer)
requesterId, sourceChannel, sourceMessageRef?
title, description, formData, references, attachmentsMetadata
validationResult, readinessPreview, confirmationState
idempotencyKey, createdAt, updatedAt, expiresAt?
```

State model:

```text
DRAFT
→ VALIDATING
→ NEEDS_INFO | READY_FOR_CONFIRMATION
READY_FOR_CONFIRMATION
→ CONFIRMED
CONFIRMED
→ OPERATIONAL_CREATE_PENDING
OPERATIONAL_CREATE_PENDING
→ LINKED | FAILED_RETRYABLE | FAILED_FINAL
FAILED_RETRYABLE → OPERATIONAL_CREATE_PENDING
Any non-terminal → CANCELLED
```

Инварианты:

- draft не участвует в SLA;
- Mattermost intake создаёт draft, но не Jira issue, пока пользователь явно не подтвердил submit;
- повторный submit с тем же idempotency key возвращает существующий result;
- confirmation pin’ит конкретную draft version и выбранную ProjectIntegrationBinding version;
- успешный operational Connector effect и локальное создание Work Item/binding фиксируются одной транзакцией, переводящей draft непосредственно `OPERATIONAL_CREATE_PENDING → LINKED`; отдельного durable состояния «внешний объект создан, но локально не связан» нет;
- после `LINKED` form snapshot неизменяем и связан с Work Item.

### 11.2. WorkItem

Core не содержит `jira*` columns:

```typescript
interface WorkItem {
  id: string;
  workspaceId: string;
  projectId: string;
  workTypeKey: string;
  workTypeDefinitionVersion: SemVer;
  intakeDraftId?: string;
  operationalBindingId: string;
  title: string;
  normalizedStatus: NormalizedStatus;
  rawStatusRef: string;
  requesterId?: string;
  assigneeId?: string;
  normalizedPriority?: string;
  dueAt?: string;
  serviceClass: "EXPEDITE" | "FIXED_DATE" | "STANDARD";
  syncState: "PENDING" | "SYNCED" | "ERROR" | "CONFLICT" | "MAPPING_REQUIRED";
  externalVersion?: string;
  lastSyncedAt: string;
}
```

Normalized statuses:

```text
NEW, NEEDS_INFO, READY, PLANNED, IN_PROGRESS,
REVIEW, BLOCKED, DONE, CANCELLED
```

Normalized status предназначен для общего UI/queue. Он не заменяет Jira status и не определяет доступный transition без Jira metadata.

### 11.3. Connector command

```text
request ingress → validation (до persistence; ошибка возвращается без command)
validated request ─┬→ AWAITING_APPROVAL → QUEUED → DISPATCHED → CONFIRMED
                   └→ QUEUED ─────────────┘          └→ RETRY_SCHEDULED → DISPATCHED
AWAITING_APPROVAL/QUEUED/DISPATCHED → CONFLICT | FAILED | CANCELLED
```

Первое durable состояние Command — `AWAITING_APPROVAL` либо `QUEUED`; `RECEIVED/VALIDATED` являются request-processing/audit stages, а не публичными snapshots без outbox. Command содержит actor, Workspace/Project, capability, binding version, expected external version/value, idempotency key, correlation ID, requested payload hash и confirmed result.

### 11.4. Approval

```text
PENDING → APPROVED | REJECTED | EXPIRED | CANCELLED
```

Approval одноразовый, содержит `workspaceId`, `projectId`, initiator/approver, approver role и authorization basis, единственную identity `actionKind + actionId`, точную structured action/target, action-specific payload hash (полный typed payload для Connector effect либо semantic candidate content hash для platform mutation без отдельного payload), expected state (external version/state для Connector effect либо candidate resource version/content hash вместе с aggregate header/current-version snapshot для platform mutation), exact binding/profile refs, expiry и idempotency key. Изменение payload/target/profile ref/expected state, соответствующий external или local conflict, отзыв entitlement/роли либо expiry аннулируют Approval. Agent и инициатор service action не могут approve собственное действие.

---

## 12. QA Work Type и агрегаты

### 12.1. Work Type `qa.validation`

Manual и automated являются session modes, а не Work Types.

Каждая QA entity, event, job и command содержит `workspaceId` и `projectId`; отсутствие scope является schema error, а не global fallback.

Request kinds пилота:

```text
FEATURE_VALIDATION
SMOKE
REGRESSION
RETEST
INVESTIGATION
```

`AUTOMATION_DEVELOPMENT` и `TEST_INFRASTRUCTURE` не входят в `qa.validation` и требуют будущих Work Types.

Минимальная intake schema:

```text
projectId
requestKind
goal
scope
acceptanceOutcome
sourceIssueRefs[]
mergeRequestRef?
requestedBuildRef
requestedEnvironmentId
risk/criticality
roleMetadataRefs[]
testDataReadiness
desiredDueAt?
references[]
securityClassification
```

Для scheduled SMOKE/REGRESSION source issue может отсутствовать, если binding однозначно задаёт target build policy. Для RETEST обязательны defect/source session references.

### 12.2. QaRequestExtension

```typescript
interface QaRequestExtension {
  workItemId: string;
  workspaceId: string;
  workTypeDefinitionVersion: SemVer;
  requestKind: QaRequestKind;
  projectId: string;
  goal: string;
  scope: string;
  acceptanceOutcome: string;
  sourceRefs: ExternalReference[];
  requestedTargetDefaults: TargetDefaults;
  criticality: string;
  roleMetadataRefs: string[];
  testDataReadiness: "READY" | "PARTIAL" | "NOT_READY";
  securityClassification: string;
  readinessAssessmentId?: string;
  latestDodAssessmentId?: string;
}
```

### 12.3. TestSession aggregate

Один Work Item содержит одну или несколько independently executable sessions. Session всегда имеет ровно один mode.

```typescript
interface TestSession {
  id: string;
  workspaceId: string;
  projectId: string;
  workItemId: string;
  ordinal: number;
  mode: "MANUAL" | "AUTOMATED";
  purpose: QaRequestKind;
  parentSessionId?: string;
  targetSnapshot: TestTargetSnapshot;
  scopeSnapshot: TestScopeSnapshot;
  ownerId?: string;
  requiredCapabilities: string[];
  planItemIds: string[];
  state: TestSessionState;
  sessionOutcome?: SessionOutcome;
  signedBy?: string;
  summary?: string;
  createdBy: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  correlationId: string;
  aggregateVersion: number;
}
```

`TestTargetSnapshot` pin’ит Project, environment ID/revision, build/commit/digest, MR/source refs, test-data/account lease opaque refs, один exact `bindingRef: IntegerVersionRef` и все фактически используемые `profileRefs: IntegerVersionRef[]`. `TestScopeSnapshot` pin’ит description, checklist/suite version/hash и acceptance outcome. Mutable aliases без resolved immutable value запрещены.

После старта target/scope неизменяемы. Изменение build, environment или scope создаёт новую linked session. RETEST ссылается на исходную session и defect.

State model:

```text
PLANNED → READY → RUNNING → REVIEW_REQUIRED → COMPLETED
   │         │        │            │
   └─────────┴────────┴────────────→ BLOCKED
BLOCKED → READY | RUNNING | REVIEW_REQUIRED | CANCELLED
Any non-terminal → CANCELLED
```

State и outcome разделены:

```text
PlanItemResult:
PASS | FAIL | BLOCKED | NOT_RUN | INCONCLUSIVE

SessionOutcome:
PASSED | FAILED | BLOCKED | INCONCLUSIVE
```

Pipeline technical success не переводит session в `COMPLETED`: сначала создаётся `REVIEW_REQUIRED`, затем авторизованный QA-человек подписывает SessionOutcome. Hermes и Connector не могут подписать outcome.

### 12.4. PlanItem, Observation и reusable definitions

Каждая Session содержит versioned session-scoped Plan Items. У PlanItem mode совпадает с mode Session.

```text
PlanItem:
id, workspaceId, projectId, testSessionId, ordinal, title,
expectedOutcome, definitionRef/version/hash-or-snapshot,
result, actor, startedAt, completedAt, waiver?

Observation:
id, workspaceId, projectId, planItemId, attemptId?,
actualOutcome, severity?, evidenceRefs[], actor, timestamp
```

Reusable test definitions остаются в Git или существующем TMS. Session pin’ит immutable commit/version/path и content hash; если источник не гарантирует immutability, Pack сохраняет snapshot определения. Полная reusable test library в Platform DB запрещена в пилоте.

### 12.5. AutomationAttempt

```typescript
interface AutomationAttempt {
  id: string;
  workspaceId: string;
  projectId: string;
  testSessionId: string;
  attemptNo: number;
  idempotencyKey: string;
  bindingRef: IntegerVersionRef;
  profileRefs: IntegerVersionRef[];
  suiteBindingId: string;
  targetSnapshot: TestTargetSnapshot;
  scopeSnapshotHash: string;
  externalPipelineId?: string;
  externalJobIds: string[];
  state: AutomationAttemptState;
  technicalOutcome?:
    "PASS" | "ASSERTION_FAILED" | "INFRA_FAILED" | "TIMEOUT" | "CANCELLED" | "INCOMPLETE";
  infrastructureErrorCode?: string;
  startedAt?: string;
  completedAt?: string;
}
```

```text
CREATED → TRIGGER_PENDING → RUNNING
RUNNING → TERMINAL
TRIGGER_PENDING → TERMINAL

AttemptOutcome:
PASS | ASSERTION_FAILED | INFRA_FAILED | TIMEOUT | CANCELLED | INCOMPLETE
```

Один automatic retry разрешён только для allowlisted deterministic infrastructure error и создаёт новый Attempt в той же Session. Assertion failure автоматически не ретраится. Повтор trigger command не создаёт второй pipeline. Fail-then-pass lineage сохраняет обе попытки и получает `FLAKY_SUSPECTED`/human disposition, а не автоматически превращается в чистый PASS.

### 12.6. Finding и DefectLink

Failed или ambiguous Observation сначала входит в human-classified Finding:

```text
FindingClassification:
PRODUCT | INFRA | INCONCLUSIVE | DUPLICATE | ACCEPTED_RISK
```

Finding агрегирует связанные observations и хранит severity, summary, affected target, classification actor/reason, evidence refs и defect disposition. Technical Attempt outcome сам по себе не создаёт Finding classification или defect.

Каждый material finding обязан иметь disposition:

```text
DEFECT_CREATED
DUPLICATE
NOT_A_BUG
ACCEPTED_RISK
DEFERRED
WAIVED
```

DefectLink хранит runtime binding к Jira defect, originating session, finding ID и human confirmer. Hermes может создать draft; external defect создаётся только после exact Approval авторизованного QA Executor/QA Lead.

### 12.7. Human-signed QA Verdict

Итоговый Verdict относится к QA Work Item и агрегирует результаты всех required Sessions:

```typescript
interface QaVerdict {
  id: string;
  workspaceId: string;
  projectId: string;
  workItemId: string;
  verdict: "PASS" | "FAIL" | "BLOCKED" | "INCONCLUSIVE";
  residualRisk: string;
  sessionIds: string[];
  evidenceManifestRevisions: string[];
  signedBy: string;
  signedAt: string;
  policyVersion: string;
  supersedesVerdictId?: string;
}
```

Только QA Executor/QA Lead с действующим entitlement подписывает Verdict. High/critical/waiver требует отличного от инициатора QA Lead. Verdict `FAIL` совместим с Jira Work Item `DONE`: завершена QA-работа, но продукт получил отрицательный результат. Verdict не является release/no-release решением.

---

## 13. QA Definition of Ready и Definition of Done

### 13.1. Work Item Definition of Ready

DoR означает готовность к планированию и попаданию в READY backlog, а не текущую доступность runner или environment.

Обязательные условия:

1. существует synced Jira QA issue в центральном project;
2. Project active и имеет published Jira/Mattermost bindings;
3. requester имеет entitlement и подтверждённый response channel;
4. request kind, goal, scope и acceptance outcome заполнены;
5. указан разрешённый environment и идентифицируемый build/commit/MR либо утверждённая scheduled target policy;
6. source context достаточен для request kind;
7. criticality и security classification определены;
8. role/test-data metadata указаны без secrets;
9. blockers и dependencies перечислены;
10. Project Registry current либо QA Lead явно подтвердил работу с `NEEDS_REVIEW` entry;
11. для RETEST указаны defect и previous session/source build;
12. mapping validation не содержит blocking errors.

Transient Jira/GitLab/Mattermost outage не отменяет DoR: он создаёт operational block/sync state. Live environment health, runner availability и suite availability проверяются session start guards.

ReadinessAssessment:

```text
NOT_EVALUATED | BLOCKED | READY | READY_WITH_RISK
```

Assessment содержит rule version, input revisions, blockers, warnings, acknowledgements, actor и timestamp. Hermes может объяснить результат, но итог вычисляется deterministic rules.

Переход в `READY` подтверждает QA Executor или QA Lead. Waiver любого hard readiness rule требует QA Lead, точной причины, срока действия и audit; Hermes не подтверждает READY/waiver.

### 13.2. Session start guards

MANUAL:

- assigned Executor имеет entitlement/capability;
- target snapshot сформирован;
- environment разрешён и доступ подтверждён;
- role/test-data metadata готовы;
- scope snapshot сохранён.

AUTOMATED:

- все common guards выполнены;
- active GitLab binding существует;
- suite/environment/variables входят в allowlist;
- pipeline contract validation проходит;
- idempotency key создан;
- trigger инициирован authorized human;
- large regression имеет Approval.

### 13.3. TestSession Definition of Done

Для любой Session:

- target и scope snapshots сохранены;
- Plan Items имеют terminal result либо явный waiver;
- SessionOutcome и summary подписаны человеком;
- весь scope отмечен executed/out-of-scope/blocked;
- Evidence Manifest опубликован;
- Observations сгруппированы/классифицированы в Findings, где применимо;
- Findings имеют disposition;
- session имеет terminal `COMPLETED` либо явный `CANCELLED` с reason/approval.

Для AUTOMATED дополнительно:

- существует terminal AutomationAttempt;
- сохранены pipeline/job IDs и machine-readable result либо deterministic infra evidence;
- artifact references синхронизированы;
- product failure не определён автоматически из текста/logs;
- все automatic retries исчерпаны или не требовались.

### 13.4. Work Item Definition of Done

Work Item может быть предложен к закрытию, когда:

1. существует минимум одна TestSession;
2. все required sessions completed или waived/cancelled с разрешением;
3. нет unreviewed automated outcomes;
4. agreed scope полностью учтён;
5. evidence manifests валидны;
6. findings связаны с defects либо имеют human disposition;
7. defect drafts подтверждены или отклонены человеком;
8. итоговый QA Verdict и residual risk подписаны авторизованным QA Executor/QA Lead;
9. high/critical waiver подтверждён отличным от инициатора QA Lead;
10. Jira completion comment содержит scope, Verdict, residual risk и evidence/defect links;
11. exact Approval на Jira terminal transition действителен;
12. фактический Jira terminal transition выполнен и подтверждён чтением/webhook.

Открытый product defect не блокирует завершение согласованной QA-работы с Verdict `FAIL`. `DONE + FAIL` является штатным исходом и не означает product acceptance или release decision.

Недоставка Mattermost notification не блокирует DoD. Artifact expiry после закрытия не отменяет исторический DoD, если manifest сохраняет provenance и expiry status.

---

## 14. Cross-project queue, WIP и SLA

### 14.1. Представления

```text
Candidate Inbox
→ Confirmed Backlog
→ Ready Queue
→ Active WIP
→ Completed
```

Queue stage является deterministic projection Candidate/Draft/Jira/DoR/Session facts, показывается отдельно от Jira status и не создаёт конкурирующий workflow.

UI предоставляет Candidate Inbox, Backlog/Needs Info, READY project lanes, portfolio view, committed/PLANNED, active MANUAL/AUTOMATED, REVIEW_REQUIRED, BLOCKED и My Work.

Пользователь видит только пересечение Workspace role и ProjectEntitlement.

### 14.2. Service classes

```text
EXPEDITE    # P0/P1 или эквивалент, global WIP = 1
FIXED_DATE  # подтверждённый release/regulatory date
STANDARD    # обычная работа
```

EXPEDITE требует exact QA Lead approval, audit reason и expiry/review time. Hermes не назначает EXPEDITE и не меняет Jira priority.

### 14.3. Детерминированное ранжирование

1. service class;
2. прогноз SLA breach/latest safe start;
3. Jira priority;
4. подтверждённые risk/business impact facts;
5. dependencies;
6. aging с момента READY;
7. `readyAt`;
8. Jira display key как стабильный tie-breaker.

Между Projects используются отдельные project lanes и explainable portfolio recommendation, а не один opaque AI score. Project limits/reservations являются soft, а Workspace WIP — hard. Cross-project order/override утверждает QA Lead с reason, expected version и audit. Effort/complexity помогает планированию, но не становится business priority. Внутри Project применяется порядок выше.

Manual override позиции разрешён QA Lead, но требует reason, expiry и не изменяет Jira priority/due date без отдельной Jira command/approval.

### 14.4. WIP и ресурсы

- global Workspace WIP является hard limit; per-Project limit/reservation является soft policy;
- MANUAL running и REVIEW_REQUIRED потребляют human WIP;
- запущенный GitLab pipeline потребляет runner concurrency, но не human WIP;
- automated result в REVIEW_REQUIRED потребляет human WIP;
- external BLOCKED item остаётся видимым, но может освобождать active slot только с mapped Jira reason;
- runner concurrency задаётся GitLab binding;
- новая работа не стартует сверх WIP, кроме approved EXPEDITE.

Числовые WIP/capacity значения: `[PILOT INPUT REQUIRED]`.

### 14.5. SLA

- SLA начинается при фактическом Jira status, mapped в `READY`;
- `NEEDS_INFO` и approved external block могут pause SLA;
- pause reason хранится в Jira или однозначно выводится из mapped status/reason field;
- Platform SLA clock является deterministic projection;
- timezone, calendar и targets задаются Workspace policy: `[PILOT INPUT REQUIRED]`;
- Hermes может объяснить risk, но не изменяет timers или due date.

---

## 15. Evidence Manifest и artifacts

Evidence Manifest создаётся для каждой завершённой TestSession и хранится append-only. Исправление создаёт новую revision; предыдущая не перезаписывается.

```typescript
interface EvidenceManifest {
  schemaVersion: number;
  manifestId: string;
  revision: number;
  workspaceId: string;
  projectId: string;
  workItemId: string;
  testSessionId: string;
  workTypeDefinitionVersion: SemVer;
  targetSnapshot: TestTargetSnapshot;
  scopeSnapshotHash: string;
  planItems: Array<{
    planItemId: string;
    definitionRef: string;
    definitionVersionOrCommit: string;
    definitionHash: string;
    expectedOutcome: string;
    actualOutcome: string;
    result: "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN" | "INCONCLUSIVE";
  }>;
  execution: {
    mode: "MANUAL" | "AUTOMATED";
    executorId?: string;
    automationAttemptIds: string[];
    startedAt: string;
    completedAt: string;
    outcome: SessionOutcome;
  };
  signature: {
    signerId: string;
    signedAt: string;
    policyVersion: string;
  };
  findings: FindingDisposition[];
  artifacts: EvidenceArtifactRef[];
  provenance: {
    packVersion: string;
    ruleVersions: string[];
    bindingRefs: IntegerVersionRef[];
    profileRefs: IntegerVersionRef[];
    correlationId: string;
  };
  createdAt: string;
}
```

Artifact reference содержит:

```text
artifactId, type, provider, externalRef, checksum, size, mediaType,
classification, owner, createdAt, retentionClass, expiresAt?,
accessPolicyRef, availabilityStatus
```

Signed URLs, tokens, cookies и raw credentials не сохраняются. Доступ проверяется при каждом resolve/download.

Минимальные evidence rules:

- для любой Session обязателен structured execution summary;
- MANUAL требует scope/checklist reference, expected/actual outcome, result, notes и findings; attachment обязателен для `FAIL`, `BLOCKED` и `INCONCLUSIVE`, но не для каждого `PASS`;
- AUTOMATED требует pipeline/job identity, suite/version, machine-readable result и report reference;
- trace/screenshot/video/log прикладываются по failure policy и security classification;
- каждый finding имеет defect link или human disposition;
- manifest остаётся доступным после expiry binary и показывает `EXPIRED`, а не удаляет след.

GitLab Artifacts является binary store пилота. Retention, maximum size и разрешённые artifact types: `[PILOT INPUT REQUIRED]`.

В первой версии действует только `GITLAB_ONLY`: платформа не копирует CI artifact bytes во внутреннее хранилище и не принимает произвольные binary attachments. Иной binary store может появиться только отдельным будущим решением.

---

## 16. Интеграции пилота

### 16.1. Jira Connector — operational-work-item

Зафиксированная продуктовая модель:

- один центральный Jira QA project;
- одна QA issue на принятый Work Item;
- issue type предназначен для QA Request;
- QA issue, созданная человеком напрямую в central project, может быть импортирована только по published strict JQL/issue-type policy и связывается идемпотентно;
- source development issues/MRs/builds связываются references/links;
- defects создаются в owning product project после human confirmation;
- webhook-first sync с polling/reconciliation fallback;
- Jira wins при конфликте Jira-owned fields;
- платформа не меняет workflow schemes или field configuration.

Событие source development issue/MR само создаёт только IntakeCandidate. Создание central QA issue человеком в разрешённом issue type рассматривается как explicit operational intent, но completeness/DoR всё равно выполняются после import; посторонние issues игнорируются без раскрытия данных.

Необходимые внешние значения:

- Jira URL, edition/API и auth: `[PILOT INPUT REQUIRED]`;
- central QA project key и QA issue type ID: `[PILOT INPUT REQUIRED]`;
- field IDs, required fields и allowed values: `[PILOT INPUT REQUIRED]`;
- statuses, transitions, validators и normalized mapping: `[PILOT INPUT REQUIRED]`;
- service identity/scopes и secret path: `[PILOT INPUT REQUIRED]`;
- webhook signature/retry/event identity: `[PILOT INPUT REQUIRED]`;
- JQL/import scope, API limits и reconciliation interval: `[PILOT INPUT REQUIRED]`;
- defect destination projects и link types: `[PILOT INPUT REQUIRED]`.

### 16.2. GitLab Connector — source-context, ci-pipeline, artifact-reference

Разрешено:

- read repository/MR/commit metadata;
- trigger зарегистрированный test pipeline;
- read pipeline/jobs/status/artifact metadata;
- принимать webhook;
- один deterministic infra retry.

Запрещено:

- push code;
- изменять CI configuration;
- читать secret CI variable values;
- запускать production deploy job;
- передавать не-allowlisted variable/environment/suite.

Внешние значения:

- GitLab URL/auth/service identity/scopes: `[PILOT INPUT REQUIRED]`;
- repositories/default branches: `[PILOT INPUT REQUIRED]`;
- pipeline/job contract и variable names: `[PILOT INPUT REQUIRED]`;
- suite/environment/browser allowlists: `[PILOT INPUT REQUIRED]`;
- runner network access/concurrency/resource limits: `[PILOT INPUT REQUIRED]`;
- machine-readable outcome/error codes: `[PILOT INPUT REQUIRED]`;
- webhook contract и artifact retention/access: `[PILOT INPUT REQUIRED]`.

### 16.3. Mattermost Connector — messaging

Mattermost является предпочтительным каналом:

- создания structured Intake Draft;
- запросов недостающей информации;
- status/queue summaries;
- уведомлений о session/pipeline/review/approval;
- deep links в web UI.

Mattermost не является source of truth. V1 не исполняет critical approval непосредственно из channel message: approval notification ведёт в web Approval Center.

Guided intake с полным описанием выполняется в bot DM или web UI. Project channel получает только policy-approved redacted summary. Произвольная история channels не сканируется и не передаётся модели.

Explicit `/awp create` или guided dialog создаёт Draft. Allowlisted Jira `Ready for QA`/label или GitLab MR label event может создать только deduplicated IntakeCandidate с действиями `CREATE`, `SNOOZE`, `IGNORE`; event никогда автоматически не создаёт Work Item/Jira QA Request.

Flow intake:

1. Пользователь запускает bot command/dialog.
2. Проверенный External User Binding сопоставляет Mattermost user с canonical `(OIDC issuer, subject)` principal; similarity email/username недостаточна.
3. Пользователь выбирает Project только из ProjectEntitlements; выбранные Project Scope и central Jira target показываются до confirmation.
4. Создаётся versioned Intake Draft.
5. Hermes/deterministic rules возвращают missing fields.
6. Пользователь явно подтверждает точную draft и binding versions.
7. Идемпотентная Jira command создаёт одну issue.
8. Пользователь получает Jira key и web link.

При Mattermost outage web flow полностью доступен, Jira workflow не блокируется, notification доставляется retry/digest policy.

Внешние значения:

- Mattermost URL, bot identity/token reference: `[PILOT INPUT REQUIRED]`;
- intake/notification/escalation channels: `[PILOT INPUT REQUIRED]`;
- signing/callback contract и identity mapping: `[PILOT INPUT REQUIRED]`;
- message limits, quiet hours и digest policy: `[PILOT INPUT REQUIRED]`.

### 16.4. Независимая деградация

Jira, GitLab и Mattermost обязательны в pilot deployment, но не входят в одну distributed transaction:

- Jira unavailable: Candidate/Draft и pending command сохраняются, но принятый Work Item/Jira transition не выдумываются;
- GitLab unavailable: AUTOMATED Session остаётся pending/error, MANUAL Sessions и Jira work продолжаются;
- Mattermost unavailable: Jira/QA/web flow продолжается, notification intent остаётся в outbox;
- восстановление любой системы выполняется через idempotent retry/webhook/reconciliation без повторного external effect.

---

## 17. Hermes QA Coordinator

### 17.1. Модель

В QA Workspace существует один logical Agent Definition `hermes-qa-coordinator`. Runtime может обрабатывать несколько Agent Runs параллельно, но все они используют один versioned policy/skill catalog.

Каждый Agent Run pin’ит `workspaceId`, `projectId`, `candidateId/workItemId`, initiator, input fingerprint, skill/rules versions и минимальные derived tool grants. Свободная память между Project Scope запрещена.

Hermes:

- не владеет Work Item/TestSession state;
- не использует user tokens;
- не получает raw credentials;
- не вызывает vendor SDK напрямую;
- формирует только schema-validated structured actions;
- выполняет tool через Tool Gateway после RBAC, entitlement, policy, rate-limit и idempotency checks;
- сохраняет Agent Run, steps, tool calls и result;
- не расширяет permissions через prompt/content.

Agent Run lifecycle:

```text
CREATED → VALIDATING_INPUT → PLANNING → EXECUTING
EXECUTING → WAITING_FOR_APPROVAL → EXECUTING
EXECUTING → COMPLETED
Any non-terminal → RETRY_SCHEDULED | FAILED | CANCELLED
```

### 17.2. Ограниченный skill catalog v1

| Skill                      | Typed result                             | Side-effect policy                                                                   |
| -------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `qa-intake-assist`         | Normalized draft proposal/missing fields | Draft update only; submit всегда подтверждает пользователь.                          |
| `qa-readiness-check`       | ReadinessAssessment explanation          | Assessment вычисляет deterministic rule engine; templated missing-info message safe. |
| `qa-session-plan`          | MANUAL/AUTOMATED SessionPlanProposal     | Sessions создаются после human confirmation.                                         |
| `qa-automation-coordinate` | Validated trigger proposal               | Explicit authorized launch safe; large regression требует Approval.                  |
| `qa-result-review-prep`    | Review packet по pipeline/evidence       | Read-only; не создаёт QA verdict.                                                    |
| `qa-defect-draft`          | Structured defect draft                  | Jira defect требует human confirmation.                                              |
| `qa-dod-check`             | DoD blockers и close proposal            | Jira transition требует exact one-time Approval.                                     |
| `qa-notify`                | Template key/recipients/variables        | Safe в рамках notification policy.                                                   |

Новые skills в pilot требуют отдельной versioned definition, tool allowlist, approval classification, deterministic fallback и acceptance tests.

Hermes recommendation хранится отдельно от Jira-owned или human-accepted value и содержит facts, explanation, confidence, input fingerprint и expiry. Изменение использованного факта делает recommendation `STALE`. Complexity не сворачивается в opaque scalar: сохраняются как минимум effort range, scope breadth, environment/test-data complexity, uncertainty, automation availability и risk severity.

### 17.3. Не являются agent skills

- webhook verification/parsing;
- Jira/GitLab sync и reconciliation;
- RBAC/ProjectEntitlement;
- mapping validation;
- queue/SLA calculation;
- actual pipeline trigger/status polling;
- retry classification;
- Mattermost delivery retry;
- audit/idempotency;
- DoR/DoD boolean evaluation.

Это deterministic application services. Hermes может объяснить результат или предложить command, но не реализует правило.

### 17.4. Tool classes

Автоматические read-only:

- read permitted Work Item/Jira issue;
- read Project/QA context;
- read TestSession/Evidence metadata;
- read permitted GitLab MR/pipeline;
- read queue/capacity.

Safe write по policy:

- update unsubmitted draft;
- store assessment/proposal;
- send templated missing-info/notification;
- create confirmed session plan;
- launch allowlisted non-production smoke по explicit authorized command.

Approval-required:

- large regression;
- event-driven launch без текущей user command;
- Jira defect creation;
- любой Jira transition, assignment, priority или due-date write;
- high/critical Verdict, DoR/evidence waiver и queue/WIP override;
- любой будущий production action.

Forbidden:

- retrieve secrets;
- arbitrary shell/code execution;
- change assertions/CI config;
- semantic product verdict;
- upload restricted data в неразрешённый model provider;
- approve собственную action;
- production access.

### 17.5. Deterministic fallback

Если model provider недоступен:

- Mattermost structured form и web intake продолжают работать;
- DoR/DoD rules работают;
- Jira sync/create/transition по human command работают;
- manual sessions работают;
- GitLab trigger/status/retry работают;
- queue/SLA/audit работают;
- Hermes explanations/drafting помечаются unavailable и заменяются templates.

Model outage не является причиной остановки QA workflow.

Реальный model provider является optional для QA pilot. Gate L0 всегда использует deterministic fake provider. Если real provider включён, его endpoint, classification policy, retention и data boundary задаются как `[PILOT INPUT REQUIRED]`; отключение provider не меняет acceptance ручного/интеграционного flow.

---

## 18. Security, approvals и threat model

### 18.1. Основные угрозы

- cross-Workspace или cross-Project leakage;
- Jira/GitLab/Mattermost credential leakage;
- prompt injection из Jira/MR/comment/artifact;
- webhook spoofing/replay;
- duplicate external effects;
- privilege escalation через mapping или Mattermost bot;
- запуск неправильного suite/environment;
- production target selection;
- PII/secrets в screenshots, traces, logs или prompts;
- SSRF через Project references;
- malicious attachment;
- incorrect identity mapping.

### 18.2. Обязательные меры

- Workspace membership + ProjectEntitlement на каждом backend use case;
- service identities с least privilege и раздельными environment credentials;
- secrets только через secret manager;
- signature/replay verification webhook и Mattermost callbacks;
- outbound host allowlist и SSRF-safe URL client;
- schema validation всех mappings/actions/external scopes;
- structured prompt boundaries; external content всегда untrusted;
- prompt injection не изменяет tool policy;
- explicit allowlist suite/environment/variables;
- production deny на нескольких уровнях: binding, Tool Gateway и GitLab contract;
- artifact classification/scanning/redaction policy;
- immutable audit agent/integration writes;
- expected version/current value для Jira writes;
- configurable retention и access-at-read-time;
- emergency suspend Connector/Profile/Project без удаления истории.

### 18.3. Approval matrix

| Action                                       | Policy v1                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Confirm Mattermost/Web draft submit          | Explicit Requester confirmation                                                                                                       |
| Send missing-info/template notification      | Safe                                                                                                                                  |
| Create session from confirmed plan           | QA Executor/Lead explicit command                                                                                                     |
| Launch allowlisted non-prod smoke            | Authorized explicit command                                                                                                           |
| Launch large regression                      | QA Lead Approval                                                                                                                      |
| Automatic infra retry once                   | Deterministic safe policy                                                                                                             |
| Create Jira defect                           | Exact Approval авторизованного QA Executor/Lead                                                                                       |
| Sign ordinary QA Verdict                     | Authorized QA Executor explicit signature                                                                                             |
| High/critical Verdict или waiver             | Отличный от инициатора QA Lead Approval                                                                                               |
| Jira transition/assignment/priority/due date | Exact one-time Approval согласно action policy                                                                                        |
| Validate ProjectIntegrationBinding draft     | Integration Administrator command; QA Lead functional acceptance                                                                      |
| Publish/retire ProjectIntegrationBinding     | Exact one-time Workspace Owner Approval, approver отличен от Integration Administrator-инициатора и имеет `project.admin` entitlement |
| Emergency suspend Project/Profile            | Integration Administrator explicit fail-safe command с reason/incident/audit; второй approval не требуется                            |
| Resume suspended Project/Profile             | Успешные probes + incident disposition + exact Workspace Owner Approval с separation of duties                                        |
| Any production action                        | Forbidden in pilot                                                                                                                    |

Approval не заменяет entitlement: approver обязан иметь permission на тот же Project.

---

## 19. Основные пользовательские flows

### 19.1. Preferred Mattermost intake

```text
command/dialog
→ identity + entitlement
→ IntakeDraft
→ deterministic validation + Hermes explanation
→ missing-info loop
→ explicit confirm
→ idempotent Jira create
→ WorkItem projection
→ READY when DoR passes
```

### 19.2. Manual validation

```text
READY Work Item
→ session plan confirmed
→ MANUAL Session READY
→ Executor start
→ Plan Items/Observations submitted
→ human Finding classification
→ REVIEW_REQUIRED
→ human-signed SessionOutcome/Evidence
→ COMPLETED
```

### 19.3. Automated validation

```text
AUTOMATED Session READY
→ start guards
→ idempotent GitLab trigger
→ pipeline webhook/polling
→ artifacts + technical outcome
→ REVIEW_REQUIRED
→ human SessionOutcome/Finding classification
→ COMPLETED or new linked Session/defect
```

### 19.4. Defect and retest

```text
finding
→ Hermes/Executor defect draft
→ human confirm
→ Jira defect in product project
→ DefectLink
→ fixed build
→ RETEST Session linked to defect/source Session
```

### 19.5. Completion

```text
all required Sessions terminal
→ deterministic DoD assessment
→ human-signed QA Verdict + residual risk
→ QA Lead waiver/high-risk approval if required
→ completion summary/evidence links
→ exact Approval + Jira transition
→ webhook/read confirmation
→ Mattermost notification
```

---

## 20. Project onboarding modes и gates

### 20.1. Capability mode и operational state

```text
QaCapabilityMode:
MANUAL_ONLY  # confirmed intake + Jira writes + manual sessions
FULL_QA      # MANUAL_ONLY + GitLab automated sessions

ProjectOperationalState:
ACTIVE
SUSPENDED    # no new writes/launches; history remains readable
```

Capability mode и operational state независимы. При suspension прежний mode сохраняется как intent; resume восстанавливает его только после повторных capability probes, иначе mode безопасно пересчитывается. QA pilot включает manual и automated capability. Project считается полностью onboarded только в `FULL_QA`; промежуточный `MANUAL_ONLY` разрешён для безопасного rollout. Reference pilot начинает с одного Project; следующие Projects проходят тот же package последовательно.

### 20.2. Onboarding state

```text
DRAFT
→ VALIDATING
→ SHADOW
→ PILOT_ACTIVE

Validation failure → NEEDS_FIX → VALIDATING

Within SHADOW/PILOT_ACTIVE:
qaCapabilityMode: MANUAL_ONLY → FULL_QA
projectOperationalState: ACTIVE → SUSPENDED → ACTIVE
```

### 20.3. Deployment/integration gates

**L0 — Local-first development**

- stateful Mock Jira/GitLab/Mattermost, fake OIDC/model и local storage abstraction доступны;
- duplicate/out-of-order, rate limit, timeout, permission denial и schema drift воспроизводимы;
- seed содержит один QA Workspace, несколько Projects и разные ProjectEntitlements;
- корпоративные endpoints/credentials не требуются.

**C1 — Real connector specification readiness**

- получены system/API metadata и non-prod contract/sample payloads без secrets;
- auth strategy, owner, permissions, rate/webhook guarantees и classification заданы как `[PILOT INPUT REQUIRED]`;
- typed capability contract и forbidden operations зафиксированы до connector plan/tasks.

**N2 — Real non-prod connector**

- отдельная non-prod Connection/service identity/secret reference создана;
- restricted Profile и network/TLS reachability проверены;
- test webhook/callback, contract evidence и credential revoke procedure готовы.

**P3 — Controlled QA pilot**

- Project owners, classification, ProjectEntitlements и artifact policy подтверждены;
- ProjectIntegrationBinding validated и published;
- rollout прошёл discovery/dry-run → Jira central QA flow → MANUAL Session → один stable GitLab smoke → Mattermost guided intake → bounded Hermes suggestions;
- каждый этап имеет permission-denied и outage acceptance case.

**R4 — Production deployment платформы**

- production platform Connections/credentials изолированы от non-prod;
- security, backup/restore, reconciliation и rollback rehearsal пройдены;
- owners/on-call/kill switches/retention подтверждены;
- product-production environments и deployment jobs всё ещё запрещены pilot bindings/credentials/network policy.

Каждый Project получает отдельный versioned onboarding package: Project Registry/entitlements, Jira source/defect mappings, GitLab suite/runner contract, Mattermost channels, data/evidence policy и acceptance evidence. Каждый gate сохраняет actor, owner, evidence, timestamp и exact configuration versions.

---

## 21. Local-first development и Mock Hub

Локальный контур обязан работать без корпоративной Jira, GitLab, Mattermost и model provider.

Минимальный compose:

```text
postgres
mock-hub
optional local observability profile
```

Первая версия не поднимает отдельный broker или object-store emulator. Durable delivery выполняется через PostgreSQL; binary CI artifacts остаются в GitLab.

Mock Hub реализует те же typed connector contracts и хранит deterministic state.

Обязательные Jira scenarios:

- metadata discovery;
- create/read/update/transition/comment/link;
- duplicate/out-of-order webhook;
- stale version conflict;
- permission error, rate limit, timeout, server error;
- schema drift;
- reconciliation recovery.

GitLab scenarios:

- source/MR metadata;
- pipeline success/test failure/infra error;
- duplicate webhook;
- delayed completion;
- one allowed retry;
- missing artifact;
- runner unavailable;
- forbidden suite/environment/production target.

Mattermost scenarios:

- command/dialog and explicit confirm;
- identity mismatch;
- duplicate callback;
- notification failure/delay;
- unavailable service with web fallback.

Model scenarios:

- valid structured suggestion;
- invalid JSON/action;
- low confidence;
- prompt injection content;
- timeout/rate limit/unavailable provider.

Seed data:

- central QA Workspace;
- central mock Jira QA project;
- минимум три product Projects с разными entitlements;
- users for all roles;
- active/invalid ProjectIntegrationBindings;
- manual and automated requests/sessions;
- suite bindings and artifacts;
- pending Approval, conflict и stale Registry entry.

Целевой developer entrypoint поднимает infra, применяет migrations/seed и запускает API/worker/web. Конкретные command names фиксируются в foundation feature.

---

## 22. Testing strategy

Тесты обязательны по риску, а не ради coverage target.

Critical unit tests:

- Workspace + ProjectEntitlement decisions;
- Work Type/schema compatibility;
- DoR/DoD and session invariants;
- queue fairness/WIP/SLA;
- approval policy;
- mapping and normalized status;
- idempotency/retry classification;
- Tool Gateway permissions;
- Evidence Manifest validation.

Integration tests:

- PostgreSQL transaction + outbox;
- webhook inbox deduplication;
- worker restart/retry;
- each Connector against Mock Hub;
- API authorization against real test DB;
- artifact metadata/access;
- non-trivial migrations.

Connector contract tests:

- request/response shape;
- auth abstraction and required headers;
- pagination/rate-limit/error mapping;
- webhook parsing/signature/idempotency identity;
- dry-run/discovery/reconciliation;
- backward-compatible event schema.

Mandatory E2E:

1. Workspace isolation.
2. ProjectEntitlement isolation inside one Workspace.
3. Mattermost draft → confirm → one Jira issue → queue.
4. Jira duplicate/out-of-order webhook.
5. Jira stale write conflict.
6. MANUAL Session → review → evidence → defect link.
7. AUTOMATED Session → one pipeline → artifacts → human review.
8. Allowlisted infra retry without duplicate external effect.
9. Mattermost/model outage with deterministic/web fallback.
10. Forbidden production target and unauthorized project access.
11. Work Item DoD, exact Approval и confirmed Jira terminal transition.
12. Projection rebuild by reconciliation.

Scheduled/pre-release failure injection включает connector outage, rate limit, worker/queue restart, schema drift, artifact expiry и model invalid action.

---

## 23. Observability, metrics и SLO

Каждый log/trace содержит process, workspaceId, projectId, actor, correlationId, connector/profile/binding version и external key при наличии. Secrets и sensitive payloads редактируются.

### 23.1. Product/flow metrics

- `intake_to_ready_duration`;
- доля drafts с missing information;
- `ready_to_first_session_duration`;
- `session_execution_duration` по mode;
- `review_wait_duration`;
- `work_item_lead_time`;
- доля findings с defect/disposition;
- доля завершений с residual risk;
- queue age/fairness и WIP по Project;
- SLA warning/breach rate.

### 23.2. Automation metrics

- pipeline success/tests-failed/infra-error;
- automatic retry rate;
- flaky/retest rate по утверждённой формуле;
- runner queue/duration;
- artifact publication/expiry errors;
- time pipeline-complete → human-review.

### 23.3. Integration/agent/security metrics

- API/connector latency/error/retry/rate-limit;
- webhook lag и projection freshness;
- sync conflicts/mapping drift/reconciliation lag;
- duplicate external effects;
- Agent Runs by skill/status;
- approval rate/latency;
- Tool Gateway denials/errors;
- deterministic fallback rate;
- cross-project authorization denials;
- audit completeness.

### 23.4. Pilot SLO

- duplicate external effect для covered critical operations: `0`;
- unauthorized cross-Workspace/cross-Project disclosure или external effect: `0`;
- audit coverage agent/connector writes: `100%`;
- completed Test Sessions с подписанным Evidence Manifest: `100%`;
- webhook delivery/processing SLO: `[PILOT INPUT REQUIRED]` (after baseline);
- projection freshness percentile/window: `[PILOT INPUT REQUIRED]` (after baseline);
- Mattermost/model outage не блокирует Jira/manual flow;
- остальные latency/availability targets согласуются после измерения baseline.

Baseline и целевые улучшения lead-time/completeness/adoption: `[PILOT INPUT REQUIRED]` (after baseline).

---

## 24. API и event contracts

Минимальные API groups:

```text
/api/v1/workspaces
/api/v1/workspaces/:workspaceId/projects
/api/v1/workspaces/:workspaceId/entitlements
/api/v1/workspaces/:workspaceId/work-types
/api/v1/intake-candidates
/api/v1/intake-drafts
/api/v1/work-items
/api/v1/work-items/:id/commands
/api/v1/work-items/:id/qa/test-sessions
/api/v1/test-sessions/:id
/api/v1/test-sessions/:id/commands
/api/v1/test-sessions/:id/evidence
/api/v1/work-items/:id/qa/findings
/api/v1/work-items/:id/qa/verdicts
/api/v1/connections
/api/v1/connector-profiles
/api/v1/project-integration-bindings
/api/v1/approvals
/api/v1/agent-runs
/api/v1/webhooks/:connectorKey/:connectionId
```

External writes используют command resources и asynchronous status; synchronous HTTP success не означает confirmed external state.

Event envelope:

```json
{
  "eventId": "uuid",
  "eventType": "qa.verdict.signed",
  "occurredAt": "timestamp",
  "producer": "string",
  "workspaceId": "uuid",
  "projectId": "uuid",
  "entityType": "string",
  "entityId": "uuid",
  "correlationId": "uuid",
  "causationId": "uuid",
  "actor": {
    "type": "HUMAN|AGENT|SERVICE|SYSTEM|EXTERNAL",
    "principalId": "string",
    "issuer": "required URI for HUMAN",
    "subject": "required for HUMAN"
  },
  "payloadVersion": 1,
  "payload": {}
}
```

Ключевые event families:

```text
workspace.*, project.*, entitlement.*
intake_candidate.*, intake_draft.*
work_item.projection.*, work_item.sync.*
connector.command.*, connector.webhook.*, connector.mapping.*
qa.readiness.*, qa.test_session.*, qa.plan_item.*, qa.automation_attempt.*
qa.finding.*, qa.defect.*, qa.verdict.*, qa.evidence.*, qa.dod.*
approval.*, agent_run.*, onboarding.*, sla.*
```

Consumer обязан быть идемпотентным. Breaking payload change создаёт новую payload version и migration/compatibility period.

---

## 25. Основные таблицы

Platform Core:

```text
identities
workspaces, workspace_memberships, role_assignments
projects, project_versions, project_entitlements
pack_registrations, work_type_definitions, workspace_work_types
intake_candidates, intake_drafts, work_items, work_item_projection_history
external_entity_bindings
capabilities, principal_capabilities
queue_definitions, sla_policies, sla_clocks
connections, connector_profiles, connector_profile_versions, connector_mappings, connector_mapping_versions
project_integration_bindings, project_integration_binding_versions
webhook_inbox, command_outbox, connector_commands
idempotency_records, reconciliation_cursors, sync_errors
approvals
artifact_metadata, artifact_links
agent_definitions, skill_definitions, skill_versions
agent_runs, agent_steps, tool_invocations
audit_events, security_events
onboarding_records, onboarding_gate_results
```

QA Pack:

```text
qa_request_extensions
qa_readiness_assessments
qa_test_sessions
qa_plan_items
qa_observations
qa_automation_attempts
qa_findings
qa_defect_links
qa_verdicts
qa_evidence_manifests
qa_evidence_manifest_revisions
qa_project_contexts
qa_suite_bindings
qa_dod_assessments
```

Module owns its migrations/repositories. QA tables may reference stable Core IDs, но Core не имеет foreign key на QA tables.

---

## 26. Feature-spec roadmap — восемь specifications

Для каждой directory выполняется отдельный цикл `specify → clarify → plan → tasks → analyze → implement`.

### 001-extension-kernel-local-skeleton

**Scope:** static monorepo/composition root, Core/Pack/Connector contracts and registration, basic Workspace/Project scope, minimal versioned ProjectIntegrationBinding и exact Approval Gateway contracts, durable commands/events/audit/idempotency, stateful Mock Hub, local auth/storage/compose и Dummy Pack/Connector conformance.

**Dependencies:** нет.

**Independent acceptance:** local stack поднимается без corporate systems; Dummy Pack добавляет Work Type без изменения Core; Mock Connector выполняет typed command exactly once; два Project Scope изолированы.

### 002-qa-manual-walking-skeleton

**Scope:** QA Pack, `qa.validation`, Candidate/Draft, QaRequestExtension, DoR/DoD, MANUAL TestSession/Plan Items/Observations, Finding, defect draft, signed Verdict и revisioned Evidence Manifest против mock operational authority.

**Dependencies:** 001.

**Independent acceptance:** confirmed request проходит manual flow до signed Verdict и immutable evidence; `DONE + FAIL` демонстрируется с linked defect; model outage и cross-project attack не ломают инварианты.

### 003-jira-operational-authority

**Scope:** реальный Jira Connector, central QA Request/Defect Profiles, OperationalAuthorityBinding, create/import, mappings, webhook projection, expected-version writes, conflict и reconciliation.

**Dependencies:** 001, 002.

**Independent acceptance:** create/import формируют один Jira-bound Work Item; duplicate/out-of-order события безопасны; stale write даёт visible conflict; approved defect создаётся ровно один раз.

### 004-mattermost-hermes-intake

**Scope:** Mattermost guided intake/Candidate notifications, verified external identity binding, один Hermes coordinator, bounded skills, explainable/stale recommendations, notification outbox, prompt boundaries и deterministic fallback.

**Dependencies:** 001, 002, 003.

**Independent acceptance:** guided Mattermost flow после confirmation создаёт одну central Jira QA Request; пользователь видит только entitled Projects; Candidate не создаёт Work Item автоматически; model/Mattermost outage сохраняет deterministic/web flow.

### 005-gitlab-automated-validation

**Scope:** GitLab typed capabilities, source context, suite/environment allowlists, AUTOMATED TestSession, AutomationAttempt, exact-once trigger, result/artifact contract, infra retry/flaky lineage и human outcome/Verdict.

**Dependencies:** 001, 002, 003; 004 требуется только для Mattermost command/notification surface.

**Independent acceptance:** allowlisted non-prod suite запускается ровно один раз; canonical result/artifacts связываются с Session; один infra retry сохраняет lineage; PASS не становится Verdict; production target отклоняется.

### 006-queue-triage-capacity-sla

**Scope:** Candidate/Backlog/Ready/Active/Completed stages, project lanes и portfolio view, TriageAssessment, hard Workspace WIP, soft Project limits/reservations, service classes, human overrides и deterministic SLA.

**Dependencies:** 002, 003, 004; 005 предоставляет automation facts.

**Independent acceptance:** Candidate не расходует WIP/SLA; project aggregation не раскрывает чужие counts; concurrent EXPEDITE/WIP policy детерминирована; Hermes recommendation не становится accepted business priority.

### 007-project-onboarding-evidence-security

**Scope:** versioned per-Project onboarding package, ProjectIntegrationBinding publish/retire/rollback, ProjectEntitlements и external identities, target snapshot conformance, artifact classification/redaction/retention/access, L0/C1/N2/P3 gates и sequential project onboarding.

**Dependencies:** 003, 004, 005, 006.

**Independent acceptance:** новый Project публикует exact binding version только после validation package; unauthorized Project/evidence access отклоняется; target/profile change аннулирует pending Approval; expired raw artifact оставляет manifest/audit.

### 008-pilot-hardening-and-conformance

**Scope:** real non-prod pilot integration, cross-feature conformance, observability/SLO, failure injection, security review, backup/restore, projection rebuild, migration rehearsal, performance baseline, runbooks, kill switches и controlled rollout.

**Dependencies:** 001–007.

**Independent acceptance:** reference Project проходит L0/C1/N2/P3 и end-to-end manual+automated flow; exact approval/audit chain, DR/reconciliation, security isolation и degraded modes доказаны; connector/project можно suspend без потери истории.

---

## 27. Definition of Ready/Done для feature specification

Feature готова к `plan`, когда:

- определён independent user outcome;
- граница Core/Pack/Connector зафиксирована;
- Workspace и ProjectEntitlement checks перечислены;
- source of truth определён для каждого изменяемого поля;
- API/events и compatibility описаны;
- external commands, idempotency, conflict/retry определены;
- agent tools/approvals/fallback определены;
- local mock/failure scenarios перечислены;
- critical tests и independent acceptance сформулированы;
- все внешние значения отмечены `[PILOT INPUT REQUIRED]`.

Feature завершена, когда:

- acceptance scenarios реализованы;
- contracts и schemas опубликованы;
- migrations проверены;
- RBAC/entitlement отрицательные tests проходят;
- writes имеют audit/idempotency;
- Mock Hub поддерживает новые scenarios;
- critical tests, observability и runbook обновлены;
- feature независимо демонстрируется;
- анализ не обнаруживает запрещённых зависимостей или source-of-truth conflict.

---

## 28. Pilot input register

Ниже перечислены только внешние факты, необходимые для конфигурации и rollout.

### Organization и access

- pilot Project list, business/technical/QA owners, criticality/classification: `[PILOT INPUT REQUIRED]`;
- QA team roster, roles, groups и ProjectEntitlements: `[PILOT INPUT REQUIRED]`;
- corporate identity issuer/claims/group mapping либо approved auth boundary: `[PILOT INPUT REQUIRED]`;
- DNS, TLS, proxy, outbound allowlist и callback URLs: `[PILOT INPUT REQUIRED]`;
- secret manager paths, credential rotation/revoke process: `[PILOT INPUT REQUIRED]`.

### Jira

- URL/API/auth/service identity/scopes: `[PILOT INPUT REQUIRED]`;
- central QA project/issue type: `[PILOT INPUT REQUIRED]`;
- fields/statuses/transitions/priorities/JQL/link types: `[PILOT INPUT REQUIRED]`;
- webhook/reconciliation/rate limits: `[PILOT INPUT REQUIRED]`.

### GitLab

- URL/auth/scopes/repositories: `[PILOT INPUT REQUIRED]`;
- pipeline contract, suites, variables, environments and runners: `[PILOT INPUT REQUIRED]`;
- webhook/error codes/artifact access and retention: `[PILOT INPUT REQUIRED]`.

### Mattermost

- URL/bot/service identity/channels: `[PILOT INPUT REQUIRED]`;
- signing/callback/identity mapping: `[PILOT INPUT REQUIRED]`;
- notification, quiet-hours and incident channels: `[PILOT INPUT REQUIRED]`.

### Operations

- team capacity, global/per-Project WIP: `[PILOT INPUT REQUIRED]`;
- Workspace timezone/calendar/SLA targets: `[PILOT INPUT REQUIRED]`;
- observability endpoints, retention and incident owners: `[PILOT INPUT REQUIRED]`;
- backup/RPO/RTO requirements: `[PILOT INPUT REQUIRED]`;
- baseline measurement window/owner: `[PILOT INPUT REQUIRED]`;
- pilot success targets for flow/adoption/SLO: `[PILOT INPUT REQUIRED]` (after baseline).

Отсутствие конкретного external value блокирует только соответствующий onboarding gate, а не меняет продуктовую архитектуру.

---

## 29. Критерии готовности QA pilot

Пилот готов, когда:

1. центральный QA Workspace и минимум один Project полностью onboarded;
2. ProjectEntitlement предотвращает cross-project leakage;
3. Mattermost является рабочим preferred intake, web fallback доступен;
4. submit создаёт ровно одну central Jira QA issue;
5. Jira остаётся фактическим источником operational state;
6. queue справедливо ранжирует несколько Projects и показывает sync/SLA/WIP;
7. `qa.validation` поддерживает несколько MANUAL/AUTOMATED sessions;
8. manual flow завершает reviewed evidence и defect disposition;
9. automated flow запускает allowlisted GitLab pipeline exactly once и требует human verdict;
10. Hermes использует только v1 skills/tools и не блокирует deterministic fallback;
11. consequential actions проходят Approval/explicit command;
12. audit восстанавливает цепочку actor → command/Agent Run → tool → connector → external result;
13. local Mock Hub воспроизводит success, conflict, duplicate, outage и security scenarios;
14. SLO/security/backup/reconciliation onboarding gates пройдены;
15. Analytics и Technical Writing не являются зависимостью или acceptance condition QA pilot.

---

## 30. Итоговое архитектурное утверждение

**Agentic Workspace Platform — общая Jira-centric функциональная платформа с QA-first реализацией. Platform Core предоставляет Workspace, ProjectEntitlement, Work Item, queue/SLA, approvals, audit и extension runtimes; QA Competency Pack предоставляет `qa.validation` и доменные Test Sessions, Findings, Verdict и Evidence; независимые typed Connectors предоставляют Jira, GitLab и Mattermost capabilities. Один центральный QA Workspace обслуживает разные Projects через project-scoped authorization и fair queue. Jira владеет lifecycle рабочих заявок, GitLab — фактическим CI state и binaries, QA Pack — QA semantics, а Hermes только координирует разрешённые structured actions с deterministic fallback и human control.**
