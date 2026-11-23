# Implementation Plan: QA manual walking skeleton

**Feature:** `002-qa-manual-walking-skeleton`  
**Branch:** `main`; feature выбирается через `.specify/feature.json`
**Specification:** [spec.md](spec.md)  
**Plan status:** Spec Kit design complete; implementation in progress after the Feature 001 prerequisite gate passed
**Planned:** 2026-08-28  
**Scope:** только feature 002: QA Pack, `qa.validation`, manual QA lifecycle, evidence, Findings, defect draft, signed verdict и completion против mock operational authority; real Jira, GitLab automation, Mattermost/Hermes runtime, queue/SLA и production deployment не входят.

## 1. Результат планирования

Feature 002 добавляет первый product Pack `competency-qa` поверх extension, command, approval, artifact и local-runtime primitives feature 001. Pack регистрирует единственный Work Type `qa.validation@1.0.0`, принимает versioned Intake Draft, а после явного подтверждения создаёт typed command capability `operational-work-item@1.0.0`. Work Item и `QaRequestExtension` появляются только в confirmation transaction после подтверждённого внешнего mock effect; pending/error command не создаёт фиктивную operational state.

QA Pack канонически владеет immutable request-input revisions, readiness assessments, immutable Required Session Plan revisions, MANUAL Test Sessions, session-scoped plan/checklist snapshots, Plan Items, Manual Attempts, Observations, Findings, defect drafts, Evidence Manifest revisions, residual risk, human signatures и DoD assessments. Platform Core продолжает владеть generic Work Item, scope/RBAC, exact Approval, durable commands/events, audit, idempotency, artifact references, generic external-command lifecycle transactions и atomic confirmation UoW. Additive lifecycle contributions let Pack code update only Pack projections in the same generic transaction as Approval rejection/release, pre-effect claim or terminal failure; Core remains the sole command/outbox owner and contains no QA branch. Mock operational Connector реализует тот же vendor-neutral capability, который feature 003 заменит Jira Connector-ом без изменения QA Pack.

Критический вертикальный flow:

```text
confirmed Intake Draft
→ one mock QA Request
→ atomic Work Item + QaRequestExtension + initial immutable input revision + Operational Binding
→ deterministic DoR NEEDS_INFO
→ explicit pre-READY input revision/CAS if facts are missing
→ human readiness confirmation + exact-approved externally confirmed READY
→ explicit immutable RequiredSessionPlan publication
→ MANUAL Session + immutable target/scope snapshot
→ Plan Items + Manual Attempts + Observations + artifact evidence
→ human Finding aggregation, classification and disposition
→ human-reviewed Session Outcome + signed Evidence Manifest
→ accepted/rejected defect draft and exact-approved mock defect when PRODUCT
→ signed QA Verdict + residual risk
→ deterministic DoD
→ distinct-QA-Lead exact approval + structured completion summary/comment + externally confirmed DONE transition
→ derived operational projection normalizedStatus=DONE
```

`DONE + FAIL` является нормальным завершением выполненной QA-работы и не означает release approval. Model provider необязателен: readiness, planning, execution, defect template, evidence, verdict и completion имеют deterministic/manual path.

## 2. Нормативные входы и prerequisite

### 2.1. Нормативные документы

- [Конституция](../../.specify/memory/constitution.md)
- [Feature specification](spec.md)
- [ADR-0001: Competency Pack, Work Type и Connector](../../docs/adr/0001-competency-pack-work-type-connector.md)
- [ADR-0002: Jira operational authority](../../docs/adr/0002-jira-operational-authority.md)
- [ADR-0003: QA Session, Evidence, Finding и Verdict](../../docs/adr/0003-qa-session-evidence-verdict.md)
- [ADR-0004: Workspace и Project Entitlement](../../docs/adr/0004-workspace-project-entitlement.md)
- [ADR-0005: Hermes и exact Approval](../../docs/adr/0005-hermes-coordinator-approval.md)
- [ADR-0006: Project Integration Binding](../../docs/adr/0006-project-integration-binding-versioning.md)
- [ADR-0007: Action-specific exact Approval](../../docs/adr/0007-action-specific-exact-approval.md)
- [Master Specification v2](../../docs/agentic-workspace-platform-master-spec-v2.md)
- [Feature 001 plan](../001-extension-kernel-local-skeleton/plan.md) и [tasks](../001-extension-kernel-local-skeleton/tasks.md)

При конфликте действует порядок: Конституция → feature 002 specification → принятые ADR → master specification → опубликованные public contracts feature 001 → этот план.

### 2.2. Жёсткий entry gate

Текущий repository snapshot завершил только T001–T056 feature 001. В нём ещё отсутствуют необходимые для 002 production-shaped primitives: working Command Gateway/Broker/outbox/worker, exact Approval runtime, operational confirmation UoW, artifact proxy/storage, stateful Mock Hub и clean local composition.

Реализация 002 начинается только после одновременного выполнения:

- финальный Feature 001 gate зелёный и machine-readable report подтверждает все `AT-001…AT-019`;
- public command/approval/artifact/event/confirmation contracts имеют стабильные `1.x` versions;
- Work Item создаётся только после confirmed external create и имеет ровно один generic Operational Authority Binding;
- Core+Pack migrations, Mock Hub migrations, PostgreSQL outbox и local object storage проходят recovery tests;
- `smoke:001` остаётся зелёным без QA package.

Feature 002 не копирует и не обходит незавершённые части 001. Если public contract 001 отличается от ожидаемого плана, первая задача 002 фиксирует совместимую adapter boundary либо останавливает реализацию с явным dependency defect.

Read-only planning audit выявил четыре ожидаемых additive gap поверх завершённого 001 design: confirmation path пока create-specific, `PLATFORM_ACTION` executor — Binding-specific, Pack-у не гарантирован public scoped Project Registry/Binding-health/Operational-projection query surface, а permission/artifact authorization catalogs не принимают contributions. После подтверждения базовых primitives T002, setup tasks T006/T011 обобщают их в QA-agnostic `1.x` hook/handler/query/policy ports до подключения Pack. Эти изменения не содержат `qa.*` branch/entity/rule; если отсутствует сама durable primitive 001, setup не реализует замену и gate остаётся BLOCKED.

### 2.3. Planning outputs

Spec Kit planning outputs составляют единый design package:

- этот [plan.md](plan.md) — architecture, gates и trace;
- [research.md](research.md) — закрытые неоднозначности и rejected alternatives;
- [data-model.md](data-model.md) — aggregate ownership, lifecycle, constraints и migration inventory;
- [contracts/README.md](contracts/README.md) — public HTTP/event/capability schemas and examples;
- [quickstart.md](quickstart.md) — implementation/verification walkthrough;
- [tasks.md](tasks.md) — tests-first atomic implementation decomposition.

Contract artifacts являются design inputs. Implementation tasks валидируют, компилируют и публикуют их через общий offline registry, но не изобретают contract semantics заново.

## 3. Technical Context

| Область | Решение для 002 |
|---|---|
| Language/runtime | Наследуется от 001: TypeScript `6.0.3`, strict ESM, Node.js `24.x`, pnpm `11.21.0`, Nx `23.1.2` |
| Backend/runtime | NestJS `11.2.x` adapters; QA domain/application code framework-independent |
| Web | React `19.2.8`, MUI `9.3.1` только через `platform-ui`; compile-time QA UI contribution |
| Durable persistence | PostgreSQL 17/18 matrix, TypeORM `1.1.0`, `synchronize:false`; Pack-owned ordered migrations `2000…2030` |
| Async delivery | Готовые PostgreSQL command/event outboxes + BullMQ/Redis из 001; Redis не authoritative |
| Operational integration | Vendor-neutral capability `operational-work-item@1.0.0`; в 002 только `connector-mock` + stateful Mock Hub |
| Artifact storage | Generic artifact service/proxy из 001; S3Mock — approved local binary store, manifest metadata остаётся в PostgreSQL |
| Contracts | OpenAPI 3.1, JSON Schema 2020-12, AsyncAPI/event schemas, TypeBox/Ajv, direct pinned `yaml` parser, offline local-ref validation, RFC 8785 canonical hash |
| Identity/security | Verified fake OIDC local personas; `Workspace membership ∩ Project Entitlement ∩ role ∩ classification`, default deny |
| Model use | Optional Pack-owned proposal port; deterministic template is canonical fallback; model result never changes state directly |
| Tests | Vitest, real PostgreSQL Testcontainers, Connector conformance, Playwright Chromium, local smoke and recovery scenarios |
| Observability | Structured audit/log/trace with workspace/project/work item/session/correlation IDs; no raw evidence or credentials |
| Deployment | Local/test composition only; no production target, credential, connector or network path |
| Seed scale | 2 Workspaces, at least 2 Projects in one Workspace, Requester/QA Executor/QA Lead personas, PASS and FAIL fixtures |

Feature 002 не обновляет major toolchain versions. Любой dependency addition использует workspace catalog/lockfile policy 001 и не ослабляет frozen install.

## 4. Constitution Check — до проектирования

