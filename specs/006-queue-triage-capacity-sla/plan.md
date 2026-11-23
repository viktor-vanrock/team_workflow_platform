# Implementation Plan: Queue, triage, capacity and SLA

**Feature:** `006-queue-triage-capacity-sla`

**Planning branch identifier:** `006-queue-triage-capacity-sla`

**Repository branch:** `codex/feature-006-queue-triage-capacity-sla`

**Baseline:** `91f602e` (`feat(platform): implement GitLab automated validation`)

**Specification:** [spec.md](spec.md)

**Planned:** 2026-09-02

**Constitution:** `2.0.0`

## 1. Summary

Feature 006 adds a multi-project QA work queue without creating another operational
workflow or an AI-owned priority. Platform Core derives Candidate, Backlog, Ready,
Active and Completed stages from immutable Candidate/Draft facts, confirmed Jira
projections, current QA readiness and Session facts. It enforces human-work WIP at
the mutation boundary, calculates SLA from versioned business calendars and
policies, and exposes project lanes plus an entitlement-filtered portfolio view.

```text
Core Candidate/Draft facts ─┐
confirmed Jira projection ──┼─→ versioned queue input snapshot
QA readiness/session facts ─┘       │
                                    ├─→ deterministic stage + visible facets
accepted queue controls ────────────┼─→ explicit comparator components
pinned calendar/SLA policy ─────────┼─→ append-only SLA clock segments
capacity claim ledger ──────────────┴─→ exact start admission / visible WIP

Hermes TriageAssessment ───────────────→ separate explainable proposal only
QA Lead command/Approval ──────────────→ accepted service class/order/override
Jira command + confirmed read ─────────→ Jira priority/due/status authority
```

The implementation extends existing deployment units and packages. It introduces
no new microservice, external connector or production dependency.

## 2. Inputs, dependencies and entry gates

### 2.1. Normative input order

Conflicts are resolved in this order:

1. [Constitution 2.0.0](../../.specify/memory/constitution.md)
2. [Feature 006 specification](spec.md)
3. [ADR-0004: Workspace and Project Entitlement](../../docs/adr/0004-workspace-project-entitlement.md)
4. [ADR-0005: Hermes coordinator and exact Approval](../../docs/adr/0005-hermes-coordinator-approval.md), as amended by ADR-0008
5. [ADR-0007: action-specific exact Approval](../../docs/adr/0007-action-specific-exact-approval.md)
6. [Feature 004 design](../004-mattermost-hermes-intake/plan.md), especially Candidate and TriageAssessment
7. [Feature 003 design](../003-jira-operational-authority/plan.md), especially confirmed operational projections
8. [Feature 002 design](../002-qa-manual-walking-skeleton/plan.md), especially readiness and Session state
9. [Feature 005 design](../005-gitlab-automated-validation/plan.md), especially automated execution activity
10. [Master specification section 14](../../docs/agentic-workspace-platform-master-spec-v2.md)
11. [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/) and this plan

### 2.2. Implementation prerequisite gate

`verify:006:prerequisites` must reject implementation unless it proves that the
checked-out source tree and consumed contracts match fresh PASS evidence for
Features 003, 004 and 005, including Feature 002 compatibility. A historical PASS
file whose source/task digest does not match the checkout is not sufficient.

The gate also proves:

- Jira status, priority and due date still come only from the confirmed Feature
  003 operational projection;
- Candidate/Draft state and TriageAssessment remain compatible with Feature 004;
- MANUAL Session/readiness contracts and AUTOMATED sticky review remain unchanged;
- all Core and QA migrations through Core `0120` and QA `2060` are registered,
  immutable and repeat-safe;
- the required local contour `qa-jira-gitlab-mattermost-local` is closed to
  external network access and starts from the exact QA `1.2.0`, Jira, Mattermost
  and GitLab baseline; Feature 006 acceptance then requires outer
  `competency-qa@1.3.0` and inner `qa.validation@1.3.0` while keeping both V12
  serialized objects byte-identical;
- obsolete Feature 002 migration-inventory assertions are updated to validate
  owner/order/prefix invariants or the current additive registry, rather than
  hard-coding the pre-Feature-004 Core `0095` and QA `2030` tails.

### 2.3. Pilot-input resolution

There is no unresolved design clarification. Missing numerical pilot inputs are
represented explicitly rather than guessed:

- a published `MEASURE_ONLY` queue policy records flow/SLA clocks but has no SLA
  target and does not enforce a numeric WIP limit;
- `ENFORCED` policy publication requires baseline evidence plus numeric Workspace
  WIP, EXPEDITE capacity, SLA targets and warning thresholds. Project soft
  limits/reservations remain optional policy entries; every listed entry is
  numeric, same-Workspace and validation-complete;
