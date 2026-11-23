# Research: GitLab automated validation

**Feature:** `005-gitlab-automated-validation`

**Date:** 2026-09-01

**Repository baseline:** `4c422a4`

**Status:** Phase 0 complete — все архитектурные решения приняты; открытых вопросов, требующих уточнения, нет. Значения корпоративного пилота остаются versioned deployment inputs и не блокируют локальное проектирование.

## 1. Источники и метод

**Decision:** план опирается на ратифицированную constitution/ADR, завершённые Feature 003/004, текущее состояние репозитория и только официальную документацию GitLab. Документированные GitLab REST v4 surfaces фиксируются в versioned adapter contract; никакой вызов `/latest`, непроверенная особенность edition/build или догадка о корпоративной конфигурации не допускаются.

**Rationale:** Feature 005 пересекает QA authority, внешние эффекты, webhook trust и artifact access. Эти границы должны быть воспроизводимы локально и не зависеть от изменяемого поведения конкретного GitLab instance.

**Alternatives considered:** проектировать по UI GitLab, использовать непинованный «совместимый GitLab API» или принимать отсутствующие pilot values за архитектурные неизвестные. Все варианты отклонены как недетерминированные.

Основные официальные источники GitLab:

- [Pipeline trigger tokens API](https://docs.gitlab.com/api/pipeline_triggers/)
- [Pipelines API](https://docs.gitlab.com/api/pipelines/)
- [Jobs API](https://docs.gitlab.com/api/jobs/)
- [Job Artifacts API](https://docs.gitlab.com/api/job_artifacts/)
- [Project webhooks](https://docs.gitlab.com/user/project/integrations/webhooks/)
- [Webhook event payloads](https://docs.gitlab.com/user/project/integrations/webhook_events/)
- [CI Lint API](https://docs.gitlab.com/api/lint/)
- [CI/CD inputs](https://docs.gitlab.com/ci/inputs/)
- [Merge Requests API](https://docs.gitlab.com/api/merge_requests/)
- [Repository Files API](https://docs.gitlab.com/api/repository_files/)
- [REST API authentication](https://docs.gitlab.com/api/rest/authentication/)
- [Access token scopes](https://docs.gitlab.com/security/tokens/access_token_scopes/)

## 2. Implementation entry gate

**Decision:** обязательный implementation entry gate проверяет `reports/003-jira-operational-authority/final-gate.json`; GitLab-only composition не зависит от Mattermost и проверяется отдельно. `verify:005:pilot-rehearsal` требует local combined Jira+GitLab+Mattermost evidence, но не выдаёт deployment approval. Отдельный `verify:005:pilot-release` допускает только combined DEVELOPMENT/TEST HTTPS contour, fresh `reports/004-mattermost-hermes-intake/final-gate.json` и fresh Feature 003/005 evidence согласно Constitution X. Gate проверяет фактически экспортированные contracts, migration registry и API/worker composition; наличие planning-файлов само по себе не считается готовностью.

**Rationale:** Feature 005 переиспользует Jira operational authority и QA review/verdict, а из 004 — только уже опубликованные provider-neutral primitives, когда они присутствуют. Проверка реальных артефактов не позволяет незаметно реализовать второй workflow или опереться на устаревший план.

**Alternatives considered:** повторно реализовать QA review/Jira flow внутри GitLab Connector; связать standalone GitLab packages compile-time зависимостью с Mattermost; разрешить pilot без Mattermost; считать коммит или каталог `specs/` достаточным доказательством. Все варианты отклонены.

## 3. Connector package boundary

**Decision:** добавить чистый `@awp/connector-gitlab` и отдельный `@awp/connector-gitlab-persistence-typeorm`. Чистый пакет зависит только от `@awp/connector-sdk`, `@awp/platform-contracts` и platform-neutral runtime types; в нём отсутствуют TypeORM, Core, QA, Nest и React imports. Persistence-пакет владеет только GitLab discovery, webhook/rate, trigger-effect lookup и reconciliation state. QA session, SuiteBinding, AutomationAttempt, Finding и verdict остаются в `@awp/competency-qa`. HTTP реализуется Node 24 native `fetch`/WebCrypto через injected transport, clock, secret resolver и configuration ports.

**Rationale:** это повторяет доказанный Feature 003 pattern `connector-jira` + `connector-jira-persistence-typeorm`. GitLab, в отличие от Mattermost notification-only integration Feature 004, требует долговременного provider-specific reconciliation state.

**Alternatives considered:** GitLab SDK, provider DTO в Core/QA, прямые вызовы из Nest controller, хранение QA attempts в connector persistence. Они отклонены из-за vendor coupling и обхода Broker/QA authority.

## 4. Adapter family и instance compatibility

**Decision:** Connection pin'ит `gitlab-rest-v4@1.x`, точные edition/offering, instance version/build, REST base URL и immutable discovered-capability snapshot hash. Отдельно pin'ятся dialects pipeline input и webhook authentication. Pipeline `inputs` разрешаются только при подтверждённой поддержке instance; официальный API сделал их generally available в GitLab 18.1. Более старый подтверждённый instance может использовать schema-bound `variables`, но только с отдельным Profile version. Никакое silent auto-detection после publication не меняет поведение Profile.

**Rationale:** GitLab.com, Self-Managed и Dedicated, а также разные версии Self-Managed, отличаются feature availability. Например, Standard Webhooks signing tokens являются новой возможностью, а CI/CD inputs имеют собственную version history.

**Alternatives considered:** один mutable `gitlab` adapter, всегда использовать самые новые inputs/signatures, автоматически откатываться на variables или legacy auth. Все варианты отклонены как несовместимые с pinned contracts.

## 5. Capability contracts и QA manifest versioning

**Decision:** зарегистрировать ровно три канонических capability keys из feature spec:

```text
source-context.read@1.0.0
test-executor.trigger-status@1.0.0
artifact.ci-read@1.0.0
```

Каждый capability имеет закрытые typed target/input/result schemas; `execute(any)` отсутствует. Старые концептуальные имена `source-context`, `ci-pipeline`, `test-executor.trigger`, `test-executor.status` и `artifact-reference` документируются только как terminology mapping и не регистрируются как aliases. Публикуются additive `competency-qa@1.2.0` и `qa.validation@1.2.0`; версии 1.0/1.1 не изменяются. В 1.2 automation feature требует logical roles `SOURCE_CONTEXT`, `TEST_EXECUTION`, `ARTIFACT_SOURCE`, а Mattermost requirements являются optional feature capabilities.

**Rationale:** точные capability names исключают неоднозначный Binding resolution. Новая manifest version нужна, потому что `packages/competency-qa/src/manifest-v1.1.ts` делает intake/notification messaging обязательными, хотя Feature 005 обязана работать без Mattermost.

**Alternatives considered:** молча переименовать capability, зарегистрировать несколько aliases, изменить manifest 1.1 на месте или сделать GitLab/Mattermost обязательными для manual QA. Все варианты отклонены.

## 6. Profile topology, discovery и validation

**Decision:** Project Integration Binding resolves three independent GitLab
logical roles to immutable Core Profile revisions, even when they share one
Core Connection. The published Profile wire wrapper's schema-bound
`connectorConfiguration` (called `profileConfiguration` by the current domain
model) uses `gitlab-profile-configuration@1.0.0` and pins numeric GitLab
project ID, allowed refs/commit/MR target forms, environment/input mapping,
result schema digest, artifact policy, rate/concurrency bounds and forbidden
production/deploy evidence. The Connection's schema-bound
`connectorConfiguration` uses
`gitlab-connection-configuration@1.0.0`: distinct read, trigger and webhook
`secretref://` references plus a closed operation-to-identity-slot map. The
outer `serviceIdentitySecretRef` equals the read reference as a compatibility
anchor; Connector validation proves the three references/fingerprints differ.
This needs no Core column or provider-specific Core semantic. The existing Core
lifecycle remains `DRAFT → VALIDATED → PUBLISHED → RETIRED`; discovery is
immutable validation evidence, not a second lifecycle state. Validation
performs read-only project/MR/repository/pipeline/job/artifact probes and CI
Lint `dry_run`/`include_jobs` for the exact ref. It stores only bounded
job/stage/policy evidence and rejects deploy/production reachability.

**Rationale:** numeric IDs и linted effective configuration устойчивее names/UI labels. [CI Lint API](https://docs.gitlab.com/api/lint/) валидирует configuration в project/ref context без редактирования `.gitlab-ci.yml`.

**Alternatives considered:** resolve project/ref/job по имени при каждом запуске, first trigger as validation, сохранять raw CI variables/secrets или позволять Profile mutation после publication. Все варианты отклонены.

## 7. SuiteBinding ownership и capability mode

**Decision:** QA Pack владеет immutable versioned `SuiteBinding`: owner,
Workspace/Project, logical suite key/definition hash, provider-neutral logical
pipeline/ref/result-job contract, allowed target forms, internal environment
refs, provider-neutral parameter schema, expected result schema,
artifact/retry/quarantine policy refs and composed verification evidence/hash.
Exact GitLab numeric project/ref/job/artifact path/input mapping remains solely
in Connector Profile, while Core Project Binding owns role resolution; these
responsibilities are not duplicated. `QaTargetSnapshot` следующей версии
pin'ит exact SuiteBinding ref/hash together with existing build, environment
revision and test-data/account lease plus the exact three-role Project
Binding/Profile/Connection pin set actually used. `qaCapabilityMode` is derived
from current QA context, SuiteBinding and published validated Profiles:
`FULL_QA` only for the complete intersection; otherwise `MANUAL_ONLY`.

**Rationale:** существующий `packages/competency-qa/src/domain/snapshots.ts` уже содержит почти весь воспроизводимый target, но не SuiteBinding. Вычисляемый mode не может устареть как caller-controlled enum.

**Alternatives considered:** store QA suite semantics in the GitLab Connector, duplicate GitLab ref/job/input mapping in QA, accept an arbitrary job/ref from the API caller, or persist mutable `FULL_QA=true`. All were rejected.

## 8. Source context и optional Candidate producer

**Decision:** `source-context.read` normalizes only an allowlisted Merge Request, commit or build identity/state and bounded safe metadata, pinning numeric project ID, MR IID, commit SHA, build ref and content fingerprints. Repository files, blobs and diffs are not part of capability `1.0.0`. An existing Work Item/Session can use the capability without Feature 004. The GitLab Candidate producer is enabled only in a composition where the provider-neutral Candidate flow is present and explicitly enabled; it adds an authoritative source observation but never creates a Work Item or launches tests automatically.

**Rationale:** `packages/runtime-composition/src/intake/candidate-sources.ts` уже регистрирует GitLab как `NOT_INSTALLED/DENY`, но Feature 005 объявляет 004 optional. Поэтому Candidate integration должна оставаться необязательным consumer adapter, а не скрытой зависимостью GitLab automation.

**Alternatives considered:** сделать 004 обязательной, создавать Work Item из MR webhook, автоматически запускать regression на source event или получать неограниченный repository content. Все варианты отклонены.

## 9. Session mode и provider-neutral execution identity

**Decision:** расширить QA domain до `MANUAL | AUTOMATED`, не создавая второго review flow. В persistence вводится provider-neutral `qa_attempt_identities` identity spine; существующие `qa_manual_attempts` становятся manual detail и backfill'ятся один-к-одному, а `qa_automation_attempts` хранит immutable automated configuration. Status/external receipt развиваются append-only через `qa_automation_attempt_status_revisions`. Foreign keys observations/result memberships и DB completeness/flaky functions переводятся с прямой ссылки на `qa_manual_attempts` на shared Attempt identity. Исторические manual rows и contracts остаются читаемыми.

**Rationale:** migration `packages/competency-qa/src/persistence/migrations/2015-qa-manual-execution.ts` напрямую связывает `qa_observations` и `qa_plan_item_result_attempt_memberships` с `qa_manual_attempts` и делает provider-neutral reuse невозможным без expand/backfill. Immutable attempt header плюс revisions разрешают конфликт между требованием immutability и меняющимся pipeline status.

**Alternatives considered:** параллельные automated observation/result/review tables, добавление mutable status колонок в immutable attempt, превращение всех manual rows в GitLab-like DTO. Все варианты отклонены.

## 10. Launch aggregate и transactional command creation

**Decision:** `qa_automation_launch_requests` обеспечивает уникальность `(workspaceId, projectId, testSessionId, requestKeyHash)`. В одной PostgreSQL transaction authorized launch создаёт/replays launch claim, attempt №1 в `TRIGGER_PENDING`, exact snapshots/pins, ConnectorCommand, audit и outbox. Повтор того же ключа и request hash возвращает существующий launch/attempt/pipeline и не создаёт новый command; другой hash конфликтует. Automatic infra retry создаёт attempt №2 внутри той же lineage с отдельным deterministic launch key/effect key; original request key сохраняется как root correlation. Transport retry одной команды и domain retry являются разными понятиями.

**Rationale:** уникальность только на attempt не совместима с несколькими attempts одной retry lineage. Durable launch aggregate даёт точную семантику US-002 и позволяет атомарно связать QA state с generic command/outbox.

**Alternatives considered:** memory/Redis dedupe, uniqueness только по pipeline ID, новый request key для автоматического retry или trigger до DB commit. Все варианты отклонены.

## 11. Trigger contract и parameter safety

**Decision:** V1 использует allowlisted `POST /projects/:id/trigger/pipeline` с exact project/ref и project-owned trigger credential. Read/status/artifact доступ выполняется отдельной read-only project/service credential. SuiteBinding выбирает один versioned parameter dialect: typed CI/CD `inputs` предпочтительны; variables разрешены только как exact closed mapping. Backend строит payload сам. Caller не может передать raw variable name, shell fragment, job name, URL, token или production environment. Один reserved non-secret correlation marker используется только для effect lookup и запрещён как behavior/deploy input. CI configuration declares and validates typed inputs according to [CI/CD inputs](https://docs.gitlab.com/ci/inputs/).

**Rationale:** trigger token отделяет узкое право запуска от read credential; typed inputs имеют type/options/regex validation и immutable initialization semantics. Разделение credentials уменьшает blast radius по сравнению с одним broad `api` token.

**Alternatives considered:** один Maintainer/API token, generic Pipelines API с caller variables, arbitrary job play/retry, shell command templating или передача секретов как variables. Все варианты отклонены.

## 12. Trigger ambiguity и provider effect lookup

**Decision:** GitLab REST endpoints не документируют idempotency header/parameter. До POST connector проверяет durable effect state и выполняет bounded lookup по exact project/ref/source/sha/time window, затем читает pipeline variables для reserved marker. Непосредственно перед возможным provider effect фиксируется `effectInvocationStartedAt`. После ambiguous timeout/connection loss POST не повторяется: reconciliation ищет marker. Один match подтверждает pipeline; несколько — security conflict/quarantine; ноль до закрытия bounded horizon остаётся `LOOKUP_REQUIRED`, затем `AMBIGUOUS/INCOMPLETE` для human resolution. Автоматический второй POST запрещён без versioned provider proof `NOT_APPLIED`.

**Rationale:** официальный [Pipelines API](https://docs.gitlab.com/api/pipelines/) позволяет list/filter pipelines и читать variables конкретного pipeline, но не предоставляет native idempotency guarantee. Stop-on-ambiguity предотвращает дубликат ценой явного uncertain outcome.

**Alternatives considered:** blind retry, DB ledger без provider lookup, match по последнему pipeline/ref, summary/name matching или заявление о физическом exactly-once. Все варианты отклонены.

## 13. Status, result normalization и terminality

**Decision:** pipeline/job APIs определяют transport state, но не QA verdict. Connector re-read'ит exact pipeline и все relevant jobs, включая retried jobs, затем валидирует versioned machine-readable result artifact. `success` без валидного result становится `INCOMPLETE`, не `PASS`. Closed mapping:

```text
validated passed result                 -> PASS
validated assertion failures            -> ASSERTION_FAILED
allowlisted infrastructure code          -> INFRA_FAILED
platform/suite timeout contract          -> TIMEOUT
provider/user cancellation               -> CANCELLED
missing, contradictory, unknown schema   -> INCOMPLETE
```

Terminal attempt переводит session только в `REVIEW_REQUIRED`. Unknown pipeline/job status также fail-closed в pending reconciliation или `INCOMPLETE`, никогда в PASS.

**Rationale:** GitLab pipeline `success/failed` смешивает execution transport и test semantics. Machine result schema и exact jobs/artifacts нужны для воспроизводимой классификации.

**Alternatives considered:** `pipeline.success = QA PASS`, `pipeline.failed = ASSERTION_FAILED`, parsing console text или новый automation-specific Finding taxonomy. Все варианты отклонены.

## 14. Webhook trust и reconciliation

**Decision:** API adapter сохраняет exact raw bytes. Published Feature 005 Profile требует `STANDARD_WEBHOOKS_HMAC_SHA256`; Standard Webhooks проверяются по `webhook-id`, `webhook-timestamp`, `webhook-signature` и raw body constant-time. Legacy `X-Gitlab-Token` сам по себе не является подписью и не проходит ни local, ни live security gate; stateful Mock GitLab воспроизводит тот же HMAC contract. Instance без поддерживаемого signing dialect остаётся live-gated до отдельного versioned trusted-gateway design. Ingress выполняет size/content-type, exact Connection/project, signature/freshness, dedupe/replay и schema checks, сохраняет quarantined receipt, ACK'ает без внешнего read. Pipeline/Job Hook является unordered invalidation signal; worker всегда перечитывает authoritative pipeline/jobs/result. Polling active attempts и durable reconciliation cursor восстанавливает lost/out-of-order webhooks.

**Rationale:** [GitLab webhooks](https://docs.gitlab.com/user/project/integrations/webhooks/) документируют Standard Webhooks HMAC, delivery ID и timestamp, а [webhook events](https://docs.gitlab.com/user/project/integrations/webhook_events/) — Pipeline/Job event payloads. Payload не является достаточным источником истины.

**Alternatives considered:** применять webhook payload напрямую, доверять source IP или `X-Gitlab-Token` как подписи, дедуплицировать только по payload timestamp, считать webhook гарантированной доставкой. Все варианты отклонены.

## 15. Retry, explicit rerun и flaky lineage

**Decision:** только canonical allowlisted deterministic infrastructure code допускает один automatic retry; retry создаёт новый pipeline и immutable attempt №2. GitLab `POST .../retry` не используется, потому что он переиспользует pipeline и смешивает provenance. Assertion, unknown schema, policy/auth error, timeout и cancellation автоматически не ретраятся. Human-authorized rerun является новой explicit command с новым requestKey, остаётся в той же session lineage и ограничивается published SuiteBinding quota. Любая lineage с `ASSERTION_FAILED → PASS` получает review flag `FLAKY_SUSPECTED`; исходный failure остаётся в evidence. Quarantine имеет owner/reason/expiry и не меняет technical outcome.

**Rationale:** новый attempt сохраняет exact target/config/time и отличает transport recovery от повторного теста. Existing QA result model уже поддерживает `FLAKY_SUSPECTED` и human disposition.

**Alternatives considered:** retry любого failed pipeline, in-place overwrite результата, GitLab pipeline retry endpoint, скрытие quarantined failures или автоматический PASS после успешного retry. Все варианты отклонены.

## 16. Artifact provenance, storage и access

**Decision:** GitLab artifact регистрируется как project-scoped Core `ArtifactReference`, принадлежащий exact AutomationAttempt, с opaque provider locator, checksum, size, media type, classification, retention и availability. Exact external project/pipeline/job/artifact identity, Binding/Profile/Suite pins and locator hash live in Connector persistence and QA evidence memberships. Existing Core metadata/opaque-locator contract is sufficient, so Feature 005 plans no Core migration. Raw GitLab URL/token is not returned to the client. Default V1 storage port proxy-streams the exact job artifact after repeated Project Entitlement/classification authorization and provider scope recheck. Raw bytes are not stored or sent to a model automatically. Long-term S3 copy remains out of scope; if GitLab retention is shorter than the review/evidence SLA, Profile validation cannot publish.

**Rationale:** текущий `packages/platform-core/src/artifacts/artifact-service.ts` уже скрывает `opaqueLocator` и reauthorizes content; structured integration pins remain owner-specific without contaminating Core with GitLab columns. [Job Artifacts API](https://docs.gitlab.com/api/job_artifacts/) предоставляет download по exact job ID и может redirect через CDN, поэтому proxy должен контролировать redirect/host и не раскрывать provider URL. Если реализация обнаружит отсутствующий generic Core invariant, это требует отдельного design/ADR review, а не скрытой provider-specific migration.

**Alternatives considered:** сохранять raw URL, отдавать signed provider link браузеру, автоматически загружать artifact модели, всегда копировать в S3 или считать retention достаточным без validation. Все варианты отклонены.

## 17. Human QA authority

**Decision:** AutomationAttempt производит только technical outcome, observations и artifact evidence. Existing `QaPlanItemResult`, Finding taxonomy, evidence manifest, session review и verdict signatures переиспользуются без автоматического adjudication. QA Executor формирует canonical result/review, разрешает `FLAKY_SUSPECTED` и подписывает Session Outcome; risk-based reviewer policy остаётся обязательной для high/critical/waiver. PASS pipeline не закрывает TestSession, Jira Work Item или release decision.

**Rationale:** `packages/competency-qa/src/domain/test-session.ts` уже требует HUMAN для completion из `REVIEW_REQUIRED`, а Feature 002/003 владеют QA/Jira authority. GitLab является исполнителем теста, не судьёй качества.

**Alternatives considered:** auto-sign verdict, отдельный automation verdict enum, auto-close Jira или считать provider status release approval. Все варианты отклонены.

## 18. Authorization, credentials и production deny

**Decision:** authorized launch проходит HUMAN identity, Workspace membership,
Project Entitlement, QA role, Tool Grant, exact confirmation, classification и
environment policy до command creation и повторно перед connector invocation.
Connection хранит только schema-validated `secretref://` references,
fingerprints/rotation state and the immutable routing
`pipeline.trigger→TRIGGER`, all source/status/artifact reads `→READ` and
webhook verification `→WEBHOOK`. Read identity has exact `read_api` scope;
trigger material can launch only the dedicated allowlisted test pipeline.
Push, repository/CI config edit, protected branch/settings/secret read,
deploy/production environment and arbitrary job APIs are absent from the
capability contract and blocked by Profile, GitLab permissions/protected
environments, runtime allowlist and network policy. 401/403 terminally disable
the affected Profile/Connection path until revalidation.

**Rationale:** одна application check не является достаточной защитой от production/deploy. Разделение read и trigger credentials плюс defense in depth выполняет FR-001…FR-005 и SC-006/007.

**Alternatives considered:** human PAT, shared group Owner token, environment-name string check, UI-only deny или «dry run» against production. Все варианты отклонены.

## 19. Degradation, rate budget и cancellation

**Decision:** GitLab outage затрагивает только automated path: неотправленный launch остаётся pending, started/unknown attempt — reconciliation/error, а manual sessions и Jira workflow продолжаются. 429 использует bounded server-hint-aware backoff и connector-specific rate budget; safe GET/HEAD/lookup может retry по closed taxonomy. После invocation marker trigger POST не retry. 5xx/network errors до marker могут retry transport, после marker переходят в lookup. V1 не публикует provider cancel operation: он только нормализует наблюдённую GitLab cancellation в `CANCELLED`. Platform timeout не предполагает, что provider pipeline остановлен, и продолжает background reconciliation.

**Rationale:** queue/retry — механизм восстановления, а не источник истины. Отделение GitLab от manual/Jira contour выполняет US-004.

**Alternatives considered:** блокировать весь Work Item при GitLab outage, unlimited exponential retry, автоматически cancel чужих pipelines или принимать Redis/BullMQ state как durable outcome. Все варианты отклонены.

## 20. Runtime composition и delivery units

**Decision:** добавить required standalone local key `qa-jira-gitlab-local` и combined key `qa-jira-gitlab-mattermost-local`, сохранив все существующие keys. Standalone key обязателен для независимого implementation/conformance; combined local key и fresh Feature 004 evidence дают только pilot rehearsal. Pilot release требует combined `development|test` key и HTTPS metadata. Non-prod equivalents допускаются только metadata gate. Provider assembly размещается в `packages/runtime-composition/src/gitlab/`; capability routing расширяет `packages/runtime-composition/src/worker/contributions.ts`. Provider-specific API/webhook/automation controllers находятся в `apps/api/src/extensions/`; generic `platform-runtime-nest` остаётся provider-free. API никогда не вызывает GitLab inline: worker исполняет durable command. Mock Hub получает отдельный GitLab module и local CLI/scenario tooling.

**Rationale:** это совпадает с Feature 003/004 static composition pattern и сохраняет существующие API/worker deployment units без нового сетевого trust boundary.

**Alternatives considered:** заменить старые compositions, встроить GitLab всегда, выделить новый microservice или выполнять trigger в HTTP request. Все варианты отклонены.

## 21. Migration ownership и order

**Decision:** использовать следующий monotonic order поверх текущих Core `0120`, QA `2040`, Jira `3040`; Feature 005 не добавляет Core migration:

```text
2050  QA SuiteBinding, AUTOMATED mode and provider-neutral execution-attempt identity/backfill
2055  QA launch claims, automation attempts/status/results, retry/artifact memberships and shared evidence FKs
2060  QA quarantine, Attempt-set freeze and mode-specific review/completion guards
4000  GitLab discovery/Profile validation facts
4010  GitLab webhook receipt/rate/reconciliation state
4020  GitLab trigger effect lookup/ambiguity/provider receipt/artifact locator state
0060  Mock Hub GitLab project/MR/commit/pipeline/job state
0061  Mock Hub machine result/artifact metadata and deterministic bytes/checksums
0062  Mock Hub trigger audit, faults and webhook delivery/effect state
```

Entity inventory и migration contribution registry обновляются в том же slice. Combined registry остаётся строго упорядоченным: Core `<1000`, extensions `>1000`; QA 2xxx, Jira 3xxx, GitLab 4xxx. Backfill и constraints выполняются до переключения DB functions, после чего старые manual contracts продолжают читаться.

**Rationale:** диапазоны следуют существующим owners и pattern Feature 003. Отдельные migrations позволяют проверить expand/backfill и provider tables на PostgreSQL 17/18.

**Alternatives considered:** GitLab tables в Core/QA migration, повторное использование Jira 3xxx, destructive rename/drop manual tables или один неразделимый migration. Все варианты отклонены.

## 22. Contracts и offline schema registry

**Decision:** добавить Feature 005 schema contribution с order `500` в `packages/platform-contracts/src/schema-contributions.ts`. Публикуются JSON Schema 2020-12 для capability/Profile/SuiteBinding/launch/attempt/result/webhook/metadata и pilot-gate evidence packages, OpenAPI 3.1 API snapshots и AsyncAPI 3.0 event/webhook snapshots. Все `$ref` разрешаются offline, examples проходят positive/negative validation, digest и backward-compatibility checks. `tools/contracts/build-openapi-snapshots.mts`, где сейчас явно перечислены Jira/Mattermost roots, расширяется GitLab roots.

**Rationale:** JSON Schema является исполняемым wire/persistence boundary: она не позволяет connector, UI, webhook или pilot metadata интерпретировать произвольные поля по-разному и фиксирует digest exact contract.

**Alternatives considered:** TypeScript types без runtime validation, vendor payload как public contract, online schema resolution или перезапись старых schemas. Все варианты отклонены.

## 23. Local mock и conformance

**Decision:** protocol-faithful stateful GitLab Mock Hub реализует REST v4 project/MR/repository, pipeline trigger/list/get/variables, jobs, artifacts, CI lint и Pipeline/Job webhooks. Сценарии покрывают duplicate request, timeout before/after pipeline creation, zero/one/multiple effect-marker lookup, out-of-order/duplicate/lost webhook, invalid signature/replay/wrong project, 401/403/404/429/5xx, unknown status/result schema, missing/expired/checksum-mismatched artifact, forbidden ref/input/environment/deploy target, one infra retry и flaky lineage. Production connector/runtime запускается против mock без замен на function stubs.

**Rationale:** критические гарантии Feature 005 являются process-level: ambiguity, restarts, replay, scope и reconciliation нельзя доказать unit mock'ами DTO.

**Alternatives considered:** stateless canned responses, mocked connector functions, обязательный real GitLab в CI или happy-path-only E2E. Все варианты отклонены.

## 24. Technical baseline

**Decision:** сохранить repository baseline: Node `24.20.0`, pnpm `11.21.0`, TypeScript `6.0.3`, Nx `23.1.2`, Nest `11.2.3`, TypeORM `1.1.0`, BullMQ `6.3.1`, Ajv `8.20.0`, TypeBox `1.3.19`, Vitest `4.1.11`, Playwright `1.62.1`, strict ESM/ES2024/NodeNext. Persistence проверяется на PostgreSQL `17.7` и `18.6`; runtime использует Redis `8.2.9`. Новая production dependency для GitLab не добавляется без доказанной необходимости.

**Rationale:** native fetch/WebCrypto, текущий schema stack, queue и TypeORM полностью покрывают требуемую интеграцию; сохранение toolchain уменьшает scope Feature 005.

**Alternatives considered:** GitLab SDK, новая workflow engine, отдельная database, upgrade toolchain или зависимость от browser automation для API integration. Все варианты отклонены.

## 25. Observability и evidence

**Decision:** metrics/audit имеют bounded labels и exact correlation chain `workspace/project/workItem/session/launch/attempt/command/effect/pipeline/job`. Они покрывают trigger/result outcome, dedupe/ambiguity, queue/wait/run/reconciliation lag, infra retry/flaky rate, artifact failures, policy denials, forbidden production attempts и Connection/Profile health; raw tokens, variables, artifact content и external untrusted text не логируются. Required verification включает architecture imports, offline contracts, real PostgreSQL migrations, connector conformance/security, API/worker/browser E2E US-001…US-004, restart smoke, FR/SC traceability и task/runtime-bound final gate.

**Rationale:** cardinality и secret safety должны быть управляемы, а финальный PASS обязан доказывать end-to-end recovery и authority, а не только line coverage.

**Alternatives considered:** pipeline URL/token в логах, labels по arbitrary ref/error text, unit tests only, manual GitLab demo или отчёт, созданный до закрытия tasks. Все варианты отклонены.

## 26. Pilot metadata gate и resolved ambiguity register

**Decision:** live contour требует immutable, secret-free `GitLabPilotMetadataPackage@1.0.0` для одного exact Workspace/Project. Он содержит instance edition/version/build/API/dialects; base URL/network ownership; numeric project/MR/source contract; read/trigger/webhook secret refs и safe fingerprints/owners/rotation evidence; runner/container readiness; trigger endpoint/ref; SuiteBinding/environment/input/variable allowlists; CI Lint/no-deploy evidence; result schema ref/digest; artifact types/size/retention/access; infra code taxonomy; timeout/cancellation/concurrency/cost bounds; webhook signing/delivery/replay contract; rate budget; profile/binding/validation refs и explicit operator opt-in. Secret values в package отсутствуют. Missing/invalid fields дают `SKIPPED_GATED`, а не guessed PASS или local failure.

Следующие неоднозначности считаются закрытыми design decisions, а их concrete values — deployment facts:

| Тема | Зафиксированное решение |
|---|---|
| GitLab edition/build | exact pinned metadata + discovered capability hash |
| Trigger API/ref | versioned Profile; trigger-token endpoint по умолчанию |
| Inputs/variables | typed inputs preferred; exact schema-bound variables only for validated dialect |
| Idempotency | durable launch key + effect marker lookup + no blind resend |
| Webhook auth | Standard Webhooks HMAC или signed gateway; legacy token alone не проходит live gate |
| Result | exact schema digest; unknown/missing = `INCOMPLETE` |
| Retry | один automatic retry только для allowlisted `INFRA_FAILED` code |
| Artifacts | authorized proxy; retention must cover evidence SLA or publication fails |
| Production/deploy | unreachable through five independent controls: project identity, GitLab CI/protected-environment policy, Profile, platform runtime policy and egress/network policy |
| Mattermost | отсутствует в GitLab dependency graph и optional для standalone conformance; local combined evidence даёт rehearsal, DEVELOPMENT/TEST combined evidence обязательно для pilot release |

**Rationale:** корпоративные IDs, scopes, endpoints и limits невозможно честно угадать, но их отсутствие не оставляет архитектуру недоопределённой. Machine-readable gate сохраняет local-first delivery и fail-closed live enablement.

**Alternatives considered:** placeholders в published Profile, secrets в `.env`/docs, live dependency в required CI, выбор значений во время implementation или незакрытые planning markers. Все варианты отклонены.