| Принцип | Статус | Как соблюдается |
|---|---|---|
| I. QA-first release | PASS | Регистрируется один product Work Type `qa.validation`; MANUAL — mode Session, не второй Work Type. |
| II. Jira authority | PASS | QA Pack не хранит status/priority/assignee/due date. В 002 typed Mock authority подтверждает operational effect; real Jira остаётся 003. |
| III. Workspace/Project boundary | PASS | Каждая QA row/event/action/artifact имеет оба scope ID, repositories scoped, child links защищены composite FK. |
| IV. Core/Pack/Connector | PASS | QA semantics находятся в `competency-qa`; Core получает только generic registrations/ports; Pack и Connector не импортируют друг друга. |
| V. Deterministic core | PASS | DoR/DoD, transitions, RBAC, evidence integrity, idempotency и approvals не используют LLM. |
| VI. Exact approvals | PASS | Defect create и READY transition используют exact external-command Approval; Executor-prepared completion candidate is exact-approved by a distinct QA Lead before terminal transition; waivers/high-risk/accepted-risk use exact platform action with live recheck. |
| VII. Human verdict | PASS | Session Outcome, Finding classification и QA Verdict принимают только verified HUMAN actor; model/service/connector rejected. |
| VIII. Evidence/target snapshot | PASS | Snapshot pin’ит build/environment/checklist/binding/profile refs; signed manifest append-only, correction creates revision. |
| IX. Reliability/audit | PASS | External effects проходят durable 001 path, retries reuse stable effect key, every mutation/effect is audited. |
| X. Local-first | PASS | Stateful Mock Hub, fake identities/model scenarios and S3Mock cover critical flow without corporate systems. |
| XI. Versioning | PASS | Pack/work type/rules/policy/schemas explicit versions; published snapshots and signed history are not reinterpreted. |
| XII. Production boundary | PASS | Only LOCAL/NON_PRODUCTION target scopes accepted; local composition physically excludes production Connector/credentials. |

**Constitution exceptions:** нет.

## 5. Архитектура решения

### 5.1. Intake и operational acceptance

```text
Web QA intake
  → Core Intake Draft with qa.validation schema pin
  → deterministic Pack validation
  → explicit requester confirmation + request idempotency key
  → Command Gateway resolves requirement QA_REQUEST_AUTHORITY
  → PostgreSQL command/outbox/audit transaction
  → worker → Broker → Mock operational Connector → Mock Hub
  → confirmed external issue id/version
  → generic Core/persistence confirmation UoW:
       Draft LINKED + Work Item + Operational Binding + command result
       + registered QA hook writes QaRequestExtension + initial input revision only
  → event qa.request.accepted
```

До последней transaction Work Item ID не резервируется и Pack extension не существует. Confirmation требует closed structural minimum `{title, requestKind, authoritative dataClassificationKey, scope/definition pin}` и проверяет trusted scope/secret/target barriers, но не требует полной DoR: missing semantic facts сохраняются как optional/presence-aware fields initial revision и становятся structured blockers. Typed external create uses `summary=title` and classification; generic description/acceptance-outcome fields remain absent when the human did not provide them. Повтор confirmation с тем же canonical payload возвращает исходный command/result; тот же key с иным payload hash даёт conflict. Timeout/429/5xx оставляет durable command retryable и не создаёт local fake success.

The full work-item detail is assembled by a Pack-owned additive `QaWorkItemDetailSectionContribution` registry rather than by an US1 controller importing future repositories. US1 installs the stable aggregator and intake/input section; US2 adds readiness/plan/Session sections, US3 execution/evidence, US4 Finding/defect and US5 Verdict/DoD/completion. Before a later section is installed its required collection is explicitly empty, and the final composition/reload test proves every installed section participates. This preserves independently runnable story checkpoints without a permanently incomplete detail response.

### 5.2. Manual execution и review

```text
ReadinessAssessment NEEDS_INFO
  → HUMAN Requester/Executor input revision + CAS / exact lead waiver
  → human READY confirmation
  → exact-approved mock transition where Project Context maps READY
  → confirmed operational sync projection READY
  → Session PLANNED
  → target + scope snapshots + Plan Items
  → start guards
  → READY → RUNNING
  → Observations + artifact refs + terminal item results
  → REVIEW_REQUIRED
  → Findings classified/disposed
  → human SessionOutcome + Evidence Manifest revision 1
  → COMPLETED
```

Readiness assessment и external status — разные authority. Assessment является QA-owned canonical decision. В seeded mock Project Context `READY` также требует exact-approved `request.transition` и confirmation/reconciliation read-back; до него request показывает `READY_PENDING_SYNC`, а при ошибке — `SYNC_ERROR`. Эти значения являются derived sync projection, не очередью или SLA model. Feature 003 заменит только Connector/Profile mapping. Live environment availability проверяется session start guard. Структурная валидность published mandatory Binding входит в DoR; transient connector outage после assessment отображается отдельным operational block и не переписывает историческую assessment.

### 5.3. Defect и completion

```text
failed/ambiguous Observations
  → unclassified Finding
  → human classification + disposition before Session review
  → signed Evidence Manifest + completed Session
  → PRODUCT only: immutable defect draft candidate
  → human accept or explicit reject
  → accepted draft: exact QA Executor Approval
  → one mock defect + DefectLink

current plan coverage satisfied + created Sessions completed/reviewed or exact zero-execution exclusions
  → signed Verdict (+ independent QA Lead co-sign when policy requires)
  → deterministic DoD READY_TO_CLOSE
  → immutable completion candidate prepared by Executor
  → exact approval by a distinct QA Lead
  → one typed mock QA Request transition carrying canonical completion summary
  → confirmed external summary digest + version/state
  → generic confirmation updates Operational Binding raw/external sync metadata
    and derives Core Work Item `normalizedStatus=DONE`
  → final DoD SATISFIED
```

`INFRA`, `INCONCLUSIVE`, `DUPLICATE` and non-defect dispositions perform zero defect-create calls. `ACCEPTED_RISK` requires independent QA Lead approval. Open product defect is recorded but never a DoD blocker by itself.

### 5.4. Bounded ownership

| Модуль | Владеет | Не владеет |
|---|---|---|
| Platform Core (001) | Generic Draft/Work Item/Operational Binding, auth, commands, exact approvals, audit, events, artifacts | QA states, rules, verdict, defect semantics, mock/Jira fields |
| `competency-qa` | Work Type, intake schema, project QA context, risk policy, request extension, readiness, sessions, evidence, findings, defect candidates, verdict and DoD | Queue authority, vendor SDK, raw secrets, release decision |
| Connector SDK/contracts | Typed `operational-work-item` operation shapes and conformance declarations | QA rules or profile selection |
| `connector-mock` | Mock protocol mapping, idempotent create/transition/defect operations, read-back | Work Item/QA domain state or approvals |
| Mock Hub | External mock issues/defects, state/version/effect ledger and failure scenarios | Platform DB or QA canonical state |
| Runtime composition | Static generic contribution factories, profile/binding/handler maps and explicit QA local composition | QA branches in generic controllers/catalogs or runtime downloads |
| API/web adapters | Backend-derived actor/context, HTTP DTO mapping and QA UI | Authorization truth or hidden state transitions |

### 5.5. Целевая структура изменений

```text
packages/competency-qa/
├── src/manifest.ts
├── src/index.ts
├── src/domain/
├── src/application/
├── src/persistence/
│   └── migrations/2000…2030
└── src/ui/contribution.tsx

packages/connector-sdk/src/operational-work-item.ts
packages/connector-mock/src/operational-work-item.connector.ts
apps/mock-hub/src/operational/
apps/api/src/extensions/qa-pack.controller.ts
apps/web/src/routes/qa/

specs/002-qa-manual-walking-skeleton/contracts/
├── schemas/
├── examples/
├── openapi/
└── asyncapi/

tests/{architecture,contract,integration,e2e}/...
tools/{verification,smoke,ci}/...
```

### 5.6. Dependency directions

```text
competency-qa ──► competency-sdk / competency-ui-sdk / platform-contracts
connector-mock ──► connector-sdk / platform-contracts
API + worker ──► explicit runtime-composition ──► selected Pack/Connector adapters
web ──► competency-qa compile-time UI contribution + platform UI SDK
platform-persistence-typeorm ──► platform-core

forbidden:
platform-core ─X─► competency-qa
competency-qa ─X─► connector-mock / vendor SDK / NestJS / Core repositories
connector-mock ─X─► competency-qa
model provider ─X─► repositories / commands / approvals
```

QA-specific exact platform actions register Pack-owned handlers through the generic action-executor contribution port from 001. QA permission declarations, artifact policy adapters and confirmation hooks are likewise typed contributions; Core/generic runtime never switches on `qa.*` action kind. Existing Core-only 001 composition arrays remain unchanged. Architecture tests also reject `AUTOMATED` execution code and Jira-specific field/API literals in feature 002.

