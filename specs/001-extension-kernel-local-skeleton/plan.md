# Implementation Plan: Extension Kernel и локальный walking skeleton

**Feature:** `001-extension-kernel-local-skeleton`  
**Specification:** [spec.md](spec.md)  
**Plan status:** Ready for `/speckit.tasks`  
**Planned:** 2026-08-27  
**Scope:** только feature 001; этот документ не является планом реализации QA Pack

## 1. Результат планирования

Feature 001 будет реализована как статически собираемый TypeScript monorepo с чистым Platform Core, отдельными SDK для Competency Pack и Connector, локальным Dummy Pack, Mock Connector и четырьмя runtime-приложениями: API, worker, web и Mock Hub.

PostgreSQL является единственным источником durable business/workflow state. Redis/BullMQ используется для доставки и scheduling, но потеря Redis не должна терять command. Любая внешняя запись проходит `typed Pack action → Command Gateway → authorization/approval → transactional outbox → worker → Connector Broker → Connector`, использует стабильный effect idempotency key и получает подтверждённый результат. Обещание — effectively-once observable effect поверх at-least-once delivery, а не физический exactly-once transport.

План создаёт foundation и local conformance harness, но не вводит QA entities, Jira semantics, реальные Jira/GitLab/Mattermost connections, Hermes или production deployment.

## 2. Входы и артефакты Phase 1

### Нормативные входы

- [Конституция](../../.specify/memory/constitution.md)
- [Master Specification v2](../../docs/agentic-workspace-platform-master-spec-v2.md)
- [ADR-0001: Core, Pack, Connector](../../docs/adr/0001-competency-pack-work-type-connector.md)
- [ADR-0004: Workspace и Project Entitlement](../../docs/adr/0004-workspace-project-entitlement.md)
- [ADR-0005: Hermes и exact Approval](../../docs/adr/0005-hermes-coordinator-approval.md)
- [ADR-0006: Project Integration Binding](../../docs/adr/0006-project-integration-binding-versioning.md)
- [ADR-0007: Action-specific exact Approval](../../docs/adr/0007-action-specific-exact-approval.md)
- [Feature specification](spec.md)

При конфликте действует порядок: Конституция → feature specification и принятые ADR → master-spec → этот план.

### Результаты planning phase

- [research.md](research.md) — выбранный стек и решения по рискам;
- [data-model.md](data-model.md) — агрегаты, таблицы, ограничения и state machines;
- [contracts/](contracts/) — HTTP, event, manifest, command, approval и binding contracts;
- [quickstart.md](quickstart.md) — целевой локальный developer contract;
- этот `plan.md` — структура реализации, gates и трассировка.

`tasks.md` намеренно не создаётся на этапе `/speckit.plan`.

## 3. Technical Context

| Область | Решение для 001 |
|---|---|
| Language/runtime | TypeScript `6.0.x`, strict, ESM; Node.js `24.x` LTS |
| Workspace/tooling | pnpm `11.x` workspaces + Nx `23.1.2`; Nx Cloud не обязателен |
| Backend | NestJS `11.x`; Core остаётся framework-independent |
| Web | React `19.2.x`, Vite `8.2.x`, MUI `9.x` за собственным `platform-ui` facade |
| Durable persistence | PostgreSQL 17–18 compatibility; local pin PostgreSQL 18; TypeORM `1.1.x`; `synchronize:false`; явные module-owned migrations |
| Delivery | Redis 8.2 + BullMQ 6; только accelerator/retry/scheduling; durable command и outbox — в PostgreSQL |
| Object storage | Adobe S3Mock `5.1.x` за provider-neutral S3 port; в 001 только generic object/artifact-reference smoke, без QA evidence semantics |
| Contracts | OpenAPI 3.1; JSON Schema 2020-12; TypeBox 1 + Ajv 8; локальные immutable schema refs |
| Identity | Fake OIDC issuer с настоящими discovery/JWKS/JWT validation paths; identity key — `issuer + subject` |
| Tests | Vitest 4, Nest testing utilities, React Testing Library, Testcontainers, Playwright Chromium, architecture/contract tests |
| Observability | Structured JSON logs, OpenTelemetry traces/metrics, correlation/causation IDs, redaction policy |
| Deployment target | Docker Compose local/test only; никакой production composition в 001 |
| Performance | SLA/throughput gate не задаётся; приоритет — корректность isolation, recovery и idempotency |
| Seed scale | 2 Workspaces, 4 Projects, несколько principals/entitlements, 1 Dummy Pack, 1 Mock Connector и две совместимые реализации capability в conformance tests |

