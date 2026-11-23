# Чек-лист переноса в реальный pipeline

Версия: 2026-09-07. Владелец delivery назначается командой; локальный агент не
подменяет решения владельцев инфраструктуры и данных. Этот список сохраняет
исходные незавершённые обязательства 008. Локальные проверки и корпоративная
приёмка учитываются раздельно.

Для передачи команде внедрения используйте [комплект деплоя](../deployment/README.md):
паспорт, шаблоны IN-01…IN-12/DeploymentPolicy/env, настройки инфраструктуры,
перечень изменений в pipeline и порядок запуска/отката.

## Нужна реализация в репозитории: T025

Все 184 задачи 007 закрыты локальными доказательствами. T176 прошла настоящий
Compose smoke: семь рестартов, один Jira worker effect/Work Item, подпись, браузер
и полная scoped очистка. См. [smoke и CI](onboarding-compose-smoke.md).
T106 закрыта независимым multi-principal HTTP journey с настоящими
поиском, очередью, событиями, файлами, подписями, экспортом и отзывом прав.
См. [изоляцию проектов и внедрение](project-scope-journey.md).
T059 закрыта: новый проект проходит HTTP onboarding и старт ручной Session
с отдельными API/worker, PostgreSQL 17/18 и сохранением v2 snapshot.
См. [инструкцию переноса и upgrade SQL](manual-onboarding-journey.md).
T155 закрыта независимым
HTTP/PostgreSQL/child-worker сценарием с нулём effects во время suspension и одним
новым effect после согласованного resume. См. [operations runbook](project-operations-http.md).

T091 закрыта: binding publish/retire/rollback и pilot activation используют
PostgreSQL, exact approval и текущие gates/lease. Registry, entitlements,
QA resources/leases, validation/acceptance/L0 и requested probe worker теперь
тоже имеют durable реализацию. T071 закрыта с OpenAPI 1.1: все 18 onboarding
операций, response DTO/status/ETag и replay проверены на PostgreSQL 17/18.
См. [onboarding runbook](onboarding-http.md) и
[внедрение контракта](onboarding-openapi-convergence.md).

T142 закрыта: evidence HTTP использует PostgreSQL и настоящую подпись,
проверены correction/export, rollback, повторный запрос после рестарта и Chromium.
Точки подключения корпоративных policy/signer/MFA описаны в
[evidence HTTP runbook](evidence-http.md). Onboarding/evidence API теперь
подключён через `CorporateOnboardingModule`; полный корпоративный host ещё
требует оставшихся QA/intake/queue и worker providers.

- [ ] Собрать корпоративный прикладной API в `apps/api/src/app.module.ts` и новом
      `apps/api/src/corporate-main.ts`. Сейчас `PilotNonLocalApiModule` регистрирует
      Health/Pilot и опциональный corporate onboarding/evidence API. Добавить guarded
      controllers и обязательные типизированные providers; отсутствие любого
      обязательного provider должно прерывать запуск.
- [ ] Подключить корпоративную сессию/CSRF/step-up к BFF и всем прикладным маршрутам.
      Использовать `CorporateSessionService`, `PinnedOidcTokenVerifier`,
      `CorporateQaHttpIdentity`, корпоративный `QueueHttpAuthority` и текущие права
      Core. Не подключать `LocalPersonaSessionService` и локальные конфигурации.
- [ ] Собрать QA providers из `PublishedQaSessionRuntime`,
      `PublishedQaReadinessFacts`, `DurableQaReadinessRuntime`, `PublishedQaDodPolicy`
      и durable verdict/completion/defect approval. Для CI artifacts подключить только
      scoped GitLab reader; manual binary upload в v1 отсутствует.
      Настройки брать из опубликованных exact refs для каждого проекта. Реальный
      intake configuration и response channels не должны брать `qaLocalSeedIds`.
- [x] Подключить в корпоративном API module `DurableRegistryHttpApplication`,
      `DurableResourcesHttpApplication`, `DurableValidationHttpApplication`,
      `DurableBindingHttpApplication` и `DurableProjectOperationsApplication`.
      Выполнено в `CorporateOnboardingModule` с тем же корпоративным BFF/identity,
      явными `AccountInventoryPort` и evidence crypto/policy providers. Проверены
      HTTP registration/grants/suspend/incident/evidence/export, PostgreSQL 17/18,
      OIDC/Vault fixtures, restart, IdP narrowing, CSRF/step-up и revocation.
      См. [точки подключения и IAM](corporate-onboarding-api.md).
- [ ] В корпоративном entry point передать утверждённые account inventory,
      signer/public-key-history/policy providers; requested probes подключить к
      текущим SERVICE authority и read-only provider observers из worker assembly.
- [ ] Собрать worker host в `apps/worker/src/corporate-main.ts`. Внедрить реальную
      domain authority в каждом из десяти обработчиков ниже. Текущий
      `PilotNonLocalWorkerAppModule` проверяет набор ключей и наличие фаз, но функция
      с `SELECT 1` может удовлетворить этому контракту: это проверка регистрации,
      а не выполнения бизнес-операции.

