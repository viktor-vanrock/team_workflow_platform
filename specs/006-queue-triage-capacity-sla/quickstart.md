# Quickstart validation: queue, triage, capacity and SLA

**Feature:** `006-queue-triage-capacity-sla`

**Required contour:** `qa-jira-gitlab-mattermost-local`

**Scope:** local acceptance contract for US-001 through US-005. The
contour uses the real API, worker, PostgreSQL and Redis processes together with
the additive outer `competency-qa@1.3.0` and inner `qa.validation@1.3.0`
contracts (over their existing V12 baselines), Jira,
GitLab and Mattermost modules in Mock Hub. It must remain closed to external
network access.

> **IMPLEMENTED THROUGH LOCAL ACCEPTANCE:** Feature 006 contracts, story
> checkpoints, all 57 scenarios, the isolated contour, PostgreSQL 17/18 matrix,
> browser journey and full-process smoke are executable. Final aggregate
> acceptance remains fail-closed until the Feature 002–005 compatibility and
> evidence-digest gates pass; a historical report is never sufficient.

The generic repository install command and existing Feature 002–005 evidence
commands are compatibility prerequisites rather than Feature 006 evidence. The
Feature 006 quickstart verifier rejects undocumented
scenarios, stale or edited reports, source/contract/migration drift and a
different contour.

See [data-model.md](data-model.md) for entities and invariants,
[contracts/](contracts/) for wire contracts, [research.md](research.md) for
resolved choices and [plan.md](plan.md) for ownership and implementation order.

## 0. Prerequisites and blocking entry gate

Run the future guide from the repository root with the versions pinned by the
repository: Node.js `24.20.x`, pnpm `11.21.x`, Docker/Compose and enough local
resources for API, worker, web, PostgreSQL 17/18 test containers, Redis, S3Mock,
fake OIDC and Mock Hub. No corporate VPN, cloud account, provider credential or
production endpoint is allowed.

Dependencies must be available from the frozen lockfile. Runtime acceptance is
offline; dependency provisioning itself may use an approved package cache before
the contour is started.

```bash
# Compatibility prerequisites; these do not by themselves validate Feature 006.
corepack pnpm install --frozen-lockfile
corepack pnpm verify:002
corepack pnpm verify:003:evidence
corepack pnpm verify:004:evidence
corepack pnpm verify:005:evidence

# Implemented fail-closed entry checks.
corepack pnpm verify:006:prerequisites
corepack pnpm verify:006:governance
```

The entry gate must prove all of the following before any Feature 006
story gate is allowed to run:

- Features 003, 004 and 005 have fresh `PASS` evidence bound to the current
  source, task, runtime, contract and migration digests, including Feature 002
  compatibility; a historical `PASS` file is not sufficient;
- Jira status, priority, due date and assignee still come only from a confirmed
  Feature 003 operational projection;
- Candidate/Draft, QA DoR, MANUAL Session and AUTOMATED sticky
  `REVIEW_REQUIRED` semantics remain compatible with Features 002, 004 and 005;
- published migrations through Core `0120` and QA `2060` remain immutable,
  registered and repeat-safe;
- Feature 006 contract contribution order is `600`, all `$ref` values resolve
  offline and published Feature 001–005 artifacts remain byte-identical;
- the only accepted runtime contour is `qa-jira-gitlab-mattermost-local`, with
  external egress denied before credential resolution or adapter invocation;
- absent baseline or numeric pilot inputs select `MEASURE_ONLY` or
  `SKIPPED_GATED`; they never produce guessed WIP/SLA values or an `ENFORCED`
  `PASS`.

## 1. Validate contracts and deterministic core

```bash
# Implemented offline validation.
corepack pnpm test:contract:006
corepack pnpm test:architecture:006
corepack pnpm test:unit:006
```

Expected evidence:

- JSON Schema 2020-12, OpenAPI 3.1 and AsyncAPI 3.0 documents parse with only
  offline refs, closed enums and positive/negative examples;
- queue stage, ordering, WIP accounting and business-calendar/SLA reducers are
  deterministic and do not import Connectors, persistence, network or model
  clients;
- Platform Core owns queue/policy/WIP/SLA semantics, QA owns readiness,
  Session and triage facts, Connectors own provider facts, and runtime
  composition performs the cross-package unit of work;
- `TriageAssessment@1.1.0` is additive to the byte-identical `1.0.0` contract
  and remains proposal-only; its base schema keeps new evidence fields optional,
  while the `qa-triage@1.1.0` output profile requires them;
- the ordering contract exposes lexicographic components and contains no
  weighted or opaque total score;
- queue-page/item/capacity ETags are strong quoted hashes of the exact returned
  representation. Page hashes include the fixed server `asOf`, normalized filters,
  cursor boundary, authorized generation and effective order state; two different
  bodies can never share a validator;
- public exact commands accept only tokens obtainable from authorized reads plus
  request key/reason; stored actions bind the server-derived canonical request
  hash, actor and authorization basis;
- Workspace policy reads use an independent neutral view ref; Project/SLA and
  authorized-capacity projections use separately persisted safe facet refs. A
  source publication that changes only a hidden Project cannot change another
  caller's body, hash or ETag;
- non-recursive hash tests omit each documented self-ref/hash field, resolve every
  returned projection/revision ref after restart and distinguish immutable SLA
  clock revision hashes from dynamic read evaluation hashes;