- calendar publication requires an IANA timezone, weekly working intervals,
  dated closures/overrides with exactly one override per local date (no CLOSED vs
  WORKING precedence), source/owner and semantic hash; QueuePolicy activation
  accepts only an open-ended revision so pinned clocks cannot outlive its coverage;
- existing in-flight work keeps its pinned SLA/calendar revision; policy changes
  never reinterpret historical elapsed time.

Absent pilot inputs therefore produce `MEASURE_ONLY` or `SKIPPED_GATED`, never a
fabricated PASS, target, deadline or capacity value.

## 3. Technical context

| Area | Decision for 006 |
|---|---|
| Language/runtime | TypeScript `6.0.3`, strict ESM/ES2024/NodeNext; Node.js `24.20.x` |
| Workspace/tooling | pnpm `11.21.x`, Nx `23.1.x`, frozen lockfile |
| Backend/UI | NestJS `11.2.x`, React `19.2.x`, Vite `8.2.x` |
| Persistence | PostgreSQL via TypeORM `1.1.0`; real migration tests on PostgreSQL `17` and `18` |
| Async/recovery | Existing PostgreSQL inbox/outbox plus BullMQ `6.3.x`/Redis `8.2.x`; queue truth never lives only in Redis |
| Validation | JSON Schema 2020-12 with Ajv `8.20.x`; OpenAPI 3.1 and AsyncAPI 3.0 snapshots |
| Testing | Vitest `4.1.x`, Testcontainers `12.1.x`, Playwright `1.62.x`, deterministic/virtual clocks |
| Target platform | Existing API, worker and browser deployment units on Linux containers; local-first Mac/Linux development |
| Project type | TypeScript monorepo with Platform Core, QA Competency Pack, persistence adapters and static runtime composition |
| Product performance | No numerical product SLO before baseline; API is cursor-paginated, aggregation is pre-authorized, and CI proves bounded query count/no connector calls on reads |
| Constraints | Jira remains operational authority; no opaque total score; no autonomous priority/due/order; no numeric SLA/WIP guesses; exact scope and CAS on every mutation |
| Initial scope | One QA Workspace and reference Project, with security/concurrency fixtures covering at least two entitled Projects plus one forbidden Project; sequential rollout only |

No new runtime dependency is justified. Business-time arithmetic, ranking and
policy validation are pure TypeScript over immutable inputs.

## 4. Constitution check — pre-design gate

| Principle | Gate result and design obligation |
|---|---|
| I. Product scope | PASS — extends the single QA Work Type and one functional Workspace; it adds no new Work Type or reusable test library. |
| II. Jira authority | PASS — raw/normalized status, priority and due remain confirmed Jira facts; queue stage and SLA are labelled derived projections. |
| III. Workspace/Project boundary | PASS — every item/fact/clock/claim/decision is scoped; portfolio authorization filters Projects before joins or aggregation. |
| IV. Pack/Core/Connector ownership | PASS — Core owns generic queue/policy/WIP/SLA; QA owns readiness/session/triage semantics; no Connector gains queue authority. |
| V. Deterministic core | PASS — stage, ordering components, admission and business-time calculations are pure/versioned; model output is proposal-only. |
| VI. Hermes/exact approvals | PASS — TriageAssessment stays separate and stale-aware; Lead controls and WIP/EXPEDITE actions use exact commands/Approval and current authorization. |
| VII. Human verdict | PASS — queue state neither infers nor signs Session Outcome/Verdict; technical automation still stops at human review. |
| VIII. Evidence/target snapshot | PASS — Feature 006 reads immutable QA evidence/session refs but does not mutate signed manifests or target snapshots. |
| IX. Reliability/audit | PASS — projection consumers are idempotent/rebuildable; mutations pin request keys, expected versions, policy refs, actor and audit provenance. |
| X. Integrations/local-first | PASS — required tests use existing stateful Jira/GitLab/Mattermost mocks; outages change freshness/availability, not accepted authority. |
| XI. Versioning/compatibility | PASS — contracts and policies are additive/versioned; owner migrations are schema-only, followed by gated runtime bootstrap/reconciliation and validation with historical pins preserved. |
| XII. Production boundary | PASS — the feature performs no deployment, production test or release decision; no new connector effect is introduced. |

Gate result: **PASS**. No exception or complexity waiver is required.

## 5. Architecture and ownership

### 5.1. Bounded ownership

