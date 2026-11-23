# Data Model: QA manual walking skeleton

**Feature:** `002-qa-manual-walking-skeleton`  
**Статус:** Phase 1 implementation design  
**Хранилище:** PostgreSQL 17/18, TypeORM migrations, `synchronize:false`  
**Pack:** `competency-qa@1.0.0`  
**Work Type:** `qa.validation@1.0.0`

## 1. Назначение и нормативная граница

Этот документ задаёт durable-модель feature 002 для ручного QA walking skeleton:

- QA Project Context и versioned review/rule pins;
- `QaRequestExtension`, deterministic readiness и required-session planning;
- MANUAL `TestSession`, `PlanItem`, `ManualAttempt` и `Observation`;
- human-classified `Finding`, defect draft и поздний canonical `DefectLink`;
- signed, revisioned Evidence Manifest;
- human-signed QA Verdict, deterministic DoD и externally confirmed completion.

Нормативные источники, в порядке приоритета:

1. [Конституция](../../.specify/memory/constitution.md);
2. [feature specification](./spec.md);
3. [ADR-0003](../../docs/adr/0003-qa-session-evidence-verdict.md) и остальные принятые ADR;
4. [Master Specification v2](../../docs/agentic-workspace-platform-master-spec-v2.md);
5. опубликованные public artifacts [feature 001](../001-extension-kernel-local-skeleton/data-model.md);
6. [research.md](./research.md) и [plan.md](./plan.md).

Feature 002 не добавляет `AUTOMATED` execution, Jira-specific поля, release decision, reusable test-case repository или production target. Вся модель ниже deterministic/manual и работает без model provider.

## 2. Владение агрегатами и направление зависимости

### 2.1. Source of truth

| Данные | Канонический владелец | Правило записи |
|---|---|---|
| Intake Draft, Work Item, normalized operational projection | Platform Core | Только generic Core use case/UoW |
| Operational Binding, connector command/result, Approval, outbox, audit | Platform Core | Только generic Core ports и repositories |
| Artifact reference/availability | Platform Core artifact module | QA хранит scoped link и подписанный metadata snapshot |
| External request/defect/status/version | Mock Hub в 002, Jira в 003 | Только typed Connector effect + confirmation |
| QA request facts/readiness/plan | QA Pack | QA repositories |
| Session/execution/Finding/evidence/Verdict/DoD | QA Pack | QA repositories и human-only domain actions |
| Release/no-release decision | Вне платформы | Сущности, поля и события отсутствуют |

`normalizedStatus` в Core является derived projection подтверждённого внешнего состояния. Финальное значение — `DONE`. Значение `CLOSED` не входит в Core `NormalizedStatus` и не создаётся QA Pack-ом.

### 2.2. Жёсткая граница Core/QA

- QA migrations создают и изменяют только таблицы с префиксом `qa_` в диапазоне `2000…2030`.
- QA repository/application code не выполняет `INSERT`, `UPDATE`, `DELETE` или `ALTER` над `work_items`, `operational_bindings`, `intake_drafts`, `connector_commands`, `approvals`, `event_outbox`, `audit_events` и другими Core tables.
- QA таблицы могут иметь scoped foreign keys на стабильные Core IDs, как разрешено master model; это reference, а не владение. Core migrations и Core entities не имеют FK/import на `qa_*`.
- QA Pack не импортирует Connector implementation или vendor SDK. Он хранит только typed capability refs, binding/profile version refs и confirmed normalized receipt refs.
- Любое Core + QA изменение после внешнего результата выполняет generic operational-confirmation UoW из Core. QA подключается transaction-aware hook-ом, которому доступен только Pack-owned write port.
- Architecture tests запрещают Core → QA import, QA SQL mutation Core tables и QA-specific branch/switch в generic UoW.

### 2.3. Aggregate ownership

| Aggregate root | Owned rows | Внешние ссылки |
|---|---|---|
| `QaProjectContext` | `qa_project_contexts`, `qa_project_context_versions` | Project, rule/policy refs |
| `RiskReviewPolicy` | `qa_risk_review_policies`, `qa_risk_review_policy_versions` | Project, classification taxonomy |
| `QaRequestExtension` | stable header, append-only request-input/readiness revisions, waiver refs | Work Item, Intake Draft, Work Type definition |
| `RequiredSessionPlan` | header, immutable versions, version requirements | Work Item, QA request, approved waivers |
| `TestSession` | session, Plan Items, Attempts, result revisions, Observations, session reviews | Work Item, required-plan version, artifact refs |
| `Finding` | finding header, finding-review revisions, scoped observation memberships | Session, Observations |
| `DefectPublication` | immutable draft candidates, late DefectLink | Finding, generic Approval/Command, external entity |
| `EvidenceManifest` | manifest header, signed revisions, artifact links | Session review, Core artifact refs |
| `QaVerdict` | verdict revisions and signatures | Work Item, exact session/evidence revisions |
| `QaCompletion` | DoD assessments, completion candidates, append-only final-close confirmations and post-close correction markers | Verdict, Evidence Manifest revisions, generic Approval/Command, Core projection |

Cross-aggregate mutation выполняется application UoW с optimistic locks. Aggregate не получает mutable object reference другого aggregate и не обходит его invariant API.

## 3. Общие соглашения хранения

### 3.1. Scope и идентификаторы

- Primary key — opaque UUID.
- Каждая `qa_*` строка, включая join/version/signature rows, содержит `workspace_id` и `project_id`.
- Каждый parent имеет `UNIQUE(id, workspace_id, project_id)`; каждый child использует composite FK в том же порядке.
- Work Item-scoped rows дополнительно повторяют `work_item_id`; Session-scoped rows повторяют `test_session_id`.
- Ни один public/repository method не принимает только entity ID. Минимальная сигнатура lookup: `Scope { workspaceId, projectId } + id`.
- Cross-workspace/project reference является constraint violation; API deny выполняется до lookup child, artifact storage, model, queue, Broker или Connector.

### 3.2. Время, concurrency и actors

- Время хранится как `timestamptz` UTC.
- Mutable headers/state machines имеют `row_version bigint` и изменяются через `If-Match`/CAS.
- Human-only решения хранят verified `actor_id`, actor kind snapshot=`HUMAN`, role/permission key, authorization basis JSON и его canonical hash.
- Service/Hermes/Connector identity не может подтвердить readiness, классифицировать/dispose Finding, review Session, подписать manifest/Verdict, принять risk или approve close.
- Correlation/causation IDs обязательны на mutation rows; idempotency/effect keys остаются в Core command/action model и pin-ятся QA candidate-ом, когда участвуют в решении.

### 3.3. Версии, JSON и hash

- Canonical JSON валидируется versioned JSON Schema 2020-12 до persistence.
- Content hash — `SHA-256(RFC 8785 JCS(payload))`.
- Version refs используют `{id, version, contentHash}`; Connector refs — exact `{id, version}` плюс chain fingerprint, где он нужен для effect.
- Published contexts/policies, RequiredSessionPlan versions, result revisions, observations, Finding review revisions, signed manifest revisions, session reviews, Verdict contents/signatures и DoD assessments являются append-only.
- Исторические rows не вычисляются повторно по current policy. Они pin-ят exact work-type, context, rule, evidence-policy и risk-policy versions.
- JSON payload не содержит password, token, cookie, raw credential, presigned URL или object-store locator. Разрешены только opaque refs.

### 3.4. Classification и удаление

- Каждая content-bearing row имеет `data_classification_key` с FK на Core classification catalog.
- Aggregate classification равна максимуму classification собственных facts и связанных artifacts.
- Signed/history/external-effect rows не hard-delete-ятся обычными use cases.
- Expiry binary меняет только Core artifact availability. QA metadata, checksum, signature и audit chain сохраняются.

## 4. Project policy и request planning — migrations 2000/2005

### 4.1. `qa_project_contexts`

Стабильный header, ровно один на `(workspace_id, project_id)`:

| Поле | Назначение |
|---|---|
| `id`, `workspace_id`, `project_id` | Scoped identity |
| `current_published_version_id` | Exact current version pointer |
| `row_version` | CAS публикации новой version |
| `created_at`, `updated_at` | Audit timestamps |

Constraints:

- `UNIQUE(workspace_id, project_id)`;
- current pointer ссылается на version того же header/scope;
- Core `projects` не ссылается обратно на context;
- pointer меняется только после schema/rule/config validation. Historical request не следует за pointer автоматически.

### 4.2. `qa_project_context_versions`

Canonical row создаётся только в опубликованном виде и после insert неизменяем:

- `id`, scope, `context_id`, integer `version`;
- schema version и `content_hash`;
- allowlisted environment IDs/revisions/scopes, только `LOCAL | NON_PROD | PREPROD`;
- allowlisted server-derived response-channel kinds; feature 002 accepts only verified `PLATFORM_WEB` principal/channel refs;
- requirement keys `qa-request-authority`/`defect-destination`, each mapped by the manifest to logical roles `QA_REQUEST_AUTHORITY`/`DEFECT_DESTINATION`, без Profile IDs;
- closed allowlisted catalogs of exact immutable target/scope/checklist policy refs plus explicit default refs for each slot policy class;
- `project_risk`: `LOW | MEDIUM | HIGH | CRITICAL`;
- `maximum_classification_key`;
- exact `dor_rule_set_ref`, `dod_rule_set_ref`, `evidence_policy_ref`, `risk_review_policy_ref`;
- `created_by`, `published_by`, `published_at`.

`UNIQUE(context_id, version)` и `UNIQUE(context_id, content_hash)`. Publication нового content создаёт version `n+1`; rollback также публикует новую version и не возвращает pointer на переосмысленную старую row.

### 4.3. `qa_risk_review_policies` и `qa_risk_review_policy_versions`

Policy header имеет scope, project, current published pointer и row version. Immutable version содержит:

- ordinary Verdict: primary human `QA_EXECUTOR`, одна signature;
- HIGH/CRITICAL Verdict: primary signature + distinct `QA_LEAD` co-sign;
- sole Registry DoR and allowed Plan Item/Session/Required Session/Finding waiver: exact platform action, distinct QA Lead, reason и expiry; `DOD|EVIDENCE` kinds absent;
- `ACCEPTED_RISK`: exact platform action и distinct QA Lead;
- final close: live-authorized QA Executor initiator + exact external-command Approval by a distinct QA Lead для любого risk level;
- exact permission keys и policy schema/content hash.

Effective review risk — `max(project_context.project_risk, current_request_input_revision.request_risk)`. Actor distinctness сравнивается по canonical identity ID, не по display name или role assignment ID.

### 4.4. `qa_request_extensions`

Одна QA extension на confirmed Core Work Item:

| Группа | Поля |
|---|---|
| Identity | `id`, scope, `work_item_id`, `intake_draft_id` |
| Definition pins | `work_type_definition_id`, `work_type_definition_version`, `project_context_version_id`, exact DoR/DoD/evidence/risk refs |
| Mutable pointers | exact `current_request_input_revision_id`, nullable `latest_readiness_assessment_id`, nullable exact `current_required_session_plan_version_id` (with content-hash projection), позднее nullable `latest_dod_assessment_id` and `completion_in_flight_candidate_id` |
| Audit/concurrency | `created_by`, `created_at`, `correlation_id`, `row_version` |

Constraints:

- `UNIQUE(workspace_id, project_id, work_item_id)`;
- Work Item обязан pin-ить `qa.validation` definition того же scope;
- definition/policy columns нельзя менять после insert; CAS разрешает только documented latest pointers;
- таблица не содержит external/mock/Jira status, raw status, priority, assignee, due date или release decision.

Строка и initial request-input revision создаются только QA confirmation hook-ом после confirmed external `request.create`, в той же PostgreSQL transaction, что и Core Work Item/Operational Binding. Pending/error command не создаёт их. На этом US1 checkpoint `current_required_session_plan_version_id` ещё `NULL`: initial RequiredSessionPlan публикуется отдельной human-controlled операцией US2 после актуальной readiness/context evaluation и затем CAS-устанавливает pointer на конкретную immutable version row, никогда на mutable header. До публикации plan никакая Session/DoD операция недоступна.

