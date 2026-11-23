# Что настроить в корпоративной среде

Для запуска одной QA-области и приёма проектов используйте [первую установку](initial-qa-workspace.md). Ниже описан полный корпоративный QA-пилот.

[Комплект деплоя](README.md) · [Паспорт для значений](templates/deployment-passport.md)

[Первый вход через Keycloak и администратор доступов](corporate-access.md): настройка отложена до создания корпоративных issuer и client ID; процесс подготовлен и проверяется локальным OIDC-стендом.

Значения ниже сверены с [environment parser](../../packages/runtime-composition/src/config/environment.ts),
[DeploymentPolicy](../../packages/runtime-composition/src/pilot/deployment-config.ts) и
[startup](../../packages/runtime-composition/src/pilot/startup.ts). Выбор Kubernetes,
VM или внутренней платформы контейнеров фиксируется в паспорте; готового
корпоративного манифеста/Helm chart в этом комплекте нет.

## Переменные процессов

Создайте конфигурацию workload на вашей платформе по
[runtime.env.example](templates/runtime.env.example). `loadEnvironment` читает
`process.env`, а не файл `.env`. Само копирование шаблона в контейнер ничего не
настраивает. Значения с credentials доставляйте из approved secret store в env
процесса без печати в CI; общего механизма `*_FILE` runtime сейчас не имеет.

| Переменная                     | Что указать                                                                                 | Где задать                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `AWP_ENVIRONMENT`              | `NON_PROD`                                                                                  | API + worker                                                  |
| `AWP_RUNTIME_PROFILE`          | `non-local`; необязательна, но при наличии обязана совпасть с canonical environment         | API + worker                                                  |
| `AWP_COMPOSITION`              | `qa-jira-gitlab-mattermost-development` либо `qa-jira-gitlab-mattermost-test`               | Одинаково API + worker                                        |
| `AWP_EXTERNAL_NETWORK_MODE`    | `allowlisted`                                                                               | API + worker                                                  |
| `AWP_DEPLOYMENT_PROFILE`       | `integration`, затем согласованная версия `pilot`                                           | API + worker, в согласии с policy                             |
| `AWP_DEPLOYMENT_CONFIG`        | **Содержимое** заполненного DeploymentPolicy JSON, до 65 536 символов; не имя файла         | API + worker, идентичное значение                             |
| `AWP_DATABASE_URL`             | Реальная `postgresql://`/`postgres://` DSN с утверждённым TLS/доступом                      | Secret delivery API + worker; отдельно migration role для job |
| `AWP_IDENTITY_ISSUER`          | Точный HTTPS issuer; равен endpoint `identity.url`                                          | API + worker                                                  |
| `AWP_IDENTITY_AUDIENCE`        | Утверждённая audience                                                                       | API + worker                                                  |
| `AWP_MODEL_PROVIDER`           | Выбранный provider key, если используется; policy/credentials/transport передаются отдельно | API + worker                                                  |
| `AWP_WEB_ORIGIN`               | Точный HTTPS browser origin                                                                 | API; текущий default `http://localhost:5173` не подходит      |
| `PORT`                         | Внутренний API port; default `3000`                                                         | API/container service                                         |
| `WORKER_HEALTH_PORT`           | Внутренний health port; default `3010`                                                      | Worker/container service                                      |
| `AWP_TELEMETRY_BACKEND_ORIGIN` | Утверждённый HTTPS OTLP HTTP backend                                                        | **Collector**, не замена telemetry bindings приложения        |

`AWP_GITLAB_BASE_URL` и `AWP_GITLAB_{READ,TRIGGER,WEBHOOK}_SECRET_REF` читаются
legacy-конфигурацией. Полная non-local фабрика требует published connector
bindings; набор этих переменных сам по себе интеграцию не собирает.

Не переносите local env: Mock Hub/Fake IdP, `AWP_QUEUE_STATIC_CONTOUR`,
`AWP_ONBOARDING_STATIC_CONTOUR`, local signing keys и `controlled-sandbox` не
являются корпоративными adapters. Redis- и S3-переменные не входят в контракт v1
и не активируют компоненты. Test-only режим предназначен для изолированных
loopback fixtures и не используется при внедрении.

## Что передать из кода host, помимо env

Это обязательная часть T025. Универсальных env-переменных для этих портов нет.
Создать корпоративные entry points, которые передают зависимости в
`bootstrapApi(telemetry, nonLocal)` и `bootstrapWorker(telemetry, nonLocal)`.