| Owner | Owns in Feature 006 | Must not own |
|---|---|---|
| Platform Core | Queue stage rules, policy/calendar versions, accepted service class and order controls, WIP admission/claims, SLA clock, portfolio authorization contract, generic events | QA DoR/session semantics, Jira REST/status mutation, model inference |
| QA Competency Pack | Additive outer `competency-qa@1.3.0` and inner `qa.validation@1.3.0` manifests, QA queue-fact contribution, TriageAssessment `1.1.0`, required-capability and execution-activity facts, queue UI extension | Workspace authorization truth, Jira priority/due, generic SLA clock |
| Core persistence adapter | Scoped policy/control/clock/claim/projection rows, locks, constraints, rebuild checkpoints and atomic Core UoWs | QA semantic evaluation or Connector calls |
| QA persistence | Append-only QA queue-fact revisions sourced from current readiness/session/automation state | Accepted queue order, Workspace capacity or SLA authority |
| Runtime composition | Joins versioned source facts, runs projection/rebuild workers, composes exact admission UoWs and emits notifications | New business authority or provider-specific DTOs |
| API/UI | Pre-authorized projections, explanation facets, exact commands and conflict results | Client-calculated authorization, hidden-item counts, direct model/Connector calls |
| Hermes | Schema-valid TriageAssessment and notification proposal using scoped facts | Business priority, accepted service class/order, SLA clock, WIP admission, assignment |

### 5.2. Source-of-truth separation

| Concern | Authority |
|---|---|
| Jira status/priority/due/assignee | Latest confirmed operational projection from Feature 003 |
| Candidate/Draft lifecycle | Platform Core Feature 004 aggregates |
| DoR/readiness and Session state | QA Pack current immutable revisions |
| Technical automation activity | QA Feature 005 Attempt/Session facts |
| Queue stage/rank/SLA/WIP view | Rebuildable Platform Core projection |
| Accepted service class/manual order | Versioned HUMAN queue-control revision |
| Recommendation | QA-owned TriageAssessment, never automatically accepted |
| Calendar/WIP/SLA settings | Published Workspace queue policy/calendar versions |

## 6. Deterministic queue model

### 6.1. Stage precedence

The closed top-level stage is derived with this precedence:

1. an effective pending/snoozed Candidate or a pre-acceptance Draft not yet linked
   to a confirmed Work Item is `CANDIDATE`, with subject kind/detail preserved;
2. a Work Item whose confirmed Jira normalized status is `DONE` or `CANCELLED`
   is `COMPLETED`;
3. a Work Item with a started Session in `RUNNING`, `REVIEW_REQUIRED` or
   post-start `BLOCKED`, or with confirmed Jira active/review/blocked state, is
   `ACTIVE` and carries an explicit activity-origin/inconsistency facet;
4. a Work Item is `READY` only when confirmed Jira status is `READY | PLANNED`,
   current QA readiness is `READY | READY_WITH_WAIVER`, and no active Session fact
   exists; `PLANNED` is exposed as committed detail;
5. every other accepted Work Item is `BACKLOG` with a stable reason such as
   `NEEDS_INFO`, `OPERATIONAL_PENDING`, `SYNC_ERROR`, `READINESS_STALE` or
   `COMPLETION_PENDING`.

Session `PLANNED`/`READY` is shown as a committed substate but does not by itself
move a Work Item into Active. Jira status and platform queue stage are always
returned as separate fields.

### 6.2. Explainable ordering

An unfiltered response first partitions entries in the closed display order
`CANDIDATE`, `BACKLOG`, `READY`, `ACTIVE`, `COMPLETED`; that partition is a view
layout, not a cross-stage business-priority claim. Candidate/Draft rows form a
separate Candidate Inbox ordered by returned `(enteredInboxAt, subjectKind,
subjectId)` components. They never acquire an accepted service class or a manual
order override.

Within each accepted Work Item stage, the comparator emits and returns, rather
than hides, the ordered components:

1. accepted service class (`EXPEDITE`, `FIXED_DATE`, `STANDARD`);
2. deterministic SLA state plus a returned `urgencyTiming` tagged union. It uses
   the earliest applicable exact instant among the first-start goal's
   latest-safe-start, an active SLA target and confirmed Jira due-date end in the
   pinned Workspace timezone; equal instants use that listed basis order and every
   value carries its exact source ref;
3. confirmed Jira priority component;
4. HUMAN-confirmed risk and business-impact components;
5. HUMAN-confirmed dependency-readiness component, with unknown explicit until
   accepted;
6. versioned working-time READY aging band; the returned raw business seconds are
   an explanation sampled at `calculatedAt`, not a continuously mutating sort key;
7. `readyAt`;
8. Jira display key and Work Item ID as stable tie-breakers.