- scope-projection tests persist and re-hash the exact Project membership for every
  authorized policy/capacity or portfolio-order head. A changed Project advances
  only existing heads that contain it; a no-head order read performs no write, and
  no projector reverses a set hash or enumerates entitlement combinations;
- the AsyncAPI transport mirror stays field-for-field equal to canonical Feature
  001 EventEnvelope v1 and every payload ref pins its exact RFC 8785/JCS registry
  digest of parsed JSON, never raw source-file bytes. Per-event negative vectors
  independently alter envelope Workspace, Project, entity ID/version, occurrence/
  recorded time, correlation and causation; every mismatch is quarantined before
  inbox sequencing and advances no aggregate cursor.

## 2. Start one offline local contour

```bash
# Implemented isolated contour commands.
corepack pnpm local:queue:up
corepack pnpm local:queue:status
corepack pnpm local:queue:migrate
corepack pnpm local:queue:seed
corepack pnpm queue:scenario -- --list
corepack pnpm queue:scenario -- setup-portfolio
corepack pnpm queue:scenario -- external-network-denied
```

The status and setup evidence must show:

- exact contour name `qa-jira-gitlab-mattermost-local` and external network mode
  `deny`;
- healthy API, worker, web, PostgreSQL, Redis, S3Mock, fake OIDC and Mock Hub;
- stateful outer `competency-qa@1.3.0` and inner `qa.validation@1.3.0`, plus
  byte-identical V12 pack/work-type manifests, Jira, GitLab and Mattermost
  modules, without a new queue mock or schema owner;
- the V13 event declarations correct all six inherited automation entries to the
  exact Feature 005 refs/digests already used by emitters, then pin both Feature
  004 triage payloads, the closed automated-Session-ready payload and queue-facts
  invalidation. No event type is duplicated and the generic QA events schema is
  forbidden for automation. A newly committed
  ready row validates as canonical EventEnvelope; a seeded immutable legacy raw
  row replays once through a payload-only compatibility path and is neither
  rewritten nor republished. The legacy path validates its exact payload and
  trusted row scope/type but cannot synthesize missing envelope fields or claim
  EventEnvelope validity;
- at least Projects `A` and `B` entitled to the QA Lead fixture plus Project
  `C` forbidden to it; all three contain deliberately interleaved queue facts;
- current Candidate/Draft, Jira, readiness, Session, Attempt, calendar and
  policy fixtures identified by immutable refs/hashes;
- one published `MEASURE_ONLY` policy and one publishable but initially inactive
  `ENFORCED` policy whose numeric values are fixture data backed by immutable
  baseline evidence;
- an open-ended policy calendar plus finite rejection fixtures, a deterministic
  virtual clock and calendars containing normal weeks, closure,
  working override, midnight, leap-day and DST vectors;
- zero configured production endpoints and zero real provider credentials.

Every scenario selection and fault must be durable in local PostgreSQL. Restarting
Mock Hub or the worker must not silently consume or erase an unobserved scenario.

## 3. US-001 — distinct queue stages

```bash
# Implemented US1 scenarios and checkpoint.
corepack pnpm queue:scenario -- us1-candidate-has-no-operational-effects
corepack pnpm queue:scenario -- us1-confirmed-needs-info-backlog
corepack pnpm queue:scenario -- us1-dor-and-pending-jira-remain-backlog
corepack pnpm queue:scenario -- us1-confirmed-jira-ready-starts-clock
corepack pnpm queue:scenario -- us1-first-required-session-consumes-wip
corepack pnpm queue:scenario -- us1-completed-precedence
corepack pnpm verify:006:us1
```

Evidence must prove the closed precedence rather than infer a second workflow:

1. An effective Candidate or pre-link Draft is `CANDIDATE`. It has no Jira
   issue, SLA clock, human-WIP claim or review-capacity reservation.
2. A confirmed Jira-bound Work Item without current DoR is `BACKLOG` with an
   explicit reason such as `NEEDS_INFO`; it is neither Ready nor WIP.
3. Human DoR confirmation and a queued Jira transition command do not start the
   SLA and do not fabricate Jira state. Until an authoritative webhook/read is
   applied, the last confirmed Jira status remains visible with freshness.
4. A newly applied confirmed Jira `READY` (or policy-mapped Jira-owned start
   state) starts an SLA clock at platform `confirmedAt`. With current DoR and no
   active Session the Work Item becomes `READY`; without current DoR the clock
   still starts but the queue remains `BACKLOG` with
   `JIRA_READY_WITHOUT_CURRENT_DOR`.
5. The first required MANUAL Session admitted into `RUNNING` moves the Work Item
   to `ACTIVE` and creates one human-WIP claim. Session `PLANNED`/`READY` alone
   does neither.
6. Confirmed Jira `DONE` or `CANCELLED` has completion precedence and produces
   `COMPLETED`; raw Jira status and derived queue stage remain separate response
   fields throughout.

The report must include the exact source-fact refs, canonical input hash, stage
rule/comparator versions, prior/current projection versions and WIP/SLA effects
for every transition.

## 4. US-002 — project lanes and entitled portfolio

