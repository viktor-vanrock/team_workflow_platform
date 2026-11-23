# Аудит локальной проверяемости и готовности задач

> Исторический отчёт контура до ADR-0009. Упомянутые Redis/S3 проверки не входят
> в текущую границу первой версии.

Дата: 2026-09-06. Проверяется текущий рабочий каталог, включая ранее существовавшие
незакоммиченные изменения. Коммиты, публикация и внешний deploy не выполнялись.

## Исправления

| Проблема                                                                   | Исправление и проверка                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Корневой TypeScript выдавал 230 ошибок, хотя Nx был зелёным                | Исправлены реальные типы API/fixtures, union narrowing, optional поля, SDK transport targets и прямые зависимости тестов. `typecheck` теперь включает корневой tsconfig. Строгие compiler options сохранены.                                                                                             |
| Общий Vitest: 26 failures и 17 skipped в 609 файлах                        | Устранено смешивание Playwright/Vitest, устаревшие migration/seed/guard ожидания и проверки старых мест реализации. Добавлен независимый контроль регистрации browser runner suites.                                                                                                                     |
| В Core находились QA modes/operations, в QA — vendor-specific reason codes | QA operation catalog и правила mode находятся в Pack, runtime объединяет 20 operations. Core сохраняет опубликованный wire format и обрабатывает capability mode как непрозрачное значение.                                                                                                              |
| 15 Core таблиц не имели составного project scope FK                        | Добавлена миграция 0190 без изменения опубликованных миграций. PostgreSQL 17/18 проверяет отказ на историческом orphan, атомарный rollback, допустимый portfolio scope, upgrade/down/up и повторный запуск.                                                                                              |
| `qs@6.15.3`: две MODERATE уязвимости                                       | Закреплён `qs@6.16.0`, свежий audit — ноль. Новая immutable dependency review описывает только девять разрешённых изменений lockfile. Старый OpenTelemetry review и опубликованная история сохранены.                                                                                                    |
| Тест хранения зависел от чужого `awp-local` и обычно пропускался           | Изолированный S3Mock harness создаёт собственные container/volume/loopback port, проверяет сохранность версий/checksum после пересоздания и удаляет только свои временные ресурсы.                                                                                                                       |
| CI 008 проверял только feature subset                                      | Добавлен обязательный `ci:project` с lint, root/Nx typecheck, build, architecture, schemas/OpenAPI, audit и всем Vitest. FAIL при skipped/todo, неполном отчёте и изменении исходников.                                                                                                                  |
| Source-bound доказательства не включали часть инфраструктуры               | Fingerprints включают GitLab CI, Compose/Docker/scripts/PostgreSQL/Collector config и миграции обоих persistent connectors. Генерируемые локальные сертификаты исключены из этой группы.                                                                                                                 |
| Документы ссылались на несуществующие старые файлы и неверные статусы      | Исправлены пути задач 002/003, статус spec 008, subject union agent run и преждевременно закрытые задачи 007/008.                                                                                                                                                                                        |
| T142: evidence HTTP возвращал постоянный `VALID`, экспорт UI не выполнялся | Реализованы scoped PostgreSQL API, проверка схем/hash/Ed25519, immutable correction с CAS, атомарный audit/receipt, MFA и policy-aware JSON export. Реальные HTTP/PostgreSQL 17/18, rollback/restart и Chromium проверки подтверждают поведение. [Подключение к pipeline](../runbooks/evidence-http.md). |

Убраны ошибки ESLint. Исправлены также передача корневого пути в portable JSON
проверках 006 и непереносимый `/private/tmp` screenshot path в Playwright.
Браузерный pilot-operation тест фиксирует часы своего сценария: статическая
фикстура сессии больше не истекает из-за текущей даты компьютера. Оба browser
файла 008 прошли после исправления: 7/7 сценариев.
Проверки не отключались ради зелёного результата; historical migration tests
используют явные старые границы реестра, а current migration tests проверяют 0190.

## Доказательства

После реализации T142 отдельные строгий root TypeScript и ESLint прошли.
Итоговый целевой прогон завершён `2026-09-05T22:19:38.087Z`: **6/6 тестов**
в трёх файлах, 0 failures/skipped/todo. [Отчёт T142 с fingerprint и границами
проверки](../../reports/project/evidence-http.json),
[Vitest assertions](../../reports/project/evidence-http-vitest.json).
Повторный `ci:008` остановлен: общий root typecheck превысил лимит 600 секунд
(`spawnSync pnpm ETIMEDOUT`), после чего остановлены только процессы этого CI.
[Отчёт о прерванной попытке](../../reports/project/ci-evidence-attempt.json)
сохраняет логи. Полного успешного CI текущей версии пока нет. Приведённые ниже
полные результаты относятся к состоянию до T142 и не заменяют свежий прогон.

