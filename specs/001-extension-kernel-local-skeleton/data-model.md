# Data Model: Extension Kernel и локальный walking skeleton

**Feature:** 001-extension-kernel-local-skeleton

**Статус:** implementation design

**Хранилище:** local baseline PostgreSQL 18.6; CI compatibility matrix PostgreSQL 17 и 18

**ORM:** TypeORM 1.1, явные entity и migration arrays, synchronize=false

## 1. Назначение и граница

Документ определяет durable-модель только для feature 001:

- generic Platform Core;
- статический registry Competency Packs, Work Types, Connectors и typed capabilities;
- Workspace и Project isolation;
- versioned Connector Profile и Project Integration Binding;
- exact Approval;
- durable command, inbox/outbox, idempotency и audit;
- Dummy Pack и stateful Mock Hub;
- generic artifact reference и минимальный object-storage smoke.

QA-сущности, Jira/GitLab/Mattermost semantics, Test Session, Finding, Verdict и Evidence Manifest здесь отсутствуют. Dummy Pack доказывает extension contracts и не является началом скрытой QA-модели.

Нормативные источники:

- [feature specification](./spec.md);
- [конституция платформы](../../.specify/memory/constitution.md);
- [master specification](../../docs/agentic-workspace-platform-master-spec-v2.md);
- [ADR-0001](../../docs/adr/0001-competency-pack-work-type-connector.md);
- [ADR-0004](../../docs/adr/0004-workspace-project-entitlement.md);
- [ADR-0006](../../docs/adr/0006-project-integration-binding-versioning.md).

## 2. Общие соглашения

### 2.1. Идентификаторы и время

- Primary key — opaque UUID. Клиент не выводит из него Workspace, Project, тип или время создания.
- Время хранится как timestamptz в UTC.
- Mutable aggregates содержат row_version bigint для optimistic concurrency.
- External version хранится отдельно и никогда не заменяется локальным row_version.
- Business key нормализуется до сохранения и имеет явный unique constraint.

### 2.2. Scope

Каждая domain/project-scoped строка содержит workspace_id и project_id, даже если их можно получить через parent. Это относится в том числе к:

- Work Item и Dummy extension;
- draft;
- artifact reference;
- Approval;
- connector command;
- normalized consumer inbox/outbox event;
- idempotency record;
- audit event.

На parent создаётся UNIQUE(id, workspace_id, project_id), а child использует composite foreign key. Поэтому строка Project A физически не может сослаться на parent Project B. Единственное pre-domain исключение — transport-level table `webhook_inbox`: Connection даёт обязательный Workspace, но Project может быть неизвестен до signature verification и connector normalization. Такая quarantined receipt не доступна через project API и не становится operational event/consumer input, пока не разрешён ровно один Project.

Use case проверяет authorization до repository или adapter invocation. Repository принимает явный Scope и не имеет unscoped project methods. Composite keys и constraints являются вторым рубежом, а не заменой backend authorization.

### 2.3. Data Classification

Classification является first-class полем, а не значением внутри произвольного JSON.

Таблица classification_levels:

| Поле | Тип | Ограничение |
|---|---|---|
| key | text | PK, immutable stable key |
| rank | smallint | UNIQUE, чем больше значение, тем чувствительнее данные |
| display_name | text | локализуемое отображение |
| status | text | ACTIVE или RETIRED |

`key` и `rank` неизменяемы после первой ссылки; разрешено менять только display metadata и переводить level в `RETIRED`. Новый порядок вводится новой versioned taxonomy/новыми stable keys и новыми resource/config revisions, а historical rows продолжают сравниваться по исходному rank. Поэтому изменение catalog не переосмысливает задним числом Approval, Binding, command или artifact.

Локальный seed:

| key | rank |
|---|---:|
| PUBLIC | 10 |
| INTERNAL | 20 |
| RESTRICTED | 30 |

Это локальная нейтральная шкала. Корпоративное соответствие определяется позже без переименования исторических значений.

Явный data_classification_key обязателен у всех content-bearing rows. classification_ceiling_key обязателен у entitlement и capability binding, а опубликованный Profile содержит явный allowlist classification keys. Разрешение возможно, только если rank ресурса не выше обоих ceilings и key разрешён Profile.

Если объект агрегирует несколько payload или artifacts, применяется максимальная classification. Audit хранит classification и redacted metadata, но не копирует raw sensitive payload.

### 2.4. JSON, версии и hash

- Manifest, schema, target и command payload проверяются versioned JSON Schema до записи.
- Перед hash JSON canonicalized по RFC 8785 JCS; hash — SHA-256.
- Одинаковый client request idempotency key в том же actor/scope/operation namespace с другим request hash является конфликтом; Connector effect key генерируется отдельно.
- JSON не содержит credential values. Разрешены только opaque secret_ref.
- Published definition/profile/binding payload неизменяем. Изменяется только lifecycle metadata; новая конфигурация получает новую version.
- Историческая строка pin-ит фактически использованные definition, binding и profile versions.

### 2.5. Удаление

- Registry, published configuration, Work Item, command, Approval и audit не удаляются hard-delete обычными use cases.
- Disable/retire/suspend сохраняет чтение истории.
- Очистка local seed разрешена только безопасной командой local:reset для именованных local volumes.

## 3. Владение таблицами

| Модуль | Таблицы |
|---|---|
| Platform Core / identity | identities, workspaces, workspace_memberships, role_assignments |
| Platform Core / projects | projects, project_entitlements, project_entitlement_permissions |
| Platform Core / extension registry | competency_pack_registrations, connector_registrations, connector_capability_implementations, extension_registration_attempts, work_type_definitions, workspace_work_types, capability_contracts |
| Platform Core / integration config | connections, connection_versions, connection_health, connector_mappings, connector_mapping_versions, connector_profiles, connector_profile_versions, connector_profile_capabilities, connector_profile_capability_operations, connector_profile_capability_environments, connector_profile_capability_classifications, project_integration_bindings, project_integration_binding_versions, project_integration_capability_bindings, integration_validation_reports |
| Platform Core / work | intake_drafts, work_items, operational_bindings |
| Platform Core / control plane | approvals, approval_profile_refs, platform_action_executions, connector_commands, command_outbox, webhook_inbox, event_consumer_inbox, event_outbox, idempotency_records |
| Platform Core / artifacts and audit | artifact_references, audit_events |
| Dummy Pack | dummy_requests |
| Mock Hub database | mock_resources, mock_effects, mock_calls, mock_events, mock_scenario_state |

Core не имеет foreign key на dummy_requests. Dummy Pack может ссылаться только на стабильные Core IDs и обращается к Core через application ports.

Mock Hub использует отдельные database и DB role в том же local PostgreSQL instance. Между awp и awp_mock нет foreign keys и прямых application queries.