Для существующих 001 primitives применяется additive generalization: create-confirmation contract принимает несколько typed effect kinds, platform-action executor выбирает registered handler, а permission/artifact surfaces вызывают registered generic policy contributions. Dummy/Binding behavior и public 001 regression остаются совместимыми; QA semantics появляются только в Pack-owned contribution implementations.

## 6. Domain model and design decisions

### 6.1. Pack, Work Type and taxonomy

`competency-qa@1.0.0` statically registers `qa.validation@1.0.0`. Wire taxonomy uses:

```text
feature-validation | smoke | regression | retest | investigation
```

The four values required by FR-002 are mandatory; `regression` is included now for compatibility with the master taxonomy and future automated sessions. It remains a request kind, not a Work Type. Feature 002 rejects session mode other than `MANUAL`.

The manifest declares required logical role `QA_REQUEST_AUTHORITY` and optional/conditional role `DEFECT_DESTINATION`, both against `operational-work-item@1.0.0`. Pack supplies requirement keys only; Profile/Connection resolution remains in Core/Broker.

### 6.2. QA Project Context and versioned policy

A minimal versioned `QaProjectContext` is Pack-owned and seeded for the reference Project. Context/policy revisions have stable header identity, immutable `{revision, contentHash}` rows and an explicit current-published pointer. It pins:

- allowed non-production environment IDs and immutable revisions;
- allowed server-derived response-channel kinds; feature 002 permits only a verified `PLATFORM_WEB` principal/channel ref;
- current QA request/defect requirement semantics, not raw Profile IDs;
- closed allowlisted target/scope/checklist policy catalogs with exact immutable refs and explicit defaults used by RequiredSessionPlan slots;
- project risk level and data-classification limits;
- exact semantic `dorRuleSet`/`dodRuleSet`/`evidencePolicy` refs `{key, version, contentHash}` and scoped immutable `riskReviewPolicy` revision `{id, version, contentHash}`.

Published context/policy revisions are immutable. `RequiredSessionPlan` follows the same revision model per Work Item: every change creates a content-addressed revision, preserves the previous link and moves a CAS-protected latest pointer. On US2 activation, a stable empty plan header is created/ensured for each extension and exposed as `{currentRevisionRef:null,revisions:[],resourceVersion}` with an `ETag`; this is concurrency infrastructure, not a fabricated plan. Initial publication uses `If-Match` against that header plus `expectedCurrentPlanRef=null`/`INITIAL`, and the 201 response hands back the advanced header version/ETag. New Work Items pin current context/policy versions at acceptance, but their extension exact-version pointer remains absent until US2 publishes the initial plan from current readiness/context inputs. Session creation and DoD require and pin that exact required-plan revision. The confirmed-DONE QA hook freezes the plan header in the same transaction as final DoD satisfaction, after which publication/revision is rejected; historical sessions, manifests and verdicts continue to use their pinned versions. Feature 007 may later replace seed/admin mechanics without reinterpreting 002 history.

Each plan-version requirement has a canonical content hash and, when unchanged, an exact immediate predecessor requirement ref. DoD evaluates the current plan but may count a completed/reviewed Session from an ancestor version only through an unbroken same-key/same-hash carry-forward chain. Any changed requirement content/policy/minimum count breaks reuse; a current `WAIVED` requirement needs no Session. A late Required Session waiver can therefore revise one requirement without forcing reruns for unrelated unchanged requirements.

Publication is an explicit authorized HUMAN command, not a side effect of readiness evaluation or external READY confirmation. Initial publication requires the **current** operational projection to be confirmed `READY`. Later revisions retain that exact historical readiness proof but validate the current Core operational projection/version against the closed preterminal allowlist `READY | PLANNED | IN_PROGRESS | REVIEW | BLOCKED`; `CANCELLED` and `DONE` are terminal and reject publication, as does a frozen header. QA Executor/Lead submits the complete ordered plan against current aggregate CAS and the relevant input/reason; every slot policy ref must be an exact member/default of the catalogs in the pinned QA Project Context and unknown/client-invented refs are rejected. The transaction inserts the immutable revision/requirements, CAS-moves the header and `QaRequestExtension` pointer, and emits an audited publication event. Current and immutable history remain queryable.

Effective review risk is the maximum of project risk and request risk. `riskReviewPolicy@1` requires:

- ordinary verdict: one QA Executor signature;
- HIGH/CRITICAL verdict: QA Executor signature plus a distinct QA Lead co-sign;
- the only 002 DoR waiver subject `PROJECT_REGISTRY_NEEDS_REVIEW`, plus allowed plan-item/session/required-session/Finding waivers: distinct QA Lead approval, reason and expiry; `DOD`/`EVIDENCE` waiver kinds and all other DoR blockers are absent in 002;
- `ACCEPTED_RISK`: distinct QA Lead approval;
- every signer/approver: live membership, entitlement, role and classification authorization at decision time.

### 6.3. QaRequestExtension and readiness

`QaRequestExtension` is the stable accepted-request header with immutable definition/policy pins and CAS-controlled pointers:

- Workspace/Project/Work Item and Work Type definition pin;
- QA Project Context/rule/policy pins;
- exact current immutable `QaRequestInputRevision` ref;
- nullable latest readiness/DoD assessment IDs and nullable latest immutable Required Session Plan revision pointer, populated only by their owning later phases;
- aggregate row version, actors, timestamps and correlation ID.

It never stores Jira/mock-owned status, priority, assignee or due date.

Each append-only `QaRequestInputRevision` has same authoritative scope/Work Item, monotonically increasing revision, previous/content hash, publication reason and verified HUMAN actor. Its closed persisted content repeats required human title/request kind/authoritative classification and carries optional-until-DoR goal/agreed-validation-scope/outcome/source/build/target/test-data/risk/date facts, presence-aware blockers/dependencies, and conditional RETEST lineage. The confirmed structural identity tuple `{workspaceId, projectId, workItemId, definitionRef, acceptedDraftRef, externalRequestRef, operationalBindingRef, originalRequesterRef, title, requestKind, dataClassificationKey}` is frozen from revision 1: later command bodies expose only DoR-semantic fields, the server copies this tuple, and both the application guard and an insert-time DB comparison against revision 1 reject drift. `scope` inside semantic content is the agreed validation scope, never a replacement for authoritative Workspace/Project/definition scope. The previous-Session value is an immutable same-scope lineage ref (`EXTERNAL_HISTORICAL` at the US1 checkpoint, or native `QA_SESSION` once US3 review/evidence exists), not a premature FK to later tables. US2 defines only the resolver port; a Pack contribution installed with US3 review persistence accepts the native branch only for an exact same-scope completed/reviewed Session and pins its current review/manifest ref. Server code re-resolves a closed response-channel resolution from the immutable original requester principal, never from the revision actor: `CONFIRMED` with the verified `PLATFORM_WEB` principal/channel ref allowed by context, or `MISSING` with a stable blocker code; the client never selects the authoritative ref.

The readiness input is a deterministic projection of that persisted resolution, not a second lookup: `CONFIRMED` maps to `CONFIRMED`, while `MISSING` maps to `UNCONFIRMED` and preserves the exact requester principal, resolution-policy ref, evaluation timestamp and response-channel ref/reason branch. The latter emits `RESPONSE_CHANNEL_UNCONFIRMED`; no adapter may reinterpret missing provenance as a new channel identity.

Initial revision is inserted by the confirmed-request hook even when semantically incomplete. While no READY command is `DISPATCHED`/in-flight and operational `READY` is not confirmed, an entitled HUMAN Requester or QA Executor may publish a complete **DoR-semantic** replacement revision with expected-current CAS and reason; immutable structural fields are absent from the public command and copied from revision 1. Revision and READY dispatch serialize on the same aggregate lock: revision-first inserts history, moves only the extension current-input pointer and invalidates latest assessment/waiver/pending READY candidate; dispatch-first blocks revision until terminal outcome, after which confirmed READY freezes input while a failed command permits a new revision. Because initial RequiredSessionPlan publication requires confirmed READY, no published plan can pin a still-revisable input. A structural-identity change at any time, or a semantic change after confirmed READY/Session existence, is rejected and requires a new linked QA request.

Readiness is a deterministic pure evaluation over the exact current request-input revision and other canonical input revisions. In addition to request content it proves the accepted external request exists, Project is `ACTIVE`, requester entitlement and server-confirmed response channel remain valid, blockers/dependencies were explicitly supplied, request-kind source lineage is complete, Project Registry is `CURRENT` (or a distinct Lead exact DoR waiver pins `NEEDS_REVIEW`), and mandatory Binding/Profile mapping validation has no blocking errors. Transient reachability remains a separate sync/start concern. Each `ReadinessAssessment` is append-only and stores the exact request-input revision ref, rule version, input fingerprint, structured blockers/warnings/acknowledgements, actor and timestamp. A missing item has stable code, JSON pointer/field key, severity and remediation hint; no free-text-only result.

States:

```text
NOT_EVALUATED → NEEDS_INFO | READY | READY_WITH_WAIVER
```