```bash
# Implemented US2 scenarios and checkpoint.
corepack pnpm queue:scenario -- us2-project-lanes-and-portfolio
corepack pnpm queue:scenario -- us2-comparator-tie-breakers
corepack pnpm queue:scenario -- us2-forbidden-project-interleaved
corepack pnpm queue:scenario -- us2-hidden-anchor-no-existence-signal
corepack pnpm queue:scenario -- us2-overlapping-order-views
corepack pnpm queue:scenario -- us2-order-invalidation-ref
corepack pnpm queue:scenario -- us2-portfolio-order-no-project-fanout
corepack pnpm verify:006:us2
```

Evidence must prove:

- an unfiltered page first uses the closed display partition `CANDIDATE`,
  `BACKLOG`, `READY`, `ACTIVE`, `COMPLETED`; Candidate/Draft rows expose and use
  only `(enteredInboxAt, subjectKind, subjectId)` and never receive a fabricated
  Work Item priority or manual-order control;
- within each accepted Work Item stage, each Project lane and the portfolio use
  the same versioned lexicographic comparator: accepted service class;
  SLA state plus returned `urgencyTiming` (the earliest exact latest-safe-start,
  active SLA target or confirmed Jira due-date end, with stable basis tie-break
  and source ref); confirmed Jira priority; HUMAN-accepted risk and business
  impact; dependencies; working `READY` age; `readyAt`; Jira display key; Work Item
  ID;
- effort is visible planning metadata but never business priority; unknown
  values occupy explicit stable buckets and no AI confidence or scalar changes
  authorization/order;
- READY age ordering uses the versioned aging band. Raw working seconds are
  explanatory at QueueEntry `calculatedAt`; virtual-clock evidence proves a due
  worker appends a revision exactly at each band/SLA transition, recovers overdue
  rows after restart, and emits no per-second tick writes;
- Project authorization is applied before joins, counts, facets, sorting,
  cursor creation, exports, metrics or background aggregation;
- composed page checks bind outer/path scope to every entry, recompute the
  authorized singleton/portfolio and base/generation hashes, require
  `visibleCounts.total` to equal all five stage counts over the full filtered
  result, and require page ordinals to be unique increasing positions in the
  effective full order (not merely renumbered within each page);
- the QA Lead sees only Projects `A` and `B`. Adding, removing or reordering
  forbidden Project `C` cannot change visible counts, cursor boundaries, ranks
  or telemetry and cannot be inferred from timing or an anchor error. A rebuild,
  projection change or order move confined to `C` also cannot change the visible
  public generation, ETag, freshness, order-head resourceVersion or queue epoch;
- a Workspace Owner without Project Entitlement receives no project content;
  every mutation target requires entitlement, while an order anchor is resolved
  only inside the authorized set and hidden/missing anchors are identical no-ops;
- QueueEntry exposes the exact projection tuple plus control-head version, and
  QueuePage exposes order-head version/epoch plus authorized base-set tokens, so
  every command CAS can be copied from an authorized read without a global
  capacity-head value;
- the first portfolio move atomically persists the server-derived scope membership
  beside its order head. A Project `A` base-set change advances only heads whose
  membership contains `A`; an untouched/disjoint or still-unmaterialized scope
  retains its version/sentinel;
- one portfolio override observed through two overlapping authorized Project sets
  yields page-local `appliedOrderOverride` outcomes without mutating the canonical
  QueueEntry. Its deterministic ref is reproducible from retained order-scope/
  override history and hashes the explanation without its own wrapper;
- `queue.order.changed` uses a durable Project/WorkItem invalidation revision only
  for a PROJECT-lane effect; its envelope entity ID/version match
  `workItemId/invalidationRef.version` and it contains no QueueEntry, anchor,
  portfolio-set hash or internal action identity. A PORTFOLIO-only move/expiry emits
  no target-Project event, so an A-only subscriber cannot infer A+B scope activity;
- one QueueEntry revision emits exactly one same-channel projection event:
  `queue.control.changed` for a control cause or `queue.projection.updated`
  otherwise; a non-discretionary overflow decision emits only
  `capacity.over-limit-detected`, while every other admission decision emits only
  `capacity.admission.decided`, so no sibling event is consumed as stale;
- GET paths read local projections only and issue zero Jira, GitLab, Mattermost
  or model calls.

## 5. US-003 — explainable triage and accepted controls

```bash
# Implemented US3 scenarios and checkpoint.
corepack pnpm queue:scenario -- us3-factorized-assessment
corepack pnpm queue:scenario -- us3-missing-business-impact
corepack pnpm queue:scenario -- us3-model-outage-fallback
corepack pnpm queue:scenario -- us3-assessment-drift-conflict
corepack pnpm queue:scenario -- us3-exact-lead-order-override
corepack pnpm queue:scenario -- us3-order-hidden-anchor-terminal-no-op
corepack pnpm queue:scenario -- us3-approval-v1-v2-compatibility
corepack pnpm queue:scenario -- us3-jira-priority-remains-separate
corepack pnpm verify:006:us3
```

Evidence must prove:

- `TriageAssessment@1.1.0` exposes each bounded factor, its confidence,
  explanation, missing-information keys, input fingerprint and rule/skill
  version separately; no single total score exists;