## 4. Identity, Workspace и Project

### 4.1. identities

| Поле | Назначение |
|---|---|
| id | PK |
| kind | USER, GROUP или SERVICE |
| issuer | verified identity issuer |
| subject | stable subject внутри issuer |
| display_name | UI label |
| status | ACTIVE или DISABLED |
| created_at, updated_at | audit timestamps |

UNIQUE(issuer, subject). Канонический human principal всегда определяется issuer + subject; email и display name не являются ключом.

### 4.2. workspaces

Основные поля:

- id, key, name;
- kind;
- status: ACTIVE, SUSPENDED или ARCHIVED;
- default_classification_key;
- created_at, updated_at, row_version.

UNIQUE(key).

### 4.3. workspace_memberships

Основные поля:

- id, workspace_id, principal_id;
- status: ACTIVE, SUSPENDED или REVOKED;
- valid_from, valid_until;
- granted_by;
- created_at, updated_at, row_version.

UNIQUE(workspace_id, principal_id). Истёкшая, suspended или revoked membership эквивалентна отсутствующей.

### 4.4. role_assignments

Основные поля:

- id, workspace_id;
- project_id nullable для Workspace-scoped роли;
- principal_id;
- role_key;
- status, valid_from, valid_until;
- granted_by, created_at, updated_at, row_version.

role_key проверяется против статически зарегистрированного permission catalog. Наличие роли не создаёт Project Entitlement.

### 4.5. projects

Основные поля:

- id, workspace_id, key, name;
- status: DRAFT, ACTIVE, SUSPENDED или ARCHIVED;
- business_owner_id, technical_owner_id, functional_owner_id;
- criticality;
- data_classification_key;
- verification_status, last_verified_at, next_verification_at;
- created_at, updated_at, row_version.

UNIQUE(workspace_id, key).

### 4.6. project_entitlements

Основные поля:

- id, workspace_id, project_id, principal_id;
- effect: ALLOW или DENY;
- classification_ceiling_key;
- source: MANUAL, GROUP_MAPPING или BOOTSTRAP;
- valid_from, valid_until;
- created_by, created_at, revoked_at, row_version.

Permissions нормализованы в project_entitlement_permissions с PK(entitlement_id, permission_key).

Правила:

- явный DENY имеет приоритет над ALLOW;
- отсутствие подходящей строки означает deny;
- wildcard требует отдельной явной записи и audit;
- Project classification является default для новых ресурсов, но не upper bound: отдельный artifact/payload может быть строже, и entitlement всё равно проверяется по фактической resource classification;
- grant/revoke создают audit event.

Итоговая формула:

~~~text
active Workspace membership
AND matching Project Entitlement without overriding DENY
AND matching Role Permission
AND resource classification <= classification ceiling
~~~

Authorization provenance имеет две закрытые формы. `PROJECT` хранит минимум один exact
Project Entitlement ref; `WORKSPACE` хранит пустой `entitlementRefs[]`, потому что выдумывать
Project grant для Workspace-scoped Connection/Mapping/Profile validation запрещено. Обе формы
обязаны pin’ить exact policy, membership, role-assignment и skill context; enclosing resource
определяет допустимую форму и не позволяет caller выбрать более слабый scope.

## 5. Extension Registry

### 5.1. competency_pack_registrations

Основные поля:

- id;
- pack_key, pack_version;
- manifest_schema_version;
- required_core_contract_range;
- manifest_payload, manifest_hash;
- registration_status: REGISTERED или DISABLED;
- registered_at.

UNIQUE(pack_key, pack_version). Boot reconciliation идемпотентен по key + version + hash. Тот же key/version с другим hash не переписывает принятую строку.

`extension_registration_attempts` является append-only журналом каждой попытки и хранит trusted `source_component_ref`, nullable raw `observed_kind/key/version` (без StableKey/SemVer constraint), всегда вычислимый `observed_hash`, outcome `ACCEPTED | REJECTED`, diagnostics, boot_instance_id и observed_at. Поэтому полностью malformed manifest тоже оставляет запись, но raw body не попадает в API/audit. Невалидный manifest либо digest drift создаёт `REJECTED` attempt, блокирует только соответствующий Pack и не конфликтует с UNIQUE canonical registration. Platform Core продолжает старт; availability/readiness читает результат composition reconciliation, а не подменяет историю registration.

### 5.2. work_type_definitions

Основные поля:

- id, pack_registration_id;
- work_type_key, definition_version;
- intake_schema_version, intake_schema, intake_schema_hash;
- required_capabilities;
- definition_payload, definition_hash;
- lifecycle_status: ACTIVE или RETIRED;
- registered_at.

UNIQUE(work_type_key, definition_version). Work Item хранит exact work_type_definition_id.

### 5.3. workspace_work_types

Основные поля:

- id, workspace_id, work_type_key;
- active_definition_id;
- intake_state: ENABLED или DISABLED;
- changed_by, changed_at, reason;
- row_version.

UNIQUE(workspace_id, work_type_key). DISABLED запрещает новый intake, но не скрывает существующие Work Items.

### 5.4. connector_registrations

Поля аналогичны Pack registry:

- connector_key, connector_version;
- manifest schema/core range;
- manifest payload/hash;
- registration status и diagnostics.

Connector manifest объявляет реализованные capability contracts, но не domain Work Types.

`connector_capability_implementations` нормализует каждую реализацию `(connector_registration_id, capability_key, exact_contract_version, operation)` и хранит `handler_component_ref`, declared `supported_idempotency_strategies` и `supported_confirmation_modes`. Registration отклоняется, если operation/version отсутствует в exact Capability Contract или declaration не является его допустимым subset. Profile publication выбирает стратегию и confirmation mode только из пересечения Capability Contract и конкретной Connector implementation; conformance suite проверяет каждый объявленный вариант.

### 5.5. capability_contracts

Основные поля:

- id;
- capability_key, contract_version;
- command_schema, result_schema, event_schema;
- schema_hash;
- lifecycle_status;
- registered_at.

UNIQUE(capability_key, contract_version). Capability всегда вызывается с exact contract version; универсального execute(any) нет.

logical_role хранится как opaque text. Core не содержит QA-specific enum. Конкретный Pack публикует допустимые роли в своём versioned definition.

## 6. Connection, Mapping, Profile и Project Integration Binding

### 6.1. connections, connection_versions и connection_health

`connections` — стабильный header:

- id, workspace_id, key;
- created_at.

UNIQUE(workspace_id, key).

`connection_versions` содержит immutable configuration revision:

