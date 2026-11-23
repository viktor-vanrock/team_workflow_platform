# Research: Queue, triage, capacity and SLA

**Feature:** `006-queue-triage-capacity-sla`
**Date:** 2026-09-02
**Status:** Phase 0 complete — no unresolved `NEEDS CLARIFICATION`

## 1. Dependency and implementation entry gate

**Decision:** build Feature 006 on exact, freshly verified Feature 005 source and
evidence, with transitive verification of Features 002–004. The gate hashes the
consumed schemas, migration registries, QA state machines and current source tree;
a historical `PASS` report is not accepted when those inputs differ. Repair the
obsolete Feature 002 migration-inventory test that hard-codes Core `0095` and QA
`2030`; assert owner ranges, monotonicity and the current additive registry instead.

**Rationale:** queue decisions depend simultaneously on Candidate, Jira projection,
DoR, MANUAL/AUTOMATED Session and TriageAssessment facts. A stale upstream report
can make a queue test green against a state that is no longer running.

**Alternatives considered:** trust checked task boxes; require only Feature 005's
JSON status; edit or renumber historical migrations. Rejected because task state is
not runtime evidence, report freshness matters, and published migrations are
immutable.

## 2. Ownership boundary

**Decision:** Platform Core owns the provider-neutral queue stage, accepted queue
controls, ordering comparator, Workspace capacity ledger, SLA clock and portfolio
query contract. `competency-qa` owns the meaning of readiness, required Sessions,
execution/review facts and TriageAssessment. Runtime composition joins the two
through typed ports and shared TypeORM transactions. `platform-queue-bullmq` remains
transport infrastructure and is not the business work queue.

**Rationale:** the master specification already assigns queue ranking to Core as a
derived projection, while Constitution IV assigns Work Type semantics to the Pack.

**Alternatives considered:** place everything in QA Pack; reuse BullMQ job state as
the work queue; create a queue microservice. Rejected because these duplicate Core
authority, confuse transport with domain state, or add a distributed consistency
boundary without need.

## 3. Source facts and authority

**Decision:** every projection input references immutable/current facts by exact
ID/version/hash:

- Core Candidate/Draft header and latest observation/decision;
- latest confirmed Feature 003 operational projection, including raw/normalized
  Jira status, priority, due, assignee, mapping refs and freshness;
- current QA input/readiness/required-session-plan and Session-set hash;
- Feature 005 automation execution/review activity;
- current accepted queue-control revision;
- exact queue-policy/comparator revision.

The input snapshot and each source-ref set have canonical hashes. The queue stores
no second editable copy of Jira priority/due/status or QA readiness.

**Rationale:** exact refs make rebuilds and audits reproducible while preserving
source ownership.

**Alternatives considered:** query loosely by latest timestamps; copy accepted
fields into the queue as mutable columns; treat Jira webhook payloads as direct
truth. Rejected because they permit drift, dual writes and unconfirmed authority.

## 4. Closed queue-stage derivation

**Decision:** derive one top-level stage using a versioned pure reducer and expose
substate/reason separately:

```text
effective Candidate or pre-link Draft                   → CANDIDATE
confirmed Jira DONE | CANCELLED                         → COMPLETED
started Session or confirmed active/review/blocked Jira → ACTIVE
confirmed Jira READY|PLANNED + current QA DoR + no work → READY
other accepted Work Item                                → BACKLOG
```

Precedence is terminal first, then active, then ready. A post-start BLOCKED Session
stays `ACTIVE`; its human-WIP claim may be held or released independently. Planned
or READY Sessions are a `COMMITTED` facet but do not consume WIP or change the
top-level stage. A confirmed external active state without a matching Session is
shown as `ACTIVE` with `EXTERNAL_STATE_AHEAD`; a running Session while Jira is not
active is `SESSION_STATE_AHEAD`. Reconciliation never hides the inconsistency.

**Rationale:** this satisfies the five user-visible stages without creating a
competing Jira workflow and keeps activity, blocking and capacity as distinct facts.

**Alternatives considered:** persist a manually editable stage; map Jira status
one-to-one; mark PLANNED as Active; force Jira to match a Session. Rejected because
each conflates authorities or consumes capacity too early.

Ordering is stage-partitioned. An unfiltered page uses the closed display order
`CANDIDATE`, `BACKLOG`, `READY`, `ACTIVE`, `COMPLETED`. Candidate/Draft rows use a
separate, returned Candidate Inbox tuple `(enteredInboxAt, subjectKind, subjectId)`;
accepted Work Items use the explainable business comparator within their stage.
Thus a Candidate never needs fabricated Jira priority, SLA or accepted planning
values, while project and authorized-portfolio views still share one versioned
`queue-order@1.0.0` page algorithm.

