# Tasks: Упрощение первой версии без Redis и S3

**Input**: Design documents from `/specs/010-remove-redis-s3/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Автоматические проверки обязательны по FR-012 и пишутся до соответствующей реализации.

**Organization**: Tasks сгруппированы по user stories и сохраняют независимые критерии приёмки.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: задача может выполняться параллельно в независимых файлах
- **[Story]**: user story из spec.md

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Зафиксировать новую архитектурную границу и проверяемый feature entrypoint.

- [x] T001 Добавить команды `test:010` и `verify:010` в `package.json`
- [x] T002 [P] Добавить статический feature gate отсутствия Redis/S3 в `tools/verification/feature-010-gate.mts`
- [x] T003 [P] Добавить architecture contract для v1 dependency/configuration boundary в `tests/architecture/010-v1-infrastructure-boundaries.spec.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Удалить общие runtime dependencies и сформировать единый PostgreSQL/GitLab-only профиль.

**⚠️ CRITICAL**: User story work начинается после удаления общих dependency/configuration branches.

- [x] T004 Удалить `packages/platform-queue-bullmq/` и его mappings из `tools/architecture/dependency-rules.mts`
- [x] T005 Удалить BullMQ catalog/build entries из `pnpm-workspace.yaml` и обновить `pnpm-lock.yaml`
- [x] T006 Сократить runtime environment до обязательных v1 inputs в `packages/runtime-composition/src/config/environment.ts` и `packages/runtime-composition/src/index.ts`
- [x] T007 Удалить Redis/S3 deployment policy branches в `packages/runtime-composition/src/pilot/deployment-config.ts`, `packages/runtime-composition/src/config/local-runtime-policy.ts` и `packages/runtime-composition/src/security/local-security.ts`

**Checkpoint**: Production package graph и общий runtime contract больше не содержат Redis/S3 providers.

---

## Phase 3: User Story 1 — Запуск без лишней инфраструктуры (Priority: P1) 🎯 MVP

**Goal**: API, worker и web запускаются без Redis/S3, а фоновая работа восстанавливается из PostgreSQL.

**Independent Test**: Compose service list и readiness не содержат Redis/S3; worker restart test сохраняет command и не дублирует external effect.

### Tests for User Story 1

- [x] T008 [P] [US1] Подключить существующий PostgreSQL restart-recovery/idempotency regression `tests/integration/durable-command-delivery-postgres.spec.ts` к `test:010`
- [x] T009 [P] [US1] Добавить readiness contract без Redis/S3 в `tests/contract/010/v1-readiness.spec.ts`

### Implementation for User Story 1

- [x] T010 [US1] Удалить Redis/S3 probes и dependency keys из `packages/runtime-composition/src/bootstrap/local-readiness.ts` и `packages/platform-runtime-nest/src/health/readiness.service.ts`
- [x] T011 [US1] Удалить `redis`, `s3mock`, `s3mock-init`, связанные env/depends/volumes из `infra/compose/docker-compose.local.yml` и удалить `infra/compose/scripts/init-s3mock.sh`
- [x] T012 [US1] Удалить S3 initialization path из `packages/runtime-composition/src/cli/s3-init.ts`, `packages/runtime-composition/src/cli/seed.ts` и `tools/local/pilot-cli.mts`
- [x] T013 [US1] Актуализировать local/scenario tooling без Redis/S3 в `tools/local/queue-scenario.mts`, `tools/local/queue-scenario-catalog.mts` и `tools/local/tcp-edge-proxy.mts`

**Checkpoint**: User Story 1 проходит независимо через `test:010` и Compose inventory.

---

## Phase 4: User Story 2 — QA evidence без object storage (Priority: P1)

**Goal**: Metadata-only manual QA и GitLab-hosted automated artifacts работают без upload storage.

**Independent Test**: Manual QA flow завершает manifest/review/verdict без attachments; upload routes отсутствуют; GitLab artifact read не имеет S3 fallback.

### Tests for User Story 2

- [x] T014 [P] [US2] Добавить contract assertions отсутствия attachment upload API в `tests/contract/010/qa-evidence-without-uploads.spec.ts`
- [x] T015 [P] [US2] Добавить metadata-only manual QA integration flow в `tests/integration/010/manual-evidence-without-attachments.spec.ts`
- [x] T016 [P] [US2] Добавить GitLab-only artifact routing regression в `tests/integration/010/gitlab-only-artifacts.spec.ts`

### Implementation for User Story 2

- [x] T017 [US2] Удалить attachment endpoints/wiring из `apps/api/src/extensions/qa-evidence.controller.ts`, `apps/api/src/app.module.ts` и удалить `apps/api/src/local/local-qa-evidence-uploads.ts`
- [x] T018 [US2] Удалить manual upload runtime из `packages/runtime-composition/src/pilot/evidence-uploads.ts`, `packages/runtime-composition/src/pilot/evidence-upload-storage.ts` и exports в `packages/runtime-composition/src/index.ts`
- [x] T019 [US2] Удалить S3 implementations/fallback из `packages/runtime-composition/src/storage/`, `packages/runtime-composition/src/non-local.composition.ts` и `packages/runtime-composition/src/pilot/composition.ts`
- [x] T020 [US2] Удалить S3 artifact fixtures из `packages/runtime-composition/src/seed/local-seed.ts` и `apps/api/src/local/local-walking-skeleton.controller.ts`
- [x] T021 [US2] Пересобрать публичные contract snapshots в `apps/api/openapi.generated.json`, `apps/mock-hub/openapi.generated.json` и `packages/platform-contracts/src/generated/schema-documents.ts`

