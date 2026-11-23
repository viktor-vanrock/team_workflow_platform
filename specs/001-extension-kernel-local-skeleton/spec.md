# Feature Specification: Extension Kernel и локальный walking skeleton

> **Superseded для текущей v1:** требования этой исторической feature о Redis/BullMQ
> и S3Mock заменены [Feature 010](../010-remove-redis-s3/spec.md) и
> [ADR-0009](../../docs/adr/0009-v1-without-redis-s3.md). Остальные решения 001
> сохраняются.

**Feature ID:** `001-extension-kernel-local-skeleton`  
**Статус:** Planned; ready for `/speckit.tasks`  
**Приоритет:** P1  
**Зависимости:** нет  
**Ценность:** доказать, что платформенное ядро расширяется Competency Packs и Connectors без доменного или vendor-specific hardcode.

## 1. Контекст и граница

Feature создаёт минимальное исполняемое ядро Agentic Workspace Platform и локальный контур разработки. Она не реализует QA-процесс. Вместо QA используется `Dummy Competency Pack`, достаточный для проверки extension contracts, Workspace/Project isolation, идемпотентных команд и аудита.

Платформа собирается статически из:

- Platform Core;
- зарегистрированных Competency Packs;
- зарегистрированных typed Connectors;
- composition root приложений API, worker и web;
- stateful Mock Hub для local/integration-test.

## 2. User scenarios и независимые тесты

### US-001 — Локальный запуск платформы (P1)

Как разработчик, я хочу поднять Core, web, worker, PostgreSQL, Redis и Mock Hub одной документированной последовательностью команд, чтобы разрабатывать features без Jira, GitLab, Mattermost, corporate OIDC и LLM.

**Независимый тест:** чистая локальная среда запускается, применяет migrations/seed и показывает health всех обязательных компонентов.

**Acceptance scenarios:**

1. **Given** установлен поддерживаемый runtime и Docker, **when** разработчик запускает local bootstrap, **then** API, worker, web, database, queue и Mock Hub становятся healthy.
2. **Given** model provider отсутствует, **when** создаётся Dummy request, **then** детерминированный flow продолжает работать.
3. **Given** local fake identity, **when** пользователь переключает тестовую роль, **then** UI явно показывает development mode и применяет backend authorization.

### US-002 — Регистрация Dummy Pack (P1)

Как platform developer, я хочу зарегистрировать Dummy Pack через стабильный Competency SDK, чтобы доказать отсутствие QA-hardcode в Core.

**Независимый тест:** Dummy Pack добавляет Work Type, intake schema, собственную entity и detail view без изменения Core tables/use cases.

**Acceptance scenarios:**

1. **Given** Dummy Pack присутствует в composition root, **when** приложение стартует, **then** Pack manifest проходит compatibility validation и Work Type доступен разрешённому Workspace.
2. **Given** Dummy Pack исключён из composition root, **when** Core собирается и тестируется, **then** Core не требует dummy/QA types.
3. **Given** Work Type выключен, **when** пользователь открывает историю, **then** существующие Work Items доступны read-only, но новый intake запрещён.

### US-003 — Регистрация Mock Connector (P1)

Как разработчик Pack, я хочу вызывать логическую capability через Connector Broker, чтобы Pack не импортировал vendor SDK.

**Независимый тест:** Dummy Pack выполняет mock external write только через Command Gateway → policy → outbox → connector.

**Acceptance scenarios:**

1. **Given** Pack запрашивает typed capability, **when** published profile содержит совместимый binding, **then** Broker направляет команду в Mock Connector.
2. **Given** обязательный capability binding отсутствует, **when** Project Integration Binding публикуется, **then** публикация Binding отклоняется с точной причиной; отсутствие optional requirement даёт только scoped unavailable reason.
3. **Given** клиент повторяет request с тем же actor-scoped request idempotency key либо worker повторяет effect с тем же Gateway-generated global effect idempotency key, **when** обработка возобновляется, **then** возвращается тот же command, а внешний эффект возникает ровно один раз.

### US-004 — Workspace и Project isolation (P1)

Как security owner, я хочу, чтобы доступ вычислялся на backend по Workspace, Project и роли, чтобы общий service account не раскрывал данные чужого проекта.

**Независимый тест:** пользователь Workspace A/Project A не может прочитать или изменить данные Workspace B/Project B ни через API, ни через async command.

## 3. Functional requirements

### 3.1. Extension model