Effort appears as planning metadata only. Triage confidence never becomes a sort
or authorization input. Project-local and portfolio order are computed from the
same `queue-order@1.0.0` page comparator and its stage-specific branch; an active
Lead override is a visibly separate page-item component with reason, expiry and a
deterministic view-local ref, not a rewritten priority or canonical QueueEntry
field. An anchor is resolved after authorization filtering and before Approval
creation. Missing and hidden anchors produce the same terminal
`ANCHOR_UNAVAILABLE_NO_OP` safe candidate; the raw key remains only in private
audit evidence and cannot create an unreadable pending Approval. Its consumed
receipt uses a `QUEUE_ACTION_CANDIDATE` result ref equal to
`(actionId, version=1, publicIntentHash)`; there is no public ref to the private
raw-anchor audit witness.

### 6.3. Projection consistency

Source events enqueue project-scoped invalidations. The worker claims them through
the existing durable inbox, re-reads all current local facts, computes one canonical
input hash and upserts the current projection while appending history. Duplicate
events with the same input hash are no-ops. A bounded scheduled rebuild scans by
Workspace/Project cursor and repairs missed, reordered or older projections.

The Workspace rebuild-generation ID and its counters remain internal. A public
QueueEntry is identified only by its own exact `(queueEntryId, revision,
semanticHash, inputFingerprint)` tuple. QueuePage `projectionGeneration` is the
SHA-256 of canonical `(authorizedProjectSetHash, comparatorRef,
sorted[projectId, projectVisibleSetHash])`, where each Project hash covers only its
unsuppressed QueueEntry tuples effective at page `asOf`. A rebuild or change
confined to a forbidden Project therefore cannot change a visible token, ETag,
order head, cursor or timing outcome.

Each QueuePage, QueueEntry and authorized capacity response uses a strong quoted
SHA-256 of its exact JCS representation as ETag. For pages this necessarily binds
the fixed server `asOf`, normalized filters, page/cursor boundary, authorized
generation and effective order state; the internal Workspace generation/capacity
head never participates.

Reads never call Jira, GitLab, Mattermost or a model. `CURRENT | STALE | ERROR |
REBUILDING` and source freshness are visible. Stale data is never silently promoted
to an accepted value.

Queue-page composition binds the outer route/scope to every entry after
authorization filtering. Project pages contain only the path Project; portfolio
entries belong to the exact authorized Project set. Visible totals equal the five
stage counts over the full filtered snapshot, while page ordinals are unique exact
positions in the full effective order. Base-set and generation hashes are
recomputed over precisely those authorized rows before serialization.

## 7. Capacity and admission

### 7.1. Human WIP unit

Workspace human WIP counts distinct Work Items, not Sessions or Attempts. A claim exists
when at least one MANUAL Session is `RUNNING | REVIEW_REQUIRED`, an AUTOMATED
Session is `REVIEW_REQUIRED`, or a confirmed external active state is configured
to consume human WIP. An AUTOMATED pipeline in `RUNNING` consumes provider runner
capacity from its GitLab binding but not human WIP. Its explicit launch does,
however, acquire one separately visible `REVIEW_CAPACITY_RESERVATION` per Work Item;
admission headroom is the union of occupied and reserved Work Items, without
double-counting a Work Item already occupied.

Multiple consuming Sessions on one Work Item produce one claim with a source-set
hash. A post-start mapped external block may release the claim only when the pinned
policy explicitly maps its Jira-owned reason to `RELEASE_WIP`; the item remains in
Active with the pause/release reason visible.

### 7.2. Hard admission and unavoidable facts

Every HUMAN command that can increase human WIP or future review commitment locks
the Workspace capacity head, recomputes current claims/reservations from
authoritative local rows, validates the pinned policy and either commits the
Session/control mutation with its claim or review reservation, or commits only a
denial decision. Normal starts above an enforced hard limit are denied. A terminal
automated result atomically converts its reservation into an occupied review claim;
cancellation before review releases it.

The immutable admission contract correlates activity and committed refs: manual
start/resume writes Session+claim, automated launch Session+reservation, result
review conversion exactly Session+reservation+claim, result cancellation exactly
Session+reservation, external Jira only claim revisions, and
SET/CLEAR/EXPIRE EXPEDITE exactly one queue-control revision. Admitted outcomes
contain only soft warnings; denial requires a blocker; hard-limit override is
ENFORCED-only, and MEASURE_ONLY cannot report hard/global-overflow violations.