| Подключение              | Источник / требование                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Общий DataSource         | Инициализированная PostgreSQL с `runtimePersistence(composition)`; та же схема у обоих процессов                                                                                                 |
| Startup                  | Реальный image digest, уникальный UUID instance на процесс, общий published deployment, browser/callback, approved network; lease 1–30 секунд и validation deadline 100–5000 мс, не больше lease |
| Published configuration  | Девять категорий policy, включая INPUT_PACKAGE, три CONNECTOR_BINDING и актуальный deployment head. Публикации, сроки и авторство проверяются в БД                                               |
| Network                  | Один `PinnedNetworkTransport` для startup и connector factories; requests содержат по одной одобренной операции на каждый outbound endpoint, исключая browser/callback                           |
| Connectors               | Ровно JIRA/GITLAB/MATTERMOST на каждый Project, `mode: CORPORATE`; approved профиль, connection, binding и purpose credentials                                                                   |
| Identity                 | `createCorporateSessionBindings`: issuer/JWKS, audience/client auth, groups/session/step-up policy, encryption keys, store/revocations; mode `CORPORATE`                                         |
| Onboarding/evidence      | `onboarding.sessions`, `accountInventory`, `evidenceCrypto(scope)` и Pilot services; [готовый контракт подключения](../runbooks/corporate-onboarding-api.md)                                     |
| QA/intake/queue и worker | Остальные domain services/controllers и реальные десять обработчиков; список в [pipeline handoff](pipeline-and-rollout.md)                                                                       |
| Artifact/model/telemetry | Явные approved adapters с policy refs, transport и scoped secret resolver; без локального fallback                                                                                               |

Каждый API/worker в текущем коде сверяет собственный `imageDigest` с единственным
`DeploymentPolicy.imageDigest`, затем полный digest policy с peer. Планируйте
**один backend image с двумя entry points**, запускаемыми разными командами.
Разные API/worker images требуют изменения модели и проверок в T025; нельзя
просто сообщить процессам чужой digest. Web имеет отдельный image digest.

## Инфраструктура и доступы

| Компонент              | Что создать/настроить                                                                                                       | Как принять                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| PostgreSQL             | Выбрать и закрепить 17/18, HA/backup/PITR, capacity, отдельные runtime/migration/restore roles, TLS trust и сетевые правила | Миграции выбранной версии, restore drill, запрет runtime DDL, фактическая проверка CA/hostname |
| Контейнерная платформа | Registry pull identity, service accounts, CPU/RAM/limits/storage, grace period, restart/probes, общий release lock          | Запуск image без исходного workspace; shutdown/restart без повторного effect                   |
| Ingress/web            | DNS, server certificate, один HTTPS origin; SPA fallback и proxy API/auth/provider routes                                   | Login/callback/CSRF в браузере, deep links, raw webhook signature; `/local/*` недоступны       |
| Vault/remote signer    | Workload auth, namespace, policies, versioned secrets, signing key и public-key history                                     | Lease expiry/rotation/revocation; offline verify старой подписи при outage Vault               |
| Jira/GitLab/Mattermost | NON_PROD project/team/channel/suite; scopes, service identities, webhook contracts и receiver/gateway                       | Реальные positive/negative calls и независимый effect readback в N2                            |
| GitLab artifacts       | Единственный v1 binary owner, immutable job/ref metadata, checksums, retention/export                                       | Scoped readback, expiry и historical evidence verification без платформенной копии             |
| Model/Hermes           | Endpoint/model/version, approved data policy, timeouts/лимиты, fallback и стоимость                                         | Передача только разрешённых данных, outage/fallback; acceptance остаётся human                 |
| Observability          | Collector, mTLS, backend, retention, alerts/on-call                                                                         | Тестовое событие и alert доходят; нет чувствительных данных                                    |

Конкретные hostnames, порты, CA refs, CIDRs и capacity вписываются в паспорт.
8 CPU / 16 GB RAM / 30 GB в старом CI runbook — стартовая оценка для **runner**,
а не рассчитанные требования приложения. Размер среды и число реплик утвердить
по нагрузочным данным; горизонтальное масштабирование проверять отдельно.

Текущий `createPlatformDataSource` принимает URL, а не отдельный параметр CA.
Одного PostgreSQL DSN недостаточно для доказательства chain/hostname trust.
Способ доставки CA и режим проверки фактического DB-клиента должны войти в
реализацию host и приёмку; не добавляйте несуществующую `AWP_DATABASE_CA_FILE`.

