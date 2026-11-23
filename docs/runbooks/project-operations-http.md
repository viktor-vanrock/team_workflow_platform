# Suspend/resume: HTTP, PostgreSQL и подключение к pipeline

Реализация 007/T163: `apps/api/src/extensions/onboarding/project-operations.application.ts`
и `project-operations.controller.ts`. Локальный API регистрирует
`PROJECT_OPERATIONS_HTTP_APPLICATION` с `DurableProjectOperationsApplication`.
Состояние, exact candidates, approvals, idempotency receipts, audit и события
сохраняются в PostgreSQL. Перезапуск API не сбрасывает решения.

## Порядок работы

Префикс: `/v1/workspaces/:workspaceId/projects/:projectId/operations`.
Все POST требуют `Idempotency-Key` (8–256 символов) и сильный
`If-Match: "N"`, где N — `version` из GET того же префикса.
Слабый ETag и значение без кавычек отклоняются. Ответы не кэшируются.

| Маршрут                      | Тело                                                                                                     | Текущие права                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| GET                          | —                                                                                                        | `project.onboarding.read`                                                |
| POST `suspend`               | `incidentRef`, `reason`                                                                                  | Integration administrator, `project.suspend`                             |
| POST `incident-dispositions` | `incidentRef`, `outcome: ACCEPTED/REJECTED`, `reason`                                                    | Integration administrator, `project.resume`                              |
| POST `resume-candidates`     | `incidentDispositionRef`, `reason`                                                                       | Integration administrator, `project.resume`, свежий MFA                  |
| POST `approvals`             | `candidateRef`                                                                                           | Другой workspace owner, право из сохранённого вида candidate, свежий MFA |
| POST `resume`                | `incidentRef`, `incidentDispositionRef`, `freshProbeRefs`, `actionCandidateRef`, `approvalRef`, `reason` | Инициатор candidate, `project.resume`, свежий MFA                        |

Для PROJECT_RESUME требуется `project.resume`; binding lifecycle использует
`integration.publish`, pilot activation — `project.onboarding.activate`.
Общий resolver также поддерживает Core revision metadata и семантические hashes.
Необязательная отрицательная проба другой capability не заменяет проверку
обязательных ручных операций.

Exact ref имеет поля `id`, `version`, `contentHash`. Использовать refs из ответов,
не собирать их из предположений. Candidate и MFA действуют пять минут.
Resume повторно проверяет текущие права обоих участников, неизменность оснований
авторизации, текущую ревизию onboarding, последнее решение об инциденте,
опубликованные binding/context/profile/connection и свежие пробы всех обязательных
ручных операций. Более новая отрицательная проба блокирует resume.

Suspend добавляет immutable ревизию SUSPENDED, отменяет ещё не начатые
QUEUED/AWAITING_APPROVAL commands, закрывает их outbox и инвалидирует approvals.
Начатый внешний эффект требует reconciliation; suspend не отменяет уже
выполненную запись у провайдера. Успех подтверждается HTTP 202 с сохранённым
receipt. Повтор того же ключа и тела возвращает тот же receipt; изменённое тело
или устаревшая версия дают 409. Ошибки валидации — 400/422, прав — 403,
недоступность операции — 503 без текста SQL или внутренних исключений.

Текущий resume консервативно устанавливает MANUAL_ONLY: этот HTTP adapter ещё
не подключает проверку accepted automation suite для восстановления FULL_QA.
Независимый worker journey 007/T155 закрыт локальным процессным тестом, описанным ниже.
Тест HTTP не является доказательством отсутствия внешних эффектов во всех workers.

## Проверка

```sh
CI=true AWP_RUN_CONTAINER_TESTS=true pnpm exec vitest run \
  tests/integration/007/us5-project-operations-http.spec.ts \
  tests/integration/008/migration-matrix.spec.ts --maxWorkers=1
```

Проверяются PostgreSQL 17.7/18.6, HTTP guard, сильный ETag, отсутствие MFA,
запрет самоутверждения, подмена approval hash, новая отрицательная проба,
снятый с публикации профиль, restart API/соединения с БД, конкурентный resume,
идемпотентность и атомарный откат при ошибке audit. Identity в HTTP fixture
контролируемая; она не заменяет корпоративную OIDC-приёмку.

## Что добавить в реальный pipeline

1. В migration job включить Core `0195-project-incident-dispositions.ts` через
   актуальный registry. Для операций нужна миграция 0195; текущий Core registry заканчивается версией 230; полный набор namespace указан в
   [инструкции обновления](../deployment/upgrade-and-verification.md). Миграция создаёт immutable
   incident dispositions с FK на конкретную scoped onboarding revision.
   Применить миграции до запуска нового API; runtime role не получает DDL.
2. В корпоративном API module зарегистрировать `ProjectOperationsController`,
   `QaSessionGuard`, `QA_DATA_SOURCE`, `QA_HTTP_IDENTITY` и provider
   `PROJECT_OPERATIONS_HTTP_APPLICATION`. Использовать корпоративную DataSource
   и `CorporateQaHttpIdentity`, а не local persona identity.
3. Выдать реальные scoped role assignments и project entitlements для прав
   из таблицы. Проверить OIDC step-up и CSRF на BFF; boolean из запроса не является
   MFA или approval. Workspace owner также должен иметь текущий project grant.
4. Подключить обработку `PROJECT_OPERATIONAL_STATE_CHANGED` из event outbox,
   текущий effect fence в каждом worker и reconciliation уже начатых эффектов.
   T155 и T176 проверены локально; для новой сборки повторить
   [Compose smoke](onboarding-compose-smoke.md).
5. Хранить receipt и exact refs в интерфейсе оператора. После неопределённого
   сетевого результата повторять исходный ключ; новый ключ не заменяет проверку
   текущей версии. Экспортировать аудит, конфликтующие решения и ошибки outbox
   в корпоративный мониторинг.

Legacy/bootstrap onboarding rows с непроверяемым content hash отклоняются;
создать корректную опубликованную ревизию через завершённый onboarding workflow.
Не править immutable историю вручную. Корпоративная сборка 008/T025 и шесть
задач стендовой приёмки остаются в [deployment checklist](pilot-deployment-checklist.md).

## Независимый worker journey: T155 закрыта локально

`tests/e2e/007/us5-suspend-resume.spec.ts` выполняет реальные HTTP-команды API и
запускает `tests/support/007-effect-worker-process.ts` отдельным Node-процессом
с собственной DataSource. Процессы не разделяют экземпляр guard или command store.
Worker сначала захватывает persisted command, затем API приостанавливает проект.
Попытка dispatch отклоняется; provider получает **ноль POST**. После перезапуска
API/worker отменённая команда не возрождается. Resume требует incident disposition,
свежие observations и exact approval другого владельца; self-approval отклоняется.
После resume новая команда даёт **один POST**, confirmation сохраняется в PostgreSQL,
ещё один restart и повтор HTTP-resume не создают дополнительных effects.

Тест проходит на PostgreSQL 17.7 и 18.6. Provider и identity контролируемые,
исходные свежие observations заданы fixture; это не приёмка корпоративного
provider и не полный Compose smoke. Все child processes, HTTP server и контейнеры
закрываются в `finally`. Доказательства: `reports/project/local-task-closure.json`.
