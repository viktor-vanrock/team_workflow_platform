# Локальные HTTP-адаптеры onboarding

В `apps/api/src/extensions/onboarding/` работают `registry.application.ts`,
`resources.application.ts`, `validation.application.ts`. `onboarding.controller.ts`
больше не использует демонстрационный `LocalOnboardingApiApplication` и сценарий
из памяти. `QaJiraMattermostLocalApiModule` в `apps/api/src/app.module.ts`
регистрирует обязательные providers `REGISTRY_HTTP_APPLICATION`,
`RESOURCES_HTTP_APPLICATION`, `VALIDATION_HTTP_APPLICATION`; производные локальные
модули получают их через import.

T071 закрыта локально: новый контракт onboarding OpenAPI 1.1 реализован на
`/api/v1/...`, включая response DTO/status/ETag, обязательный CAS, schema validation
и immutable replay. Все 18 операций проверены через HTTP на PostgreSQL 17/18.
Формы ответов и правила совместимости описаны в
[onboarding-openapi-convergence.md](onboarding-openapi-convergence.md).
Оценка FULL_QA по принятому Suite и выполнение requested connector probes через
worker описаны ниже. Таблица ниже сохраняет контракт legacy-адаптера `/v1/...`.
T059 закрыта независимым сценарием API/PostgreSQL/worker до старта ручной Session;
см. [manual-onboarding-journey.md](manual-onboarding-journey.md).
Полный process smoke T176 закрыт: [Compose proof и CI](onboarding-compose-smoke.md).
Corporate composition остаётся 008/T025.
Полный `ci:project` после этих изменений не запускался.

## Маршруты и версии

Префикс `B=/v1/workspaces/:workspaceId/projects`. POST требуют проверенную сессию
и `Idempotency-Key` длиной 8–256 символов. Повтор возвращает сохранённый результат,
другой payload с тем же ключом — 409. Права проверяются заново и при повторе.
Сильный `If-Match` передаётся как `"N"`; слабые ETag запрещены.

