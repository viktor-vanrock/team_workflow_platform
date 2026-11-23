# Evidence HTTP: локальная проверка и подключение к корпоративному API

Реализация T142 находится в
`apps/api/src/extensions/onboarding/evidence.application.ts` и
`evidence.controller.ts`. `QaJiraMattermostLocalApiModule` регистрирует её через
`EVIDENCE_HTTP_APPLICATION`. Приложение использует PostgreSQL, текущие права Core
и внедряемый `EvidenceCrypto`. Успешный локальный тест не закрывает сборку
корпоративного host (008/T025).

## Маршруты

Общий префикс: `/v1/workspaces/:workspaceId/projects/:projectId/evidence`.
Все маршруты защищены `QaSessionGuard`, проверяют scope и возвращают
`Cache-Control: private, no-store`.

| Метод и путь                                   | Право                                      | Поведение                                                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST manifests/:manifestId/verify?revision=1` | `qa.evidence.verify`                       | Проверяет опубликованную схему V2, canonical hash, scope и настоящую подпись конкретной ревизии. Возвращает отдельные `integrity`, `signature`, `keyStatus`. |
| `GET packages/:packageId`                      | `qa.evidence.read`                         | Читает последнюю immutable версию пакета; проверяет все exact manifest/signature refs и classification.                                                      |
| `POST manifests/:manifestId/corrections`       | `qa.evidence.post-close-correction.record` | Добавляет подписанную ревизию с причиной и аттестацией текущего человека. Требует `If-Match: "1"` и `Idempotency-Key`.                                       |
| `GET export-options`                           | `qa.evidence.export`                       | Возвращает разрешённый формат `JSON`, exact redaction policy и требование step-up из текущей опубликованной политики.                                        |
| `POST packages/:packageId/exports`             | `qa.evidence.export` + свежий MFA          | Проверяет пакет и политику, сохраняет результат, audit и idempotency receipt одной транзакцией.                                                              |
| `GET exports/:exportId`                        | `qa.evidence.export` + свежий MFA          | Возвращает сохранённый JSON тому же автору после повторной проверки прав, политики и пакета.                                                                 |

Пример тела correction:

```json
{ "kind": "CLERICAL", "reason": "Уточнение аттестации после проверки" }
```

Допустим также `SUBSTANTIVE_CORRECTION`. Этот маршрут добавляет новую аттестацию
существующего содержимого; исходная ревизия и её подпись сохраняются. Он не
принимает actor, разрешения, исходы QA или произвольную замену evidence из тела
запроса. `If-Match` сравнивается с `row_version` manifest header; слабый ETag и
значение без кавычек отклоняются. Receipt содержит exact ref новой ревизии.

Тело export содержит `packageVersion`, `redactionPolicyRef`, `format: "JSON"`
и непустой `reason`. Exact policy нужно получить из `export-options`; её refs и
hash должны совпасть с опубликованным QA context и внедрённой реализацией.
Одинаковый ключ и тело возвращают сохранённый receipt после рестарта; другое
тело с тем же ключом даёт 409. Клиент должен сохранить ключ до получения результата.

Реализован экспорт метаданных: непрозрачные идентификаторы и exact refs пакета,
ревизий и подписей. Байты артефактов, секреты и provider URLs не входят в JSON.
`ZIP` возвращает 422: для него нет реализованной и опубликованной политики.
Legacy V1 остаётся в прежнем QA evidence read path; новый verify требует V2.

## Воспроизводимая проверка

Нужны версии Node/pnpm из `package.json`, установленный Chromium и доступный
Docker. Команда создаёт и удаляет собственные PostgreSQL-контейнеры и временные
каталоги публичных ключей:

```sh
CI=true AWP_RUN_CONTAINER_TESTS=true pnpm exec vitest run \
  tests/integration/007/us4-evidence-http.spec.ts \
  tests/integration/007/us4-evidence-web.spec.ts \
  tests/integration/007/us4-evidence-local-identity.spec.ts