QA Executor or QA Lead explicitly confirms a blocker-free `READY`. In 002 only `PROJECT_REGISTRY_NEEDS_REVIEW` is waivable; inactive/scope/entitlement/channel/content/declaration/lineage/classification/security and Binding/Profile mapping blockers are hard. The allowlisted waiver is an immutable candidate consumed through a `PLATFORM_ACTION`; approval does not edit the original assessment and creates a new `READY_WITH_WAIVER` assessment. Its exact scope/rule/input fingerprint, distinct Lead authority and expiry are revalidated both when readiness is confirmed and immediately before the external READY effect is authorized.

The seeded mock context maps confirmed readiness to external normalized state `READY`. The Pack therefore prepares one immutable `request.transition` candidate with expected external version/state; the human confirmation is recorded through the generic exact Approval path, and the derived operational sync projection becomes `READY` only after Connector confirmation/reconciliation. Before assessment, `NOT_EVALUATED` has no command/result/error; `NEEDS_INFO` likewise remains local assessment data. An accepted assessment starts `READY_PENDING_SYNC` with the exact command but no result/error, while terminal failure is `SYNC_ERROR` with command+error. Confirmed `READY` requires command+result and forbids an error. Readiness remains confirmed if the Core Work Item later advances to `PLANNED | IN_PROGRESS | REVIEW | BLOCKED | DONE | CANCELLED`; those later operational states do not rewind the QA assessment. No local code writes the external status directly, and no queue/ranking model is introduced.

### 6.4. TestSession, snapshots and manual execution

One Work Item can have many Sessions. Ordinal is unique within `(workspaceId, projectId, workItemId)`. Every feature-002 Session pins one exact RequiredSessionPlan requirement key in the pinned plan revision; purpose, capabilities and snapshot policies are derived from that requirement rather than trusted from free client text. `parentSessionId` expresses retest/rerun lineage, must remain in the same scope/Work Item and keeps the same requirement lineage.

Lifecycle:

```text
PLANNED → READY → RUNNING → REVIEW_REQUIRED → COMPLETED
   │         │        │            │
   └─────────┴────────┴────────────→ BLOCKED
READY ── structural edit ──→ PLANNED
BLOCKED → READY | RUNNING | REVIEW_REQUIRED | CANCELLED
Any non-terminal → CANCELLED
```

`state` and `sessionOutcome` are independent. Only a HUMAN QA Executor/Lead may sign `PASSED | FAILED | BLOCKED | INCONCLUSIVE`. `BLOCKED`/`CANCELLED` transitions require reason, actor and predecessor-stage provenance; reached milestones remain present and future milestones are forbidden. Resume returns only to the corresponding reached stage and reruns its boundary guard. `CANCELLED` is allowed only while Attempt/Observation/result sets are all empty; once execution facts exist the Session must remain `BLOCKED` and resume to a reviewable path. `COMPLETED` requires successful human review transaction.

Before RUNNING, authorized planning may replace target/scope/owner/capabilities or Plan Items with optimistic concurrency. Session carries a monotonic `structureRevision`, canonical `structureHash` and nullable `readyAgainstStructureHash`. Any structural edit increments/recomputes them; when the Session is `READY`, the same transaction records an audited HUMAN `READY→PLANNED(STRUCTURE_CHANGED)` reset with old/new hashes and clears the current ready-against pointer. The historical READY record remains append-only, but a fresh complete `PLANNED→READY` guard is required. Edit and `READY→RUNNING` take the same Session lock/CAS: edit-first leaves `PLANNED` so start fails; start-first atomically locks canonical hashes and makes the edit return `SESSION_SNAPSHOT_LOCKED`. From `startedAt` onward target/scope/structure/Plan Items are immutable by domain rule and database trigger; requested changes return a command affordance to create a linked Session.

`TargetSnapshot` contains exact project, build/commit/MR, environment ID+revision, test-data/account-lease refs, checklist version/hash, Project Integration Binding ref and all Profile refs resolved for session setup. Each later Connector command additionally pins the exact chain it actually uses. Evidence provenance records only the exact target and command/profile refs actually used by the signed revision; future defect/completion commands cannot be appended to an already signed manifest.

`ScopeSnapshot` contains purpose, agreed scope, acceptance outcome, checklist definition ref/version/hash-or-snapshot and explicit inclusions/exclusions. Mutable aliases without resolved version/hash are rejected.

### 6.5. PlanItem, ManualAttempt and Observation

Plan Items are session-scoped, ordered and mode `MANUAL`. A reusable definition is represented only by immutable external ref/version/hash or a stored session snapshot; no reusable test repository is introduced.

The US2 planning slice persists only `PLANNED` items and exposes no result/waiver transition. US3 migration `2015` additively introduces ManualAttempt/result storage, the scoped latest-result FK and `RUNNING | TERMINAL | WAIVED`; thus a US2 checkpoint never depends on an execution table owned by a later story.

Results:

```text
PASS | FAIL | BLOCKED | NOT_RUN | INCONCLUSIVE
```

To satisfy the constitutional Attempt lineage without importing `AutomationAttempt`, every execution of a manual Plan Item creates a Pack-owned `ManualAttempt` with `attemptNo`, actor/start/end, target snapshot hash and canonical attempt result `PASS | ASSERTION_FAILED | INFRA_FAILED | TIMEOUT | CANCELLED | INCOMPLETE`. The Plan Item result remains the human QA result required by the feature specification. A repeated manual check creates another attempt and never overwrites the previous one. Result creation locks the Plan Item/Session, rejects a running Attempt, and server-derives the complete contiguous finalized Attempt set `1..current maximum`; expected set hash/watermark from the client is CAS input, not membership authority. Repeat/initial-Observation/result/review serialize: execution-first expands the derived sets, while result commit atomically makes the Plan Item `TERMINAL` and result-first rejects every later execution mutation rather than reopening it. `ASSERTION_FAILED` followed by success therefore cannot be hidden or collapse into clean `PASS`: the reducer scans the complete history, emits `FLAKY_SUSPECTED` and requires a human disposition. At the independent US3 boundary only `INCONCLUSIVE` is legal, so migration `2015` has no reference to future Finding storage. US4 migration `2025` additively extends the resolver/DB guard to permit flagged human `PASS` only when its superseding result pins the exact current `DISPOSED` Finding-review ref, active membership-set hash, policy basis, the complete exact server-derived set of its `ASSERTION_FAILED` Attempts and a non-empty exact Observation set covering every such Attempt. Each pinned Observation must belong to the same Plan Item, reference that failed Attempt, have kind `NEGATIVE|AMBIGUOUS`, and be an active member of the pinned Finding set; an unrelated same-Session Finding can never satisfy the rule. The later Session-review UoW rechecks all complete sets and that basis unchanged and atomically creates/pins the `FROZEN` successor plus manifest; it does not require Finding freeze before the result exists, and migration `2015` is never edited. Every Observation references one ManualAttempt, and every Evidence Manifest lists the exact attempt IDs.

Observations are append-only facts with expected/actual outcome, actor/timestamp, severity and scoped artifact refs. A correction creates a single-successor chain; result/Finding memberships and review may consume only an unsuperseded leaf. Under the Session lock, inserting a successor makes every result revision containing its predecessor non-current until a new result revision is recorded, releases each active pre-freeze Finding membership of that predecessor, invalidates pending Finding actions and resets the Finding header to `DRAFT` with no current classification/disposition while preserving historical reviews. Initial Observation creation is execution mutation and is forbidden after the result has atomically made the Plan Item `TERMINAL`. The corrected leaf is never auto-assigned or auto-classified. This applies to both `NEGATIVE→POSITIVE` and `POSITIVE→NEGATIVE`; an Observation/result/Finding/review race has one serialized winner. After review every Observation/correction is forbidden. Every executed human result pins the non-empty complete server-derived current-leaf Observation set for its complete finalized Attempt history. `PASS` additionally requires at least one `POSITIVE` current leaf referencing a `PASS` Attempt, so FR-016 always has a structured expected/actual source; an empty or only-`INFORMATIONAL` PASS is invalid, although a clean PASS needs no attachment. Every human `FAIL|BLOCKED|INCONCLUSIVE` and every executed Attempt `ASSERTION_FAILED|INFRA_FAILED|TIMEOUT|INCOMPLETE` requires at least one finalized, accessible artifact reference for that exact lineage, even after a later PASS; feature 002 has no evidence waiver. Separately, every such negative Attempt requires at least one same-PlanItem **current leaf** Observation that references that exact Attempt and is `NEGATIVE|AMBIGUOUS`, and each negative human result's exact Observation membership must include at least one such Observation. A zero, superseded, wrong-Attempt, cross-PlanItem or only-`INFORMATIONAL|POSITIVE` negative substitution returns `FINDING_REQUIRED` and cannot reach review; in US4 each eligible leaf must enter a disposed/frozen Finding. The attachment state machine hands its CAS token forward explicitly: create, upload and finalize responses expose the current attachment-session `ETag` (or an updated session representation carrying the matching resource version), so the next `If-Match` is always obtainable without an implicit GET. A plan-item/session waiver means the check was not executed and is a separate exact human disposition. Because US3 independently exercises `PLAN_ITEM→NOT_RUN`, US3 owns that typed exact distinct-Lead waiver action, authorization checks and route; US5 later adds `SESSION|REQUIRED_SESSION` completion-waiver handlers.

