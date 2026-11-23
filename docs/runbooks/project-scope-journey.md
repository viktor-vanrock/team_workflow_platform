# Изоляция проектов: локальный сценарий T106

`tests/e2e/007/us3-project-scope.spec.ts` запускает отдельный Nest API процесс с
собственной PostgreSQL DataSource. Два читателя получают разные роли и
classification ceilings; три новых проекта регистрируются через HTTP. Права
выдаются и отзываются через настоящие entitlement endpoints. IAM identities/roles,
очередь, исходные подписанные evidence-пакеты и файлы являются контролируемыми
предпосылками. Это не подтверждение корпоративного IAM, Jira intake или полного
Compose smoke T176.

Сценарий независимо вызывает каталог, onboarding URL, поиск, Work Item,
портфельную очередь, уведомления, artifact metadata/content, проверку подписи,
чтение пакета, создание и получение export. Один читатель видит два проекта,
другой — один. Третий проект скрыт DENY; RESTRICTED Work Item и artifact внутри
разрешённого INTERNAL проекта тоже скрыты. После отзыва права повторяются чтение,
экспорт с прежним idempotency key и курсоры, затем API перезапускается.
Отдельная сессия того же principal с потолком INTERNAL сохраняет это ограничение
даже при более широком DB grant: каталог, поиск, события, очередь, Work Item и
evidence не получают RESTRICTED данные.

## HTTP-маршруты чтения

Новый `ProjectReadsController` зарегистрирован в локальном API module; контракт
[project-reads-api.v1.yaml](../../specs/007-project-onboarding-evidence-security/contracts/openapi/project-reads-api.v1.yaml)
включён в schema contribution и generated OpenAPI.

| Маршрут                                                                          | Право и результат                                                      |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `GET /api/v1/workspaces/:workspaceId/project-search?q=&limit=&cursor=`           | `project.catalog.read`; поиск по имени/key разрешённых проектов        |
| `GET /api/v1/workspaces/:workspaceId/project-events?limit=&cursor=`              | `project.onboarding.read`; безопасные уведомления из onboarding outbox |
| `GET /api/v1/workspaces/:workspaceId/projects/:projectId/work-items/:workItemId` | `work-item.read`; scoped summary с проверкой классификации Work Item   |

Все ответы имеют `Cache-Control: private, no-store`. Размер страницы 1–100,
по умолчанию 50. Search query ограничен 256 символами. Сначала проверяются текущие
membership, ALLOW/DENY entitlements, роли и classification ceiling; затем читаются
бизнес-строки и рассчитывается страница. Поиск использует PostgreSQL напрямую,
поэтому отдельный индексатор для этой версии не нужен.
Identity adapter дополнительно авторизует каждый проект; его более строгий потолок
пересекается с текущими Core facts. Одной `interaction()` для чтения недостаточно.

Курсор привязан к пользователю, workspace, текущим правам, запросу и видимому
снимку. Изменение этих данных даёт 409; клиент должен начать чтение заново.
Изменения скрытого проекта не меняют видимую страницу. Уведомления содержат только
`eventId`, `projectId`, `eventType`, `occurredAt`; outbox payload, actor и служебные
job fields не выдаются. Это polling/replay API, без SSE/WebSocket subscription.
Несовпадение внешнего scope и scope внутри envelope исключает событие из выдачи.

## Исправления авторизации

`authorizeLocalQaApi` теперь использует текущую Core policy и точные DB refs,
учитывает DENY, сроки membership/roles/entitlements и пересечение сохранённого
classification ceiling с потолком локальной persona. Фиксированный persona
catalog ограничивает development identity; он не заменяет текущие права в БД.

Портфельная очередь фильтрует проекты по Core policy и необходимым permissions;
локальный adapter дополнительно применяет ограничения persona. В PostgreSQL
projection Work Item classification проверяется до выбора строк, counts,
агрегации и курсоров. `RuntimeQueueApi` и `RuntimePortfolioQueueApi` передают
актуальный ceiling identity adapter в projection, включая повторную проверку
principal. Candidate/Draft используют классификацию проекта согласно
своей существующей модели. Исправлена несовместимая с UUID сортировка SQL.