Точные package patches фиксируются lockfile, а container images — проверенными `tag@sha256:<manifest-digest>` references при bootstrap. Поддерживаемые major/minor ranges и политика обновления описаны в [research.md](research.md).

## 4. Constitution Check — до проектирования

| Принцип | Статус | Как соблюдается |
|---|---|---|
| I. QA-first продукт | PASS | Dummy Pack существует только в local/test и conformance builds. Он не является вторым product Pack и не попадает в pilot composition. |
| II. Jira authority | PASS | Jira отсутствует. Dummy Work Item — синтетический conformance aggregate, не принятая QA-заявка и не имитация Jira-owned operational state. |
| III. Workspace/Project boundary | PASS | Все operational/project-scoped rows, commands, events, jobs, approvals и artifact refs несут оба scope ID; raw webhook quarantine и pre-project SYSTEM audit имеют явный WORKSPACE scope до resolution, но не становятся operational event. Deny выполняется до repository/adapter. |
| IV. Core/Pack/Connector | PASS | Статический composition root, отдельные SDK и запрещённые направления импортов проверяются автоматически. |
| V. Deterministic Core | PASS | Model provider optional/fake; authorization, transitions, mappings, retry и validation не используют LLM. |
| VI. Exact approvals | PASS | Core получает exact subject, двухосевое состояние decision/effect authorization и effect-time revalidation. Hermes в 001 отсутствует. |
| VII. Human QA verdict | N/A | QA lifecycle/verdict полностью out of scope и не появляется в Core/Dummy. |
| VIII. Evidence/target snapshot | PASS | 001 хранит generic immutable artifact refs и pinned exact binding/profile refs; QA Evidence Manifest появится в 002. |
| IX. Reliability/audit | PASS | PostgreSQL outbox/inbox/idempotency, append-only audit и replay-safe connector strategy обязательны. |
| X. Local-first/integrations | PASS | Stateful Mock Hub, fake OIDC/model и injected failures; corporate systems/credentials не нужны. |
| XI. Versioning | PASS | Manifest/capability/schema используют SemVer; published profile/binding — immutable revision + hash; migrations — expand/contract. |
| XII. Production boundary | PASS | Local composition содержит только Mock Connector; endpoint/credential/network gates запрещают production effect. |

**Constitution exceptions:** нет.

## 5. Архитектура решения

### 5.1. Runtime flow

```text
React web
   │ OIDC token + scoped HTTP request
   ▼
Nest API ──► application use case ──► authorization policy
                                      │
                                      ├─ deny ──► audit/problem details
                                      │
                                      ▼
                              PostgreSQL transaction
                         domain state + command + outbox
                                      │
                         outbox dispatcher → BullMQ scoped dispatch envelope
                                      │
                                      ▼
                                  Nest worker
                         reload + reauthorize + resolve
                         pinned binding/profile + approval
                                      │
                                      ▼
                              typed Connector Broker
                                      │
                                Mock Connector
                                      │
                                      ▼
                            stateful local Mock Hub
                                      │
                         confirmed result/event → inbox
```

Redis может потерять job даже после успешного enqueue: PostgreSQL reconciliation sweep повторно ставит non-terminal command после visibility deadline. Job содержит `commandId`, `workspaceId`, `projectId`, actor ref, correlation и causation IDs согласно FR-014; worker не доверяет копии и сверяет её с authoritative command до чтения/эффекта. Worker может упасть после внешнего effect: повтор использует тот же effect key, а Mock Hub/Connector возвращает уже созданный результат. `effectCount=1` является критерием; число HTTP attempts может быть больше одного.

### 5.2. Bounded modules Core

| Модуль | Владеет | Не владеет |
|---|---|---|
| Identity & Access | Principal refs, memberships, role assignments, entitlements, classification decisions | Corporate IAM provisioning, QA roles semantics |
| Workspace & Project | Workspace, generic Project Registry, lifecycle, ownership metadata | QA project context, Jira project fields |
| Extension Registry | Pack/Connector manifests, Work Type definitions, enablement, compatibility diagnostics | Dynamic loading, remote code |
| Integration Registry | Connection, schema-bound Mapping/Profile versions, capability contracts, Project Integration Binding versions | Vendor mapping semantics/columns inside Core, raw secrets |
| Work Management | Generic Intake Draft, Work Item, operational binding | QA session/evidence/verdict rules |
| Commanding & Delivery | Gateway, command, idempotency, outbox/inbox, effect receipt, retries | Direct vendor SDK calls |
| Approval | Exact immutable subject, human decision, effect authorization, consumption | Pack-owned approval bypass |
| Audit & Artifacts | Append-only audit and generic artifact metadata/reference | Binary evidence semantics or reusable test library |
| Policy & Observability | Deny-by-default evaluation, redaction, health, correlation | LLM-based security decisions |