The HUMAN PlanItem result command supplies expected previous revision plus expected Attempt/Observation set hashes and maximum Attempt watermark. Under the shared lock the server derives and persists every finalized Attempt and every current-leaf Observation for those Attempts; caller-supplied refs are never authoritative. Executed results require both sets non-empty, no running Attempt, contiguous Attempt numbers, and exact equality with the current server-derived sets; commit atomically sets the Plan Item `TERMINAL`. Execution/result races have one winner: execution-first changes the set before derivation, result-first makes later repeat/initial Observation illegal. A permitted pre-review Observation correction returns the current selector as `STALE_OBSERVATION_SET` until a superseding result revision is recorded; review repeats complete-set equality under the same serialization boundary. `NOT_RUN` is the sole zero-Attempt/zero-Observation result and requires an exact approved, unexpired `PLAN_ITEM` waiver in both the result revision and signed manifest; it cannot hide an existing Attempt or negative-evidence obligation. List/history queries expose immutable Attempts, Observations and result revisions, and the signed review freezes further execution/adjudicative changes.

### 6.6. Evidence and artifacts

The binary remains in the generic object-storage provider. QA Pack stores links to generic artifact metadata and a signed, append-only Evidence Manifest revision. Upload/finalize verifies content checksum, size, media type, classification and ownership before an artifact may enter a manifest.

Manifest revision includes all fields required by FR-016 plus rule/policy pins, session outcome, Finding dispositions and provenance. Signing means an immutable human sign-off record over `SHA-256(RFC 8785 canonical manifest content)` with signer identity, live authorization basis, policy version and time; feature 002 does not introduce PKI/non-repudiation claims.

Correction never updates signed JSON. It creates revision `n+1` with `previousRevisionId`, correction reason, new content hash and new human signature. Previous revisions remain queryable. Before external DONE, a substantive correction atomically inserts the new adjudicative manifest revision plus a superseding SessionReview and advances manifest latest/adjudicative and Session latest-review pointers, or writes nothing. A previously signed Verdict is **not** rewritten or terminally relabelled by that correction: it remains signed historical evidence, but current selection rejects it because its exact SessionReview/manifest refs and aggregate hash no longer match. When the US5 contribution is installed, the same correction UoW also appends a current `DoD=BLOCKED(AGGREGATE_CHANGED)` assessment over the new refs and invalidates any pre-dispatch completion candidate; before US5 the contribution is a no-op because those tables do not exist. Thus `READY_TO_CLOSE` is historical rather than current after correction, and a fresh Verdict revision/signature/DoD assessment is required before another completion attempt. The stable Evidence Manifest header is the CAS owner: manifest get/history (and initial creation response) expose its `resourceVersion` and matching `ETag`, while every correction requires `If-Match` against that header rather than against the Session. After confirmed external `DONE`, only a clerical correction marked `POST_CLOSE_NOT_EVALUATED` is allowed: its canonical signed revision content contains a bounded ordered `clericalAnnotations` change set for correction notes and allowlisted display-field edits, distinct from the overall audit reason. A note-only change therefore still produces verifiable new bytes/hash/signature. One US5 transaction inserts that non-adjudicative revision and its separate append-only correction marker, advances only the latest-display pointer and preserves the adjudicative pointer/Verdict/DoD. Marker history is queryable after restart. A semantic conclusion change requires a new linked QA request. Artifact expiry changes only generic availability to `EXPIRED`; external locator/content becomes unavailable, while manifest metadata, checksum and audit chain remain intact. QA consumes this generic availability projection and does not own a second expiry sweeper.

Artifact metadata and content are authorized separately on every request. Content is streamed via the proxy from 001; locator/signed URL is never returned. Denials are indistinguishable from not-found outside the permitted scope.

### 6.7. Finding, defect draft and DefectLink

A failed or ambiguous Observation does not create a defect. An authorized HUMAN groups one or more same-scope Observations into a Finding and classifies it:

```text
PRODUCT | INFRA | INCONCLUSIVE | DUPLICATE | ACCEPTED_RISK
```

Finding stores severity, summary, affected target hash, evidence refs, classification actor/reason and disposition. Aggregation, human classification and disposition occur in `REVIEW_REQUIRED` before Session Outcome/manifest signing. The signed manifest records those decisions and current immutable evidence refs, but does not require a future DefectLink. `ACCEPTED_RISK` remains pending until independent QA Lead platform-action approval. `WAIVED` requires a separate exact `FINDING` waiver approved by a distinct QA Lead and never relaxes negative-evidence requirements. `DUPLICATE` requires both an allowed exact existing-defect ref and an explicit human disposition reason.

Feature 002 keeps aggregation deterministic: one Observation may belong to only one active Finding, one Finding has at most one active defect draft and one confirmed DefectLink, and a single draft cannot merge multiple Findings. Reclassification is revisioned only before Session review/freeze and invalidates pending Finding-disposition platform actions. No wording proposal, defect candidate or defect Approval exists before freeze. Canonical proposal/draft creation begins from the frozen revision after Session completion; a confirmed external defect/link remains historical and is never erased.

Only a human-classified `PRODUCT` Finding can produce an immutable defect draft candidate. The canonical builder is a deterministic versioned template. An optional model proposal may suggest wording only, but its output is schema-validated, provenance-marked and must be accepted into a new candidate by a human; no model path can plan a Session, classify a Finding, approve or publish. Replacing wording first atomically invalidates the current pre-dispatch candidate with full predecessor provenance, then creates `n+1` as its exact successor. A successor is legal only from current head `FAILED|INVALIDATED`; human `REJECTED` and confirmed `LINKED` are chain-terminal. In particular, once a `DefectLink` exists, DB/domain guards forbid every later candidate, so an immutable link can never coexist with a newer human-rejected current head. Human rejection creates an immutable final candidate revision with reason and zero external calls.

Publication creates one approval-required `defect.create` command after Session completion. Exact subject pins action/command ID, full typed payload hash, target, expected state, binding/profile refs, scope, initiator, approver live basis, expiry and effect key. Generic confirmation UoW consumes a Pack hook that atomically creates one `DefectLink` and marks the draft `LINKED`; QA code writes only QA-owned rows. Replay returns that link. Non-PRODUCT classification, rejected/stale candidate, drift or denied/expired approval produces zero Connector calls.

### 6.8. Verdict, DoD and completion

`QaVerdict` is append-only and contains verdict, residual risk, exact completed Session IDs, Evidence Manifest revision IDs, rule/policy pins, content hash and signature set. An explicit Verdict supersession creates a new version and marks its exact still-current signed predecessor `SUPERSEDED`; upstream aggregate drift such as a substantive evidence correction instead leaves that signed row unchanged and makes it non-current by exact-ref/hash comparison. A later fresh Verdict may supersede that historical predecessor only through the explicit revision flow. Either path invalidates any pending completion candidate whose expected aggregate snapshot changed.

For ordinary risk, a QA Executor signature finalizes the verdict. For HIGH/CRITICAL, the primary signature creates an exact co-sign platform action; only a different currently authorized QA Lead can finalize it. Hermes/model/service identities are rejected even if a forged role string is supplied.

Deterministic DoD evaluates and stores the exact Required Session Plan revision plus aggregate content hashes. It checks:

- the current plan retains at least one `REQUIRED` slot and the aggregate contains at least one actual completed/reviewed Session;
- every `REQUIRED` slot meets its minimum through completed/reviewed current or exact hash-carry-forward Session coverage; only a `REQUIRED_SESSION` waiver in the current plan version removes that slot's coverage need;
- every created Session is completed/reviewed except an exact distinct-Lead `SESSION` waiver may exclude one zero-execution cancelled Session from the inventory, without satisfying its requirement key;
- every Plan Item terminal or waived;
- reviewed Session Outcomes and signed manifests;
- all Findings classified with disposition;
- for each frozen `CREATE_DEFECT` Finding, the current publication chain ends in `LINKED` or explicit human `REJECTED`; fully provenanced historical `FAILED|INVALIDATED` candidates are allowed only when superseded by that current terminal outcome, while non-create dispositions have no draft/link;
- residual risk and fully signed verdict;
- required independent reviews from the pinned policy.

The evaluate route supplies only optimistic aggregate/CAS context and optional exact hints; it never trusts a caller-authored closure inventory. The server resolves the current Required Session Plan, Verdict, reviews, manifests, Findings, drafts/links and waivers. A `BLOCKED` assessment can therefore represent a missing plan, Verdict, review or manifest with stable blocker codes and absent corresponding refs. Only `READY_TO_CLOSE` and `SATISFIED` require a complete exact ref inventory and its server-derived aggregate hash; collections are non-empty where semantically applicable, while clean PASS and exact waived/not-run branches retain explicit valid empty collections.