Migration 2030 adds the nullable in-flight completion pointer. Completion dispatch and every mutation serialize on the same extension row/advisory lock. Closed class `AGGREGATE_MUTATION` invokes the optional invalidator contribution; before US5 it is a no-op, and once US5 registers it a changed aggregate that wins first invalidates `CANDIDATE | AWAITING_APPROVAL | AUTHORIZED` before its own commit. Closed class `COMPLETION_SELF_TRANSITION` is limited to exact-candidate approval/lifecycle/reconciliation, revalidates the unchanged aggregate and all candidate pins, and never invokes the invalidator on itself. `AUTHORIZED→DISPATCHED` CAS-installs the pointer before outbox publication; dispatch-first blocks aggregate mutation, while only exact `DISPATCHED→CONFIRMED|FAILED` self-transition is allowed in flight. Terminal FAILED clears the pointer; confirmed DONE freezes adjudicative mutation permanently.

### 4.5. `qa_request_input_revisions`

Append-only content-addressed input history separates structural confirmation from DoR completeness:

- id, scope, extension/work item IDs, monotonically increasing revision, nullable same-header previous revision;
- accepted Draft/version ref for initial revision; publication reason `INITIAL_CONFIRMED_DRAFT | MISSING_INFO_SUPPLIED | REQUESTER_CORRECTION`;
- required structural human title, authoritative classification and persisted/domain request kind `FEATURE_VALIDATION | SMOKE | REGRESSION | RETEST | INVESTIGATION`, the latter bijectively mapped to public wire values `feature-validation | smoke | regression | retest | investigation`; revision 1 freezes them together with Workspace/Project/Work Item, definition, accepted Draft/external-request/Operational-Binding refs and original requester;
- optional-until-DoR goal, agreed scope, acceptance outcome, source/build refs, requested target defaults, business impact, request risk, desired date, role/test-data metadata refs and checklist refs;
- blockers/dependencies arrays plus explicit `blockers_declared`/`dependencies_declared`, so omitted differs from an intentionally empty list;
- conditional RETEST defect, typed previous-Session and immutable source-build refs;
- server-derived response-channel resolution union from the immutable original requester principal: `CONFIRMED` + verified allowed `PLATFORM_WEB` ref, or `MISSING` + stable reason code; the revision actor and client body cannot replace that identity;
- schema version, canonical content hash, verified HUMAN publisher/basis, reason, correlation and published timestamp.

Previous-Session lineage has kind `EXTERNAL_HISTORICAL | QA_SESSION`: US1 validates an immutable same-scope historical ref without FK to future Session storage. The evaluator exposes a resolver port in US2 but the native `QA_SESSION` contribution is installed only with US3 review/evidence persistence; it resolves an exact same-scope `COMPLETED` Session plus current signed SessionReview/manifest ref and is unavailable before then. Request-kind conditional fields may be absent in a structurally valid initial revision and then produce DoR blockers; when present they must already be typed, secret-free, same-scope and immutable.

`UNIQUE(extension_id, revision)` and `UNIQUE(extension_id, content_hash)` in scope. Initial revision is inserted atomically with extension and current pointer. While no READY command is `DISPATCHED`/in-flight and operational READY is not confirmed, a live-entitled HUMAN Requester or QA Executor may submit a closed DoR-semantic replacement with expected current pointer/row version and reason. Public input excludes the frozen structural tuple; the service copies it from revision 1 and an insert trigger compares every repeated identity value byte-for-byte against revision 1, so even repository/SQL bypass cannot change title, request kind, authoritative classification, authority scope or external/Core identity. `scope` in the semantic payload is specifically the agreed validation scope and may be completed/corrected pre-READY. Revision and command release use the same aggregate advisory/row lock: revision-first inserts `n+1`, CAS-moves `current_request_input_revision_id`, invalidates old latest assessment/waiver/pending READY intent and emits audit/event delta; dispatch-first rejects revision until terminal outcome. Revision update/delete, fork/gap, no-op content, structural-identity drift, response-channel resolution from the revision actor and client-supplied response identity are rejected. After confirmed READY or any Session, publish is rejected; semantic change requires a new linked QA request.

### 4.6. `qa_readiness_assessments`

Append-only deterministic assessment:

- id, scope, work item/extension ID, exact request-input revision ref/content hash и extension row version;
- `state`: `NEEDS_INFO | READY | READY_WITH_WAIVER`;
- input fingerprint и exact DoR rule/context, accepted-request, Project ACTIVE/verification, requester-entitlement/response-channel, request-lineage and binding/profile mapping-health input refs;
- structured blockers, warnings, acknowledgements и waived rule codes;
- nullable approved `waiver_id` только для `READY_WITH_WAIVER`;
- evaluated/confirmed human actor, live authorization basis/hash и timestamp;
- content classification, correlation/causation IDs.

`NEEDS_INFO` имеет минимум один blocker. `READY` не имеет blocker/waiver. `READY_WITH_WAIVER` имеет approved, unexpired exact waiver, который pin'ит scope/rule/input fingerprint; distinct-Lead authority и expiry повторно проверяются при readiness confirmation и перед внешним READY effect, а original blocker codes остаются в waiver subject, а не стираются.

Hard blockers include stale/non-current request-input revision, inactive Project, missing entitlement/confirmed response channel, missing goal/scope/outcome/applicable source-build/non-prod/test-data/risk/date/checklist facts, omitted blockers/dependencies declaration, incomplete RETEST lineage, classification/security violations and mapping validation errors. None is waivable. Project Registry `NEEDS_REVIEW` is the sole 002 DoR allowlist code and may become `READY_WITH_WAIVER` only through the exact distinct-Lead waiver; `CURRENT` needs no waiver. Connector reachability alone is not a DoR input.

`inputs.responseChannel` derives only from the exact pinned request-input revision: persisted `CONFIRMED` maps to readiness `CONFIRMED`, persisted `MISSING` maps to readiness `UNCONFIRMED` plus blocker `RESPONSE_CHANNEL_UNCONFIRMED`. Both branches preserve exact requester principal, resolution-policy ref and evaluation timestamp; the confirmed branch preserves the authoritative channel ref, the unconfirmed branch preserves the stable missing-reason code. Readiness не выполняет новый lookup от имени evaluation actor.

Assessment является QA canonical fact и не равен external status. Read model строит:

```text
NEEDS_INFO          latest assessment blocks
READY_PENDING_SYNC  QA READY, external transition not confirmed
READY               QA READY and Core normalizedStatus=READY from confirmed receipt
SYNC_ERROR          QA READY, terminal/retryable sync error
```

Только generic confirmation UoW после external read-back/webhook изменяет Core projection на `READY`; assessment при outage не переписывается.

### 4.7. `qa_waivers`

Exact QA waiver candidate/decision:

- id, scope, work item;
- `waiver_kind`: `DOR | PLAN_ITEM | SESSION | REQUIRED_SESSION | FINDING`;
- immutable exact subject `{kind,id,version/contentHash,aggregateSnapshotHash}`;
- reason, expires_at, candidate hash;
- initiator, generic `platform_action_id`/`approval_id` refs;
- state `PENDING | APPROVED | REJECTED | EXPIRED | INVALIDATED | CONSUMED`;
- decision actor/basis/timestamps и row version.

`DOD` и `EVIDENCE` отсутствуют в enum и CHECK constraint. Session/Plan Item/Finding waiver не может отключить evidence или pre-close DoD hard rule. `FINDING` waiver разрешает только human disposition `WAIVED` exact-предмета; выполненный отрицательный outcome всё равно требует attachment по разделу 6.5.

Waiver subject semantics are non-overlapping:

- `PLAN_ITEM` excuses one exact never-executed item and is consumed only by its zero-Attempt `NOT_RUN` result;
- `SESSION` excuses one exact zero-execution cancelled TestSession row from the created-session completion inventory, but does **not** reduce `minimum_session_count` or satisfy any part of its RequiredSessionPlan requirement; the full minimum still needs completed/reviewed Sessions pinned to the same key/carry-forward lineage or a separate `REQUIRED_SESSION` waiver;
- `REQUIRED_SESSION` changes one exact plan requirement resolution to `WAIVED` in a new immutable plan version and is the only waiver that removes the need for any Session covering that requirement.

For `waiver_kind=DOR`, a CHECK/domain guard accepts only subject rule code `PROJECT_REGISTRY_NEEDS_REVIEW`; all other DoR blocker codes reject candidate creation before generic Approval.

Для `APPROVED`/`CONSUMED`: approver — live-authorized QA Lead и `approver_id <> initiated_by_id`. Изменение exact subject, aggregate version, policy/profile ref, entitlement/role или expiry invalidates action до mutation.

### 4.8. `qa_required_session_plans`

Stable header, ровно один на QA Work Item:

- id, scope, work item/extension ID;
- `current_version_id`;
- `frozen_at` после externally confirmed `DONE`;
- created_at, updated_at, row_version.

`UNIQUE(workspace_id, project_id, work_item_id)`. После `frozen_at` новый current version запрещён.

US2 creates or idempotently ensures this stable header before the first publication. Its pre-publication representation has `current_version_id=NULL`, zero revisions and a positive `row_version`, exposed with a matching `ETag`; it is not a RequiredSessionPlan decision and leaves `qa_request_extensions.current_required_session_plan_version_id=NULL`. Initial HUMAN publish CAS-matches that empty header, inserts version 1/children and advances both pointers atomically. Every 201 returns the new header resource version/ETag for the next revision.

### 4.9. `qa_required_session_plan_versions`

Каждая plan version полностью immutable с момента insert:

- id, scope, plan/work item ID, monotonically increasing `version`;
- nullable `previous_version_id` того же plan;
- exact request-extension/context/DoR/DoD/evidence/risk-policy input refs;
- operational readiness proof: version 1 requires current confirmed READY command/result/projection refs; version `>=2` pins that historical proof plus the current non-DONE Core projection/external version used for revision authorization;
- reason (`INITIAL | READINESS_CHANGE | SCOPE_CHANGE | WAIVER_APPLIED | CORRECTION`);
- canonical ordered content, schema version и content hash;
- created/published human actor, authorization basis и timestamp.

Active plan — row, на которую указывает header. Старые versions остаются queryable. Изменение количества/типа required sessions, scope/checklist policy или waiver создаёт новую version; update existing version запрещён.

Initial publication and every revision are explicit authorized HUMAN commands. Initial publication additionally requires externally confirmed operational READY, which has already frozen request-input revision. The command supplies the empty/current header ETag, expected current revision pointer and publication reason; one transaction inserts the immutable version/children, CAS-moves the header and sets `qa_request_extensions.current_required_session_plan_version_id` to that same immutable row with its content-hash projection, and appends audit/event delta. Readiness evaluation/confirmation alone never creates or replaces a plan.

Later revision does not require Core to remain `READY`: it requires the immutable initial READY proof and revalidates the current operational projection/version against exactly `READY | PLANNED | IN_PROGRESS | REVIEW | BLOCKED` with an unfrozen header. This permits preterminal correction and waiver revisions without representing stale READY as current authority; terminal `CANCELLED|DONE` rejects publication.

### 4.10. `qa_required_session_plan_requirements`

Immutable children plan version:

- id, scope, plan version/work item;
- stable `requirement_key`, ordinal;
- immutable requirement content hash and nullable exact `carried_forward_from_requirement_ref` to the immediately previous plan version;
- mode=`MANUAL` в feature 002;
- purpose/request kind, minimum session count;
- required capabilities;
- target/scope/checklist policy refs;
- `resolution`: `REQUIRED | WAIVED`;
- `waiver_id` обязателен ровно для `WAIVED`.

Constraints:

- `UNIQUE(plan_version_id, requirement_key)` и `UNIQUE(plan_version_id, ordinal)` в scope;
- minimum count > 0;
- every published plan version retains at least one `resolution=REQUIRED` requirement; a waiver/revision that would leave all requirements `WAIVED` is rejected;
- every target/scope/checklist policy ref is an exact member of the catalog in the QA Project Context version pinned by the plan; required defaults are server-resolved and an unknown/client-invented ref is rejected;
- waiver обязан быть approved/unexpired, same-scope и иметь kind `REQUIRED_SESSION`;
- satisfaction не мутирует plan. `qa_dod_assessments` вычисляет её по exact plan version и completed Session reviews.

Revision carry-forward is explicit: an unchanged requirement in version `n+1` keeps the stable key and identical canonical content hash and points to the exact requirement in version `n`. A completed/reviewed Session pinned to an ancestor version covers the current requirement only when every link in that lineage preserves both key and hash. Any semantic/policy/minimum-count change breaks lineage and requires new current-version Session coverage. A `WAIVED` current requirement needs no Session, but at least one other current requirement remains `REQUIRED` and yields an actual completed/reviewed Session. This allows a late waiver without forcing unrelated reruns or reducing the walking skeleton to zero execution.