| Маршрут относительно B                           | Текущее поведение и предусловия                                                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /`                                          | Авторизованный каталог, `limit=1..100` (по умолчанию 50), `cursor`. Метаданные читаются после проверки текущих прав; курсор привязан к пользователю, Workspace и текущему результату |
| `POST /`                                         | 201: `projectId`, DRAFT version 1, exact onboarding/registry/starter refs. Нужны Workspace `project.register`, роль workspace-owner и свежее MFA                                     |
| `GET /:projectId/onboarding`                     | 200: текущие поля проекта, refs, сохранённые gates/probes; сильный ETag равен версии onboarding                                                                                      |
| `POST /:projectId/entitlements`                  | 201: GRANT, `entitlementId`, `version`, `resultRef`, `onboardingVersion`                                                                                                             |
| `POST /:projectId/entitlements/:id/replace`      | 201: REPLACE; If-Match — текущая версия entitlement. Получатель не меняется                                                                                                          |
| `POST /:projectId/entitlements/:id/revoke`       | 201: REVOKE; If-Match — версия entitlement; тело `{reason}`                                                                                                                          |
| `POST /:projectId/qa/environments`               | 201: exact environment ref. Следующая публикация того же ID требует If-Match версии environment                                                                                      |
| `POST /:projectId/qa/resources/test-data`        | 201: DATASET/PREPARATION_PROCEDURE. Следующая версия требует If-Match версии ресурса                                                                                                 |
| `POST /:projectId/qa/resources/account-pools`    | 201: ACCOUNT_POOL. Следующая версия требует If-Match версии pool                                                                                                                     |
| `POST /:projectId/qa/context`                    | 201: exact context ref; существующий контекст требует If-Match версии context                                                                                                        |
| `POST /:projectId/qa/account-leases`             | 201: lease ID/ref, version, expiresAt. Проверяются среда, pool, классификация, scoped subject и вместимость                                                                          |
| `POST /:projectId/qa/account-leases/:id/release` | 201: новая ревизия; только текущий владелец lease, If-Match версии lease                                                                                                             |
| `POST /:projectId/bindings/:id/validate`         | 201: structural validation report, `VALID`/`INVALID`, bindingState, resourceVersion, onboardingVersion; If-Match — **row_version binding header**                                    |
| `POST /:projectId/bindings/:id/acceptances`      | 201: QA-lead фиксирует ACCEPTED/REJECTED для exact binding/report/current context/checklist/resource refs                                                                            |
| `POST /:projectId/onboarding/evaluations`        | 201: L0 `PASS`/`BLOCKED_INPUT`, SHADOW/NEEDS_FIX, версия onboarding. If-Match — версия onboarding                                                                                    |

Публикация/retire/rollback binding и pilot activation используют отдельное
одобрение: [binding-http.md](binding-http.md). Их If-Match относится к onboarding,
а не к binding header.

`principalId` в GRANT/REPLACE обозначает получателя. Исключение разрешено только
декоратором `TargetPrincipalCommand` на конкретном серверном handler. `actor`,
`actorId`, `roles`, `authorizationBasis`, `workspaceId`, `projectId` в теле запрещены.
Для изменения прав нужны текущие `project.entitlement.grant/revoke`, роль
workspace-owner и MFA не старше пяти минут. Новый получатель должен быть активным
участником Workspace; отзыв допускается и после выхода получателя из Workspace.
Назначаемая классификация ограничена текущими правами администратора.

Регистрация создаёт только минимальные стартовые права регистратора:
catalog.read, onboarding.read, entitlement.grant/revoke и scoped role assignment.
Переданные owner IDs должны быть действующими human identities. Регистрация не
создаёт интеграции, provider credentials или произвольные технические роли.

## QA-ресурсы и account inventory

Публикация ресурса атомарно сохраняет immutable revision, меняет head, сбрасывает
gates и возвращает onboarding в VALIDATING/MANUAL_ONLY. Изменение context также
обновляет exact context ref. Права проверяются по текущим Core grants, а не по
декларируемой роли в JSON. Контекст не может включать ресурс с более высокой
классификацией, чем его maximumClassificationKey.

Перед запуском API смонтировать файл без credentials и задать абсолютный путь
`AWP_QA_ACCOUNT_INVENTORY_FILE`. Текущий адаптер — `FileAccountInventory`.
Файл содержит массив записей:

```json
[
  {
    "id": "qa-local-accounts",
    "version": 1,
    "workspaceId": "<workspace-uuid>",
    "projectId": "<project-uuid>",
    "opaqueAccountRefs": ["accountref://qa-local/account-1"]
  }
]
```

В `resolverRef.key` pool указать `file-account-inventory`. `resolverRef.resourceRef`
должен содержать ID/version этой записи и SHA-256 её канонического JSON,
полученный функцией `sha256` из `@awp/platform-contracts` (сначала подставить UUID).
`schemaRef` описывает схему внешнего ресурса; это ссылка, не credential.
Отсутствующий inventory или неподдерживаемый resolver даёт 503 и не создаёт lease.
Слот не выдумывается из количества аккаунтов.

Acquire принимает `environmentRef`, `accountPoolRef`, `subjectRef` вида
`work-item:<uuid>` или `session:<id>`, `purpose`, `requestedUntil`.
Субъект должен существовать в том же проекте. TTL ограничен pool и максимумом
604800 секунд. Проверяются current published environment/pool, лимит pool и
занятость слота в проекте. Истёкшие leases получают новые EXPIRED revisions
при следующем acquire. Credentials в HTTP-ответ не входят. Их отдельное разрешение
для тестового исполнителя остаётся задачей runtime credential adapter.

## Validation и границы локальных доказательств

Validation проверяет immutable hashes, текущие published profile/connection/mapping
refs, среду, классификацию и обязательные manual roles/operations. Результат не
является сетевой проверкой установленного connector. Для непустого `probeKeys`
API отдельно создаёт durable запрос; worker записывает сетевые observations.

QA acceptance требует текущий успешный report, опубликованный context и допустимый
checklist; клиент не может принять ресурс из другого context/configuration.
L0 требует опубликованный binding с текущей QA acceptance и свежие immutable
observations всех manual operations, привязанные к точному validation report,
profile/connection/mapping и binding. Отсутствующие/просроченные наблюдения дают
BLOCKED_INPUT. Явный запрос `requestedCapabilityMode: FULL_QA` дополнительно проверяет
принятый Suite и восемь автоматизированных операций; условия приведены ниже. C1/N2/P3 не создаются по клиентскому запросу, их должен поставлять pipeline.

## Подключение к настоящему pipeline

1. В migration job применять полный registry, включая Core migration **0200** и QA migration **2110**;
   ожидаемые версии: Core **200**, QA **2110**. Исторические migrations не менялись.
   2110 разрешает хранить несколько immutable PUBLISHED snapshots environment;
   текущую публикацию выбирает header. Downgrade откажет при наличии нескольких
   публикаций одного environment — сначала требуется план миграции данных.
2. В corporate composition добавить эти три services, OnboardingController,
   PublishedOnboardingController и PublishedProjectOperationsController
   с corporate DataSource, QaSessionGuard/QA_HTTP_IDENTITY. Не импортировать
   QaJiraMattermostLocalApiModule в corporate runtime. Этот монтаж относится к T025.
3. IAM должен выдать Workspace project.register только уполномоченному owner,
   настроить MFA и scoped roles/entitlements администраторов, QA lead и исполнителя.
   Local persona/seed IDs на стенд не переносить.
4. Для аренды смонтировать версионированный inventory с реальными opaque handles
   или заменить AccountInventoryPort корпоративным адаптером. Credentials хранить
   отдельно; обеспечить связь handle с runtime credential resolver.
5. Подключить `createRequestedCapabilityProbeWorker` и периодический maintenance
   worker к реальным connector observers, сохранять точные probe/report refs.
   Для FULL_QA использовать текущий принятый Suite, как описано ниже.
   Независимый API/worker journey T059 проверен локально. Для ручной Session
   доставить v2 snapshot capture и выполнить upgrade SQL по
   [инструкции T059](manual-onboarding-journey.md).
6. Для внешних onboarding clients использовать OpenAPI 1.1 и `/api/v1/...`.
   Доставить generated OpenAPI/offline schemas, настроить ingress и прогнать
   HTTP contract matrix по [инструкции внедрения](onboarding-openapi-convergence.md).
   Legacy `/v1` сохраняет прежние receipts/read views.
7. Поставлять C1/N2/P3 из контролируемых CI jobs с immutable provenance и отдельным
   human approval. Условия выпуска: [pilot-deployment-checklist.md](pilot-deployment-checklist.md).

## Проверки

```sh
CI=true AWP_RUN_CONTAINER_TESTS=true node node_modules/vitest/vitest.mjs run \
  tests/integration/007/us1-onboarding-http.spec.ts \
  tests/integration/007/us1-resources-http.spec.ts \
  tests/integration/007/us1-validation-http.spec.ts \
  tests/integration/007/us1-onboarding-atomicity.spec.ts --maxWorkers=1