Dummy Pack владеет только `dummy.request`, своей namespaced table, intake/action schemas и UI contribution. Mock Connector владеет только реализацией тестовой typed capability и protocol mapping к Mock Hub.

### 5.3. Структура monorepo

```text
apps/
├── api/
├── worker/
├── web/
├── mock-hub/
└── fake-idp/

packages/
├── platform-contracts/
├── competency-sdk/
├── competency-ui-sdk/
├── connector-sdk/
├── platform-core/
├── platform-runtime-nest/
├── platform-persistence-typeorm/
├── platform-queue-bullmq/
├── platform-ui/
├── competency-dummy/
├── connector-mock/
├── runtime-composition/
└── platform-testkit/

infra/
├── compose/
└── observability/

tests/
├── architecture/
├── contract/
├── integration/
└── e2e/
```

Module-owned migrations размещаются рядом с owning package, а единый migrate runner обнаруживает их только через статический composition map. Mock Hub использует отдельную database/role без foreign keys из Platform Core.

### 5.4. Направления зависимостей

```text
competency-dummy ──imports──► competency-sdk ──imports──► platform-contracts
competency-dummy UI ────────► competency-ui-sdk ───────► platform-contracts
connector-mock ─────────────► connector-sdk ───────────► platform-contracts
platform-runtime-nest ──────► platform-core ───────────► platform-contracts
platform-persistence-typeorm► platform-core
platform-queue-bullmq ──────► platform-core

apps ──imports──► runtime-composition ──imports──► все выбранные модули
```

Правила enforcement:

- `platform-core` не импортирует NestJS, TypeORM, BullMQ, Pack, Connector или vendor SDK;
- Pack импортирует только public exports `competency-sdk`, `competency-ui-sdk`, contracts и нейтральные библиотеки;
- Connector импортирует только public exports `connector-sdk`, contracts и protocol libraries;
- Pack и Connector не импортируют друг друга;
- полный граф разрешено знать только `runtime-composition`;
- deep import из `src/`, циклы и обход path aliases запрещены;
- Nx tags, ESLint restrictions и отдельные architecture tests проверяют одно и то же правило разными уровнями;
- Core build/test запускается в composition без Dummy/Mock.

## 6. Ключевые design decisions

### 6.1. Extension registration

Manifest содержит только versioned metadata, schema refs/digests и compile-time component keys. Import path, URL, script или package download запрещены. Composition root сопоставляет component key с заранее скомпилированным factory.

Boot reconciliation валидирует manifest schema, duplicate keys, SemVer ranges, schema digests и declared capabilities. Ошибка одного extension создаёт append-only `REJECTED` registration attempt с diagnostic codes, не перезаписывает ранее принятую canonical key/version/hash registration и не останавливает независимое ядро. Обязательный extension runtime может влиять на readiness конкретной composition, что задаётся deployment manifest, а не hardcode Core.

`logicalRole` — opaque Pack-owned string. Conformance использует только neutral sample vectors `PRIMARY`, `SECONDARY` и `sample.record.primary`; будущий QA Pack объявит собственные значения без изменения Core schema или branching.

### 6.2. Authorization and classification

Базовая policy для каждого HTTP/worker/artifact/connector use case формируется сервером:

```text
authenticated principal (issuer + subject)
AND active Workspace membership
AND effective Project Entitlement (explicit DENY wins)
AND permission from active role assignment
AND resource classification <= entitlement ceiling
```

Только Connector/effect path после базовой проверки добавляет `resource classification <= resolved Binding ceiling` и resource/payload `dataClassificationKey` в allowlist exact Profile. Artifact proxy и обычный repository read не требуют искусственного Profile resolution.

UI не передаёт actor/roles и не является security boundary. Repository ports требуют обязательный `Scope {workspaceId, projectId, principalId, classificationCeiling}`; unscoped project repository API не существует. Composite keys/foreign keys являются вторым рубежом. PostgreSQL RLS не является primary control в 001; после security spike его можно добавить как дополнительный defense-in-depth без изменения application contract.

Authorization basis context-discriminated: Project-scoped use cases требуют минимум один exact
entitlement ref, а Workspace-scoped Connection/Mapping/Profile validation использует закрытую форму
с пустым entitlement set. Policy, membership, role assignment и skill context остаются exact в обеих
формах; enclosing contract выбирает форму, не caller. SYSTEM webhook rejection до Project resolution
не фабрикует human basis и сохраняет transport/security reason без authorization basis/hash.