## 5. Projection update and rebuild

**Decision:** source events create project-scoped invalidations in the existing
durable inbox. A worker re-reads all local sources and writes an append-only
projection revision plus its current head only when the canonical input hash
changes. A scheduled Workspace/Project cursor rebuild recalculates all visible
subjects and records generation/input/output hashes. It repairs missed, duplicate
and out-of-order events; it never calls an external provider.

**Rationale:** current upstream events do not cover every operational projection or
QA mutation, so event-only maintenance is insufficient. Full read-time joins would
make every UI request expensive and still complicate historical explanations.

**Alternatives considered:** synchronous update in every upstream transaction;
event-only projection; provider reads on queue GET; nightly destructive rebuild.
Rejected because they create cross-owner coupling, leave gaps, add outage latency or
erase history.

## 6. Portfolio authorization before aggregation

**Decision:** a workspace portfolio request first authenticates a HUMAN, verifies
active Workspace membership and the `queue.portfolio.read` role permission, then
derives authorized Project IDs through the full Project Entitlement and
classification policy. That exact server-derived set is joined to queue rows before
`COUNT`, facets, sort or cursor calculation. The response reports visible counts
only and never reveals excluded totals, ranks, IDs or timing. Project lane reads use
the same resolver for one Project.

Cursors bind `principalId + workspaceId + authorizedProjectSetHash + queryHash +
comparatorRef + authorizedProjectionGeneration`. The public generation is
`sha256(canonical(authorizedProjectSetHash, comparatorRef,
sorted[projectId,projectVisibleSetHash]))`; each Project hash covers only its
unsuppressed QueueEntry ID/revision/semantic-hash tuples effective at page `asOf`.
The Workspace rebuild-generation ID stays internal. Entitlement
or visible policy/projection drift invalidates a cursor, while a rebuild or change
confined to a forbidden Project cannot alter the token, ETag or response timing.
Page freshness is likewise aggregated only from authorized visible Project/entry
status; an internal Workspace rebuild flag is not a public field.

Every persisted authorized-scope policy, capacity or portfolio-order head stores
canonical membership rows in addition to the set hash. They are created only from
the trusted server-derived set, and their rows must re-hash to the head identity.
Project-local projectors use the reverse membership index to find affected heads;
they never invert a digest or enumerate possible entitlement sets. Policy/capacity
reads reconcile or materialize the exact current safe projection before returning
its durable ref. An order read uses a zero/no-head sentinel until the first move, at
which point the head and membership rows are created atomically.

**Rationale:** filtering only response rows still leaks cross-project counts,
ordinals, facets and page boundaries.

**Alternatives considered:** UI filtering; post-aggregation filtering; accept client
project lists; grant Workspace Owner implicit content access. Rejected by
Constitution III and ADR-0004.

## 7. TriageAssessment reuse and versioning

**Decision:** preserve published `triage-assessment@1.0.0` byte-for-byte and publish
additive `triage-assessment@1.1.0` in the originating
`urn:awp:schemas:004:triage-assessment:*` family. V1.1 keeps the original required
set and exact dimensions/recommendations shapes. It adds optional, bounded
`missingInformation[]`, `dimensionDetails`, and exact input-fingerprint/version
components. The `qa-triage@1.1.0` output profile requires those additive evidence
fields and requires unknown business impact to produce
`businessImpact=UNKNOWN` plus the matching missing-information key. It remains one
proposal-only Agent Run with a deterministic fallback and the existing
DRAFT/CANDIDATE/WORK_ITEM subject union.

**Rationale:** Feature 004 already supplies most dimensions but cannot explicitly
prove that missing impact was not invented. A new schema version closes that gap
without rewriting old signed outputs.

**Alternatives considered:** mutate V1; encode missing facts in free-text
explanation; add an opaque total score. Rejected for compatibility, testability and
the explicit no-opaque-score rule.

## 8. Recommendation versus accepted values

**Decision:** TriageAssessment is never an input to authorization or accepted
ordering by itself. A HUMAN queue-control command may reference an exact current
assessment and copy selected values into an immutable accepted revision, together
with actor, authorization basis, before/after, reason and expected header version.
Source or assessment drift invalidates a pending action. Jira priority and due date
can change only through their existing exact Jira command/confirmation flow.

**Rationale:** a reference provides traceability but not delegation of authority to
Hermes. Copy-on-accept makes the human decision explicit and stable.

**Alternatives considered:** automatically apply high-confidence recommendations;
read current assessment dynamically; overwrite the assessment with accepted
values. Rejected because confidence is not authority and mutable linkage would
silently change decisions.

## 9. Service classes