| Worker key                      | Что подключить/проверить                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `qa-jira`                       | Durable command delivery, Jira create/import/action/defect/completion; exact approval, live grants, read-back после неопределённого результата |
| `mattermost`                    | Persisted notification/interaction intents, корпоративный client factory и purpose-scoped lease, current effect fence                          |
| `queue.foundation`              | `createQueueFoundationWorkerRuntime`, источник фактов, проекция, admission и rebuild                                                           |
| `artifact-retention`            | Immutable retention decisions/holds, availability lifecycle; отдельное разрешение на физическое удаление                                       |
| `project-onboarding-events`     | Persisted outbox/subscriptions и scoped idempotent consumers                                                                                   |
| `project-onboarding-probes`     | Настоящие provider observers, точные pins и persist свежести; не development emulator                                                          |
| `project-suspension-recovery`   | Текущие incident/approval/probe факты и effect fence                                                                                           |
| `gitlab.automation-trigger`     | Published suite/ref/SHA, approved command authority и корпоративный GitLab factory                                                             |
| `gitlab.webhook-reconciliation` | Проверенный ingress, authoritative reads, bounded retry/read-back                                                                              |
| `gitlab.automation-events`      | Durable event consumer, scope/attempt lineage и human review boundary                                                                          |

- [ ] `CorporateConnectorFactories` использовать как транспорт для этих domain
      handlers. Нынешнее создание factories в `pilot/composition.ts` само по себе
      не подключает их к локальным Jira/GitLab/Mattermost worker services.
- [ ] Написать локальный тест собранных corporate entry points с controlled HTTP
      dependencies и PostgreSQL: запрос → разрешённое действие → durable command →
      реальный domain worker → один HTTP effect → persisted confirmation; повторить
      после рестарта. Пройти также отсутствие identity/provider, cross-project deny,
      отозванные права, неверную подпись, outage, неизвестный результат и duplicate
      delivery. Проверить маршруты всех доменов, а не только `/health/ready`.
- [ ] Добавить release images и `tools/deploy/corporate-release.sh` по
      [инструкции GitLab](gitlab-pipeline.md); запустить собранные images без исходного
      workspace. Только после этих доказательств закрыть T025.

## Внешние данные и работа на стенде

| Задача          | Ответственный профиль                           | Что получить/добавить                                                                         | Где                                                                    | Условие закрытия                                                                                                             |
| --------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| T040 / C1       | Владельцы Jira/GitLab/Mattermost, IAM, security | Реальные версии/диалекты/права/ограничения, sanitised samples, IN-01…IN-12                    | `config/pilot/provider-capabilities.json`, корпоративный input package | Выбранная стратегия поддерживается и подтверждена установленными провайдерами                                                |
| T057 / N2       | Integration owner + QA                          | Реальные fault/rotation/ingress/identity/telemetry observations, независимый счётчик эффектов | `AWP_008_N2_EVIDENCE_BUNDLE`, `verify:008:integration -- --input …`    | Все обязательные conformance assertions PASS на конкретном стенде                                                            |
| T084 / recovery | SRE/DBA + security                              | Backup target, fence policy, RPO/RTO, approval, actual drill receipts                         | IN-08, `feature-008-recovery.mts`, `pilot-recovery.md`                 | Доработан corporate drill/result wrapper; реальные restore/fence/reconcile времена и отсутствие duplicate write подтверждены |
| T104 / shadow   | QA Lead + integration owner                     | Одобренная выборка, live observations, human-reviewed diff                                    | `feature-008-shadow.mts`, shadow bundle                                | Настоящий shadow window пройден, внешних business writes ноль                                                                |
| T105 / pilot    | Sponsor + QA Lead + on-call                     | Exact human activation, ограниченный cohort, даты/размер выборки, источник метрик             | `observation-worker.ts`, `limited-pilot.json`                          | Истекло реальное окно, достигнут sample, записаны семь guardrails и source evidence                                          |
| T106 / P3       | Sponsor + independent reviewer                  | Полный provenance, сверка baseline, решения о rollout/rollback                                | `feature-008-review.mts`, review bundle                                | Приёмка наблюдённого pilot подтверждена человеком                                                                            |

`feature-008-recovery.mts` сейчас при валидных входах всё равно возвращает
`CORPORATE_DRILL_RESULT_REQUIRED`: он проверяет предпосылки, но не является готовым
драйвером восстановления. Одной выдачи переменных CI для закрытия T084 недостаточно.

Suspend/resume HTTP и миграция Core 195 описаны в
[project operations runbook](project-operations-http.md).

## Где подключить инфраструктуру