Async worker восстанавливает scope из durable command, заново проверяет membership/entitlement/permission/classification и только потом разрешает binding/profile. Отозванный доступ означает policy denial и ноль connector invocations.

### 6.3. Durable command and effectively-once effect

1. Typed Pack endpoint создаёт `CapabilityCommandIntent`; Pack указывает requirement key, но не profile/connection/endpoint. Intent содержит ровно один durable source: `intakeDraftId` для acceptance либо `sourceWorkItemId` для последующей команды.
2. Gateway валидирует schema, scope, policy, idempotency request hash и requirement.
3. Broker детерминированно разрешает exact published Binding/Profile refs `{id, version}` и проверяет capability/environment/classification.
4. При необходимости command переходит в `AWAITING_APPROVAL`, а outbox создаётся в `HELD`; без authorization он не dispatchable.
5. Domain mutation, command row, idempotency record, audit stage и `HELD`/`READY` outbox row коммитятся одной PostgreSQL transaction.
6. После exact approval release-транзакция сверяет immutable subject с подготовленным command, переводит command в `QUEUED`, outbox — в `READY`, но оставляет effect authorization в `AUTHORIZED`.
7. Dispatcher claim-ит `READY` либо просроченный `ENQUEUED` outbox с lease/`SKIP LOCKED` и публикует scoped dispatch envelope в BullMQ. `nextRepublishAt` сохраняется в PostgreSQL; enqueue не считается terminal delivery.
8. Worker повторно загружает authoritative command, сравнивает scope/actor/correlation/causation job envelope, получает durable DB execution lease и подтверждает enqueue. Непосредственно перед Connector call он повторно проверяет policy/expiry/subject/version drift и атомарно сохраняет gate decision + exact effect-time authorization basis. Успех в одной транзакции с execution-attempt claim CAS-ит `AUTHORIZED → CONSUMED`; drift сохраняет `DENIED` basis/reason и даёт `AUTHORIZED → INVALIDATED` без вызова Connector.
9. Capability Contract объявляет допустимые стратегии, а каждая конкретная Connector implementation — поддерживаемые `NATIVE_KEY`, `NATURAL_KEY_LOOKUP` и/или `RECONCILIATION` плюс confirmation modes. Profile publish выбирает только из их пересечения; каждый declared вариант обязан пройти conformance. Write capability без проверяемой implementation strategy нельзя публиковать.
10. Confirmed result/effect receipt и audit записываются durable. Для intake acceptance команда до effect ссылается только на Draft и не резервирует Work Item ID; только confirmation transaction одновременно создаёт Work Item, записывает `resultWorkItemId`, создаёт operational binding и Pack extension и связывает Draft. Pending/failed command остаётся Draft и не создаёт частичный Work Item. Crash после external effect безопасен за счёт неизменного effect key и lookup/reconciliation.

Client request idempotency и external effect idempotency разделены. Same request key + same canonical request в actor/scope/operation namespace возвращает исходный resource/result; тот же request key + другой hash даёт `409 IDEMPOTENCY_KEY_REUSED`. Gateway один раз создаёт отдельный globally unique `effectIdempotencyKey`, сохраняет его в command/Approval и передаёт Connector при каждом retry/reconciliation; клиент не задаёт этот ключ.

### 6.4. Exact Approval

Approval subject immutable и хэшируется как `SHA-256(RFC 8785 canonical JSON)` вместе с schema/version identifiers. Историческое решение и право на effect разделены:

- `decisionStatus`: `PENDING | APPROVED | REJECTED | EXPIRED | CANCELLED`;
- `effectAuthorizationStatus`: `NOT_AUTHORIZED | AUTHORIZED | INVALIDATED | CONSUMED`.

Изменение target/payload/expected state/binding/profile, expiry либо потеря membership/entitlement/role не переписывает факт `APPROVED`, а до первого invocation переводит effect authorization в `INVALIDATED` с reason code. Release `AWAITING_APPROVAL → QUEUED` и `HELD → READY` не потребляет право. Переход `AUTHORIZED → CONSUMED` выполняется только worker-ом после live revalidation, атомарно с durable execution-attempt claim непосредственно перед Connector call. `CONSUMED` привязан к одному command/effect key: восстановление неоднозначного уже начатого attempt допускает лишь idempotent replay/lookup/reconciliation того же exact effect и не является новым consumption.