- its fingerprint accepts only the subject-correlated Candidate/Draft/WorkItem
  revision, a confirmed Jira operational projection, QA queue facts and safe
  automation fact-set families. Full policy/capacity/authorization/private-action
  refs are schema-invalid in every component;
- missing business impact remains `UNKNOWN` and is listed as missing rather
  than guessed. Model outage uses the deterministic fallback and does not block
  stages, admission or SLA;
- an assessment is only a proposal. Source-fact or assessment-fingerprint drift
  makes a pending accept/control command stale;
- a HUMAN queue-control revision copies explicitly accepted risk, business impact,
  dependency and planning-only effort values and records before/after, reason,
  actor, authorization basis and exact refs. A Lead order
  move is one of `FIRST | LAST | BEFORE | AFTER`, append-only, scoped, versioned,
  expiring and applied only after entitlement filtering;
- accepting planning fields preserves an existing service class, except the
  explicit confirmed-due `STANDARD` to `FIXED_DATE` transition. The closed effect
  carries either before/after planning values plus one preserved service class, or
  one retained planning-value object for a service-class transition. Fixed-date
  clear and all EXPEDITE entry/exit use their dedicated effects, so a planning
  accept cannot silently clear or create EXPEDITE;
- a missing or newly forbidden order anchor is resolved after authorization but
  before Approval creation. It yields a terminal consumed
  `ANCHOR_UNAVAILABLE_NO_OP` safe candidate with no public anchor/expiry/Approval;
  only the restricted private witness retains the requested key. Its consumed
  receipt points to the immutable public candidate, not a private audit record.
  Concurrent/stale
  queue epoch or control version returns a conflict rather than silently rebasing;
- an authorized QueuePage item (not the canonical QueueEntry) may embed a
  view-local applied-override explanation with exact ref/revision, scope,
  placement, applied-or-anchor-unavailable state and reason. Expiry exists only
  for an applied move, never the terminal unavailable-anchor no-op; it never
  embeds the requested anchor identity;
- an applicable approval-bearing action stores a complete safe public candidate
  and a same-ID private execution witness. Approval v2 `payloadHash`, candidate
  content hash and receipt `publicIntentHash` are equal, while private `actionHash`
  covers that exact `actionId`, differs and never appears in the API. Missing or
  mismatched private IDs fail composed validation. Existing Approval v1 still parses/reads;
- service class/order acceptance never edits Jira priority or due. Those fields
  can change only through their separate exact Jira command followed by a
  confirmed read.

## 6. US-004 — WIP, reservation-to-claim and EXPEDITE

### 6.1. Policy modes and accounting

```bash
# Implemented US4 policy scenarios.
corepack pnpm queue:scenario -- us4-measure-only-observation
corepack pnpm queue:scenario -- us4-enforced-publication-requires-baseline
corepack pnpm queue:scenario -- us4-project-soft-limit-warning
```

`MEASURE_ONLY` must calculate and record stage, flow, human occupancy and future
review commitment, while exposing WIP/SLA targets as `NOT_CONFIGURED`. It must not
deny a start for a missing numeric limit and must not claim a breach.

Publishing `ENFORCED` must require immutable baseline evidence plus numeric
Workspace hard WIP, EXPEDITE capacity, SLA targets/warnings and closed pause/
release mappings. Per-Project soft limits/reservations are optional; if listed,
each is numeric, same-Workspace and complete. Policy publication is rejected
atomically if any mandatory or listed input is invalid. Project values yield
warnings such as soft-limit/reservation pressure; they never grant access or block
an authoritative fact, and they never weaken the Workspace hard limit.

### 6.2. Durable review reservation lifecycle

```bash
# Implemented US4 admission scenarios and checkpoint.
corepack pnpm queue:scenario -- us4-automated-launch-reserves-review
corepack pnpm queue:scenario -- us4-running-automation-is-not-human-wip
corepack pnpm queue:scenario -- us4-terminal-result-converts-reservation
corepack pnpm queue:scenario -- us4-pre-review-cancel-releases-reservation
corepack pnpm queue:scenario -- us4-one-work-item-one-capacity-unit
```

The future checks must demonstrate these state and accounting invariants:

1. An explicit admitted AUTOMATED launch creates one durable
   `REVIEW_CAPACITY_RESERVATION` in `HELD` for its Work Item in the same
   admission unit of work. It is not a human-WIP claim.
2. AUTOMATED `RUNNING` consumes GitLab runner capacity, not human WIP. Admission
   headroom nevertheless counts the union of occupied Work Items and Work Items
   with an active review reservation; metrics expose occupancy and reservations
   separately.
3. The first terminal result requiring review atomically adds/merges the
   AUTOMATED `REVIEW_REQUIRED` cause into the Work Item claim and marks the
   reservation `CONVERTED`. There is no transactionally visible gap,
   double charge or temporary capacity gain; the union count is unchanged.
4. Cancellation before review atomically marks the reservation `RELEASED`
   without inventing a claim. Replay is a no-op with the original decision.
5. Multiple Sessions/Attempts on one Work Item maintain one reservation and one
   occupied capacity unit. Sorted cause-set hashes preserve all causes without
   multiplying the Work Item.
6. If the Work Item is already occupied, an automated launch can record its
   review commitment as `COVERED_BY_CLAIM`, but union accounting still counts
   the Work Item once. Reservation/claim histories remain separately auditable.

