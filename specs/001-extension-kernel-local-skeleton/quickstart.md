# Quickstart: Feature 001 — Extension Kernel и local walking skeleton

**Статус:** runnable implementation

**Runtime:** Node.js 24.20.0, pnpm 11.21.0
**Local providers:** Fake IdP, deterministic model, Mock Connector/Mock Hub, Adobe S3Mock

## 1. Что уже работает

Feature 001 предоставляет:

- Platform Core без Pack/vendor hardcode;
- статическую регистрацию Dummy Competency Pack и Mock Connector;
- versioned Connection, Mapping, Profile и Project Integration Binding;
- durable typed Connector commands, outbox/inbox, retries и exact Approval;
- Workspace/Project/role/classification enforcement на backend;
- append-only audit и redaction logs/OTel/Problem Details;
- provider-neutral artifact proxy с повторной авторизацией и checksum;
- локальный UI с девятью backend-issued personas;
- PostgreSQL 17/18 migration matrix, contract/architecture/security/integration/Playwright gates.

Feature 001 намеренно не подключает реальные Jira, GitLab, Mattermost, corporate IAM, production storage или production model provider.

## 2. Prerequisites

Обязательные версии:

| Tool | Version |
|---|---|
| Node.js | ровно 24.20.0 |
| pnpm | ровно 11.21.0 |
| Docker Engine | 24+ |
| Docker Compose | 2.20+ |

Проверка fail-fast:

```bash
node --version
pnpm --version
pnpm prerequisites
```

Если активен Node 22 или другая версия, сначала переключите runtime используемым version manager. Репозиторий содержит `.node-version`; install и gates под неподдерживаемым Node не являются валидной проверкой.

## 3. Первый запуск

```bash
pnpm install --frozen-lockfile
pnpm local:up
```

`local:up`:

1. проверяет toolchain;
2. создаёт локальный сертификат Fake IdP;
3. собирает pinned Node 24.20.0 image;
4. поднимает PostgreSQL, Redis и S3Mock;
5. запускает отдельные one-shot Core/Dummy и Mock Hub migrations;
6. выполняет deterministic seed и создаёт S3 object fixtures;
7. запускает Fake IdP, Mock Hub, API, worker, web и edge proxy;
8. ждёт Docker healthchecks и печатает status/URLs.

Повторный `local:up` и `local:seed` не удаляют developer-created local data. Migrations работают с `synchronize=false` и повторно являются no-op.

## 4. Endpoints и операции

| Surface | URL |
|---|---|
| Web | http://localhost:5173 |
| API readiness | http://localhost:3000/health/ready |
| OpenAPI UI | http://localhost:3000/api/docs |
| OpenAPI JSON | http://localhost:3000/api/openapi.json |
| Worker readiness | http://localhost:3010/health/ready |
| Mock Hub readiness | http://localhost:4010/health/ready |
| S3Mock health | http://localhost:9090/actuator/health |

Полезные команды:

```bash
pnpm local:status
pnpm local:logs -- api worker
pnpm local:seed
pnpm local:down
```

`local:down` останавливает приложения, но сохраняет named volumes.

## 5. Ручной UI walkthrough

1. Откройте http://localhost:5173 и проверьте постоянный banner `LOCAL DEVELOPMENT`.
2. Выберите `requester.alpha`, нажмите `Switch persona`, создайте Dummy Work Item.
3. Переключитесь на `executor.alpha`, задайте уникальный Record key и нажмите `Publish through Mock Hub`. Результат: `CONFIRMED`, `effectCount=1`.
4. Создайте ещё одну command с `Require exact Approval`. Результат до решения: `AWAITING_APPROVAL`, `effectCount=0`.
5. Переключитесь на `owner.local`, одобрите pending Approval. Результат: Approval consumed и ровно один внешний effect.
6. Скачайте `local-walking-skeleton.txt`. Content идёт через API proxy; backend повторно проверяет scope/classification и SHA-256.
7. Переключитесь на `limited.alpha`: PUBLIC artifact разрешён, RESTRICTED `alpha.txt` возвращает 403.
8. Переключитесь на `viewer.beta` или `outsider.delta`: ALPHA artifact недоступен из другого Project/Workspace.

UI не передаёт доверенные role/entitlement/scope поля. Persona exchange выдаёт подписанную local session, а grants разрешаются из durable seed на backend.

## 6. Seeded personas

| Persona | Основное разрешение |
|---|---|
| owner.local | Approval, project administration, artifacts/audit в ALPHA |
| integration-admin.alpha | validate и request publication configuration |
| requester.alpha | create/read Dummy work и artifacts в ALPHA |
| limited.alpha | read в ALPHA с INTERNAL ceiling |
| executor.alpha | execute typed Connector command в ALPHA |
| viewer.beta | read-only BETA |
| auditor.local | Workspace audit без implicit Project content |
| worker.local | минимальный service grant для command execution |
| outsider.delta | create/read только в isolated DELTA Workspace |

