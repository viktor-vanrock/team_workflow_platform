# Внедрение в GitLab CI

Репозиторий содержит работающий локальный контур и проверяемые корпоративные адаптеры.
Готового корпоративного приложения пока нет: T025 требует соединить прикладные API
и обработчики очереди с этими адаптерами. Перед выпуском выполните
[чек-лист внедрения](pilot-deployment-checklist.md). `health/ready=200` и локальный
`PASS` сами по себе не закрывают эту задачу.

[Комплект деплоя](../deployment/README.md) содержит формы заполнения и порядок
первого integration bootstrap, последующего допуска пилота и отката.

## 1. Подключить локальную проверку

В корень добавлен `.gitlab-ci.yml`. После сохранения изменений в GitLab он запускает
`verify:local` → `pnpm ci:008` → `pnpm smoke:007`. Этот сценарий теперь обязательно начинает с
`pnpm ci:project`: ESLint, строгая компиляция всего дерева вместе с тестами и
инструментами, Nx typecheck/build, границы пакетов, схемы/OpenAPI, актуальный аудит
зависимостей и весь Vitest. Ошибка, пропуск, todo или изменение исходников во время
прогона делает общий результат `FAIL`. Затем выполняются проверки 008, браузерные
сценарии, Docker smoke, миграции, отказоустойчивость и телеметрия.
Отдельный smoke 007 проверяет свежий Compose с семью рестартами, реальным
Jira worker effect, подписанным evidence и Chromium; [состав и артефакты](onboarding-compose-smoke.md).

Настройте выделенный Linux shell runner с тегом `awp-local-linux`:

| Что установить/разрешить        | Где и зачем                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| Node `24.20.0`, pnpm `11.21.0`  | PATH пользователя runner; версии закреплены в `package.json`                                   |
| Docker Engine и Compose v2      | Доступ runner к собственному Docker daemon; Testcontainers и Compose должны видеть один daemon |
| Библиотеки Chromium             | Установить при подготовке runner; job скачивает Chromium через Playwright                      |
| Доступ к реестрам npm и образов | Установка по lockfile, `pnpm audit`, PostgreSQL 17/18, Collector и базовый Node image          |
| Полная история Git              | `GIT_DEPTH=0`: проверка опубликованных контрактов читает baseline commit 007                   |
| Свободные loopback-порты        | 5300, 5310, 55173, 54010, 54443, 54317/54318 для dev pilot                                     |
| Ресурсы                         | Начать с 8 CPU, 16 GB RAM и 30 GB свободного диска, затем уточнить по длительности jobs        |