Исходная полная проверка до реализации T142 завершилась PASS: 603 test files, **2 085/2 085**
тестов, 0 failures, 0 skipped/todo, неизменённые исходники; lint, root/Nx
typecheck, build 24 проектов, architecture, 203 schemas/OpenAPI и dependency audit
прошли. Время завершения: `2026-09-05T20:48:19.609Z` (6 сентября в локальной зоне).

Полный `pnpm ci:008` завершился с кодом 0 в `2026-09-05T21:05:54.221Z`:
**18/18 этапов и 15/15 child reports — PASS**. Проверены Docker API/worker/web,
browser workflow, совместимость, миграции, восстановление в изолированной БД,
security, audit coverage и trace. После прогона fingerprints обоих текущих отчётов
совпали с исходниками. `readiness.json` сохраняет `BLOCKED_INPUT`,
`corporateReady=false` и `fullFeatureClosure=false`.

У повторного узкого запуска US5 есть один условный container skip; тот же тест
в обязательном полном `ci:project` выполнен успешно с включёнными контейнерами.
Показатель 0 skipped/todo выше относится к полному набору, а не ко всем повторным
feature subsets. На GitLab runner container flag задан также на уровне всего job.

[Preflight SQL для 0190](../runbooks/sql/0190-project-scope-preflight.sql)
отдельно выполнен на PostgreSQL 17.7 и 18.6: чистая Core 185 проходит, orphan row
даёт ненулевой exit code, исходные строки сохраняются, portfolio с NULL project
допускается. [Результаты SQL-проверки](../../reports/project/migration-preflight.json).

- [Исходное состояние](../../reports/project/audit-baseline.json).
- [Последний завершённый полный прогон](../../reports/project/local.json): статус, время,
  fingerprint исходников, счётчики тестов и результат каждого этапа.
- [Подробный Vitest](../../reports/project/vitest.json).
- [Последний завершённый gate 008](../../reports/008-pilot-hardening-and-conformance/local.json):
  Docker/browser/migration/recovery/security/trace этапы и child reports.
- [Task inventory](../../reports/project/task-status.json): 1 349 задач,
  1 338 отмечены выполненными, 11 открыты после закрытия T142, T163, T091 и T155.

Итоговые счётчики и статус следует читать из текущего отчёта, а не из старого
`runs/*` или этого описания исправлений. Отчёт с другим fingerprint не подтверждает
текущие исходники. Прохождение тестов подтверждает их assertions, а не автоматически
все требования проекта.

## Что мешает закрыть все задачи

**007: T059/T071/T106/T176.** T071 получила реальные PostgreSQL/HTTP
catalog/registration, entitlement, QA resource/lease и validation/acceptance/L0
адаптеры; демонстрационный application удалён. Requested probes через worker
реализованы; остаются FULL_QA и полное соответствие DTO/status/ETag опубликованному OpenAPI
([runbook](../runbooks/onboarding-http.md)). T091 закрыта durable binding/pilot
HTTP и проверками ([runbook](../runbooks/binding-http.md)); T163 использует PostgreSQL;
[HTTP runbook](../runbooks/project-operations-http.md) фиксирует возможности и ограничения.
Часть «end-to-end» проверок вызывает
in-memory сценарии либо проверяет наличие строк в файлах. Эти четыре задачи
остаются открытыми; T155 заменена независимым процессным тестом. Их можно реализовать и проверить локально, но текущие domain/static
тесты не доказывают durable HTTP, корректную подпись или поведение после рестарта.

T142 закрыта отдельной реализацией и настоящими HTTP/DB/crypto/browser проверками.
Экспорт ограничен JSON metadata по текущей опубликованной политике; корпоративный
signer и BFF подключаются в рамках T025. Это не закрывает независимый полный
onboarding/evidence smoke T176.

**008: T025.** Есть published deployment startup, реальные scoped connector
factories и отдельно протестированные прикладные сервисы. Полная корпоративная
сборка их не соединяет: API содержит Health/Pilot; worker entry test проверяет
регистрацию десяти callbacks с `SELECT 1`. Задача переоткрыта. Нужны конкретные
host entry points, доменные bindings и полноценный HTTP/DB/worker/effect/restart
тест. Это недостающая реализация, не только отсутствие корпоративных секретов.