- connection_id, version;
- connector_registration_id;
- environment_scope: LOCAL, NON_PROD, PREPROD или PLATFORM_PROD;
- data_classification_key — classification самой configuration revision;
- endpoint, secret_ref;
- tls_policy_ref, network_policy_ref;
- connector_configuration, connector_configuration_hash;
- quarantine_classification_key — обязательный conservative class из Workspace catalog для raw webhook bytes до parsing;
- state: DRAFT, VALIDATED, PUBLISHED или RETIRED;
- content_hash;
- validation_report_id nullable только в DRAFT, затем scoped FK на конкретный успешный immutable report; поле не входит в content_hash;
- created_at, validated_at, published_at, retired_at;
- row_version для optimistic `If-Match`; не входит в content_hash.

PK(connection_id, version). Partial UNIQUE(connection_id) WHERE state=PUBLISHED. Published revision неизменяема: endpoint, secret ref, policy, Connector version или configuration меняются только новой version. `connector_profile_versions` pin’ит `(connection_id, connection_version)`, поэтому approved command не может незаметно сменить destination или credential reference.

`connection_health` — отдельная mutable operational projection: connection_id, connection_version, health_status `UNKNOWN | HEALTHY | DEGRADED | UNAVAILABLE`, checked_at, diagnostic_code, row_version. Health probes не меняют immutable content hash/version.

Connection lifecycle доступен через exact-version GET и явные validate/publish commands с `If-Match`/ETag. Publish разрешён только после schema/secret-ref/TLS/network/endpoint проверки. `quarantine_classification_key` обязан иметь rank не ниже максимальной classification, которую любой публикуемый Profile на этой Connection version разрешает принимать; local seed ставит `RESTRICTED`. Эта проверка повторяется при Profile/Binding publication, поэтому `PUBLIC` не может защищать неизвестные raw bytes потенциально `RESTRICTED` webhook.

Для local Connector runtime допускается только environment_scope=LOCAL и allowlisted Mock Hub endpoint. Production endpoint или non-local credential reference отклоняется до сохранения и до effect. S3Mock не является Connector Connection: он подключается отдельным provider-neutral Core storage port с собственным local-only endpoint gate.

### 6.2. connector_profiles и connector_profile_versions

connector_profiles является стабильным header:

- id, workspace_id, key;
- created_at.

connector_profile_versions:

- id, profile_id, version;
- connection_id, connection_version;
- data_classification_key — classification самой Profile revision;
- state: DRAFT, VALIDATED, PUBLISHED или RETIRED;
- schema_version;
- configuration_payload, configuration_hash;
- content_hash всей canonical revision, включая parent, operation/classification child rows и refs;
- validation_report_id nullable только в DRAFT, затем scoped FK на конкретный успешный immutable report; поле не входит в content_hash;
- validated_at, published_at, retired_at;
- created_by, created_at, row_version.

UNIQUE(profile_id, version). Partial UNIQUE(profile_id) WHERE state=PUBLISHED.

Child rows входят в `content_hash`: capability entries сортируются по `(capability_key, contract_version)`, включая exact optional `mappingRef` и явный проверенный `mappingContentHash`, а их operation/environment/classification sets — лексикографически по соответствующим keys. После VALIDATED/PUBLISHED их нельзя менять отдельно от revision; `configuration_hash` покрывает только connector-owned payload и не заменяет version-level fingerprint.

connector_profile_capabilities:

- id;
- profile_version_id;
- capability_key, contract_version;
- mapping_version_id nullable — exact `mappingRef` из wire contract;
- mapping_content_hash nullable — обязателен ровно вместе с mapping_version_id и совпадает с resolved immutable Mapping revision;
- external_scope, external_scope_hash.

`connector_mappings` — stable header `(id, workspace_id, connector_registration_id, key, created_at)`. `connector_mapping_versions` хранит `(id, mapping_id, version)`, `data_classification_key`, exact schema ref `{id,version,digest}`, schema-validated mapping payload, content_hash, `validation_report_id` (nullable только в DRAFT и исключён из content_hash), lifecycle `DRAFT | VALIDATED | PUBLISHED | RETIRED`, timestamps и row_version. UNIQUE(mapping_id, version), не более одной PUBLISHED revision на header. Published mapping immutable.

Ненулевой `mappingRef` обязан разрешиться в exact PUBLISHED mapping version того же Workspace и того же Connector registration, что Profile/Connection chain. Composite FK дублирует эту проверку; raw vendor mapping не попадает в Core columns. `mapping_version_id` и resolved `mappingContentHash` входят в wire resource и Profile version `content_hash`, поэтому fingerprint пересчитывается только по сериализованному contract, а mapping drift создаёт новую Profile revision.

`connector_profile_capability_operations` хранит по одной строке `(profile_capability_id, operation)`: copied-and-verified effect `READ | WRITE`, обязательный для WRITE `idempotency_strategy` и выбранный `confirmation_mode`. Оба значения входят в пересечение exact Capability Contract и конкретной Connector implementation.

`connector_profile_capability_environments` хранит normalized set `(profile_capability_id, environment_scope)` и round-trip соответствует wire `environmentScopes[]`; пустой set запрещён.

Profile validation требует exact published Connection version того же Workspace и того же exact `connectorRef`, что указан Profile; для каждой operation проверяется, что выбранные `idempotency_strategy` и `confirmation_mode` входят одновременно в Capability Contract и declaration конкретной Connector implementation. Gateway/worker повторно сверяют эту transitive chain перед effect.

connector_profile_capability_classifications:

- profile_capability_id;
- classification_key.

PK(profile_capability_id, classification_key). Пустой allowlist запрещает публикацию Profile.

Каждый external_scope проходит schema capability contract. Profile version не считается VALIDATED, если capability/version, operation, environment, scope или classification allowlist несовместимы.

### 6.3. project_integration_bindings

Header содержит:

- id, workspace_id, project_id;
- created_at, row_version; row_version увеличивается при каждой publication/retirement transaction.

UNIQUE(workspace_id, project_id).

project_integration_binding_versions:

- id, binding_id, version;
- data_classification_key — classification самой Binding revision;
- state: DRAFT, VALIDATED, PUBLISHED или RETIRED;
- schema_version;
- configuration_refs и resource_refs: раздельные generic arrays schema-bound immutable references, без Pack-specific field names;
- content_hash всей canonical revision, включая entries, configuration_refs и resource_refs;
- validation_report_id nullable только в DRAFT, затем scoped FK на конкретный успешный immutable report; поле не входит в content_hash;
- validated_at, published_at, retired_at;
- created_by, created_at, row_version.

UNIQUE(binding_id, version). Partial UNIQUE(binding_id) WHERE state=PUBLISHED.

Entry/ref child rows входят в `content_hash` в детерминированном порядке по stable keys и exact refs. После VALIDATED/PUBLISHED они immutable; Approval/version drift сравнивает именно полный version-level fingerprint.