## IAM, сеть и web

1. Зарегистрировать OIDC client с Authorization Code + PKCE и callback строго
   `https://<browser-host>/api/v1/auth/callback`. Передать actual issuer, JWKS,
   audience, client authentication и approved algorithms в session bindings.
2. Включить корпоративный provisioning: первый проверенный вход новой установки
   назначает администратора доступов. В `/admin/users` он назначает себе и команде
   Core memberships/roles. Группы Keycloak не требуются. Для регистрации проектов
   нужны рабочая роль `system-administrator`/`project-registrar`, `project.register`
   и отдельный step-up. См. [первоначальный вход](corporate-access.md).
3. Обеспечить durable session encryption keys с версиями/rotation. После рестарта
   обе реплики должны читать допустимую историю ключей. Secrets выдавать workload,
   а не браузеру. Подробности [IAM и onboarding](../runbooks/corporate-onboarding-api.md).
4. На firewall/egress proxy открыть только утверждённые DNS/IP/CIDR и методы/пути
   provider, IdP, Vault, artifact/model/telemetry. Сохранить CA/hostname verification,
   запрет redirects и DNS rebinding. Отдельно разрешить PostgreSQL transport.
5. Для ingress выбрать native receiver либо GATEWAY + RECEIVER. Не менять raw body,
   не логировать body/credentials; forwarded certificate header не заменяет
   source identity. [Контракт ingress](../../config/pilot/ingress-policy.md)
   содержит правила HMAC/mTLS/replay и требования к host routes.
6. Выдать web и BFF один origin: proxy `/api/` и `/v1/` к API, provider routes —
   к утверждённому receiver, UI deep links — к `index.html`. Health worker
   оставить во внутренней сети. Проверить cookie Secure/HttpOnly/SameSite,
   Origin и `X-CSRF-Token` для изменяющих запросов.

Для **сборки** web задать `VITE_AWP_COMPOSITION` равной corporate composition.
`VITE_AWP_AUTH_MODE=corporate` включает корпоративный вход на `/`, `/access` и
`/admin/users`. В `session.returnPaths` включить `/access` и `/admin/users`.
`VITE_AWP_API_URL` также читается frontend; установить публичный HTTPS origin,
не секрет. Переменные `VITE_*` оказываются в bundle: смена env уже запущенного
статического контейнера его не пересобирает. Corporate Pilot clients обращаются
к BFF на том же origin. Исходники: [App.tsx](../../apps/web/src/App.tsx) и
[Vite config](../../apps/web/vite.config.ts).

При `VITE_AWP_AUTH_MODE=corporate` корневой App выбирает корпоративный экран доступа,
а `/admin/users` — управление ролями. На `/access` доступен встроенный диалог
создания проекта с Hermes при наличии рабочего права. Для остальных corporate
маршрутов App выбирает Pilot UI; полная навигация QA/onboarding ещё не подключена.
Включить её в web delivery acceptance T025: все нужные пользователю маршруты
должны использовать corporate BFF и работать без local persona API.

## Collector

Загружать [базовый config](../../infra/observability/otel-collector.yaml), затем
[corporate override](../../infra/observability/otel-collector.corporate.yaml).
Это два входных config Collector, не файлы приложения.

| Mount внутри Collector                             | Содержимое                         |
| -------------------------------------------------- | ---------------------------------- |
| `/run/otel/server.crt`, `/run/otel/server.key`     | TLS identity приёмника OTLP        |
| `/run/otel/workloads-ca.crt`                       | CA разрешённых API/worker клиентов |
| `/run/otel/backend-ca.crt`                         | CA telemetry backend               |
| `/run/otel/exporter.crt`, `/run/otel/exporter.key` | Клиентская identity экспортера     |

Задать Collector `AWP_TELEMETRY_BACKEND_ORIGIN`; API/worker передать явный
approved telemetry runtime со своими client certificate/CA bindings.
В override mTLS включён для OTLP gRPC/HTTP, используется `otlphttp/secured`;
debug exporter не включён в pipelines. Mount keys через secret delivery.
Проверить доставку traces/metrics, отсутствие payload/secrets в логах и alerts:
readiness, digest mismatch, expired probes, ambiguous effects, dead letters,
ingress rejects, export failure и suspension.