### 6.3. Serialized admission, exact override and unavoidable overflow

```bash
# Implemented US5 scenarios and checkpoint.
corepack pnpm queue:scenario -- us4-concurrent-last-slot
corepack pnpm queue:scenario -- us4-concurrent-review-reservation
corepack pnpm queue:scenario -- us4-exact-wip-override
corepack pnpm queue:scenario -- us4-denial-without-override-intent
corepack pnpm queue:scenario -- us4-stale-or-self-approved-override-denied
corepack pnpm queue:scenario -- us4-concurrent-expedite-singleton
corepack pnpm queue:scenario -- us4-expedite-clear-and-expiry-lock
corepack pnpm queue:scenario -- us4-forced-external-overflow
corepack pnpm queue:scenario -- us4-blocked-release-and-resume
corepack pnpm verify:006:us4
```

With an `ENFORCED` Workspace limit of one, two simultaneous capacity-increasing
commands on different Projects must lock the same Workspace capacity head. Exactly
one commits the Session/control plus claim or reservation; the other commits a
durable denial. SQL serialization failures may retry within a bounded technical
budget, but the business command is never retried around a changed snapshot.
Redis loss cannot admit extra work.

When policy allows escalation, the denying transaction creates exactly one
WIP-override PlatformAction/Approval and returns `202` plus the existing Core
Approval `Location` only if the request supplied closed
`overrideIntent {reason, expiresAt}`; the Session, claim and reservation still
remain unchanged. Omission produces the stored ordinary denial with `200` and no
candidate or Approval.
The generic Core decision endpoint is the only later consume path and atomically
invokes the Feature 006 handler.

An exact `WIP_ADMISSION_OVERRIDE` must pin policy version/hash, requested transition,
Work Item/Session versions, sorted claim/reservation-set hash and counts, hard
limit, actor, reason, expiry and idempotency key. A currently authorized QA Lead
distinct from the initiating HUMAN must approve it, and every field plus
authorization is rechecked under the capacity lock at consumption. Same request
key/same canonical hash replays; same key/different hash, stale state, expired
approval, self-approval or a different target is rejected before mutation.
Also block a Session from `REVIEW_REQUIRED` under `RELEASE_WIP`, then prove a
manual-resume override requests that exact persisted `blockedFrom` state; a start
or automated launch carrying `REVIEW_REQUIRED` must fail schema validation.

The default `ENFORCED` EXPEDITE capacity fixture is one. Racing two exact
EXPEDITE actions takes the same Workspace capacity lock and yields one accepted
class plus one denial/override candidate pinned to the exact capacity/control
witness, the originating public `SERVICE_CLASS_EXPEDITE` candidate ref (whose
semantic hash is its public intent hash), and the paired private action hash. The
originating requested effect is `SET_EXPEDITE` with exact before/after class and
review time. Removing, completing or expiring the first class atomically updates the
capacity head and makes later capacity available; a second active class is
possible only through its own exact override.
Explicit `CLEAR_EXPEDITE` is a QA Lead action under the same capacity-first lock,
but it has `NO_SECOND_APPROVAL`, no expiry and no Approval; clearing FIXED_DATE is
the ordinary control-accept branch.

Every public capacity before/after ref resolves to a durable Project or exact
authorized-portfolio projection revision. Its hash excludes its own ref wrapper,
contains only scoped counts/facets/freshness and no global admission-state enum,
and hidden-only source churn cannot advance it. The admission response's
authorization witness hashes only the target-Project outcome, never the actor's
wider entitlement/basis set. Only the operation-local outcome/violations may explain
why that exact authorized mutation was denied.
Contract negatives also prove an admitted outcome cannot carry a hard/approval
blocker, DENIED cannot have an empty blocker set, MEASURE_ONLY cannot expose hard
or external-overflow state, and every committed activity has exactly its typed
Session/claim/reservation/control ref family. Automated review conversion requires
all three Session+reservation+claim refs; cancellation requires exactly
Session+reservation and cannot report overflow.

External Jira activity and automated terminal results are authoritative facts and
must never be discarded, delayed or rolled back to protect the counter. If such a
fact has no matching reservation, it creates a claim with `FORCED_EXTERNAL` cause,
records `NON_DISCRETIONARY_OVERFLOW` when the limit is exceeded and exposes
that outcome for the affected authorized target. The internal capacity head enters
`OVER_CAPACITY_EXTERNAL`; no global-state bit is added to an unrelated caller's
snapshot. It alerts the Lead and blocks every later
discretionary start until capacity falls or an exact override is consumed. This is
not implicit approval. A post-start `BLOCKED` item releases capacity only for a
confirmed Jira-owned reason explicitly mapped to `RELEASE_WIP`; unknown, stale or
free-text reasons retain it. Resume reacquires capacity through the same serialized
admission path.

## 7. US-005 — transparent, revision-pinned SLA

