# Onboarding HTTP 1.1: совместимость и внедрение

Опубликованный контракт:
[project-onboarding-api.v1.1.yaml](../../specs/007-project-onboarding-evidence-security/contracts/openapi/project-onboarding-api.v1.1.yaml).
Он определяет 18 операций onboarding на `/api/v1/workspaces/:workspaceId/projects`.
`PublishedOnboardingController` и `PublishedProjectOperationsController`
зарегистрированы рядом с существующими controllers в `apps/api/src/app.module.ts`.
Они используют те же PostgreSQL applications, current authorization, idempotency,
approval и audit. Локальный UI продолжает пользоваться `/v1/...` и прежними DTO.

## Почему контракт версионирован

Исходный design OpenAPI 1.0 и schema `binding-functional-acceptance:v1`
сохранены. В них команда принимала exact refs, а ответ требовал schema-bound refs.
У произвольной внешней evidence policy нет достоверной схемы, которую сервер мог
бы приписать ей из одной exact ref. Поэтому новый контракт 1.1 явно использует
`binding-functional-acceptance:v2`: exact acceptedResourceRefs, actor, reason и
safeIssueCodes. Новая schema добавлена в offline registry; старые документы,
исторические записи и hashes не переписаны.

Это исправление ранее не реализованного onboarding response contract. До него
зарегистрированные локальные adapters отвечали на `/v1/...`, а `/api/v1/...`
отсутствовал. Первый red HTTP-тест воспроизвёл 404; новые clients используют
контракт 1.1. Evidence не входит в эти 18 операций: его текущая локальная
HTTP/crypto реализация описана отдельно в [evidence-http.md](evidence-http.md).
Сводный OpenAPI snapshot содержит также design slices других features; для
приёмки внешнего onboarding client использовать конкретный документ 1.1.

## Ответы и версии

| Операция                            | Статус и ответ                      | CAS/ETag                                                             |
| ----------------------------------- | ----------------------------------- | -------------------------------------------------------------------- |
| Catalog                             | 200, страница onboarding packages   | Scoped cursor; Cache-Control private, no-store                       |
| Register / read onboarding          | 201 / 200, ProjectOnboardingPackage | ETag версии возвращённой revision                                    |
| Entitlement GRANT                   | 201, EntitlementRevision            | If-Match текущей onboarding version; ETag новой entitlement revision |
| Entitlement REPLACE / REVOKE        | 201 / 200, EntitlementRevision      | Отдельные `:id/replace` и `:id/revoke`; If-Match версии entitlement  |
| Validate Binding / evaluate L0      | 202, CommandReceipt                 | If-Match Binding header / onboarding version соответственно          |
| Functional acceptance               | 201, acceptance schema v2           | Точные Binding/report/context/resource refs; ETag `"1"`              |
| Binding lifecycle                   | 200, CommandReceipt                 | Exact candidate/approval и сильный If-Match                          |
| Pilot activation / suspend / resume | 200, ProjectOnboardingPackage       | Exact action requirements и текущая onboarding version               |
| Environment / context               | 201, сохранённый immutable snapshot | Создание без If-Match; изменение требует текущую версию ресурса      |
| Test data / account pool            | 201, CommandReceipt                 | Создание без If-Match; изменение требует текущую версию ресурса      |
| Account lease acquire / release     | 201 / 200, сохранённый Lease        | Release требует сильный If-Match текущей lease version               |

После GRANT для следующего независимого GRANT прочитать onboarding заново: его
версия увеличилась. Слабый ETag, пропущенный обязательный If-Match и неверные JSON
типы отклоняются до выполнения команды. Новый validation request требует хотя бы
один probeKey; legacy `/v1` сохраняет возможность структурной проверки с `[]`.

Request и response schemas берутся из сгенерированного OpenAPI, без сетевого
schema lookup. `published-validation.ts` проверяет запрос до вызова application;
`published-http.ts` формирует и проверяет ответ. Problem содержит только
`type/title/status/code/correlationId` и content-type `application/problem+json`.
Чужой и отсутствующий проект скрываются одинаковым 404 при чтении; произвольные
тексты исключений и внутренние SQL-данные в ответ не попадают. Controller filter
проверен совместно с global production ProblemDetailsFilter.

## Hash и повтор запроса