## 5. MANUAL planning/execution — migrations 2010/2015

### 5.1. `qa_test_sessions`

| Группа | Поля |
|---|---|
| Identity | id, scope, work item, unique ordinal |
| Planning lineage | planned-against plan version, required requirement key, nullable parent session |
| Type | mode=`MANUAL`, purpose, owner, required capabilities |
| Snapshots | target JSON/schema/hash, scope JSON/schema/hash |
| Lifecycle | state, state reason, created/ready/started/blocked/cancelled/completed actor+timestamps |
| Review projection | nullable latest session-review ID/outcome and adjudicative manifest revision ID |
| Control | monotonic structure revision/hash, nullable ready-against structure hash, classification, correlation ID, aggregate/row version |

`TargetSnapshot` содержит exact Project, build/commit/digest и optional MR ref, environment ID+revision, test-data/account-lease opaque refs, checklist refs, Project Integration Binding `{id,version}` и Profile refs, использованные при setup. Environment scope `PLATFORM_PROD/PRODUCTION` отклоняется.

`ScopeSnapshot` содержит purpose, agreed scope, acceptance outcome, inclusions/exclusions и immutable external checklist `{ref,version/commit,hash}` либо session-scoped definition snapshot hash. Mutable alias без resolved version/hash запрещён.

Constraints:

- `UNIQUE(workspace_id, project_id, work_item_id, ordinal)`;
- parent session того же Work Item/scope, не self; cycle отклоняется recursive domain check/DB trigger;
- required-plan version относится к тому же Work Item; requirement key обязателен, существует в этой version, а purpose/capabilities/target/scope/checklist policies выводятся из immutable requirement;
- linked replacement Session сохраняет тот же requirement key; minimum-session coverage accepts the current exact requirement or a cryptographically unchanged ancestor connected by the explicit carry-forward chain, never merely matching free-text purpose/key;
- transition `READY → RUNNING` атомарно фиксирует `started_at` и canonical target/scope hashes;
- any pre-start target/scope/owner/capability/PlanItem structural edit increments `structure_revision`, recomputes `structure_hash`, and if state is `READY` atomically records `READY→PLANNED` with actor/reason/old+new hashes and clears current `ready_against_structure_hash`; no edit may leave a stale READY state;
- `PLANNED→READY` stores `ready_against_structure_hash=current structure_hash`; `READY→RUNNING` rechecks byte equality under the same Session lock/CAS before snapshot freeze;
- после первого `started_at` DB trigger запрещает изменение snapshot JSON, schema version и hashes во всех состояниях, включая BLOCKED;
- post-start change создаёт новую linked Session;
- `session_outcome` существует только через signed `qa_session_reviews`; state и outcome никогда не сворачиваются в одно поле.

Lifecycle приведён в разделе 9.

### 5.2. `qa_plan_items`

Session-scoped ordered checklist item:

- id, scope, work item/session ID, ordinal, mode=`MANUAL`;
- title, expected outcome;
- immutable external definition ref/version/hash **или** session snapshot/schema/hash;
- execution state `PLANNED | RUNNING | TERMINAL | WAIVED`;
- nullable latest result revision ID;
- optional approved Plan Item waiver ref;
- created/updated actor, timestamps, row version, classification.

Constraints:

- `UNIQUE(test_session_id, ordinal)` in scope;
- definition external triple xor stored snapshot;
- Plan Items нельзя добавлять/удалять после Session enters `RUNNING`; correction requires linked Session;
- `WAIVED` требует approved, unexpired `PLAN_ITEM` waiver and result `NOT_RUN`;
- waiver не распространяется на уже выполненную отрицательную Attempt/evidence obligation.

Storage rollout сохраняет независимость историй: migration `2010` создаёт planning-only форму Plan Item и допускает только `PLANNED`; поля/pointer для latest result и полный execution-state CHECK появляются additively в `2015`, одновременно с `qa_plan_item_result_revisions` и scoped composite FK. Поэтому US2 не может создать `RUNNING | TERMINAL | WAIVED`, а US3 активирует эти transitions без изменения уже применённого DDL `2010`.

### 5.3. `qa_manual_attempts`

Каждое фактическое выполнение Plan Item создаёт новую Attempt:

- id, scope, work item/session/plan item IDs;
- `attempt_no`, state `RUNNING | COMPLETED`; insert starts the Attempt atomically, and cancelled execution is terminal result `CANCELLED`, not a competing lifecycle state;
- exact locked target snapshot hash;
- actor, started_at, completed_at, correlation/causation IDs;
- terminal technical result:
  `PASS | ASSERTION_FAILED | INFRA_FAILED | TIMEOUT | CANCELLED | INCOMPLETE`;
- nullable bounded `cancellation_reason`, required iff terminal result is `CANCELLED` and forbidden for every other result; it participates in the immutable content hash, manifest provenance and redacted audit/event payload;
- optional normalized infrastructure error code; никогда raw log;
- row version и content classification.

`UNIQUE(plan_item_id, attempt_no)` in scope. Attempt number monotonic. DB CHECK enforces the `CANCELLED ↔ cancellation_reason` iff and bounded nonblank reason. Terminal result никогда не обновляется; repeat создаёт Attempt `n+1`. `PASS` здесь — technical fact и не подписывает Plan Item result, Session outcome или QA Verdict.

### 5.4. `qa_plan_item_result_revisions`

Append-only human decision over immutable attempt lineage:

- id, scope, work item/session/plan item;
- monotonically increasing revision number и nullable previous revision;
- result `PASS | FAIL | BLOCKED | NOT_RUN | INCONCLUSIVE`;
- complete server-derived finalized-attempt refs/set hash / maximum attempt number, persisted through append-only `qa_plan_item_result_attempt_memberships`; request expected hash/watermark are CAS assertions only and never choose members;
- complete server-derived current-leaf Observation refs/set hash for those Attempts, persisted through append-only `qa_plan_item_result_observation_memberships` whose scoped composite FKs prove same Plan Item and exact member Attempt; request expected hash is likewise CAS-only;
- canonical exact `evidence_link_set_hash` (the empty-set hash is explicit for a result with no direct result evidence); durable members are added by migration `2020`;
- review flags, включая `FLAKY_SUSPECTED`;
- human decision actor/basis/time, reason и content hash;
- nullable `flaky_disposition_basis` only for `FLAKY_SUSPECTED+PASS`: Finding ID, exact current `DISPOSED` Finding-review revision/content ref, active membership-set hash, complete failed-Attempt-set hash, exact flaky-Observation-set hash and pinned policy ref. Migration `2025` also adds normalized append-only `qa_plan_item_result_flaky_observation_memberships` rows carrying each exact result-revision/failed-Attempt/Observation/Finding-membership tuple. This final shape is physically absent from the US3/`2015` table shape;
- nullable waiver ref только для allowed `NOT_RUN`;
- supersession reason.

Constraints: `NOT_RUN` имеет пустые Attempt/Observation sets, exact approved/unexpired `PLAN_ITEM` waiver ref и не допускается, если Attempt уже существует; `PASS | FAIL | BLOCKED | INCONCLUSIVE` имеют непустые exact Attempt **and Observation** sets и не принимают waiver ref. Under the Plan Item/Session lock, executed-result creation rejects any `RUNNING` Attempt and derives the Attempt membership as every finalized row with contiguous `attempt_no=1..MAX(attempt_no)`; persisted maximum/hash/rows must equal that set. It also derives the Observation membership as every unsuperseded leaf for those Attempts; persisted hash/rows must equal that complete set. Result commit atomically sets Plan Item `TERMINAL`, after which repeat and initial Observation insert are rejected; in their race execution-first changes the derived set before result creation, while result-first closes execution. A permitted pre-review Observation correction changes the current-leaf set hash and makes the previous result selector return `STALE_OBSERVATION_SET`. Every member Attempt with `ASSERTION_FAILED|INFRA_FAILED|TIMEOUT|INCOMPLETE` must have at least one member Observation that is same-PlanItem, references that exact Attempt and has kind `NEGATIVE|AMBIGUOUS`; a human `FAIL|BLOCKED|INCONCLUSIVE` additionally requires at least one such member. Every `PASS`, including flagged flaky PASS, requires at least one member `POSITIVE` Observation referencing a member `PASS` Attempt; zero-Observation or only-`INFORMATIONAL` PASS is invalid because it has no structured actual-outcome source. Deferred exact-set constraints commit result+memberships atomically. Repeat/result/Observation/review use the same serialization lock, and review recalculates both complete sets byte-for-byte. Новая result revision не удаляет старую. После signed Session review new Attempts, Observations and result revisions are forbidden; correction идёт через новый linked Session.

### 5.5. Fail-then-pass rule

Для одного Plan Item pattern

```text
Attempt n   = ASSERTION_FAILED
Attempt n+k = PASS
```

детерминированно выводит `FLAKY_SUSPECTED`. Reducer возвращает `HUMAN_DECISION_REQUIRED` и не имеет перехода к автоматическому clean `PASS`.

Human decision обязан:

1. pin-ить полный server-derived finalized Attempt history без caller-selected omission;
2. сохранить flag `FLAKY_SUSPECTED` в result revision и manifest;
3. дать reason;
4. в independently runnable US3 выбрать только `INCONCLUSIVE`; после additive migration `2025` flagged `PASS` обязан pin-ить полный exact subset всех server-derived finalized `ASSERTION_FAILED` Attempts, a non-empty exact Observation set covering every one of those Attempts, exact current `DISPOSED` Finding-review revision/content ref, active membership-set hash и policy basis. Each Observation is same-PlanItem, directly references its failed Attempt, has `NEGATIVE|AMBIGUOUS` kind and is active in that Finding membership set; отдельная `POSITIVE` Observation exact later `PASS` Attempt остаётся обязательным actual-outcome source.

Даже если после установки US4 человек выбрал `PASS`, история не является clean PASS: flag, failed Attempt, Observation, evidence и Finding basis остаются в signed revision. Версия deferred trigger/function `qa_assert_attempt_lineage_decision()` из migration `2015` знает только US3 tables, scans the complete server-derived finalized history and разрешает для этого pattern лишь `INCONCLUSIVE`. Migration `2025` additively replaces/extends the function: under locks it derives all `ASSERTION_FAILED` Attempts for this exact Plan Item/result, requires their equality with the basis failed-Attempt set, requires at least one pinned `NEGATIVE|AMBIGUOUS` Observation per failed Attempt, and joins every Observation through the active membership row into the exact current `DISPOSED` Finding review/membership set. Caller omission, execution-first race, cross-PlanItem, unrelated same-Session, missing, extra or stale membership substitution rejects the result; result-first race rejects the late execution command because the item is `TERMINAL`. Applied DDL `2015` не редактируется. Затем Session-review UoW под теми же row locks repeats complete Attempt/Observation equality and these checks, and creates/pins the exact `FROZEN` successor and signed manifest atomically. Finding or corrected-Observation-set change between result and review blocks review and requires a new result revision, so there is no result→freeze→result cycle.

Closed truth table: `FLAKY_SUSPECTED` may appear only with `INCONCLUSIVE` and no basis, or with `PASS` and the exact basis above. `FAIL | BLOCKED | NOT_RUN` with that flag are invalid; any row without the flag forbids `flaky_disposition_basis`.

### 5.6. `qa_observations`

Append-only execution fact:

- id, scope, work item/session/plan item и exactly one ManualAttempt ID;
- kind `POSITIVE | NEGATIVE | AMBIGUOUS | INFORMATIONAL`;
- expected/actual outcome, normalized severity, notes;
- actor/timestamp, content hash, classification;
- nullable exact `corrects_observation_id` plus bounded `correction_reason`, present together only on a correction;
- evidence связывается через `qa_evidence_artifact_links`.

Attempt, Plan Item и Session обязаны принадлежать одному scope/work item. Observation update/delete запрещены. Initial Observation forbids both correction fields; correction requires both, uses a composite self-FK to an exact predecessor in the same scope/work item/session/plan item/Attempt, and preserves an immutable predecessor content ref. A partial UNIQUE on non-null predecessor prevents forks; a deferred monotonic/acyclic trigger rejects self/cycles, and concurrent corrections yield one winner.