Для local control-plane mutation (в 001 — publish Binding) request создаёт durable `platform_action_execution` и Approval. Subject pin’ит candidate ref/row version/content hash, а также stable Binding header row version и current-published version (`0` означает отсутствие current). APPROVE синхронно под lock того же header в одной DB transaction повторяет обе части exact validation, CAS-consumes authorization, публикует immutable revision и завершает action; competing publication либо иной drift сохраняет `APPROVED + INVALIDATED` без публикации. Единственная identity `actionKind + actionId` уже входит в immutable subject; consumption добавляет только timestamp и не может подменить её вторым action ref, поэтому Connector command и platform action не смешиваются.

Binding publication policy в 001 исполняет master separation of duties: request инициирует Integration Administrator, а APPROVE выполняет отличный от него Workspace Owner с актуальным `project.admin` entitlement на тот же Project.

### 6.5. Binding and Profile

Published Connection/Mapping/Profile/Binding revisions неизменяемы и используют ETag/`If-Match`. Connection endpoint, secret ref, policy и Connector configuration меняются только новой revision; mutable health хранится отдельно. Optional Profile `mappingRef` pin’ит exact PUBLISHED Mapping version того же Workspace/Connector, а проверенный `mappingContentHash` явно round-trip-ится и входит в Profile fingerprint. Profile pin’ит exact same-Workspace Connection ref, command — exact Binding/Profile refs, а Work Item — exact Binding ref, использованный при confirmation. Tuple `(workspace, project, environment, capability, logicalRole)` уникален внутри published binding. Connection quarantine classification должна быть не ниже максимальной разрешённой входящей classification всех Profile entries, которые её pin’ят.

Каждый переход candidate из DRAFT атомарно создаёт immutable scoped Validation Report и pin’ит
его `validationReportId`; failed report оставляет DRAFT без ссылки. Report обязан совпадать по
scope, subject id/version и semantic content hash. Provenance ref не входит в content hash, иначе
report с subject hash образовал бы циклический fingerprint.

Publish сериализуется lock-ом stable header и атомарно `RETIRED` previous + `PUBLISHED` candidate. Retired revision не выбирается новым draft, но остаётся валидной через уже-published downstream pin во время Connection→Profile→Binding upgrade и для started same-effect recovery. До первого effect worker сравнивает current effective Binding-chain fingerprint: drift invalidates Approval либо завершает `NOT_REQUIRED` command как `FAILED/CONFIGURATION_DRIFT`, всегда без Connector call. После `effectInvocationStartedAt` recovery не reroute-ится и использует pinned chain + прежний effect key.

Core binding хранит generic schema-validated `resourceRefs/configurationRefs`; поле `suiteBindingRefs` не становится Core concept. В 002 QA Pack сможет объявить namespaced `qa.suite-binding` reference в собственном Project Context. Это сохраняет смысл ADR-0006 без QA hardcode.

### 6.6. Inbound events

Webhook ingress выбирает Connector по compile-time registry и exact published Connection version, pin’ит эту revision, присваивает raw bytes её обязательный conservative `quarantineClassificationKey`, проверяет подпись/timestamp/replay до parsing domain payload и сохраняет raw receipt с transport dedupe key `(connectionId, deliveryId)`. Повтор key с тем же hash идемпотентен; другой hash — security conflict, не duplicate. После нормализации каждый downstream consumer использует отдельный inbox key `(consumerName, producer, eventId)` с тем же hash-conflict правилом; consumer marker, projection mutation и resulting outbox коммитятся одной transaction.

`entityVersion <= current` означает duplicate/stale. Gap не применяется вслепую: создаётся reconciliation request. Operational events 001 всегда содержат `workspaceId` и `projectId`; будущие global boot events должны получить отдельный envelope, а не nullable scope.

### 6.7. Local production barrier

Защита многослойная:

- отдельная `local` composition включает только Mock Connector и fake providers;
- local composition/use-case policy принимает только `environmentScope=LOCAL` и отклоняет иные значения до persistence или effect; shared contract сохраняет будущие non-local enum values;
- endpoint allowlist принимает только service name Mock Hub;
- raw secret отсутствует; fake secret refs разрешаются только local resolver;
- контейнерная network policy/egress deny не позволяет обратиться к корпоративному или public endpoint;
- fake identity admin routes физически не входят в non-local build;
- API, worker и UI показывают/пишут `runtime.profile=local` в health/telemetry.

## 7. Contract and versioning strategy

