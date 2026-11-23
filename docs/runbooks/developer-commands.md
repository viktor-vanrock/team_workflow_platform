# Команды разработчика и замена старых aliases

Основные команды запуска, env и разработки описаны в [README](../../README.md).
Команды ниже выполняются из корня репозитория с Node 24.20.0 и pnpm 11.21.0.

## Повседневная работа и проверки

| Задача                                           | Команда                                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| Проверить инструменты                            | `pnpm prerequisites`                                                              |
| Запустить / посмотреть / остановить полный pilot | `pnpm dev:pilot:up`, `pnpm dev:pilot:status`, `pnpm dev:pilot:down`               |
| Посмотреть конфигурацию без запуска              | `pnpm dev:pilot -- up --plan`                                                     |
| Проверить формат изменённых Markdown             | `pnpm exec prettier --check README.md docs/README.md` (добавьте изменённые файлы) |
| Проверить формат всего репозитория               | `pnpm format:check`                                                               |
| Проверить код и сборку                           | `pnpm lint`, `pnpm typecheck`, `pnpm architecture`, `pnpm build`                  |
| Пересобрать контракты                            | `pnpm contracts:build`, `pnpm contracts:openapi`                                  |
| Общая регрессия, включая Docker                  | `pnpm ci:project`                                                                 |
| Полный локальный gate с pilot smoke              | `pnpm ci:008`                                                                     |
| Обновить архитектурный каталог                   | `node docs/architecture/generate-inventory.mjs`                                   |

`ci:project` выполняет format/lint/typecheck/build, architecture, registry/OpenAPI,
аудит зависимостей и полный Vitest с `AWP_RUN_CONTAINER_TESTS=true`. Отчёт —
`reports/project/local.json`; skipped/todo и устаревший результат не считаются PASS.
`ci:008` дополнительно управляет локальным pilot и выполняет smoke; используйте
выделенный тестовый контур. На новой БД сначала выполните [первый вход](../deployment/upgrade-and-verification.md).

Для изменений доступа, проектов и Jira доступны целевые наборы:

```sh
AWP_RUN_CONTAINER_TESTS=true pnpm exec vitest run tests/integration/019 tests/integration/020 tests/integration/021 tests/integration/022 tests/integration/023 tests/integration/003/jira-status-synchronization.spec.ts --maxWorkers=1
pnpm exec playwright test tests/e2e/019 tests/e2e/020 tests/e2e/021 tests/e2e/022 tests/e2e/023 tests/e2e/003/jira-status-sync-browser.spec.ts --project=chromium --workers=1
```

Проверки используют тестовые PostgreSQL/OIDC/provider fixtures, не корпоративный стенд.
Часть browser suites требует Docker; Chromium устанавливается через
`pnpm exec playwright install chromium`. Для правок только документации достаточно
проверки Markdown, ссылок и соответствия команд исходникам; полный runtime gate
нужен при изменении поведения или для release evidence.

## Первоначальная корпоративная область QA

`pnpm deploy:workspace:configure /absolute/path/workspace.json` завершает заполненную
конфигурацию, `pnpm deploy:workspace:bootstrap` применяет миграции и создаёт область
в пустой БД. API запускается `pnpm --filter @awp/api start:workspace` после сборки
корпоративного web. Полный порядок с Docker, секретами, Keycloak и HTTPS —
[в инструкции первой установки](../deployment/initial-qa-workspace.md).

## Что осталось в package.json

- Повседневные format/lint/typecheck/build/test, генерация contracts и architecture.
- Локальные launchers и управление контурами, включая полный QA pilot.
- Агрегатные CI/gates и evidence-проверки.
- Имена команд, которые обязательны для действующих quickstart validators и catalogs features 003–008.

В feature 012 удалён 31 избыточный alias: **268 → 237 scripts**. Удалены дубликаты и
внутренние checkpoints без исполняемых потребителей по имени alias. Реализации в tools,
Nx targets и агрегатные проверки сохранены. Часть numbered aliases остаётся контрактом
CI: дальнейшее сокращение потребует отдельного согласования validators и quickstarts.