project_integration_capability_bindings:

- binding_version_id, workspace_id, project_id;
- logical_role opaque text;
- capability_key, contract_version;
- environment_scope;
- connector_profile_version_id;
- classification_ceiling_key;
- external_scope, external_scope_hash.

UNIQUE(binding_version_id, environment_scope, capability_key, logical_role).

Инварианты:

- Profile и Project binding принадлежат одному Workspace;
- Profile и его exact Connection version принадлежат одному Workspace; composite scope FK/constraint дублирует application check;
- binding entry ссылается на exact compatible profile version;
- published entry не содержит mutable alias или secret value;
- Work Item и command pin-ят exact binding version;
- operational binding и command pin-ят exact profile version;
- изменение version не перенаправляет подготовленную команду;
- validation failure оставляет последнюю published version неизменной.

### 6.4. Lifecycle configuration

~~~text
DRAFT → VALIDATED → PUBLISHED → RETIRED
~~~

- Validation failure оставляет version в DRAFT и сохраняет diagnostics отдельно; `validation_report_id` revision остаётся null.
- Успешный validate атомарно создаёт report и переводит candidate в VALIDATED с exact `validation_report_id`; report обязан иметь `status=VALID` и совпадающие Workspace/Project, subject type/id/version и subject content hash.
- Configuration payload и hash неизменяемы начиная с VALIDATED.
- Publish использует optimistic expected version.
- Publish берёт lock стабильного header и в одной transaction проверяет candidate `If-Match` плюс pinned header row_version/current-published version, переводит прежнюю `PUBLISHED` revision в `RETIRED` и candidate `VALIDATED → PUBLISHED`, затем увеличивает header row_version; partial UNIQUE никогда не нарушается и current version не отсутствует между переходами. First publish явно pin’ит current-published version `0`, поэтому competing first publish также обнаруживается.
- `RETIRED` означает «не выбирается новой configuration/resolution», а не «исторический pin уничтожен». Retired Connection/Profile revision остаётся допустимой через уже published downstream Profile/Binding во время последовательного upgrade и для recovery существующего command. Новые drafts могут ссылаться только на current PUBLISHED dependency.
- Полный effective chain меняется для новых project commands только атомарной публикацией новой Binding revision. Перед первым effect worker сравнивает pinned chain fingerprint с current effective Binding chain. Drift у approval command даёт `AUTHORIZED → INVALIDATED`; у `NOT_REQUIRED` command сразу terminal `FAILED/CONFIGURATION_DRIFT`; в обоих случаях outbox `DEAD` и Connector не вызывается.
- Если `effect_invocation_started_at` уже установлен, смена current configuration не перенаправляет attempt: recovery использует только прежний pinned retired chain и тот же effect key/lookup strategy. Явная security suspension/revocation является отдельным runtime control и блокирует новый call, оставляя reconciliation оператору.
- Rollback не переписывает историческую version; он публикует новую проверенную version либо применяется будущей explicit compatibility procedure.

### 6.5. integration_validation_reports

Каждый validate command сохраняет immutable report, включая неуспешную проверку; `reportId` в HTTP response поэтому является durable audit reference, а не эфемерным token.

Основные поля:

- id, workspace_id, project_id nullable только для Workspace-scoped Connection/Mapping/Profile;
- subject_type `CONNECTION | CONNECTOR_MAPPING | CONNECTOR_PROFILE | PROJECT_INTEGRATION_BINDING`, subject_id, subject_version;
- subject_content_hash — exact hash проверенной immutable candidate revision;
- status `VALID | INVALID`, checks, capability_availability;
- requested_by_principal_id, requested_by_actor_type, exact authorization_basis и authorization_basis_hash;
- data_classification_key самой report resource;
- correlation_id, validated_at, created_at.

Report append-only, доступен по scoped `reportId`, не изменяет candidate сам по себе и хранится не меньше соответствующей configuration revision. Повтор validate может создать новый report для того же exact subject/hash, но transition в `VALIDATED` ссылается на конкретный успешный report через `validation_report_id`, исключённый из semantic `content_hash` во избежание циклического fingerprint. Scoped composite FK плюс deferred/domain constraint проверяют `VALID`, Workspace/Project, subject discriminator/id/version и exact subject hash. GET повторно применяет authorization по subject scope; Workspace reports используют `WORKSPACE` authorization basis с пустым entitlement set, Binding report — `PROJECT` basis с минимум одним exact entitlement ref.

## 7. Minimal Work Item и Dummy Pack

### 7.1. intake_drafts

Основные поля:

- id, workspace_id, project_id;
- work_type_definition_id;
- draft_version;
- state;
- title, form_data;
- data_classification_key;
- validation_result;
- confirmation_payload_hash;
- confirmed_draft_version nullable;
- confirmed_binding_version_id nullable;
- confirmed_by nullable, confirmed_at nullable;
- confirmation_idempotency_key;
- created_by, created_at, updated_at, row_version.

Generic lifecycle:

~~~text
DRAFT → VALIDATING → NEEDS_INFO | READY_FOR_CONFIRMATION
READY_FOR_CONFIRMATION → CONFIRMED
CONFIRMED → OPERATIONAL_CREATE_PENDING
OPERATIONAL_CREATE_PENDING → LINKED
OPERATIONAL_CREATE_PENDING → FAILED_RETRYABLE → OPERATIONAL_CREATE_PENDING
OPERATIONAL_CREATE_PENDING → FAILED_FINAL
any non-terminal → CANCELLED
~~~

Названия не содержат Jira и подходят Mock Connector либо будущей operational authority.

### 7.2. work_items

Основные поля:

- id, workspace_id, project_id;
- work_type_key, work_type_definition_id;
- intake_draft_id;
- operational_binding_id;
- title;
- normalized_status;
- data_classification_key;
- requester_id, assignee_id nullable;
- created_at, updated_at, row_version.

Normalized statuses:

~~~text
NEW, NEEDS_INFO, READY, PLANNED, IN_PROGRESS,
REVIEW, BLOCKED, DONE, CANCELLED
~~~

Feature 001 использует только минимальный Dummy subset. `Work Item` не существует в pending-acceptance состоянии: после подтверждённого Mock Hub effect Core в одной PostgreSQL transaction сохраняет confirmed command result, создаёт Work Item, operational binding и Dummy extension, затем переводит Intake Draft непосредственно `OPERATIONAL_CREATE_PENDING → LINKED`. Отдельного durable `OPERATIONAL_CREATED` нет. До этой транзакции durable owner — Intake Draft/command. `operational_binding_id` обязателен; взаимные FK Work Item ↔ binding создаются DEFERRABLE и проверяются при commit. Полный operational mapping появляется в следующих features.

### 7.3. operational_bindings

Основные поля:

- id, workspace_id, project_id;
- work_item_id;
- project_integration_binding_version_id;
- connector_profile_version_id;
- external_entity_type, external_entity_id, external_display_key;
- external_version;
- sync_state: SYNCED, ERROR, CONFLICT или MAPPING_REQUIRED;
- last_synced_at;
- created_at, updated_at, row_version.

UNIQUE(work_item_id). UNIQUE(connector_profile_version_id, external_entity_type, external_entity_id).

Application/database invariant: каждый Work Item с момента commit имеет ровно один operational binding, а binding ссылается обратно на тот же Work Item и exact Project Integration Binding/Profile refs `{id, version}`. Pending/failed external creation остаётся только в Intake Draft и command; частично принятый Work Item не создаётся.

### 7.4. dummy_requests

Dummy Pack-owned table:

- id, workspace_id, project_id;
- work_item_id;
- definition_version;
- domain_state;
- note;
- payload_hash;
- data_classification_key;
- created_at, updated_at, row_version.

UNIQUE(work_item_id). Dummy Pack migration отсутствует, если Pack исключён из composition root. Platform Core schema и use cases не меняются при его добавлении или удалении из test composition.

## 8. Exact Approval

approvals хранит две ортогональные оси.

decision_status:

~~~text
PENDING → APPROVED | REJECTED | EXPIRED | CANCELLED
~~~

effect_authorization_status:

~~~text
NOT_AUTHORIZED → AUTHORIZED → CONSUMED
                         └──→ INVALIDATED
~~~

Основные поля:

- id, workspace_id, project_id;
- initiator_type, initiator_id;
- approver_id;
- approver_role;
- approver_authorization_basis;
- action;
- subject_schema_id, subject_schema_version;
- canonical_subject, subject_hash;
- canonical_target, target_hash;
- payload_hash;
- expected_external_state либо expected_local_state `{candidate_resource_ref,candidate_row_version,content_hash,aggregate_row_version,current_published_version}`, плюс exact state hash;
- project_integration_binding_version_id;
- exact profile version references через approval_profile_refs;
- decision_status;
- effect_authorization_status;
- invalidation_reason_code nullable;
- expires_at, decided_at, invalidated_at;
- effect_idempotency_key;
- action_kind `EXTERNAL_COMMAND | PLATFORM_ACTION` и action_id входят в immutable subject; consumed_at означает consumption ровно этого единственного subject action;
- data_classification_key;
- created_at, row_version.

Правила:

- Approval decision и exact snapshot неизменяемы после решения;
- APPROVED является историческим фактом и не переписывается при drift;
- допустимые пары осей ограничены: `PENDING/REJECTED/EXPIRED/CANCELLED + NOT_AUTHORIZED` либо `APPROVED + AUTHORIZED/INVALIDATED/CONSUMED`;
- payload/target/expected state/exact binding/profile ref/authorization drift либо expiry переводит effect authorization в INVALIDATED;
- reason code обязателен для INVALIDATED;
- непосредственно перед effect повторно проверяются current membership, entitlement, role и classification;
- для `CONNECTOR_COMMAND` queue release переводит command/outbox в `QUEUED/READY`, не меняя `AUTHORIZED`;
- для `CONNECTOR_COMMAND` consumption выполняется atomic compare-and-set `AUTHORIZED → CONSUMED` в одной транзакции с command execution-attempt claim после live revalidation и непосредственно перед Connector call;
- для `PLATFORM_ACTION` decision transaction live-revalidate-ит expected local state и атомарно CAS-consumes Approval вместе с local mutation;
- один Approval не может быть consumed двумя action executions;
- `CONSUMED` не принимает второй независимо изменяемый action ref: exact `action_kind + action_id` уже является частью subject, а `consumed_at` относится только к нему. FK/constraint связывает `EXTERNAL_COMMAND` action ID с command, `PLATFORM_ACTION` — с platform action; Connector recovery может продолжить только reconciliation/idempotent replay того же command и `effect_idempotency_key`, а не новый effect;

`platform_action_executions` хранит durable local control-plane mutations, которым нужен Approval: id, Workspace/Project, action_type, exact target/content hash, initiator, correlation/causation IDs, request/effect idempotency keys, approval_id, state `AWAITING_APPROVAL | COMPLETED | REJECTED | INVALIDATED`, completed_at, row_version. В 001 единственный type — `PROJECT_INTEGRATION_BINDING_PUBLISH`.

Request-publication transaction создаёт platform action + exact Approval и pin’ит как candidate content/row version, так и stable header row version/current-published version. Для `PLATFORM_ACTION` решение APPROVE не ставит Redis job: decision endpoint под lock header в одной PostgreSQL transaction сохраняет human decision, live-revalidate-ит membership/role/scope, обе части local snapshot и pinned Profile/Connection/Mapping refs с fingerprints, CAS-consumes `AUTHORIZED → CONSUMED`, публикует Binding и помечает platform action `COMPLETED`. Competing publication либо иной drift даёт `APPROVED + INVALIDATED` и action `INVALIDATED` без публикации; REJECT даёт action `REJECTED`. Поэтому stale approval не может откатить более новую current version.

- Agent или service initiator не может approve собственное действие.

approval_profile_refs хранит `(approval_id, profile_id, profile_version)` с PK по всем трём полям. `subject_hash` вычисляется от полного immutable canonical subject, включая schema ID/version и этот точный набор Profile refs, а не только от отдельных payload/target hashes.

## 9. Connector Command, Outbox, Inbox и Idempotency

### 9.1. connector_commands

Immutable request fields:

- id, schema_version;
- workspace_id, project_id;
- intake_draft_id nullable, source_work_item_id nullable; ровно один source FK обязателен;
- actor_type, actor_id;
- capability_key, contract_version, operation, logical_role;
- canonical_target, target_hash;
- payload_version, payload, payload_hash;
- data_classification_key;
- initial_authorization_basis и initial_authorization_hash: exact policy/membership/entitlement/role versions плюс typed skill context;
- correlation_id, causation_id;
- request_idempotency_key;
- effect_idempotency_key — сгенерированный Gateway globally unique opaque key, неизменный для всех attempts;
- project_integration_binding_version_id;
- connector_profile_version_id;
- expected_external_state и hash;
- approval_id nullable;
- created_at.

Mutable execution fields:

- state;
- result_work_item_id nullable — заполняется только confirmation transaction intake acceptance;
- attempt_count;
- next_attempt_at;
- execution_lease_token, execution_lease_expires_at;
- execution_heartbeat_at, execution_attempt_started_at;
- effect_gate_evaluated_at, effect_gate_decision `ALLOWED | DENIED`, effect_gate_reason_code nullable;
- effect_invocation_started_at;
- effect_authorization_basis и effect_authorization_hash, записанные live revalidation transaction;
- terminal_result и result_hash — normalized `SUCCEEDED | CONFLICT | FAILED`, без raw vendor response;
- external_version;
- last_error_class, last_error_code;
- dispatched_at, completed_at;
- row_version.

