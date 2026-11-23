# Phase 1 contracts: Extension Kernel

Этот каталог является нормативным контрактным пакетом feature `001-extension-kernel-local-skeleton`.
Он фиксирует HTTP API, event envelope, extension manifests, typed capability, durable command,
exact approval и versioned integration configuration. QA-процесс и vendor-specific типы сюда не входят.

## Состав

- `openapi/core-api.v1.yaml` — Platform Core HTTP API;
- `openapi/dummy-pack-api.v1.yaml` — API тестового Pack, подключаемое только composition root;
- `openapi/mock-hub-api.v1.yaml` — typed Mock Hub и local-only administration;
- `asyncapi/platform-events.v1.yaml` — шина operational events;
- `schemas/` — JSON Schema 2020-12, являющиеся wire source of truth;
- `examples/` — позитивные conformance fixtures.

Все `$ref` на прикладные схемы локальны. URI `https://json-schema.org/draft/2020-12/schema`
в `$schema` обозначает dialect и не разрешает runtime-загрузку схем по сети. Production runtime
использует только схемы, собранные в artifact и зарегистрированные при старте.

## Нормативные инварианты

1. Core не перечисляет Work Type, capability или logical role конкретной компетенции.
   `logicalRole` — opaque manifest-owned key. Neutral conformance values не являются Core enum;
   domain-role names принадлежат соответствующему Pack и не входят в feature 001 contracts.
2. Pack отправляет `CapabilityCommandIntent` с `requirementRef`; он не передаёт
   `connectorProfileId`, Connection, endpoint, secret или vendor SDK payload.
3. Gateway разрешает requirement в exact capability/profile/binding versions и сохраняет
   `ExternalCommandEnvelope` до внешнего вызова. Для approval-required `CONNECTOR_COMMAND` outbox создаётся
   в `HELD`; exact approval release переводит его в `READY`, но право остаётся `AUTHORIZED`.
   Worker revalidate-ит exact subject и CAS-consumes право вместе с execution-attempt claim
   непосредственно перед Connector call. Для `PLATFORM_ACTION` (Binding publication) отдельный
   durable platform action revalidate-ится, CAS-consumes Approval и применяет local mutation в одной DB transaction.
4. Публичного универсального `POST connector-command` нет. Dummy Pack предоставляет собственный
   typed endpoint, а Connector реализует operation из `CapabilityContract`.
5. `workspaceId` и `projectId` обязательны для operational command/event/approval. HTTP actor
   строится backend по `issuer + subject`; body не может подменить actor или scope.
6. Published Connection, schema-bound Mapping, Profile и Project Integration Binding immutable. Изменение создаёт новую integer version; mutable Connection health хранится отдельно и не меняет pinned configuration. Lifecycle resources возвращают ETag/resourceVersion и требуют `If-Match` для transitions.
7. Exact approval подписывает canonical subject с единственным typed `actionKind + actionId`; отдельного
   независимо изменяемого consumed-action ref нет. Decision и право выполнить effect хранятся отдельно:
   исторический `APPROVED` может иметь `effectAuthorizationStatus=INVALIDATED`.
8. Внешний write использует durable outbox, стабильный effect idempotency key и объявленную Connector
   strategy. Повтор после crash не меняет target/profile и не создаёт второй effect.
9. Raw secrets и raw vendor responses запрещены в command, event, approval, audit и examples.
10. Local runtime регистрирует только Mock Connector, принимает только `LOCAL` Connections и работает
    в сети без production egress. Одной JSON Schema для этого запрета недостаточно.
11. Artifact content читается только через scoped backend proxy с повторной entitlement/classification
    проверкой. API не возвращает provider locator или presigned object URL.
12. Command имеет ровно один durable source: Intake Draft до acceptance либо существующий Work Item.
    Acceptance не резервирует будущий Work Item ID; `resultWorkItemId` появляется только в той же
    confirmation transaction, которая создаёт Work Item, operational binding и Pack extension.
13. Каждый external write сохраняет initial и effect-time authorization basis: exact policy,
    membership, entitlement, role-assignment и skill versions (`NOT_APPLICABLE` — явное значение),
    а также pinned Binding/Profile. Audit использует те же structured refs.