**008: T040/T057/T084/T104/T105/T106.** Требуют реальных C1/N2, approved recovery,
shadow, прошедшего pilot window и human review. Recovery CLI пока валидирует
inputs и оставляет `CORPORATE_DRILL_RESULT_REQUIRED`; потребуется также завершить
корпоративный wrapper. Моки и успешный local gate не закрывают эти обязательства.

## Передача в pipeline

В корень добавлен [.gitlab-ci.yml](../../.gitlab-ci.yml) для автоматической локальной
проверки и [corporate example](../../.gitlab/ci/corporate-pilot.example.yml), который
по умолчанию не подключён. YAML и строковые job scripts проверены локально;
server-side GitLab CI Lint и запуск на runner ещё предстоят.

Точные места добавления runtime host, policies, workload identity, secrets,
images, migration/release jobs, owners, negative tests и rollback:
[GitLab pipeline](../runbooks/gitlab-pipeline.md),
[чек-лист внедрения](../runbooks/pilot-deployment-checklist.md).

## Продолжение T071: локальные HTTP-сервисы

Добавлены scoped каталог с пагинацией, регистрация с Workspace authority/MFA и
минимальным starter access, GRANT/REPLACE/REVOKE прав, публикации окружения,
данных, pool/context, account leases с серверным inventory и binding
validation/QA acceptance/L0. Все эти изменения используют PostgreSQL transactions,
сохраняемые idempotency receipts, текущую авторизацию, audit/outbox и immutable
revisions. Сбой аудита откатывает изменения целиком. Исторические снимки остаются
доступны после публикации новой версии и перезапуска API/DataSource.

QA migration 2110 заменяет ограничение на единственный PUBLISHED snapshot
окружения выбором текущей публикации через header. Никакие опубликованные
миграции или JSON-схемы не переписаны. Actor DTO и numeric exact refs новых
environment/context/lease snapshots проверяются опубликованными схемами.

[Отчёт текущей локальной реализации](../../reports/project/onboarding-http.json)
содержит тесты, source hashes и границы доказательств. Это не полное закрытие T071,
не независимый smoke T176 и не свежий полный ci:project. Количество открытых задач
после закрытия T155: **11**, из них **5 локальных**. Инструкция монтажа adapters, миграции,
account inventory и оставшихся worker/pipeline ports:
[onboarding-http.md](../runbooks/onboarding-http.md).

## T155 и requested probe worker

T155 закрыта: независимый worker со своей DataSource захватывает command,
HTTP API выполняет suspend, старый dispatch отклоняется и не вызывает provider.
Проверены рестарты API/worker, сохранность отмены, отказ self-approval, exact
owner-approved resume и ровно один новый HTTP POST с persisted confirmation.
Повтор resume и очередной restart не повторяют effect. Матрица PostgreSQL 17/18
пройдена. Это контролируемый локальный journey, не полный Compose smoke T176.

В T071 добавлена Core migration 0200 с immutable snapshot запроса, scoped report FK
и leased worker cursor. HTTP validation и очередь коммитятся атомарно с audit;
запросы выполняет зарегистрированная development factory через HTTP. Проверены
lease recovery и конкуренция, terminal immutability, отрицательные observations,
отзыв текущих прав и отсутствие повторов после restart. Неизвестные provider
ошибки сохраняются безопасными reason codes. Текущие schema versions: Core 200,
QA 2110; предыдущие миграции не изменены.

Доказательства: [local-task-closure.json](../../reports/project/local-task-closure.json).
Регрессия: 158/158 тестов в 66 файлах. После дополнительной проверки ограничений
очереди выполнено ещё 6/6 тестов (worker journeys и миграции). Строгие root TypeScript,
целевой ESLint и diff whitespace проверены отдельно. Полный ci:project не заявляется.

## FULL_QA: принятый Suite и текущие worker observations

В T071 реализован явный переход L0 в FULL_QA по текущему опубликованному Suite,
его последнему validation report, актуальным Profile/Connection, environment,
evidence policy и функциональной приёмке QA lead. Локальная проверка использует
все 12 operations Jira/GitLab; gate ссылается на их immutable observations и
Suite/report. Проверены PostgreSQL 17/18, rollback при сбое audit, replay после
рестарта, отрицательный GitLab probe, Suite head drift и доступность MANUAL_ONLY
после потери автоматизации. Срок L0 ограничен свежестью исходных фактов.