A blocked manual Session resumes to its exact persisted `blockedFrom` milestone.
If `RELEASE_WIP` removed the claim, the admission/override effect may therefore
request `RUNNING` or `REVIEW_REQUIRED`; the latter is legal only for
`MANUAL_SESSION_RESUME` and must equal the pinned Session revision. Starts and
automated launches always request `RUNNING`.

An exact `WIP_ADMISSION_OVERRIDE` action pins policy version/hash, Work Item/session version,
current claim/reservation-set hash and counts, requested effect, expiry and
idempotency key. It is
consumed only after a currently authorized QA Lead distinct from the initiating
HUMAN decides it, and cannot authorize a different start or a later state.
The denial creates that candidate only when the original schema-closed request
contains `overrideIntent {reason, expiresAt}` and policy permits escalation;
otherwise the denial is the sole stored result.

Every approval-bearing queue action stores two same-ID documents: a complete safe
`queue-action-candidate@1.0.0`, whose content hash equals Approval v2 `payloadHash`
and the public receipt hash, and a private `queue-control-action@1.0.0` execution
witness binding global capacity and authorization state. Core's additive Approval
v2 PLATFORM_ACTION branch forbids fabricated Connector refs and returns only
Project-facet or exact authorized-set scope witnesses. Full initiator/approver
authorization bases and the internal `actionHash` stay private and are rechecked
under the mutation lock.

Receipts are closed by endpoint and lifecycle: control routes expose only
control/EXPEDITE action kinds, order routes only order actions, and `resultRef` is
absent until `CONSUMED`. The consumed result family is fixed by action kind:
control revision, order revision/self-candidate no-op, or capacity-admission
decision for EXPEDITE/WIP admission actions. Non-consumed lifecycle states require
the exact Approval ref; composed validation resolves the same public candidate and
checks action kind, public hash, expiry, approval requirement and Approval target.

External Jira observations and automated terminal results are facts and cannot be
rejected or rolled back to protect a counter. A normal automated result consumes
its reservation and stays within committed headroom. If a result or external state
arrives without a valid reservation and creates occupancy above the limit, the
ledger records `NON_DISCRETIONARY_OVERFLOW`, blocks further discretionary starts
and alerts the Lead. This is not an implicit override.

Project limits/reservations remain warnings and planning signals. They never grant
access, weaken the Workspace hard limit or prevent authoritative result ingestion.

## 8. SLA and calendar

### 8.1. Start, pause and stop

The first accepted observation that confirms a configured Jira-owned start status
(pilot default: normalized `READY`) creates the SLA clock and pins exact policy,
calendar and status-mapping refs. `confirmedAt` from the platform monotonic clock is
the start; a local readiness recommendation or queued Jira command cannot backdate
it. This Jira-owned start occurs even if current DoR is missing, in which case the
item remains Backlog with `JIRA_READY_WITHOUT_CURRENT_DOR`. Provider timestamps are
retained separately for sync-lag diagnostics.

Rollout does not turn an old provider timestamp or unchanged reducer result into a
new operational revision. For an item already in the start state, a gated verifier
performs an authoritative Jira read and persists one immutable
`sla_rollout_authority_verifications` receipt per Work Item/goal/policy-enable
epoch. Even when Feature 003 reduces the read as `DUPLICATE`, the matching receipt
may start the clock once at its new platform `confirmedAt`; mismatch/outage leaves
`ROLLOUT_CONFIRMATION_REQUIRED` and never rewrites operational history.

Only confirmed mapped status/reason changes open or close append-only RUNNING and
PAUSED segments. Unknown reasons fail closed as running unless policy explicitly
maps them; no model text can pause time. A policy enables one or both closed goals:
`READY_TO_FIRST_QA_START`, stopped by the first accepted consuming Session start,
and `READY_TO_SIGNED_VERDICT`, stopped only by an exact signed QA Verdict. Jira
terminal state remains a separate operational completion/consistency fact and does
not fabricate goal satisfaction. New policy revisions do not reinterpret an
already-started clock.

### 8.2. Business-time calculation

The pinned calendar contains a tzdb-resolved IANA identifier (including `UTC`),
non-overlapping weekly intervals and dated closures/working overrides with unique
local dates across both variants. Conflicting same-date entries are rejected; no
precedence is inferred. An
exclusive `24:00:00` end is valid only to express the first half of a midnight
split. Calculation uses instants internally; DST gaps and overlaps are resolved by
the versioned calendar algorithm and golden vectors.
Elapsed and remaining working milliseconds are derived from immutable segments.

`MEASURE_ONLY` returns elapsed time plus `targetState=NOT_CONFIGURED`. `ENFORCED`
returns `ON_TRACK | AT_RISK | BREACHED | COMPLETED` from exact target and warning
thresholds. Hermes may explain or request a deduplicated NotificationIntent, but
does not write the clock, due date or priority.

