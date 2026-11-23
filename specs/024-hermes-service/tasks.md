# Tasks: Hermes service
**Input**: spec.md, plan.md, research.md, data-model.md, contracts/

## Phase 1: Setup
- [x] T001 Подготовить Spec Kit artifacts и проверить ignores в specs/024-hermes-service/ и .gitignore/.dockerignore.

## Phase 2: Foundation
- [x] T002 Создать версионированный контракт и валидацию в packages/runtime-composition/src/hermes/service-contract.ts.

## Phase 3: US1 — отдельный сервис (P1)
**Goal**: отдельно запустить и проверить Hermes. **Independent Test**: HTTP auth/health/limits и restart.
- [x] T003 [US1] Написать HTTP contract tests в tests/integration/hermes-service/http.spec.ts.
- [x] T004 [US1] Реализовать host/config в apps/hermes/src/ и packages/runtime-composition/src/hermes/service-config.ts, зарегистрировать package/project/lockfile и tools/architecture/dependency-rules.mts.
- [x] T005 [US1] Включить Hermes в infra/deploy/compose.workspace.yml и infra/compose/docker-compose.local.yml.

## Phase 4: US2 — LLM и проект (P1)
**Goal**: модель готовит карточку, человек создаёт проект. **Independent Test**: fixture model, API dialogue и повтор confirm.
- [x] T006 [US2] Написать model boundary tests в tests/unit/hermes-service/model.spec.ts.
- [x] T007 [US2] Реализовать ограниченный adapter в packages/runtime-composition/src/hermes/project-model.ts.
- [x] T008 [US2] Подключить HTTP client в packages/runtime-composition/src/hermes/service-client.ts и двухфазную обработку в apps/api/src/extensions/onboarding/project-dialogue.controller.ts.
- [x] T009 [US2] Проверить реальный Hermes flow и повторную авторизацию в tests/integration/hermes-service/dialogue.spec.ts; добавить /projects/hermes в apps/api/src/workspace-main.ts.

## Phase 5: US3 — отказы (P2)
**Goal**: конечное ожидание, локальный резерв, сохранённая история. **Independent Test**: timeout/invalid output/service down.
- [x] T010 [US3] Проверить timeout/abort/schema/hash/secret failures в tests/unit/hermes-service/ и tests/integration/hermes-service/.
- [x] T011 [US3] Добавить зависимость readiness в apps/api/src/workspace/workspace.module.ts и обязательную конфигурацию в apps/api/src/workspace-main.ts.

## Phase 6: Polish
- [x] T012 Обновить README.md, docs/deployment/initial-qa-workspace.md и docs/deployment/hermes-service.md, добавить infra/deploy/hermes.config.example.json.
- [x] T013 Выполнить typecheck/lint/architecture, feature regression и container smoke; записать фактические результаты в specs/024-hermes-service/validation.md.

## Dependencies & Execution Order
T001 → T002 → US1 → US2 → US3 → docs/validation. US2 модель тестируется независимо HTTP fixture; API зависит от US1. US3 зависит от US1/US2.
## Parallel Examples
US1: HTTP contract и compose config после контракта; US2: model tests и API preparation в разных файлах; US3: timeout тесты и readiness wiring. Реализация идёт последовательно, исследование границ выполнено отдельным агентом по speckit-plan.
## Implementation Strategy
Сначала stateless сервис и health/auth, затем модель и реальный API, затем outage и regression. Всего 18 задач: US1 3, US2 4, US3 2, US4 5, setup/foundation/polish 4. Все ID/checkbox/paths проверены. Hooks отсутствуют.

## Phase 7: US4 — Mattermost и QA-запросы (P1, steering пользователя)
- [x] T014 [US4] Добавить explicit context и QA proposal contract/model/client в packages/runtime-composition/src/hermes/project-context.ts.
- [x] T015 [US4] Добавить scoped slash configuration и API в apps/api/src/extensions/hermes/, использовать existing identity/RBAC/drafts/idempotency.
- [x] T016 [US4] Проверить native slash HTTP, wrong project/identity, revocation и duplicate draft в tests/integration/hermes-service/mattermost.spec.ts.
- [x] T017 [US4] Документировать /hermes ask/test, bot role, configuration и отсутствие RAG в docs/deployment/hermes-service.md.
Dependency: T014 → T015 → T016; T017 после T015. US4 дополняет, не заменяет US1—3.

- [x] T018 [US4] Реализовать native /hermes preview/confirm с exact signature и CommandGateway в apps/api/src/extensions/hermes/mattermost-confirmation.ts, проверить одноразовую Jira-команду.
