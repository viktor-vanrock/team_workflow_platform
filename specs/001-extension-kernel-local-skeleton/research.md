# Phase 0 Research: Extension Kernel и локальный walking skeleton

**Feature:** `001-extension-kernel-local-skeleton`  
**Decision snapshot:** 2026-08-27  
**Status:** Complete — `NEEDS CLARIFICATION` отсутствуют

## 1. Метод и критерии

Исследование выбирает минимальный стек, который:

- сохраняет независимость Core, Competency Pack и Connector;
- поддерживает строгие runtime contracts и module-owned migrations;
- воспроизводит durable at-least-once delivery и idempotent external effects локально;
- работает без корпоративных систем и credentials;
- не создаёт преждевременный dynamic plugin runtime;
- остаётся понятным обычной TypeScript/NestJS/React команде.

Версии ниже — стартовые pins для bootstrap 001, а не вечные архитектурные инварианты. Major/minor compatibility задаётся в manifests/`engines`; конкретные package patches, browser image и container digests фиксируются lockfile/Compose при M1 и обновляются отдельным change с полным regression gate.

## 2. Runtime и toolchain

### Решение

- Node.js `>=24 <25`, стартовый pin `24.20.0` LTS;
- pnpm `>=11 <12`, `packageManager: pnpm@11.21.0`;
- Nx и все `@nx/*` — одинаковый pin `23.1.2`;
- TypeScript `>=6.0 <6.1`, стартовый pin `6.0.3`;
- backend packages — ESM + `moduleResolution: NodeNext`; browser packages — ESM + `Bundler`;
- `corepack` и immutable lockfile обязательны; Nx Cloud не нужен для локальной воспроизводимости.

### Почему

Node 24 находится в LTS-линии, тогда как Node 26 на дату решения является Current; foundation должен начинаться на поддерживаемой LTS, а не на текущем non-LTS major. Nx 23 поддерживает Node 24 и предоставляет единый project graph/boundary enforcement; pin `23.1.2` включает security fixes после `23.1.0`. TypeScript 6 выбирается вместо только что появившегося TS 7, чтобы не начинать foundation одновременно с переходом tooling на новый compiler API.

