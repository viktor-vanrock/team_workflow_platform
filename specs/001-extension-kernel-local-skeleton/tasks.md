# Tasks: Extension Kernel и локальный walking skeleton

**Feature:** `001-extension-kernel-local-skeleton`  
**Input:** [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [quickstart.md](quickstart.md), [contracts/](contracts/)  
**Scope:** только feature `001`; реализация QA Pack, Jira, GitLab, Mattermost и Hermes не входит.

## Правила исполнения

- Формат каждой задачи: `- [ ] Txxx [P?] [USn?] действие + точный путь`.
- `[P]` означает, что задача меняет независимые файлы и может выполняться параллельно после завершения общих prerequisites фазы.
- `[US1]`…`[US4]` соответствуют `US-001`…`US-004` из specification. Setup/foundation/hardening задачи метки истории не имеют.
- Истории являются линзами приёмки, а не порядком технической реализации. Critical path: foundation → US2 → US3 configuration → US3 durable flow/Approval → US4 full isolation → US1 local composition.
- Security controls US4 начинаются в foundation и расширяются на каждом новом surface; Phase 6 только закрывает историю целиком.
- Тестовые задачи обязательны и создаются до соответствующей реализации: test-authoring checkbox закрывается после подтверждённого ожидаемого `RED`, а acceptance становится `GREEN` только в story/checkpoint и финальном gate.
- `PostgreSQL` остаётся durable authority; `Redis/BullMQ` используется только как восстанавливаемый delivery accelerator.
- Публичный путь внешней записи только один: typed Pack action → Command Gateway → policy → outbox → Connector Broker → typed Connector.
- Seeded published Binding допустим для раннего local fixture, но не доказывает runtime publication: `AT-019` закрывается только durable `PLATFORM_ACTION` path.
- После выполнения задачи исполнитель меняет её checkbox на `[x]` и прикладывает команду/тест, которым проверен результат.

## Phase 1 — Setup: pinned workspace и contract shell

**Цель:** воспроизводимый monorepo и тестовый каркас без application behavior.

- [x] T001 Зафиксировать Node `24.20.0`, pnpm `11.21.0` и immutable-install policy в `package.json`, `.node-version` и `.npmrc`
- [x] T002 Настроить pnpm/Nx workspace, ESM и strict TypeScript в `pnpm-workspace.yaml`, `nx.json`, `tsconfig.base.json` и `tsconfig.json`
- [x] T003 [P] Создать manifests/Nx projects/strict configs/public entrypoints Core-пакетов с exact targets Nx `23.1.2`, TypeScript `6.0`, NestJS `11`, TypeORM `1.1`, BullMQ `6`, TypeBox `1`, Ajv `8` и Vitest `4` в `packages/platform-contracts/{package.json,project.json,tsconfig.json,src/index.ts}`, `packages/platform-core/{package.json,project.json,tsconfig.json,src/index.ts}`, `packages/platform-runtime-nest/{package.json,project.json,tsconfig.json,src/index.ts}`, `packages/platform-persistence-typeorm/{package.json,project.json,tsconfig.json,src/index.ts}`, `packages/platform-queue-bullmq/{package.json,project.json,tsconfig.json,src/index.ts}`, `packages/platform-ui/{package.json,project.json,tsconfig.json,src/index.ts}` и `packages/platform-testkit/{package.json,project.json,tsconfig.json,src/index.ts}`
- [x] T004 [P] Создать manifests/Nx projects/strict configs/public entrypoints extension/composition-пакетов в `packages/competency-sdk/{package.json,project.json,tsconfig.json,src/index.ts}`, `packages/competency-ui-sdk/{package.json,project.json,tsconfig.json,src/index.ts}`, `packages/connector-sdk/{package.json,project.json,tsconfig.json,src/index.ts}`, `packages/competency-dummy/{package.json,project.json,tsconfig.json,src/index.ts}`, `packages/connector-mock/{package.json,project.json,tsconfig.json,src/index.ts}` и `packages/runtime-composition/{package.json,project.json,tsconfig.json,src/index.ts}`
- [x] T005 [P] Создать компилируемые app manifests/Nx projects/strict configs/minimal entrypoints с exact targets React `19.2`, Vite `8.2`, MUI `9` и Testing Library/Playwright в `apps/api/{package.json,project.json,tsconfig.json,src/main.ts}`, `apps/worker/{package.json,project.json,tsconfig.json,src/main.ts}`, `apps/web/{package.json,project.json,tsconfig.json,index.html,vite.config.ts,src/main.tsx}`, `apps/mock-hub/{package.json,project.json,tsconfig.json,src/main.ts}` и `apps/fake-idp/{package.json,project.json,tsconfig.json,src/main.ts}`
- [x] T006 Настроить Nx tags, запрет deep imports/cycles и повторяющиеся module-boundary rules в `eslint.config.mjs` и `tools/architecture/dependency-rules.mts`
- [x] T007 Настроить Vitest workspaces, Testcontainers и Playwright Chromium в `vitest.workspace.ts`, `tests/testcontainers.config.ts` и `playwright.config.ts`
- [x] T008 Реализовать стабильный root script contract и Node/pnpm/Docker fail-fast в `package.json` и `tools/local/check-prerequisites.mts`
- [x] T009 Создать типизированную конфигурацию с обязательным `AWP_RUNTIME_PROFILE` и безопасными defaults в `.env.example` и `packages/runtime-composition/src/config/environment.ts`
- [x] T010 [P] Создать provider-neutral CI entrypoint с frozen install, lint, typecheck и production build без предположения о GitHub/GitLab runner в `tools/ci/feature-001.mts`
- [x] T011 Единожды собрать `pnpm-lock.yaml` после всех setup manifests и реализовать setup gate для frozen clean install, workspace graph, exact tool versions и компиляции каждого app/package entrypoint в `tools/verification/setup-gate.mts`

**Checkpoint:** workspace устанавливается с frozen lockfile; пустые приложения и пакеты компилируются; boundary rules подключены, но feature behavior ещё отсутствует.

**Evidence T001–T011:** `node tools/verification/setup-gate.mts` — frozen install, 18-project Nx graph, architecture scan, typecheck and production builds: PASS.

---

## Phase 2 — Foundation: contracts, scope, persistence и deny-by-default

**Цель:** создать обязательные primitives и security boundary, которые блокируют все story-фазы.

### Tests first

- [x] T012 Написать красные проверки всех checked-in JSON Schema examples, `$ref`, digests и negative vectors в `tests/contract/design-contract-fixtures.spec.ts`
- [x] T013 Написать красные prefix-проверки порядка migrations `0001→0040`, `synchronize:false`, one-shot ownership и schema-version fail-fast; полный chain оставить T146 в `tests/integration/migrations/order-and-safety.spec.ts`
- [x] T014 [P] Написать красные model tests для composite scope FK, unique `issuer + subject`, immutable classification key/rank и `DENY`-wins в `tests/integration/foundation-model.spec.ts`
- [x] T015 [P] Написать красную authorization matrix `membership ∩ entitlement ∩ role ∩ classification`, default-deny и Project/Workspace authorization-basis validation в `tests/integration/security/authorization-policy.spec.ts`
- [x] T016 [P] Написать красные HTTP tests, доказывающие игнорирование/отклонение client-supplied actor, role, entitlement и authoritative scope при сохранении correlation/causation IDs в `tests/integration/security/request-trust-boundary.spec.ts`

### Implementation

- [x] T017 Собрать checked-in design contracts в immutable registry artifact и generated type snapshot через `tools/contracts/build-registry.mts` и `packages/platform-contracts/src/generated/schema-documents.ts`
- [x] T018 Реализовать offline JSON Schema 2020-12 Registry, только локальные `$ref`, schema digest collision detection и `SchemaBoundValue` validation в `packages/platform-contracts/src/schema-registry.ts`
- [x] T019 [P] Реализовать RFC 8785 canonicalization, SHA-256 и canonical sort для authorization/profile refs в `packages/platform-contracts/src/canonical-hash.ts`
- [x] T020 [P] Реализовать Core primitives `WorkspaceContext`, scope, actor, versioned refs, classification refs, `Clock`, `IdGenerator` и transaction port в `packages/platform-core/src/shared/primitives.ts`
- [x] T021 Реализовать поверх T020 deterministic clock/IDs и actor/scope builders в `packages/platform-testkit/src/index.ts`
- [x] T022 Настроить TypeORM data source, `synchronize:false`, migration/entity registry API, one-shot runner и real-PostgreSQL test helper без преждевременной full composition в `packages/platform-persistence-typeorm/src/data-source.ts`, `packages/platform-persistence-typeorm/src/migration-registry.ts`, `packages/platform-persistence-typeorm/src/migration-runner.ts` и `packages/platform-testkit/src/postgres.ts`
- [x] T023 Создать/register migration `0001_platform_primitives` и explicit TypeORM entities для extension primitives, classification catalog и common constraints в `packages/platform-persistence-typeorm/src/migrations/core/0001-platform-primitives.ts`, `packages/platform-persistence-typeorm/src/migrations/core/index.ts` и `packages/platform-persistence-typeorm/src/entities/platform-primitives.entities.ts`
- [x] T024 Создать/register migration `0010_identity_workspace` и entities для identities, workspaces, memberships и role assignments в `packages/platform-persistence-typeorm/src/migrations/core/0010-identity-workspace.ts`, `packages/platform-persistence-typeorm/src/migrations/core/index.ts` и `packages/platform-persistence-typeorm/src/entities/identity-workspace.entities.ts`
- [x] T025 Создать/register migration `0020_projects_entitlements` и entities для projects, entitlements, permissions и composite Workspace/Project keys в `packages/platform-persistence-typeorm/src/migrations/core/0020-projects-entitlements.ts`, `packages/platform-persistence-typeorm/src/migrations/core/index.ts` и `packages/platform-persistence-typeorm/src/entities/projects-entitlements.entities.ts`
- [x] T026 Создать/register migration `0030_extension_registry` и entities для Pack, Work Type, Connector, capability registrations и append-only attempts в `packages/platform-persistence-typeorm/src/migrations/core/0030-extension-registry.ts`, `packages/platform-persistence-typeorm/src/migrations/core/index.ts` и `packages/platform-persistence-typeorm/src/entities/extension-registry.entities.ts`
- [x] T027 Создать/register migration `0040_integration_configuration` и entities для immutable Connection/Mapping/Profile/Binding headers/revisions, health и Validation Reports в `packages/platform-persistence-typeorm/src/migrations/core/0040-integration-configuration.ts`, `packages/platform-persistence-typeorm/src/migrations/core/index.ts` и `packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts`
- [x] T028 Реализовать Identity/Workspace/Project/classification models, обязательные scoped repository ports и TypeORM adapters поверх module entity array без unscoped project methods в `packages/platform-core/src/identity-access/model.ts`, `packages/platform-core/src/identity-access/ports.ts` и `packages/platform-persistence-typeorm/src/identity-access.repository.ts`
- [x] T029 Реализовать deny-by-default policy, explicit `DENY` precedence и context-valid Workspace/Project authorization basis в `packages/platform-core/src/identity-access/authorization-policy.ts` и `packages/platform-core/src/identity-access/classification-policy.ts`
- [x] T030 Реализовать OIDC JWT verification, principal extraction только из verified token и request-scoped `WorkspaceContext` в `packages/platform-runtime-nest/src/auth/oidc-auth.guard.ts` и `packages/platform-runtime-nest/src/auth/workspace-context.ts`
- [x] T031 [P] Создать API/worker liveness/readiness shells с `runtime.profile`, dependency states DB/schema/Redis/S3Mock/extensions/Mock Hub, structured JSON logger и redacted OTel spans/metrics с IDs, versions, outcomes, latency и classification key в `apps/api/src/health.controller.ts`, `apps/api/src/main.ts`, `apps/worker/src/health.controller.ts`, `apps/worker/src/main.ts`, `packages/platform-runtime-nest/src/health/readiness.service.ts` и `packages/platform-runtime-nest/src/observability/telemetry.ts`
- [x] T032 Написать красные architecture tests для Core-without-extensions, forbidden directions, deep aliases, cycles, runtime URLs/import paths/download/eval в `tests/architecture/module-boundaries.spec.ts`, `tests/architecture/core-without-extensions.spec.ts` и `tests/architecture/no-runtime-loading.spec.ts`
- [x] T033 Реализовать filesystem/import-graph enforcement и отдельный Core-only Nx target в `tools/architecture/check-import-graph.mts` и `packages/platform-core/project.json`
- [x] T034 Реализовать append-only audit port, classification-aware allowlist/redaction и authorization-decision recording contract в `packages/platform-core/src/audit/audit-port.ts` и `packages/platform-core/src/audit/redaction.ts`
- [x] T035 Реализовать RFC 9457 mapping, correlation/causation+OTel middleware, базовый authorization interceptor/permission metadata и foundation gate для T012–T016, migrations T023–T027 и architecture T032–T033 в `packages/platform-runtime-nest/src/http/problem-details.filter.ts`, `packages/platform-runtime-nest/src/http/correlation.middleware.ts`, `packages/platform-runtime-nest/src/auth/authorize-use-case.interceptor.ts` и `tools/verification/foundation-gate.mts`

**Checkpoint:** prefix migrations `0001→0040` проходит; реальный PostgreSQL отклоняет cross-scope links; actor/scope не доверяются клиенту; Core собирается без Dummy/Mock.

**Evidence T012–T035:** `node tools/verification/foundation-gate.mts` — 31 schemas/17 examples, negative vectors, PostgreSQL scope constraints, authorization/trust-boundary and architecture tests: 26 PASS.

---

## Phase 3 — Extension kernel: US2 и shared Connector SDK prerequisite

**Goal:** статически зарегистрировать новый Pack/Work Type без Core schema/use-case changes и сохранить историю после disable.

**Independent test:** зарегистрировать `dummy@1.0.0`, включить `dummy.request` только для `local-functional`, создать/read исторический Work Item, выключить Work Type и доказать, что новый intake запрещён, а history читается.

### Tests first

- [x] T036 [P] [US2] Написать `AT-004` для manifest schema/SemVer/Core range/digest, static registration и Workspace enablement в `tests/integration/acceptance/at-004-extension-registration.spec.ts`
- [x] T037 [P] [US2] Написать collision test: тот же key/version с другим hash создаёт изолированный `REJECTED` attempt и не меняет canonical registration/readiness других extensions в `tests/integration/extension-registration-rejection.spec.ts`
- [x] T038 [P] [US2] Написать intake/history test для enable→disable и optimistic concurrency в `tests/integration/work-type-enablement.spec.ts`
- [x] T039 [P] [US2] Написать `AT-005`: Core-only build, forbidden Pack↔Connector/Core imports, deep aliases, cycles и no dynamic loading в `tests/architecture/acceptance/at-005-extension-boundaries.spec.ts`
- [x] T040 [P] [US3] Написать `AT-006`: каждая capability operation typed, `execute(any)` отсутствует, opaque `logicalRole` принимает новое Pack-owned value без Core branch/migration в `tests/contract/acceptance/at-006-typed-capabilities.spec.ts`

### Implementation

- [x] T041 [P] [US2] Реализовать Competency SDK manifests, Work Type definitions, capability requirements и Pack application ports в `packages/competency-sdk/src/index.ts`
- [x] T042 [P] [US2] Реализовать compile-time route/detail contribution descriptors без remote JavaScript в `packages/competency-ui-sdk/src/index.ts`
- [x] T043 [P] [US3] Реализовать Connector SDK typed operation ports, runtime context и strategy declarations без universal execute method в `packages/connector-sdk/src/index.ts`
- [x] T044 [US2] Реализовать immutable Extension Registry domain, explicit TypeORM entities и scoped repository adapter для canonical registrations/attempts в `packages/platform-core/src/extension-registry/extension-registry.ts`, `packages/platform-persistence-typeorm/src/entities/extension-registry.entities.ts` и `packages/platform-persistence-typeorm/src/extension-registry.repository.ts`
- [x] T045 [US2] Реализовать deterministic manifest reconciliation, compatibility diagnostics, rejected-attempt isolation и required/optional readiness в `packages/platform-core/src/extension-registry/reconcile-extensions.ts`
- [x] T046 [US2] Собрать static composition maps и explicit Core-only/non-local compositions в `packages/runtime-composition/src/extensions/composition.ts`
- [x] T047 Создать/register migration `0050_work_and_artifacts`, explicit Work/Artifact entities и обновить ordered Core index в `packages/platform-persistence-typeorm/src/migrations/core/0050-work-and-artifacts.ts`, `packages/platform-persistence-typeorm/src/migrations/core/index.ts`, `packages/platform-persistence-typeorm/src/entities/work-and-artifacts.entities.ts` и `packages/platform-persistence-typeorm/src/entities/composition.ts`
- [x] T048 Создать/register migration `0060_approvals_idempotency` для exact approvals, platform actions и request-idempotency records в `packages/platform-persistence-typeorm/src/migrations/core/0060-approvals-idempotency.ts` и `packages/platform-persistence-typeorm/src/migrations/core/index.ts`
- [x] T049 Создать/register migration `0070_connector_delivery` для commands, command outbox, webhook receipts, consumer inbox и event outbox в `packages/platform-persistence-typeorm/src/migrations/core/0070-connector-delivery.ts` и `packages/platform-persistence-typeorm/src/migrations/core/index.ts`
- [x] T050 Создать/register migration `0080_audit` с indexes/append-only DB grants и зафиксировать full Core migration composition `0001→0080` в `packages/platform-persistence-typeorm/src/migrations/core/0080-audit.ts`, `packages/platform-persistence-typeorm/src/migrations/core/index.ts` и `packages/runtime-composition/src/migrations/composition.ts`
- [x] T051 [US2] Реализовать generic Intake Draft/Work Item models и scoped repositories поверх module entity array с immutable definition/scope pins в `packages/platform-core/src/work-management/model.ts` и `packages/platform-persistence-typeorm/src/work-management.repository.ts`
- [x] T052 [US2] После full Core chain T050 создать/register Pack-owned migration/entity array, manifest, `dummy.request@1.0.0` и Dummy-owned model/repository; объединить Core+Pack entities только в composition root без Core→Pack import в `packages/competency-dummy/src/persistence/migrations/1000-dummy-requests.ts`, `packages/competency-dummy/src/persistence/migrations/index.ts`, `packages/competency-dummy/src/persistence/entities.ts`, `packages/competency-dummy/src/manifest.ts`, `packages/competency-dummy/src/domain/dummy-request.ts`, `packages/competency-dummy/src/persistence/dummy-request.repository.ts`, `packages/runtime-composition/src/migrations/composition.ts` и `packages/runtime-composition/src/persistence/entity-composition.ts`
- [x] T053 [US2] Реализовать Dummy intake/detail handlers и composition-only Nest controller для `getSampleWorkItemExtension` с explicit permission metadata без Core knowledge о Dummy fields в `packages/competency-dummy/src/application/dummy-request.ts` и `apps/api/src/extensions/dummy-pack.controller.ts`
- [x] T054 [US2] Реализовать Core HTTP operations `listPackRegistrations`, `listConnectorRegistrations`, `listCapabilityContracts`, visible Projects, Work Type enablement, `create|get|submitIntakeDraft` и `getWorkItem` с backend authorization metadata в `packages/platform-runtime-nest/src/http/extension-registry.controller.ts`, `packages/platform-runtime-nest/src/http/projects.controller.ts`, `packages/platform-runtime-nest/src/http/work-types.controller.ts`, `packages/platform-runtime-nest/src/http/intake-drafts.controller.ts` и `packages/platform-runtime-nest/src/http/work-items.controller.ts`
- [x] T055 [US2] Скрыть MUI за platform facade и подключить Dummy detail/history contribution в `packages/platform-ui/src/index.ts`, `packages/competency-dummy/src/ui/contribution.tsx` и `apps/web/src/routes/work-item-detail.tsx`
- [x] T056 [US2] Собрать независимый US2 checkpoint с `AT-004`, `AT-005`, `AT-006` и history-after-disable в `tools/verification/us2-extension-checkpoint.mts`

**Checkpoint:** M3 extension-kernel checkpoint завершён: US2 acceptance закрыт, а shared typed Connector SDK/`AT-006` подготовил Phase 4. Это ещё не local MVP и не Feature 001 Done.

**Evidence T036–T056:** `node tools/verification/us2-extension-checkpoint.mts` — `AT-004`, `AT-005`, `AT-006`, collision isolation, history-after-disable and PostgreSQL `0001→0080 + 1000` composition: PASS.

---

## Phase 4 — US3 (часть A): Connector configuration kernel и Mock contracts

**Goal:** создать immutable exact configuration chain и доказать заменяемость typed Connector до реализации delivery path.

**Independent test:** создать/validate/publish Connection→optional Mapping→Profile, проверить capability availability, создать Binding candidate и разрешить exact pinned chain; заменить implementation через Profile без изменения Dummy Pack.

### Tests first

- [x] T057 [P] [US3] Написать красные lifecycle/ETag/content-hash/health tests, включая `Connection.quarantineClassificationKey` и conservative inbound classification rank, для Connection/Mapping/Profile/Binding в `tests/integration/integration-configuration-lifecycle.spec.ts`
- [x] T058 [P] [US3] Написать `AT-007`: missing required capability запрещает Binding publication, optional requirement возвращает scoped unavailable reason в `tests/integration/acceptance/at-007-capability-availability.spec.ts`
- [x] T059 [P] [US3] Написать `AT-013`: вторая implementation той же capability заменяет Mock через Profile без Pack change в `tests/contract/acceptance/at-013-connector-substitution.spec.ts`
- [x] T060 [P] [US3] Написать `AT-014`: immutable revisions, exact same-Workspace transitive refs/hashes, conservative webhook classification, failed report остаётся DRAFT, atomic publish/supersede, retired recovery, health isolation и no raw secrets; full Binding publication остаётся RED до T107–T108 в `tests/integration/acceptance/at-014-configuration-versioning.spec.ts`
- [x] T061 [P] [US3] Написать `AT-018` как полную matrix пересечения capability/implementation idempotency и confirmation strategies в `tests/contract/acceptance/at-018-strategy-intersection.spec.ts`
- [x] T062 [P] [US3] Написать `AT-012` для Mock Hub reset/seed/effect ledger и external scenarios `success|timeout|401|403|429|5xx|duplicate|out-of-order|schema-drift` в `tests/contract/acceptance/at-012-mock-hub.spec.ts`

### Implementation

- [x] T063 [US3] Реализовать Capability Registry и exact contract/Connector implementation resolution в `packages/platform-core/src/integration-registry/capability-registry.ts`
- [x] T064 [US3] Реализовать immutable Connection/Mapping/Profile/Binding headers/revisions, отдельную mutable health и opaque logical role model в `packages/platform-core/src/integration-registry/model.ts`
- [x] T065 [US3] Реализовать scoped persistence adapters поверх explicit configuration entity array, header locks и one-current-published constraints для всей chain в `packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts` и `packages/platform-persistence-typeorm/src/integration-configuration.repository.ts`
- [x] T066 [US3] Реализовать semantic content hashes и immutable Validation Report с subject/hash/actor/basis/time без включения `validationReportId` в hash в `packages/platform-core/src/integration-registry/validation-reports.ts`
- [x] T067 [US3] Реализовать Connection/Mapping validate/publish, schema/content hashes, environment/scopes/config classification, secret-ref-only boundary и `quarantineClassificationKey` в `packages/platform-core/src/integration-registry/connection-mapping-lifecycle.ts`
- [x] T068 [US3] Реализовать Profile validation/publish с same-Connector Mapping, exact refs, payload ceiling/allowlist отдельно от config classification, conservative check `quarantine rank ≥ max inbound entry rank` и полной strategy intersection в `packages/platform-core/src/integration-registry/profile-lifecycle.ts`
- [x] T069 [US3] Реализовать Binding candidate validation, required/optional availability, uniqueness tuple и deterministic exact-chain resolver в `packages/platform-core/src/integration-registry/binding-lifecycle.ts`
- [x] T070 [US3] Реализовать create/get/validate/publish Connection/Mapping/Profile, create/get/validate Binding, health/report/availability HTTP operations с `If-Match`, backend-derived actor и explicit permission metadata; Binding request-publication остаётся T111 после platform action в `packages/platform-runtime-nest/src/http/integration-registry.controller.ts`
- [x] T071 [US3] Реализовать/register explicit Approval/platform-action/idempotency entities и проверить их mapping parity с T048 migration `0060` в `packages/platform-persistence-typeorm/src/entities/approvals-idempotency.entities.ts`, `packages/platform-persistence-typeorm/src/entities/composition.ts` и `tests/integration/migrations/0060-entity-parity.spec.ts`
- [x] T072 [US3] Реализовать/register explicit command/outbox/inbox/event entities и проверить их mapping parity с T049 migration `0070` в `packages/platform-persistence-typeorm/src/entities/connector-delivery.entities.ts`, `packages/platform-persistence-typeorm/src/entities/composition.ts` и `tests/integration/migrations/0070-entity-parity.spec.ts`
- [x] T073 [US3] Реализовать/register explicit audit entity и проверить indexes/append-only DB grants T050 migration `0080` в `packages/platform-persistence-typeorm/src/entities/audit.entities.ts`, `packages/platform-persistence-typeorm/src/entities/composition.ts` и `tests/integration/migrations/0080-audit-parity.spec.ts`
- [x] T074 [US3] Реализовать append-only audit repository/writer поверх audit entity с exact scope, bases, refs, results и reason codes в `packages/platform-persistence-typeorm/src/audit.repository.ts` и `packages/platform-core/src/audit/audit-writer.ts`
- [x] T075 [P] [US3] Реализовать reusable Connector conformance kit и вторую `sample.record@1.0.0` test implementation в `packages/platform-testkit/src/connectors/conformance-kit.ts` и `packages/platform-testkit/src/connectors/alternate-sample-record.connector.ts`
- [x] T076 [P] [US3] Создать app-owned Mock Hub DataSource/entity array/migration runner/deterministic DB seed entrypoints/repository без import из runtime-composition, без FK из Core DB и с собственной role в `apps/mock-hub/src/persistence/data-source.ts`, `apps/mock-hub/src/persistence/entities.ts`, `apps/mock-hub/src/persistence/migrations/0001-mock-state.ts`, `apps/mock-hub/src/persistence/migration-runner.ts`, `apps/mock-hub/src/persistence/migrate.ts`, `apps/mock-hub/src/persistence/seed.ts` и `apps/mock-hub/src/persistence/mock-state.repository.ts`
- [x] T077 [US3] Реализовать Mock Hub typed endpoint, OpenAPI 3.1 document, deterministic reset/seed/scenario API, signed/replay webhook emitter fixtures, call ledger и effect ledger в `apps/mock-hub/src/mock-hub.controller.ts` и `apps/mock-hub/src/signed-webhook-emitter.ts`
- [x] T078 [US3] Реализовать `sample.mock` manifest/typed Connector, fake local secret resolution и normalized result/event mapping в `packages/connector-mock/src/manifest.ts` и `packages/connector-mock/src/sample-record.connector.ts`
- [x] T079 [US3] Отделить Core policy-denial harness и fake-model invalid-output harness от Mock Hub scenarios в `packages/platform-testkit/src/scenarios/policy-harness.ts` и `packages/platform-testkit/src/scenarios/model-harness.ts`
- [x] T080 [US3] Собрать configuration checkpoint для `AT-012`, `AT-013`, `AT-018` и config/preflight slices `AT-007`/`AT-014`; full Binding publication остаётся RED до T107–T108 в `tools/verification/us3-configuration-checkpoint.mts`

**Checkpoint:** Connection/Mapping/Profile chain опубликована, Binding candidate проходит exact validation/preflight, Mock contracts готовы; full Binding publication ожидает единственный platform-action path T107–T108.

---

## Phase 5 — US3 (часть B): durable command, events и Exact Approval

**Goal:** получить effectively-once external effect при at-least-once delivery и единственный exact Approval path для external/local effects.

**Independent test:** Dummy typed publish создаёт command, проходит policy/outbox/Broker/Mock, подтверждает Work Item одной транзакцией; retry, Redis loss и crash window дают один effect; approval drift либо concurrent claim не допускают лишний effect.

### Tests first

- [x] T081 [P] [US3] Написать `AT-017` для всех запрещённых command/Approval cross-state snapshots и terminal result mismatches в `tests/contract/acceptance/at-017-command-state-matrix.spec.ts`
- [x] T082 [P] [US3] Написать красный transaction test `mutation + command + request-idempotency + audit + outbox`: same actor/scope/key+same hash возвращает existing result, same key+different hash даёт security conflict без command/effect, одинаковые client keys разных Projects не схлопываются в `tests/integration/command-gateway-transaction.spec.ts`
- [x] T083 [P] [US3] Написать `AT-008`: `HELD|READY→ENQUEUED→DISPATCHED→CONFIRMED`, exact runtime Binding/Profile pins, worker restart, full Redis loss, stale lease и crash after effect before confirmation с одним stable effect в `tests/integration/acceptance/at-008-command-recovery.spec.ts`
- [x] T084 [P] [US3] Написать `AT-009`: raw signature/replay до parse, delivery/consumer dedupe, same-ID/different-hash conflict, pre-Project quarantine audit и gap reconciliation в `tests/integration/security/acceptance/at-009-webhook-security.spec.ts`
- [x] T085 [P] [US3] Написать `AT-011`: exact scope/action, initial/effect membership-entitlement-role-policy/skill (`NOT_APPLICABLE` явно), Binding/Profile refs, result/reason round-trip, DB append-only и redaction каждой write stage в `tests/integration/security/acceptance/at-011-audit-completeness.spec.ts`
- [x] T086 [P] [US3] Написать `AT-015`: queue release сохраняет `AUTHORIZED`; drift payload/target/expected-state/Binding/Profile/approver role-or-basis/expiry invalidates historical `APPROVED`; worker CAS consumes один раз; `NOT_REQUIRED` config drift даёт zero calls в `tests/integration/security/acceptance/at-015-approval-effect-gate.spec.ts`
- [x] T087 [P] [US3] Написать Redis-recovery половину `AT-016`: PostgreSQL восстанавливает `ENQUEUED` outbox после полной потери Redis; invalid-extension половину покрывает T037 в `tests/integration/acceptance/at-016-resilience.spec.ts`
- [x] T088 [P] [US3] Написать `AT-019`: Integration Administrator создаёт request/platform action, отличный Workspace Owner approves, exact CAS публикует Binding, replay идемпотентен, drift/revoke не публикует в `tests/integration/security/acceptance/at-019-binding-publication.spec.ts`

### Durable command implementation

- [x] T089 [US3] Реализовать Connector Command aggregate, explicit TypeORM command entity и domain validator, отклоняющий все `AT-017` snapshots в `packages/platform-core/src/commanding/connector-command.ts` и `packages/platform-persistence-typeorm/src/entities/connector-delivery.entities.ts`
- [x] T090 [US3] Реализовать actor/scope-scoped client request idempotency, persistence adapter и отдельный globally unique Gateway effect key в `packages/platform-core/src/commanding/idempotency.ts` и `packages/platform-persistence-typeorm/src/idempotency.repository.ts`
- [x] T091 [US3] Реализовать `NOT_REQUIRED` typed Command Gateway transaction `mutation + command + idempotency + audit + outbox`, durable source/target/initial authorization basis, exact resolved Binding/Profile refs и scoped command repository в initial `READY`; approval-required `HELD` branch добавить T105 в `packages/platform-core/src/commanding/command-gateway.ts`, `packages/platform-persistence-typeorm/src/command.repository.ts` и `packages/platform-persistence-typeorm/src/unit-of-work.ts`
- [x] T092 [US3] Реализовать PostgreSQL command-outbox repository/claim lease, enqueue/ACK semantics и visibility reconciliation в `packages/platform-persistence-typeorm/src/command-outbox.repository.ts` и `packages/platform-queue-bullmq/src/outbox-dispatcher.ts`
- [x] T093 [US3] Реализовать reusable job-envelope validator, scoped/versioned BullMQ envelope, authoritative worker reload и сравнение workspace/project/actor/correlation/causation payload с DB в `packages/platform-queue-bullmq/src/job-envelope-validator.ts` и `packages/platform-queue-bullmq/src/command-worker.ts`
- [x] T094 [US3] Реализовать live effect-time policy/classification/configuration gates, exact decision/reason/basis/version snapshot даже при deny/drift, execution lease и pre-adapter denial в `packages/platform-core/src/commanding/effect-gate.ts`
- [x] T095 [US3] Реализовать typed Connector Broker с exact pinned Binding/Profile/Connection/Mapping chain, передачей Connector только Gateway effect key и без `execute(any)` в `packages/platform-core/src/commanding/connector-broker.ts`
- [x] T096 [US3] Реализовать PostgreSQL republish после Redis loss и stale `DISPATCHED` lease recovery в `packages/platform-queue-bullmq/src/recovery-sweeper.ts`
- [x] T097 [US3] Определить transaction-aware confirmation port как published Core contract, re-export из Competency SDK, Dummy hook, composition map и TypeORM UoW для atomic `result + command + Work Item + exact Binding/Profile pins + Pack extension + Draft LINKED` без Core→Pack/SDK import в `packages/platform-contracts/src/extensions/confirmation-hook.ts`, `packages/competency-sdk/src/confirmation-hook.ts`, `packages/competency-dummy/src/application/on-record-confirmed.ts`, `packages/runtime-composition/src/extensions/confirmation-hooks.ts`, `packages/platform-persistence-typeorm/src/confirmation-unit-of-work.ts` и `packages/platform-core/src/work-management/confirm-operational-create.ts`
- [x] T098 [US3] Реализовать crash-window recovery через тот же pinned effect key, Connector lookup/confirmation strategy и retired-chain access в `packages/platform-core/src/commanding/effect-reconciliation.ts`
- [x] T099 [US3] Реализовать retry classification, backoff, terminal `DEAD` invariants и auditable failure codes в `packages/platform-core/src/commanding/retry-policy.ts`

### Inbound events and audit implementation

- [x] T100 [P] [US3] Реализовать full versioned Event Envelope и raw webhook signature/replay validation до parsing, durable webhook-inbox/quarantine repository, transport dedupe и Workspace-scoped rejection без fabricated human basis в `packages/platform-core/src/events/event-envelope.ts`, `packages/platform-core/src/events/webhook-ingress.ts` и `packages/platform-persistence-typeorm/src/webhook-inbox.repository.ts`
- [x] T101 [US3] Реализовать поверх T100 per-consumer durable inbox repository, duplicate/stale/conflict/gap handling, reconciliation и atomic projection/outbox transaction в `packages/platform-core/src/events/event-processing.ts` и `packages/platform-persistence-typeorm/src/event-consumer-inbox.repository.ts`
- [x] T102 [US3] Реализовать durable event-outbox repository/publisher и round-trip всех T100 envelope fields в `packages/platform-persistence-typeorm/src/event-outbox.repository.ts` и `packages/platform-core/src/events/event-outbox.ts`
- [x] T103 [US3] Подключить stage-complete audit с source process, entity/action, initial/effect bases, policy/skill/profile versions, normalized result hash/code и classification-aware serializers к Gateway, dispatcher, worker, Broker, confirmation и webhook paths в `packages/platform-core/src/audit/write-stage-auditor.ts`

### Exact Approval implementation

- [x] T104 [US3] Реализовать закрытые action-specific `EXTERNAL_COMMAND|PLATFORM_ACTION` subjects с единственной identity `actionKind + actionId`, initiator/approver, scope, target, full typed payload или semantic candidate hash, expected state, exact Binding/Profile refs, expiry/effect key, RFC 8785 hash и раздельные decision/effect states в `packages/platform-core/src/approval/approval.ts`
- [x] T105 [US3] Реализовать immutable scoped Approval persistence и расширить Gateway: approval-required command + exact subject создаются атомарно в `HELD`; external decision/live recheck переводит `HELD→READY` без consumption в `packages/platform-core/src/approval/external-command-approval.ts`, `packages/platform-core/src/commanding/command-gateway.ts`, `packages/platform-persistence-typeorm/src/entities/approvals-idempotency.entities.ts` и `packages/platform-persistence-typeorm/src/approval.repository.ts`
- [x] T106 [US3] Реализовать worker-side pre-effect transactional CAS consumption, concurrent-claim arbitration и historical `APPROVED + INVALIDATED` при любом T086 subject/authorization drift, expiry или revoke в `packages/platform-core/src/approval/effect-authorization.ts`
- [x] T107 [US3] Реализовать durable Binding request-publication как атомарные `PLATFORM_ACTION` + exact Approval, persistence port/TypeORM repository и candidate/header/current-published snapshot в `packages/platform-core/src/approval/binding-publication-action.ts`, `packages/platform-core/src/approval/platform-action-port.ts` и `packages/platform-persistence-typeorm/src/platform-action.repository.ts`
- [x] T108 [US3] Реализовать separation of duties и atomic one-time platform-action consumption + Binding publish + action completion CAS с idempotent replay: Integration Administrator не может self-approve, Workspace Owner обязан иметь current permission `project.admin` для decision `APPROVE` в `packages/platform-core/src/approval/binding-publication-policy.ts` и `packages/platform-core/src/approval/binding-publication-executor.ts`
- [x] T109 [US3] Реализовать `NOT_REQUIRED` pre-effect configuration drift как `FAILED/CONFIGURATION_DRIFT`, outbox `DEAD`, audit reason и zero Connector calls в `packages/platform-core/src/commanding/effect-gate.ts`

### Adapters and checkpoint

- [x] T110 [US3] Подключить Dummy typed publish action к Command Gateway и operation `publishSampleRecord` к Dummy controller, не позволяя Pack/клиенту выбирать Profile/Connection, в `packages/competency-dummy/src/application/publish-sample-record.ts` и `apps/api/src/extensions/dummy-pack.controller.ts`
- [x] T111 [US3] Реализовать command/Approval query/decision, Binding request-publication, raw-webhook и сразу раздельные PROJECT operational/WORKSPACE security audit routes с permission metadata в `packages/platform-runtime-nest/src/http/control-plane.controller.ts` и `packages/platform-runtime-nest/src/http/audit.controller.ts`
- [x] T112 [US3] Собрать worker и Mock Hub runtime composition с dispatcher/recovery loops, Mock Hub OpenAPI 3.1 snapshot и graceful shutdown в `apps/worker/src/app.module.ts`, `apps/mock-hub/src/main.ts` и `apps/mock-hub/openapi.generated.json`
- [x] T113 [US3] Добавить focused regression для crash-after-effect, tampered queue envelope, concurrent Approval и `NOT_REQUIRED` drift в `tests/integration/durable-effect-regression.spec.ts`
- [x] T114 [US3] Реализовать vertical-flow preview Dummy intake→typed effect→confirmation с `effectCount=1` и совпадением command/Work Item exact Binding/Profile pins с реально использованной chain в `tests/e2e/001-durable-preview.spec.ts`
- [x] T115 [US3] Собрать US3 checkpoint, запускающий `AT-007`–`AT-009` и `AT-011`–`AT-019` релевантные US3 gates в `tools/verification/us3-durable-checkpoint.mts`

**Checkpoint:** durable `NOT_REQUIRED` и approval-required flows работают; seed не используется как доказательство publication; US3 закрывается typed effect, recovery, events, audit и exact Approval.

**Evidence T081–T115:** `pnpm verify:us3` — 19 test files / 42 tests, `AT-007–AT-009`, `AT-011–AT-019`, real PostgreSQL Gateway/Binding/Approval authority и `effectCount=1`; полный `vitest run` — 38 test files / 82 tests; architecture, lint, typecheck и build gates зелёные.

---

## Phase 6 — US4: полная Workspace/Project isolation

**Goal:** закрыть isolation на всех появившихся surfaces, включая repository, artifact, webhook и async worker.

**Independent test:** same Workspace/different Project и different Workspace attempts с forged IDs, revoked grant, tampered job и classification mismatch отклоняются до repository/storage/Connector; разрешённый actor видит только свой scope.

### Tests first

- [x] T116 [US4] Написать `AT-010` как real-PostgreSQL matrix API/repository/config/artifact/worker для forged IDs, revoked grants, Project basis без entitlement, Workspace basis с fabricated entitlement и immutable historical classification в `tests/integration/security/acceptance/at-010-scope-isolation.spec.ts`

### Implementation

- [x] T117 [US4] Провести audit всех adapters, добавленных после foundation: запретить новые unscoped methods и проверить composite Workspace/Project FK на каждой child relation в `packages/platform-persistence-typeorm/src/scoped-repository-base.ts` и `tests/integration/composite-scope-constraints.spec.ts`
- [x] T118 [US4] Реализовать immutable classification catalog interpretation, retirement/new-taxonomy semantics и historical decision preservation в `packages/platform-core/src/identity-access/classification-policy.ts`
- [x] T119 [P] [US4] Реализовать generic artifact metadata/reference model, provider-neutral object storage port и scoped repository поверх explicit artifact entity в `packages/platform-core/src/artifacts/artifact-service.ts`, `packages/platform-persistence-typeorm/src/entities/work-and-artifacts.entities.ts` и `packages/platform-persistence-typeorm/src/artifact.repository.ts`
- [x] T120 [US4] Реализовать поверх T119 `getArtifactMetadata` и `streamArtifactContent` с повторным authorization recheck непосредственно перед stream и HTTP proxy без раскрытия locator в `packages/platform-runtime-nest/src/http/artifacts.controller.ts`
- [x] T121 [P] [US4] Провести adversarial coverage audit reusable T093 validator: tampered scope/actor/correlation/causation отклоняется до repository/Broker/Connector в `tests/integration/security/tampered-job-envelope.spec.ts`
- [x] T122 [US4] Провести adversarial test раздельных T111 Project operational и Workspace pre-Project SYSTEM security audit routes без fabricated human basis в `tests/integration/security/audit-query-scope.spec.ts`
- [x] T123 [US4] Заполнить explicit permission catalog и проверить coverage базового T035 interceptor на всех registry, work, configuration, command, approval, audit и artifact surfaces в `packages/platform-runtime-nest/src/auth/authorization-catalog.ts` и `tests/integration/security/authorization-surface-catalog.spec.ts`
- [x] T124 [US4] После T119–T123 выполнить async/artifact cross-scope regression matrix с assertions «adapter/stream не вызван» в `tests/integration/scope-isolation-surfaces.spec.ts`
- [x] T125 [US4] Реализовать browser/API isolation flow без доверия frontend visibility в `tests/e2e/001-isolation.spec.ts`
- [x] T126 [US4] Собрать US4 checkpoint с `AT-010`, composite-FK и deny-before-adapter evidence в `tools/verification/us4-isolation-checkpoint.mts`

**Checkpoint:** `SC-006` доказан для всех реализованных sync/async/storage surfaces, не только для UI и happy-path API.

---

## Phase 7 — US1: local composition и walking skeleton

**Goal:** собрать весь ранее реализованный critical path в одной воспроизводимой local-композиции без корпоративных систем и credentials.

**Independent test:** clean `local:up` поднимает все services, выдаёт backend-verified fake identity, проходит Dummy flow и artifact proxy; model unset/invalid/timeout не блокирует deterministic fallback; local физически не достигает production endpoint.

### Tests first

- [x] T127 [P] [US1] Написать `AT-001` clean-bootstrap/migrate/seed/reseed/readiness test всех обязательных services, `runtime.profile=local`, dependency states и RED storage-recreate/reset harness в `tests/e2e/acceptance/at-001-local-bootstrap.spec.ts` и `tests/integration/artifact-storage-persistence.spec.ts`
- [x] T128 [P] [US1] Написать `AT-002` для model unset/invalid/timeout и deterministic non-LLM Dummy fallback в `tests/e2e/acceptance/at-002-model-fallback.spec.ts`
- [x] T129 [P] [US1] Написать `AT-003`: visible persona switch, backend rejection forged role/scope, fake-secret denial outside local и container-level egress probe — API/worker достигают Mock Hub, но не public/corporate sink; non-local Connection отклоняется до persistence и при обходе effect boundary в `tests/integration/security/acceptance/at-003-local-security.spec.ts`

### Implementation

- [x] T130 [P] [US1] Реализовать HTTPS Fake IdP discovery/JWKS/token/key rotation с exact issuer validation, repository test CA, certificate SAN `fake-idp` и idempotent cert generation в `apps/fake-idp/src/main.ts`, `apps/fake-idp/src/oidc.controller.ts`, `infra/compose/certs/fake-idp-openssl.cnf` и `infra/compose/scripts/generate-fake-idp-cert.sh`
- [x] T131 [US1] Реализовать local-only backend persona exchange, принимающий только persona key и извлекающий роли/entitlements server-side в `apps/api/src/local/local-persona.controller.ts`
- [x] T132 [P] [US1] Реализовать deterministic fake model provider со своими `unset|invalid|timeout` scenarios и fallback вне Mock Hub в `packages/runtime-composition/src/model/deterministic-fake-model.ts`
- [x] T133 [P] [US1] Реализовать S3-compatible adapter, local endpoint allowlist, checksum/version handling и authenticated bucket initialization в `packages/runtime-composition/src/storage/s3-object-storage.adapter.ts` и `infra/compose/scripts/init-s3mock.sh`
- [x] T134 [US1] Реализовать versioned idempotent Core+Pack seed Workspace/Project/persona/extension/config/report/Binding/Approval/command/audit/artifact fixtures без импорта/изменения Mock Hub DB и без QA/vendor/corporate данных в `packages/runtime-composition/src/seed/local-seed.ts`
- [x] T135 [US1] Собрать local API/worker composition через T052 Core+Pack entity map, trusted Fake IdP test CA, Core/Dummy OpenAPI 3.1 documents и Core+Dummy-only migrate/seed entrypoints; Mock Hub остаётся app-owned T076 в `apps/api/src/app.module.ts`, `apps/worker/src/app.module.ts`, `apps/api/openapi.generated.json`, `packages/runtime-composition/src/persistence/entity-composition.ts`, `packages/runtime-composition/src/cli/migrate.ts` и `packages/runtime-composition/src/cli/seed.ts`
- [x] T136 [US1] Реализовать web shell с постоянным LOCAL banner, backend-issued persona/context switcher, Dummy intake/detail, command/Approval status и artifact download в `apps/web/src/App.tsx`
- [x] T137 [US1] Создать exact tag+digest Dockerfiles/Compose для PostgreSQL `18.6-bookworm`, Redis `8.2.9-bookworm` и Adobe S3Mock `5.1.0`; DAG `infra/fake-idp→core-migrate+mock-migrate→s3mock-init/probe→core-seed+mock-seed→apps` разделяет Core и app-owned Mock entrypoints; добавить separate DB roles, `/var/lib/postgresql`/S3 persistent volumes, Redis `noeviction` и optional OTel profile в `infra/compose/docker-compose.local.yml`, `infra/compose/docker/node-runtime.Dockerfile` и `infra/observability/otel-collector.yaml`
- [x] T138 [US1] Реализовать `local:up|status|logs|seed|down`, где `local:seed` отдельно запускает idempotent Core+Pack T134 и app-owned Mock T076 seeds, dependency-specific readiness, `runtime.profile` и компактный status report в `tools/local/cli.mts`
- [x] T139 [US1] Реализовать target-aware scenario CLI и безопасный project/profile/volume-checked `local:reset` с confirmation/CI flag в `tools/local/scenario.mts` и `tools/local/reset.mts`
- [x] T140 [US1] Реализовать физический production barrier через local-only composition, endpoint allowlist, fake-secret resolver и internal egress-deny network в `packages/runtime-composition/src/config/local-runtime-policy.ts` и `infra/compose/docker-compose.local.yml`
- [x] T141 [US1] Создать non-local composition/build assertions: нет Dummy/Mock/Fake IdP/fake model/local-admin routes и production targets не используют local credentials в `packages/runtime-composition/src/non-local.composition.ts`
- [x] T142 [US1] Реализовать Chromium trust wiring для repository Fake IdP CA и walkthrough с fake OIDC, Dummy submit, optional Approval, confirmation и artifact stream в `tests/e2e/support/fake-idp-trust.ts` и `tests/e2e/001-local-walking-skeleton.spec.ts`
- [x] T143 [US1] Реализовать repeatable `smoke:001` с PASS table, dependency readiness, `runtime.profile=local`, correlation trace и `effectCount=1` assertion в `tools/smoke/feature-001.mts`
- [x] T144 [US1] Довести созданный T127 storage harness до GREEN: marker object/version/checksum после container recreate, raw-object expiry и named-volume deletion только через reset в `tests/integration/artifact-storage-persistence.spec.ts`
- [x] T145 [US1] Собрать US1 checkpoint с `AT-001`, `AT-002`, `AT-003`, Playwright и smoke в `tools/verification/us1-local-checkpoint.mts`

**Checkpoint:** local walking skeleton воспроизводим одной документированной последовательностью; это ещё не финал, пока не пройдены общие hardening gates.

---

## Phase 8 — Hardening, traceability и handoff

**Цель:** доказать все acceptance/success criteria на clean environment и зафиксировать стабильный интерфейс команды.

- [x] T146 [P] Реализовать fresh/repeat-noop/current-1-upgrade/failed-recovery matrix полного composed Core `0001→0080` + Dummy `1000` DataSource и отдельного Mock Hub DataSource на PostgreSQL 17/18 в `tests/integration/migration-matrix.spec.ts`
- [x] T147 [P] Валидировать все positive/negative contract examples, 31 schema и immutable local refs тем же runtime registry в `tests/contract/contract-registry-completeness.spec.ts`
- [x] T148 Проверить OpenAPI `3.1.0`, все 48 operation IDs во всех Core/Dummy/Mock Hub documents, RFC 9457/headers/statuses и generated snapshots drift в `tests/contract/openapi-drift.spec.ts`
- [x] T149 [P] Проверить AsyncAPI и full Event Envelope round-trip, включая envelope/producer versions, recorded time и exact payload schema ref в `tests/contract/asyncapi-event-roundtrip.spec.ts`
- [x] T150 [P] Добавить architecture scan implementation paths на forbidden QA/vendor semantics, Pack↔Connector imports, runtime downloads/eval/import URLs и Core branches по logical role в `tests/architecture/feature-001-hard-boundaries.spec.ts`
- [x] T151 Проверить Core-only и non-local production builds без Dummy/Mock/Fake components и local admin routes в `tests/architecture/non-local-composition.spec.ts`
- [x] T152 [P] Доказать `SC-007`: параметризованный conformance test каждой typed Connector write operation проверяет policy, stable effect key, outbox, audit и normalized result для обеих implementations в `tests/contract/all-connector-writes.spec.ts`
- [x] T153 [P] Реализовать автоматический scan logs/audit/problem responses/OTel trace+metric attributes на secret/token/raw payload/object locator и DB-level append-only mutation attempts в `tests/integration/security/secret-and-audit-scan.spec.ts`
- [x] T154 [P] Собрать resilience suite для invalid manifest, 401/403/429/5xx/timeout/schema drift, duplicate/out-of-order/gap, Redis wipe, worker restart, stale lease, crash window и revoked authorization в `tests/integration/feature-001-resilience.spec.ts`
- [x] T155 [P] Повторно прогнать `AT-017` и domain/contract negative state matrix через public serialization boundaries в `tests/contract/command-state-public-boundary.spec.ts`
- [x] T156 Реализовать полный Playwright acceptance flow для всех personas и разрешённых/запрещённых действий в `tests/e2e/001-acceptance.spec.ts`
- [x] T157 Собрать documented `smoke:001` clean/repeat/restart/Redis-loss/artifact сценарии и machine-readable report в `tools/verification/smoke-001-gate.mts`
- [x] T158 Подключить стабильные root commands `check`, `test:unit`, `test:architecture`, `test:integration`, `test:contract`, `test:e2e:001`, `smoke:001` к Nx graph в `package.json`
- [x] T159 Расширить provider-neutral CI entrypoint matrix для Node 24, PostgreSQL 17/18, contract/architecture/security/integration/Playwright gates и machine-readable reports в `tools/ci/feature-001.mts`
- [x] T160 Обновить только подтверждённые реализацией prerequisites, команды, walkthrough и troubleshooting в `README.md` и `specs/001-extension-kernel-local-skeleton/quickstart.md`
- [x] T161 Реализовать machine-checkable trace audit `FR-001…FR-035`, `SC-001…SC-007`, `AT-001…AT-019` → tests/tasks в `tools/verification/feature-001-trace.mts`
- [x] T162 Сформировать success-criteria report с доказательствами `SC-001…SC-007` и нулём незакрытых constitutional exceptions в `artifacts/verification/feature-001-success-criteria.md`
- [x] T163 Выполнить финальный clean bootstrap и единый Feature 001 gate всех `AT-001…AT-019`; сохранить machine-readable результат в `artifacts/verification/feature-001-gate.json`

**Checkpoint:** Feature 001 Done только после зелёных T146–T163 и отсутствия незакрытых scope/security/contract замечаний.

---

## Dependencies и execution order

### Phase dependencies

```text
Phase 1 Setup
  └── Phase 2 Contracts + scope + persistence foundation
        └── Phase 3 US2 Extension/Dummy
              └── Phase 4 US3 Configuration + Mock contracts
                    └── Phase 5 US3 Durable delivery + Exact Approval
                          └── Phase 6 US4 Full isolation closure
                                └── Phase 7 US1 Local composition
                                      └── Phase 8 Hardening
```

### Critical task dependencies

- T017–T019 depend on T001–T011; all runtime DTOs depend on the generated contract artifact from T017.
- Migrations are strictly ordered: T023 → T024 → T025 → T026 → T027 → T047 (`0050`) → T048 (`0060`) → T049 (`0070`) → T050 (`0080`) → T052 (`1000`). T071–T073 добавляют entities/parity, но не меняют уже применённые files; отдельный Mock Hub DataSource начинается T076. Migration tasks нельзя помечать `[P]` или регистрировать задним числом.
- T044–T046 depend on T017–T020 and T026; T052–T055 depend on T041–T051, причём T052 нельзя применять до полного Core chain T050.
- T063–T070 depend on T027, T043 and T044–T046; Profile follows Connection/Mapping, Binding follows Profile.
- T091 depends on T089–T090 and T073–T074; T092–T099 follow the persisted Gateway transaction.
- T093 cannot call Broker before authoritative reload and envelope comparison; T094–T095 must complete before any Connector invocation.
- T104 approval subject work may begin after T019/T071, but T105–T109 cannot complete before command state/effect-gate invariants T089–T099.
- T107–T108 are the only runtime Binding publication path; T069 may expose validation/resolution but not direct publication mutation.
- T116–T126 close US4 only after every sync/async/storage surface exists; foundation tasks T014–T016 and T028–T035 remain mandatory prerequisites throughout.
- T134–T143 depend on all owning modules. Seed and Compose are integration artifacts, not substitutes for runtime-path tests.
- T148 must run after all controllers are implemented; T158–T163 are sequential final aggregation tasks.

### Safe parallel groups

- После T002: T003, T004 и T005.
- После T007/T017: T019 и T020; T021 следует за публичными primitives T020.
- В Phase 3 после SDK contracts: T042 и T043; затем T052 создаёт Pack model/manifest, после неё T053 и T055 могут идти параллельно, а Core HTTP task T054 независимо следует за T051.
- В Phase 4 после T064: Connection/Mapping validation, conformance implementation и Mock Hub persistence may proceed in parallel; central schema/migration/composition indexes remain serialized.
- В Phase 5 после command contracts: outbound T092–T099 и Event Envelope/webhook ingress T100 могут идти параллельно; T101–T102 следуют за T100, обе ветки сходятся в T103.
- В Phase 6: artifact branch T119→T120 и adversarial envelope audit T121 могут идти параллельно после T116/T093; T124 следует за T119–T123.
- В Phase 7 после config contracts: Fake IdP T130, fake model T132, S3 adapter T133 and web shell T136 can proceed in parallel; seed/Compose tasks remain after their providers.

---

## Acceptance trace

| Acceptance | Primary executable task | Основные implementation tasks |
|---|---:|---|
| AT-001 | T127 | T130–T145 |
| AT-002 | T128 | T132, T134–T145 |
| AT-003 | T129 | T131, T140–T141, T154 |
| AT-004 | T036 | T041, T044–T046, T054 |
| AT-005 | T039 | T006, T032–T033, T046, T150–T151 |
| AT-006 | T040 | T043, T063, T075, T152 |
| AT-007 | T058 | T063, T068–T070, T107–T108, T115 |
| AT-008 | T083 | T089–T099, T112–T114 |
| AT-009 | T084 | T100–T103 |
| AT-010 | T116 | T117–T126 |
| AT-011 | T085 | T034, T073–T074, T103, T152–T153 |
| AT-012 | T062 | T076–T079 |
| AT-013 | T059 | T075, T078 |
| AT-014 | T060 | T064–T070, T098, T107–T108, T115 |
| AT-015 | T086 | T094, T104–T109, T113 |
| AT-016 | T037 + T087 | T045, T092, T096, T154 |
| AT-017 | T081 | T089, T113, T155 |
| AT-018 | T061 | T043, T063, T067–T068, T075 |
| AT-019 | T088 | T104–T108, T111, T113 |

## Requirements trace

| Requirement group | Task coverage |
|---|---|
| FR-001…FR-009 — static extension kernel | T006, T017–T019, T032–T033, T036–T056, T150–T151 |
| FR-010…FR-015 — identity/scope/authorization | T014–T016, T020–T021, T024–T030, T035, T116–T126 |
| FR-016…FR-021 — commands/events/audit | T047, T049–T050, T072–T074, T081–T103, T110–T115, T152–T155 |
| FR-022…FR-026 — typed Connector/configuration | T040, T043, T057–T080, T095, T152 |
| FR-027…FR-030 — local-first runtime | T062, T076–T079, T127–T145, T154 |
| FR-031…FR-032 — exact Binding chain/opaque role | T057–T070, T107–T108, T116 |
| FR-033 — runtime exact Binding/Profile pins | T060, T083, T085, T091, T095, T097–T098, T114 |
| FR-034…FR-035 — Exact Approval | T019, T048, T071, T081, T086, T088, T104–T109, T155 |
| SC-001 — clean local bootstrap | T127, T137–T145, T156–T163 |
| SC-002…SC-003 — extensibility/boundaries | T039–T056, T150–T151 |
| SC-004 — Connector substitution | T040, T059, T075, T078, T152 |
| SC-005 — no duplicate effect after restart | T083, T092–T099, T113–T114, T154 |
| SC-006 — hard isolation | T014–T016, T028–T030, T116–T126 |
| SC-007 — audited typed writes | T074, T085, T103, T152–T153 |

## Delivery strategy

1. **Extension-kernel checkpoint:** завершить T001–T056. Результат доказывает расширяемость Core, но не external flow.
2. **Configuration checkpoint:** завершить T057–T080. Результат даёт опубликованную Connection/Mapping/Profile chain, publishable Binding preflight и заменяемые Connectors; actual Binding publication закрывается T107–T108.
3. **Vertical-flow preview:** завершить T081–T115. Результат доказывает durable typed effect, recovery и Approval без полного local UX.
4. **Security closure:** завершить T116–T126. Результат распространяет isolation на все surfaces.
5. **Local walking skeleton:** завершить T127–T145. Результат доступен разработчику одной local-командой.
6. **Feature 001 Done:** завершить T146–T163 и получить зелёный aggregate gate.

## Definition of Done

- Все T001–T163 отмечены `[x]`; пропуски имеют отдельно согласованный scope change, а не молчаливый skip.
- Все `AT-001…AT-019` имеют отдельный зелёный executable test, перечисленный в Acceptance trace.
- Все `FR-001…FR-035` и `SC-001…SC-007` проходят machine-checkable trace без orphan requirements/tests.
- `pnpm check`, `pnpm test:unit`, `pnpm test:architecture`, `pnpm test:integration`, `pnpm test:contract`, `pnpm test:e2e:001` и `pnpm smoke:001` зелёные на clean environment.
- PostgreSQL 17/18 migration matrix, Redis-loss recovery, crash-after-effect recovery, S3Mock persistence/reset и full isolation matrix зелёные.
- Core build не содержит Dummy/Mock/QA/vendor semantics; non-local build не содержит local fake components/routes/credentials.
- Audit append-only, redacted и полный для 100% typed writes; raw secrets/payloads/object locators не обнаружены.
- Jira, GitLab, Mattermost, Hermes, corporate VPN, production credentials и real model provider не требуются для Feature 001 acceptance.