```bash
# Implemented concurrency, integration and security suites.
corepack pnpm queue:scenario -- us5-local-dor-does-not-start-sla
corepack pnpm queue:scenario -- us5-confirmed-ready-starts-at-confirmed-at
corepack pnpm queue:scenario -- us5-no-rollout-backdating
corepack pnpm queue:scenario -- us5-rollout-duplicate-read-receipt
corepack pnpm queue:scenario -- us5-business-calendar-golden-vectors
corepack pnpm queue:scenario -- us5-finite-calendar-policy-rejected
corepack pnpm queue:scenario -- us5-confirmed-pause-resume
corepack pnpm queue:scenario -- us5-unknown-pause-reason-keeps-running
corepack pnpm queue:scenario -- us5-policy-calendar-revision-pinning
corepack pnpm queue:scenario -- us5-measure-only-versus-enforced
corepack pnpm queue:scenario -- us5-notification-dedupe-and-outage
corepack pnpm queue:scenario -- us5-clock-revision-versus-evaluation-hash
corepack pnpm verify:006:us5
```

Evidence must prove:

- local DoR, a pending Jira transition, model text, backfill and page reads do
  not start or backdate the clock;
- only a newly applied confirmed Jira-owned start state starts it, using the
  platform monotonic `confirmedAt`; the provider timestamp is retained only as
  sync-lag evidence;
- an item already `READY` at migration receives no fabricated history. Its first
  post-feature authoritative Jira read persists one verification receipt per
  Work Item/goal/policy-enable epoch and may open a clock at that read's platform
  `confirmedAt` even when Feature 003 reduces unchanged state as `DUPLICATE`.
  It never fabricates/revises an operational projection; mismatch/outage remains
  `ROLLOUT_CONFIRMATION_REQUIRED`;
- each clock pins exact policy, business-calendar, mapping and algorithm refs.
  Later publications affect new clocks/projections but never reinterpret an
  existing clock or its historical elapsed value;
- append-only `RUNNING`/`PAUSED` segments change only on monotonically applied
  confirmed mapped Jira status/reason events. Unknown or stale reasons fail
  closed as running; a connector outage is visible freshness degradation, not
  an automatic pause;
- calendar results match golden vectors for IANA timezone (including `UTC`),
  weekly intervals, closure, working override, an exclusive `24:00:00` midnight
  split, leap day, DST gap and DST overlap. A CLOSED and WORKING override on the
  same local date is rejected by the composed publication validator;
- a finite calendar revision remains readable as immutable import/archive data but
  QueuePolicy publication rejects it. Only `validThrough=null` may back READY aging
  or a new clock, and a long pause/resume remains calculable without a later calendar;
- `MEASURE_ONLY` reports elapsed working time with
  `targetState=NOT_CONFIGURED`. `ENFORCED` deterministically reports
  `ON_TRACK | AT_RISK | BREACHED | COMPLETED` from the exact pinned target and
  warning thresholds;
- crossing a threshold appends one deduplicated NotificationIntent. Mattermost
  failure leaves it pending and cannot roll back or recalculate the SLA. Hermes
  may propose wording but cannot write the clock, priority or due date. The
  threshold payload retains the intent ID plus immutable creation hash while its
  delivery state, attempts and row version may advance;
- without any source event or page read, a virtual-clock advance makes the
  PostgreSQL due-row worker update SLA risk/READY aging bands and emit each
  warning/breach once; deleting an accelerator job and restarting still recovers
  the overdue transition from the durable index;
- clients cannot choose SLA `asOf`. `clockRevisionRef` remains stable across
  read-time evaluation, while server-selected time and derived values change the
  separate `evaluationHash`. Threshold payloads carry `slaClockId` plus the exact
  immutable clock-revision ref, whose IDs must match. The item response uses one
  shared `asOf`, repeats the path scope, returns every currently enabled goal once
  (or both closed v1 goals as `POLICY_NOT_PUBLISHED` before publication), and every
  started snapshot's duplicated immutable fields equal the resolved transition.
  Provider observation time comes from the resolved start authority; target and
  warning values equal the pinned policy goal and drive the derived risk fields;
- SLA contract negatives reject a capacity/policy/authorization ref in mapping,
  start, pause, stop or segment positions. Start accepts only confirmed Jira or a
  rollout-verification receipt; stop accepts Session versus Verdict revisions
  according to the exact goal;
- the pinned terminal goal closes the current segment and freezes elapsed time;
  reopen/new service work increments `clockCycle`, appends a START revision linked
  to the prior STOP under the same clock ID and leaves the old lineage immutable.

## 8. Concurrency, isolation and security checks

```bash
# Implemented rebuild/recovery scenarios and checkpoint.
corepack pnpm test:concurrency:006
corepack pnpm test:integration:006
corepack pnpm test:security:006
```

Required negative and race evidence includes:

- concurrent manual starts, automated launches, reservation conversions,
  releases, WIP overrides, EXPEDITE actions and order moves with exact winners,
  denials, replay and stale-conflict outcomes;
- admission replays the predecessor QA Session ETag unchanged: only the RFC
  strong `"N"` form is accepted and N must equal `expectedSessionVersion`.
  Any older Session GET emitting `W/"N"` is upgraded before this route is enabled;
  weak, malformed or mismatched forms fail before mutation;
- no check-then-write against a cached count and no Redis semaphore as truth;
  the Workspace capacity head plus authoritative local rows are read inside one
  serializable unit of work;
- missing/revoked Workspace membership, Project Entitlement, role,
  classification access or current capability is denied before aggregation or
  command creation;
- foreign Workspace/Project/Work Item/Session/policy/calendar/control/anchor refs,
  mixed-scope hashes and cross-project substitutions do not disclose existence;