An open linked product defect is not a blocker. When DoD yields `READY_TO_CLOSE`, the QA Executor builds an immutable completion candidate containing canonical structured scope summary, Verdict, residual risk, evidence-manifest and closed defect/disposition refs plus expected external version/state. Each summary defect entry follows the frozen disposition: `CREATE_DEFECT+LINKED` requires exact draft+DefectLink; a human-rejected publication requires exact draft+rejection outcome/ref and no link; non-create dispositions forbid draft/link fields; `DUPLICATE` carries its exact existing-defect ref plus human reason. Exact-approved dispatch takes the extension aggregate lock, rechecks that summary/aggregate hash is unchanged and atomically installs a Pack-owned completion-in-flight pointer before command/outbox publication.

The guard registry uses a closed mutation classification. `AGGREGATE_MUTATION` covers input/readiness/plan, Session/execution/review, substantive evidence, Finding/defect, waiver, Verdict/DoD and non-idempotent candidate creation; it invokes the installed invalidator under the same lock and terminally invalidates any pre-dispatch `CANDIDATE | AWAITING_APPROVAL | AUTHORIZED` candidate before committing the changed aggregate. `COMPLETION_SELF_TRANSITION` covers only the exact candidate's `CANDIDATE→AWAITING_APPROVAL`, Approval result to `AUTHORIZED|REJECTED`, `AUTHORIZED→DISPATCHED`, and `DISPATCHED→CONFIRMED|FAILED` reconciliation. This class never invokes the invalidator on itself: it instead revalidates the exact candidate ID/version/content hash, unchanged aggregate snapshot, expected external version, Binding/Profile and Approval plus the closed predecessor transition under the same lock. Any mismatch fails with zero effect. While `DISPATCHED`, every aggregate mutation is rejected and only that candidate's exact terminal self-transition may proceed. Thus correction-first invalidates a pre-dispatch candidate, while dispatch-first blocks the correction without making legal approve/dispatch unreachable. The invalidator is a no-op contribution before US5 tables exist and is installed globally with US5. Terminal `FAILED` releases the pointer, while confirmation permanently freezes through Core DONE. The same closed `completionSummary` is sent by the Connector as one idempotent terminal operation. Confirmation/reconciliation requires matching summary digest and terminal state before the generic Core/persistence UoW derives `normalizedStatus=DONE` and emits final `qa.dod.satisfied`. Its QA hook writes only QA-owned rows: one append-only final-close confirmation, candidate delivery=`CONFIRMED`, final DoD=`SATISFIED` and RequiredSessionPlan header freeze; neither requested state nor a Pack-owned `CLOSED` field becomes authority.

No entity, field, API or event represents release/no-release.

Verdict supersession is allowed only while the external operational request is open. A Pack-owned `QaAdjudicativeMutationGuard`, backed by the current Core operational projection, wraps every QA command registration/use-case boundary. After confirmed `DONE` it rejects request-input/readiness/plan publication, Session create/replace/transition, Attempt/Observation/result, Session review/adjudicative evidence, Finding/draft/publication, waiver, Verdict/DoD/completion mutation and any external effect. The sole allowlisted mutation class is the bounded post-close clerical Evidence Manifest correction described in 6.6; reads/history remain available. Architecture and integration matrices reject any unguarded command registration. A semantic correction requires a new linked QA request.

### 6.9. Model boundary and degraded mode

Feature 002 does not implement Hermes Agent Runtime. It defines only a narrow Pack-owned `QaDraftAssistant` proposal port for defect wording and uses the deterministic fake provider/failure scenarios from local composition when available.

Before any provider call, input is reduced to allowlisted fields and checked against Workspace/Project, classification and provider policy. Restricted evidence or raw artifact content produces `MODEL_INPUT_DENIED` and zero provider calls. `unset`, timeout, invalid schema or provider error returns a deterministic template with explicit provenance and never blocks any state transition.

### 6.10. Authorization and non-disclosure

The exact feature-002 permission catalog consists of versioned Pack-owned declarations registered through the generic contribution catalog:

```text
qa.request.create, qa.request.confirm, qa.request.input.revise
qa.readiness.evaluate, qa.readiness.confirm, qa.readiness.waive
qa.required-session-plan.publish
qa.session.plan, qa.session.execute, qa.session.review
qa.plan-item.result
qa.finding.classify, qa.finding.accept-risk
qa.defect.draft, qa.defect.publish
qa.evidence.write, qa.evidence.read
qa.verdict.sign, qa.verdict.cosign
qa.waiver.approve
qa.completion.request, qa.completion.approve
```

This is the complete additive `qa.*` catalog for 002. It does not replace the generic `project.*` permissions published by feature 001: every route/worker/artifact/effect declares the applicable base permission as well as any QA-specific mutation/read key. In particular, request/detail/Confirmed Backlog queries require the existing `project.request.read`; this feature does not introduce `project.queue.read` behavior, ranking or SLA semantics.

The API derives actor and authoritative scope from verified token/route context. IDs are looked up only through scoped repositories. Requester, service identities and Hermes cannot execute Executor/Lead human mutations; AT-009 explicitly permits a live-authorized QA Executor or QA Lead to approve an ordinary defect and denies Requester/service/model actors. Cross-project, cross-workspace, classification, role or entitlement denial occurs before repository child traversal, artifact resolve, async enqueue, model call or Connector call and returns the same public not-found/denied shape without confirming entity existence. Generic artifact/authorization controllers remain domain-neutral and invoke registered policy contributions rather than importing QA semantics.

## 7. Contract and versioning strategy

- Contract sources for 002 live under `specs/002-qa-manual-walking-skeleton/contracts/` and are compiled into the shared offline registry through feature contributions, not hard-coded QA branches in Core.
- Schemas use JSON Schema 2020-12 with closed objects, immutable local `$ref`, explicit `schemaVersion`, digest and positive/negative examples.
- HTTP uses `/api/v1`, OpenAPI `3.1.0`, RFC 9457 Problem Details, `Idempotency-Key`, `If-Match`, correlation/causation headers and `202 + Location` for async external effects.
- Public QA API groups follow master spec: Work Item QA extension/readiness, Test Sessions and commands, Findings, Evidence and Verdicts. Exact approval decisions remain on the generic approval API.
- Capability `operational-work-item@1.0.0` exposes exactly typed `request.create`, `request.transition` and `defect.create`; there is no `execute(any)`. DONE transition contains the closed structured completion summary/digest and confirms its rendered comment receipt together with state under one effect identity. Read-back is a Connector confirmation/reconciliation strategy through generic 001 ports, not a Pack-callable fourth operation.
- Event families are `qa.request.*`, `qa.readiness.*`, `qa.required-session-plan.*`, `qa.test-session.*`, `qa.plan-item.*`, `qa.finding.*`, `qa.defect.*`, `qa.evidence.*`, `qa.post-close-correction.*`, `qa.verdict.*` and `qa.dod.*`, each in the full scoped Event Envelope from 001.
- Work Type definition, QA rules, evidence policy and risk policy use SemVer/content hash. Aggregate/entity wire payloads use integer major versions.
- Additive optional fields are compatible. Enum narrowing, renamed/removed field, changed signature input or relaxed invariant requires a new major schema/rule version and explicit migration/replay tests.
- Historical snapshots, assessments, signatures and manifests retain the exact interpretation version used at creation; current policy does not silently reinterpret them.

## 8. Persistence and transaction boundaries

QA Pack owns a collision-free migration range:

```text
2000_qa_context_policy_requests           # US1
2005_qa_readiness_required_plans          # US2
2010_qa_session_planning                  # US2
2015_qa_manual_execution                  # US3; adds result/waiver columns + scoped FK to 2010 Plan Items
2020_qa_evidence_review                   # US3
2025_qa_findings_defect_publication       # US4
2030_qa_verdict_completion
```

Story-owned slices are additive and ordered so the suggested US1 MVP does not install future Session/Finding/Verdict tables. Shared Foundation creates only registry/helpers, not product tables; no migration is edited after a later story starts.

Expected Pack tables include version headers/revisions for QA Project Context and risk policy, `qa_request_extensions`, append-only `qa_request_input_revisions`, `qa_readiness_assessments`, versioned `qa_required_session_plans`, `qa_waivers`, `qa_test_sessions`, `qa_plan_items`, `qa_manual_attempts`, `qa_plan_item_result_revisions`, exact-set `qa_plan_item_result_attempt_memberships`, `qa_plan_item_result_observation_memberships`, `qa_observations`, `qa_findings`, scoped join `qa_finding_observations`, append-only `qa_finding_review_revisions`, exact flaky resolver join `qa_plan_item_result_flaky_observation_memberships`, candidate rows `qa_defect_drafts`, `qa_defect_links`, `qa_evidence_manifests`, `qa_evidence_manifest_revisions`, client-owner `qa_evidence_artifact_links`, exact-set `qa_plan_item_result_evidence_memberships`, separate signed `qa_evidence_manifest_artifact_memberships`, append-only `qa_session_reviews`, `qa_verdicts`, `qa_verdict_signatures`, `qa_dod_assessments`, `qa_completion_candidates`, append-only `qa_final_close_confirmations` and `qa_post_close_correction_markers`.