- HTTP contract: checked-in OpenAPI 3.1, `/api/v1`, RFC 9457 Problem Details, `Idempotency-Key`, `X-Correlation-Id`, `If-Match`, `202 + Location` для async operations.
- Actor извлекается из token; body не принимает actor, role, entitlement или authoritative scope.
- Core не публикует универсальный `POST /connector-commands`; command появляется только из typed Pack action/Application Port.
- Extension/command/event/profile/binding contracts: JSON Schema 2020-12, `additionalProperties:false`/`unevaluatedProperties:false`, локальные immutable refs.
- Динамический Pack payload разрешён только как `SchemaBoundValue {schemaRef, schemaVersion, schemaDigest, value}` и повторно валидируется по registry.
- Manifest/Work Type/capability contracts используют SemVer; Profile/Binding — монотонную integer revision и content hash; wire envelopes/payloads — integer major.
- Один key/version с другим digest является hard registration error для конкретного extension.
- Additive optional field совместим; удаление/rename/narrowing или новое required field — breaking change с migration policy.
- Design contracts являются source of truth; implementation DTOs и generated API snapshot проверяются на drift в CI.

## 8. Persistence and transaction boundaries

Подробная модель приведена в [data-model.md](data-model.md). Обязательные границы:

- mutation + command/idempotency/audit/outbox — одна PostgreSQL transaction;
- inbox marker + projection/change + resulting outbox — одна transaction;
- published config immutable; изменение только новой revision;
- raw secrets отсутствуют во всех platform tables;
- content-bearing row имеет data classification;
- child project row использует composite FK, не позволяющий смешать Workspace/Project;
- append-only audit DB role не получает `UPDATE/DELETE`;
- TypeORM `synchronize` выключен во всех profiles;
- migrations выполняются one-shot gate до запуска API/worker и тестируются как fresh install, repeat/no-op и upgrade;
- Mock Hub использует отдельную database/role и собственные migrations.

## 9. Local composition

Обязательные services:

```text
postgres
redis
s3mock
s3mock-init
fake-idp
migrate
seed
api
worker
web
mock-hub
```

Compose DAG: `postgres/redis/s3mock actuator/fake-idp healthy → migrate → s3mock-init(bucket) → seed(data) → api/worker/web/mock-hub → post-init readiness`. Fake IdP — отдельный stateless local-only service с HTTPS discovery/JWKS/token endpoints и certificate SAN `fake-idp`; API зависит от его readiness. S3Mock actuator profile включён явно; container health не зависит от ещё не созданного bucket, а authenticated bucket/object probe выполняется только после init/seed. PostgreSQL и S3Mock используют named volumes; S3Mock persistent store/retain-on-exit включены явно. Optional profile: OpenTelemetry collector и local trace UI. `local:down` сохраняет volumes; только явно обозначенный `local:reset` удаляет volumes конкретного compose project.

Mock Hub поддерживает reset, deterministic seed, effect ledger и только external-system сценарии: success, timeout, connector 401/403, 429, 5xx, duplicate event, out-of-order event, schema drift и webhook signature/replay fixtures. `INVALID_MODEL_OUTPUT` принадлежит fake model provider, а `POLICY_DENIAL` — Core policy harness и завершается до Mock Connector/Hub.

## 10. Verification strategy

Тесты привязаны к рискам, без произвольного общего coverage percentage.

