# Tasks: README и сокращение команд разработки

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md)

## Phase 1: Setup

- [x] T001 Оформить spec и checklist в specs/012-readme-script-cleanup/ и выбрать feature в .specify/feature.json.

## Phase 2: Foundational

- [x] T002 Исследовать launchers, env, расширения и потребителей scripts; записать решения в specs/012-readme-script-cleanup/research.md.
- [x] T003 Проверить .gitignore, .dockerignore, .prettierignore и ESLint ignores; определить границы правок в specs/012-readme-script-cleanup/plan.md.

## Phase 3: User Story 1 — Локальный запуск (P1, MVP)

**Goal**: Воспроизводимый первый запуск и понятная конфигурация.
**Independent Test**: Команды/порты совпадают с launcher/Compose, все env примера объяснены.

- [x] T004 [US1] Переписать README.md: назначение, требования, полный запуск, ссылки и диагностика.
- [x] T005 [US1] Добавить в README.md таблицы env и пояснить загрузку в .env.example.

## Phase 4: User Story 2 — Устройство и расширение (P2)

**Goal**: Описать реальные границы и точки расширения.
**Independent Test**: Каждый шаг сопоставлен с кодом, отсутствие Workspace UI явно указано.

- [x] T006 [US2] Добавить архитектуру, путь запроса и структуру репозитория в README.md.
- [x] T007 [US2] Добавить Workspace, Project, пакет pnpm/Nx и статический Pack/Connector в README.md.

## Phase 5: User Story 3 — Набор команд (P2)

**Goal**: Убрать избыточные aliases с сохранением рабочего CI.
**Independent Test**: Нет удалённых имён в исполняемых потребителях, доступна замена каждого alias.

- [x] T008 [US3] Сократить scripts в package.json по результатам аудита потребителей.
- [x] T009 [US3] Записать точные замены в docs/runbooks/developer-commands.md и обновить specs/001-extension-kernel-local-skeleton/quickstart.md и specs/009-russian-interface/quickstart.md.

## Phase 6: Polish

- [x] T010 Проверить README.md, package.json и catalogs; выполнить формат/lint/typecheck и доступные сценарии quickstart, записать результаты в specs/012-readme-script-cleanup/validation.md.
- [x] T011 Сверить FR/SC, завершить specs/012-readme-script-cleanup/tasks.md и статус spec.md.

## Дополнение — разделение env (US1)

- [x] T012 [US1] В README.md выделить обязательные/необязательные env деплоя и настройки web/Collector; local/test таблицы вынести в docs/runbooks/local-environment.md.
- [x] T013 [US1] Явно разделить назначение .env.example и docs/deployment/templates/runtime.env.example, сохранив значения переменных.
- [x] T014 Проверить ссылки, полноту env и формат изменённых документов; обновить specs/012-readme-script-cleanup/validation.md.

## Dependencies & Execution Order

T001 → T002/T003 → US1 → US2 → US3 → T010 → T011.
US1 и US2 меняют один README.md и выполняются последовательно. US3 можно выполнять
независимо от написания README, но итоговая сверка выполняется после обеих правок.

## Parallel Opportunities

US1: независимая проверка env и портов при последовательной записи README.
US2: независимое чтение Workspace provisioning и правил monorepo.
US3: независимый поиск consumers и документации; package.json изменяет один исполнитель.
Исследования scripts и Workspace уже выполнены двумя research agents.

## Implementation Strategy

Сначала MVP запуска, затем расширения, затем сокращение команд. Runtime не меняется,
новые runtime tests не нужны; применяются существующие проверки и прямой аудит документации.