Lifecycle:

~~~text
request ingress → validation (до command persistence)
validated request ─┬→ AWAITING_APPROVAL → QUEUED → DISPATCHED → CONFIRMED
                   └→ QUEUED ─────────────┘          └→ RETRY_SCHEDULED → DISPATCHED

AWAITING_APPROVAL, QUEUED or DISPATCHED → CONFLICT | FAILED | CANCELLED
stale DISPATCHED lease → RETRY_SCHEDULED → QUEUED
~~~

`RECEIVED` и `VALIDATED` — request-processing/audit stages до transaction, а не durable command states. После успешной validation Gateway одной transaction создаёт command и outbox сразу как `AWAITING_APPROVAL/HELD` либо `QUEUED/READY`; validation error не оставляет полусформированный command.

`UNIQUE(effect_idempotency_key)` предотвращает межпроектную/межакторную коллизию external effect. Client `request_idempotency_key` никогда не передаётся Connector как effect key. Connector payload не содержит secret value. Worker получает secret только внутри Connector runtime по opaque ref.

Acceptance command всегда хранит `intake_draft_id` и не резервирует несуществующий Work Item ID. Команда над уже принятым объектом хранит `source_work_item_id`. Для intake acceptance переход в `CONFIRMED`, запись `result_work_item_id`, создание Work Item, operational binding и Pack extension, а также `Intake Draft → LINKED` выполняются одной transaction; до неё `result_work_item_id` отсутствует. Composite scope FK не позволяет связать command с Draft/Work Item другого Workspace или Project.

`terminal_result` обязателен для `CONFIRMED`, `CONFLICT` и `FAILED`, а его outcome обязан совпадать со state (`SUCCEEDED`, `CONFLICT`, `FAILED`). Success требует typed receipt и confirmation mode. Conflict/failure требуют sanitized `{code,retryClass}` и могут содержать только нормализованный receipt; 401/403/schema drift и другие terminal failures поэтому выражаются без raw vendor body. `CANCELLED` не притворяется результатом внешнего вызова и не содержит `terminal_result`.

Любая выполненная pre-effect revalidation transaction атомарно пишет gate timestamp/decision и exact effect authorization basis/hash. `DENIED` обязательно имеет reason code и нулевой invocation timestamp; `ALLOWED` записывается перед/вместе с durable attempt claim и только он допускает `effect_invocation_started_at`. Поэтому approval revoke и `CONFIGURATION_DRIFT` сохраняют проверенную basis даже без Connector call; у ещё не обработанного queued command gate fields отсутствуют.

### 9.2. command_outbox

Основные поля:

- id, command_id;
- workspace_id, project_id;
- actor_type, actor_id;
- correlation_id;
- status: HELD, READY, LEASED, ENQUEUED, ACKNOWLEDGED или DEAD;
- available_at;
- lease_token, lease_expires_at;
- enqueue_generation, last_enqueued_at, next_republish_at;
- delivery_count;
- last_error_class, last_error_code;
- created_at, acknowledged_at.

UNIQUE(command_id). Domain mutation, connector_commands и command_outbox создаются одной PostgreSQL transaction через QueryRunner. Approval-gated command получает `AWAITING_APPROVAL` и outbox `HELD`; release после APPROVED переводит их в `QUEUED` и `READY`, но Approval остаётся `AUTHORIZED` до worker-side effect gate.

BullMQ job содержит `{commandId, workspaceId, projectId, actor, correlationId, causationId}`. PostgreSQL остаётся authority для payload и lifecycle; worker обязан сравнить envelope с durable command до repository/Connector invocation.

`HELD → READY → LEASED → ENQUEUED → ACKNOWLEDGED` описывает текущую delivery generation, но только `DEAD` либо terminal command закрывает recovery. Dispatcher записывает visibility deadline. Expired `LEASED`/`ENQUEUED` non-terminal row возвращается в `READY`. После durable worker claim outbox становится `ACKNOWLEDGED`. Worker heartbeat продлевает command execution lease; истёкший lease у non-terminal `DISPATCHED` атомарно переводит command в `RETRY_SCHEDULED/QUEUED`, тот же outbox `ACKNOWLEDGED → READY` и увеличивает `enqueue_generation`. Audit сохраняет историю generations. Поэтому Redis loss и worker crash восстанавливаются до enqueue, до claim и после ACK. Если `effect_invocation_started_at` уже установлен, retry использует только тот же `effect_idempotency_key` и declared lookup/reconciliation strategy.

### 9.3. idempotency_records

Основные поля:

- id, workspace_id, project_id nullable для Workspace-scoped operation;
- actor_type, actor_id;
- normalized_scope_key NOT NULL (`workspace:<workspaceId>` либо `project:<workspaceId>:<projectId>`);
- operation_id;
- idempotency_key;
- request_hash;
- status: IN_PROGRESS, SUCCEEDED, FAILED_RETRYABLE или FAILED_FINAL;
- resource_type, resource_id;
- response_digest;
- expires_at nullable;
- created_at, updated_at.

UNIQUE(actor_type, actor_id, normalized_scope_key, operation_id, idempotency_key). Scope key канонизируется сервером и никогда не содержит NULL, поэтому PostgreSQL NULL semantics не позволяют дублировать Workspace-scoped mutation. `workspace_id/project_id` сохраняются отдельно для authorization/audit и проверяются на соответствие scope key constraint-ом.

Повтор с тем же hash после текущей authorization check возвращает existing result/status. Повтор с другим hash возвращает conflict и не создаёт effect. Один principal не получает resource другого principal через случайную коллизию ключей.

### 9.4. webhook_inbox и event_consumer_inbox

Transport-level `webhook_inbox` хранит:

- id, workspace_id из resolved Connection, project_id nullable до normalization;
- connection_id, connection_version, delivery_id; exact published Connection revision pin-ится при receipt;
- raw_body_hash и encrypted/quarantined raw_body_ref либо bounded raw body по approved retention policy;
- content_type, received_headers_redacted;
- producer, producer_event_id nullable;
- normalized_envelope_hash nullable;
- entity_type, entity_id, external_entity_version nullable;
- payload_version, normalized_payload nullable;
- data_classification_key из обязательного `connection_versions.quarantine_classification_key`, присвоенный до parsing;
- signature_status, replay_status;
- state;
- received_at, processed_at;
- retry_count, last_error_code.