Источники: [Node.js releases](https://nodejs.org/en/about/previous-releases), [Node 22 → 24 migration](https://nodejs.org/en/blog/migrations/v22-to-v24), [pnpm installation](https://pnpm.io/installation), [Nx releases/support](https://nx.dev/docs/reference/releases), [Nx Node compatibility](https://nx.dev/docs/technologies/node/introduction), [Nx 23.1.2 security-fix release](https://github.com/nrwl/nx/releases/tag/23.1.2), [TypeScript 6 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/), [typescript-eslint dependency support](https://typescript-eslint.io/users/dependency-versions/).

### Отклонено

- Node 26 Current — дополнительный churn без feature value;
- npm workspaces — меньше готового enforcement для выбранной Nx structure;
- pnpm 12/TypeScript 7 в первый bootstrap — одновременно слишком много свежих major upgrades;
- Nx Cloud как обязательность — создаёт внешний runtime/credential dependency для local-first.

## 3. Monorepo и package boundaries

### Решение

Использовать pnpm workspaces + Nx project graph. Каждый package имеет public `exports`; deep imports запрещены. Nx tags:

```text
type:contract|sdk|core|adapter|pack|connector|composition|app
runtime:universal|node|browser
domain:platform|dummy|mock
```

Границы проверяются `@nx/enforce-module-boundaries`, ESLint `no-restricted-imports` и отдельным filesystem/import-graph test. Только `runtime-composition` может импортировать Core, выбранные Packs и Connectors вместе.

Источник: [Nx module-boundary enforcement](https://nx.dev/docs/features/enforce-module-boundaries).

### Почему

Одного TypeScript typecheck недостаточно: path aliases, generated files и deep import способны обойти логическую архитектуру. Три уровня проверки дают раннюю IDE/CI обратную связь и отдельное исполняемое доказательство SC-002/SC-003.

### Отклонено

- один application package с папками — границы легко обходятся;
- отдельные repositories — усложняют atomic contract changes и локальный bootstrap;
- runtime package loading — прямо запрещён Конституцией/ADR-0001.

## 4. Backend, web и UI abstraction

### Решение

- NestJS 11 для API, worker host и dependency composition adapters;
- чистый `platform-core` без Nest decorators/imports;
- React 19.2 + Vite 8.2 для web;
- MUI 9 как временный default через `platform-ui` components/tokens facade;
- `competency-ui-sdk` предоставляет compile-time typed route/detail contribution descriptors; remote JS/eval отсутствует.

Nest 11 требует Node 20+ и рекомендует актуальную LTS; Node 24 соответствует. Источники: [NestJS migration guide](https://docs.nestjs.com/migration-guide), [NestJS controllers](https://docs.nestjs.com/controllers), [React releases](https://react.dev/versions), [Vite guide](https://vite.dev/guide/), [MUI documentation](https://mui.com/material-ui/getting-started/).

### Почему

Это целевой стек master-spec и знакомый корпоративным web-командам. Facade вокруг MUI позволяет позже заменить визуальную систему корпоративным UI kit без протекания MUI imports в Pack.

### Отклонено

- Nest entities/decorators внутри Core — связывает domain с framework;
- runtime micro-frontends — не нужны для статической MVP composition и расширяют security surface;
- собственная design system в 001 — не проверяет основную архитектурную гипотезу.

## 5. Persistence и migrations

### Решение

- PostgreSQL — durable source of truth; production-compatible range 17–18, local image PostgreSQL 18;
- TypeORM 1.1 за persistence ports; domain objects и ORM entities разделены;
- `synchronize:false` во всех profiles;
- module-owned explicit migrations, собранные статическим migration composition;
- один one-shot `migrate` service до API/worker;
- fresh-install, repeat/no-op и previous-version upgrade tests на настоящем PostgreSQL через Testcontainers;
- incompatible changes используют expand/contract, без reinterpretation истории.

Источники: [NestJS database integration](https://docs.nestjs.com/techniques/database), [TypeORM migration setup](https://typeorm.io/docs/migrations/setup/), [TypeORM transactions](https://typeorm.io/docs/advanced-topics/transactions/), [PostgreSQL version policy](https://www.postgresql.org/support/versioning/).

### Почему

TypeORM имеет прямую Nest integration и зрелую модель явных migrations. Изоляция entities/repositories в adapter package не позволяет ORM API войти в Core. PostgreSQL нужен для реальных transaction, unique/composite constraints, locking и outbox behavior; SQLite/in-memory DB дали бы ложноположительные tests.

### Отклонено

- `synchronize:true` — небезопасно и не проверяет upgrade path;
- SQLite для integration tests — не воспроизводит PostgreSQL locking/constraints;
- database-per-Core-module — преждевременная распределённость;
- Kysely/Drizzle — допустимы технически, но не дают достаточной выгоды, чтобы отклоняться от более прямой Nest/TypeORM основы в 001.

## 6. Durable delivery: PostgreSQL outbox + Redis/BullMQ

### Решение

- state mutation и outbox row пишутся одной PostgreSQL transaction;
- approval-gated command создаётся как `AWAITING_APPROVAL` с outbox `HELD`; approval release переводит их в `QUEUED`/`READY`, оставляя право на effect в `AUTHORIZED` до worker-side проверки непосредственно перед вызовом;
- dispatcher claim-ит `READY` и просроченные `ENQUEUED` rows lease-ом с `FOR UPDATE SKIP LOCKED`;
- BullMQ 6/Redis 8.2 несут минимальный FR-014 envelope `{commandId, workspaceId, projectId, actor, correlationId, causationId}` и ускоряют retry/scheduling;
- worker всегда перечитывает authoritative command из PostgreSQL, отклоняет mismatch job envelope и получает durable execution lease с expiry/heartbeat;
- enqueue сохраняет `next_republish_at`, но не является terminal delivery; при Redis loss PostgreSQL sweep повторяет non-terminal `ENQUEUED` command после visibility deadline, а отдельный sweep восстанавливает stale `DISPATCHED` command после истечения execution lease;
- Redis настраивается `maxmemory-policy noeviction`; потерянная очередь восстанавливается даже если первый enqueue ранее считался успешным;
- delivery semantics явно `at-least-once`.

Источники: [BullMQ architecture](https://docs.bullmq.io/guide/architecture), [BullMQ idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs), [BullMQ job IDs](https://docs.bullmq.io/guide/jobs/job-ids), [BullMQ connections](https://docs.bullmq.io/guide/connections), [PostgreSQL 18 documentation](https://www.postgresql.org/docs/18/sql-select.html), [Redis 8.2 release notes](https://redis.io/docs/latest/operate/oss_and_stack/stack-with-enterprise/release-notes/redisce/redisos-8.2-release-notes/).

### Почему

BullMQ сам по себе не атомарен с domain transaction и допускает как повторную доставку, так и потерю volatile queue state. PostgreSQL outbox с visibility-based republish закрывает окна до и после успешного enqueue, а Redis оставляет удобные backoff/delay/worker primitives без роли business store.

### Отклонено

- Redis как единственное состояние command — нарушает Конституцию;
- синхронный Connector call внутри API transaction — удерживает locks и теряет recoverability;
- обещание exactly-once от queue — технически неверно;
- Kafka в 001 — несоразмерная local/operational стоимость.

## 7. Effect idempotency

### Решение

Observable effect считается effectively-once только как композиция:

```text
durable at-least-once dispatch
+ отдельный immutable globally unique effect idempotency key
+ connector strategy NATIVE_KEY | NATURAL_KEY_LOOKUP | RECONCILIATION
+ durable effect receipt/audit
```

Capability write operation обязана объявить поддерживаемую стратегию. Profile нельзя публиковать, если выбранная Connector implementation не доказывает одну из стратегий contract test. Client request key scope-ится actor/Workspace/Project/operation и используется только для повторного HTTP/application request. Gateway один раз генерирует отдельный globally unique `effectIdempotencyKey`; Connector и Mock Hub видят только его. Mock Hub хранит отдельные call ledger и effect ledger; тест проверяет `effectCount=1`, а не `callCount=1`.

### Почему

Есть неизбежное crash window: внешний effect уже произошёл, а локальный confirmed result ещё не committed. Stable key или deterministic lookup превращают повторный HTTP call в возврат существующего effect; reconciliation закрывает системы без native key.

### Отклонено

- пометить command confirmed до внешнего вызова — может потерять effect;
- считать absence duplicate job в Redis достаточным — job dedupe не охватывает crash после vendor call;
- distributed transaction с внешней системой — недоступна для Jira/GitLab/Mattermost и Mock Hub не должна создавать ложную модель.

## 8. Object storage в 001

### Решение

Master-spec §21 уточнён до provider-neutral S3-compatible local emulator. Для 001 выбран Adobe S3Mock 5.1.x: активный Apache-2.0 проект с официальным Docker image и persistent-store режимом. Feature 001 не вводит QA Evidence Manifest, retention или binary lifecycle: она проверяет только generic artifact reference, checksum/classification metadata, upload/read smoke и scope enforcement.

`adobe/s3mock:5.1.0` является стартовым tag; M1 фиксирует multi-arch manifest digest в Compose. Public bucket запрещён, credentials синтетические local-only, telemetry/external egress отсутствуют. Raw object data не копируется в audit/event payload и не выдаётся прямым provider URL: backend повторно авторизует запрос и proxy-stream-ит content.

MinIO Community отвергнут после актуализации: официальный repository архивирован 25 апреля 2026 года и больше не поддерживается; AIStor Free остаётся licensed product и требует отдельный license bootstrap. Это нарушило бы credential-free reproducible local flow. Источники: [архивированный MinIO repository](https://github.com/minio/minio), [AIStor container/license prerequisites](https://docs.min.io/aistor/installation/container/install/), [Adobe S3Mock usage, persistence и license](https://github.com/adobe/S3Mock/blob/main/README.md), [Adobe S3Mock 5.1.0 release](https://github.com/adobe/S3Mock/releases/tag/5.1.0).

### Почему

Так план сохраняет требование master-spec о локальном S3-compatible контуре и заранее проверяет artifact boundary, не присваивая Core QA-specific evidence semantics и не привязывая production architecture к test emulator.

### Отклонено

- убрать object-store emulator до 002 — не проверит artifact boundary foundation;
- archived MinIO Community image — нет дальнейших fixes/support;
- AIStor Free — требует account/license bootstrap и внешнего секрета;
- LocalStack — существенно шире требуемого S3 surface и имеет отдельные telemetry/EULA considerations;
- хранить blob в PostgreSQL — смешивает metadata/durable workflow с object payload;
- public URLs — обходят Project Entitlement.

## 9. HTTP и schema contracts

### Решение

- authoritative design contracts — OpenAPI 3.1;
- extension, capability, command, approval, event, Profile и Binding — JSON Schema draft 2020-12;
- TypeBox 1 является source для runtime schema + TypeScript type там, где схема реализуется кодом; Ajv 8 валидирует 2020-12;
- `$ref` только repository-local или immutable URN; runtime HTTP schema fetching запрещён;
- stable Nest DTO classes используются для HTTP transport; bootstrap явно задаёт `setOpenAPIVersion('3.1.0')`, а CI строгим validator сравнивает implementation snapshot с checked-in design contract;
- unknown fields запрещены; Nest `ValidationPipe` включает `whitelist`, `forbidNonWhitelisted`, `forbidUnknownValues`, без implicit conversion;
- RFC 9457 Problem Details — единая error shape.

Источники: [OpenAPI 3.1 specification](https://spec.openapis.org/oas/v3.1.0.html), [JSON Schema 2020-12](https://json-schema.org/draft/2020-12), [TypeBox](https://github.com/sinclairzx81/typebox), [Ajv JSON Schema support](https://ajv.js.org/json-schema.html), [NestJS OpenAPI](https://docs.nestjs.com/openapi/introduction), [NestJS validation](https://docs.nestjs.com/techniques/validation), [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html).

### Почему

HTTP DTO и versioned extension payload — разные задачи. Общая «магическая» DTO system плохо выражает динамически зарегистрированную Pack schema. `SchemaBoundValue` хранит ref/version/digest и проходит registry lookup + runtime validation.

### Отклонено

- `Record<string, any>`/универсальный `execute(any)` — разрушает capability boundary;
- только generated OpenAPI из decorators — не выражает полноценно manifest/event compatibility;
- runtime remote refs — supply-chain и availability risk;
- смешивание разных JSON Schema drafts в одном Ajv instance — неоднозначная validation semantics.

## 10. Fake OIDC и principal identity

### Решение

Отдельный Fake IdP публикует local-only OIDC discovery, authorization/token и JWKS endpoints. API проходит тот же JWT verification adapter, что будущий corporate issuer: проверяются signature, `iss`, `aud`, `exp`, `nbf`; canonical identity ищется по `(issuer, subject)`. Persona switcher получает подписанный token от fake issuer и никогда не отправляет role/entitlement как authoritative body fields.

Fake issuer имеет валидный HTTPS issuer URL `https://fake-idp:4443/oidc`, repository test CA, rotating test key fixture и заметный `LOCAL DEVELOPMENT` banner. Local OIDC runtime получает обычный Compose DNS alias `fake-idp` и certificate SAN для этого имени; special-use `.localhost` не используется внутри containers. API и Playwright trust только этот test CA. Persona switch обращается через API, поэтому обычному browser не требуется разрешать internal issuer host или доверять test CA напрямую. Metadata `issuer`, token `iss` и configured expected issuer совпадают точно. Fake auth routes не компилируются/не регистрируются в non-local composition.

Источник: [OpenID Connect Discovery 1.0](https://openid.net/specs/openid-connect-discovery-1_0.html).

### Почему

Bypass header вроде `X-User: admin` тестировал бы другой security path и легко протёк бы в deployment. Стандартный discovery/JWKS/JWT flow проверяет реальную границу, сохраняя local independence.

### Отклонено

- actor/role в request body/header — клиентская эскалация;
- один global local admin — не покрывает entitlement/isolation;
- зависимость от corporate OIDC в dev/CI — нарушает local-first.

## 11. Exact Approval и canonical hashing

### Решение

Exact subject сериализуется RFC 8785 JSON Canonicalization Scheme и хэшируется SHA-256. Subject включает schema/version IDs, scope, initiator и exact authorization basis, action/capability/operation, target/hash, payload hash, action-specific expected state (`expectedExternalState` для Connector либо local resource version+content hash для Platform action), exact Binding/Profile refs, data classification, required permission, separation-of-duty rule, effect/action key и expiry. Для `EXTERNAL_COMMAND` payload hash покрывает полный payload `SchemaBoundValue`; у `PLATFORM_ACTION` произвольного payload нет, поэтому это exact semantic content hash candidate revision, отдельно от hash typed target.

Decision status и effect-authorization status независимы. Для `EXTERNAL_COMMAND` queue release не потребляет Approval: live authorization, expiry, subject fingerprints и external expected state проверяются worker-ом непосредственно перед первым Connector invocation, а CAS consumption связан с exact command execution-attempt claim. Для `PLATFORM_ACTION` decision transaction revalidate-ит expected local state и одной DB transaction CAS-consumes Approval, применяет mutation и завершает durable platform action. Approved historical decision не переписывается при invalidation. Повтор после неоднозначного Connector crash использует только тот же command/effect key и declared idempotency/reconciliation strategy; повтор Platform action идемпотентно возвращает тот же completion.

Источник: [RFC 8785: JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785).

### Почему

Один mutable status теряет исторический факт решения или ошибочно оставляет его пригодным после role/config drift. Две оси дают честный audit и безопасный effect gate.

### Отклонено

- hash обычного `JSON.stringify` — порядок свойств/чисел может отличаться;
- approval только по `commandId` — не показывает, что именно одобрено;
- проверка роли только в момент клика — TOCTOU до worker effect;
- изменение APPROVED в CANCELLED — искажает состоявшееся решение.

## 12. Authorization, repositories и RLS

### Решение

Primary enforcement — application policy до repository/adapter плюс scoped repository interfaces и composite database constraints. Policy formula:

```text
active Membership
AND effective Project Entitlement (DENY wins)
AND active Role Permission
AND comparable Data Classification within ceiling
```

Unknown classification — deny. Application never obtains an unscoped project repository. PostgreSQL RLS откладывается до отдельного security spike и может быть добавлен только как defense-in-depth.

Structured authorization provenance имеет закрытые context variants. `PROJECT` требует минимум один
exact entitlement ref; `WORKSPACE` требует пустой entitlement set, но по-прежнему exact membership,
role assignment, policy и skill context. Enclosing command/report/audit contract выбирает variant,
поэтому Workspace validation не фабрикует Project grant, а Project effect не может его опустить.

### Почему

Policy должна одинаково защищать HTTP, worker, artifact и connector paths. RLS сразу усложняет migrations, connection pooling и administrative operations и не закрывает non-DB adapters. Composite constraints ловят accidental scope mismatch, не заменяя authorization.

### Отклонено

- UI filters — не security control;
- global repository + optional scope predicate — легко забыть;
- RLS как единственный контроль — не защищает Connector/object store и может обходиться privileged DB role;
- flat Workspace membership — нарушает ADR-0004.

## 13. Opaque logical roles и generic resource refs

### Решение

`logicalRole` в Core — validated opaque string, объявленный capability requirement в Pack manifest. Шесть значений FR-032 входят в conformance fixtures и обязаны приниматься, но Core не содержит их enum/branch logic.

Minimal Core `ProjectIntegrationBinding` содержит generic schema-bound `configurationRefs/resourceRefs`; QA-specific `suiteBindingRefs` живёт в будущем QA Project Context. Command указывает `requirementKey`; Gateway извлекает capability/version range/logicalRole из зарегистрированного manifest, поэтому Pack action не может подменить Profile.

### Почему

Иначе feature 001 одновременно требует отсутствие QA hardcode и закрепляет QA naming в Core. Opaque role удовлетворяет routing contract, не передавая семантику ядру. Generic refs сохраняют immutable pin mechanism для будущих Packs.

### Отклонено

- Core enum из шести QA roles — блокирует новые компетенции;
- произвольный profile ID от Pack — позволяет обойти Project Binding;
- `suiteBindingRefs` в Core — QA ownership leak;
- unvalidated free-form refs — скрывают incompatible config.

## 14. Manifest failure и readiness

### Решение

Registration проходит schema, digest, duplicate key/version, Core/SDK range, capability и compile-time component resolution. Canonical registration row создаётся только для принятого immutable key/version/hash. Каждая попытка boot reconciliation отдельно добавляется в append-only `extension_registration_attempts`; invalid manifest или digest drift получает `REJECTED` с machine-readable diagnostics, не перезаписывая уже принятую registration. Другие registrations и Core остаются доступны.

Deployment composition отдельно объявляет extensions, обязательные для readiness. В local composition invalid optional fixture не делает Core unready, но registry/feature availability честно показывает отказ. Missing required Dummy/Mock в acceptance composition делает readiness false.

### Почему

Требование feature — изолировать ошибку одного extension, но readiness не должна ложно говорить «готово», если deployment заявил этот extension обязательным.

### Отклонено

- crash всего process при любом invalid manifest — нарушает isolation;
- всегда healthy при rejected required extension — ложная operational готовность;
- тихо пропустить invalid extension — недиагностируемый partial failure.

## 15. Connection/Mapping/Profile/Binding immutability и secret boundary

### Решение

Connection/schema-bound Mapping/Profile/Binding имеют mutable Draft и immutable Validated/Published revisions с content hash; изменение endpoint/secret ref/policy/configuration создаёт следующую Connection revision, а mutable health хранится отдельно. Каждый переход из DRAFT атомарно pin’ит exact successful immutable Validation Report; provenance ref исключён из semantic content hash, чтобы report с subject hash не создавал цикл. Profile pin’ит exact Connection revision и optional exact Mapping revision, Published Binding revision pin-ится Work Item/command. Connection хранит только opaque `secretRef`; resolver доступен только Connector runtime. Schemas recursively запрещают known secret-value fields, а validation/reporting не раскрывают resolved value.

Rollback создаёт/активирует проверенную revision, не переписывая историю. Один Project имеет не более одной current published Binding version; один Profile — не более одной current published revision.

### Почему

Mutable config делает replay/audit недостоверным и может незаметно перенаправить command. Opaque refs удерживают credentials за Connector boundary.

### Отклонено

- encrypted secret value в platform DB — Core всё равно становится credential owner;
- mutable published JSON — ломает approval/binding fingerprints;
- latest-profile lookup в worker — меняет подготовленный effect.

## 16. Data Classification и payload policy

### Решение

Classification key — opaque policy key из ordered catalog, не жёсткий enum в application code. Local seed использует synthetic `PUBLIC`, `INTERNAL`, `RESTRICTED`; порядок задаётся данными catalog. После первой ссылки key и rank immutable; новая taxonomy/order создаёт новые versioned keys/revisions, не меняя смысл исторических решений. Unknown key запрещает доступ/effect.

Content-bearing rows несут classification. Entitlement/Binding задают ceiling, а Profile — явный allowlist classification keys; обе проверки должны пройти. Audit содержит hashes и allowlisted redacted details, а не raw sensitive payload. Command сохраняет только минимальный schema-allowed payload; secret fields запрещены, крупные/чувствительные данные передаются immutable classified reference.

### Почему

Без first-class classification четвёртый член authorization formula остался бы декларацией. Opaque keys позволяют подключить корпоративную taxonomy позже без schema rewrite.

### Отклонено

- hardcoded corporate levels — pilot input ещё неизвестен;
- classification только на Project — отдельный artifact/payload может быть строже;
- raw request/response в audit для отладки — нарушает FR-020.

## 17. Audit, logging и observability

### Решение

- append-only `audit_events` с отдельной DB role без update/delete;
- stages: requested, policy decision, approval decision/invalidation/consumption, outbox, connector attempt, confirmed/conflict/failure;
- explicit `WORKSPACE | PROJECT` scope: operational chain всегда Project-scoped, а SYSTEM pre-project webhook rejection остаётся Workspace-scoped, не фабрикует human authorization basis и читается только отдельным Workspace audit route;
- terminal Connector confirmed/conflict/failure round-trip-ит normalized result hash/code; deny/conflict/failure/security rejection требует reason code;
- structured JSON logs и OTel attributes содержат IDs, versions, outcomes, latency и classification key, но не raw payload/token/secret;
- correlation/causation IDs проходят API → command → job → connector → event;
- readiness отдельно показывает DB, migrations, Redis, S3Mock, required extensions и Mock Hub;
- optional local observability Compose profile.

Источник: [OpenTelemetry JavaScript documentation](https://opentelemetry.io/docs/languages/js/).

### Почему

Audit доказывает авторизацию и effect chain; operational logs помогают диагностике, но не заменяют durable audit. Redaction должна быть serializer policy, а не надежда на разработчика.

### Отклонено

- полный payload в traces/logs — data leak;
- audit только success events — невозможно доказать deny/conflict;
- Redis/agent memory как audit — недолговечно.

## 18. IDs, clocks и concurrency

### Решение

- opaque UUIDv4 через `crypto.randomUUID()` для entity/event/command IDs;
- ordering опирается на server `timestamptz` + explicit `entityVersion`, не на UUID;
- injectable Clock/IdGenerator для deterministic tests;
- optimistic `rowVersion`/ETag для mutable draft/admin resources;
- database unique constraints и compare-and-swap для idempotency, publish и Approval consumption;
- all timestamps UTC, client timestamps never authoritative.

### Почему

UUIDv4 встроен в Node и не требует нестандартной identifier semantics. Явный version лучше выражает ordering и stale write, чем попытка извлечь его из ID/time.

### Отклонено

- sequential integer как public ID — облегчает enumeration и смешение scope;
- UUID timestamp как единственный event order — clock/order ambiguity;
- in-process mutex — не защищает несколько worker instances.

## 19. Testing stack и gates

### Решение

- Vitest 4 для unit/component/architecture;
- `@nestjs/testing` и React Testing Library;
- Testcontainers с настоящими PostgreSQL/Redis и pinned S3Mock для integration;
- Playwright, один Chromium browser в 001;
- contract tests запускаются против Mock Connector и второй test implementation;
- arbitrary global coverage threshold отсутствует; обязательна coverage рисков AT-001…AT-019.

Источники: [Nx with Vitest](https://nx.dev/docs/technologies/test-tools/vitest/introduction), [Testcontainers for Node.js](https://node.testcontainers.org/), [Playwright installation](https://playwright.dev/docs/intro).

### Почему

Foundation должен доказывать transaction, retry, process restart, browser auth и module isolation на реальных boundaries. Line coverage не заменяет crash-window или cross-project tests.

### Отклонено

- только unit mocks — не проверяют SQL/Redis/network behavior;
- E2E против corporate systems — ломает local determinism;
- общий 80% threshold как readiness criterion — не гарантирует покрытие критических инвариантов.

## 20. Итог

Все вопросы, обозначенные feature как prerequisites к `/speckit.plan`, решены:

- monorepo conventions выбраны;
- ORM и migration strategy выбраны;
- UI default выбран и изолирован facade;
- durable delivery/effect semantics определены;
- exact Approval и Binding contracts уточнены без QA hardcode;
- local storage/identity/mock/production barrier определены;
- обязательные acceptance tests трассированы в [plan.md](plan.md).

Внешние `[PILOT INPUT REQUIRED]` не нужны для реализации 001: корпоративные endpoints, mappings, owners, IAM, Vault и реальные Connector credentials остаются за пределами этой feature.