- missing and unauthorized scoped targets share the closed 404 body/timing, while
  hidden/missing order anchors are the same accepted no-op; 403 is used only for
  operation permission established independently of target existence;
- public reads, admission responses and events contain no global capacity-head
  state/version/count/set hash or full PlatformAction `actionHash`; exact global
  witnesses remain internal under lock. Receipts and the complete safe Approval
  v2 candidate expose only the matching `publicIntentHash`; PLATFORM_ACTION
  authorization witnesses contain a target-Project facet hash or exact authorized
  portfolio-set hash, never membership/entitlement/role-assignment record IDs.
  Hidden-Project-only churn leaves public hashes, refs and freshness stable;
- schema-negative vectors prove QueueEntry source refs and admission mutation/
  Approval/action refs reject private source types such as Workspace capacity
  heads, full QueuePolicy revisions and authorization records before semantic
  lookup; composed checks then prove same-Project scope and ref/hash equality;
- capability and availability can influence a routing hint only after
  authorization; neither creates permission or an automatic assignment;
- Hermes, SERVICE principals, webhooks and scheduled jobs cannot approve Lead
  actions, mutate Jira fields, start discretionary work or sign a QA Verdict;
- raw project content, IDs, titles, request keys and forbidden totals do not
  become metric labels or unrestricted logs;
- production-looking endpoints, credentials, deploy jobs or external calls are
  denied before secret materialization and adapter/network invocation. Provider
  call counts remain zero.

## 9. Projection events, rebuild and restart recovery

```bash
# Implemented PostgreSQL 17/18 matrix.
corepack pnpm queue:scenario -- rebuild-duplicate-and-out-of-order-events
corepack pnpm queue:scenario -- rebuild-missed-event-and-gap
corepack pnpm queue:scenario -- rebuild-shadow-generation-cutover
corepack pnpm queue:scenario -- rebuild-redis-worker-process-restart
corepack pnpm queue:scenario -- rebuild-no-duplicate-notification-or-effect
corepack pnpm verify:006:rebuild
```

Evidence must prove:

- every source mutation and its outbox event commit atomically; a consumer
  claims through the durable inbox and treats events as scoped invalidations;
- projection recomputation re-reads current exact local Candidate/Draft, Jira,
  QA and automation facts, computes a canonical input hash and does not blindly
  apply a delta or call a provider/model;
- duplicate input hashes are no-ops, out-of-order events cannot roll state back,
  and a detected sequence gap schedules bounded reconciliation;
- a full rebuild writes a shadow generation, scans by Workspace/Project cursor,
  catches up through a recorded watermark and atomically flips the current
  generation only after validation. Readers keep a coherent prior generation
  while status is `REBUILDING`;
- rebuilt rows equal incremental rows by semantic/input hash. Repairs append
  explicit correction history without creating duplicate control, admission,
  SLA threshold, notification or Connector effects;
- PostgreSQL preserves inbox/outbox, policy, claims, reservations, clocks,
  histories and rebuild checkpoints across API/worker/Redis/full-process
  restart. Redis may lose derived jobs but never durable truth.

## 10. PostgreSQL 17/18 migration matrix

```bash
# Implemented local acceptance commands; aggregate acceptance remains fail-closed.
corepack pnpm verify:006:migrations -- postgres=17
corepack pnpm verify:006:migrations -- postgres=18
```

Both versions must validate these monotonic additions:

| Order | Owner | Planned content |
|---|---|---|
| Core `0130` | Platform Core | immutable Workspace queue-policy/calendar versions plus neutral/scoped policy projection heads and exact scope-membership rows |
| Core `0135` | Platform Core | input/projection history and heads, rebuild generations, SLA clocks/segments and rollout verification receipts |
| Core `0140` | Platform Core | public/private action pairs, controls, order scopes/membership and Project-lane invalidations, global/authorized-scope capacity projections with membership, claims, reservations and admission decisions |
| QA `2070` | QA Pack | append-only QA queue-fact revisions and current pointer/indexes |

The matrix covers fresh installation, upgrade from the current Core `0120`/QA
`2060` baseline, repeat execution, current-minus-one, schema expand/validate and
failed-migration recovery without partial publication. Core `0130`–`0140` run
before QA `2070` on a fresh install, so every SQL migration is schema-only and
must not read another owner's not-yet-created tables. Scope-composite foreign keys,
unique current heads, semantic hashes, partial indexes and append-only guards must
hold under concurrency.

After all migrations, the separately tested runtime projection bootstrap may
derive current `BACKLOG | READY | ACTIVE | COMPLETED` rows from latest confirmed
facts into an explicit shadow generation. It creates no historical SLA segment,
accepted control, human-WIP claim or review reservation and never guesses an old
Jira `READY` timestamp. A second checkpointed current-state capacity reconciliation
then runs under each Workspace lock; it may establish claims/reservations for exact
current facts and must record non-discretionary overflow, but cannot reconstruct
past occupancy. `ENFORCED` admission remains unavailable while either phase is
incomplete or `REBUILDING`. Jira, GitLab and Mock Hub receive no Feature 006 schema
migration.

## 11. Browser, full-process smoke and aggregate gate