Adjudicative currentness is leaf-only: an Observation is current iff no same-chain successor exists. Result Observation memberships, Finding memberships, flaky bases and Session review accept only current leaves. Initial Observation insert is forbidden after the item becomes `TERMINAL`; an allowed pre-review correction changes the complete server-derived leaf-set hash, so the old result becomes `STALE_OBSERVATION_SET`. Creation/result/repeat/review serialize on the Session aggregate lock. Correction runs under that lock and in one UoW:

1. verifies the predecessor is the exact current leaf and Session is not reviewed;
2. inserts the successor;
3. leaves immutable result rows/history intact, but their current-selector/read projection reports `STALE_OBSERVATION_SET` and review rejects them until an explicit new result revision pins current leaves;
4. releases every active pre-freeze Finding membership of the predecessor, invalidates pending accepted-risk/waiver actions, sets the mutable Finding header state back to `DRAFT`, clears only `current_review_revision_id`, and preserves `latest_historical_review_revision_id` plus all review history;
5. emits exact affected result/Finding/membership refs and commits, or writes nothing.

The successor is never auto-added to a Finding and no historical CLASSIFIED/DISPOSED revision is mutated. `NEGATIVE→POSITIVE` and `POSITIVE→NEGATIVE` therefore both require a new result revision and, where the current leaf remains eligible, fresh human membership/classification/disposition. Correction versus result/membership/review serializes on the same Session lock; post-review corrections/observations are forbidden.

## 6. Findings, evidence and defect publication — migrations 2020/2025

### 6.1. `qa_findings`

Finding header:

- id, scope, work item, originating session;
- state `DRAFT | CLASSIFIED | DISPOSED | FROZEN`;
- nullable current review revision ID, latest historical and frozen finding-review revision IDs; Observation correction may clear only current and reset the pre-freeze header to DRAFT while preserving history;
- created_by/at, frozen_at, row version, classification.

Feature 002 группирует Observations только внутри одной Session и одного Work Item. Cross-session merge требует отдельной semantics и не допускается этим schema version.

### 6.2. `qa_finding_observations`

Scoped membership join, а не массив IDs в Finding:

- id, workspace/project/work item/session;
- finding ID и observation ID;
- assigned_by/at;
- nullable released_by/at/reason.

Constraints:

- composite FKs гарантируют одинаковые Workspace, Project, Work Item и Session;
- partial `UNIQUE(workspace_id, project_id, observation_id) WHERE released_at IS NULL` — Observation состоит максимум в одном active Finding;
- active Finding обязан иметь минимум одну active membership перед classification;
- release — однонаправленное изменение до freeze; повторное назначение создаёт новую join row;
- every ordinary assign/release runs under the Session/Finding locks. If the header is `CLASSIFIED|DISPOSED`, the same UoW invalidates pending disposition actions, clears `current_review_revision_id`, resets the header to `DRAFT` with actor/reason/old+new membership hashes, and preserves `latest_historical_review_revision_id`; membership mutation in DRAFT simply advances the set hash. No mutation may silently retain a decision over a different set;
- assignment accepts only an unsuperseded Observation leaf; correcting an assigned leaf atomically releases its row and stales the pre-freeze Finding decision under the Session lock;
- после `FROZEN` membership add/release запрещены.

Такой join закрывает и cross-project substitution, и race двух одновременных группировок.

### 6.3. `qa_finding_review_revisions`

Append-only human classification/disposition decision:

- id, scope, finding/work item/session;
- revision number, previous revision ID;
- stage `CLASSIFIED | DISPOSED | FROZEN`;
- classification `PRODUCT | INFRA | INCONCLUSIVE | DUPLICATE | ACCEPTED_RISK`;
- severity, summary, affected target hash;
- classification actor/reason/time;
- `disposition_decision`:
  `CREATE_DEFECT | DUPLICATE | NOT_A_BUG | ACCEPTED_RISK | DEFERRED | WAIVED`;
- disposition actor/reason/time;
- duplicate target ref where applicable;
- exact accepted-risk/waiver platform action ref where applicable;
- active membership-set hash, evidence-ref hash, policy ref и content hash.

Revision shape is closed and two-step. A `CLASSIFIED` revision requires classification fields and forbids every disposition/action/frozen field; no placeholder disposition is legal. A `DISPOSED` revision is a new exact successor of the current `CLASSIFIED` revision and requires disposition actor/reason/time plus one allowed decision/action-ref shape from the table below. A reclassification before freeze creates a new `CLASSIFIED` revision (from current `CLASSIFIED|DISPOSED`), clears disposition by shape rather than null fabrication and invalidates any pending Finding-disposition platform action; it must be disposed again. No wording proposal, defect candidate or defect Approval is legal at this stage. `FROZEN` is a review-UoW-created exact successor of current `DISPOSED`, retains the complete disposition/action provenance, adds `frozen_at` and cannot be superseded. Header state/latest pointer follows the committed revision stage.

Allowed combinations:

| Classification | Допустимое disposition decision |
|---|---|
| `PRODUCT` | `CREATE_DEFECT`, `DEFERRED`, `WAIVED` |
| `INFRA` | `NOT_A_BUG`, `DEFERRED`, `WAIVED` |
| `INCONCLUSIVE` | `DEFERRED`, `WAIVED` |
| `DUPLICATE` | только `DUPLICATE` + exact allowed existing-defect ref + explicit human reason |
| `ACCEPTED_RISK` | только `ACCEPTED_RISK` + distinct Lead exact approval |

`CREATE_DEFECT` — human disposition intent, а не утверждение, что external defect уже существует. Master-level `DEFECT_CREATED` является derived current projection только после появления `qa_defect_links`. Это разделение позволяет dispose Finding **до** manifest signing и не подделывать будущий external fact.

### 6.4. Review ordering и freeze

До signing Evidence Manifest для Session transaction обязана доказать:

1. every result's persisted Attempt/Observation memberships byte-equal the complete server-derived finalized contiguous Attempt/current-leaf Observation sets; every executed `ASSERTION_FAILED|INFRA_FAILED|TIMEOUT|INCOMPLETE` Attempt has at least one same-PlanItem exact-Attempt current-leaf `NEGATIVE|AMBIGUOUS` Observation; every current human `FAIL|BLOCKED|INCONCLUSIVE` result pins at least one such Observation, and every `PASS` pins a `POSITIVE` Observation of a `PASS` Attempt; zero/stale/wrong-Attempt/only-informational substitution blocks with `FINDING_REQUIRED`;
2. каждая eligible current-leaf NEGATIVE/AMBIGUOUS Observation имеет active Finding membership;
3. transaction locks and inventories **every active Finding in the Session**, regardless of Observation kind, and each has a non-empty active membership set plus current human `DISPOSED` revision whose `active_membership_set_hash` and ordered membership IDs equal the exact locked current set; no `DRAFT|CLASSIFIED`, cleared-current or stale-hash Finding may survive review;
4. every applicable accepted-risk/waiver action in that full inventory is exact-approved and live-valid;
5. every flagged `PASS` result's `flaky_disposition_basis` still equals the current failed-Attempt/Observation/current-`DISPOSED` review/membership/policy hashes;
6. в той же transaction создать/пинить exact `FROZEN` successor for every inventoried current `DISPOSED` revision/membership set, including every basis from step 5;
7. manifest включает all exact active join IDs and resulting frozen finding-review revision IDs.

После commit Finding остаётся `FROZEN`. Поздний draft, external publication или `DefectLink` не переписывает frozen Finding и не мутирует signed manifest.
The UoW emits one `qa.test-session.reviewed` event containing the complete ordered `frozenFindingReviewRefs` set (explicitly empty for a clean Session); it does not emit partial per-Finding FROZEN events that could escape before the aggregate transaction completes.

### 6.5. Unconditional negative evidence

Attachment обязателен без waiver:

- для каждого Plan Item result `FAIL | BLOCKED | INCONCLUSIVE`;
- для каждого executed Attempt result `ASSERTION_FAILED | INFRA_FAILED | TIMEOUT | INCOMPLETE`, даже если поздняя Attempt прошла и human result стал `PASS`.

На момент Session review существует минимум один finalized, accessible, same-scope artifact link с допустимой classification/checksum для каждой такой exact result/Attempt lineage. In addition, the exact negative Observation coverage in §6.4 is mandatory so evidence-bearing negative Attempts/results cannot bypass Finding by omitting or mispointing the Observation; the Observation does not invent a second attachment obligation. `CANCELLED` требует reason; `NOT_RUN` является zero-Attempt disposition и требует exact approved/unexpired `PLAN_ITEM` waiver, но ни один из них не маскирует уже выполненную negative Attempt.

Ни `qa_waivers`, ни DoD rule, ни exact Approval не имеют `EVIDENCE` subject. Evidence failure — hard blocker. Expiry после signing не отменяет историческую полноту; availability-at-signing и checksum остаются в manifest.

### 6.6. `qa_defect_drafts`

Immutable defect candidate + mutable delivery state:

- id, scope, work item, finding, frozen finding-review revision и originating Session;
- candidate number, nullable supersedes draft ID;
- deterministic template/schema version;
- full canonical typed payload и payload hash;
- optional schema-validated model proposal provenance, никогда authority;
- human accepted/rejected actor, reason and time;
- generic approval/connector-command refs, exact binding/profile refs/effect key hash;
- state:
  `DRAFT | READY_FOR_APPROVAL | AWAITING_APPROVAL | AUTHORIZED | DISPATCHED | LINKED | REJECTED | INVALIDATED | FAILED`;
- terminal projection discriminator `terminal_from_state` plus reason/code. Closed source sets: human `REJECTED` records separate `rejected_from_state=DRAFT|READY_FOR_APPROVAL`; `INVALIDATED` is legal from `DRAFT|READY_FOR_APPROVAL` for explicit candidate replacement and from `AWAITING_APPROVAL|AUTHORIZED` for policy/config drift; technical `FAILED` is legal from `DRAFT|READY_FOR_APPROVAL|AWAITING_APPROVAL|AUTHORIZED|DISPATCHED`; confirmed `LINKED` is legal only from `DISPATCHED`;
- every terminal row preserves exactly the predecessor-owned projection: DRAFT has no acceptance/config/approval/command/effect; READY_FOR_APPROVAL has acceptance only; AWAITING_APPROVAL/AUTHORIZED have acceptance+Binding/Profile/Approval but no command/effect; DISPATCHED additionally has command/effect key. `REJECTED` carries human actor/reason/time and no failure/invalidation fields; `INVALIDATED` carries invalidation reason only; `FAILED` carries failure code+bounded terminal reason only;
- row version, timestamps, classification.

Only frozen `PRODUCT + CREATE_DEFECT` Finding can yield an active candidate. Candidate payload never changes; wording change atomically transitions the old pre-dispatch candidate to fully provenanced `INVALIDATED` and creates candidate `n+1`. Exact `supersedes_draft_id` is allowed only when the immediately prior **current head** is `FAILED|INVALIDATED`; no branch skips a head. `REJECTED` and `LINKED` are final heads and forbid successors. A confirmed `DefectLink` independently forbids any new candidate for that Finding. Partial unique index allows at most one active nonterminal candidate per Finding, while deferred head/successor/link checks prevent a terminal-history rewrite. Before freeze, reclassification may invalidate only pending Finding-waiver/accepted-risk actions because defect candidates/Approvals do not yet exist; after freeze reclassification is forbidden.

Draft publication requires exact generic `EXTERNAL_COMMAND` Approval. Non-PRODUCT, rejected/invalidated/stale candidate causes zero Connector calls. Model cannot accept, approve or publish.

### 6.7. `qa_defect_links`

Late, append-only canonical record written only after confirmed external `defect.create`:

- id, scope, work item, Finding, frozen review revision, draft and originating Session;
- confirmed external entity kind/id/key/version and normalized external reference;
- generic command/result receipt ID, effect key hash;
- exact binding/profile refs actually used;
- human draft confirmer and authorization basis snapshot;
- linked_at, correlation/causation IDs, classification.

Constraints:

- `UNIQUE(workspace_id, project_id, finding_id)`;
- `UNIQUE(workspace_id, project_id, defect_draft_id)`;
- external natural key/effect key unique within exact destination scope;
- no link exists before command state `CONFIRMED`;
- replay/reconciliation returns existing link;
- confirmed link never удаляется, даже если later business disposition changes in a future feature.
- `LINKED` draft is the chain-terminal current head; `UNIQUE(finding_id)` link plus successor trigger rejects any later draft. Human `REJECTED` is likewise final and has no link/successor.