**Checkpoint**: User Story 2 завершается без storage bytes и сохраняет GitLab scope/checksum/provenance.

---

## Phase 5: User Story 3 — Однозначная документация и поставка (Priority: P2)

**Goal**: Актуальные product/deployment материалы требуют только PostgreSQL и GitLab-backed artifacts.

**Independent Test**: Feature gate не находит обязательных Redis/S3 inputs или runtime implementations в текущем контракте и документации.

### Tests for User Story 3

- [x] T022 [P] [US3] Расширить documentation/config assertions в `tests/architecture/010-v1-infrastructure-boundaries.spec.ts`

### Implementation for User Story 3

- [x] T023 [P] [US3] Добавить ADR решения в `docs/adr/0009-v1-without-redis-s3.md`
- [x] T024 [P] [US3] Обновить deployment contract и env template в `docs/deployment/README.md`, `docs/deployment/configuration.md`, `docs/deployment/templates/runtime.env.example` и `docs/deployment/templates/deployment-passport.md`
- [x] T025 [P] [US3] Обновить текущую product/architecture границу в `README.md`, `docs/agentic-workspace-platform-master-spec-v2.md`, `docs/architecture/README.md` и `docs/external-systems-integration-request-v2.md`
- [x] T026 [P] [US3] Обновить актуальные pilot/runbook инструкции в `docs/runbooks/pilot-deployment-checklist.md`, `docs/runbooks/pilot-development.md`, `docs/runbooks/pilot-infrastructure.md`, `docs/runbooks/pilot-integration-intake.md`, `docs/runbooks/pilot-recovery.md` и `docs/runbooks/gitlab-pipeline.md`
- [x] T027 [US3] Обновить Mermaid sources и сгенерированные architecture artifacts в `docs/architecture/diagrams/`, `docs/architecture/architecture.html`, `docs/architecture/inventory.md`, `docs/architecture/inventory.json` и `docs/architecture/inventory.html`

**Checkpoint**: User Story 3 даёт один непротиворечивый infrastructure contract для v1.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Удалить оставшиеся obsolete references и доказать полную готовность.

- [x] T028 Удалить или переписать obsolete Redis/S3 tests/tooling, найденные feature gate, в `tests/` и `tools/verification/`
- [x] T029 Выполнить `pnpm contracts:build`, `pnpm contracts:openapi`, `pnpm architecture`, `pnpm typecheck`, `pnpm test:010` и `pnpm verify:010`
- [x] T030 Проверить процедуру и зафиксировать фактические результаты в `specs/010-remove-redis-s3/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: без зависимостей.
- **Foundational (Phase 2)**: зависит от Setup и блокирует реализацию stories.
- **US1 (Phase 3)** и **US2 (Phase 4)**: зависят от Foundational; после него могут выполняться параллельно.
- **US3 (Phase 5)**: зависит от стабилизированного runtime/API результата US1 и US2.
- **Polish (Phase 6)**: зависит от всех выбранных stories.

### User Story Dependencies

- **US1 (P1)**: независимый минимальный продуктовый инкремент после Phase 2.
- **US2 (P1)**: независима от US1 в QA domain, но использует общий v1 configuration profile из Phase 2.
- **US3 (P2)**: документирует фактическую границу, сформированную US1 и US2.

### Parallel Opportunities

- T002 и T003 могут выполняться параллельно после T001.
- T008 и T009 независимы; T014–T016 независимы.
- После Phase 2 команды US1 и US2 могут работать параллельно.
- T023–T026 меняют разные документы и могут выполняться параллельно.

## Parallel Examples

### User Story 1

```text
Task T008: PostgreSQL restart-recovery regression
Task T009: readiness contract without Redis/S3
```

### User Story 2

```text
Task T014: API absence contract
Task T015: metadata-only manual flow
Task T016: GitLab-only artifact routing
```

### User Story 3

```text
Task T023: ADR
Task T024: deployment contract
Task T025: product/architecture text
Task T026: runbooks
```

## Implementation Strategy

### MVP First

1. Выполнить Setup и Foundational.
2. Реализовать US1.
3. Проверить запуск/readiness/recovery без Redis/S3.
4. Затем добавить US2 и удалить unsupported attachment surface.

### Incremental Delivery

1. Сначала очистить production dependency/configuration graph.
2. Затем получить запускаемый PostgreSQL-only runtime.
3. Затем сузить evidence byte ownership до GitLab.
4. После стабилизации runtime обновить документы и сгенерированные artifacts.
5. Завершить общим feature gate и quickstart evidence.

## Validation Summary

- Всего задач: 30.
- Setup: 3; Foundational: 4; US1: 6; US2: 8; US3: 6; Polish: 3.
- Independent criteria заданы для каждой из трёх user stories.
- Все задачи соответствуют checklist format и содержат конкретные file paths или команды.