```

Нужны Node 24, установленные зависимости и доступ к Docker/loopback. Fixtures
создают собственные PostgreSQL 17/18, Nest HTTP и временный inventory, затем удаляют
их. Проверяются restart/idempotency, CAS, scoped authorization, rollback аудита,
схемы environment/context/lease, validation/acceptance и блокировка L0 без probes.
Identity и provider observations в новых HTTP journeys контролируются fixture;
они не подтверждают работоспособность корпоративного OIDC или реальных Jira/GitLab.

## Запрошенные проверки через worker (Core 0200)

`POST /:projectId/bindings/:bindingId/validate` принимает `probeKeys` из
`qaValidationCapabilityRequirementSetV1`: например,
`jira-qa-request-authority`, `jira-source-context`, `jira-defect-destination`.
Для этих трёх ключей worker проверяет четыре операции. Произвольные операции
отклоняются. API сохраняет `capability_probe_requests` в одной транзакции
с validation report, audit и idempotency receipt; ответ содержит `probeRequestRef`.
Внешних вызовов в API нет.

`createRequestedCapabilityProbeWorker` из
`packages/runtime-composition/src/onboarding/requested-probe-worker.ts` использует
`FOR UPDATE SKIP LOCKED`, уникальный claim token и lease на пять минут.
Просроченный lease восстанавливается после остановки процесса. Результаты probes
и terminal state коммитятся атомарно. Завершённый запрос и snapshot запроса
неизменяемы. Новый validation report, drift конфигурации или отзыв прав дают
`REJECTED`; отсутствие observer даёт `UNAVAILABLE`, не положительный результат.
Проверяются текущие права инициатора и отдельная authority наблюдателя, до и после
наблюдения, exact Binding/Profile/Connection/Mapping, hash и scoped report.

Для локальной разработки задать `AWP_PILOT_ADAPTER_MODE=development` в окружении
Compose до запуска worker и Mock Hub. `createDevelopmentCapabilityProbeWorker`
подключает настоящий bounded HTTP-вызов `/mock/pilot/capabilities`; эмулятор
разрешён только в LOCAL. При значении `disabled` положительные provider
observations не создаются автоматически.

Для реального pipeline:

1. Migration job применяет новый Core `0200-capability-probe-requests.ts` через
   актуальный registry. Текущие версии: Core **200**, QA **2110**. В новой таблице
   report FK включает Workspace и Project; старые миграции не изменяются.
2. В worker contribution `project-onboarding-probes` вызвать requested worker
   вместе с периодическим maintenance worker. Передать `authorize` с текущей
   SERVICE identity/permission и scoped provider lease, затем `observe` с
   выбранным read-only provider protocol и ограниченным allowlisted transport.
   Даже для `pipeline.trigger` observer только проверяет capability; запуска
   pipeline или другого business write быть не должно.
3. Контролировать возраст QUEUED/RUNNING, истёкшие leases, REJECTED и отрицательные
   probes; хранить request/report/probe refs для расследования. Не очищать
   таблицу запросов как временный кеш.
4. В CI запускать `tests/integration/007/us1-requested-probes-http.spec.ts` с
   `AWP_RUN_CONTAINER_TESTS=true`. Тест использует зарегистрированную development
   factory и реальный HTTP-провайдер, проверяет audit rollback, lease recovery,
   конкуренцию, restart, отрицательные observations и отзыв прав.

Одних connector probes недостаточно для FULL_QA; нужна описанная ниже приёмка Suite.
C1/N2 этим локальным worker не закрываются.

## FULL_QA по опубликованному и принятому Suite

`validation.application.ts` теперь принимает L0 с `requestedCapabilityMode: FULL_QA`.
`automation-facts.ts` в том же SERIALIZABLE transaction получает текущие scoped
Binding/Profile/Connection, context, опубликованный Suite и его последний report.
Общая проверка из `runtime-composition/src/pilot/automation-availability.ts`
используется также существующим API доступности автоматизации.

Порядок подключения:

1. Опубликовать environment, data, pool и QA context через перечисленные выше
   endpoints. Environment должен иметь scope LOCAL либо NON_PROD.
2. В Binding оставить четыре manual operations Jira и добавить роли GitLab:
   SOURCE_CONTEXT (`source-context.read`), TEST_EXECUTION
   (`test-executor.trigger-status`), ARTIFACT_SOURCE (`artifact.ci-read`). Нужны
   exact contract 1.0.0, текущие опубликованные profile/connection и единый scope.
3. Запустить Binding validation с шестью `probeKeys`: `jira-qa-request-authority`,
   `jira-source-context`, `jira-defect-destination`, `gitlab-source-context`,
   `gitlab-test-execution`, `gitlab-artifact-source`. Worker должен записать
   все **12** observations для полученного validation report.
4. Через QA Suite service/его runtime adapter валидировать и опубликовать Suite.
   Report должен включать точные Binding и `qaAutomationProfilePinSetHash`,
   discovery snapshot и suite probe hashes, полный упорядоченный набор успешных
   Suite checks. Для LOCAL передавать `environmentScope: LOCAL` при вычислении
   pin set hash. Отключение этой опции сохраняет прежний NON_PROD hash.
   Контролируемый validator из теста на стенд не переносить: эти факты поставляет
   реальный read-only discovery/probe adapter.
5. QA lead отправляет `bindings/:id/acceptances` с exact refs Suite version,
   environment и evidence policy в `acceptedResourceRefs`. Версия Suite берётся
   из текущего опубликованного header; нельзя передать старую или чужую версию.
   Checklist и остальные ресурсы должны принадлежать текущему context/configuration.
6. Опубликовать Binding через candidate и отдельное подтверждение owner, затем
   вызвать `onboarding/evaluations` с `gateKind: L0` и
   `requestedCapabilityMode: FULL_QA`, текущими refs и сильным `If-Match`.
   При полном наборе фактов API возвращает PASS, SHADOW, FULL_QA.

Проверка учитывает актуальные права QA lead, последний Binding report и acceptance,
последний report текущего Suite, точные profile/connection pins, environment и
artifact/evidence policy. Все восемь GitLab observations должны быть свежими,
AVAILABLE и без issue codes. Возраст Suite/Binding reports и acceptance ограничен
10 минутами; возраст observations — также 10 минутами и собственным `validUntil`.
Срок действия успешного L0 не превышает 60 секунд и остаточного срока исходных
фактов. Изменившийся Suite, потеря наблюдений или отрицательный provider result
дают BLOCKED_INPUT, NEEDS_FIX и MANUAL_ONLY с сохранением намерения FULL_QA.
Отдельная оценка MANUAL_ONLY продолжает работать при недоступной автоматизации.

Запись gate, новой onboarding revision, audit и idempotency receipt атомарна.
Повтор успешного запроса после рестарта возвращает исходный результат и не
создаёт нового gate. Это локальная оценка: PILOT_ACTIVE, C1/N2/P3 и запуск
внешнего pipeline требуют собственных проверок и approvals.

В pipeline добавить `tests/integration/007/us1-full-qa-http.spec.ts` и
`tests/integration/008/automation-availability.spec.ts` с PostgreSQL 17/18 и
`AWP_RUN_CONTAINER_TESTS=true`. Первый тест публикует QA-ресурсы через HTTP,
использует Suite repository с контролируемым validator и durable requested worker.
Он проверяет audit rollback, отрицательное наблюдение, Suite drift и API restart;
это не свидетельство реального GitLab или независимого полного smoke T176.

Внедрение HTTP-контракта: [onboarding-openapi-convergence.md](onboarding-openapi-convergence.md).
Итоговая регрессия и закрытие T071: [published-onboarding-http.json](../../reports/project/published-onboarding-http.json).
Предыдущий checkpoint FULL_QA: [full-qa-http.json](../../reports/project/full-qa-http.json).