`DefectLink` не входит задним числом в completed Session manifest. Work Item DoD читает current late record отдельно и pin-ит его ID в собственном assessment/completion snapshot.

### 6.8. `qa_evidence_artifact_links`

Append-only scoped association to Core artifact reference:

- id, scope, work item/session;
- `artifact_reference_id` (scoped Core FK);
- external attachment owner kind `SESSION | PLAN_ITEM | MANUAL_ATTEMPT | OBSERVATION | FINDING` и ровно один corresponding explicit nullable FK;
- role `EXECUTION_EVIDENCE | CONTEXT`;
- pinned checksum, size, media type, classification, retention/availability-at-signing metadata;
- attached/finalized actor and timestamps.

CHECK требует ровно один owner FK and matches the public `SESSION|PLAN_ITEM|ATTEMPT|OBSERVATION|FINDING` union (`MANUAL_ATTEMPT` is the persisted enum name for wire `ATTEMPT`). Migration 2020 installs the first four owner branches; migration 2025 additively installs same-scope `FINDING` FK/CHECK support when that table appears. Core current availability читается отдельно; locator никогда не сохраняется и не возвращается QA API.

`qa_evidence_manifest_artifact_memberships` is a separate append-only signed-membership join: id/scope/work item/session, exact manifest revision, required source `qa_evidence_artifact_link`, ordinal/role=`MANIFEST_MEMBER`, and the pinned checksum/size/media/classification/availability-at-signing snapshot. It never masquerades as a client attachment owner and never updates the source link. Composite same-scope FKs and `UNIQUE(manifest_revision_id, source_artifact_link_id)` prevent cross-manifest duplication.

`qa_plan_item_result_evidence_memberships` is the separate append-only exact-set join created in migration `2020`: id/scope/work item/session/plan item, exact `qa_plan_item_result_revision`, exact finalized source `qa_evidence_artifact_link`, canonical ordinal and pinned link content hash. Composite FKs require the same result lineage and `UNIQUE(result_revision_id, source_artifact_link_id)`; a deferred trigger recomputes the ordered set hash and matches `evidence_link_set_hash`. Every `FAIL|BLOCKED|INCONCLUSIVE` result revision has at least one own membership. Plan-item-level proximity or an artifact listed by another result never satisfies it implicitly; deliberate reuse of the same immutable source still requires a new explicit membership in the new result revision and is part of that revision's hash. Result row and memberships commit in one UoW, so substitution/concurrent finalize cannot change the signed basis.

### 6.9. `qa_evidence_manifests`

Один stable header на Session:

- id, scope, work item/session;
- `latest_revision_id`;
- `latest_adjudicative_revision_id`;
- `revision_count`, created_at, updated_at, row_version.

`UNIQUE(workspace_id, project_id, test_session_id)`. Latest revision может быть clerical; adjudicative pointer используется Session review, Verdict и DoD.

This header `row_version` is the correction CAS token exposed as `resourceVersion` plus a matching HTTP `ETag` by manifest get/history and the initial creation response. Pre- and post-close correction commands require `If-Match` against this manifest header; a Session ETag is not a substitute. Pointer advancement and version increment occur atomically with the new immutable revision (and post-close marker where applicable).

### 6.10. `qa_evidence_manifest_revisions`

Каждая row signed и insert-only:

- id, scope, manifest/work item/session;
- revision number, previous revision ID;
- kind `INITIAL | SUBSTANTIVE_CORRECTION | CLERICAL_CORRECTION`;
- evaluation status `EVALUATED | POST_CLOSE_NOT_EVALUATED`;
- `is_adjudicative`;
- canonical manifest payload/schema/content hash;
- correction reason;
- for `CLERICAL_CORRECTION` only, a bounded ordered signed `clerical_annotations` change set distinct from the audit reason; each item is either a correction note or an allowlisted display-field edit and is part of canonical bytes/content hash;
- nullable exact adjudicative revision ref and `post_close_correction_marker_id`, present together only for a post-DONE clerical revision after migration `2030`;
- signer identity/role/live basis/hash, evidence-policy ref и signed_at;
- created_at, classification.

Payload обязательно содержит:

- Project, Work Item, Session, Plan Item, Attempt и Observation IDs;
- locked target snapshot and scope hash;
- external definition versions/hashes или session snapshot hashes;
- expected/actual outcomes, Plan Item results и all Attempt lineage/flags;
- bounded ManualAttempt cancellation reason iff the exact Attempt result is `CANCELLED`;
- Session outcome/review identity;
- exact frozen Finding review/membership/disposition snapshots;
- artifact IDs, checksums, availability-at-signing и provenance;
- work type/Pack/rule/context/policy versions;
- union exact binding/profile refs фактически использованных confirmed commands;
- actor/timestamps/correlation data.

Revision chain обязана быть linear within one manifest: revision `n` points to `n-1`; cross-session previous ID запрещён. `UPDATE/DELETE` signed row отклоняется DB trigger/grants.

### 6.11. `qa_session_reviews`

Append-only human attestation tying Session Outcome to exact evidence:

- id, scope, work item/session;
- review number, nullable superseded review ID;
- outcome `PASSED | FAILED | BLOCKED | INCONCLUSIVE` и summary;
- exact adjudicative manifest revision ID/content hash;
- execution-set, result-set и frozen-finding-set hashes;
- human signer/basis/policy/time and review content hash.

Initial review transaction creates `INITIAL` manifest revision + Session review, sets Session `COMPLETED`, and updates header pointers atomically. A pre-DONE substantive correction requires a new adjudicative manifest revision **и** a new Session review. It never overwrites the previous review or signed Verdict: exact-ref/hash freshness makes that Verdict and any earlier `READY_TO_CLOSE` assessment historical/non-current. When migration `2030` is installed, the same UoW appends a current `BLOCKED` DoD assessment with stable `AGGREGATE_CHANGED` blocker and invalidates any pre-dispatch completion candidate; the US3-only boundary uses the registered no-op contribution and has no dependency on future tables.

### 6.12. Post-DONE clerical correction

После confirmed external `DONE` разрешена только `CLERICAL_CORRECTION`:

- `evaluation_status=POST_CLOSE_NOT_EVALUATED`;
- `is_adjudicative=false`;
- header `latest_revision_id` moves forward, `latest_adjudicative_revision_id` remains unchanged;
- новая Session review, Verdict или DoD assessment не создаются;
- existing Verdict/DoD continue to pin original adjudicative revision.

Allowed clerical changes: non-normative caption/display label, human correction note, display text of an already pinned immutable reference. Forbidden changes: any ID, scope, actor identity, execution timestamp, target/scope hash, definition/rule/policy ref, Attempt/result/outcome, Finding/classification/disposition, artifact identity/checksum/size/media type/classification, or semantic conclusion.

`CORRECTION_NOTE` is persisted as an item in the signed `clerical_annotations` set, not merely as the marker/service audit reason. A note-only revision is valid and changes canonical bytes/hash. Initial/substantive revisions forbid this post-close annotation set; tampering with an annotation invalidates the signature.

Forbidden semantic change after DONE requires a new linked QA request/Session. It cannot retroactively change Verdict, DoD, Core `DONE` projection or product/release meaning.

### 6.13. `qa_post_close_correction_markers` — migration 2030

Append-only marker makes the separate contract reference durable and reloadable:

- id, scope, closed Work Item, Session and Evidence Manifest IDs;
- exact new non-adjudicative manifest revision ID/content hash and unchanged adjudicative manifest revision ID/content hash;
- exact final-close-confirmation ID proving confirmed external `DONE`;
- marker=`POST_CLOSE_NOT_EVALUATED`, reason, verified HUMAN requester plus server-derived role/permission policy key and immutable authorization-basis hash, and recorded timestamp;
- resolution=`NEW_LINKED_QA_REQUEST_REQUIRED`; optional linked Draft/Work Item IDs may be present only if they already exist when the immutable marker is inserted, otherwise they remain absent.

`UNIQUE(workspace_id, project_id, manifest_revision_id)` and composite same-scope FKs prevent cross-aggregate markers. One transaction preallocates both IDs, inserts the marker and clerical revision under deferred same-scope FKs, CAS-advances `qa_evidence_manifests.latest_revision_id`, and leaves `latest_adjudicative_revision_id` byte-for-byte unchanged. Both rows reject UPDATE/DELETE. The marker history is returned with latest/adjudicative Evidence views; it never becomes a Session review, Verdict or DoD input.

The authorization basis is resolved from the authenticated HUMAN principal and live policy by the server, is not accepted in the mutation body, survives reload in the marker read projection, and is repeated in the redacted `qa.post-close-correction.recorded` event.

## 7. Verdict, DoD и completion — migration 2030

### 7.1. `qa_verdicts`

Immutable Verdict content revision:

- id, scope, work item and verdict revision number;
- verdict `PASS | FAIL | BLOCKED | INCONCLUSIVE`;
- residual risk statement/classification;
- effective review risk;
- exact RequiredSessionPlan version;
- exact completed Session review IDs and adjudicative manifest revision IDs;
- exact Finding review, defect-draft terminal state and DefectLink refs;
- DoD/risk policy refs and aggregate snapshot hash;
- content hash, nullable supersedes Verdict ID;
- signature projection state `DRAFT | PARTIALLY_SIGNED | SIGNED | SUPERSEDED`; ordinary risk may move directly `DRAFT→SIGNED`, while elevated risk records the primary signature as `PARTIALLY_SIGNED` until the distinct Lead co-sign;
- created_by/at, signed_at, row version.

Verdict `FAIL` совместим с Work Item `normalizedStatus=DONE`. Verdict означает результат QA-работы, не product acceptance и не release decision.

Supersession создаёт новую row только пока confirmed operational projection не `DONE`. Explicit supersession marks an exact still-current `SIGNED` predecessor `SUPERSEDED` in the same UoW. Upstream plan/session/adjudicative-evidence/Finding/draft/link/policy drift does not rewrite or relabel a signed Verdict; current selection rejects its old exact refs/aggregate hash, and the later explicit revision flow may supersede it with a freshly signed version. Every such input change appends a current `BLOCKED(AGGREGATE_CHANGED)` DoD assessment once migration `2030` exists and invalidates a pre-dispatch completion snapshot. Signed historical Verdict and earlier DoD assessments remain queryable.

### 7.2. `qa_verdict_signatures`

Append-only signatures:

- id, scope, work item/verdict;
- role `PRIMARY | LEAD_COSIGN`;
- exact Verdict content hash;
- human signer ID, role/permission and live authorization basis/hash;
- optional generic platform action/Approval ref for co-sign;
- signed_at, correlation/causation IDs.

Ordinary risk requires one `PRIMARY` QA Executor. HIGH/CRITICAL requires primary plus `LEAD_COSIGN`, where Lead identity differs from primary/initiator. Unique constraints prevent duplicate role/signer. Verdict becomes `SIGNED` only after the pinned risk policy is satisfied.

### 7.3. `qa_dod_assessments`

Append-only deterministic snapshot:

- id, scope, work item/extension;
- state `BLOCKED | READY_TO_CLOSE | SATISFIED`;
- server-derived aggregate inventory: optional current RequiredSessionPlan/Verdict/signature/Session-review/adjudicative-manifest/Finding-review/draft-link/waiver refs while state is `BLOCKED`, with the corresponding missing facts represented by stable blocker codes; all of those exact ref sets are complete and non-empty where applicable for `READY_TO_CLOSE | SATISFIED`;
- immutable ordered blocker/warning codes;
- DoD/risk/evidence policy refs;
- aggregate input hash;
- evaluator/correlation/timestamp;
- for `SATISFIED`, confirmed completion candidate/command/result/external version refs.

`READY_TO_CLOSE` означает QA-domain readiness to request external close, но не меняет Core status. `SATISFIED` создаётся только QA confirmation hook-ом в одной transaction с confirmed external `DONE` projection. Post-DONE clerical manifest correction не создаёт новый DoD и не меняет pinned assessment.

The public evaluator request contains optimistic aggregate/CAS context and optional exact hints only. It does not require caller-supplied Verdict or RequiredSessionPlan refs and never treats them as authority; the application resolves and revalidates current aggregate membership before persisting the assessment.