**Decision:** every accepted Work Item has `STANDARD` by default. `FIXED_DATE`
requires a confirmed Jira due date (or another policy-listed Jira-owned fixed date)
and a QA Lead command; it does not create/change that date. `EXPEDITE` requires an
exact QA Lead `PLATFORM_ACTION` with reason, review/expiry time, current policy and
Work Item/control snapshot plus the exact capacity-head version, active EXPEDITE
count/set hash and configured limit. Setting, explicitly clearing or expiring
EXPEDITE takes the
Workspace capacity lock before the control lock and atomically updates both heads.
The default active EXPEDITE capacity is one only in an `ENFORCED` policy; a second
active EXPEDITE requires an exact override bound to the denied witness, the
originating public `SERVICE_CLASS_EXPEDITE` candidate ref (whose semantic hash is
its public intent hash), the paired private action hash and its complete
before-class/after-EXPEDITE/review-time effect. Expiry
returns the effective class to `STANDARD` unless a newer revision exists and
atomically removes the item from the active EXPEDITE set.

Every queue/WIP policy override uses `SELF_APPROVAL_FORBIDDEN`: the approving QA
Lead must be distinct from the initiating HUMAN, reauthorized at consumption time.
A single-Lead pilot remains operable because an Executor can initiate the exact
candidate for that Lead; a Lead-initiated override requires another authorized
Lead rather than silently weakening separation. SERVICE/Hermes can never approve.

**Rationale:** service class is a platform planning decision distinct from Jira
priority. Exact action identity prevents a blanket Lead approval from being reused.

**Alternatives considered:** derive EXPEDITE from Jira P0/P1 automatically; let
Hermes set it; use Jira priority as service class; persist an unexpired boolean.
Rejected because all erase human intent, provenance or lifecycle.

## 10. Explainable deterministic comparator

**Decision:** comparator `queue-order@1.0.0` uses lexicographic components, each
returned in API/event content:

1. active accepted service-class band;
2. SLA state and a returned `urgencyTiming` tagged union: the earliest applicable
   exact instant among the first-start goal's latest-safe-start, an active SLA
   target and confirmed Jira due-date end interpreted by the pinned Workspace
   timezone; equal instants use that listed basis order and carry the winning
   exact source ref;
3. normalized confirmed Jira priority mapping;
4. HUMAN-accepted risk and business-impact facts;
5. HUMAN-accepted dependency readiness, `UNKNOWN` until explicitly accepted;
6. versioned working-time READY aging band; raw business seconds are returned as
   an explanation sampled at the QueueEntry calculation instant, not compared as
   a continuously changing value;
7. `readyAt`;
8. Jira display key;
9. Work Item ID.

There is no weighted sum. Unknown values occupy explicit stable buckets and never
receive fabricated midpoints. Effort range is displayed for planning but excluded
from business priority. The same comparator produces each project lane and the
recommended portfolio view.

**Rationale:** lexicographic components are reproducible, inspectable and testable
as a truth table.

**Alternatives considered:** AI total order; weighted scalar; database row order;
different comparator per view. Rejected as opaque, unstable or inconsistent.

## 11. Manual order override

**Decision:** a QA Lead may create a scoped `PROJECT` or `PORTFOLIO` order override
through an append-only `FIRST | LAST | BEFORE(anchor) | AFTER(anchor)` move command.
A scope head allocates a monotonic sequence under lock; the revision pins the
requested anchor key, exact target QueueEntry tuple, projection generation, base
comparator ref, authorized visible-set hash, reason, expiry and expected
order-head/queue-epoch/control versions. It deliberately does not assert an exact
anchor ref. After authorization filtering, the service resolves the anchor before
creating an Approval and applies active moves in sequence over the base-sorted
visible list. A missing or hidden anchor produces a terminal consumed
`ANCHOR_UNAVAILABLE_NO_OP` public candidate with no anchor, expiry or second
approval; the raw requested key remains only in the private witness/idempotency
audit. Its receipt resolves `resultRef` to that immutable public candidate
(`actionId`, version `1`, `publicIntentHash`), never to the private witness. No
unreadable pending Approval is created. The target must be in
the caller's authorized Project set; an anchor is resolved only inside that same
already-filtered set, so callers cannot probe another Project's existence. A
response-local ordinal is never stored as business priority.