| Компонент        | Настройка                                                                                                 | Место в проекте                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| PostgreSQL       | Изолированная БД/роль, TLS, backups, migration role, runtime role без DDL                                 | `createRuntimeDataSource`, published deployment, migration job                         |
| OIDC             | Issuer/audience/JWKS, redirect/callback URL, группы, сроки сессии, step-up                                | `platform-runtime-nest/src/auth`, `runtime-composition/src/security`                   |
| Vault            | Workload auth, mount/namespace, версии секретов, purpose-scoped mapping, remote signer/public-key history | `vault-http-client.ts`, `vault-secret-resolver.ts`, corporate factories                |
| Jira             | Project/issue types/workflow/fields, service principal, отдельные read/write permissions                  | Published bindings/profile/connection; `connector-factories.ts`                        |
| GitLab           | Numeric project, ref/commit/Suite, API/trigger/HMAC credentials по назначению                             | Published bindings; GitLab client/auth + signed ingress                                |
| Mattermost       | Team/channel/bot, mTLS gateway, trusted persisted human intent                                            | Corporate ingress + scoped connector factory                                           |
| GitLab artifacts | Project/ref/job scope, checksum, retention и classification                                               | Scoped GitLab reader, published source/retention policy; без платформенной копии bytes |
| Telemetry        | Collector backend/TLS/CA, редактирование полей, недоступность export/readiness                            | `infra/observability/otel-collector.corporate.yaml`, runtime telemetry bindings        |
| Hermes/model     | Разрешённая модель/endpoint, опубликованная policy, redaction/caps; запрет прямых effects                 | `runtime-composition/src/hermes`, published model policy                               |
| Network/Ingress  | DNS/IP/method/path allowlist, CA, route/body limits, исходные signed bytes                                | `PinnedNetworkTransport`, deployment endpoints, trusted ingress                        |

Точные вопросы владельцам и схемы пакетов:
[pilot-inputs.md](../../specs/008-pilot-hardening-and-conformance/pilot-inputs.md),
[pilot-integration-intake.md](pilot-integration-intake.md),
[pilot-infrastructure.md](pilot-infrastructure.md). Фиктивные идентификаторы,
локальные secret refs и mock scan отчёты не копировать в корпоративную конфигурацию.

## Решение о выпуске

- [ ] Source/lockfile/configuration/image digests соответствуют проверенной версии.
- [ ] T025 и все шесть задач стендовой приёмки закрыты своим доказательством.
- [x] 007/T106 закрыта независимым multi-principal journey.
- [x] 007/T176 закрыта полным Compose smoke; повторять `pnpm smoke:007` для новой сборки.
- [ ] Секреты выдаются workload identity; raw material отсутствует в Git/artifacts.
- [ ] Проверены schema preflight, восстановление, draining, fencing и rollback.
- [ ] Назначены on-call, владельцы интеграций, sample/window и критерии остановки.
- [ ] Защищённое ручное approval разрешает конкретный release manifest.

Этот чек-лист не даёт разрешение на внешние записи или deploy. Он делает состав
оставшейся реализации и приёмки проверяемым; текущий локальный результат их не закрывает.

## Внедрение локально закрытой T071

Каталог/регистрация, entitlement GRANT/REPLACE/REVOKE, QA environments/context/
resources/account leases, binding validation/acceptance и L0 теперь сохраняются
через HTTP в PostgreSQL. Демонстрационный `LocalOnboardingApiApplication` удалён.
Точные команды, версии CAS, inventory и монтаж providers:
[onboarding-http.md](onboarding-http.md).

- [ ] Для выката добавить QA migration **2110** в migration job; текущий QA schema
      pin — 2110, Core — 200. Учесть ограничение downgrade после нескольких публикаций.
- [ ] Смонтировать `AWP_QA_ACCOUNT_INVENTORY_FILE` или corporate AccountInventoryPort;
      привязать реальные opaque account handles к отдельному credential resolver.
- [x] Локально реализованы requested probes через worker и FULL_QA/accepted Suite
      evaluation; proof и ограничения описаны в onboarding HTTP runbook.
- [x] Завершена T071: маршруты и HTTP response DTO/status/ETag соответствуют
      onboarding OpenAPI 1.1; 18 операций и legacy compatibility проверены локально.
      См. [правила совместимости и внедрение](onboarding-openapi-convergence.md).

- [x] T059 проверена независимыми API/worker процессами до старта ручной Session;
      automation в MANUAL_ONLY отклоняется, audit rollback и restart сохраняют refs.
- [ ] Для существующих Context v2 выполнить повторяемый
      [upgrade SQL](sql/qa-context-v2-identities.sql) после миграций и до QA intake;
      `missing_context_identities` должен быть 0. Доставить manual/automated guards,
      v2 snapshot capture и расширенный audit одной сборкой.

- [x] T106 проверена на PostgreSQL 17/18, включая строгий потолок сессии,
      текущие DENY/expiry, classification, HTTP revoke, cursor replay и API restart.
- [ ] Подключить `ProjectReadsController`, identity authorization для каталога,
      новые read routes и current authority/ceiling в очередь одной сборкой. Учесть
      404 для недоступного ресурса и 409 для устаревшего курсора; точные файлы и CI:
      [project-scope-journey.md](project-scope-journey.md). Дополнительной миграции нет.

Локально закрыты 1342/1349 задач. Остались одна локальная задача
008/T025 и шесть задач корпоративной приёмки.
Незавершённые пункты монтажа выше остаются обязательными для выката.
