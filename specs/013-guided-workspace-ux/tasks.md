# Tasks: Понятное рабочее пространство QA

**Input**: [plan.md](plan.md), [spec.md](spec.md), research.md, data-model.md, contracts/ui.md.
**Tests**: Required by FR-014 for navigation, immutable confirmation and context regressions.

## Phase 1: Setup

- [x] T001 Зафиксировать browser/source UX-аудит в `specs/013-guided-workspace-ux/audit.md`.
- [x] T002 Подготовить спецификацию, исследование, UI contracts и checklist в `specs/013-guided-workspace-ux/`.

## Phase 2: Foundation

- [x] T003 Добавить общий theme/baseline через `packages/platform-ui/src/workspace-theme.tsx`, exports и `apps/web/src/main.tsx`.
- [x] T004 Подготовить Playwright/Vite fixtures и зарегистрировать `tests/e2e/013/workspace-browser.spec.ts` в `tests/browser-test-files.ts`.

## Phase 3: US1 — Вход и навигация (P1)

**Goal**: Понятный старт, видимый scope и обнаруживаемые разделы.
**Independent test**: Войти, перейти в запросы/очередь/справку и назад без повторного входа, сменить роль без старых данных.

- [x] T005 [US1] Добавить entry/navigation/context/browser assertions (первый запуск заблокирован sandbox; см. validation.md) в `tests/e2e/013/workspace-browser.spec.ts`.
- [x] T006 [US1] Выделить старые demo-панели в `apps/web/src/workspace/developer-tools.tsx`, создать shell/auth/navigation в `apps/web/src/workspace/` и подключить через `apps/web/src/App.tsx`.
- [x] T007 [US1] Реализовать контекстные grants, очистку subtree, retry/denied/unknown states и history/focus в `apps/web/src/workspace/local-workspace.tsx`.

## Phase 4: US2 — Создание и отправка (P1)

**Goal**: Пользователь проверяет ровно сохранённый запрос и видит реальный исход.
**Independent test**: Save → edit → save → send → pending → confirmed; confirm payload относится к preview.

- [x] T008 [US2] Добавить browser assertions immutable preview/pending/retry/no duplicate в `tests/e2e/013/workspace-browser.spec.ts`.
- [x] T009 [US2] Реализовать этапы, примеры и frozen preview в `packages/competency-qa/src/ui/intake.tsx`.
- [x] T010 [US2] Добавить отменяемый polling, понятные исходы, recovery и open callback в `packages/competency-qa/src/ui/intake.tsx`.

## Phase 5: US3 — Выбор и работа с запросом (P1)

**Goal**: Отделить создание от просмотра, исключить неявный выбор и stale actions.
**Independent test**: A → B на рабочей вкладке; поздний ответ A не отображается, отсутствие выбранного ID не выбирает другое.

- [x] T011 [US3] Добавить browser assertions выбора, stale-response и пустого состояния в `tests/e2e/013/workspace-browser.spec.ts`.
- [x] T012 [US3] Реализовать list/create/detail, явный выбор, guards/keys и подсказки этапов в `packages/competency-qa/src/ui/contribution.tsx` и `packages/competency-qa/src/ui/confirmed-backlog.tsx`.

## Phase 6: US4 — Вторичные разделы (P2)

**Goal**: Очередь, проекты и помощь доступны и объясняют назначение.
**Independent test**: Навигация в очередь/каталог, понятные empty/stage messages и developer/help отдельно.

- [x] T013 [US4] Добавить справку/домашние действия в `apps/web/src/workspace/workspace-home.tsx` и метаданные разделов в `apps/web/src/workspace/navigation.ts`.
- [x] T014 [P] [US4] Улучшить пояснения/empty/busy состояния в `apps/web/src/routes/qa/queue-workspace.tsx` и `packages/competency-qa/src/ui/queue-workspace.tsx`.
- [x] T015 [P] [US4] Улучшить scope/stage/retry каталога в `apps/web/src/routes/projects/project-catalog.tsx`.

## Phase 7: Polish and validation

- [x] T016 Обновить затронутые selectors/пути browser journeys и registry в `tests/architecture/ui-localization.spec.ts`, `tests/e2e/acceptance/`, `tools/smoke/008-development.mts`, README.md.
- [x] T017 Пройти browser keyboard/mobile/error regression, format/lint/typecheck/build/architecture/localization и записать результаты в `specs/013-guided-workspace-ux/validation.md`.
- [x] T018 Пересобрать pilot, проверить реальные вход/создание/выбор в браузере и дополнить `specs/013-guided-workspace-ux/validation.md`.

## Dependencies & Execution Order

T001–002 → T003–004 → US1 → US2 → US3 → US4 → T016–018. Tests precede related implementation. T014 and T015 are independent after shell contracts stabilize. Shared browser test file is edited sequentially.

## Parallel opportunities

US1: theme and read-only route research independent. US2: polling research and visual review independent, same intake file sequential. US3: backlog copy and selection research independent; integrate together. US4: T014 queue and T015 catalog can run in parallel (different files). No duplicate ownership of shared shell or tests.

## Implementation Strategy

Deliver US1 first and verify the entry path, then complete US2/US3 and secondary context/help. All four stories are in this task; MVP is a validation checkpoint, not a stopping point. No deployment or business data migration.