Mandatory boundaries:

- external request confirmation: generic Core/persistence UoW writes command result + Draft link + Work Item + Operational Binding + event/audit, while a registered QA hook writes only QaRequestExtension + initial input revision/QA rows in the same PostgreSQL transaction;
- readiness evaluation is append-only; extension latest-assessment pointer uses optimistic CAS in the same transaction;
- waiver/accepted-risk/high-risk co-sign uses generic platform action, exact immutable candidate hash and one-time CAS consumption;
- session transition + actor/timestamp/event/audit is atomic; RUNNING snapshot hash cannot change afterward;
- Observation/artifact link/result revision is scoped and optimistic; review locks the execution set;
- Session review + signed manifest revision + signed outcome + `REVIEW_REQUIRED→COMPLETED` is one transaction;
- defect confirmation uses the same generic UoW extension boundary; its QA hook writes one DefectLink + draft `LINKED`, while generic rows/event/audit remain Core-owned;
- verdict signature/co-sign and DoD assessment each pin the exact aggregate snapshot they evaluated;
- completion confirmation uses generic UoW to update Operational Binding raw state/external version/sync metadata and the Core Work Item derived `normalizedStatus=DONE`; its QA hook finalizes exact DoD, and no Pack repository writes Core tables;
- signed manifests/verdicts/assessments/audit are append-only; DB tests reject update/delete where required;
- QA Pack may FK to stable Core IDs; Core schema never FK/imports QA tables;
- every child relation repeats Workspace/Project and uses composite FK to prevent mixed-scope graphs.

## 9. Local composition

No new service is required beyond the completed 001 stack:

```text
postgres + redis + s3mock + fake-idp
migrate + seed
api + worker + web + mock-hub
optional local OTel
```

The 002 composition adds separate `qaLocal*` exports for QA Pack migrations/entities/handlers, `operational-work-item` capability and Mock Connector operations. API/worker select it through typed `AWP_COMPOSITION=foundation|qa-local`. Omitted value defaults to `foundation`, so all legacy 001 API/worker/migrate/seed/smoke commands remain QA-free; feature 002 commands explicitly select `qa-local`. That value is rejected unless `AWP_RUNTIME_PROFILE` is `local|test`, outbound network is denied and Mock Hub is configured. Web imports the Pack UI contribution directly. Mock Hub owns and wires a separate app module/migration for external QA requests/defects, monotonic versions, effect ledger and scenarios `success | timeout | 401 | 403 | 429 | 5xx | schema-drift | duplicate | out-of-order`. Compose and the local CLI expose separate `local:qa:*` entrypoints while existing 001 defaults remain behavior-compatible.

Idempotent seed creates or explicitly reuses/asserts compatible feature-001 isolation identities/scopes:

- one reference QA Workspace with ALPHA/BETA Projects plus a distinct DELTA Workspace;
- `requester.alpha`, `executor.alpha`, distinct `lead.alpha`, BETA-only `viewer.beta`, cross-Workspace `outsider.delta` and non-HUMAN `worker.local` identities/roles/entitlements;
- ACTIVE/CURRENT and ACTIVE/NEEDS_REVIEW Project Registry fixtures plus server-confirmed `PLATFORM_WEB` response-channel refs derived from verified principals;
- intended QA Workspace-only `qa.validation@1.0.0` enablement plus published non-production environment, QA Project Context and risk policy revisions;
- exact Mock Connection/Profile/Binding chain for QA request and defect logical roles, including healthy and mapping-blocked revisions;
- PASS, FAIL and HIGH-risk inputs without pre-seeding completed business outcomes.

Scenario CLI exposes at least `qa-manual-pass`, `qa-manual-fail`, `qa-high-risk`, `qa-model-outage` and `qa-cross-project-deny`. `smoke:001` must remain green; `smoke:002` performs its own clean/repeat/restart assertions.

## 10. Verification strategy

Tests are risk-driven; no arbitrary global coverage percentage is used.

| Acceptance test | Проверяемое поведение | Основной уровень | Trace |
|---|---|---|---|
| AT-001 | QA Pack/work type/taxonomy/contracts register statically; Core has no QA branch; MANUAL only | contract/architecture | FR-001–002, US-001 |
| AT-002 | Unconfirmed draft creates zero effects; repeated confirmed structurally valid draft creates one mock issue, Work Item, extension and initial immutable input revision with exact context/DoR/DoD/evidence/risk pins even when DoR-incomplete; minimal scoped Confirmed Backlog/detail reload it; failure creates no fake state | integration/E2E | FR-003–005, US-001, SC-001 |
| AT-003 | DoR returns structured missing fields across project/entitlement/original-requester-channel/content/retest/registry/mapping rules, pins the exact input revision, supports audited pre-READY CAS revision/dispatch race, invalidates stale decisions, and permits only the exact independent-lead Registry waiver | unit/integration/security | FR-006–009, US-002 |
| AT-004 | Multiple MANUAL Sessions plan/start against exact RequiredSessionPlan requirement keys, obey lineage/unique ordinal and freeze snapshots at RUNNING | unit/integration | FR-010–013, US-002 |
| AT-005 | Manual Plan Items/Attempts/Observations preserve retry lineage, turn assertion-fail→pass into `FLAKY_SUSPECTED`, complete a HUMAN-reviewed clean PASS Session, and enforce unconditional negative evidence plus `FINDING_REQUIRED` stop for the US4 flow | integration/E2E | FR-014–015, US-003, SC-002 |
| AT-006 | Signed manifest reconstructs target/checklist/actor/result; mutation is rejected, pre-DONE substantive correction atomically creates an adjudicative linked revision plus superseding SessionReview, post-DONE clerical correction creates a persistent non-adjudicative marker/revision without changing Verdict/DoD, and expired artifact preserves metadata | contract/integration | FR-016–019, SC-004 |
| AT-007 | Evidence metadata/content checks scope/role/classification at every access and does not disclose cross-project existence | security/integration | FR-020, SC-005 |
| AT-008 | Observation never auto-creates defect; classifications/dispositions are human; flagged fail→pass PASS pins current DISPOSED basis and the review UoW atomically freezes it; only frozen PRODUCT yields deterministic/schema-valid draft | unit/integration | FR-021–022, US-004 |
| AT-009 | Live-authorized QA Executor/Lead can exact-approve an ordinary defect; Requester/service/model cannot; accepted command pins full subject, survives retry/replay with one link, while rejection/drift/non-product causes zero calls | integration/security | FR-023–024, US-004 |
| AT-010 | Pinned risk policy requires distinct lead for HIGH/CRITICAL, the sole DoR and allowed session/plan/Finding waivers plus ACCEPTED_RISK, rejects DOD/EVIDENCE waiver kinds, and lets an ordinary QA Executor sign the ordinary verdict | integration/security | FR-009, FR-024, FR-028 |
| AT-011 | DoD permits `DONE + FAIL`, blocks incomplete evidence/disposition/signatures, requires a distinct QA Lead close approval, confirms canonical completion summary/comment plus terminal state in one idempotent operation, derives `normalizedStatus=DONE` and creates no release decision | integration/E2E | FR-025–027, US-005, SC-003 |
| AT-012 | API/repository/artifact/model/queue/command paths deny same-Workspace cross-Project and cross-Workspace attacks before downstream calls | security/E2E | FR-005, FR-020, SC-005 |
| AT-013 | Model unset/invalid/timeout and restricted-classification input use deterministic fallback with zero unauthorized provider calls | contract/E2E | security scenarios, SC-006 |
| AT-014 | Clean local browser flow covers Requester→Executor→Lead PASS and FAIL paths with traceable actor/timestamps/effects | Playwright/smoke | US-001–005, SC-001–004, SC-006 |
| AT-015 | PostgreSQL migrations, append-only constraints, crash/retry/Redis-loss, duplicate/out-of-order result and contract/version drift remain safe | migration/resilience/contract | FR-004, FR-017–019, FR-023, security scenarios |

Additional mandatory checks:

- pure domain negative matrices cover every illegal Session/result/signature/waiver/DoD snapshot;
- contract examples validate through the same runtime schema registry used by API/worker;
- Connector conformance runs Mock plus a second in-memory implementation of every `operational-work-item` operation;
- real PostgreSQL tests cover fresh/repeat/current-1 upgrade, composite scope FKs, append-only rows and confirmation transactions;
- crash after external effect but before confirmation commit uses the same effect key and yields one external entity;
- artifact tests assert deny before storage resolve/stream and checksum mismatch rejection;
- architecture tests reject Core→QA, QA→Connector/vendor, runtime loading, Jira hardcode and AUTOMATED execution;
- Playwright uses backend-issued fake personas; UI visibility is never accepted as authorization proof;
- logs/audit/OTel/problem responses are scanned for secret, raw artifact, raw evidence and object locator leakage.

## 11. Requirements trace summary