A Project head is keyed by `(workspace, project)`. A portfolio head is keyed by
`(workspace, authorizedProjectSetHash)` and its version/epoch advance only for an
override or visible base-set change in that exact set. Entitlement/classification
set changes select a different head and invalidate the old cursor; activity solely
outside the exact set cannot advance or reveal itself through the visible head.
The canonical QueueEntry never embeds order state because overlapping authorized
sets can produce different placements. QueuePage adds a deterministic view-local
explanation ref. `queue.order.changed` carries a separate durable Project-scoped
invalidation revision only for PROJECT-lane effects, with no QueueEntry, anchor or
portfolio hash. A PORTFOLIO-only move/expiry is exposed by its scoped command
receipt and later authorized reads, never fanned out as a target-Project event that
could disclose wider-set activity to a Project-only subscriber.

**Rationale:** move intent is understandable and append-only, avoids mass
renumbering, and keeps expiry/source explanation explicit.

**Alternatives considered:** client-supplied numeric rank; one global list returned
to all; pairwise graph without cycle control; mutate Jira priority. Rejected for
tampering, disclosure, complexity or authority violation.

## 12. Human WIP accounting unit

**Decision:** human WIP counts distinct Work Items. One active claim has a set of
causes and exists when any of these are true:

- MANUAL Session `RUNNING` or `REVIEW_REQUIRED`;
- AUTOMATED Session `REVIEW_REQUIRED`;
- confirmed Jira active/review state configured to consume human WIP.

AUTOMATED pipeline `RUNNING` consumes GitLab runner concurrency, not human WIP.
Its explicit launch acquires one separate durable `REVIEW_CAPACITY_RESERVATION` for
the Work Item. Admission headroom counts the union of occupied and reserved Work
Items, while metrics expose occupancy and reservations separately. Multiple
Sessions/Attempts for one Work Item do not multiply either set. A terminal result
atomically converts the reservation into a review claim; cancellation before review
releases it. Claim/reservation reconciliation compares exact sorted cause-set hashes
and appends revisions.

**Rationale:** the capacity question is how many requests demand QA attention, not
how many database Session rows exist. This directly reconciles the Feature 006
start scenario with Feature 005 execution semantics.

**Alternatives considered:** count Sessions; count automated pipelines directly as
human WIP; launch without reserving review capacity; count only Jira IN_PROGRESS.
Rejected because they overstate active human load, permit predictable review
overflow, or miss review.

## 13. Hard admission and concurrency

**Decision:** `ENFORCED` Workspace WIP is a serializable gate on discretionary
commands that increase human occupancy. The UoW locks one Workspace capacity-head
row, locks the target Work Item/Session, re-reads current claim and review-reservation
causes plus current policy, then writes exactly one admission decision and either
the Session/control transition plus claim/reservation or no mutation. Same request
key/same hash replays; same key with a different hash conflicts. Lock acquisition
has bounded retry for SQL serialization failure, not an unbounded business retry.

**Rationale:** checking a cached count before changing a Session permits concurrent
starts to exceed the limit. One workspace lock is acceptable for the pilot scale
and preserves a clear invariant.

**Alternatives considered:** Redis semaphore; optimistic count only; advisory UI
warning; per-Project lock. Rejected because durable truth cannot live only in Redis
and concurrent Projects share one hard Workspace limit.

## 14. Exact WIP override and non-discretionary overflow

**Decision:** a denied start produces an exact `WIP_ADMISSION_OVERRIDE` candidate
only when the caller supplied closed `overrideIntent {reason, expiresAt}` and the
policy permits escalation. Without it the immutable denial is terminal. The
caller-visible candidate pins only the requested effect and authorized read
tokens; its content hash equals the public receipt hash and additive Approval v2
`payloadHash`. A same-action private execution witness additionally pins the full
policy revision, requested Session transition, Work Item/session versions,
claim/reservation global set hashes/counts, capacity limit, private authorization
basis, expiry and idempotency evidence. At consume time both documents and live
Lead authorization are rechecked under the capacity lock.

A manual resume does not assume `RUNNING`: it requests the pinned Session's exact
`blockedFrom` milestone. `REVIEW_REQUIRED` is accepted only for
`MANUAL_SESSION_RESUME`; starts and automated launches remain `RUNNING`. This keeps
an override constructible when a blocked review Session had released WIP.

Approval v2's PLATFORM_ACTION branch forbids fabricated Connector Binding/Profile
refs. Its response uses a target-Project facet hash or exact portfolio-set hash as
a viewer-safe authorization-scope witness; full initiator/approver membership,
entitlement and role-assignment refs plus the private `actionHash` are never
serialized. Core still reads frozen Approval v1 and writes v2 only for new Feature
006 platform actions.

External Jira observations and automated `RUNNING→REVIEW_REQUIRED` results are
authoritative facts, not discretionary starts, and are never rejected or rolled
back to protect capacity. A normal automated result converts its existing review
reservation. A result without a matching reservation, or an external Jira entry,
creates a `FORCED_EXTERNAL` claim even above the limit, records
`OVER_CAPACITY_EXTERNAL`, alerts the Lead and blocks every later discretionary start
until capacity falls or an exact override is consumed. This does not count as an
implicit approval.

