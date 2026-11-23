# Tasks: Редактирование проектов

## Phase 1: Setup
- [x] T001 Подготовить spec, research, plan и контракты в specs/022-project-editing/.

## Phase 2: Foundation
- [x] T002 Зафиксировать failing integration и browser контракты в tests/integration/022/project-editing.spec.ts и tests/e2e/022/project-editing.spec.ts.
- [x] T003 Добавить metadata.update в packages/runtime-composition/src/security/workspace-role-catalog.ts и узкий сохраняющий отзывы seed в packages/runtime-composition/src/seed/project-metadata-seed.ts; включить известный docs project в pilot/development-seed.ts.

## Phase 3: US1 — Карточка (P1)
Independent test: сохранить название/ответственных, открыть заново и увидеть новую версию/историю.
- [x] T004 [US1] Реализовать scoped GET/PUT и immutable history в apps/api/src/extensions/onboarding/project-metadata.application.ts и onboarding.controller.ts.
- [x] T005 [US1] Добавить форму, историю и подтверждение входа в apps/web/src/routes/projects/project-edit.tsx.
- [x] T006 [US1] Подключить редактирование в каталоге/карточке и хлебных крошках в apps/web/src/workspace/local-workspace.tsx и breadcrumbs.ts.

## Phase 4: US2 — Доступ и сохранение (P1)
Independent test: stale If-Match и чужая роль отклонены, replay не создаёт новую историю.
- [x] T007 [US2] Проверить отрицательные сценарии, отозванные grants и повтор seed в tests/integration/022/project-editing.spec.ts.
- [x] T008 [US2] Проверить сохранение черновика, смену маршрута, скрытие действий и mobile в tests/e2e/022/project-editing.spec.ts.

## Phase 5: Polish
- [x] T009 Обновить docs/user-guide/administration.md и выполнить quickstart проверки, записав результаты в specs/022-project-editing/validation.md.
- [x] T010 Обновить живой стенд без сброса, проверить права/UI и сохранность с tools/smoke/feature-022-live.mts.

## Dependencies / Parallel opportunities
T001 → T002 → T003 → T004 → T005 → T006 → T007/T008 → T009 → T010. После реализации независимые integration и browser проверки можно запускать параллельно. US1 — минимальный полный сценарий, US2 обязателен до поставки. Реализация последовательная, без дополнительных implementation agents. Все 10 задач имеют checkbox, ID и конкретный путь; US1: 3 задачи, US2: 2 задачи.