```

HTTP workflow проверяется на PostgreSQL 17.7 и 18.6: настоящий Ed25519,
повреждённая подпись, недоступный ключ, cross-project/classification deny,
конкурентный CAS, отозванные права, рестарт API и соединения с БД, replay,
откат всех записей при сбое audit. Chromium использует настоящий React route,
HTTP и БД; повторное скачивание не создаёт второй экспорт. HTTP/browser fixtures
внедряют контролируемую identity. Отдельный тест LocalSessionGuard проверяет
реально подписанный ES256 JWT через локальный JWKS, подмену субъекта, устаревшие
и будущие MFA claims, очистку контекста после неверной подписи.

Полная проверка репозитория: `pnpm ci:008`; её обязательный `ci:project`
включает эти файлы и запрещает skipped/todo в общем Vitest-прогоне.
Последняя отдельная проверка T142: [6/6 PASS](../../reports/project/evidence-http.json).
Повторный общий CI после изменения прерван на таймауте TypeScript;
[его статус](../../reports/project/ci-evidence-attempt.json) учитывается отдельно.

## Что добавить в реальный pipeline

1. В составе T025 зарегистрировать controller, `QA_DATA_SOURCE`, `QA_HTTP_IDENTITY`
   и `EVIDENCE_HTTP_APPLICATION` в корпоративном API module. Внедрить
   `DurableEvidenceHttpApplication` с текущим scoped DataSource и корпоративным
   `EvidenceCrypto`. Не переносить local factory в корпоративный host.
2. Адаптировать `CorporateEvidenceSigner` к опубликованной signature envelope V1:
   обязательный `schemaVersion: 1`, UUID `signatureId`, пересчитанный envelope
   hash. Проверять его через `FilePublicKeyHistory` с одобренным trust resolver.
   Перед включением выполнить такой же HTTP workflow с Vault fixture, затем
   conformance с настоящим remote signer. Одного наличия класса signer недостаточно.
3. Опубликовать project-specific exact refs redaction/export policy в QA context,
   связав их с проверенной реализацией алгоритма. Для этого приложения политика
   разрешает только JSON metadata и MFA не старше 300 секунд. Отсутствие политики,
   неизвестный hash, смена policy после экспорта запрещают получение результата.
4. Подключить `CorporateQaHttpIdentity` и доверенную серверную сессию/CSRF.
   `authentication.contextRef`, `verifiedAt`, `stepUpAt` формирует identity port,
   а не JSON клиента. Выдать минимальные права из таблицы и проверить отзыв.
5. Включить все текущие Core/QA migrations, индексы и ограничения в migration job;
   для T142 отдельной новой миграции нет. Runtime роль должна иметь необходимые
   SELECT/INSERT/UPDATE права на evidence, idempotency, authorization и audit
   таблицы, включая row locks; DDL runtime роли не нужен.
6. Добавить публичную историю ключей в persistent mount и backup/restore inventory,
   назначить владельца trust/revocation policy. Private material выдаёт Vault.
   Локальный signer использует публично воспроизводимый development key
   `local-ed25519:1` и разрешён только при `AWP_RUNTIME_PROFILE=local|test`.
7. Проверить собранный корпоративный image: реальные OIDC/MFA, remote sign/verify,
   отказ при потере ключа/политики/прав, сохранность receipt после пересоздания,
   безопасный JSON и отсутствие секретов в API/audit/logs. Эти проверки нужны
   до публикации release, вместе с [основным чек-листом](pilot-deployment-checklist.md).

Стандартная локальная сессия без проверенного `amr: ["mfa"]` и свежего `auth_time`
не разрешает export. Тестовый identity fixture не является обходом MFA для
запущенного приложения. UI показывает требование пройти step-up; подключение
реального пользовательского step-up flow входит в сборку корпоративного BFF.