An SLA read uses server-selected `asOf` only. `clockRevisionRef` identifies the
stored immutable transition revision, while `evaluationHash` covers the complete
read-time snapshot without itself. The item endpoint returns exactly one snapshot
for each distinct goal enabled by the current authorized Project policy facet;
before publication it deterministically returns both closed v1 goals as
`NOT_STARTED/POLICY_NOT_PUBLISHED`. Every item repeats the path scope and the
response uses one shared `asOf`.
For a started clock, all duplicated immutable fields must equal the resolved
transition, including scope, goal/cycle, pins, sources and transition state/time.
Provider observation time is copied from the resolved start authority, while
target/warning configuration is copied from the pinned policy goal and all risk,
remaining-time and target-instant fields are derived from those exact inputs; a
read DTO cannot assemble a clock from unrelated valid revisions. Threshold emissions carry `slaClockId` plus
that exact clock-revision ref; they never call the dynamic read DTO a revision.

Clock creation/transition computes the next policy-significant instant: an SLA
warning/breach or READY aging-band boundary. A bounded Core worker claims due rows
from PostgreSQL, recalculates with the pinned calendar, appends any semantic queue/
clock transition and creates each threshold NotificationIntent once. The durable
due index and sweep are truth; BullMQ is only a wake-up accelerator, and startup
recovery scans overdue rows. Thus queue state cannot age only on an unrelated
source event, while there are no per-second tick writes. Queue pagination fixes a
server `asOf` and reads immutable revisions/effective controls at that instant;
current authorization is still re-evaluated on every page.

The public threshold payload references an intent by ID plus a `creationHash`
over its immutable creation tuple. It never publishes the mutable
NotificationIntent `rowVersion`, delivery state or attempts, so the emitted ref
remains resolvable after delivery progresses.

## 9. APIs, events and contracts

Phase 1 publishes:

- [OpenAPI queue API](contracts/openapi/queue-triage-capacity-sla-api.v1.yaml)
  for portfolio/project lanes, item detail, capacity/SLA reads, policy reads and
  exact control/admission commands;
- [additive Core Approval API 1.1](contracts/openapi/core-approval-api.v1.1.yaml)
  for the existing scoped routes returning frozen subject v1 or safe subject v2;
- JSON Schemas for queue policy/calendar, queue entry, capacity snapshot/admission,
  SLA read snapshot/immutable clock transition/threshold emission, public queue-action candidate, private
  queue-control witness, Approval subject v2, queue-stage transition, durable
  queue-order invalidation, QA queue-fact invalidation, the existing
  automated-Session-ready payload and TriageAssessment `1.1.0`;
- [AsyncAPI queue events](contracts/asyncapi/queue-triage-capacity-sla-events.v1.yaml)
  for projection, stage, control, admission, WIP and SLA transitions;
- [contracts/README.md](contracts/README.md) and
  [capabilities.md](contracts/capabilities.md) defining authorization, ownership,
  idempotency and compatibility rules.

Event emission is stream-safe: a QueueEntry revision produces exactly one of
`queue.control.changed` (control-caused) or `queue.projection.updated` (all other
causes) on the same channel. A capacity decision produces exactly one of
`capacity.over-limit-detected` (only non-discretionary overflow) or
`capacity.admission.decided`. Stage/invalidation/projection events use distinct
durable identities, so valid companion events do not collide in version cursors.

Feature 006 registers an additive contract contribution at order `600` and two
explicit identities: outer Competency Pack `competency-qa@1.3.0`
(`qaCompetencyManifestV13` extends `qaCompetencyManifestV12`) and inner Work Type
`qa.validation@1.3.0` (`qaValidationWorkTypeDefinitionV13` extends its V12 object).
The inner definition adds the queue Work Item UI action while copying V12 connector
capability requirements unchanged. The outer manifest points at that definition,
replaces only the six inherited automation-event declarations whose V12 entries
incorrectly use the generic QA events schema with their already-published Feature
005 payload refs/digests, and appends exact declarations for
`qa.triage-assessment.created`, `.stale`, `qa.automated-session.ready` and
`qa.queue-facts.changed`. Core contribution 600,
not the QA manifest, owns new `queue.*` operation/permission declarations; the
existing `qa.session.execute` authority remains unchanged. Every schema digest is
SHA-256 over RFC 8785/JCS bytes of the parsed JSON document. Existing published
001–005 schemas and both serialized QA V12 objects/digests remain byte-identical.