UNIQUE(connection_id, delivery_id). Та же пара + тот же `raw_body_hash` является idempotent duplicate; та же пара + другой hash — terminal `DELIVERY_ID_HASH_CONFLICT`, security audit и никакой normalization. Это pre-domain raw delivery receipt: он pin’ит точную Connection revision, получает её conservative classification, отвечает за signature, replay window, connector parsing, external-scope routing и normalization, но не заменяет inbox каждого consumer. Его lifecycle: `RECEIVED → AUTHENTICATED → NORMALIZED`, с terminal `REJECTED_SIGNATURE | REJECTED_REPLAY | REJECTED_SCHEMA | REJECTED_SCOPE | AMBIGUOUS_SCOPE | DELIVERY_ID_HASH_CONFLICT` и retryable parsing failure. Непарсибельный delivery может остаться Workspace-scoped quarantine; он не виден через project API. Состояние `NORMALIZED` требует non-null project_id и ровно одно совпадение с published Project Binding/external scope, после чего создаётся полноценный project-scoped Event Envelope со своей policy-validated classification; она не понижает защиту сохранённых raw bytes.

event_consumer_inbox:

- id, consumer_name, producer, event_id;
- workspace_id, project_id;
- entity_type, entity_id, entity_version;
- envelope_hash;
- state, received_at, processed_at, last_error_code.

UNIQUE(consumer_name, producer, event_id). Тот же key + тот же `envelope_hash` является duplicate; тот же key + другой hash — terminal `EVENT_ID_HASH_CONFLICT`, security audit и ни одна projection mutation. Каждый consumer независимо и атомарно сохраняет свой marker вместе со своей projection mutation/resulting outbox.

Lifecycle normalized consumer inbox:

~~~text
RECEIVED → VALIDATED → APPLIED
                     → IGNORED_DUPLICATE
                     → IGNORED_STALE
                     → FAILED_RETRYABLE → VALIDATED
                     → FAILED_FINAL
~~~

Out-of-order protection использует external entity version, а не receive timestamp.

### 9.5. event_outbox

Хранит полный versioned event envelope:

- envelope_version, event_id, event_type, occurred_at, recorded_at, producer, producer_version;
- workspace_id, project_id;
- entity_type, entity_id, entity_version;
- correlation_id, causation_id;
- actor_type, actor_id;
- payload_version, payload_schema_ref `{id,version,digest}`, payload, payload_hash;
- data_classification_key;
- delivery status/attempt metadata.

Consumer deduplicate по consumer_name + producer + event_id и применяет entity version rule.

## 10. Artifact Reference и S3Mock smoke

artifact_references хранит только metadata:

- id, workspace_id, project_id;
- owner_entity_type, owner_entity_id;
- artifact_kind;
- storage_provider_kind;
- opaque_locator;
- object_version_or_etag;
- file_name, media_type, size_bytes;
- checksum_algorithm, checksum;
- data_classification_key;
- availability: AVAILABLE, EXPIRED, QUARANTINED или UNAVAILABLE;
- created_by, created_at, expires_at.

Raw object не хранится в Core database. Backend content proxy повторно проверяет Workspace membership, Project Entitlement, role и classification непосредственно перед stream. Opaque locator и provider URL клиенту не выдаются; после entitlement revoke новый либо ещё не начатый stream отклоняется.

Feature 001 включает Adobe S3Mock только для generic object smoke:

- записать deterministic non-sensitive object;
- создать artifact reference;
- прочитать object через authorization-aware backend proxy;
- отклонить cross-project read;
- проверить checksum;
- удалить/expire raw object и сохранить metadata/audit.

QA evidence semantics, manifest revisions, retention policy и GitLab artifacts в 001 не реализуются.

## 11. Audit

audit_events append-only:

- sequence_id bigint и event_id UUID;
- workspace_id и scope_kind `WORKSPACE | PROJECT`; project_id обязателен ровно для PROJECT scope и отсутствует для quarantined/pre-project webhook security event;
- occurred_at;
- actor_type, actor_id;
- action;
- entity_type, entity_id;
- command_id либо platform_action_id для action lifecycle; approval_id для approval-gated event;
- policy_decision, reason_code;
- correlation_id, causation_id;
- request_hash, result_hash;
- exact binding_ref/profile_refs и policy/manifest versions;
- structured authorization_basis с policy, membership, entitlement, role-assignment и skill versions (`NOT_APPLICABLE` явно допустим), плюс authorization_basis_hash; оба nullable только для SYSTEM pre-project webhook security event, где human authorization отсутствует;
- data_classification_key;
- redacted_details;
- source_process.

Operational command/approval/Connector audit всегда `PROJECT`; отсутствие Project допускается в
001 только для `SECURITY_ENVELOPE_REJECTED`, возникшего до однозначной normalization. Такая SYSTEM
запись не фабрикует human authorization basis/hash и читается через отдельный Workspace audit route,
который не расширяет доступ к Project events.
Terminal Connector audit различает `CONFIRMED | CONFLICT | FAILED` и во всех трёх случаях хранит
normalized `result_hash`/result code; deny, conflict, failure и security rejection требуют reason code.

Database role приложения не имеет UPDATE/DELETE для audit_events. Исправление создаёт новый compensating event.

Для каждого connector write audit chain содержит:

1. requested action;
2. authorization/policy decision;
3. outbox dispatch;
4. Connector invocation result;
5. confirmed state либо terminal failure.

Raw secret, bearer token и unredacted sensitive payload запрещены.

## 12. Mock Hub model

Mock Hub использует database awp_mock и отдельные migrations.

### mock_resources

Хранит deterministic external entities:

- external_entity_type, external_entity_id;
- external_version;
- state payload/hash;
- data_classification_key;
- created_at, updated_at.

### mock_effects

- effect_idempotency_key;
- capability_key, operation;
- request_hash;
- effect_status;
- response payload/hash;
- effect_count;
- first_applied_at.

UNIQUE(effect_idempotency_key). Gateway-generated key глобально уникален; capability/operation остаются частью integrity check и audit, но не namespace client key.

Тот же effect key/hash/capability/operation возвращает прежний result. Тот же effect key с другим hash либо operation возвращает 409 security conflict. effect_count остаётся 1.

### mock_calls

Append-only HTTP invocation log. Количество calls может быть больше одного при timeout/retry; это не означает повторный effect.

### mock_events

Хранит исходящие duplicate/out-of-order events, external entity version и delivery attempts.

### mock_scenario_state

Хранит active deterministic scenario, invocation cursor и seed version. Reset возвращает известное состояние и не обращается к реальной сети.

## 13. State invariants