```bash
# Implemented local acceptance commands; aggregate acceptance remains fail-closed.
corepack pnpm test:e2e:006
corepack pnpm test:browser:006
corepack pnpm smoke:006
corepack pnpm trace:006
corepack pnpm verify:006:quickstart
corepack pnpm verify:006:evidence
corepack pnpm verify:006
corepack pnpm ci:006
```

The browser journey must independently show Candidate, Backlog, Ready, Active and
Completed; separate raw/normalized Jira status; source/projection freshness;
factorized recommendation versus accepted control; comparator explanation; human
occupancy versus review reservation; Project soft warning versus Workspace hard
denial; exact override provenance; SLA start/pause/risk and pinned revisions.
Forbidden Project content must remain absent from UI data, counts and cursors.

`smoke:006` must launch real child processes under an isolated compose project,
execute every documented scenario on the one required local contour, inspect both
platform and Mock Hub PostgreSQL state, restart worker/Redis/Mock Hub during durable
work, run the browser journey and shut down cleanly. It must never opt into a live
provider test. There is no live or production acceptance path in this feature.

`trace:006` must map `FR-001…FR-025` and `SC-001…SC-007` to fresh executable
evidence. The aggregate gate runs prerequisites/governance, offline contracts,
architecture, unit truth tables, US-001…US-005, concurrency, integration,
security, rebuild/restart, PostgreSQL 17/18, browser/process smoke, traceability,
typecheck, lint and build.

## 12. Expected evidence

The commands own atomic, machine-generated reports under:

```text
reports/006-queue-triage-capacity-sla/
├── prerequisites.json
├── governance.json
├── contracts.json
├── architecture.json
├── unit-matrices.json
├── setup-contour.json
├── us1.json
├── us2.json
├── us3.json
├── us4.json
├── us5.json
├── concurrency.json
├── integration.json
├── security.json
├── rebuild.json
├── migrations-postgres-17.json
├── migrations-postgres-18.json
├── browser.json
├── smoke.json
├── quickstart.json
├── traceability.json
├── evidence.json
└── final-gate.json
```

Every report binds command identity, UTC start/end, contour, exact source and
contract digests, migration registry, fixture/clock seed, policy/calendar refs,
child-report hashes and sanitized audit/projection identifiers. Report editing or
source drift invalidates downstream evidence.

Expected final local result after implementation:

```text
status: PASS
feature: 006-queue-triage-capacity-sla
contour: qa-jira-gitlab-mattermost-local
externalNetwork: DENIED
liveProviders: NOT_REQUESTED
measureOnly: PASS
enforcedFixture: PASS
entitlementBeforeAggregation: PASS
reservationToClaim: PASS
confirmedJiraReadyStartsSla: PASS
production: DENIED
deploymentApproval: LOCAL_CONFORMANCE_ONLY
```

No source document, missing command, locally edited JSON or prior feature report
can itself satisfy this result. A final `PASS` is valid only when
`verify:006:evidence` recomputes and matches all bound inputs after the aggregate
gate.

## 13. Cleanup

```bash
# Implemented safe teardown; reset is scoped and requires confirmation.
corepack pnpm queue:scenario -- reset
corepack pnpm local:queue:down
```

The normal down command must stop only the exact isolated
`qa-jira-gitlab-mattermost-local` compose project and preserve its named volumes
for diagnosis. Use destructive fixture cleanup only when that local evidence may
be discarded:

```bash
# Destructive only for this exact local contour.
corepack pnpm local:queue:reset -- \
  --contour qa-jira-gitlab-mattermost-local \
  --yes
```

The reset command must print the resolved compose project and named volumes,
require the exact contour confirmation, refuse wildcards/unresolved variables,
refuse every non-local or production-like target and leave repository files and
reports untouched.

## 14. Troubleshooting the future implementation

| Symptom | Required interpretation/action |
|---|---|
| A documented Feature 006 command is missing | Feature 006 is incomplete; implement/register the command and its owned evidence rather than editing this guide or a report. |
| An upstream evidence digest fails | Regenerate the owning Feature 002–005 evidence against the current checkout; do not reuse a stale report. |
| Queue GET calls a provider/model | Read-path boundary failed; inspect projection composition and remove the external dependency. |
| Hidden Project changes count/rank/cursor | Authorization ordering failed; entitlement must precede every join/aggregation/sort/cursor step. |
| Two starts/reservations win one slot | Serialized Workspace admission invariant failed; inspect the capacity-head lock and authoritative cause-set hash. |
| Terminal automation briefly frees or double-counts capacity | Reservation-to-claim atomicity failed; inspect the single admission unit of work and union-by-Work-Item accounting. |
| External fact is rejected above capacity | Authority boundary failed; persist forced overflow, alert and block only later discretionary starts. |
| SLA starts at DoR/provider time | Clock authority failed; start only from fresh applied confirmed Jira state at platform `confirmedAt`. |
| Rebuild emits another alert/control/provider call | Rebuild purity/idempotency failed; it may repair projections and emit correction history only. |
| A report was `PASS` but the evidence verifier now fails | Source, contract, migration, runtime or child-report drift invalidated the handoff; rerun the full gate. |

The aggregate verifier prints its stages without
executing them:

```bash
# Non-mutating aggregate plan.
corepack pnpm verify:006 -- --plan
```

Never work around a failed gate by hand-editing generated evidence. Reports are
created atomically by their owning verification commands.