| Acceptance test | Проверяемое поведение | Основной уровень | Trace |
|---|---|---|---|
| AT-001 | Clean bootstrap, migrations/seed, health всех services | smoke/E2E | US-001, SC-001 |
| AT-002 | Model unset/invalid/timeout не блокирует deterministic Dummy flow | contract/E2E | FR-027, FR-030 |
| AT-003 | Fake role/persona switch видим; backend не доверяет UI; non-local Connection отклоняется до persistence и effect | security/E2E | FR-010–015, FR-027–028 |
| AT-004 | Manifest registration, versions/ranges/digests и Workspace enablement | contract/integration | FR-001, FR-008–009 |
| AT-005 | Core build без Dummy/Mock; forbidden imports/deep aliases/cycles падают | architecture | FR-002–007, SC-002–003 |
| AT-006 | Каждая capability operation typed; generic `execute(any)` отсутствует; neutral opaque-role vectors принимаются без Core enum/branch и неизвестное валидное Pack value не требует Core change | compile/contract | FR-022, FR-032 |
| AT-007 | Missing required capability requirement запрещает publication Project Integration Binding; optional requirement даёт scoped unavailable reason | integration | FR-024–025 |
| AT-008 | Command→held/ready outbox→Redis loss/restart/stale execution-lease recovery→confirmed; отдельный stable effect key и один effect при нескольких attempts | integration/E2E | FR-014, FR-016–021, SC-005 |
| AT-009 | Raw delivery dedupe/signature/replay; same-ID/different-hash даёт security conflict; rejection до Project resolution создаёт только WORKSPACE-scoped security audit и quarantine без operational project event; normalized duplicate/out-of-order/gap даёт dedupe, conflict или reconciliation | integration/security | FR-018, FR-021, FR-029–030 |
| AT-010 | Scope/classification deny до repository/adapter, включая forged IDs/revoked grant; PROJECT basis без entitlement и WORKSPACE basis с fabricated entitlement отклоняются; referenced classification key/rank immutable и historical decisions не переосмысляются | security/E2E/model | FR-010–015, SC-006 |
| AT-011 | Каждая write stage audited с exact scope/action, initial/effect policy, membership, entitlement, role, skill (`NOT_APPLICABLE` явно), Binding/Profile refs; confirmed/conflict/failure round-trip-ят normalized result hash/code, deny/error — reason; secrets/payloads redacted; audit append-only | integration/security | FR-017, FR-019–020, SC-007 |
| AT-012 | Mock reset/seed/scenario/effect ledger, включая 401/403 и schema drift, детерминированы | contract | FR-026–030, Constitution X |
| AT-013 | Вторая test implementation той же capability заменяет Mock через Profile без Pack change | conformance | FR-022–026, SC-004 |
| AT-014 | Validate atomарно pin’ит exact successful scoped Validation Report вне semantic content hash; publish lock атомарно supersede-ит Connection/Mapping/Profile/Binding; exact same-Workspace transitive pins; optional mappingRef round-trip/hash и Profile/Connection/Mapping connectorRef compatibility; retired-chain recovery, health isolation и no raw secrets | integration | FR-023–024, FR-031–033 |
| AT-015 | Approval остаётся AUTHORIZED при queue release, invalidates при drift/expiry/revoke до call и CAS-consumes ровно один раз непосредственно перед effect; NOT_REQUIRED pre-effect config drift завершается без call | integration/security | FR-034–035 |
| AT-016 | Invalid extension isolated; Redis loss recoverable from PostgreSQL | resilience | FR-009, FR-016, security requirements |
| AT-017 | Negative command snapshots (`CONFIRMED+HELD`, `CONFIRMED+PENDING`, `AWAITING_APPROVAL+CONSUMED`, invocation без `ALLOWED` gate/basis, `DENIED` без reason либо с invocation, `INVALIDATED` без denied basis, non-terminal `DEAD`, terminal state/result outcome mismatch) отклоняются contract/domain validation | contract | FR-016–017, FR-034–035 |
| AT-018 | Profile publish отклоняет idempotency/confirmation strategy вне пересечения Capability Contract и конкретной Connector implementation | contract/conformance | FR-022–024 |
| AT-019 | Integration Administrator создаёт Binding request-publication и durable PLATFORM_ACTION+exact Approval; отличный от него Workspace Owner с current `project.admin` APPROVE live-revalidate/CAS атомарно публикует и завершает action; replay идемпотентен, drift/revoke даёт APPROVED+INVALIDATED без publish | integration/security | FR-031–035 |

Дополнительные mandatory checks:

- contract examples валидируются своими schemas;
- API authorization тестируется с настоящим PostgreSQL через Testcontainers, не SQLite;
- worker crash test ставит crash после effect и до confirmed-result commit;
- API, repository, artifact reference и async command проходят cross-project/cross-workspace матрицу;
- migration suite: empty DB, current-1 upgrade, repeat/no-op и failed migration recovery в PostgreSQL 17/18 matrix;
- Playwright запускает Chromium flow с fake OIDC;
- local smoke проходит без VPN, corporate credentials, Jira/GitLab/Mattermost и model provider.

## 11. Implementation milestones

Milestones задают последовательность и gates; атомарные executable tasks будут созданы отдельно командой `/speckit.tasks`.

### M1 — Toolchain и architecture shell

Создать pinned workspace, package boundaries, composition root, health shell, CI checks и Core-without-extensions build. Gate: AT-005 и clean install/typecheck.

### M2 — Scope and persistence kernel

Реализовать identity, Workspace/Project scope, memberships/entitlements/roles/classification, scoped repositories и module migration runner. Gate: deny matrix на API/repository и migration tests.

### M3 — Extension kernel

Реализовать contracts/SDK, static manifest reconciliation, Work Type enablement, Dummy Pack-owned entity/API/UI contribution. Gate: AT-004–006 и history-after-disable.

### M4 — Connector configuration kernel

Реализовать capability registry, Connection/schema-bound Mapping/Profile/Binding revisions, validation reports, secret refs и deterministic resolution. Gate: AT-007, AT-013–014.

### M5 — Durable command/event skeleton