**Rationale:** losing or postponing technical results would corrupt authority;
silently exceeding the limit would make “hard” meaningless for controllable work.

**Alternatives considered:** count the reservation itself as occupied human WIP;
discard or delay terminal results; automatically approve overflow. Rejected because
runner work is not active human WIP, evidence must converge, and system events
cannot grant Lead authority.

## 15. BLOCKED and claim release

**Decision:** a post-start blocked item remains in Active. Its claim is released
only when a confirmed Jira status/reason matches an explicit `RELEASE_WIP` rule in
the pinned/current WIP policy. A Session-local free-text reason cannot release it.
Resume or a new consuming cause reacquires through the same admission UoW; if the
Workspace is full, the human resume requires an override. Unknown/stale block facts
hold the claim fail-closed.

**Rationale:** release affects a hard shared limit and therefore needs a canonical,
mapped reason rather than editable text.

**Alternatives considered:** all BLOCKED releases capacity; Session state alone;
Hermes classification. Rejected because teams can game or accidentally inflate
capacity and model output is not policy.

## 16. Project soft limits and reservations

**Decision:** published policy may define per-Project soft limits/reservations.
Admission computes `WITHIN_SOFT_LIMIT | ABOVE_SOFT_LIMIT | RESERVATION_PRESSURE` and
records the warning, but only Workspace hard WIP or EXPEDITE capacity blocks.
Reservations influence explanation/routing recommendations, never authorization.
Lowering a policy below current occupancy creates visible policy debt; it does not
delete or stop current work.

**Rationale:** the specification calls these values soft and aims to prevent a
single Project from monopolizing attention without replacing Lead judgment.

**Alternatives considered:** hard per-Project caps; automatic slot stealing;
priority boost for under-reserved Projects. Rejected because they turn planning
guidance into autonomous allocation.

## 17. Availability, capability and routing

**Decision:** keep three separate inputs:

- authorization: current membership/entitlement/role/classification;
- capability: explicit versioned capability claim/required-capability match;
- availability: independently recorded bounded availability/capacity fact.

A routing hint can list currently authorized eligible HUMAN principals only after
all three pass, with reasons for missing capability or capacity. It never assigns
work and never treats a capability claim as a permission. Where the current code
has no workforce capability registry, Feature 006 exposes the typed ports and a
local static contribution; durable organization-wide skill management remains out
of scope.

**Rationale:** FR-019/020 explicitly forbid deriving authority from skill/capacity.

**Alternatives considered:** infer capability from role; infer availability from
absence of Sessions; automatically write assignee. Rejected as unsafe or outside
the feature boundary.

## 18. SLA start timestamp and source

**Decision:** create the clock only after a newly applied confirmed operational
projection matches the policy's Jira-owned start state (default normalized
`READY`). Use the platform monotonic `confirmedAt` as the clock start and retain
provider timestamps only for sync-lag metrics. A pending transition, human DoR
confirmation, projection backfill or model recommendation cannot start/backdate
the clock. An already-READY item at rollout requires a fresh authoritative Jira
read and one immutable verification receipt per Work Item/goal/policy-enable epoch.
The receipt may start the clock at its new platform `confirmedAt` even when the
Feature 003 reducer correctly classifies the unchanged operational projection as
`DUPLICATE`; it does not invent or rewrite an operational revision. A mismatch or
outage remains `ROLLOUT_CONFIRMATION_REQUIRED`.

**Rationale:** the acceptance scenario explicitly says no clock before webhook/read
confirmation. Provider update timestamps may include unrelated changes and can
arrive late or out of order.

**Alternatives considered:** use DoR confirmation time; backfill Jira updated time;
start when queue page first opens. Rejected because none is the exact confirmed
authority event.

## 19. Business calendar representation

**Decision:** publish an immutable calendar version containing IANA timezone,
non-overlapping weekly local-time intervals, dated closures, dated working
overrides, source/owner, a start date and nullable inclusive end date, algorithm ref
and semantic hash. Each local date occurs at most once across CLOSED and WORKING
overrides; a conflict is rejected rather than ordered by implicit precedence. A
null end makes the recurrence plus declared overrides
authoritative for every future date. QueuePolicy activation requires that open-ended
form; a finite imported/archive revision cannot back READY aging or an SLA clock.
Convert
interval boundaries to instants with explicit DST rules: nonexistent local times
move to the next valid instant; ambiguous times select the earlier start and later
end so an interval is never shortened silently. Golden vectors cover DST, midnight,
holiday, leap-day and timezone-change cases.