The ready-event declaration also closes a physical legacy gap. Future writes from
`automated-session.uow.ts` use the canonical EventEnvelope with the registered
payload ref/digest. A bounded compatibility reader validates pre-006 raw eight-
field READY rows through a payload-only internal path, proves the trusted outbox
scope/type and invokes the same local projector input. It never fabricates missing
producer, actor, classification, correlation, causation or entity-version fields,
never claims EventEnvelope validity and never rewrites/republishes old rows.
Contract tests validate actual persisted new envelope bytes and exercise legacy
record replay separately from canonical-envelope validation.

For every canonical event, a composed envelope-binding validator runs in both
producer and consumer before inbox sequencing. It requires envelope scope, entity
ID/version, occurrence time and any duplicated correlation/causation/recorded time
to equal the payload's durable identity table in `contracts/README.md`. Mismatch
is quarantined without advancing an aggregate cursor; mutation vectors cover every
duplicated field.

## 10. Persistence and migrations

Planned monotonic additions:

| Order | Owner | Purpose |
|---|---|---|
| Core `0130` | Platform Core | Workspace queue-policy/calendar headers, immutable source revisions, non-disclosing policy view/facet projection heads and authorized-scope membership rows |
| Core `0135` | Platform Core | Queue input/projection history, current entries, rebuild generations, SLA clocks/segments and rollout-authority verification receipts |
| Core `0140` | Platform Core | Public/private queue-action pairs, controls, order-scope/membership and order-invalidation revisions, capacity heads plus authorized-scope projections/membership, claims/reservations and admission decisions |
| QA `2070` | QA Pack | Append-only QA queue-fact revisions and current pointer/indexes; no duplicate queue authority |

The SQL migrations are schema/constraint/index changes only. Core migrations do
not read QA tables: on a fresh install Core `0130`–`0140` necessarily run before
QA `2070`. After both owner registries complete, a feature-gated runtime projection
bootstrap derives current Work Item projections from confirmed facts into a shadow
generation. It creates no SLA history, accepted control, human-WIP claim or review
reservation and never guesses an old READY timestamp.

Before any `ENFORCED` admission command is enabled, a separate checkpointed
current-state capacity reconciliation runs under the Workspace capacity lock. It
may create claims/reservations that represent exact current Session, automation or
configured external facts and records `NON_DISCRETIONARY_APPLIED` or
`NON_DISCRETIONARY_OVERFLOW`; it never reconstructs historical occupancy. The
Workspace remains `MEASURE_ONLY`/`REBUILDING` and capacity-increasing commands fail
closed until projection bootstrap, reconciliation and validation complete.
PostgreSQL 17/18 fresh, upgrade, repeat, current-minus-one and failed-migration
recovery are mandatory.

## 11. Project structure

```text
specs/006-queue-triage-capacity-sla/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── README.md
    ├── capabilities.md
    ├── openapi/{queue-triage-capacity-sla-api.v1,core-approval-api.v1.1}.yaml
    ├── asyncapi/queue-triage-capacity-sla-events.v1.yaml
    ├── examples/{positive,negative}/*.json
    ├── examples/README.md
    └── schemas/*.schema.json

packages/platform-core/src/work-management/
├── queue-stage.ts
├── queue-ordering.ts
├── queue-policy.ts
├── capacity-admission.ts
├── sla-clock.ts
└── queue-query-ports.ts

packages/platform-core/src/approval/
├── approval-subject-v2.ts            # additive parser/hash/constructor
└── queue-action-consumer.ts           # same-ID candidate/private witness gate

packages/platform-persistence-typeorm/src/
├── queue-policy.repository.ts
├── queue-projection.repository.ts
├── queue-control.repository.ts
├── queue-order-invalidation.repository.ts
├── queue-action-candidate.repository.ts
├── authorized-scope-membership.repository.ts
├── capacity-scope-projection.repository.ts
├── capacity-admission.repository.ts
├── sla-rollout-verification.repository.ts
├── sla-clock.repository.ts
└── migrations/core/{0130,0135,0140}-*.ts

packages/competency-qa/src/
├── manifest-v1.3.ts
├── index.ts / node.ts                 # additive V13 exports; V12 untouched
├── application/{domain-events,queue-facts}.ts
├── domain/triage-assessment.ts
├── persistence/{automated-session.uow,queue-fact.repository}.ts
├── persistence/migrations/2070-qa-queue-facts.ts
├── skills/qa-triage.ts
└── ui/{queue-workspace,queue-item}.tsx

packages/runtime-composition/src/queue/
├── composition.ts
├── projection-worker.ts
├── projection-rebuild.ts
├── temporal-transition-worker.ts
├── sla-rollout-verifier.ts
├── qa-fact-projector.ts
├── admission-service.ts
├── portfolio-query.ts
├── sla-notifications.ts
└── observability.ts

apps/api/src/extensions/queue/
├── queue.controller.ts
├── queue-controls.controller.ts
└── queue-policies.controller.ts

apps/web/src/routes/qa/queue-workspace.tsx
tests/{unit,contract,integration,e2e,architecture}/006/
tools/{ci,verification,smoke,local}/feature-006-*.mts
reports/006-queue-triage-capacity-sla/
```