Общая проверка Suite используется также существующим API automation availability.
Она понимает Core semantic hashes и прежний формат runtime publications;
NON_PROD pin hash при отсутствии нового optional environmentScope не изменён.
Корпоративные C1/N2/P3, реальный GitLab и независимый полный smoke этим не закрыты.

Итоговая регрессия: **147/147 тестов в 66 файлах**, без skipped/todo. Root TypeScript,
целевой ESLint и `git diff --check` прошли. Полный ci:project/ci:008 не запускался.
[Отчёт и source hashes](../../reports/project/full-qa-http.json).
[Подключение FULL_QA](../runbooks/onboarding-http.md),
[остаток HTTP-контракта T071](../runbooks/onboarding-openapi-convergence.md).
T071 остаётся открытой, число завершённых задач не увеличено: **1338/1349**;
осталось **11**, из них **5 локальных**.

## T071 закрыта: опубликованный onboarding HTTP 1.1

Добавлены `/api/v1/...` controllers поверх существующих guarded PostgreSQL
applications. Новый OpenAPI 1.1 определяет 18 операций: каталог/регистрацию,
entitlements, Binding validation/acceptance/publication, L0, pilot/suspend/resume,
QA environments/context/resources и account leases. Request schemas проверяются
до выполнения команды; ответы, статусы, strong ETag и errors соответствуют
опубликованному контракту. GRANT требует текущую onboarding version. Повтор после
рестарта читает исходную immutable revision, даже если head уже изменился.

Acceptance v2 устраняет несовместимость старого response schema с exact refs
команды без выдуманной schema metadata внешних policies. DTO hashes относятся к
wire проекциям; `AWP-Resource-Ref` сохраняет первоначальную Core ref. Исторические
OpenAPI 1.0 и acceptance schema v1 не изменены, `/v1` работает с прежними ответами.
Генератор разрешает повтор operation ID между версиями только для явно указанного
предшественника и того же метода/пути. Реестр содержит 204 схемы и 18 YAML документов.

Новые HTTP-тесты сначала воспроизвели отсутствующие маршруты (404), затем прошли
все 18 операций на PostgreSQL 17/18. Проверены тела, статусы, headers, CAS,
permission/unauthenticated отказы вместе с production ProblemDetailsFilter,
отсутствие DB записи при неверном JSON типе и сохранность Core hashes при replay.
Итоговая регрессия: **165/165 тестов в 71 файле**, без skipped/todo. Root TypeScript,
целевой ESLint, актуальность registry/OpenAPI snapshots и `git diff --check` прошли.

[Отчёт и source hashes](../../reports/project/published-onboarding-http.json).
[Совместимость, монтаж controllers, ingress, CI и rollback](../runbooks/onboarding-openapi-convergence.md).
Core 200 / QA 2110: для нового wire boundary дополнительная миграция не нужна.
Controlled Suite/provider observers и локальные pilot gates не подтверждают
реальный C1/N2/P3. Полный ci:project/ci:008 не запускался. T059/T106/T176 остаются
открытыми: успешные прежние in-memory тесты не заменяют независимые journeys.

Закрыты **1339/1349** задач; осталось **10**: **4 локальные** (007/T059, T106,
T176 и 008/T025) и **6 корпоративных**. Предыдущие отчёты выше сохраняются как
исторические checkpoints; актуальное состояние находится в task-status.json.

## T059 закрыта: независимый ручной onboarding

Сценарий теперь создаёт новый проект через HTTP и проходит entitlements,
публикацию QA resources/context, validation, QA-lead acceptance, distinct owner
approval, Binding publish и L0 MANUAL_ONLY до старта ручной Session. API и worker
работают в разных дочерних процессах с отдельными DataSource; PostgreSQL хранит
все переходы. Проверены PostgreSQL 17.7/18.6, рестарты обоих процессов, четыре
безопасных HTTP GET и отсутствие автоматических Sessions/connector writes.

Новый тест сначала обнаружил нарушенный QA Request FK для Context v2 и ошибку
500 вместо отказа автоматизации в MANUAL_ONLY. Исправлены общая scoped identity
контекста, чтение published v2 context/environment и реальных Profile refs, запрет
автоматизации до Suite adapter и внутри persistence transaction. При старте
ручной Session атомарно сохраняется неизменяемый v2 target snapshot с точными
refs/hash и schema-bound Context v2. Сбой audit откатывает и RUNNING, и snapshot.
Новая environment head блокирует новую Session, сохраняя существующий snapshot.
Административный audit дополнен Core onboarding refs before/after и resultRef.