**Rationale:** deterministic bounded expansion of immutable local recurrence rules
makes runtime arithmetic independent of an external calendar service, while the
open-ended publication invariant prevents an unbounded pause/resume cycle from
outliving a pinned calendar. A later calendar can describe new holidays for later
clocks without reinterpreting old measurements.

**Alternatives considered:** server local timezone; live calendar API on every
query; fixed UTC working hours; a third-party date library. Rejected for drift,
outage dependence, incorrect local semantics or unnecessary dependency.

## 20. SLA segments, pause and stop

**Decision:** each clock pins policy/calendar/status semantics and has append-only
`RUNNING`/`PAUSED` segments. A segment boundary is created only by a confirmed,
monotonically applied Jira status/reason or the exact stop fact for its goal. Pause
reasons are closed mapped codes; unknown reasons continue RUNNING. A policy enables
one or both closed goals: `READY_TO_FIRST_QA_START`, stopped by the first accepted
consuming Session start, and `READY_TO_SIGNED_VERDICT`, stopped by the exact signed
QA Verdict. A separate clock is created per enabled goal. Confirmed Jira terminal
status remains operational completion authority and a consistency input; it does
not fabricate a human QA Verdict or goal satisfaction. Stop freezes elapsed working
time. Reopen/new service work starts a new monotonic `clockCycle` lineage under
the same clock ID: its START revision references the prior cycle's STOP revision,
resets elapsed to zero and never mutates prior facts.

**Rationale:** explicit goal and pause semantics are required for comparable
measurements and prevent later config from rewriting history.

**Alternatives considered:** mutable elapsed counter only; free-text pauses;
automatically stop at any Session completion. Rejected because history becomes
unreproducible or incomplete.

## 21. Baseline and policy modes

**Decision:** queue-policy versions have two modes:

- `MEASURE_ONLY`: calendar and stage/comparator semantics are valid; WIP/SLA values
  are `NOT_CONFIGURED`; flow observations are recorded without claims of breach;
- `ENFORCED`: publication requires immutable baseline evidence and numeric hard
  WIP, EXPEDITE capacity, SLA targets/warnings and pause/release mappings.

SLA clocks pin the version at start. Capacity admission uses the current published
policy at the exact mutation and stores it in the decision. Comparator/policy
changes create new projection revisions; historical ones remain queryable.

**Rationale:** this implements the explicit “after baseline” pilot inputs without
blocking development or inventing targets.

**Alternatives considered:** default WIP=1 or 10; environment variables without
versions; retroactively apply new targets. Rejected as fabricated, unauditable or
historically misleading.

## 22. Freshness and degradation

**Decision:** queue response separates source freshness from queue projection
freshness. Jira outage preserves the last confirmed operational values with
`STALE|ERROR`, never a local guess. Model outage uses deterministic triage and does
not affect stages/admission/SLA. Mattermost outage leaves NotificationIntents
pending without altering clocks. GitLab outage prevents new automated launches via
Feature 005 but manual queue work continues. Capacity-increasing commands re-read
local authoritative facts and fail closed on unresolved projection/source conflict.

**Rationale:** each failure remains feature-scoped and the queue does not become a
new integration coupling point.

**Alternatives considered:** hide stale rows; pause SLA on any connector outage;
recompute Jira status locally; block the entire portfolio when model is down.
Rejected because each changes accepted truth or availability without policy.

## 23. Notifications

**Decision:** deterministic threshold transitions create Core
`NotificationIntent`s with dedupe key `clockId + clockCycle + projectPolicyFacetRef +
thresholdIdentity`, where the closed identity is `WARNING:<warningIndex>` or
`BREACH`. Each crossing owns exactly one intent; v1 uses the fixed existing
Project `REQUEST_STATUS` notification route, whose delivery layer resolves the
authorized requester audience without multiplying threshold-emission rows. Hermes
may prepare wording from a bounded snapshot, but a deterministic template is
always available. Notification delivery failure does not roll back an SLA
transition. Repeated reads do not create messages.
The threshold event carries `slaClockId` plus an exact immutable
`clockRevisionRef`; the dynamic SLA read has a separate server-time
`evaluationHash` and is never represented as a stored revision. The Work Item
endpoint returns the exact distinct goal set enabled by the current authorized
Project policy facet, with every item bound to the path scope and one shared
server `asOf`. Before any facet is published it instead returns both closed v1
goals as `NOT_STARTED/POLICY_NOT_PUBLISHED`. For started clocks, composed validation resolves
`clockRevisionRef` and requires every duplicated immutable scope, goal/cycle,
pin, source and transition field to match; independently valid fragments cannot
form a response.
NotificationIntent ref uses the durable ID plus a JCS `creationHash` over immutable
creation columns; the mutable delivery `rowVersion`, state and attempts are not
part of the public event and cannot make a historical ref unresolvable.
Clock changes calculate `nextTemporalEvaluationAt` for the earliest configured SLA
threshold/breach or READY aging-band boundary. A bounded PostgreSQL due-row worker
performs the authoritative transition and an overdue sweep runs on startup and
periodically; BullMQ only accelerates wake-up. The worker appends a projection
revision only when a state/band changes, so time advances semantics without a
per-second tick stream or dependence on an unrelated source invalidation.