| Requirement group | Design section | Primary acceptance |
|---|---|---|
| FR-001…FR-005 — Work Type/intake/scope | 5.1, 6.1–6.3 | AT-001, AT-002, AT-012 |
| FR-006…FR-009 — DoR/waiver | 5.2, 6.2–6.3 | AT-003, AT-010 |
| FR-010…FR-015 — manual Sessions | 6.4–6.5 | AT-004, AT-005 |
| FR-016…FR-020 — evidence | 6.6, 6.10 | AT-006, AT-007, AT-012 |
| FR-021…FR-024 — Finding/defect | 5.3, 6.7 | AT-008, AT-009, AT-010 |
| FR-025…FR-028 — DoD/verdict/risk | 6.2, 6.8 | AT-010, AT-011 |
| SC-001…SC-004 — vertical value/evidence | 5.1–5.3 | AT-002, AT-005–006, AT-011, AT-014 |
| SC-005 — isolation | 6.6, 6.10 | AT-007, AT-012 |
| SC-006 — model independence | 6.9 | AT-013, AT-014 |

No requirement or success criterion is intentionally orphaned.

## 12. Implementation milestones

### M1 — Prerequisite and contract shell

Verify completed feature 001, add `competency-qa` package boundaries and compile all 002 schemas/examples. Gate: prerequisite report + AT-001 contract/architecture slice.

### M2 — QA persistence and policy foundation

Add only shared scoped/revision/persistence helpers and contribution declarations; create no story-specific product table. Gate: generic registry, architecture and PostgreSQL helper tests.

### M3 — Confirmed QA intake

Implement only the `request.create` Mock operation/read-back needed by US1, migration `2000` with scoped context/risk-policy/request-input revisions, explicit confirmation command and atomic Work Item/Operational Binding/QaRequestExtension+initial-input hook. Gate: AT-002 with incomplete-input/failure/retry/crash variants.

### M4 — Readiness and manual planning

Add the Mock `request.transition` operation/Profile revision needed for READY, implement migrations `2005/2010`, pre-READY request-input revise/history flow, deterministic DoR, structured missing fields, exact waiver, versioned RequiredSessionPlan, Session creation, snapshots, start guards and state machine. Gate: AT-003–004.

### M5 — Manual execution and evidence review

Implement migrations `2015/2020`, Attempts/Observations, artifact policy, PASS Session review, signed manifest and pre-DONE revisions/expiry. Fail→pass is retained as `FLAKY_SUSPECTED` and can only be human-closed as `INCONCLUSIVE` at this boundary. A negative Session proves evidence completeness and stops at stable `FINDING_REQUIRED`; neither DB guard references a future Finding table and the slice does not implement the US4 human workflow. Gate: AT-005–007 PASS slice plus negative-evidence/review blocker.

### M6 — Defect draft and publication

Implement migration `2025`, Finding aggregation/classification/disposition, additive result-row `flaky_disposition_basis` storage/scoped constraints, replacement/extension of fail→pass and Session-reviewability DB resolvers using exact current DISPOSED refs followed by atomic review-time freeze, completion of negative Session review, deterministic/model-assisted wording proposal, human accept/reject, the Mock `defect.create` operation/Profile revision, exact Approval and one separate DefectLink. Gate: AT-008–009 and zero-call negative matrix.

### M7 — Verdict and DONE + FAIL

Implement migration `2030`, pinned risk policy, ordinary/high-risk signatures, deterministic DoD, completion payload, the structured-summary DONE branch/new Mock Profile revision, exact confirmed transition and persistent post-close clerical marker flow. Gate: AT-010–011 plus the post-DONE clause of AT-006.

### M8 — Isolation and degraded-mode closure

Cover every new API/repository/artifact/model/async surface, model outage and production barrier. Gate: AT-012–013.

### M9 — Local UX, hardening and handoff

Finish QA UI, local seeds/scenarios, Playwright, resilience, migration/contract drift, trace and CI reports while preserving 001. Gate: AT-014–015 and aggregate `verify:002`.

## 13. Risks and mitigations

| Priority | Риск | Плановая защита |
|---|---|---|
| P0 | 002 строится поверх незавершённого 001 и начинает дублировать infrastructure | Hard prerequisite gate; no compatibility shim that bypasses durable command/approval/artifact paths |
| P0 | Work Item создаётся до external confirmation | Confirmation-only UoW and crash-window acceptance; pending command keeps Draft only |
| P0 | QA state попадает в Core | New Pack package, generic ports, Core-only build and forbidden-semantic scan |
| P0 | Cross-project evidence/command leakage | Scoped repository signatures, composite FK, pre-storage/pre-Broker authorization and adversarial matrix |
| P0 | Model подписывает verdict/classifies Finding | HUMAN actor guard at domain boundary; model output remains schema-valid proposal only |
| P0 | Exact Approval authorizes changed defect/transition | Immutable candidate/full payload hash, expected state, exact refs, live basis and one-time CAS |
| P0 | Evidence can be silently edited | Canonical content hash, append-only signed revisions and DB mutation rejection |
| P1 | Target/build/scope changes erase reproducibility | Snapshot lock at RUNNING and linked replacement Session flow |
| P1 | Failure creates defect spam | Finding-first human classification and PRODUCT-only publication with idempotency |
| P1 | Open defect blocks service completion forever | DoD explicitly treats disposition/link as sufficient and tests `DONE + FAIL` |
| P1 | Mock contract diverges from future Jira | Vendor-neutral `operational-work-item` conformance contract and second implementation test |
| P1 | “Signed” is mistaken for legal/cryptographic non-repudiation | Plan explicitly defines domain sign-off hash/identity semantics; PKI is out of scope |
| P1 | Circular evidence↔defect dependency | Manifest signs classified/disposed Findings before publication; later DefectLink is a separate canonical record consumed by Work Item DoD |
| P1 | Current policy reinterprets historical decisions | Every assessment/session/manifest/verdict pins exact rule/policy versions and hashes |

## 14. Explicit non-goals

- `AUTOMATED` Session, AutomationAttempt, GitLab suite/pipeline/artifact integration or automated retry/flaky policy; минимальное constitutional правило manual fail→pass остаётся в 002;
- real Jira Connector, Jira field/status/JQL mappings, direct-created issue import, webhook reconciliation or conflict UI;
- Mattermost intake/notifications and full Hermes Agent Runtime/Agent Runs;
- reusable test-case repository/TMS, test definition editor or test library;
- production environment, production credentials/actions or real pilot deployment;
- release/no-release decision, deployment approval or product acceptance;
- complex cross-project queue, WIP, capacity, SLA, service classes or onboarding gates;
- arbitrary artifact provider administration, retention policy productization or PKI signatures;
- autonomous defect publication, verdict, Finding classification or risk acceptance.

## 15. Constitution Check — после проектирования

Post-design review confirms:

- Core public model receives no QA entity, enum, table, rule or action branch; generic runtimes consume typed Pack contributions;
- `qa.validation` remains the only product Work Type and feature 002 creates MANUAL Sessions only;
- mock operational state is external and confirmed; QA Pack does not invent or own status/priority/assignee/due date;
- every request/session/plan item/manual attempt/observation/finding/draft/link/evidence/manifest/verdict/assessment/marker/action/event carries Workspace and Project scope;
- every external effect uses typed Gateway→outbox→worker→Broker→Connector with stable effect key and exact configuration pins;
- exact approval separates historical human decision from effect authorization and invalidates drift before invocation; final completion additionally requires a distinct QA Lead;
- only HUMAN actors sign readiness, Finding classification, Session Outcome, manifest, verdict, waiver or risk acceptance as applicable;
- request-input revisions, snapshots, Required Session Plans, signed manifests and verdicts are immutable/versioned; retention expiry preserves metadata and post-close clerical correction is non-retroactive;
- model outage and model denial leave the full deterministic/manual path available;
- `DONE + FAIL` is covered and no release-decision concept is introduced;
- Core-only 001 composition remains free of QA, while future non-local QA composition may contain QA Pack but never Mock/Fake/local routes, credentials or vendor-local shortcuts;
- local composition contains no production endpoint, credential or vendor SDK.

**Post-design status:** PASS, violations/exceptions = 0.

## 16. Implementation gate

Spec Kit plan and task decomposition are complete when:

- [research.md](research.md), [data-model.md](data-model.md), [contracts/README.md](contracts/README.md), [quickstart.md](quickstart.md), this `plan.md` and [tasks.md](tasks.md) pass structural/numbering/trace validation;
- no unresolved planning or pilot-input question remains for local feature 002 acceptance;
- all `US-001…US-005`, `FR-001…FR-028` and `SC-001…SC-006` map to design sections, `AT-001…AT-015` and executable tasks;
- every external write, platform action, snapshot, signature and artifact access has authority/scope/version/idempotency/audit behavior;
- implementation remains blocked until the Feature 001 prerequisite gate is green.

Next execution entrypoint after the dependency gate: implement [tasks.md](tasks.md) in order and finish with `pnpm verify:002` plus `pnpm smoke:002`.