Полная allow/deny матрица выполняется в `tests/e2e/001-acceptance.spec.ts` прямыми backend calls и не зависит от скрытия кнопок во frontend.

## 7. Стабильные verification commands

Root scripts маршрутизируются через Nx project `feature-001`:

```bash
pnpm check
pnpm test:unit
pnpm test:architecture
pnpm test:contract
pnpm test:integration
pnpm test:e2e:001
pnpm smoke:001
```

- `check` — unit, architecture, contract, ESLint, typecheck и build;
- `test:architecture` — import graph, Core-only и non-local composition, forbidden semantics/runtime loading;
- `test:contract` — 31 JSON Schemas, 17 examples, 48 OpenAPI operations, AsyncAPI и все typed write implementations;
- `test:integration` — PostgreSQL/Testcontainers, security, durability, isolation, resilience и migration matrix PostgreSQL 17/18;
- `test:e2e:001` — Chromium walkthrough и allow/deny matrix всех девяти personas;
- `smoke:001` — local bootstrap/readiness, два обычных прохода, worker restart, Redis `FLUSHALL`, затем повторный effect/artifact flow.

Machine-readable smoke report: `artifacts/verification/smoke-001-gate.json`.

## 8. Clean bootstrap и reset safety

Обычный `pnpm smoke:001` сохраняет local volumes. Чистый вариант удаляет только containers/volumes Compose project `awp-local`, поэтому запускается явно:

```bash
node tools/verification/smoke-001-gate.mts --clean
```

Только reset без последующего запуска:

```bash
pnpm local:reset -- --yes
```

Удалённые local PostgreSQL/Redis/S3Mock volumes не восстанавливаются; deterministic seed создаётся заново следующим `local:up`. Workspace files и другие Docker projects не затрагиваются.

## 9. Failure scenarios

Mock Hub принимает только эти scenario values:

```text
NORMAL
TIMEOUT
AUTHENTICATION_FAILED
AUTHORIZATION_DENIED
RATE_LIMITED
SERVER_ERROR
SCHEMA_DRIFT
DUPLICATE_EVENT
OUT_OF_ORDER_EVENT
```

Пример:

```bash
pnpm scenario:set -- TIMEOUT
pnpm scenario:reset
```

Автоматическая resilience suite дополнительно проверяет invalid manifest, 401/403/429/5xx, timeout, schema drift, duplicate/out-of-order/gap, Redis loss, worker restart, stale lease, crash window и revoked authorization:

```bash
pnpm test:integration
```

## 10. CI, trace и финальный gate

Посмотреть provider-neutral CI matrix без выполнения:

```bash
pnpm ci:001 -- --plan
```

Полный CI entrypoint выполняет Node 24, frozen install, lint/typecheck/build, unit/architecture/contracts/security/integration, PostgreSQL 17/18, local runtime, Playwright и clean smoke:

```bash
pnpm ci:001
```

Единый финальный gate:

```bash
pnpm verify:001
```

Артефакты:

- `artifacts/verification/feature-001-ci.json`;
- `artifacts/verification/feature-001-trace.json`;
- `artifacts/verification/feature-001-success-criteria.md`;
- `artifacts/verification/feature-001-gate.json`.

Trace проверяет отсутствие orphan mappings для `FR-001…FR-035`, `SC-001…SC-007`, `AT-001…AT-019`, существование test files и закрытость связанных tasks.

## 11. Troubleshooting

| Симптом | Что проверить |
|---|---|
| prerequisite mismatch | `node --version`, `pnpm --version`, затем `pnpm prerequisites` |
| Docker socket недоступен | Docker Desktop запущен и текущий пользователь имеет доступ к daemon |
| service unhealthy | `pnpm local:status`, затем `pnpm local:logs -- <service>` |
| API readiness DOWN | dependency list из `/health/ready`; отдельно postgres/redis/s3mock/mockHub |
| migration failed | logs one-shot `core-migrate`/`mock-migrate`; schema version и имя migration |
| command не CONFIRMED | command correlation ID, Mock Hub scenario и worker logs |
| duplicate suspected | один и тот же clientRequestKey должен вернуть тот же command; проверяется `effectCount`, не HTTP call count |
| artifact 403 | Project scope, `artifact.read` и classification ceiling текущей persona |
| artifact 410 | fixture имеет `EXPIRED`; metadata остаётся, content не выдаётся |
| после restart worker временно недоступен | дождаться `/health/ready`; smoke-gate делает это автоматически |
| contract drift | `pnpm contracts:build -- --check` и `pnpm contracts:openapi -- --check` |

Logs, audit, Problem Details и telemetry не должны содержать bearer tokens, secret refs, raw payloads или S3 locators; это проверяется отдельным security gate на реальной PostgreSQL.