**Rationale:** threshold calculation is authority-bearing and deterministic; message
wording/delivery is an asynchronous convenience.

**Alternatives considered:** model decides breach risk; send directly from HTTP;
emit on every page load. Rejected for authority, durability and duplication.

## 24. Persistence and migration order

**Decision:** reserve Core `0130` for policy/calendar, `0135` for projection/SLA and
`0140` for controls/capacity; reserve QA `2070` for queue-fact revisions. Keep
Core `<1000`, QA `2xxx`, Jira `3xxx`, GitLab `4xxx`. No Jira, GitLab or Mock Hub
schema migration is required. Every history table rejects update/delete; current
heads advance with CAS in the same transaction. SQL migrations are schema-only and
never perform a cross-owner data read, because Core migrations precede QA `2070`
on a fresh installation.

After all registries complete, a feature-gated runtime bootstrap creates current
queue projections only—not historical SLA segments, accepted controls, claims or
reservations. A distinct checkpointed current-state capacity reconciliation then
runs under the Workspace lock before `ENFORCED` commands are enabled. It may create
claims/reservations for exact current facts and records unavoidable overflow as a
non-discretionary decision, but never invents prior occupancy history. Until both
phases validate, the Workspace remains `MEASURE_ONLY`/`REBUILDING` and new
capacity-increasing commands fail closed.

**Rationale:** these are the next monotonic owner ranges and isolate immutable
configuration, rebuildable reads and serialized commands.

**Alternatives considered:** append to Feature 004/005 migrations; store queue
tables in Jira connector; one monolithic migration; fabricate historical start
times. Rejected for immutability, ownership and rollback safety.

## 25. Public contracts and compatibility

**Decision:** register Feature 006 at schema contribution order `600` and publish
outer `competency-qa@1.3.0` plus inner `qa.validation@1.3.0`. In
`manifest-v1.3.ts`, `qaCompetencyManifestV13` spreads the frozen V12 pack and
maps the six inherited automation-event declarations from the generic V12 QA
schema ref to their exact already-published Feature 005 refs/digests, then appends
four exact Feature 004/006 declarations; `qaValidationWorkTypeDefinitionV13`
spreads the frozen V12 Work Type, changes only `definitionVersion`, and adds the
queue Work Item action UI contribution while retaining connector capability requirements.
`index.ts`/`node.ts`, runtime composition and the local seed select the V13 exports;
serialized V12 pack/work-type bytes and digests remain pinned by regression tests.
Core contribution 600 owns the new `queue.*` operation/permission catalog; the QA
manifest does not pretend that connector capability requirements are permissions.

Publish JSON Schema 2020-12 for policy/calendar, queue entry,
capacity/admission, SLA read snapshot/immutable clock transition/threshold emission, stage transition, durable
order-view invalidation, QA queue-fact invalidation, the existing
automated-Session-ready payload, safe queue-action candidate, private control
witness, Approval subject v2 and TriageAssessment `1.1.0`; publish the primary
queue OpenAPI 3.1 plus an additive Core Approval 1.1 existing-route response union,
and AsyncAPI 3.0 for queue/WIP/SLA events. Existing 001–005
files/digests and older manifest versions remain unchanged. API GETs return
projections only and use opaque cursors plus strong quoted JCS response-hash ETags;
the page validator binds its server `asOf`, normalized query/page boundary,
authorized generation and effective order state. Commands require request key,
expected version and exact subject. Schemas are closed and semantically validated.

The published canonical EventEnvelope v1 is not modified even though its
non-hierarchical `$id` and relative child `$ref`s are not directly compilable by a
strict generic resolver. AsyncAPI embeds a field-for-field transport mirror whose
parity with the canonical file is a contract test, then narrows it per message;
payload schemas remain separately registered with exact SHA-256 digests over the
RFC 8785/JCS bytes of each parsed JSON document, never source-file bytes.