- **FR-001:** Core должен поддерживать статическую регистрацию `CompetencyPackManifest` и `ConnectorManifest` в composition root.
- **FR-002:** Pack может зависеть только от Competency SDK и опубликованных Core contracts.
- **FR-003:** Connector может зависеть только от Connector SDK и опубликованных Core contracts.
- **FR-004:** Core не должен импортировать Pack-specific или vendor-specific types.
- **FR-005:** Pack не должен импортировать конкретный Connector или vendor SDK.
- **FR-006:** Connector не должен импортировать Pack entities/rules.
- **FR-007:** architecture checks должны запрещать недопустимые направления импортов.
- **FR-008:** runtime поддерживает enable/disable Work Type на Workspace, но не dynamic code loading.
- **FR-009:** публичный manifest содержит version и required Core contract range.

### 3.2. Identity и authorization

- **FR-010:** канонический human principal идентифицируется парой `issuer + subject`.
- **FR-011:** каждый application use case принимает явный Workspace context.
- **FR-012:** project-scoped доступ вычисляется как `Workspace Membership AND Project Entitlement AND Role Permission AND Data Classification`.
- **FR-013:** frontend visibility не считается контролем доступа.
- **FR-014:** async jobs и external commands несут `workspaceId`, `projectId`, actor, correlation ID и causation ID.
- **FR-015:** default authorization decision — deny.

### 3.3. Commands, events и audit

- **FR-016:** любой внешний write проходит Command Gateway, policy check, outbox и Connector Broker.
- **FR-017:** command содержит schema version, durable Intake Draft/Work Item source, target, actor, correlation/causation IDs и initial authorization basis; после любого выполненного pre-effect gate он также хранит timestamp/decision/reason и exact effect-time policy/authorization versions даже при deny/drift без invocation, включая explicit skill version либо `NOT_APPLICABLE`. Actor/scope-scoped client request idempotency key отделён от Gateway-generated globally unique effect idempotency key; Connector получает только effect key.
- **FR-018:** durable событие round-trip-ит envelope version, event ID/type, occurred/recorded timestamps, producer/version, workspace/project context, causation/correlation IDs, exact payload schema ref и payload version.
- **FR-019:** append-only audit фиксирует explicit `WORKSPACE | PROJECT` scope, sequence/event identity, source process, entity/action identity, Approval/command/platform-action refs, context-valid exact authorization basis/hash для authorization-bearing stages, requested action, policy decision и Connector invocation; confirmed/conflict/failure сохраняют normalized result hash/code, а deny/error/security rejection — reason code. Operational chain всегда Project-scoped; SYSTEM rejection webhook до Project resolution допускает только Workspace-scoped security audit без fabricated human authorization basis.
- **FR-020:** secrets и чувствительные payloads не попадают в audit/log.
- **FR-021:** retry после worker restart не создаёт повторного внешнего эффекта.

### 3.4. Connector framework

- **FR-022:** Connectors предоставляют typed capability ports, а не универсальный `execute(any)`.
- **FR-023:** Connection хранит immutable versioned endpoint/environment/secret reference/policies/configuration; mutable health хранится отдельно. Schema-bound Mapping является отдельной immutable versioned resource. Profile pin’ит exact same-Workspace Connection и optional same-Connector Mapping refs, явно round-trip-ит `mappingContentHash` и содержит разрешённые operation configurations. Connection/Mapping/Profile/Binding несут classification собственной конфигурации отдельно от payload ceiling/allowlist.
- **FR-024:** Connection/Mapping/Profile/Binding validation проверяет schema/content hash, capability/Connector implementation version, exact transitive refs, operation effect, пересечение idempotency/confirmation strategies, scopes, environment, classification и conservative raw-webhook classification Connection; результат сохраняется как immutable scoped Validation Report с actor, context-valid authorization basis/hash, subject/hash и timestamps. Успешный transition атомарно pin’ит exact `validationReportId`, исключённый из semantic content hash; failed report оставляет candidate DRAFT без ссылки.
- **FR-025:** отсутствие optional capability отключает только зависимую функцию и объясняет причину.
- **FR-026:** Mock Connector реализует тот же contract, что будущий реальный Connector.

### 3.5. Local-first runtime