ProjectOnboardingPackage, EntitlementRevision и acceptance являются wire
проекциями. Их `contentHash` вычислен по каноническому JSON самого DTO без
`contentHash`. Заголовок **AWP-Resource-Ref** содержит JSON ExactRef исходной
persisted Core revision с её первоначальным hash. Для ссылок на Core record
использовать этот заголовок; wire hash не подставлять вместо canonical hash.
Environment/context/lease отдаются без преобразования из точной сохранённой
revision, поэтому их wire и stored hash совпадают.

CommandReceipt содержит durable ID audit record завершённой операции либо ID
requested probe job для ACCEPTED, resultRef и сохранённый audit correlationId.
Он не является заявкой на внешний business write. Результат BLOCKED_INPUT/INVALID
отражается состоянием REJECTED. После выполнения worker повтор validation по
старому ключу сохраняет первоначальный ACCEPTED receipt; свежесть observations
проверяется при новой оценке L0.

Idempotency определяется общей durable application. Повтор после рестарта
возвращает исходный snapshot и его ETag, даже если текущий head уже изменился.
Исторический ответ на suspend может показывать SUSPENDED после нового resume —
для текущего состояния нужен GET onboarding. Сервер заново проверяет текущие права
и при replay. Прежние `/v1` clients получают прежнюю форму того же результата.

При миграции client завершить незаконченные retries через исходный маршрут.
В частности, новый GRANT включает обязательный If-Match в idempotency fingerprint;
перенос старого ключа GRANT с `/v1` на `/api/v1` даст conflict. Не создавать новый
GRANT автоматически в ответ на этот conflict: сначала восстановить результат
исходного запроса. Новые независимые команды отправлять по контракту 1.1.

Candidate/approval helper routes остаются доступны для подготовки exact refs;
их локальные формы описаны в [binding-http.md](binding-http.md) и
[project-operations-http.md](project-operations-http.md). В контракте 1.1 описаны
финальные операции с этими refs.

## Что добавить в pipeline

1. В build job выполнить `pnpm contracts:build` и `pnpm contracts:openapi`, затем
   `node tools/contracts/build-openapi-snapshots.mts --check`. Доставлять
   `apps/api/openapi.generated.json` и offline schema registry вместе с кодом.
2. В API composition зарегистрировать `PublishedOnboardingController` и
   `PublishedProjectOperationsController`, DataSource и все существующие durable
   onboarding providers. Их constructor tokens совпадают с локальной композицией.
   Для corporate runtime этот монтаж остаётся частью **008/T025**.
3. Настроить ingress на передачу `/api/v1/...` без повторного добавления `/api`,
   forwarding If-Match/Idempotency-Key и возврат ETag/AWP-Resource-Ref. При
   cross-origin frontend разрешить чтение этих двух response headers в CORS.
   IAM, MFA, provider observers и account inventory берутся из
   [onboarding-http.md](onboarding-http.md).
4. Запускать `tests/integration/007/us1-published-http.spec.ts` с
   `AWP_RUN_CONTAINER_TESTS=true`, PostgreSQL 17/18. Проверка загружает OpenAPI 1.1
   и JSON Schema, вызывает все 18 операций через HTTP, проверяет тела, статусы,
   content-type, ETag, CAS, replay, отсутствие мутации для неверных типов и
   permission/unauthenticated отказы. Helper preparations и Suite/provider
   conformance сохраняют отдельные проверки.
5. Выполнить регрессию legacy `/v1` и FULL_QA и включить закрытый независимый
   journey T059 в CI по [инструкции](manual-onboarding-journey.md).
   Journey T106 закрыта; добавить её в CI по [инструкции изоляции](project-scope-journey.md).
   Smoke T176 закрыт; включить [проверку Compose](onboarding-compose-smoke.md).
   Локальные проверки не закрывают корпоративные C1/N2/P3.

Новых DB migrations для wire boundary нет: Core 230 / QA 2110. Для отката можно
вернуть прежнюю runtime сборку: старые endpoints и записи совместимы. При наличии
новых clients сначала сохранить или восстановить доступность маршрутов 1.1;
не переключать клиент на другой DTO автоматически. Rehearsal покрывает параллельные
legacy/canonical маршруты, replay через API restart и неизменность Core hashes.

Доказательства закрытия T071:
[published-onboarding-http.json](../../reports/project/published-onboarding-http.json).