The V13 outer event corrections are the six existing Feature 005 automation
payload refs already used by their emitters; additions are the existing Feature
004 triage created/stale payload refs,
`urn:awp:schemas:qa:event-payload:automated-session-ready:v1`, and the new
queue-facts invalidation ref. The automated-session UoW changes future
writes from a raw eight-field object to canonical EventEnvelope + exact
payloadSchemaRef. Existing raw READY rows are immutable: a bounded compatibility
reader validates that exact eight-field payload and trusted row scope/type, then
invokes the local projector through a payload-only path. It does not synthesize
producer, actor, classification, correlation, causation or entity-version fields,
does not claim EventEnvelope validity and never rewrites/republishes history. A
contract test reads committed new-envelope bytes and tests legacy record replay as
a separate compatibility path.

**Rationale:** wire-level separation is testable offline and additive versioning
preserves deployed consumers.

**Alternatives considered:** TypeScript-only interfaces; overwrite Feature 004
triage schema; online `$ref`; generic PATCH of queue rows. Rejected because none
enforces runtime compatibility or exact mutations.

## 26. Local contour and test strategy

**Decision:** use `qa-jira-gitlab-mattermost-local` with existing stateful mocks and
deterministic model fallback. Add a Feature 006 scenario catalog that seeds at least
two visible Projects and one forbidden Project, without a new mock database owner.
Required tests cover stage truth tables, pre-aggregation isolation, comparator
components, concurrent admission/override, forced external overflow, calendar
golden vectors, SLA pause/reconciliation, model/Jira/Mattermost/GitLab outages,
PostgreSQL 17/18 migration matrix, browser visibility and full-process restart.

**Rationale:** Feature 006 consumes all existing integration facts but introduces no
new provider protocol. Stateful upstream mocks already provide the required source
events/failures.

**Alternatives considered:** in-memory-only tests; live corporate systems as an
acceptance prerequisite; a new queue mock service. Rejected because concurrency,
isolation and recovery require the real local persistence/runtime path.

## 27. Technical baseline and performance envelope

**Decision:** retain Node `24.20.x`, pnpm `11.21.x`, TypeScript `6.0.3`, Nx `23.1.x`,
Nest `11.2.x`, React `19.2.x`, TypeORM `1.1.0`, BullMQ `6.3.x`, Ajv `8.20.x`,
Vitest `4.1.x` and Playwright `1.62.x`. Add no date/ranking package. Before a
measured performance SLO exists, enforce cursor pagination, bounded page size,
index-backed authorized joins, a constant number of SQL round trips per page, zero
provider/model calls on GET, and load evidence over a declared synthetic fixture.

**Rationale:** repository capabilities are sufficient and unmeasured latency claims
would repeat the same mistake prohibited for SLA/WIP targets.

**Alternatives considered:** add an optimization/forecasting library; publish an
invented p95; compute portfolio in browser. Rejected as unnecessary, ungrounded or
unsafe.

## 28. Observability and evidence

**Decision:** bounded metrics cover stage counts per authorized operational scope,
queue age, candidate conversion, WIP occupancy/debt/denials, soft-limit warnings,
SLA elapsed/risk/pause, projection lag/rebuild repairs, stale assessment/override
rate and manual system switches. Audit/evidence binds correlation, source and policy
refs, comparator version, input/output hashes, actor and reason. Metrics never
encode Work Item IDs, titles or forbidden Project totals as labels. Security tests
query API, cursors, logs, metrics and exports for count/facet leakage.

**Rationale:** transparency includes why a decision occurred without turning
high-cardinality or restricted content into telemetry.

**Alternatives considered:** item IDs as metric labels; global unfiltered counts;
log full assessment inputs. Rejected for cardinality, scope and privacy.

## 29. Resolved ambiguity register

| Question | Resolved outcome |
|---|---|
| What is one WIP unit? | One distinct Work Item demanding human QA attention. |
| Does automated RUNNING consume human WIP? | No; it consumes GitLab runner capacity. AUTOMATED REVIEW_REQUIRED does consume human WIP. |
| Can an external fact exceed hard WIP? | It is persisted as forced overflow and blocks later discretionary starts; it is never discarded. |
| What starts SLA? | First post-feature confirmed Jira-owned start-state observation, at platform confirmation time. |
| What happens without numeric pilot values? | `MEASURE_ONLY`/`NOT_CONFIGURED`; no guessed target or enforcement. |
| Does Hermes rank the queue? | It proposes explained factors; accepted comparator inputs and overrides remain HUMAN/Core-owned. |
| Is Jira priority changed by service class/order? | No; Jira change remains a separate exact Connector command and confirmed read. |
| Can hidden Projects affect returned counts/positions? | No; entitlement filtering precedes aggregation and cursor creation. |
| Are old READY items backdated at rollout? | No; a fresh authoritative observation starts a new clock at confirmation time. |
| Is a new Connector/service required? | No; 006 consumes existing local facts and deployment units. |
