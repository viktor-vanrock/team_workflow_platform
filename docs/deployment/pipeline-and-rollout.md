# Что добавить в pipeline и как выполнить внедрение

Для запуска одной QA-области и приёма проектов используйте [первую установку](initial-qa-workspace.md). Ниже описан полный корпоративный QA-пилот.

[Комплект деплоя](README.md) · [Форма фиксации результата](templates/deployment-passport.md)

## 1. Доработки в репозитории перед корпоративным запуском

Это требования к реализации, **не уже работающие команды деплоя**.

| Где                                                                                | Что добавить/подключить                                                                                         | Критерий готовности                                                                                   |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `apps/api/src/corporate-main.ts`                                                   | Approved factories, initialized DataSource, startup и полный non-local API bundle                               | Реальные корпоративные auth/onboarding/evidence/QA/intake/queue HTTP, нет local routes/fallback       |
| `apps/worker/src/corporate-main.ts`                                                | Те же policy/schema/network и десять domain contributions                                                       | HTTP → durable command → отдельный worker → ровно один provider effect, включая lost response/restart |
| `packages/runtime-composition/src/pilot/composition.ts` и owning factories         | Полные bindings: published configuration, IAM/secret resolver, artifacts/model/telemetry, repositories/services | Отказ при отсутствующем/устаревшем/чужом ref и при недопустимых credentials                           |
| Предлагаемые новые `infra/deploy/docker/backend.Dockerfile`, `web.Dockerfile`      | Общий backend image с двумя entry points и отдельный web image; pin dependencies/base images                    | Запуск без bind mount репозитория; фактические digest/SBOM/FULL scan каждого образа                   |
| Предлагаемые новые `tools/deploy/corporate-migrate.mts`, `corporate-bootstrap.mts` | Единственный migration runner и проверенная публикация начальных IAM/config/registry revisions                  | Чистая БД и upgrade существующей, согласованные schema versions, нет local seed                       |
| `tools/deploy/corporate-release.sh`                                                | Реальная доставка в выбранную платформу, проверки, lock, migration/probes/rollback                              | Скрипт отсутствует сейчас; контракт входа, recovery и ошибки подтверждены на стенде                   |
| `.gitlab-ci.yml` и corporate CI config                                             | Package/scan, bootstrap integration, conformance, promotion и сохранение evidence                               | Jobs привязаны к одному commit/images/config/scope; stale evidence не даёт release                    |
| `tools/verification/feature-008-recovery.mts`                                      | Approved corporate executor/result wrapper (T084)                                                               | Фактический PITR/fence/reconciliation/RPO/RTO; входной JSON не превращается в drill PASS              |
| `apps/web/src/App.tsx` / corporate routing                                         | Проверить и завершить нужные QA/onboarding routes с corporate BFF                                               | Browser journey без persona API, с real session/step-up/CSRF, включая deep links                      |

Десять worker keys текущей сборки:

```text
qa-jira
mattermost
queue.foundation
artifact-retention
project-onboarding-events
project-onboarding-probes
project-suspension-recovery
gitlab.automation-trigger
gitlab.webhook-reconciliation
gitlab.automation-events
```

Наличие функций под этими ключами и `health/ready=200` не доказывает domain flow.
Для API уже готов [CorporateOnboardingModule](../runbooks/corporate-onboarding-api.md);
подключение остальных providers и acceptance перечислены в
[исходном checklist T025](../runbooks/pilot-deployment-checklist.md).
Backend `build` сейчас проверяет типы. Release build должен либо поставлять TS,
`tsx` и все workspace dependencies, либо создавать проверенный JS runtime.

## 2. GitLab: runner, переменные и jobs

Текущий [root pipeline](../../.gitlab-ci.yml) запускает `verify:local`:
`pnpm ci:008` (включает `ci:project`) и `pnpm smoke:007`. Настроить выделенный
Linux shell runner `awp-local-linux` с Node `24.20.0`, pnpm `11.21.0`, Docker/Compose,
Chromium dependencies, полным Git checkout и доступом к реестрам. Порты, ресурсы и
изоляция daemon описаны в [GitLab runbook](../runbooks/gitlab-pipeline.md).