Реализовать Gateway, idempotency, outbox/inbox, BullMQ adapter, Broker, Mock Connector/Hub, retries/reconciliation и audit. Gate: AT-008–012, AT-016.

### M6 — Exact Approval Gateway

Реализовать immutable subject, decision/effect authorization, effect-time recheck, one-time consumption, concurrent callbacks и durable local platform-action consumption. Gate: AT-015, AT-019.

### M7 — Local vertical flow

Собрать fake OIDC, fake model fallback, web shell/persona switcher, Compose, S3Mock reference smoke, deterministic seed и Dummy flow end-to-end. Gate: AT-001–003 и полный `smoke:001`.

### M8 — Hardening and handoff

Закрыть contract drift, architecture, isolation, restart, redaction, migration и documentation gates; доказать отсутствие QA/vendor hardcode и production reachability. Gate: все AT-001–019 и success criteria SC-001–007.

## 12. Risks and mitigations

| Priority | Риск | Плановая защита |
|---|---|---|
| P0 | «Exactly once» понято как гарантия очереди | Явно документировать at-least-once; effect ledger, stable key, lookup/reconciliation и crash-window test |
| P0 | Approval TOCTOU либо повторное потребление | Immutable subject hash, live reauthorization, orthogonal statuses, transactional CAS |
| P0 | Cross-project leakage через ID/profile/job | Scoped repository API, composite constraints, worker reauthorization, binding resolution из pinned project scope |
| P0 | Dummy Pack превращается во второй product Pack | Local/test-only composition и package/deployment assertions; никаких QA/product semantics |
| P0 | Local может вызвать production endpoint | Compile-time composition, endpoint allowlist, fake secret resolver, egress deny, security test |
| P1 | Event gap silently corrupts projection | Monotonic entity version и reconciliation вместо blind apply |
| P1 | Secret/raw payload попадает в audit | Classification-aware serializers, allowlisted fields, redaction tests и log scanning |
| P1 | Framework aliases обходят package boundaries | Nx + ESLint + filesystem/import-graph architecture tests |
| P1 | Version drift toolchain/contracts | Exact lockfile/image pins, Renovate-like isolated updates later, CI contract/migration suite |
| P1 | RLS добавит ложное чувство безопасности | Application authorization остаётся primary; RLS только после отдельного design/security spike |
| P1 | Local object-store distribution теряет поддержку/меняет license | Provider-neutral port; Adobe S3Mock active release pin + digest; local emulator не определяет pilot storage |

## 13. Explicit non-goals

- QA `TestSession`, Plan Item, Finding, Evidence Manifest, Verdict, DoR/DoD;
- real Jira/GitLab/Mattermost adapters или vendor field mappings;
- Hermes/Agent Runtime behavior;
- production OIDC, Vault, service accounts или deployment;
- dynamic plugin loading, marketplace, no-code builder, remote UI code;
- binary evidence lifecycle/retention; Adobe S3Mock в 001 проверяется только как local emulator и generic reference target;
- distributed transaction и physical exactly-once transport;
- performance/SLA/HA targets, full admin console и pack-to-pack dependencies.

## 14. Constitution Check — после проектирования

Повторная проверка после data model и contracts пройдена:

- Core contracts не содержат QA entity/state/rule; QA-oriented logical-role literals являются opaque conformance values, не Core enum;
- `suiteBindingRefs` не закреплён в Core; generic schema-bound refs позволяют QA Pack владеть suite semantics;
- operational Pack/intake command API не позволяет Pack/клиенту выбрать profile/connection и не предоставляет `execute(any)`; отдельный authorized admin configuration API намеренно принимает exact Connection/Mapping/Profile refs;
- actor и authorization context не принимаются из request body;
- каждое project operational event/command/approval/artifact несёт Workspace и Project;
- published configurations immutable и pinned;
- Approval сохраняет историческое решение отдельно от текущей effect authorization;
- PostgreSQL остаётся durable source, Redis — восстанавливаемый delivery accelerator;
- production effect запрещён composition, credential и network gates;
- Dummy и Mock отсутствуют в pilot composition.

**Post-design status:** PASS, violations/exceptions = 0.

## 15. Gate в `/speckit.tasks`

План готов к декомпозиции, когда выполняются одновременно:

- `plan.md`, `research.md`, `data-model.md`, `quickstart.md` и contract package проходят structural validation;
- нет `NEEDS CLARIFICATION` и скрытых pilot inputs в scope 001;
- все FR-001…FR-035 и SC-001…SC-007 имеют design/test trace;
- contract examples валидируются;
- `tasks.md` ещё отсутствует.

Следующая команда: `/speckit.tasks` только для `001-extension-kernel-local-skeleton`.