**Structure decision:** reuse the current monorepo and API/worker/web units. Generic
queue semantics stay in Platform Core; QA contributes typed facts and UI; runtime
composition supplies cross-package UoWs. No new package or service is necessary.

## 12. Validation strategy

1. Contract and schema tests prove closed enums, RFC 8785 registry/semantic hash
   boundaries, offline `$ref` resolution, positive/negative examples, both V13
   manifest identities, the complete contribution-600 `$id` catalog and both
   OpenAPI documents. They validate actual ready-event envelope bytes and the
   payload-only legacy path separately; no fabricated envelope is accepted.
2. Pure unit matrices cover every stage precedence combination, comparator field,
   DST/calendar vector, SLA pause transition, WIP source set and stale assessment.
3. PostgreSQL concurrency tests race starts, releases, EXPEDITE/service-class and
   order overrides under `SERIALIZABLE` plus Workspace capacity-head locking;
   they also prove durable authorized-scope capacity and Project-lane order-
   invalidation refs, with no Project-event fan-out for portfolio-only changes.
4. Security tests prove authorization-before-aggregation for rows, counts, facets,
   cursors, exports/telemetry and background jobs across entitled/forbidden Projects.
5. Integration tests cover duplicate/out-of-order source events, rebuild equality,
   v1/v2 Approval read/decision compatibility, candidate/private-witness mapping,
   unavailable-anchor terminal no-op, Jira rollout reads that reduce to
   `DUPLICATE`, model/Mattermost/GitLab outage, policy drift and restart recovery.
6. Browser/E2E journeys independently validate US-001 through US-005 with a
   visible explanation of Jira state, queue stage, freshness, WIP and SLA.
7. Final evidence binds spec/plan/research/data model/contracts/tasks, exact source
   digest, migration matrix, security results and generated reports.

## 13. Phase outputs and sequencing

Phase 0 produces [research.md](research.md) with all choices resolved. Phase 1
produces [data-model.md](data-model.md), [contracts/](contracts/) and
[quickstart.md](quickstart.md). Implementation ordering is:

1. prerequisite/governance and offline contract gates;
2. Core policy/calendar and pure stage/order/SLA/WIP reducers;
3. schema-only Core/QA migrations, then deterministic runtime projection bootstrap
   and current-state capacity reconciliation;
4. QA queue-fact and TriageAssessment `1.1.0` compatibility;
5. projection/rebuild worker, SLA rollout verifier and pre-authorized query path;
6. additive Approval v2 runtime, public/private exact controls, capacity admission
   and Session-start integration;
7. SLA notifications, order-invalidation projection, UI and multi-project browser journeys;
8. migration/security/observability/smoke/final evidence gates.

`tasks.md` is intentionally not created by this planning command; it belongs to
the later `speckit-tasks` phase.

## 14. Constitution check — post-design gate

The Phase 1 design must re-run every row from section 4 against concrete schemas,
tables and operations. Passing requires, at minimum:

- no queue response, cursor, count or metric can disclose a forbidden Project;
- no hidden-only policy/capacity/rebuild/order change can advance a visible ref,
  ETag, freshness value or Approval candidate hash;
- no queue/SLA record can replace a Jira-owned field or start before confirmed
  Jira state;
- no model/TriageAssessment field can authorize, rank as accepted truth or mutate
  priority/due/service class/order;
- no stale projection is used for a capacity-increasing mutation;
- every override is exact, versioned, authorized, idempotent and audited;
- public PLATFORM_ACTION approvals expose neither global action witnesses nor
  initiator/approver entitlement, membership or role-assignment record IDs;
- every persisted record/job has Workspace+Project scope where project content is
  involved;
- local acceptance requires no corporate network or credentials.

Post-design result: **PASS**. The detailed schemas and transaction invariants in
[data-model.md](data-model.md) satisfy these conditions; no constitutional
exception is introduced.

## 15. Complexity tracking

No constitutional violation requires justification. The only deliberate
cross-package transaction is Session-start/capacity admission within the existing
single PostgreSQL deployment; it is required to make the hard WIP check atomic and
does not create a new distributed boundary.