- **FR-027:** local profile использует fake OIDC, Mock Connectors и fake model provider.
- **FR-028:** local profile физически не может ссылаться на production Connection.
- **FR-029:** Mock Hub поддерживает reset, deterministic seed и только external-system scenario injection; Core policy harness и fake model provider владеют собственными сценариями отдельно.
- **FR-030:** минимальные local-harness scenarios: Mock Hub — success, timeout, connector 401/403, 429/5xx, duplicate event, out-of-order event и schema drift; fake model provider — invalid model output; Core policy harness — policy denial до любого Connector/Mock Hub invocation.

### 3.6. Approval и Project Integration Binding contracts

- **FR-031:** Core должен определить минимальный versioned `ProjectIntegrationBinding`, который связывает project-scoped typed capability requirement с exact опубликованной Connector Profile revision и её транзитивной Connection/Mapping chain.
- **FR-032:** Binding должен допускать несколько profiles одного Connector Type через opaque Pack-owned `logicalRole`; Core не содержит закрытого role enum или семантических ветвлений, а uniqueness key включает project, environment, capability и logical role.
- **FR-033:** Work Item и external command должны pin’ить фактически использованные exact binding/profile refs `{id, version}`; secret values в binding запрещены.
- **FR-034:** Core Approval Gateway должен хранить initiator, human approver, approver role/authorization basis, единственную action identity `actionKind + actionId`, target, action-specific payload hash (полный typed payload для external command либо semantic candidate content hash для platform action без отдельного payload), expected state (external state либо local candidate resource version/content hash вместе со stable-header resource version и current-published version), exact binding/profile refs, Workspace/Project scope, expiry и точный Gateway-generated effect/action idempotency key и повторно проверять их непосредственно перед effect. Consumption относится только к этой action identity и не добавляет второй action ref.
- **FR-035:** изменение payload, target, binding/profile ref, action-specific expected state, права/роли approver либо expiry должно сохранить историческое решение, но аннулировать право effect без external/local mutation.

## 4. Минимальная модель данных

- `workspaces`, `workspace_memberships`, `role_assignments`;
- `projects`, `project_entitlements`;
- `competency_pack_registrations`, `extension_registration_attempts`, `work_type_definitions`, `workspace_work_types`;
- `connector_registrations`, `connector_capability_implementations`, `connections`, `connection_versions`, `connection_health`, `connector_mappings`, `connector_mapping_versions`, `connector_profiles`, `connector_profile_versions`, `project_integration_bindings`, `project_integration_binding_versions`, `integration_validation_reports`;
- `intake_drafts`, `work_items`, `operational_bindings`;
- `connector_commands`, `command_outbox`, `webhook_inbox`, `event_consumer_inbox`, `event_outbox`, `idempotency_records`;
- `approvals`, `platform_action_executions`, `audit_events`, `artifact_references`;
- Dummy Pack-owned namespaced tables.

Pack tables могут иметь foreign key только на стабильные Core IDs и не читают Core/other Pack tables напрямую, минуя application ports.

## 5. Security и failure requirements

- Cross-workspace/project read/write должен блокироваться до repository/adapter invocation.
- Raw secret доступен только Connector runtime; Pack и agent получают opaque reference/result.
- Webhook envelope проходит signature/replay validation в Mock scenario contract.
- Невалидный Pack/Connector manifest блокирует только соответствующую регистрацию и выдаёт диагностируемую ошибку.
- Redis не является единственным durable хранилищем command/run state.

## 6. Success criteria

- **SC-001:** локальный bootstrap воспроизводим на чистой машине по документации.
- **SC-002:** Core компилируется и тестируется без Dummy/QA Pack.
- **SC-003:** Dummy Pack добавляется без изменения Core schema/use cases.
- **SC-004:** Mock Connector заменяется другим implementation через Profile без изменения Pack.
- **SC-005:** повтор команды/event не создаёт duplicate effect.
- **SC-006:** обязательные isolation tests проходят для API, repository, artifacts и async commands.
- **SC-007:** 100% connector writes имеют связанный audit record.

## 7. Out of scope

- QA entities и workflows;
- реальные Jira/GitLab/Mattermost connections;
- dynamic plugin loading или marketplace;
- pack-to-pack dependencies;
- runtime JavaScript/remote frontend plugins;
- production deployment.

## 8. Готовность к `/speckit.tasks`

Планирование завершено: monorepo conventions, ORM, UI facade, local infrastructure и contract gates зафиксированы в `plan.md`, `research.md`, `data-model.md`, `contracts/` и `quickstart.md`. Feature готова к декомпозиции `/speckit.tasks`; product scope при этом не расширяется.