Для корпоративных jobs зарегистрировать отдельный protected runner
`awp-corporate-nonprod`, доступный только доверенному коду проекта. Выдать ему
registry/secret-store/deploy access по workload identity и доступ в утверждённый
NON_PROD. Runtime secrets не выдавать job `verify:local`.

В **Settings → CI/CD → Variables** добавить:

| Ключ                     | Тип / значение                                                   | Scope в текущем примере |
| ------------------------ | ---------------------------------------------------------------- | ----------------------- |
| `AWP_CORPORATE_PILOT`    | Variable, `1`, Protected                                         | `*`                     |
| `AWP_INPUT_PACKAGE_FILE` | File, содержимое полного принятого input package JSON; Protected | `*`                     |
| `AWP_N2_EVIDENCE_FILE`   | File, содержимое реального N2 bundle; Protected                  | `*`                     |

GitLab File variable передаёт job **путь к временному файлу**. Пример копирует его
в `.pipeline-inputs/`; `AWP_DEPLOYMENT_CONFIG` runtime, напротив, ожидает JSON
содержимое. Для JSON отключить variable expansion. File variables не обходят
лимит значения 10 000 символов: если пакет больше, внедрить получение из
защищённого versioned artifact/secret store и проверку hash до запуска verifier.
Многострочный JSON может не отвечать ограничениям Masked; input/evidence bundles
должны быть без секретов. [Правила GitLab variables](https://docs.gitlab.com/ci/variables/).

У `corporate:inputs` в существующем примере **нет `environment`**. Поэтому variables,
ограниченные только `corporate-nonprod/pilot`, этому job недоступны. Scope `*` выше
нужен именно для текущего примера, вместе с Protected/ограниченным runner. Если
корпоративная политика требует environment scope, сначала изменить job и
проверить доступность variables для обоих этапов. Секреты доставки хранить
отдельно и выдавать только соответствующему deploy workload.

После реализации release host подключить пример в root `.gitlab-ci.yml`, сохранив
существующие stages/default/jobs:

```yaml
include:
  - local: ".gitlab/ci/corporate-pilot.example.yml"
```

Перед применением прогнать CI Lint установленного GitLab. В
[примере](../../.gitlab/ci/corporate-pilot.example.yml) оба job ручные, требуют
protected ref и `AWP_CORPORATE_PILOT=1`. `corporate:inputs` проверяет готовые N2
материалы; `corporate:release` пока проверяет наличие delivery файлов и вызывает
ещё не реализованный скрипт. Это не полный release gate: добавить проверку
security/recovery/shadow/activation и связь с точным выпускаемым артефактом.

Защитить environment `corporate-nonprod/pilot`, назначить deployers/approvers и
сериализовать deploy/restore одним lock. В примере есть
`resource_group: awp-corporate-pilot`, `interruptible: false`.
[Resource groups](https://docs.gitlab.com/ci/resource_groups/) работают в рамках
проекта; для общей среды разных репозиториев нужен общий deployment lock.
[Protected environments](https://docs.gitlab.com/ci/environments/protected_environments/)
зависят от GitLab tier (Premium/Ultimate); проверить доступность и оформить
эквивалентный контроль доступа, если функция недоступна.

## 3. Первый запуск integration

`corporate:release` не использовать как bootstrap: ему уже нужен N2. Добавить
отдельный ручной bootstrap job для `integration` с approved scope и разрешёнными
только действиями conformance. Он не должен объявлять пилот активным.

Порядок оператора после завершения пункта 1:

1. Зафиксировать commit, общий backend и web OCI digests, SBOM/scans, полный
   input package, policy refs и конфигурацию среды в паспорте. Локальные отчёты
   должны соответствовать проверяемой ревизии; исторический PASS недостаточен.
2. Проверить инфраструктуру, IAM, network, secret delivery, backup и назначенного
   restore owner. `integration` startup требует все 12 metadata entries и current
   publications, но не уже выполненный N2 provider run.
3. Для существующей БД остановить изменения/приём новых команд, осушить или
   зафиксировать in-flight effects и установить fence. Сделать recovery point;
   новые runtime пока не имеют разрешения на business writes.
4. Провести schema preflight и миграцию одним job, затем initial publications
   через approved bootstrap. Поднять API/worker с одинаковой policy и backend
   digest. Не ждать готовности API, прежде чем вообще запустить worker: readiness
   требует peer agreement. Startup grace должен учитывать bootstrap обоих.
5. Настроить web/ingress/Collector, проверить `/health/live` и `/health/ready`
   у обоих процессов. Readiness должна оставаться неготовой при отсутствующем
   peer/устаревшей конфигурации, а после полноценного startup стать 200.
6. До автоматических браузерных проверок на новой установке выполнить первый
   проверенный корпоративный вход выбранного администратора. Назначить рабочие роли
   через `/admin/users`; проверить, что следующий пользователь без назначений ожидает доступа.
   Не полагаться на группы Keycloak: [контракт доступа](corporate-access.md).
7. Выполнить корпоративные браузерные и provider сценарии, scope/CSRF/step-up
   negatives, queue/restart/lost-response proof, telemetry и независимый readback.
   Работать только в согласованном NON_PROD scope. Сохранить raw evidence в
   утверждённом хранилище с redaction и immutable provenance.

### Миграции и initial publications

Для полного composition текущие версии: **Core 235, Dummy 1000, Tech Writing 1100,
QA 2110, Jira 3050, GitLab 4020**. Dummy и Tech Writing входят в общий persistence
registry; не исключать их миграции из корпоративного migration job.
Изменения прав и bootstrap 220/225/230 требуют [проверок после обновления](upgrade-and-verification.md).
Источник — `runtimePersistence(composition).expectedVersions` в
[общем registry](../../packages/runtime-composition/src/pilot/composition.ts).
DataSource использует `typeorm_migrations`, `synchronize: false`,
`migrationsRun: false`, transaction mode `all`. Обычный старт не мигрирует БД.
Существующая CLI migration допускает только local profile; corporate migration
job нужно реализовать, не запускать `pnpm local:*` на корпоративной БД.

Для upgrade с существующей схемой Core 185+ перед 0190 выполнить read-only preflight
в maintenance window с настроенным libpq connection/TLS, не выводя credentials:

```sh
psql -X --set ON_ERROR_STOP=1 --file docs/runbooks/sql/0190-project-scope-preflight.sql
```

Скрипт требует существующие таблицы; на пустую БД его не запускать. Ненулевые
orphan counts расследовать и исправлять через владельца данных, не удалять строки
для обхода constraint. Между preflight и миграцией writers остаются остановленными.

После основных миграций для переноса старых QA contexts выполнить предусмотренный
[upgrade SQL](../runbooks/sql/qa-context-v2-identities.sql) по
[manual onboarding runbook](../runbooks/manual-onboarding-journey.md).
Этот второй скрипт **изменяет данные**: включить его в план backup/миграции и
проверить нулевой остаток отсутствующих identities. Для новой БД применить полный
registry и штатно создать context/identity через corporate services.

Опубликовать accepted input package, identity/network/resolver/signing/artifact/
telemetry/model/recovery policies, connector profiles/connections/bindings и
deployment head с реальными UUID, сроками, review и exact refs. Startup читает
эти публикации в PostgreSQL; заполненный JSON в env их не создаёт. Не копировать
fixture SQL/seed identities в initial corporate bootstrap.

## 4. Доказательства и допуск пилота

Команды ниже существуют и запускаются из корня с доставленными файлами.
Они валидируют соответствующие inputs/evidence; не создают внешние наблюдения
или человеческое одобрение. Подробные форматы — в
[intake runbook](../runbooks/pilot-integration-intake.md).

```sh
pnpm verify:008:inputs -- --input .pipeline-inputs/inputs.json --stage N2
AWP_008_N2_EVIDENCE_BUNDLE=.pipeline-inputs/n2.json pnpm verify:008:integration -- --input .pipeline-inputs/inputs.json
```

Передавать security verifier фактический digest каждого выпускаемого образа и
его FULL scan bundle, полученный от корпоративного scanner:

```sh
AWP_008_RELEASE_IMAGE_DIGEST="$RELEASE_IMAGE_DIGEST" AWP_008_RELEASE_SCAN_BUNDLE=.pipeline-inputs/scan.json pnpm verify:008:security
```

`RELEASE_IMAGE_DIGEST` здесь — shell/CI значение из release record, **не новая
runtime переменная**. Проверить `security.json.corporateRelease.status=PASS` и
`releaseEligible=true`. Общий local security PASS этого не заменяет. Сохранить
отдельный результат каждого image до следующего вызова: верхнеуровневый report
может перезаписываться. Закрыть CRITICAL/HIGH; допустимые исключения оформлять
только по действующей finding policy.

Далее T084: фактический PITR в отдельную approved target, fence старого runtime,
rebuild queue, offline signatures/artifacts/audit и independent provider readback,
измеренные RPO/RTO. Текущий `verify:008:recovery -- --input ...` проверяет inputs,
но возвращает `BLOCKED_INPUT / CORPORATE_DRILL_RESULT_REQUIRED` даже при полной
форме: corporate executor/result wrapper ещё необходимо реализовать.

После N2/security/recovery выполнить реальный shadow без business writes и human
review различий, затем валидировать bundle:

```sh
pnpm verify:008:shadow -- --input .pipeline-inputs/shadow.json
```

При human activation указать точные Project, deployment/policy refs, cohort,
окно/выборку и текущие gate evidence. Только после этого разрешить пилотные
business effects. T105 собирает реальные наблюдения; T106 проверяет окно,
выборку, provenance и review:

```sh
pnpm verify:008:review -- --input .pipeline-inputs/observed-pilot.json
```

Для `pilot` использовать согласованные publications и актуальные scope/fingerprints;
смена digest/config/issuer/binding требует оценки и обновления зависимых evidence.
Ожидание времени, input PASS или локальные fixtures не закрывают T104–T106.

## 5. Откат, остановка и передача эксплуатации

В release wrapper реализовать проверяемые этапы: validate exact release inputs →
lock → backup/fence → migration/publication → deploy → readiness/business checks →
сохранение результата/разрешение следующего этапа. Формат release record и способ
его передачи wrapper пока не реализованы; заполненный паспорт задаёт требования
к этому контракту, но скрипт не читает Markdown автоматически.

Остановить rollout при digest mismatch, недоступной readiness, IAM/CSRF/scope
нарушении, неподтверждённом или повторном effect, потере evidence/telemetry либо
превышении согласованных error/RPO/RTO порогов. Зафиксировать incident/run ID,
закрыть новые команды/egress, suspend/fence все затронутые runtime.

Оператор и DBA выбирают совместимый rollback image **и** policy/schema target.
Автоматический down migration или восстановление поверх работающей БД не
допускаются этим планом. Restore выполнять в отдельной цели при fenced старом
runtime; неоднозначные Jira/GitLab/Mattermost effects сначала читать и сверять,
не повторять write. Offline verification, immutable history и audit должны
сохраниться. Resume требует актуальных probes/incident disposition и отдельного
точного approval по [operations runbook](../runbooks/project-operations-http.md).

Заполнить фактические времена/RPO/RTO, решение go/hold/rollback, evidence refs и
подписантов в паспорте. Проверить on-call, alert route, access handover, backup
schedule и срок следующего review. Сохранить версии inputs/config/images,
отчёты и ссылки в корпоративном хранилище с утверждённым retention; CI artifacts
служат дополнительной копией. Секреты и исходные payload в отчёты не включать.