14. Authorization basis имеет закрытые context variants: Project-scoped command/Approval/report/audit
    требует минимум один exact entitlement ref; Workspace-scoped configuration report требует пустой
    entitlement set и не подделывает Project grant. SYSTEM-событие webhook rejection до Project
    resolution не изображает human authorization и не содержит authorization basis/hash.
15. Каждая revision в `VALIDATED | PUBLISHED | RETIRED` pin’ит exact successful
    `validationReportId`; DRAFT его не содержит. Эта provenance-ссылка не входит в semantic content hash.

## Versioning

- manifest, Work Type и Capability Contract: strict SemVer;
- API major: `/api/v1`;
- wire envelope и payload: positive integer version;
- Connection/Mapping/Profile/Binding: immutable positive integer revision плюс SHA-256 content hash;
- один key/version с другим content digest является ошибкой регистрации;
- additive optional field совместим, удаление/rename/type narrowing/new required field — breaking.

## Idempotency

- HTTP mutation key: `(actor, normalizedScopeKey, operationId, Idempotency-Key)`, где scope key
  содержит Workspace и, только для project-scoped use case, Project;
- тот же key и request hash возвращает исходный response;
- тот же key с другим hash возвращает `409 IDEMPOTENCY_KEY_REUSED`;
- Gateway генерирует отдельный globally unique `effectIdempotencyKey`; client request key не
  передаётся Connector, а Connector получает один и тот же effect key при каждом retry;
- webhook inbox dedupe: `(connectionId, deliveryId)`; same hash — duplicate, different hash — security conflict;
- event consumer dedupe: `(consumerName, producer, eventId)`; same hash — duplicate, different hash — security conflict.

BullMQ является только delivery mechanism. Job payload содержит `commandId`, `workspaceId`,
`projectId`, actor, `correlationId` и `causationId`; worker загружает durable envelope из PostgreSQL и обязан
сверить все эти поля. Несовпадение создаёт security event и не вызывает Connector. После ACK
исполнение защищает PostgreSQL execution lease; stale `DISPATCHED` восстанавливается как retry.

Нормативная cross-state matrix для command snapshot:

Ingress и schema/policy validation происходят до создания command. Поэтому первый durable/public
snapshot — `AWAITING_APPROVAL` либо `QUEUED`; request-processing stages `RECEIVED/VALIDATED`
фиксируются audit-этапами, но не создают command без согласованного outbox state.

| Command state | Effect authorization | Outbox |
|---|---|---|
| `AWAITING_APPROVAL` | только `PENDING` | только `HELD` |
| `QUEUED` | `NOT_REQUIRED`, `AUTHORIZED` или уже `CONSUMED` после recovery | `READY`, `LEASED`, `ENQUEUED` |
| `DISPATCHED` | `NOT_REQUIRED` или `CONSUMED` | только `ACKNOWLEDGED` |
| `RETRY_SCHEDULED` | `NOT_REQUIRED`, `AUTHORIZED` или `CONSUMED` | только `READY` |
| `CONFIRMED` | `NOT_REQUIRED` или `CONSUMED` | только `ACKNOWLEDGED` |
| `CONFLICT`, `FAILED`, `CANCELLED` | `NOT_REQUIRED`, `INVALIDATED` или `CONSUMED` | `ACKNOWLEDGED` или `DEAD` |

`PENDING` и `HELD` взаимно требуют `AWAITING_APPROVAL`; `AUTHORIZED` запрещён после durable
effect start; `INVALIDATED` terminal и не имеет invocation timestamp. `CONFIRMED`, `CONFLICT` и
`FAILED` содержат normalized `terminalResult` с matching outcome; success также требует typed
receipt и invocation timestamp, а error path — sanitized code/retry class. JSON Schema кодирует эти ограничения, а conformance suite обязан
проверять как минимум каждую запрещённую соседнюю комбинацию таблицы.

Любой выполненный pre-effect gate сохраняет `effectGateEvaluatedAt`, `effectGateDecision` и exact
effect-time authorization basis/hash. `DENIED` требует reason code и запрещает invocation;
`effectInvocationStartedAt` требует `ALLOWED`. Поэтому revoke/configuration drift оставляют basis
даже при нуле Connector calls, а отсутствие gate у ещё не исполненного queued command остаётся корректным.