Артефакты, evidence, очередь и новые read endpoints возвращают одинаковый
публичный 404 для отсутствующего и запрещённого ресурса. Частные основания DENY
не включаются в ответ. Сохранённый export и idempotency receipt не дают доступа
после отзыва права. На legacy `/v1/.../evidence` scope denial теперь также даёт
404; клиенты должны обрабатывать его как недоступность ресурса. Ошибка step-up
по-прежнему возвращает 403. Streaming artifact дополнительно перепроверяет доступ при
выдаче chunks через существующий ArtifactService adapter.

## Что добавить в реальный pipeline

1. Доставить `project-reads.application.ts`/`project-reads.controller.ts`, обновлённые
   `durable-http.ts`/`published-http.ts`/`registry.application.ts`, artifact/evidence/queue controllers,
   `queue/portfolio-query.ts`/`query-api.ts`/`approval-api.ts`, local identity/queue adapters и generated OpenAPI
   одной согласованной сборкой. В corporate API из T025 зарегистрировать
   `ProjectReadsController`, `QA_DATA_SOURCE`, `QaSessionGuard`, проверенный
   `QA_HTTP_IDENTITY` с `interaction()` и существующие durable adapters.
2. Corporate identity должна проверять сессию и её актуальность, выдавать actor,
   authorization basis и classification ceiling из действующих policies.
   Development bearer tokens, persona seeds и воспроизводимый signing key
   остаются только в локальном тесте.
3. Настроить ingress для трёх read routes, forwarding query/cursor и response
   content-type/Cache-Control. Для клиентов 404 означает недоступность ресурса,
   409 курсора требует повторного запроса без старого cursor. Не кешировать
   страницы между пользователями или после logout/revocation.
4. В contract job выполнить `pnpm contracts:build` и `pnpm contracts:openapi`;
   проверять snapshots командами с `--check`. База остаётся Core 230 / QA 2110;
   дополнительной миграции для T106 нет.
5. В CI с Docker и Node 24 запускать:

   ```sh
   CI=true AWP_RUN_CONTAINER_TESTS=true pnpm exec vitest run \
     tests/e2e/007/us3-project-scope.spec.ts \
     tests/integration/007/us3-local-authority.spec.ts --maxWorkers=1
   ```

   Сохранить тестовые логи/JSON, source digests и версии PostgreSQL images.
   T176 закрыта; повторить [Compose smoke](onboarding-compose-smoke.md) для новой сборки.
   Для выпуска остаются corporate factories T025 и шесть задач реальной
   приёмки из [deployment checklist](pilot-deployment-checklist.md).

6. При откате остановить новые read clients или сохранить эти маршруты до их
   обновления. Изменения совместимы с существующими DB revisions; удаление
   evidence, ACL history или business rows не требуется. Не возвращать прежнюю
   неполную авторизацию при сохранении доступа внешних клиентов.

## Доказательства закрытия

T106 закрыта локально. Итоговая регрессия: **723/723 теста в 197 файлах**, без failed/skipped/todo.
Root TypeScript, целевой ESLint, registry/OpenAPI `--check` и `git diff --check`
прошли. В реестре 204 схемы и 19 YAML документов. Отдельные проверки воспроизвели
ошибки до исправления: отсутствующий search route, пропущенный DENY, неверная
сортировка UUID и потерянный более строгий потолок сессии в очереди.

[Отчёт, команды, логи и source hashes](../../reports/project/project-scope-journey.json).
Исходный расширенный прогон с ошибками сохранён как диагностический; основание
закрытия — чистый итоговый прогон после всех исправлений. Старые отчёты предыдущих
задач остаются историческими checkpoints. Полный `ci:project`/`ci:008`, браузерный
Compose smoke T176, корпоративные IAM/providers и постоянное время ответа этим
результатом не подтверждаются.