Для ранее опубликованных Context v2 подготовлен повторяемый upgrade SQL;
двойное применение проверено на обеих версиях PostgreSQL. Legacy policy revisions
не создаются, существующие immutable записи и Session DTO/hash не переписаны.
Два прежних automated persistence-теста теперь явно задают FULL_QA как предпосылку
положительного сценария; отдельный тест проверяет отказ MANUAL_ONLY без записи.

Итоговая регрессия: **184/184 теста в 76 файлах**, без skipped/todo. Root TypeScript,
целевой ESLint и `git diff --check` прошли. Полный ci:project/ci:008 не запускался.
IAM/provider metadata, безопасные provider observations и предшествующий принятый
QA Request/readiness/required plan контролируются fixture. Это не импорт реального
Jira Request, корпоративный IAM/C1/N2/P3 или полный Compose smoke.

[Отчёт, логи и source hashes](../../reports/project/manual-onboarding-journey.json).
[Файлы поставки, upgrade SQL, CI и rollback](../runbooks/manual-onboarding-journey.md).
Закрыты **1340/1349** задач; осталось **9**: **3 локальные** (007/T106, T176,
008/T025) и **6 корпоративных**. Исторические отчёты предыдущих закрытий сохранены.

## T106 закрыта: независимая изоляция проектов

Прежний in-memory сценарий заменён реальным HTTP journey с отдельным Nest API
процессом и PostgreSQL 17.7/18.6. Три новых проекта регистрируются через HTTP;
два читателя получают разные роли/классификации, ещё одна сессия того же principal
имеет более строгий потолок. Независимо проверены каталог, прямой onboarding URL,
поиск, Work Item, реальная очередь, safe event notifications, artifact metadata
и bytes/checksum, настоящая подпись, package и export. Тестовые IAM roles, очередь,
файлы и исходные подписанные пакеты явно заданы как controlled prerequisites.

Обнаружены и исправлены отсутствующие read routes; неполная local/portfolio
авторизация, пропускавшая DENY и сроки прав; UUID COLLATE error; отсутствие фильтра
классификации Work Item в очереди; потеря более строгого session ceiling; различие
forbidden/missing по статусу HTTP. Каталог и новые reads вызывают verified identity
authorization и current Core policy. SQL projection фильтрует записи до counts,
агрегации и cursor. Ошибки scope скрываются одинаковым 404, step-up остаётся 403.
Добавлен отдельный контракт трёх read operations, обновлены registry/OpenAPI.

HTTP revoke блокирует старый export и idempotency replay; прежние курсоры и курсор
другого principal отклоняются. API перезапускается до и после отзыва прав, business
rows остаются на месте. Изменение скрытого проекта не меняет видимую страницу;
подмена project/ref и RESTRICTED resource внутри INTERNAL проекта скрываются.
Для проекта экспорта записаны ровно один export и audit, connector commands — ноль.

Расширенная регрессия выявила устаревшие предпосылки тестов 005/008: положительные
автоматические recovery/idempotency сценарии теперь явно устанавливают FULL_QA.
Защитный MANUAL_ONLY guard сохранён. Upgrade 160→current проверяет Core 200 и восемь
миграций; отдельный 0190 orphan/rollback тест закреплён на историческом target 190.
Production migrations не переписывались. Диагностические красные логи сохранены.

Итоговая регрессия на неизменённом коде: **723/723 теста в 197 файлах**, без failed/skipped/todo.
Root TypeScript, целевой ESLint, registry/OpenAPI `--check` и `git diff --check`
прошли. Core 200 / QA 2110; 204 схемы, 19 YAML документов, дополнительной миграции нет.
[Отчёт и привязка к исходникам](../../reports/project/project-scope-journey.json).
[Файлы поставки, ingress, identity, CI и rollback](../runbooks/project-scope-journey.md).
Полный ci:project/ci:008, T176, corporate IAM/providers и фактические C1/N2/P3,
recovery/pilot/review не входят в доказательство. Уведомления — polling/replay,
постоянное время ответа и независимый worker smoke в T106 не заявлены.

Закрыты **1341/1349** задач; осталось **8**: **2 локальные** (007/T176, 008/T025)
и **6 корпоративных**. Исторические отчёты предыдущих закрытий сохранены.

Продолжение 7 сентября: [T176 Compose smoke, исправления и актуальные остатки](2026-09-07-compose-smoke.md).
