# Локальные env: разработка и проверки

[README](../../README.md#настройки-env) · [Env реального деплоя](../deployment/templates/runtime.env.example)

Этот справочник описывает локальный runtime, Compose и test fixtures. Для корпоративного
стенда используйте отдельный deployment-шаблон по ссылке выше.

## Как передаются переменные

[.env.example](../../.env.example) — пример только для локального runtime. Node-процессы
**не загружают корневой `.env` автоматически**: `loadEnvironment()` читает `process.env`.
Для ручного запуска переменные нужно экспортировать в shell или передать процессу через
поддерживаемый env-файл. Пример не является готовой конфигурацией host-запуска поверх Compose:
PostgreSQL в Compose не публикует порт `5432`, а `fake-idp` — имя внутри Docker-сети.

Compose читает `.env` для `${...}`-подстановок, но внутрь контейнеров попадают значения,
явно перечисленные в [docker-compose.local.yml](../../infra/compose/docker-compose.local.yml).
Например, URL БД контейнера задан в Compose и не заменяется корневым `AWP_DATABASE_URL`.
Для приведённого выше запуска **копировать или заполнять `.env` не требуется**.

[dev:pilot](../../tools/local/pilot-cli.mts) задаёт собственный набор env: composition, порты,
флаги, origin и Collector. Его значения имеют приоритет над одноимёнными переменными shell;
конфликт окружения, runtime profile, composition или network mode завершает запуск ошибкой.
Менять порт pilot через `AWP_WEB_HOST_PORT=... pnpm dev:pilot:up` бессмысленно — launcher
задаст свой порт. Для своей конфигурации используйте `tools/local/local.mts` с согласованными env
или отдельный Compose override.

## Runtime локального контура

Значения ниже относятся к локальному режиму; фактический environment контейнеров задан в Compose.

| Переменная                  | Назначение и значение                                                                                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AWP_ENVIRONMENT`           | Класс окружения. Локально `LOCAL`. Допустимы также `NON_PROD`, `PREPROD`, `PLATFORM_PROD`, но это не разрешение внешних actions. При отсутствии используется legacy profile.                         |
| `AWP_RUNTIME_PROFILE`       | Совместимость со старой конфигурацией: `local` / `test` соответствуют `LOCAL`, `non-local` — `NON_PROD`. Нужна хотя бы одна из этой и предыдущей переменной; вместе они должны совпадать по смыслу.  |
| `AWP_COMPOSITION`           | Состав Pack/Connectors. Default `foundation`; полный pilot — `qa-jira-gitlab-mattermost-local`. Допустимые ключи — в [environment.ts](../../packages/runtime-composition/src/config/environment.ts). |
| `AWP_DATABASE_URL`          | PostgreSQL DSN. В env-примере `postgresql://awp_local:local-only@localhost:5432/awp` — для отдельно подготовленной БД. В Compose у runtime и migrator разные роли/DSN.                               |
| `AWP_MOCK_HUB_URL`          | HTTP-адрес эмуляторов. Локальный runtime default `http://localhost:4010`, в Docker — `http://mock-hub:4010`. За пределами LOCAL Mock Hub запрещён.                                                   |
| `AWP_IDENTITY_ISSUER`       | Точный OIDC issuer: локально `https://fake-idp:4443/oidc`. Вне LOCAL обязателен. Должен совпадать с issuer токена.                                                                                   |
| `AWP_IDENTITY_AUDIENCE`     | Проверяемая audience токена. Compose и пример задают `awp-local`; default самого parser в LOCAL — `awp`. Не смешивайте эти значения.                                                                 |
| `AWP_EXTERNAL_NETWORK_MODE` | `deny` для локальных compositions, `allowlisted` для разрешённых внешних интеграций. `deny` совместим с локальными Mock Hub effects.                                                                 |
| `AWP_MODEL_PROVIDER`        | Ключ провайдера модели; в Compose `deterministic-fake`. Сам ключ не подключает credentials/transport реальной модели; соответствующий adapter нужен отдельно.                                        |
| `AWP_WEB_ORIGIN`            | Разрешённый browser origin для CORS в API. Default `http://localhost:5173`, pilot — `http://localhost:55173`.                                                                                        |
| `PORT`                      | Порт HTTP-процесса: API `3000`, Mock Hub `4010`, Fake IdP `4443`; задаётся отдельно каждому сервису.                                                                                                 |
| `WORKER_HEALTH_PORT`        | Порт health endpoints worker, default `3010`.                                                                                                                                                        |

## Локальный Compose и pilot

Эти переменные обычно уже установлены launcher/Compose. При создании своего контура
согласуйте host-порты, публичный API URL и origin; внутри контейнеров порты не меняются.

| Переменная                                                                                     | Назначение; default Compose → pilot                                                                                                                   |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AWP_LOCAL_PROJECT_NAME`                                                                       | Имя Compose-проекта и префикс volume: `awp-local` → `awp-local-pilot-dev`. CLI допускает только имена `awp-local` или `awp-local-…`.                  |
| `AWP_API_HOST_PORT`                                                                            | Публикация API: `3000` → `5300`.                                                                                                                      |
| `AWP_WORKER_HOST_PORT`                                                                         | Публикация worker health: `3010` → `5310`.                                                                                                            |
| `AWP_WEB_HOST_PORT`                                                                            | Публикация web: `5173` → `55173`.                                                                                                                     |
| `AWP_MOCK_HUB_HOST_PORT`                                                                       | Публикация Mock Hub: `4010` → `54010`.                                                                                                                |
| `AWP_IDP_HOST_PORT`                                                                            | Публикация Fake IdP: `4443` → `54443`.                                                                                                                |
| `AWP_PUBLIC_API_URL`                                                                           | Адрес API для браузера; Compose передаёт его как `VITE_AWP_API_URL`. `http://localhost:3000` → `http://localhost:5300`.                               |
| `AWP_QUEUE_STATIC_CONTOUR`                                                                     | Подключает локальный модуль очереди: `false` → `true`. Требует полного локального состава.                                                            |
| `AWP_ONBOARDING_STATIC_CONTOUR`                                                                | Подключает локальный onboarding: `false` → `true`. Требует полного состава и локального signer.                                                       |
| `AWP_PILOT_ADAPTER_MODE`                                                                       | Выбирает dev-адаптеры pilot: `disabled` → `development`.                                                                                              |
| `AWP_EVIDENCE_SIGNER`                                                                          | Локальный adapter подписи evidence: `local-ed25519`.                                                                                                  |
| `AWP_EVIDENCE_SIGNER_KID`                                                                      | Идентификатор локального ключа подписи: `local-ed25519:1`.                                                                                            |
| `AWP_EVIDENCE_SIGNER_PRIVATE_MATERIAL`                                                         | Доступность приватного материала локального signer: `true`. Это флаг, а не текст ключа.                                                               |
| `COMPOSE_PROFILES`                                                                             | Дополнительные сервисы; pilot задаёт `observability` для Collector.                                                                                   |
| `AWP_OTEL_COLLECTOR_ORIGIN`                                                                    | OTLP HTTP origin для приложений: пусто → `http://otel-collector:4318`.                                                                                |
| `AWP_OTEL_GRPC_HOST_PORT`, `AWP_OTEL_HTTP_HOST_PORT`                                           | Порты Collector: `4317` / `4318` → `54317` / `54318`.                                                                                                 |
| `NODE_EXTRA_CA_CERTS`                                                                          | Путь к доверенной локальной CA; Compose указывает сгенерированный `awp-local-ca.pem`.                                                                 |
| `FAKE_IDP_TLS_KEY_PATH`, `FAKE_IDP_TLS_CERT_PATH`, `FAKE_IDP_ISSUER`                           | TLS-файлы и issuer Fake IdP; launcher генерирует сертификаты, Compose передаёт пути.                                                                  |
| `MOCK_HUB_DATABASE_URL`, `MOCK_HUB_SEED`                                                       | Отдельная БД эмуляторов `awp_mock` и seed `42` для её начального наполнения.                                                                          |
| `AWP_MOCK_CONTROL_KEY`                                                                         | Ключ управления сценариями Mock Hub; локальный fixture `local-gitlab-control`.                                                                        |
| `AWP_GITLAB_BASE_URL`                                                                          | Адрес GitLab adapter: в локальном Compose `http://mock-hub:4010`.                                                                                     |
| `AWP_GITLAB_READ_SECRET_REF`, `AWP_GITLAB_TRIGGER_SECRET_REF`, `AWP_GITLAB_WEBHOOK_SECRET_REF` | Ссылки на scoped secrets для чтения, запуска pipeline и webhook. Compose использует локальные `secret-ref:local/gitlab/…`, а не реальные credentials. |

## Frontend и дополнительные настройки

`VITE_AWP_API_URL` и `VITE_AWP_COMPOSITION` читаются web при запуске Vite или сборке.
Их изменение после сборки bundle не перенастраивает опубликованный web. `VITE_*` видны
браузеру: секреты в них не передаются.

Для локального account inventory используется `AWP_QA_ACCOUNT_INVENTORY_FILE` — путь
к файлу с opaque account refs, без credentials. Формат описан в
[onboarding HTTP](../../docs/runbooks/onboarding-http.md). В корпоративной сборке account inventory
передаётся как отдельный host adapter.

`AWP_RUN_CONTAINER_TESTS=true` включает тесты с Testcontainers; нужен Docker.
`ci:project` задаёт этот флаг автоматически.

Имена `NODE_EXTRA_CA_CERTS` и `AWP_GITLAB_*` не являются исключительно тестовыми:
здесь описаны их локальные значения. Корпоративные CA, endpoints и secret refs определяются
отдельной конфигурацией интеграций и host adapters.
