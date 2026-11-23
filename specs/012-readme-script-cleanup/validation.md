# Проверка реализации

Дата: 2026-09-07. Объём: README, пояснения env, scripts, справочник команд,
две quickstart-инструкции и адаптация существующего documentation contract test.

## Проверки первоначальной реализации

| Проверка                                                                                                        | Результат                                                                                               |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Аудит package.json относительно HEAD                                                                            | Удалён 31 alias: 268 → 237. Сохранённые команды и dependencies не изменены.                             |
| Замены команд                                                                                                   | Все 31 удаления имеют точные эквиваленты в docs/runbooks/developer-commands.md; entrypoints существуют. |
| Поиск потребителей в 2004 исходных/CI файлах                                                                    | Не найдены исполняемые ссылки на удалённые aliases.                                                     |
| Quickstarts 003–008                                                                                             | Все упомянутые numbered scripts остаются в package.json.                                                |
| Локальные ссылки README и новых документов                                                                      | Все целевые файлы/каталоги существуют.                                                                  |
| Env-пример                                                                                                      | Все 8 ключей описаны в README; значения примера не изменены.                                            |
| pnpm prerequisites                                                                                              | PASS: Node 24.20.0, pnpm 11.21.0, Docker 24.0.5, Compose 2.20.2.                                        |
| pnpm dev:pilot -- up --plan                                                                                     | PASS: полный local composition, фиксированные порты, development adapters.                              |
| docker compose config --quiet                                                                                   | PASS.                                                                                                   |
| Каталог команд Feature 008                                                                                      | PASS: все команды READY, ошибок нет.                                                                    |
| Каталог сценариев GitLab                                                                                        | PASS: foundation 2/2, US1 5/5, US2 7/7, US3 10/10, US4 6/6.                                             |
| Vitest: documentation-status/ci-gate-entrypoints 003, quickstart-commands 007, v1-infrastructure-boundaries 010 | PASS: 4 файла, 10 тестов.                                                                               |
| pnpm format:check                                                                                               | PASS.                                                                                                   |
| pnpm typecheck                                                                                                  | PASS: корневая проверка и 23 Nx-проекта; проектные результаты из Nx cache.                              |
| pnpm lint                                                                                                       | PASS: ESLint завершился с кодом 0, предупреждений нет.                                                  |
| git diff --check                                                                                                | PASS.                                                                                                   |

## Условия проверки

Команды выполнены с Node 24.20.0 через PATH. Системный Node был 22.23.2.
Для проверок с уже установленными зависимостями задано
`pnpm_config_verify_deps_before_run=false`: стандартный pnpm пытался автоматически
переустановить node_modules и остановился без TTY. Зависимости/lockfile не менялись.

Полный Compose bootstrap, browser journey и Docker/corporate gates заново не выполнялись:
изменение документации и aliases не меняет runtime. Проверены план запуска и конфигурация;
описание сценария сопоставлено с launcher, Compose, seed и существующим кодом UI.
Работающие посторонние тестовые контейнеры не перезапускались.
Генерируемый каталог сценариев после проверки возвращён к исходному содержимому;
старые evidence reports не обновлялись и не выдаются за результаты нового запуска.

## Соответствие требованиям

- FR-001/002/003, SC-001/002: назначение, пять операций запуска, таблицы env и источники значений.
- FR-004/005, SC-003: архитектура, Workspace/Project, pnpm/Nx и статические Pack/Connector.
- FR-006/007, SC-004/005: сокращение команд, полная таблица замен, актуальные quickstarts и contract test.
- FR-008: применимые проверки перечислены выше с фактическим объёмом.
- FR-009: spec, plan, research, data-model, command contract, quickstart, checklist и tasks созданы.

Extensions hooks отсутствуют: .specify/extensions.yml не существует. Конституционные
инварианты не изменены; checklist спецификации — 16/16.

## Дополнение: разделение env для деплоя и локальных проверок

В рамках FR-010/SC-006 обновлены README.md, .env.example и корпоративный
docs/deployment/templates/runtime.env.example. Создан docs/runbooks/local-environment.md.
В README выделены базовые API/worker env, необязательные настройки, build-time env web
и env Collector; подробности локальной конфигурации находятся в отдельном справочнике.

- PASS: все 16 ключей deployment-шаблона (включая закомментированные настройки web/Collector/model) описаны в README.
- PASS: все 8 ключей локального .env.example описаны в связанном локальном справочнике.
- PASS: значения обоих env-примеров совпадают с исходными; изменены комментарии и группировка.
- PASS: локальные ссылки в README и новом справочнике существуют.
- PASS: формат обоих Markdown-документов и git diff --check.
- PASS: существующие documentation-status 003 и v1-infrastructure-boundaries 010 — 2 файла, 4 теста.

Runtime-код не менялся; повторные lint/typecheck и запуск сервисов для редакционной правки
не требовались. Все 14 задач feature завершены.
