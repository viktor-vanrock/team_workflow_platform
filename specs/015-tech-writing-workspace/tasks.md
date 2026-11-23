# Задачи: техническая документация

Основание: [spec.md](spec.md), [plan.md](plan.md), модель и контракты. Все истории P1.

## Этап 1 — Подготовка

- [x] T001 Оформить scope и governance в docs/adr/0010-local-tech-writing-workspace.md и .specify/memory/constitution.md.
- [x] T002 Создать package/project/tsconfig для packages/competency-tech-writing и зарегистрировать зависимости/архитектурные правила.

## Этап 2 — Основа

- [x] T003 Написать тест переходов и точной версии в tests/unit/015/document-workflow.spec.ts.
- [x] T004 Реализовать domain.ts, manifest.ts, migration.ts в packages/competency-tech-writing/src/ и local migration registration.

## Этап 3 — US1: роли и отдельная область

Цель: два разных входа и неизменный QA. Независимая проверка: вход за три persona, повторный seed.

- [x] T005 [US1] Добавить tests/integration/015/documentation.spec.ts для seed/identity/scoping.
- [x] T006 [US1] Добавить versioned seed в packages/runtime-composition/src/seed/tech-writing-local-seed.ts и вызов в src/cli/seed.ts.
- [x] T007 [US1] Добавить persona/Fake IdP в packages/runtime-composition/src/security/local-security.ts, apps/fake-idp/src/oidc.controller.ts; исправить context SQL apps/api/src/local/local-persona.controller.ts.
- [x] T008 [US1] Добавить WorkspaceContribution в packages/competency-ui-sdk/src/index.ts и выбор компетенции в apps/web/src/workspace/.

## Этап 4 — US2: авторский процесс

Цель: задание, сохранение и отправка документа. Независимая проверка: текст после reload, запрет пустого submit.

- [x] T009 [US2] Добавить API тесты сохранения/submit/конфликтов в tests/integration/015/documentation.spec.ts.
- [x] T010 [US2] Реализовать local HTTP/service с authorization, транзакцией, history/receipt/audit в apps/api/src/local/tech-writing.controller.ts.
- [x] T011 [US2] Создать редактор, авторскую главную и создание повторного примера в packages/competency-tech-writing/src/workspace.tsx.

## Этап 5 — US3: ревью и утверждение

Цель: точное решение лида, возврат и повторное ревью. Независимая проверка: готовый IN_REVIEW пример.

- [x] T012 [US3] Дополнить tests/integration/015/documentation.spec.ts проверками writer denial, revoke, classification, concurrency, exact approval invalidation.
- [x] T013 [US3] Реализовать return/approve и проверку текущей версии в apps/api/src/local/tech-writing.controller.ts и domain.ts.
- [x] T014 [US3] Создать очередь/просмотр/форму решения/историю в packages/competency-tech-writing/src/workspace.tsx.

## Этап 6 — Приёмка

- [x] T015 Выполнить typecheck/lint/build/architecture и релевантные тесты, исправить дефекты; записать команды в specs/015-tech-writing-workspace/validation.md.
- [x] T016 Поднять текущий worktree без сброса volumes, проверить обе роли и полный цикл в браузере; сохранить доказательства в specs/015-tech-writing-workspace/screenshots/.
- [x] T017 Обновить README.md и docs/user-guide/tech-writing.md с входами и маршрутом повторения.
- [x] T018 Сопоставить реализацию с FR/SC, закончить specs/015-tech-writing-workspace/validation.md и оставить работающий актуальный стенд.

## Зависимости и порядок

T001 → T002 → T003/T004 → US1 → US2 → US3 → приёмка. Независимые исследования UI и Core authorization выполнены при планировании. Реализация последовательна из-за общих wiring файлов.

Параллельные возможности при дополнительных исполнителях: US1 persona/Fake IdP и SDK; US2 UI и API после фиксации контракта; US3 негативные тесты и UI. Изменения одного файла не распараллеливаются.

## Стратегия

MVP = US1 с готовыми данными; затем сохраняемый авторский цикл и ревью. Итоговая поставка включает все три истории и проверку полного маршрута, без остановки на MVP.

## Phase 7: Convergence

- [x] T019 Заменить вывод необработанного Error.message для сетевых/JSON ошибок в packages/competency-tech-writing/src/workspace.tsx русским fallback, сохранив локализованные серверные ошибки; проверить типы и обновить стенд/validation.md согласно spec: пограничный случай «ошибки сети показываются по-русски» (partial, MEDIUM).