Minimum pre-close hard blockers for `READY_TO_CLOSE`, не подлежащие waiver:

- отсутствует required completed Session review;
- отрицательное execution evidence неполно;
- Session manifest/signature отсутствует или invalid;
- Finding не classified/disposed/frozen;
- required draft publication/rejection unresolved;
- Verdict/residual risk не fully signed.

“Required draft unresolved” is current-chain semantics, not a universal terminal-state ban. For each frozen `CREATE_DEFECT` Finding, the exact successor chain may retain any fully provenanced `FAILED|INVALIDATED` history, but its current head must be `LINKED` or explicit human `REJECTED`; a historical terminal row with no exact current terminal successor remains blocking. Non-create dispositions forbid draft/link rows and are already resolved by their frozen disposition.

`SATISFIED` дополнительно требует current `READY_TO_CLOSE`, exact unchanged completion candidate/aggregate snapshot, live distinct-Lead Approval, matching summary digest/comment receipt and confirmed terminal external state/version. До candidate/Approval/command эти факты не являются pre-close blockers; drift в scope/config/external expected state invalidates authorization/confirmation and leaves DoD at `READY_TO_CLOSE` or creates a new `BLOCKED` assessment over the changed inputs.

Открытый linked product defect не blocker. `DONE + FAIL` является штатным результатом.

### 7.4. `qa_completion_candidates`

Immutable close intent content + CAS-controlled delivery projection:

- id, scope, work item, candidate number;
- source `READY_TO_CLOSE` DoD assessment и signed Verdict;
- immutable closed completion summary: scope, Verdict value/ref, residual risk, evidence-manifest refs and defect-link/disposition refs, plus canonical summary hash;
- expected Core/external normalized/raw state and external version;
- exact binding/profile refs and chain fingerprint;
- typed `request.transition(DONE)` payload containing that full structured summary, schema and hash;
- initiated_by, generic Approval/command IDs and effect key hash;
- approved_by snapshot;
- state `CANDIDATE | AWAITING_APPROVAL | AUTHORIZED | DISPATCHED | CONFIRMED | REJECTED | INVALIDATED | FAILED`;
- confirmed receipt/final-close-confirmation pointer, timestamps, row version. Candidate content and `content_hash` never change; only lifecycle/ref projection columns move through guarded CAS transitions.

`INVALIDATED` records `terminalFromState=CANDIDATE|AWAITING_APPROVAL|AUTHORIZED` and preserves every field reached in that predecessor, including the exact close Approval/approved actor/time for `AUTHORIZED`; invalidation after `DISPATCHED` is forbidden because an external effect must reconcile to `CONFIRMED|FAILED`. `FAILED` is reachable only from `DISPATCHED`: it preserves the exact Approval snapshot, approved timestamp, command ref and effect-key hash and adds a terminal reason while forbidding confirmation refs. `CONFIRMED` preserves the same dispatch provenance, requires the final confirmation refs and forbids a terminal reason.

The `AUTHORIZED→DISPATCHED` CAS is the point that installs `qa_request_extensions.completion_in_flight_candidate_id` under the shared aggregate lock after a final unchanged-snapshot recheck. No plan/session/execution/review/Finding/evidence/Verdict/waiver mutation may commit until a terminal FAILED outcome releases it or confirmed DONE freezes the aggregate.

Completion commands have a closed guard classification rather than the aggregate invalidator's universal application:

- `AGGREGATE_MUTATION`: any command that can change the candidate input snapshot, including non-idempotent candidate creation; invalidates an existing pre-dispatch candidate before committing;
- `COMPLETION_SELF_TRANSITION`: exact candidate approval request/decision, authorized dispatch and dispatched reconciliation/terminal projection; skips self-invalidation but must CAS the legal predecessor and revalidate candidate ID/version/content hash, aggregate hash, DoD/Verdict refs, external version, Binding/Profile, Approval and effect key;
- `POST_CLOSE_CLERICAL_CORRECTION`: the sole bounded post-DONE exception described in §6.12;
- `READ_ONLY`: no mutation/effect.

An idempotent candidate-create retry returns the same candidate before invalidation logic. A different candidate creation is an aggregate mutation and must explicitly terminalize the prior pre-dispatch candidate. While the pointer is in flight, no class except that exact candidate's terminal self-transition can mutate state.

Final close всегда инициируется live-authorized QA Executor и требует exact Approval live-authorized QA Lead-ом, отличным от initiator. Обычный risk level не снимает это правило; QA Lead не вправе инициировать completion candidate и не может self-approve.

Approval subject pin-ит candidate ID/version/content hash, full typed payload hash, target, expected external state/version, exact binding/profile refs, aggregate snapshot, initiator, expiry, scope и idempotency key. Any drift invalidates before Connector invocation.

### 7.5. `qa_final_close_confirmations` and confirmed external DONE

`qa_final_close_confirmations` is an append-only same-scope record over exact completion-candidate/version/hash, RequiredSessionPlan, Verdict, READY_TO_CLOSE DoD assessment, distinct-Lead Approval, command, confirmed completion-summary digest/receipt, raw external state/version and normalized `DONE`, plus confirmed timestamp. It is created only after external confirmation of both the summary/comment and terminal state and is never used as a requested-state authority.

Requested/authorized/dispatched transition не считается completion. После Connector read-back/webhook generic confirmation UoW в одной transaction:

1. сохраняет Core command terminal result=`CONFIRMED`;
2. обновляет Core Operational Binding raw state/external version/sync metadata;
3. обновляет Core Work Item derived `normalizedStatus=DONE`;
4. вызывает QA hook, который вставляет one append-only `qa_final_close_confirmations`, переводит только delivery projection `qa_completion_candidates` в `CONFIRMED`, вставляет final `qa_dod_assessments(SATISFIED)` pinned to that confirmation и CAS-устанавливает `qa_required_session_plans.frozen_at`;
5. через generic ports добавляет audit/event outbox records;
6. commit-ит всё или откатывает всё.

QA hook не пишет Core `work_items` и не устанавливает `CLOSED`. External raw status может называться иначе; Connector mapping подтверждает именно нормализацию в `DONE`.

## 8. Generic operational confirmation UoW

### 8.1. Generic external-command lifecycle contribution

Feature 001 owns command/Approval/outbox/worker state, but its create-specific release path is generalized additively in Phase 1. A statically composed, QA-agnostic registry selects by registered Work Type/capability metadata and supports the closed phases:

```typescript
type ExternalCommandLifecyclePhase =
  | "APPROVAL_REJECTED"
  | "APPROVAL_RELEASED"
  | "EFFECT_INVOCATION_STARTED"
  | "TERMINAL_FAILED";

interface ExternalCommandLifecycleContribution {
  readonly key: string;
  matches(input: ScopedExternalCommandContext): boolean;
  apply(
    phase: ExternalCommandLifecyclePhase,
    input: ScopedExternalCommandContext,
    tx: PackOwnedTransaction,
  ): Promise<PackLifecycleDelta>;
}
```

The generic Core/persistence transaction is the sole owner of ordering:

1. Approval decision locks Approval, command, outbox and the contribution-selected Pack aggregate in one deterministic order.
2. Rejection calls `APPROVAL_REJECTED` and records Pack `REJECTED`/released guard before the same commit.
3. Approval release calls `APPROVAL_RELEASED` **before** Core `HELD→READY` and outbox `HELD→READY`; a Pack contribution may veto on stale pins and atomically install its in-flight/dispatch guard. No READY outbox row becomes dispatchable first.
4. Worker live revalidation/execution-lease transaction calls `EFFECT_INVOCATION_STARTED` immediately before the first Connector invocation; exact same-effect recovery is idempotent.
5. Any terminal pre-effect denial or post-attempt command failure calls `TERMINAL_FAILED` in the same Core failure transaction so READY input locks, DefectDraft state or completion pointer cannot strand.
6. Confirmed effects use the separate operational confirmation hook below.

Each `(commandId, phase)` application is idempotent and returns typed audit/event deltas to the generic owner. Contributions receive scoped Pack repositories plus read-only Core refs, never Core mutation repositories. Hook failure rolls back Approval/command/outbox and Pack projection together. The registry and UoW contain no QA enum/switch.

This closes three races with the same primitive: READY release vs input revision; DefectDraft authorization/dispatch/failure; and completion `AWAITING_APPROVAL→AUTHORIZED→DISPATCHED` plus in-flight pointer before outbox publication. A worker can never observe dispatchable `READY` before the Pack guard exists.

### 8.2. Confirmation contract

Core предоставляет статически composed generic extension point, концептуально:

```typescript
interface OperationalConfirmationHook {
  readonly key: string;
  matches(input: ConfirmedOperationalEffect): boolean;
  apply(
    input: ConfirmedOperationalEffect & CoreMutationRefs,
    tx: PackOwnedTransaction,
  ): Promise<PackConfirmationDelta>;
}
```

`PackOwnedTransaction` предоставляет QA repositories и scoped reads уже подтверждённых Core refs, но не Core mutation repositories. `PackConfirmationDelta` возвращает typed domain events/audit facts generic UoW-у; сам hook не вставляет `event_outbox`/`audit_events` напрямую.

Generic UoW:

- выбирает contributions по registered Work Type/capability metadata, не по `if qa` branch;
- держит один PostgreSQL `QueryRunner` transaction;
- live-validates command, scope, exact binding/profile chain, expected state и receipt;
- выполняет Core-owned mutation;
- вызывает hooks deterministic order;
- writes generic audit/outbox;
- commit/rollback как единое целое;
- идемпотентен по command ID/effect key; replay returns existing aggregate refs.

Hook failure откатывает и Core, и QA local confirmation. External effect уже может существовать; reconciliation повторяет **тот же** effect/command identity и не создаёт duplicate external entity.

### 8.3. Четыре confirmation cases

| Effect | Core-owned part | QA hook-owned part |
|---|---|---|
| `request.create` | command result, Draft `LINKED`, Work Item, Operational Binding | `QaRequestExtension` с nullable plan/readiness pointers |
| `request.transition(READY)` | command result, binding version/raw state, Work Item projection `READY` | optional QA sync reference/pointer only; assessment unchanged |
| `defect.create` | command result/receipt | draft `LINKED`, one late `DefectLink` |
| `request.transition(DONE)` | command result, confirmed completion-summary digest/receipt, binding version/raw state, Work Item projection `DONE` | completion candidate `CONFIRMED`, final DoD `SATISFIED`, plan freeze |

Запрещены отдельные `qa-confirmation.uow` implementations, которые напрямую мутируют Core tables. QA-specific files реализуют hook/Pack repository logic; transaction owner всегда generic Core confirmation UoW.

## 9. Lifecycle и state transitions

### 9.1. Readiness и RequiredSessionPlan

```text
assessment:  NEEDS_INFO | READY | READY_WITH_WAIVER   (append-only decisions)
plan:        version 1 → version 2 → ...              (immutable versions)
header:      current version pointer → frozen at DONE
```

Assessment не меняет state in place. New inputs → new assessment. Approved waiver → new assessment/plan version. External READY confirmation меняет Core projection, не assessment.

### 9.2. TestSession

```text
PLANNED → READY → RUNNING → REVIEW_REQUIRED → COMPLETED
   │         │        │            │
   └─────────┴────────┴────────────→ BLOCKED
READY ── STRUCTURE_CHANGED ──→ PLANNED
BLOCKED → READY | RUNNING | REVIEW_REQUIRED | CANCELLED
Any non-terminal → CANCELLED
```

Guards:

- `PLANNED→READY`: plan/snapshots/owner/capabilities complete;
- pre-start structural edit: increments/recomputes exact structure revision/hash; from READY it must atomically return to PLANNED with provenance, never remain READY;
- `READY→RUNNING`: live non-prod start guards pass, `readyAgainstStructureHash == currentStructureHash` is rechecked under lock, snapshots lock atomically;
- `RUNNING→REVIEW_REQUIRED`: execution set closed, Plan Items terminal/waived;
- `REVIEW_REQUIRED→COMPLETED`: negative evidence complete, Findings frozen/disposed, signed manifest + human Session review in one transaction;
- `BLOCKED/CANCELLED`: reason and human actor required;
- a zero-execution cancelled Session may be excluded only by exact `SESSION` waiver, while its plan requirement still needs another completed Session or a distinct-Lead `REQUIRED_SESSION` waiver/new plan version.