| Aggregate | Инвариант |
|---|---|
| Workspace Work Type | Disable блокирует intake, но не history |
| Profile/Binding version | Одна current PUBLISHED version; payload immutable |
| Draft confirmation | Pin exact draft version, payload hash и binding version |
| Work Item | Scope и definition version неизменяемы |
| Approval | Decision history не переписывается; effect exact и одноразовый |
| Connector Command | Exact scope/capability/target/payload/binding/profile pin до dispatch |
| Outbox | Durable state в PostgreSQL; Redis только delivery |
| Inbox | Duplicate/out-of-order не применяются повторно |
| Artifact | Metadata и audit переживают raw object expiry |
| Audit | Append-only и redacted |

## 14. Migration order

TypeORM synchronize всегда false. Migration runner является отдельным one-shot process и завершается до API/worker.

Platform Core migration order:

1. 0001_platform_primitives — extensions, classification_levels, common constraints;
2. 0010_identity_workspace — identities, workspaces, memberships, role assignments;
3. 0020_projects_entitlements — projects, entitlements, permissions;
4. 0030_extension_registry — Pack, Work Type, Connector и capability registry;
5. 0040_integration_configuration — connections, Mapping/Profile headers/versions/capabilities, Binding headers/versions/entries и immutable validation reports;
6. 0050_work_and_artifacts — drafts, Work Items, operational bindings, artifact references;
7. 0060_approvals_idempotency — exact approvals/profile refs, platform action executions и idempotency records;
8. 0070_connector_delivery — commands, command outbox, webhook receipts, consumer inbox и event outbox;
9. 0080_audit — append-only audit table, indexes и database grants.

Dummy Pack:

1. 1000_dummy_requests — только Pack-owned table и indexes.

Mock Hub database:

1. 0001_mock_state — resources, effects, calls, events, scenarios.

После migrations выполняются:

1. local S3Mock bucket initialization;
2. static manifest reconciliation;
3. compatibility validation;
4. idempotent deterministic seed, включая upload test object.

Правила изменения schema:

- module владеет своими migrations и entity array;
- Core не импортирует Pack migration;
- composition root явно собирает migration arrays;
- incompatible change использует expand/contract;
- destructive contract step запускается только после compatibility period;
- historical hashes/versions не переинтерпретируются;
- rollback не зависит от TypeORM synchronize или удаления таблиц.

## 15. Deterministic seed keys

### Workspaces и Projects

| Workspace | Project | Status | Classification |
|---|---|---|---|
| local-functional | ALPHA | ACTIVE | INTERNAL |
| local-functional | BETA | ACTIVE | RESTRICTED |
| local-functional | GAMMA | SUSPENDED | INTERNAL |
| local-isolated | DELTA | ACTIVE | INTERNAL |

### Personas

| Principal | Назначение |
|---|---|
| owner.local | Workspace Owner; explicit ALPHA `project.admin`, project content только при explicit entitlement |
| integration-admin.alpha | ALPHA Integration Administrator; validate/request-publication, без `project.admin` |
| requester.alpha | ALPHA create/read |
| limited.alpha | ALPHA read с classification ceiling INTERNAL |
| executor.alpha | ALPHA execute и integration use |
| viewer.beta | BETA read-only |
| auditor.local | audit read; без implicit project content |
| worker.local | SERVICE с минимальными ALPHA grants |
| outsider.delta | только local-isolated/DELTA |

### Extension/config fixtures

- Dummy Pack dummy version 1.0.0;
- Work Type dummy.request version 1.0.0, enabled только в local-functional;
- Connector `sample.mock` version 1.0.0 (display name Mock Connector);
- capability sample.record version 1.0.0;
- separate immutable successful Validation Report и exact `validation_report_id` для каждой seeded PUBLISHED Connection/Mapping/Profile/ALPHA Binding revision;
- ALPHA binding v1 PUBLISHED и v2 DRAFT;
- BETA invalid DRAFT без обязательной capability;
- GAMMA suspended configuration;
- logical role PRIMARY как opaque Pack-defined string;
- один historical Dummy Work Item, читаемый при disabled intake;
- один pending exact Approval и один invalidated Approval;
- один confirmed command с полной audit chain;
- deterministic PUBLIC object в S3Mock и artifact reference;
- RESTRICTED ALPHA artifact для проверки classification независимо от Project entitlement.

Seed не содержит QA entities, Jira/GitLab/Mattermost names, production URLs, corporate identifiers, real credentials или model provider.

## 16. Обязательные model tests

- fresh install, repeat/no-op и previous-version upgrade проходят на PostgreSQL 17 и 18;
- composite scope FK отклоняет cross-project relation;
- duplicate issuer + subject отклоняется;
- DENY перекрывает ALLOW;
- referenced classification key/rank нельзя изменить; retirement/new taxonomy не меняют результат historical Approval/Binding/command/artifact interpretation;
- entitlement/binding ceiling и Profile allowlist блокируют несовместимую classification;
- manifest key/version с другим hash создаёт REJECTED registration attempt и не меняет canonical registration;
- disabled Work Type сохраняет historical read;
- Profile/Binding published payload нельзя изменить;
- optional Profile `mappingRef` round-trip-ится в exact same-Workspace/same-Connector published mapping version и входит в Profile content hash;
- validate сохраняет immutable report с exact subject/content hash/actor/time; успешный transition pin’ит конкретный VALID report, а INVALID report не меняет candidate state;
- publish под header lock атомарно RETIRE-ит previous/PUBLISH-ит candidate без partial-unique violation; pinned retired chain остаётся доступной только по правилам migration/recovery;
- один Project не получает Profile другого Workspace;
- logicalRole остаётся opaque и не требует Core migration;
- same actor/scope request idempotency key + same hash возвращает existing result;
- тот же request key с другим hash не создаёт command/effect, а одинаковые client keys разных Projects не схлопываются;
- Gateway effect key globally unique и только он достигает Connector/Mock Hub;
- approved decision при drift сохраняется, effect становится INVALIDATED, а denied pre-effect gate сохраняет exact basis/hash/reason без invocation;
- NOT_REQUIRED command при pre-effect effective-chain drift становится `FAILED/CONFIGURATION_DRIFT`, outbox `DEAD`, effectCount=0;
- queue release сохраняет AUTHORIZED; worker-side pre-effect atomic consumption допускает ровно одного победителя;
- Redis loss и stale DISPATCHED execution lease восстанавливают command из PostgreSQL;
- Work Item и operational binding появляются только вместе после confirmed external result;
- duplicate/stale inbox event не изменяет projection;
- event_outbox round-trip сохраняет все обязательные поля Event Envelope, включая envelope/producer versions, recorded_at и exact payload schema ref;
- Mock Hub call count может расти, effect count остаётся 1;
- unauthorized artifact content request не раскрывает locator и не начинает S3Mock stream;
- S3Mock marker object сохраняет exact version/checksum после container recreate без повторного seed; `local:reset` удаляет named volume;
- audit не допускает update/delete и не содержит secret material.