`resource_group: awp-local-docker` сериализует jobs этого проекта. Один runner/daemon
не должен одновременно обслуживать другие репозитории с теми же портами и Compose
именами. Для недоверенных fork/MR используйте одноразовый изолированный runner;
корпоративные секреты этому job не выдаются.
`after_script` останавливает dev pilot и сохраняет тома также при неуспехе job.
Механизм сериализации описан в [GitLab Resource groups](https://docs.gitlab.com/ci/resource_groups/).

Проверка локально:

```sh
pnpm install --frozen-lockfile
pnpm ci:project
pnpm ci:008
pnpm smoke:007
```

Для обычной разработки достаточно `pnpm typecheck`, `pnpm lint` и выбранного теста.
Приёмочный запуск всегда включает контейнеры. `pnpm test` без флага контейнеров не
заменяет `ci:project`. Доказательства: `reports/project/local.json`, `vitest.json`,
логи этапов и `reports/008-pilot-hardening-and-conformance/local.json`. Старые
неизменяемые отчёты в `runs/` сохраняются как история; текущие fingerprints должны
совпадать с проверяемой ревизией.

Браузерные тесты зарегистрированы в `tests/browser-test-files.ts`; Vitest не
собирает Playwright runner suites. Некоторые браузерные проверки используют
статическую разметку или перехваченный HTTP; это не доказательство реальной
корпоративной интеграции. Исторические process-level проверки запускаются своими
`tools/smoke/feature-003-*-process.mts`, `feature-004-browser-process.mts`,
`feature-005-browser-process.mts`, `feature-006-browser-process.mts`: они создают
изолированные окружения. Нельзя запускать все Playwright файлы на одном стенде:
сценарии 003 требуют разные уникальные Compose project names.

## 2. Подготовить корпоративный host и образы

Добавить `apps/api/src/corporate-main.ts` и `apps/worker/src/corporate-main.ts` в рамках
T025. Они должны создавать одни и те же опубликованные конфигурации,
инициализированный DataSource и pinned transport, затем передавать проверенные
прикладные bindings в `bootstrapApi`/`bootstrapWorker`. Нынешний CLI `src/main.ts`
без программной сборки намеренно отклоняет non-local запуск.

`infra/compose/docker/node-runtime.Dockerfile` — образ разработки. Backend `build`
проверяет типы, но не создаёт самостоятельный JS runtime. Для корпоративного образа
нужно либо явно поставлять TS entry points и `tsx` со всеми workspace dependencies,
либо добавить сборку и проверить exports/импорты готового JS. Добавить проверенные
Dockerfile общего backend image с API/worker entry points и отдельный web image;
текущая DeploymentPolicy требует одинаковый image digest API и worker. Проверить запуск образа
без bind mount исходников и без dev fallback. Получить immutable OCI digests,
SBOM и полный image scan для каждого образа. Локальный IMAGE `ADAPTER_FIXTURE`
не является сканированием выпускаемого образа.

## 3. Подключить этапы корпоративного пайплайна

После реализации host включить `.gitlab/ci/corporate-pilot.example.yml` через
корневой `include: local`. Это образец jobs, а не готовый deploy: release job
отклоняется, пока отсутствуют entry points и `tools/deploy/corporate-release.sh`.
Не заменять эти проверки `echo`, `true` или `allow_failure`.

В GitLab Settings → CI/CD добавить:

| Переменная                | Тип/доступ                                  | Содержание                                                                            |
| ------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| `AWP_CORPORATE_PILOT`     | Protected, значение `1`                     | Включение ручных corporate jobs                                                       |
| `AWP_INPUT_PACKAGE_FILE`  | Protected File                              | Согласованный **без секретов** IN-01…IN-12, точные workspace/project и версии политик |
| `AWP_N2_EVIDENCE_FILE`    | Protected File                              | Независимо полученные наблюдения настоящих провайдеров в формате N2                   |
| Runtime workload identity | Federation/Vault, не plaintext token в YAML | Краткоживущая аутентификация runner и процессов                                       |
| Registry identity         | CI job token или scoped robot               | Push/pull только нужного проекта                                                      |

У File-переменной значением environment variable является путь к временному файлу;
Protected ограничивает её выдачу защищёнными ветками/тегами.
[GitLab CI/CD variables](https://docs.gitlab.com/ci/variables/).

Скопированные input files лежат в `.pipeline-inputs/`, исключены из Git и не
включаются в artifacts. Проверяющие CLI принимают пути внутри репозитория. Runtime
секреты не являются содержимым input package; ссылки на них и policies публикуются
через [процесс выдачи интеграций](pilot-integration-intake.md).
Этот каталог также исключён через `.dockerignore`, чтобы input package не попал
в Docker build context.

Runner `awp-corporate-nonprod` и environment `corporate-nonprod/pilot` должны быть
protected. Настроить разрешённых владельцев и approvals в GitLab UI. Последовательность
полного release: local regression → image build/scan → published configuration →
backup и schema preflight → единичная migration job → API/worker rollout → реальные
пробы/negative tests → N2 → recovery/shadow → ограниченный pilot → P3 review.
Пример `corporate:inputs` проверяет **уже собранные** N2 доказательства; он сам не
развёртывает стенд и не совершает обращения к провайдерам.
Protected environments доступны в Premium/Ultimate; до включения release job
проверить tier установленного GitLab и согласовать эквивалентный контроль допуска,
если этот механизм недоступен.
[GitLab Protected environments](https://docs.gitlab.com/ci/environments/protected_environments/).

## 4. Реализовать release script и эксплуатацию

`tools/deploy/corporate-release.sh` должен получать только проверенный release
manifest с digest каждого image, deployment/configuration revision и gate report.
Добавьте доставку workloads в используемую компанией инфраструктуру, единичную
миграцию, health deadlines, регистрацию экземпляров, graceful drain и сбор
доказательств. Выбор Kubernetes/VM и способ доставки остаются за владельцем стенда;
в репозитории нет выдуманного namespace, адресов, credentials или kubeconfig.

Перед миграцией 0190 проверить существующие строки без соответствующего
`projects(workspace_id,id)` во всех 15 таблицах миграции. Она добавляет и валидирует
составные FK; обнаруженные старые нарушения останавливают транзакцию. Их должен
разобрать владелец данных. Не удалять историю и не отключать FK для зелёного deploy.
Текущая версия Core — `230`; полный composition также требует Dummy `1000`,
Tech Writing `1100`, QA `2110`, Jira `3050` и GitLab `4020`.
Первый вход и миграции прав проверяются по [инструкции обновления](../deployment/upgrade-and-verification.md).
Источник версий — `runtimePersistence(composition)`.

Для существующей БД с Core 185+ подготовлен read-only
[preflight SQL](sql/0190-project-scope-preflight.sql):

```sh
psql -X --set ON_ERROR_STOP=1 --file docs/runbooks/sql/0190-project-scope-preflight.sql
```

Подключение и TLS берутся из утверждённой libpq service-конфигурации job. Скрипт
показывает только число нарушений по таблицам и завершается ошибкой при наличии
orphan rows; он не исправляет данные. Для новой БД применяется полный реестр
миграций. Между preflight и миграцией остановите писателей: окончательной защитой
от гонки остаётся транзакционная проверка FK самой миграцией.

При сбое остановить новые effects, сохранить очереди/receipts и восстановить
последний совместимый image/configuration digest. Автоматический down migration
не выполнять: решение о rollback схемы принимается по проверенной совместимости
и backup. Следовать [recovery runbook](pilot-recovery.md), включая fencing,
read-back неопределённых эффектов, исключение повторной записи и проверку RPO/RTO.
Финальный release разрешён только после закрытия всех обязательств из чек-листа.
