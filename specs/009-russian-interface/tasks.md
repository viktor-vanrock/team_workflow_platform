# Tasks: Русский интерфейс

**Input**: Design documents from `/specs/009-russian-interface/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ui-copy.md, quickstart.md

**Tests**: Спецификация требует автоматической проверки основных контуров и остаточного английского текста, поэтому тестовые задачи обязательны.

**Organization**: Tasks are grouped by user story and executed in dependency order.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Зафиксировать общий словарь и тестовую границу до изменения компонентов.

- [X] T001 Создать failing unit-тест русского formatter, fallback и сохранённых терминов в tests/unit/009/ui-localization.spec.ts
- [X] T002 Создать failing архитектурный аудит пользовательских строк и allowlist в tests/architecture/ui-localization.spec.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Единая presentation-only локализация машинных значений.

- [X] T003 Реализовать русский словарь, formatRuUiValue, formatRuDateTime и безопасный fallback в packages/platform-ui/src/localization/ru.ts
- [X] T004 Экспортировать localization helpers из packages/platform-ui/src/index.ts и подтвердить unit-тестом tests/unit/009/ui-localization.spec.ts

**Checkpoint**: Общий formatter готов; wire values и неизвестные значения остаются неизменными.

---

## Phase 3: User Story 1 - Основные экраны на русском языке (Priority: P1) 🎯 MVP

**Goal**: Все статические элементы основного web/QA интерфейса отображаются по-русски, устойчивые термины сохранены.

**Independent Test**: SSR/browser-проверки находят русские заголовки, поля и действия в shell, QA, Project и Pilot экранах; архитектурный аудит не находит обычных английских UI-фраз.

### Tests for User Story 1

- [X] T005 [P] [US1] Обновить shell/QA browser-ожидания русского текста в tests/e2e/001-local-walking-skeleton.spec.ts, tests/e2e/acceptance/002-at-014-manual-walking-skeleton.spec.ts, tests/e2e/acceptance/003-jira-browser-journey.spec.ts, tests/e2e/acceptance/004-mattermost-browser-journey.spec.ts, tests/e2e/acceptance/005-gitlab-human-review-browser.spec.ts и tests/e2e/acceptance/006-queue-live-browser.spec.ts
- [X] T006 [P] [US1] Обновить Project/Pilot browser и SSR ожидания в tests/e2e/007/, tests/integration/007/us4-evidence-web.spec.ts и tests/e2e/008/

### Implementation for User Story 1

- [X] T007 [US1] Установить русскую локаль документа и перевести web-shell/preview в apps/web/index.html, apps/web/src/App.tsx и apps/web/src/routes/work-item-detail.tsx
- [X] T008 [P] [US1] Перевести Project routes в apps/web/src/routes/projects/onboarding.tsx, apps/web/src/routes/projects/project-catalog.tsx и apps/web/src/routes/projects/evidence.tsx
- [X] T009 [P] [US1] Перевести Pilot routes в apps/web/src/routes/pilot/readiness.tsx, apps/web/src/routes/pilot/dead-letters.tsx, apps/web/src/routes/pilot/pilot-run.tsx и apps/web/src/routes/pilot/recovery.tsx
- [X] T010 [P] [US1] Перевести QA route shells в apps/web/src/routes/qa/automated-session.tsx, apps/web/src/routes/qa/hermes-proposals.tsx, apps/web/src/routes/qa/mattermost-intake.tsx, apps/web/src/routes/qa/notification-health.tsx, apps/web/src/routes/qa/queue-workspace.tsx и apps/web/src/routes/qa/queue.tsx
- [X] T011 [US1] Перевести QA intake/planning/manual UI в packages/competency-qa/src/ui/intake.tsx, packages/competency-qa/src/ui/confirmed-backlog.tsx, packages/competency-qa/src/ui/contribution.tsx, packages/competency-qa/src/ui/readiness-panel.tsx, packages/competency-qa/src/ui/request-input-history.tsx, packages/competency-qa/src/ui/required-session-plan.tsx, packages/competency-qa/src/ui/session-planner.tsx и packages/competency-qa/src/ui/manual-session-executor.tsx
- [X] T012 [US1] Перевести QA automation/operations UI в packages/competency-qa/src/ui/automated-session.tsx, packages/competency-qa/src/ui/automated-session-executor.tsx, packages/competency-qa/src/ui/candidate-intake.tsx, packages/competency-qa/src/ui/hermes-proposals.tsx, packages/competency-qa/src/ui/notification-health.tsx и packages/competency-qa/src/ui/operational-authority-workspace.tsx
- [X] T013 [US1] Перевести QA evidence/findings/queue/onboarding UI в packages/competency-qa/src/ui/evidence-integrity.tsx, packages/competency-qa/src/ui/evidence-review.tsx, packages/competency-qa/src/ui/findings-defects.tsx, packages/competency-qa/src/ui/project-onboarding.tsx, packages/competency-qa/src/ui/queue-item.tsx, packages/competency-qa/src/ui/queue-workspace.tsx и packages/competency-qa/src/ui/verdict-completion.tsx
- [X] T014 [P] [US1] Перевести общие Platform UI компоненты в packages/platform-ui/src/integration-health/delivery-health.tsx, packages/platform-ui/src/operational-authority/operational-authority-panel.tsx и packages/platform-ui/src/operational-authority/operational-conflict-panel.tsx
- [X] T015 [P] [US1] Перевести отображаемые DoR remediation без изменения кодов правил в packages/competency-qa/src/rules/dor-rules.v1.ts

**Checkpoint**: Основные экраны и доступные имена статического UI полностью русскоязычны.

---

## Phase 4: User Story 2 - Русская обратная связь (Priority: P1)

**Goal**: Загрузка, успех, пустые состояния, предупреждения и контролируемые ошибки понятны на русском языке.

**Independent Test**: Для shell, QA, Project и Pilot маршрутов вызвать загрузку, успешный и ошибочный результат; русская сводка сохраняет HTTP status/error code.

### Tests for User Story 2

- [X] T016 [US2] Добавить/обновить проверки русских loading/success/error/empty состояний в tests/unit/005/automated-session-executor-ui.spec.ts, tests/e2e/005-us4-outage-recovery.spec.ts и tests/e2e/008/pilot-readiness-browser.spec.ts

### Implementation for User Story 2

- [X] T017 [US2] Локализовать контролируемые уведомления и ошибки web-shell/routes и отделить severity от английского текста в apps/web/src/App.tsx и apps/web/src/routes/
- [X] T018 [US2] Локализовать контролируемые уведомления, ошибки и empty states QA/Platform UI в packages/competency-qa/src/ui/ и packages/platform-ui/src/

**Checkpoint**: Все управляемые клиентом сообщения обратной связи русскоязычны; динамическая диагностика сохранена.

---

## Phase 5: User Story 3 - Русские подписи состояний (Priority: P2)

**Goal**: Известные машинные значения имеют единообразные русские подписи без изменения контрактных данных.

**Independent Test**: SSR-компоненты отображают русские подписи известных состояний, неизвестное значение выводится дословно, а callbacks продолжают получать исходные enum-коды.

### Tests for User Story 3

- [X] T019 [P] [US3] Обновить status-label ожидания в tests/e2e/006/queue-browser.spec.ts, tests/e2e/006/us3-triage-controls.spec.ts, tests/e2e/006/us4-capacity-expedite.spec.ts и tests/e2e/006/us5-sla-transparency.spec.ts
- [X] T020 [P] [US3] Обновить automation/onboarding status-label ожидания в tests/unit/005/automated-session-executor-ui.spec.ts, tests/e2e/007/us1-manual-onboarding-ui.spec.ts и tests/e2e/007/us2-full-qa-ui.spec.ts

### Implementation for User Story 3

- [X] T021 [US3] Применить formatRuUiValue к известным статусам, типам и reason-кодам в apps/web/src/App.tsx и apps/web/src/routes/
- [X] T022 [US3] Применить formatRuUiValue к известным статусам, типам и reason-кодам в packages/competency-qa/src/ui/ и packages/platform-ui/src/

**Checkpoint**: UI переводит presentation labels, но API/domain values остаются байт-в-байт прежними.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Проверить полноту, совместимость и читаемость результата.

- [X] T023 Завершить allowlist и добиться PASS архитектурного аудита в tests/architecture/ui-localization.spec.ts
- [X] T024 Обновить весь оставшийся точный UI-текст в затронутых тестах tests/e2e/, tests/integration/007/ и tests/unit/005/
- [X] T025 Выполнить целевые Vitest-наборы из specs/009-russian-interface/quickstart.md и исправить регрессии в исходниках/тестах
- [X] T026 Выполнить pnpm lint, pnpm typecheck и pnpm --filter @awp/web build, исправив найденные проблемы в затронутых файлах
- [X] T027 Выполнить доступные Playwright-сценарии и ручной аудит мобильной/настольной ширины по specs/009-russian-interface/quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: без зависимостей; тесты должны сначала зафиксировать failing baseline.
- **Foundational (Phase 2)**: зависит от T001; блокирует динамические подписи US1-US3.
- **US1 (Phase 3)**: зависит от T003-T004; T008-T010 и T014-T015 можно выполнять параллельно по разным файлам.
- **US2 (Phase 4)**: зависит от переведённых компонентов US1, чтобы не редактировать одни файлы конкурентно.
- **US3 (Phase 5)**: зависит от общего formatter и перевода статического текста; тесты T019-T020 независимы друг от друга.
- **Polish (Phase 6)**: зависит от завершения US1-US3.

### User Story Dependencies

- **US1 (P1)**: самостоятельно даёт русские основные экраны после Foundation.
- **US2 (P1)**: функционально независима, но реализуется после US1 из-за общих файлов.
- **US3 (P2)**: использует Foundation и может проверяться отдельно на SSR fixtures.

### Parallel Opportunities

- T005 и T006 затрагивают разные тестовые контуры.
- T008, T009, T010, T014 и T015 затрагивают разные файлы.
- T019 и T020 затрагивают разные тесты.
- Runtime-реализация в общих файлах выполняется последовательно, чтобы не потерять переводы.

## Parallel Example: User Story 1

```text
Task T008: перевести apps/web/src/routes/projects/*.tsx
Task T009: перевести apps/web/src/routes/pilot/*.tsx
Task T010: перевести apps/web/src/routes/qa/*.tsx
Task T014: перевести packages/platform-ui/src/**/*.tsx
```

## Implementation Strategy

### MVP First

1. Зафиксировать тесты и общий formatter (T001-T004).
2. Перевести shell и основные экраны (T005-T015).
3. Запустить архитектурный аудит и UI/SSR-регрессию.

### Incremental Delivery

1. Foundation — единый безопасный formatter.
2. US1 — полностью русский статический UI.
3. US2 — русская обратная связь во всех состояниях.
4. US3 — русские presentation labels для машинных кодов.
5. Polish — полный тестовый и визуальный аудит.

## Format Validation

Все 27 задач имеют checkbox, последовательный ID, story label в story-фазах и точный путь к файлу или каталогу. Параллельные задачи помечены `[P]` только при отсутствии файлового конфликта.