## Замена удалённых команд

Если исторический документ содержит `pnpm <старое имя>`, используйте команду из правой
колонки. Node запускает существующие .mts entrypoints напрямую; для Nx и Playwright
используется `pnpm exec`, чтобы бинарник находился в зависимостях проекта.
Дополнительные аргументы дописываются в конец команды.

| Удалённый alias                     | Точная замена                                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `build:core`                        | `pnpm exec nx run platform-core:core-build`                                                                             |
| `verify:setup`                      | `node tools/verification/setup-gate.mts`                                                                                |
| `verify:foundation`                 | `node tools/verification/foundation-gate.mts`                                                                           |
| `verify:us2`                        | `node tools/verification/us2-extension-checkpoint.mts`                                                                  |
| `verify:us3-config`                 | `node tools/verification/us3-configuration-checkpoint.mts`                                                              |
| `verify:us3`                        | `node tools/verification/us3-durable-checkpoint.mts`                                                                    |
| `verify:us4`                        | `node tools/verification/us4-isolation-checkpoint.mts`                                                                  |
| `verify:qa-us4`                     | `node tools/verification/002-us4-defect-checkpoint.mts`                                                                 |
| `verify:qa-us5`                     | `node tools/verification/002-us5-completion-checkpoint.mts`                                                             |
| `verify:us1`                        | `node tools/verification/us1-local-checkpoint.mts`                                                                      |
| `verify:feature-001`                | `pnpm verify:001`                                                                                                       |
| `verify:004:prerequisites`          | `node tools/verification/feature-004-prerequisites.mts`                                                                 |
| `verify:004:setup`                  | `node tools/ci/feature-004.mts --setup`                                                                                 |
| `verify:004:foundation`             | `node tools/verification/004-foundation-checkpoint.mts`                                                                 |
| `verify:004:us1`                    | `node tools/verification/004-us1-checkpoint.mts`                                                                        |
| `verify:004:us2`                    | `node tools/verification/004-us2-checkpoint.mts`                                                                        |
| `verify:004:us3`                    | `node tools/verification/004-us3-checkpoint.mts`                                                                        |
| `verify:004:us4`                    | `node tools/verification/004-us4-checkpoint.mts`                                                                        |
| `verify:005:nonprod-metadata`       | `node tools/verification/feature-005-nonprod-metadata.mts`                                                              |
| `test:004:contract-integration-e2e` | `node tools/ci/feature-004-tests.mts`                                                                                   |
| `test:browser:005`                  | `pnpm exec playwright test tests/e2e/acceptance/005-gitlab-human-review-browser.spec.ts --project=chromium --workers=1` |
| `smoke:003:scenarios:process`       | `node tools/smoke/feature-003-scenario-process.mts`                                                                     |
| `smoke:003:us1:process`             | `node tools/smoke/feature-003-us1-process.mts`                                                                          |
| `smoke:003:us2:process`             | `node tools/smoke/feature-003-us2-process.mts`                                                                          |
| `smoke:003:us3:process`             | `node tools/smoke/feature-003-us3-process.mts`                                                                          |
| `smoke:003:us4:process`             | `node tools/smoke/feature-003-us4-process.mts`                                                                          |
| `smoke:003:browser:process`         | `node tools/smoke/feature-003-browser-process.mts`                                                                      |
| `smoke:005:browser:process`         | `node tools/smoke/feature-005-browser-process.mts`                                                                      |
| `smoke:006:browser:process`         | `node tools/smoke/feature-006-browser-process.mts`                                                                      |
| `gitlab:scenario:catalog`           | `node tools/local/gitlab-scenario-catalog.mts --check`                                                                  |
| `gitlab:nonprod:preflight`          | `node tools/verification/feature-005-nonprod-metadata.mts`                                                              |

Это справочник запуска, а не подтверждение результата gate. Изменения исходников могут
сделать старые evidence reports неактуальными; актуальность проверяется соответствующим gate.
Корпоративные проверки по-прежнему требуют своих входных данных и разрешённого окружения.
