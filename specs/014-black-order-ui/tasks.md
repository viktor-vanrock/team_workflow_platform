# Tasks: «Чёрный орден» в UI

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [contracts/ui.md](contracts/ui.md).
**Tests**: FR-011 требует регрессию действий и браузерную проверку визуальной доступности.

## Phase 1: Setup

- [x] T001 Зафиксировать выбранную тему, ветку, спецификацию и референс в `specs/014-black-order-ui/`.
- [x] T002 Проверить существующие ignore files и исследовать светлые UI-исключения; записать решения в `specs/014-black-order-ui/research.md`.

## Phase 2: Foundational

- [x] T003 Подготовить браузерные проверки контраста, native select и offline assets в `tests/e2e/014/black-order-browser.spec.ts`, зарегистрировать в `tests/browser-test-files.ts` и зафиксировать исходный результат.
- [x] T004 Добавить общие токены, тёмную MUI-тему и native/reduced-motion baseline в `packages/platform-ui/src/black-order.ts` и `packages/platform-ui/src/workspace-theme.tsx`.
- [x] T005 Добавить переиспользуемый архивный декор и публичные экспорты в `packages/platform-ui/src/order-decoration.tsx` и `packages/platform-ui/src/index.ts`.

## Phase 3: US1 — Единый архив (P1)

**Goal**: Единая тема и узнаваемая архивная оболочка.
**Independent test**: Вход → главная → запросы/очередь/проекты, без светлых исключений.

- [x] T006 [US1] Оформить вход, header, проект и основную навигацию в `apps/web/src/workspace/local-workspace.tsx`.
- [x] T007 [US1] Оформить архивную главную и справку в `apps/web/src/workspace/workspace-home.tsx`.
- [x] T008 [US1] Оформить существующий экран Hermes без фиктивных предложений в `packages/competency-qa/src/ui/hermes-proposals.tsx`.

## Phase 4: US2 — Рабочие сценарии (P1)

**Goal**: Читаемые формы, резюме, результаты и дополнительные разделы.
**Independent test**: Существующие journeys 013 сохраняют действия/подтверждения/изменение контекста.

- [x] T009 [US2] Убрать светлые исключения из `packages/competency-qa/src/ui/intake.tsx` и `packages/competency-qa/src/ui/findings-defects.tsx`.
- [x] T010 [US2] Согласовать backgrounds в `apps/web/src/routes/pilot/pilot-run.tsx`, `readiness.tsx` и `recovery.tsx`.
- [x] T011 [US2] Выполнить `tests/e2e/013/workspace-browser.spec.ts` и локализационную регрессию; устранить связанные с темой ошибки.

## Phase 5: US3 — Доступность и узкий экран (P2)

**Goal**: Читаемый контраст, видимый focus, отсутствие переполнения и сетевых design-зависимостей.
**Independent test**: Проверки 014, keyboard flow 013 и визуальные снимки 360/390/1440px.

- [x] T012 [US3] Пройти `tests/e2e/014/black-order-browser.spec.ts`, проверить контраст/фокус/поля и исправить выявленное.
- [x] T013 [US3] Визуально проверить вход, home, запрос/резюме, Hermes и pilot; сохранить результаты в `specs/014-black-order-ui/validation.md`.

## Phase 6: Polish

- [x] T014 Обновить описание темы в `docs/runbooks/interface-guide.md` и реестр результата в `specs/014-black-order-ui/validation.md`.
- [x] T015 Выполнить typecheck, architecture, lint, format и production build; записать результаты в `specs/014-black-order-ui/validation.md`.
- [x] T016 Обновить итоговые статусы в `specs/014-black-order-ui/spec.md` и `tasks.md`, показать рабочий UI пользователю.

## Phase 7: Точное соответствие исходной картинке

- [x] T017 Сравнить первую реализацию с исходным HTML и референсом; зафиксировать пропущенные визуальные слои в `design.md`.
- [x] T018 Перенести точные шрифты, градиенты, двойные рамки и угловые детали в `packages/platform-ui/src/`; сохранить лицензии локальных шрифтов.
- [x] T019 Пересобрать shell, главную и правую арочную колонку Hermes по пропорциям референса.
- [x] T020 Оформить отдельный экран предложений и сохранить переход по ID выбранного запроса без изменения API.
- [x] T021 Выполнить регрессию, проверить 1024px рядом с референсом и обновить работающий локальный стенд.
- [x] T022 Записать результаты и показать переработанный UI пользователю.

## Dependencies

T001–002 → T003 → T004–005 → US1/US2 → US3 → T014–016. US1 и US2 используют общую тему; регрессия проводится после обеих групп. Исследование независимых файлов было делегировано read-only агенту. Реализация выполняется последовательно, без конкурирующих правок.

## Parallel opportunities

После T005 независимы пары T007/T008 и T009/T010; при раздельной работе они могут выполняться одновременно. В этом запуске используются последовательные правки, чтобы сохранить согласованность темы и рабочее дерево 013.

## Implementation strategy

MVP: T001–T007, единая тема и shell. Полный согласованный объём включает все T001–T016; остановка на MVP не запланирована.