`BLOCKED` and `CANCELLED` record the exact predecessor stage and preserve every monotonic milestone already reached; future-stage timestamps/refs are forbidden. Resume cannot jump guards: a block from `PLANNED` may reach `READY` only by rerunning the complete `PLANNED→READY` guard, a block from `READY` resumes only `READY`, from `RUNNING` only `RUNNING` after revalidating the locked snapshot/execution context, and from `REVIEW_REQUIRED` only `REVIEW_REQUIRED` after revalidating the closed execution set. The normal next transition then runs its own guard. A mismatched resume target is rejected.

`CANCELLED` additionally requires empty Attempt/Observation/result sets; cancellation is rejected once any execution fact exists, and that Session must use `BLOCKED`+resume. A `SESSION` waiver can therefore reference only a zero-execution cancelled Session. It never suppresses an evidence obligation, reduces the slot minimum or satisfies the RequiredSessionPlan requirement by itself.

### 9.3. ManualAttempt и result

```text
RUNNING → COMPLETED(result=PASS|ASSERTION_FAILED|INFRA_FAILED|TIMEOUT|CANCELLED|INCOMPLETE)
```

Terminal Attempt immutable. Attempts never retry in place. Plan Item result is a separate append-only human revision. Attempt PASS does not imply Plan Item PASS, Session PASSED or Verdict PASS.

### 9.4. Finding

```text
DRAFT → CLASSIFIED → DISPOSED → FROZEN
  ↑          │            │
  └──────────┴────────────┘  MEMBERSHIP_CHANGED | OBSERVATION_CORRECTED
```

Classification and disposition are human-only. Any reclassification before freeze creates a new `CLASSIFIED` Finding review revision and invalidates pending Finding-disposition platform actions; no defect candidate/Approval exists yet. Any ordinary membership assign/release or assigned-Observation correction from `CLASSIFIED|DISPOSED` atomically resets the mutable header to `DRAFT`, clears only its current review pointer, records actor/reason/old+new membership hashes, invalidates actions and preserves all historical revisions. Manifest signing requires current `DISPOSED` whose pinned membership IDs/hash byte-match the locked current set, then atomically creates/pins the exact `FROZEN` successor. Post-freeze only DefectPublication aggregate progresses and reclassification/membership mutation is forbidden.

### 9.5. Defect draft

```text
Main:         DRAFT → READY_FOR_APPROVAL → AWAITING_APPROVAL → AUTHORIZED → DISPATCHED
Human reject: { DRAFT | READY_FOR_APPROVAL } → REJECTED
Invalidate:   { DRAFT | READY_FOR_APPROVAL | AWAITING_APPROVAL | AUTHORIZED } → INVALIDATED
Tech failure: { DRAFT | READY_FOR_APPROVAL | AWAITING_APPROVAL | AUTHORIZED | DISPATCHED } → FAILED
Confirmation: DISPATCHED → LINKED
```

Only confirmed effect creates `DefectLink`. Retry/reconciliation keeps same effect key. Each terminal transition carries its explicit source discriminator and the exact predecessor-owned field set from §6.6; no long arrow implies a source outside these sets. A new candidate may name only an exact current `FAILED|INVALIDATED` head as predecessor. `REJECTED|LINKED` have no successor; `LINKED` additionally owns the immutable one-per-Finding `DefectLink`.

### 9.6. Evidence/Session review

```text
INITIAL adjudicative revision
  → SUBSTANTIVE_CORRECTION + new Session review       (only before DONE)
  → CLERICAL_CORRECTION / POST_CLOSE_NOT_EVALUATED   (allowed after DONE)
```

Revision rows never mutate. Only adjudicative revision can be pinned by a new review/Verdict/DoD. Post-close clerical revision cannot become adjudicative.

### 9.7. Verdict, DoD и completion

```text
Verdict:    DRAFT → PARTIALLY_SIGNED → SIGNED → SUPERSEDED (only before DONE)
              └──────────────→ SIGNED
DoD:        BLOCKED → READY_TO_CLOSE → SATISFIED
Completion main:          CANDIDATE → AWAITING_APPROVAL → AUTHORIZED → DISPATCHED
Predispatch invalidation: { CANDIDATE | AWAITING_APPROVAL | AUTHORIZED } → INVALIDATED
Approval rejection:      AWAITING_APPROVAL → REJECTED
Dispatch terminal:       DISPATCHED → CONFIRMED | FAILED
```

Legal terminal source sets are explicit: `CANDIDATE | AWAITING_APPROVAL | AUTHORIZED → INVALIDATED`, only `AWAITING_APPROVAL → REJECTED` through the exact generic Approval decision, and only `DISPATCHED → CONFIRMED | FAILED`. There is no public discard shortcut from `CANDIDATE`; before approval request, aggregate change uses the provenanced `INVALIDATED` branch. `CANDIDATE → REJECTED` and `DISPATCHED → INVALIDATED` are forbidden.

`SATISFIED` требует external confirmed `DONE`. После него Verdict/DoD/adjudicative evidence immutable; clerical manifest chain живёт отдельно.

`SUPERSEDED` is the sole terminal projection of an already `SIGNED` Verdict, not an unsigned shortcut: it retains `signedAt` and the exact risk-dependent one- or two-signature set before adding terminal reason/ref fields. Incoming and outgoing supersession lineage are distinct: a new verdict version `>=2` requires `supersedesVerdictRef + revisionReason`; the old verdict of any version becomes `SUPERSEDED` with `supersededByVerdictRef + supersessionReason`. Version 1 forbids only the incoming lineage fields, so its outgoing terminal projection remains reachable. There is deliberately no Verdict `INVALIDATED` state: upstream aggregate drift leaves signed history byte-for-byte `SIGNED` but makes it non-current by exact-ref/hash selection; only explicit human revision performs the reachable supersession UoW.

## 10. Ключевые инварианты и DB enforcement

| Инвариант | Application guard | DB boundary |
|---|---|---|
| Scope isolation | authorize before scoped repository | repeated scope + composite FKs |
| One QA extension/work item | confirmation hook idempotency | scoped UNIQUE work_item_id |
| One current published policy/context | CAS publish | scoped header pointer/partial unique |
| Immutable RequiredSessionPlan version | append-only repository | UPDATE/DELETE rejection trigger |
| Session ordinal | aggregate allocator under lock | scoped UNIQUE ordinal |
| Snapshot freeze | start transition guard | trigger rejects changes after started_at |
| Attempt lineage | monotonic allocator | scoped UNIQUE plan_item+attempt_no; terminal lock |
| Fail-then-pass | US3=`INCONCLUSIVE`; US4 Finding resolver | `2015` base deferred trigger, `2025` additive function replacement |
| Observation immutability | correction command | UPDATE/DELETE rejection |
| One active Finding per Observation | membership CAS | partial UNIQUE active join |
| Every Session Finding disposed before manifest | full-session story-owned review inventory | `2020` negative-blocking trigger, `2025` additive all-active-Finding function replacement |
| No evidence waiver | policy enum/validator | enum/CHECK excludes EVIDENCE |
| Negative evidence | review precheck | deferred review constraint queries finalized links |
| One defect per Finding | confirmation idempotency | UNIQUE Finding/draft/effect refs |
| Signed manifest/review immutable | insert-only repositories | UPDATE/DELETE rejection triggers |
| Linear revision chain | compare expected head | scoped previous/revision trigger |
| High-risk distinct co-sign | live authorization | signer inequality/unique constraints |
| Final close distinct Lead | exact Approval live gate | initiator/approver inequality snapshot |
| DONE only after confirmation | generic confirmation state machine | QA has no Core write grants/path |
| Post-DONE non-retroactivity | correction classifier | trigger permits only non-adjudicative clerical revision |

DB functions/triggers planned in Pack migrations:

- `qa_reject_immutable_mutation()`;
- `qa_enforce_session_snapshot_lock()`;
- `qa_enforce_session_parent_scope_and_acyclic()`;
- `qa_enforce_attempt_terminal_lock()`;
- `qa_assert_attempt_lineage_decision()`;
- `qa_enforce_finding_membership_scope()`;
- `qa_assert_session_reviewable()`;
- `qa_enforce_manifest_revision_chain()`;
- `qa_enforce_post_done_correction()`.

Triggers are second boundary. Domain/use-case tests remain primary source of readable error codes and zero-call behavior.

## 11. Isolation, access и non-disclosure

### 11.1. Query rule

Every use case follows:

```text
verified identity
→ Workspace membership
→ Project Entitlement
→ permission/role
→ resource classification
→ scoped parent repository
→ child/artifact/model/queue/Connector access
```

Failed authorization stops before the next step and uses a non-disclosing not-found/denied response. Global `findById`, storage resolve before policy, or child-first lookup is forbidden.

### 11.2. Artifact access

Metadata and content are independently authorized on every request. QA API returns proxy stream, never external locator or signed URL. A manifest reference does not grant artifact access. Expired artifact returns metadata state `EXPIRED` only to an otherwise authorized actor.

### 11.3. Async and confirmation scope

Commands/events/jobs carry Workspace, Project, Work Item and correlation IDs. Worker/consumer re-authorizes scope and exact config before effect. A mismatched Connector receipt is rejected before generic confirmation UoW invokes any hook. A hook cannot attach an external defect/request from another Project even if external IDs collide.

## 12. Migration/table inventory 2000–2030

QA migrations execute after completed feature 001 Core/Dummy migrations and share the global schema-version ledger under Pack ownership.

Foundation registers the ordered range plus reusable scoped/immutability helpers, but creates no story table. Each additive migration below belongs to the first independently testable user story that needs its rows; later stories never edit an earlier file.

### `2000_qa_context_policy_requests` — US1

Creates:

- `qa_project_contexts`;
- `qa_project_context_versions`;
- `qa_risk_review_policies`;
- `qa_risk_review_policy_versions`;
- `qa_request_extensions`;
- `qa_request_input_revisions`.

Adds scoped Core reference FKs and immutable context/policy/request-input revision/current-pointer constraints. No Core table is altered. US1 can therefore create a structurally valid request extension plus initial input revision pinned to an existing scoped risk policy without depending on readiness tables or pretending incomplete DoR facts are ready.

### `2005_qa_readiness_required_plans` — US2

Creates:

- `qa_readiness_assessments`;
- `qa_waivers`;
- `qa_required_session_plans`;
- `qa_required_session_plan_versions`;
- `qa_required_session_plan_requirements`.

Adds immutable readiness/waiver/plan revision and current-pointer constraints; it consumes, but does not create, the policy revision pinned by US1.

### `2010_qa_session_planning` — US2

Creates:

- `qa_test_sessions`;
- `qa_plan_items`.

Adds Session planning/transition/snapshot-lock and scoped lineage constraints.

At this story boundary `qa_plan_items` is planning-only: rows are `PLANNED`, result/waiver transitions and latest-result columns are not yet exposed.

### `2015_qa_manual_execution` — US3

Creates:

- `qa_manual_attempts`;
- `qa_plan_item_result_revisions`;
- `qa_plan_item_result_attempt_memberships`;
- `qa_plan_item_result_observation_memberships`;
- `qa_observations`.

Additively alters `qa_plan_items` to install nullable latest-result/waiver pointers, composite scoped FKs and the full `PLANNED | RUNNING | TERMINAL | WAIVED` CHECK; adds terminal Attempt/lineage constraints, complete server-derived contiguous finalized-Attempt/current-leaf-Observation membership hashes and deferred equality guards. They reject a running Attempt, caller omission and empty executed Observation sets; require `POSITIVE` exact-PASS-Attempt source for PASS and eligible same-PlanItem exact-Attempt `NEGATIVE|AMBIGUOUS` coverage for every negative Attempt/result; and atomically set Plan Item `TERMINAL`, so result-first rejects late execution while execution-first expands the derived set. The independently runnable US3 row shape has no `flaky_disposition_basis` columns or Finding FK and therefore permits fail→pass only as `FLAKY_SUSPECTED+INCONCLUSIVE`. Migration `2010` itself is never edited.

### `2020_qa_evidence_review` — US3

Creates:

- `qa_evidence_artifact_links`;
- `qa_plan_item_result_evidence_memberships`;
- `qa_evidence_manifest_artifact_memberships`;
- `qa_evidence_manifests`;
- `qa_evidence_manifest_revisions`;
- `qa_session_reviews`.