Canonical hashes вычисляются как `sha256:` + SHA-256 от RFC 8785 JSON Canonicalization Scheme:

- `SchemaRef.digest` — JCS exact JSON Schema document; registry запрещает тот же `$id` с иным digest;
- `targetHash` — JCS полного `SchemaBoundValue {schemaRef,value}`;
- `payloadHash` для `EXTERNAL_COMMAND` — JCS полного payload `SchemaBoundValue`; для
  `PLATFORM_ACTION` publication — exact semantic `contentHash` immutable candidate revision,
  уже pin’нутой target и `expectedLocalState` (отдельного произвольного payload у action нет);
- authorization-basis hash — JCS полного basis; `entitlementRefs` и `roleAssignmentRefs` перед
  hashing сортируются по `id`, затем `version`;
- Connection/Mapping/Profile/Binding `contentHash` — JCS всех immutable semantic полей соответствующей revision, исключая
  `state`, `resourceVersion`, `validationReportId`, сам `contentHash` и lifecycle timestamps; arrays сохраняют нормативный порядок;
- Approval `subjectHash` — JCS projection из `subjectSchemaId`, `subjectSchemaVersion`, Workspace/
  Project, initiator и initiator authorization basis, action, target/hash, payload hash, action-specific
  expected state (`expectedExternalState` либо `expectedLocalState`, где platform publication pin’ит
  candidate row и stable aggregate header/current-published version), Binding ref, Profile refs,
  classification, required permission, separation-of-duty policy, effect key и expiry. `profileRefs`
  перед hashing сортируются лексикографически по `id`, затем численно по `version`.

Так schema ID/version являются частью fingerprint, и одинаковый JSON с другой семантической схемой
не считается тем же subject. Positive fixtures ниже содержат пересчитываемые, а не sentinel hashes.

Raw webhook receipt является transport quarantine: Connection даёт обязательный Workspace и
обязательный conservative `quarantineClassificationKey`, но Project может быть null до connector
normalization. Только receipt, однозначно разрешённый в published Project Binding/external scope,
создаёт project-scoped Event Envelope и consumer inbox. Отказ до Project resolution создаёт только
WORKSPACE-scoped `SECURITY_ENVELOPE_REJECTED` audit event, читаемый отдельным Workspace audit route;
operational event envelope остаётся строго project-scoped.

## Validation order

1. boot registration: manifest schema, duplicate keys, SemVer ranges, component refs и digest;
2. Mapping validation: schema-bound payload, exact same-Workspace Connector registration, classification и content hash;
3. Profile validation: exact same-Workspace immutable Connection version whose Connector ref equals
   Profile `connectorRef`, capability version, operations, scope,
   environment, classification, connector-owned config schema и пересечение declared
   idempotency/confirmation strategies Capability + Connector implementation; Connection quarantine
   classification rank обязан покрывать максимум разрешённых входящих classifications; optional
   `mappingRef` разрешается только в exact same-Workspace/same-Connector PUBLISHED mapping version;
   его проверенный `mappingContentHash` явно round-trip-ится и входит в fingerprint Profile;
4. Binding validation: exact published Profile, requirement compatibility, unique resolution и scope;
   каждый успешный transition атомарно pin’ит созданный immutable scoped Validation Report, а
   failed report оставляет candidate DRAFT без `validationReportId`;
5. Command Gateway: identity, Workspace/Project policy, operation schemas, idempotency и exact approval;
6. Connector boundary: повторная schema/policy/version validation;
7. webhook ingress: signature, replay window, delivery dedupe и connector-specific schema.

## Local validation

Из корня репозитория JSON можно проверить стандартным парсером, а YAML — любым YAML 1.2 parser.
CI дополнительно должен:

- разрешить все локальные `$ref`;
- провалидировать примеры соответствующими JSON Schemas;
- собрать Core без Dummy Pack;
- выполнить одинаковый capability conformance suite для Mock Connector и второго test implementation;
- симулировать crash после внешнего effect, но до сохранения confirmation.