Adds exact result-evidence membership/hash validation, manifest chain and append-only/reviewability triggers plus scoped `latest_session_review_id`/manifest pointers to `qa_test_sessions`; only QA tables are altered. The `2020` form of `qa_assert_session_reviewable()` queries only US3 tables: PASS Sessions can complete independently only when every pinned Observation is an unsuperseded leaf; any executed negative Attempt/current negative human result with stale, missing, wrong-Attempt or wrong-kind Observation coverage returns stable `FINDING_REQUIRED`, and every eligible current negative/ambiguous leaf also returns that blocker because Findings do not exist yet. US3 does not create a placeholder classification/disposition or reference a future Finding table.

### `2025_qa_findings_defect_publication` — US4

Creates:

- `qa_findings`;
- `qa_finding_observations`;
- `qa_finding_review_revisions`;
- `qa_plan_item_result_flaky_observation_memberships`;
- `qa_defect_drafts`;
- `qa_defect_links`.

Adds active Finding-membership, active-draft/link/effect unique indexes, frozen-review constraints, confirmed-link append-only guards and additively extends `qa_evidence_artifact_links` with the scoped `FINDING` owner branch. It also `ALTER`s `qa_plan_item_result_revisions` to add the nullable all-or-none `flaky_disposition_basis` columns (Finding ID, exact review revision/version/content hash, membership-set hash, failed-Attempt-set hash, flaky-Observation-set hash and policy key/version/hash), composite same-scope/session Finding-review FK plus CHECK allowing that basis iff the row is `FLAKY_SUSPECTED+PASS`; normalized membership rows bind each exact failed Attempt to its same-PlanItem `NEGATIVE|AMBIGUOUS` Observation and active Finding membership, and entity/projection mapping is upgraded in the same story. In this migration, `CREATE OR REPLACE` installs Finding-aware versions of `qa_assert_attempt_lineage_decision()` and `qa_assert_session_reviewable()`: flagged `PASS` may commit only when the complete server-derived finalized `ASSERTION_FAILED` set is covered by those Observation memberships in the pinned exact current `DISPOSED` review/membership/policy basis; review rechecks complete Attempt/Observation equality and that basis unchanged, then atomically creates/pins its `FROZEN` successor with the manifest. Every negative/ambiguous source must resolve through that same review-time freeze. This supplies the US4 contribution without editing migrations `2015/2020`, creating an earlier hidden table dependency or introducing a freeze-ordering cycle.

### `2030_qa_verdict_completion` — US5

Creates:

- `qa_verdicts`;
- `qa_verdict_signatures`;
- `qa_dod_assessments`;
- `qa_completion_candidates`;
- `qa_final_close_confirmations`;
- `qa_post_close_correction_markers`.

Adds scoped `latest_dod_assessment_id` FK/pointer to `qa_request_extensions`, nullable deferred marker ref to clerical Evidence revisions, RequiredSessionPlan freeze and post-DONE correction guards. Again no Core table is altered.

### Outside the QA range

- Mock operational resources/effects live in the separate Mock Hub database/migration stream; no cross-database FK/query exists.
- Core generic confirmation base contract/UoW is a feature 001 public artifact. If its public surface is missing, implementation stops at prerequisite gate. Feature 002 may add only the QA-agnostic multi-effect/hook generalization described in T006; it never recreates that infrastructure in QA persistence or adds a QA branch to Core.
- New operational capability schemas/contracts do not imply QA-owned Core schema changes.

### Migration behavior

- Fresh, repeat, current-minus-one upgrade and failed-migration recovery run on PostgreSQL 17 and 18.
- Migrations are ordered, transactional where PostgreSQL DDL allows, and collision-free with Core/Dummy ranges.
- Down migrations are developer-only before data use. Signed/effect history is not destructively rolled back in deployed environments; compatibility changes use expand/migrate/contract.
- Migration validation asserts table owner, FK direction, DB grants/triggers and absence of Core DDL in `2000…2030`.

## 13. Основные indexes и read projections

Минимальные indexes:

- all tables: `(workspace_id, project_id, id)`;
- request/backlog: `(workspace_id, project_id, work_item_id)`;
- current policy/context/plan header pointers;
- sessions: `(workspace_id, project_id, work_item_id, ordinal)` and `(work_item_id,state)`;
- request input revisions: `(extension_id, revision)` plus unique content hash and current-pointer CAS lookup;
- Attempts: `(plan_item_id, attempt_no)`;
- Observations: `(test_session_id, plan_item_id, manual_attempt_id)`;
- active Finding membership partial unique;
- Findings: `(test_session_id,state)`;
- active defect candidate partial unique and confirmed link unique;
- manifest revisions: `(manifest_id, revision_no)`;
- post-close markers: unique `(manifest_revision_id)` and ordered `(manifest_id, recorded_at)`;
- Verdicts/DoD/completion: `(work_item_id, created_at desc)` and pending-state partial indexes.

Read projections are derived, not new authority:

- `QaWorkItemDetail` is composed through an ordered Pack-owned section registry: US1 intake/input; US2 readiness/RequiredSessionPlan/Sessions; US3 execution/evidence; US4 Findings/defects; US5 Verdict/DoD/completion. Missing not-yet-installed story sections yield explicit empty collections, while final composition requires all registered sections;
- `QaOperationalReadinessStage` combines latest QA assessment with Core confirmed projection through a closed matrix: `NOT_EVALUATED|NEEDS_INFO` carry no command/result/error; `READY_PENDING_SYNC` carries the exact command only; `SYNC_ERROR` carries command+error; confirmed `READY` carries command+result without error and remains confirmed while the Core Work Item later advances through `PLANNED|IN_PROGRESS|REVIEW|BLOCKED|DONE|CANCELLED`;
- `CurrentFindingDefectState` combines frozen disposition intent, draft state and optional `DefectLink`;
- `LatestEvidenceView` exposes latest clerical revision, separately labelled adjudicative revision and ordered post-close marker history;
- `QaCompletionView` combines signed Verdict, latest DoD and Core `normalizedStatus`.

Projection rebuild never mutates canonical QA decisions.

Every Pack operation is classified `AGGREGATE_MUTATION | COMPLETION_SELF_TRANSITION | POST_CLOSE_CLERICAL_CORRECTION | READ_ONLY` and passes through `QaAdjudicativeMutationGuard` under the extension aggregate lock before repository/model/Broker work. Only `AGGREGATE_MUTATION` invokes the installed US5 invalidator and terminally invalidates a predispatch completion candidate before commit; the earlier no-op registration is safe only while no candidate table/candidate can exist. `COMPLETION_SELF_TRANSITION` is a closed exact-transition allowlist that revalidates an unchanged candidate and cannot be used for arbitrary aggregate writes. An in-flight DISPATCHED completion rejects every aggregate mutation but permits its own exact `CONFIRMED|FAILED` reconciliation. When the current Core projection is `DONE`, all new aggregate mutations/effects remain rejected: input/readiness/plan, Session/Attempt/Observation/result/review, substantive evidence, Finding/defect, waiver, Verdict/DoD/completion. Only idempotent replay/read of the already confirmed self-transition, clerical correction and reads/history are legal; direct-use-case and registration tests prevent bypass.

## 14. Обязательные data-model tests

### 14.1. Migration/constraint tests

- fresh/repeat/upgrade/recovery on PostgreSQL 17/18;
- QA migration attempts no Core DDL and Core has no FK to `qa_*`;
- every mixed-scope parent/child/join/artifact reference fails;
- request-input revision chain rejects gap/fork/no-op, forged response channel and any publish after confirmed READY/Session;
- immutable versions, Observations, signed manifests/reviews/signatures/assessments reject update/delete;
- revision chains reject gap, fork, cross-manifest or cross-session predecessor;
- session snapshot mutation after RUNNING fails under concurrent edit/start;
- ManualAttempt cancellation-reason iff CHECK rejects missing/non-CANCELLED reason and preserves the bounded value in content hash;
- Observation correction paired fields, same-session/Attempt self-FK, no-fork/acyclic and post-review triggers reject every broken lineage/race;
- result-evidence memberships reject unlisted/cross-result/cross-scope substitution and any set whose recomputed hash differs from its exact result revision;
- one-active-Finding-per-Observation race yields one winner;
- Finding revision constraints require reachable CLASSIFIED→DISPOSED→FROZEN predecessor stages and forbid disposition placeholders on CLASSIFIED;
- duplicate defect confirmation yields one `DefectLink`.

### 14.2. Domain/lifecycle tests

- every legal/illegal Session transition and BLOCKED resume path;
- multiple Attempts preserve history and contiguous monotonic numbers; result creation derives the complete finalized prefix, rejects a running/omitted Attempt, and atomically makes the Plan Item `TERMINAL`, so execution-first is included while result-first rejects late repeat/initial Observation;
- every executed result owns the complete current-leaf Observation set; PASS rejects zero/only-INFORMATIONAL/wrong-Attempt input and requires a `POSITIVE` Observation of an exact member `PASS` Attempt as expected/actual source;
- each negative human result owns its exact non-empty evidence membership set; no nearby PlanItem/prior-result attachment is inherited implicitly;
- every negative Attempt and current negative human result owns exact same-PlanItem/exact-Attempt `NEGATIVE|AMBIGUOUS` Observation coverage; zero, stale, wrong-Attempt, positive/informational or unrelated same-Session substitution blocks review;
- `ASSERTION_FAILED→PASS` yields `FLAKY_SUSPECTED`, blocks automatic PASS and requires human decision;
- US4 flagged PASS pins current DISPOSED Finding hashes; concurrent reclassification blocks review, while unchanged refs become FROZEN only in the atomic review+manifest UoW;
- negative Attempt/result without finalized attachment cannot enter Session review under any waiver;
- all Findings must be classified/disposed before manifest sign;
- Session review atomically signs manifest/outcome/completion state or writes nothing;
- defect confirmation after Session completion adds late link without mutating manifest;
- ordinary/high-risk Verdict signer matrices and distinct actors;
- final close always requires distinct QA Lead exact Approval;
- under one extension-lock/UoW, an aggregate-mutation-first race invalidates every predispatch completion candidate before committing with zero Connector call, while a `DISPATCHED`-first race blocks every aggregate-mutating registered/direct-use-case path but still permits only that exact candidate's `DISPATCHED→CONFIRMED|FAILED` reconciliation;
- requested/dispatched transition never yields DONE; confirmed receipt does;
- `DONE + FAIL` passes DoD with open linked defect and creates no release decision;
- post-DONE clerical revision leaves adjudicative manifest/Verdict/DoD IDs and hashes unchanged;
- post-DONE semantic revision/Verdict supersession is rejected.

### 14.3. Security/recovery tests

- same-Workspace cross-Project and cross-Workspace attacks deny before child/storage/model/queue/Broker calls;
- forged/revoked/service actor cannot perform human-only decisions;
- mismatched external receipt/profile/binding fails before confirmation hook;
- crash after external effect/before local commit reconciles with same effect key and one external resource;
- terminal completion `FAILED` preserves dispatch provenance and releases the in-flight pointer, while `CONFIRMED` resolves it into the permanent Core-DONE adjudicative freeze;
- hook failure rolls back all local Core+QA confirmation writes;
- Redis loss does not lose durable state;
- logs/audit/problem responses exclude secrets, raw evidence and object locators.

## 15. Invariant summary

1. QA owns QA semantics and writes only QA tables; generic Core UoW owns Core mutations.
2. Every QA graph edge is Workspace+Project scoped; authorization precedes lookup/effect.
3. RequiredSessionPlan is a stable header plus immutable versions; DoD pins one exact version.
4. Manual retry never erases an Attempt; fail-then-pass remains `FLAKY_SUSPECTED` pending human judgment.
5. Executed negative outcome always has artifact evidence; evidence waiver does not exist.
6. Findings are human-classified/disposed and frozen before Session manifest signing.
7. External defect truth appears later in one append-only `DefectLink`; signed evidence is not backfilled.
8. Verdict and operational state are distinct: `FAIL + DONE` is valid and is not a release decision.
9. Final close is initiated by a QA Executor, exact-approved by a distinct QA Lead and becomes Core `normalizedStatus=DONE` only after external confirmation.
10. Post-DONE correction is clerical/non-adjudicative and cannot retroactively alter Session Outcome, Verdict or DoD.
