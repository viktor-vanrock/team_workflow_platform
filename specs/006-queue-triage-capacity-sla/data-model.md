# Data Model: Queue, triage, capacity and SLA

**Feature:** `006-queue-triage-capacity-sla`
**Phase:** 1 design
**Status:** Complete for task generation
**Normative companions:** [plan.md](plan.md), [research.md](research.md),
[contracts/](contracts/)

## 1. Model boundary

Feature 006 adds four related but separately owned models:

1. QA publishes exact, provider-neutral planning and execution facts.
2. Platform Core derives a rebuildable queue projection from Core, Jira and QA
   facts.
3. Platform Core stores HUMAN-accepted queue controls and serializes capacity
   admission.
4. Platform Core calculates SLA clocks from confirmed operational facts and a
   pinned immutable policy/calendar.

The model does **not** add a second editable workflow. Jira continues to own
operational status, priority, due date and assignee. QA continues to own readiness,
Session and Verdict meaning. A queue revision can explain those facts but cannot
rewrite them.

```text
immutable source facts              human decisions
----------------------              ---------------
Candidate / Draft facts ───────┐     accepted service class ─┐
confirmed Jira projection ─────┼──→  queue input snapshot     ├──→ queue view
QA readiness/activity facts ───┘             │                │
                                             ├──→ stage/order ┘
published policy + calendar ─────────────────┼──→ SLA clocks
capacity claims/reservations ────────────────┴──→ admission state

TriageAssessment ── proposal ref only ──→ explicit HUMAN accept/override command
```

## 2. Shared conventions

### 2.1. Identity and scope

- IDs are opaque server-generated UUIDs unless an existing aggregate supplies an
  opaque ID of another format. Clients never infer tenancy from an ID.
- Every table containing Workspace data has `workspace_id` in its primary or
  candidate key. Every Project-content row also has `project_id` and a composite
  scope foreign key or a repository-level scope proof when the upstream table
  cannot accept a new constraint.
- A queue subject is the tagged union `CANDIDATE | DRAFT | WORK_ITEM`. Exactly one
  corresponding subject ID is non-null. Candidate and Draft rows retain their
  original owner scope; portfolio reads may include them only when their Project
  scope is both known and authorized.
- A converted Candidate or linked Draft is suppressed in favor of its Work Item
  projection so the same request cannot be counted twice.
- `principal_id`, Role and Project Entitlement are authorization facts. Required
  capabilities and current availability are planning facts. Neither implies the
  other.

### 2.2. Header/revision pattern

Mutable identity and immutable history use a common pattern:

```text
<aggregate>_heads
  id, workspace_id, [project_id], current_revision_id, resource_version,
  created_at, updated_at

<aggregate>_revisions
  id, head_id, workspace_id, [project_id], revision_number,
  previous_revision_id, semantic_hash, recorded_at, recorded_by,
  correlation_id, causation_id, ...immutable content
```

Rules:

- `resource_version` is a monotonic `bigint` used for compare-and-swap commands.
- `revision_number` starts at one and is unique per header.
- `previous_revision_id` must refer to the same header and scope.
- `semantic_hash` is SHA-256 over RFC 8785-style canonical JSON of decision or
  projection content, excluding storage IDs and `recorded_at`.
- Revisions are append-only. Correction creates a new revision with explicit
  reason; it never updates or deletes the old revision.
- Current pointers are updated in the same transaction that appends the revision,
  audit record and outbox event.
- All timestamps are timezone-aware UTC instants. Calendar-local values are stored
  only inside a versioned calendar document with an IANA timezone.

### 2.3. Exact source reference

Every authority-bearing projection input is represented by:

```typescript
type ExactSourceRef = {
  sourceType: string;
  sourceId: string;
  sourceVersion: string | number;
  semanticHash: string;       // lowercase sha256
  observedAt?: string;        // provider/source observation time
  confirmedAt?: string;       // platform confirmation/application time
};
```

An input set is sorted by `(sourceType, sourceId, sourceVersion, semanticHash)` and
hashed. Timestamp recency alone is never an exact reference.

### 2.4. Freshness

Queue reads use a closed freshness state:

- `CURRENT`: every mandatory source equals its current header/ref;
- `STALE`: a newer source is known, a configured freshness deadline elapsed, or a
  referenced recommendation no longer matches its inputs;
- `ERROR`: the last deterministic projection attempt failed and the preceding
  projection is retained;
- `REBUILDING`: this exact visible subject/Project is being recalculated while its
  prior validated revision remains readable. A Workspace-global or hidden-Project
  rebuild flag is never projected into an authorized page.

`STALE`, `ERROR` and `REBUILDING` are response states, not invented authority.
Any command that increases capacity or changes accepted control requires a fresh
local re-read under lock and fails on stale required authority.

### 2.5. Canonical hash boundaries

All contract digests are `sha256:` plus SHA-256 of the RFC 8785/JCS bytes of the
parsed JSON document; whitespace and object-key order in the source file are not
part of the digest. A registered `SchemaRef.digest` uses that rule exactly.

Self-identifying projections use these non-recursive boundaries:

- a top-level `semanticHash`, `contentHash`, `actionHash`, `publicIntentHash` or
  `evaluationHash` is computed over the complete semantic object with that one
  hash field omitted, unless the schema names a narrower immutable projection;
- `policyViewRef.semanticHash`, `authorizedProjectionRef.semanticHash`,
  `appliedOverrideRef.semanticHash` and
  `invalidationRef.semanticHash` hash the complete containing public object with
  the named ref wrapper omitted;
- `policyFacetRef.semanticHash` hashes the independently persisted Project or
  authorized-scope policy-facet document with its own ref wrapper omitted. The
  same facet ref is therefore reusable unchanged in QueueEntry, SLA, capacity and
  action-candidate documents;
- `clockRevisionRef.semanticHash` hashes the stored immutable SLA transition
  revision only. `sla-snapshot.evaluationHash` separately hashes the complete
  read-time response without `evaluationHash`; `asOf` and derived elapsed/remaining
  fields therefore never mutate the clock revision;
- the public queue-action candidate hash covers its complete closed document.
  The paired internal execution witness hash covers its complete private document
  without `actionHash`; neither hash is derived from the other;
- stable input/source-set hashes sort only where the owning contract explicitly
  declares a set. Normative arrays such as comparator components and warning
  thresholds retain their declared order.

For every nested versioned ref, its `id` equals the durable aggregate/projection
identity and its `version` equals the referenced immutable revision number.

## 3. Reused source aggregates

Feature 006 references, and does not replace, these existing aggregates:

| Source owner | Existing aggregate | Fields consumed |
|---|---|---|
| Core | `IntakeCandidate` / Draft lifecycle | scope, subject state, linked Work Item, observations/decisions |
| Core/Jira authority | `WorkItem`, `OperationalBinding`, `OperationalProjectionRevision` | Jira key, raw/normalized status, priority, due, assignee, mapping refs, provider/confirmed times, freshness |
| Core security | membership, Project Entitlement, classification policy | authorized Project set before query/aggregation |
| QA | input and `ReadinessAssessment` revisions | current DoR state, waiver, input fingerprint |
| QA | required-session plan and `TestSession` revisions | mode, state, started/review/blocked/completed instants, required capabilities |
| QA | automated attempt/result revisions | runner activity, terminal technical result and review requirement |
| QA | DoD, final-close confirmation and signed Verdict | SLA stop and completed explanation facts |
| Core | Approval, PlatformAction, audit and request idempotency | exact override lifecycle and provenance |
| Core | outbox/inbox and NotificationIntent | reliable invalidation, derived events and notifications |

The new operational query port must read the current
`operational_projection_revisions` row through the current binding. The existing
lightweight adapter that maps `work_items.state=OPEN` to `NEW` is insufficient for
queue authority and must not be used by Feature 006.

## 4. Migration Core 0130: policy and calendar

### 4.1. `workspace_business_calendar_heads`

One stable calendar identity per Workspace/key.

| Column | Constraint / meaning |
|---|---|
| `calendar_id` | PK |
| `workspace_id` | required scope |
| `calendar_key` | non-empty, unique with Workspace |
| `current_revision_id` | nullable until first publication |
| `resource_version` | monotonic CAS value |
| `created_at`, `updated_at` | platform instants |

### 4.2. `workspace_business_calendar_revisions`

Immutable published business-time definition.

| Column | Constraint / meaning |
|---|---|
| `calendar_revision_id` | PK |
| `calendar_id`, `workspace_id` | same-scope composite FK |
| `revision_number`, `previous_revision_id` | append-only chain |
| `time_zone` | validated IANA zone; fixed offsets are rejected |
| `weekly_intervals` | JSON array of local weekday `[start,end)` intervals; normalized, non-overlapping |
| `date_overrides` | JSON array of closed or explicitly working local dates/intervals |
| `valid_from`, `valid_through` | first defined local date and nullable inclusive end; null means the immutable recurrence remains defined for all future dates |
| `dst_algorithm_ref` | constant `business-calendar-dst@1.0.0` for v1 |
| `source_ref`, `source_hash`, `owner_principal_id` | required publication provenance |
| `effective_from`, `published_at` | new clocks select latest effective published revision |
| `semantic_hash` | canonical content hash |

Calendar algorithm `business-calendar-dst@1.0.0` resolves an ambiguous local start
to the earliest matching instant, an ambiguous local end to the latest matching
instant, and a nonexistent boundary to the first valid instant after the gap.
Arithmetic is performed over UTC instants after deterministic bounded expansion of
the pinned local rules. A null `valid_through` is an explicit immutable commitment:
the weekly recurrence plus the declared dated overrides define every future local
date. `date_overrides.date` is unique within a revision across CLOSED and WORKING
variants; publication rejects a same-date conflict and defines no precedence.
Later holiday/calendar publications do not alter an existing clock. Finite
revisions remain valid import/archive artifacts but cannot be activated by a queue
policy, because an unbounded pause/resume cycle could otherwise outlive their
coverage. Golden vectors cover DST gaps, overlaps, midnight boundaries, overrides
and adjacent intervals.

### 4.3. `workspace_queue_policy_heads`

One stable policy identity per Workspace/key. The pilot uses key `qa-default` but
the database does not hard-code that key.

| Column | Constraint / meaning |
|---|---|
| `queue_policy_id` | PK |
| `workspace_id`, `policy_key` | unique pair |
| `current_revision_id` | nullable before publication |
| `resource_version` | CAS version |
| `created_at`, `updated_at` | platform instants |

### 4.4. `workspace_queue_policy_revisions`

An immutable policy document governs comparator, capacity and SLA for new
decisions/clocks.

| Field | Rule |
|---|---|
| `mode` | `MEASURE_ONLY | ENFORCED` |
| `comparator_ref` | `queue-order@1.0.0` for v1 |
| `stage_rule_ref` | `queue-stage@1.0.0` for v1 |
| `calendar_revision_id/hash` | exact same-Workspace published calendar |
| `workspace_human_wip_limit` | null in `MEASURE_ONLY`; positive integer required in `ENFORCED` |
| `active_expedite_limit` | null in `MEASURE_ONLY`; positive integer required in `ENFORCED` |
| `external_active_consumes_wip` | closed normalized Jira status set |
| `block_reason_rules` | normalized status/reason to `HOLD_WIP | RELEASE_WIP` and SLA behavior |
| `sla_goals` | exact goal, start/stop rule, target and warning threshold definitions |
| `aging_bands` | ordered positive business-duration boundaries; may be empty in measurement mode |
| `project_entries` | soft limits/reservations keyed by an existing Project; no authorization effect |
| `effective_from`, `published_at`, `published_by` | publication provenance |
| `baseline_evidence_ref` | required for `ENFORCED`, optional for `MEASURE_ONLY` |
| `semantic_hash` | canonical document hash |

Supported SLA goals are closed for v1:

- `READY_TO_FIRST_QA_START`, stopped by the first accepted consuming Session start;
- `READY_TO_SIGNED_VERDICT`, stopped by an exact signed QA Verdict.

Each enabled goal has `targetBusinessSeconds` and ordered warning thresholds in
`ENFORCED`; the target is null and breach/warning thresholds are empty in
`MEASURE_ONLY`. No migration, fixture or default constructor supplies a production
number.

Project policy entries contain only `projectId`, nullable `softWipLimit`, nullable
`reservedCapacity`, and an explanation. They emit warnings and routing facets but
cannot bypass the hard Workspace gate or provide Project access.

The full policy revision and its header version are internal because an otherwise
unchanged publication may modify only another Project's entry. Core therefore
maintains three immutable, content-derived public projection families alongside
the full revision:

- a Workspace-neutral policy view excluding all `project_entries`, the full
  baseline-evidence ref and publisher/source identities; its status-mapping ref is
  the closed `JIRA_STATUS_MAPPING_REVISION` family;
- a Project policy facet containing the neutral fields plus only that Project's
  optional entry;
- an authorized-scope policy facet containing the neutral fields plus entries for
  the exact server-derived `authorized_project_set_hash`.

Each family has its own stable opaque ID, current-revision head and semantic hash.
A source publication maps internally to a projection revision, but no public
revision is appended when its serialized bytes are unchanged. Thus a hidden-only
entry change cannot alter `policyViewRef`, `policyFacetRef`, body timestamps or an
ETag. Public refs never reuse the full policy revision number/hash; internal clocks,
admission witnesses and queue execution witnesses retain the full source ref.

Concretely, Core 0130 creates
`workspace_queue_policy_view_heads/revisions`,
`project_queue_policy_facet_heads/revisions` and
`authorized_scope_queue_policy_facet_heads/revisions`, plus
`authorized_scope_queue_policy_facet_projects`. Project heads are unique by
`(workspace_id, project_id, policy_key)`; authorized-scope heads are unique by
`(workspace_id, authorized_project_set_hash, policy_key)`. Revisions retain the
internal source-policy ref for recomputation but serialize only their safe body and
own ref. Each authorized-scope head persists one membership row per Project, and a
constraint/repository invariant recomputes the canonical set hash from exactly those
rows. For Project scope the set is the canonical singleton Project. Publication
updates the neutral view and changed Project facets in its transaction. Existing
authorized-scope facets are refreshable by joining changed Projects to their
membership rows; every authorized read/command also reconciles or materializes its
exact current scope before returning/using a ref. It appends only when safe bytes
change, so hidden-only source changes may advance an internal reconciliation
watermark but never the public head/version.

### 4.5. Policy publication invariants

- Publication is a HUMAN command authorized for current Workspace policy
  management and protected by expected header version plus idempotency key.
- The JSON document validates against `queue-policy.v1`; referenced calendar and
  Projects must exist in the same Workspace.
- The referenced calendar revision must have `validThrough=null`. This makes READY
  aging and any clock pinned to the policy total for an unbounded lifetime; a finite
  calendar fails publication rather than failing after a later pause/resume.
- `ENFORCED` requires baseline evidence, all mandatory numerical capacity fields,
  and complete numerical target/threshold data for every enabled SLA goal.
- `MEASURE_ONLY` rejects hidden numerical enforcement. It records flow facts and
  clocks but never denies a start for an absent limit or reports a breach.
- A new revision applies to later admission decisions and later clock starts.
  Existing clocks remain pinned; no silent historical reinterpretation occurs.

### 4.6. `workspace_queue_configuration_requests`

Calendar and queue-policy publication are Workspace-scoped configuration commands,
not project-scoped PlatformActions. The existing Approval, PlatformAction and
client-request idempotency tables require `project_id`, so Feature 006 does not put
a Workspace Owner command into them with a fabricated Project.

This Core 0130 table stores `(workspace_id, actor_principal_id, operation,
idempotency_key_hash)` as its unique request identity together with request hash,
expected calendar/policy header version, draft semantic hash, authorization-basis
hash, bounded outcome, published revision ref, audit ref and timestamps. Same
key/hash replays and another hash conflicts. Publication performs current Workspace
authorization, CAS, revision append, request outcome, audit and outbox in one local
transaction. It requires no Project Entitlement and grants no Project content
access or reusable approval.

## 5. Migration QA 2070: queue planning facts

### 5.1. `qa_queue_fact_heads`

One current provider-neutral QA fact bundle per Work Item.

| Column | Constraint / meaning |
|---|---|
| `qa_queue_fact_head_id` | PK |
| `workspace_id`, `project_id`, `work_item_id` | unique scoped subject |
| `current_revision_id` | required after first projection |
| `resource_version` | CAS/projector version |
| `created_at`, `updated_at` | platform instants |

### 5.2. `qa_queue_fact_revisions`

Immutable bundle emitted through `QueuePlanningFactsContribution@1.0.0`.

```typescript
type QaQueueFacts = {
  workspaceId: string;
  projectId: string;
  workItemId: string;
  qaInputRef: ExactSourceRef;
  readinessRef: ExactSourceRef | null;
  readiness: "NOT_ASSESSED" | "NEEDS_INFO" | "READY" | "READY_WITH_WAIVER" | "STALE";
  requiredSessionPlanRef: ExactSourceRef | null;
  requiredCapabilities: Array<{ capability: string; minimumClaimVersion?: string }>;
  activities: Array<{
    sessionId: string;
    sessionRef: ExactSourceRef;
    mode: "MANUAL" | "AUTOMATED";
    state: "PLANNED" | "READY" | "RUNNING" | "REVIEW_REQUIRED" | "BLOCKED" | "COMPLETED" | "CANCELLED";
    startedAt: string | null;
    reviewRequiredAt: string | null;
    blockedAt: string | null;
  }>;
  automationRefs: ExactSourceRef[];
  firstConsumingStartAt: string | null;
  signedVerdictRef: ExactSourceRef | null;
  sourceRefs: ExactSourceRef[];
  sourceSetHash: string;
};
```

Arrays are canonically sorted. The QA projector appends a revision only on a
semantic change. Core references the revision; it never has a foreign key to a
`qa_*` semantic table and never imports QA domain types.

### 5.3. TriageAssessment 1.1.0

Published `triage-assessment@1.0.0` stays byte-identical. V1.1 remains stored in the
existing triage assessment revision/content model and adds schema-validated:

- byte-compatible scalar values under the existing `dimensions` object, plus the
  additive `dimensionDetails` object containing per-dimension `confidence`,
  `explanation` and exact fact refs;
- `missingInformation[]` with closed keys, including
  `BUSINESS_IMPACT_MISSING`;
- explicit `inputFingerprintComponents` for current Jira, QA and automation facts;
- `ruleVersion` and `skillVersion`.

When business impact is absent, the only valid output profile has
`dimensions.businessImpact=UNKNOWN`, its `dimensionDetails.businessImpact`
evidence, and `BUSINESS_IMPACT_MISSING`. A total opaque score is not part of the
schema. Assessment state and accepted control state remain separate; accepting
selected fields copies them into a Core control revision.

### 5.4. Source event coverage

Outer `competency-qa@1.3.0` and inner `qa.validation@1.3.0`, implemented as
`qaCompetencyManifestV13` and `qaValidationWorkTypeDefinitionV13`, extend their
separate frozen V12 objects. The inner definition adds the queue Work Item UI
action and retains the V12 connector requirements; the outer points to it, maps
the six inherited automation declarations from the generic V12 QA events schema
to the exact Feature 005 refs/digests already used by their emitters, and then
adds four events. The resulting declaration map has one entry per event type. QA
2070 plus schema contribution 600 close these contract gaps without
rewriting either published V12 object or old events:

- correct all six `qa.automation-*` declarations without changing V12 bytes;
- register `qa.triage-assessment.created` and `.stale`;
- register `qa.automated-session.ready` already emitted by automated execution;
- emit a provider-neutral `qa.queue-facts.changed` invalidation after the fact-head
  transaction commits through the outbox.

`qa.automated-session.ready` uses the closed physical
`qa-automated-session-ready.v1` payload schema. New rows store a canonical
EventEnvelope and exact schema ref/digest. Pre-006 rows containing only its exact
eight-field payload remain immutable and use a payload-only internal compatibility
path: the adapter validates the raw payload, proves its Workspace/Project and
event type match the trusted outbox columns, and invokes the same idempotent local
projector input function with row ID/created time as transport metadata. It does
not synthesize missing producer, actor, classification, correlation, causation or
entity-version fields; it never claims canonical-envelope validity and is never
republished. A collision with a canonical event ID or any mismatch fails closed.

## 6. Migration Core 0135: queue projection and SLA

### 6.1. `queue_projection_generations`

| Column | Meaning |
|---|---|
| `generation_id` | PK |
| `workspace_id` | rebuild scope |
| `state` | `BUILDING | VALIDATING | ACTIVE | SUPERSEDED | FAILED` |
| `source_high_watermarks` | canonical JSON map of source/projector cursors |
| `input_set_hash`, `output_set_hash` | reproducibility/equality evidence |
| `subject_count`, `stage_counts` | scoped validation only, never an unfiltered public total |
| `started_at`, `validated_at`, `activated_at`, `failed_at` | lifecycle |
| `failure_code` | bounded internal code; no secret content |

At most one generation is ACTIVE per Workspace and at most one is BUILDING or
VALIDATING. Ordinary event projection writes the active generation. Rebuild writes
a shadow generation then atomically flips the Workspace active pointer after
catch-up and validation. This generation ID, its counters and flip time are
internal. QueueEntry exposes only its own exact revision tuple. QueuePage computes
`projectionGeneration = sha256(canonical(authorizedProjectSetHash, comparatorRef,
sorted[projectId, projectVisibleSetHash]))`, where a Project visible-set hash
covers sorted unsuppressed QueueEntry ID/revision/semantic-hash tuples effective at
page `asOf`. Thus an identical visible projection remains byte-stable across an
internal flip without inventing a separately persisted public generation entity.
QueuePage freshness is the deterministic aggregate of only its already-authorized
visible entry/Project projection statuses; a hidden-Project-only rebuild cannot
change it. Workspace generation state remains operational telemetry with no public
projection.

### 6.2. `queue_entry_heads`

One current projection identity per effective subject.

| Column | Constraint / meaning |
|---|---|
| `queue_entry_id` | PK |
| `workspace_id`, `project_id` | required Project content scope |
| `subject_kind` | `CANDIDATE | DRAFT | WORK_ITEM` |
| `candidate_id`, `draft_id`, `work_item_id` | exactly one non-null, matching kind |
| `current_revision_id` | current active-generation revision |
| `resource_version` | projector CAS value |
| `next_temporal_evaluation_at` | nullable indexed SLA/READY-band transition due instant; PostgreSQL recovery truth |
| `suppressed_by_work_item_id` | nullable; suppressed rows never appear/count |
| `created_at`, `updated_at` | platform instants |

Unique partial indexes enforce one unsuppressed entry for each subject kind and
scope. Linking/conversion suppresses the precursor and creates/updates the Work
Item entry in one projector transaction.

### 6.3. `queue_entry_revisions`

Each immutable revision stores the derived view and its explanation:

| Group | Fields |
|---|---|
| identity | revision/header/generation/scope/subject, Jira display key when applicable |
| stage | `CANDIDATE | BACKLOG | READY | ACTIVE | COMPLETED`, detail and reason-code arrays |
| authority display | raw and normalized Jira status, priority, due, assignee, operational freshness; copied only as a labelled projection |
| QA display | readiness, required capabilities, activity origins, planning effort/risk/impact facts |
| capacity display | `NOT_CONSUMING | RESERVED_REVIEW | OCCUPIED | RELEASED_BLOCK | FORCED_EXTERNAL`, WorkItem-local claim/reservation cause-set hash only |
| SLA display | goal snapshots or `NOT_STARTED | NOT_CONFIGURED`; exact clock refs |
| order | Candidate Inbox tuple or Work Item comparator ref/components, explanations and base rank key; no scalar AI score |
| consistency | stable warning codes such as `JIRA_READY_WITHOUT_CURRENT_DOR`, `EXTERNAL_STATE_AHEAD`, `SESSION_STATE_AHEAD`, `TERMINAL_WITH_OPEN_QA` |
| freshness | queue freshness, source freshness map, calculated/reconciled instants |
| lineage | exact source refs, queue control ref, Project policy-facet ref/hash, input fingerprint, derivation rule ref |

Serialized source refs use a closed Project-safe family allowlist (intake/work
item, confirmed Jira projection/mapping, QA fact/session/automation/triage/verdict,
queue-control, WorkItem-local claim/reservation and SLA-clock revisions). Full
QueuePolicy, Workspace capacity-head/set and authorization-record refs are
structurally forbidden. Composed validation additionally proves the expected
family for each property and the same Workspace/Project scope.

`finalOrdinal` is never stored. It is calculated after authorization filtering and
manual-move application for one response/as-of tuple.

### 6.4. Stage reducer `queue-stage@1.0.0`

The reducer uses this strict precedence:

1. Effective pending/snoozed Candidate or a Draft not linked to a confirmed Work
   Item → `CANDIDATE` with original detail.
2. Work Item with confirmed Jira `DONE | CANCELLED` → `COMPLETED`; open QA activity
   becomes a consistency warning, not a rewritten Jira state.
3. Started Session in `RUNNING | REVIEW_REQUIRED | BLOCKED` or confirmed configured
   Jira active/review/blocked state → `ACTIVE`, with activity origins listed.
4. Confirmed Jira `READY | PLANNED`, current QA readiness
   `READY | READY_WITH_WAIVER`, and no active fact → `READY`; `PLANNED` adds
   `COMMITTED` detail.
5. Every other accepted Work Item → `BACKLOG`, with stable missing/pending/stale
   reasons.

Candidate/Backlog never create a human WIP claim. SLA is evaluated separately: a
confirmed configured Jira READY state can start SLA while absent current DoR keeps
the queue stage in Backlog.

### 6.5. Comparator `queue-order@1.0.0`

The page algorithm first applies the closed display partition
`CANDIDATE`, `BACKLOG`, `READY`, `ACTIVE`, `COMPLETED`. This is a stable view
partition, not a priority comparison between unlike lifecycle stages.

Candidate/Draft entries store `ordering.state=CANDIDATE_INBOX` and the fully
returned tuple `(enteredInboxAt ascending, subjectKind, subjectId)`. They do not
accept service-class or manual-order controls. Accepted Work Items store
`ordering.state=COMPUTED`; within each Work Item stage their component tuple is
lexicographic and fully explainable:

1. service class band: `EXPEDITE`, `FIXED_DATE`, `STANDARD`;
2. SLA state: `BREACHED`, `AT_RISK`, `ON_TRACK`, explicit `NOT_STARTED`,
   `NOT_CONFIGURED`, then `urgencyTiming`. The latter is the earliest applicable
   exact instant among the first-start goal's latest-safe-start, active SLA target
   and confirmed Jira due-date end interpreted by the pinned Workspace timezone;
   equal instants use that basis order, the chosen basis/source ref is returned,
   and unknown/not-applicable values occupy closed stable buckets;
3. versioned confirmed Jira priority mapping, unknown last;
4. HUMAN-accepted risk severity and business impact, unknown last;
5. HUMAN-accepted dependency readiness, unknown last; dependency-source drift
   marks the accepted control stale instead of silently changing this component;
6. versioned working-time READY aging band; raw business seconds are explanatory
   elapsed time sampled at the revision's `calculated_at`, not a continuously
   changing sort field;
7. `readyAt` ascending, null last;
8. normalized Jira display key with deterministic C collation;
9. Work Item ID.

Effort is returned for planning but does not determine business priority. Model
confidence is never a comparator or authorization component.

### 6.6. `sla_clock_heads`

One clock per `(workspace_id, project_id, work_item_id, goal)`.

| Column | Meaning |
|---|---|
| `sla_clock_id` | PK |
| scoped Work Item + `goal` | unique identity |
| `current_revision_id`, `resource_version`, `current_clock_cycle` | current append-only state and monotonic service cycle |
| `policy_revision_id/hash`, `calendar_revision_id/hash` | pinned at start |
| `next_temporal_evaluation_at` | next warning/breach instant calculated with the pinned calendar and indexed for due scans |
| `created_at`, `updated_at` | storage lifecycle |

No clock is created for Candidate/Draft. A Work Item clock begins only when a local
read/webhook/reconciliation revision first confirms the configured Jira-owned start
state. The platform `confirmedAt/appliedAt` is used; provider event time is retained
for lag metrics but never backdates enforcement.

For an item already in the configured start state when Feature 006 is enabled, an
unchanged Feature 003 reconciliation is a reducer `DUPLICATE` and cannot masquerade
as a new operational projection revision. A gated rollout verifier therefore
performs an authoritative Jira read and persists an immutable
`sla_rollout_authority_verifications` receipt containing the exact operational
projection ref, provider revision token/authority-fields hash, mapping ref,
observed state, verifier run ref and platform `confirmed_at`. A same-scope match may
be used as the clock `startSourceRef` even when the Feature 003 reducer returns
`DUPLICATE`; failure or mismatch leaves `ROLLOUT_CONFIRMATION_REQUIRED`. The receipt
does not rewrite Jira projection history and is created at most once per
WorkItem/goal/policy-enable epoch.

### 6.7. `sla_clock_revisions` and `sla_clock_segments`

Clock states within a cycle are `NOT_STARTED → RUNNING ↔ PAUSED → STOPPED`.
Confirmed reopen/new service starts a new monotonic cycle under the same
`sla_clock_id`: its START revision immediately follows and references the prior
cycle's STOP revision, resets cumulative elapsed to zero and never changes prior
cycle facts. Each persisted
revision has a durable public `sla-clock-transition@1.0.0` projection; that is the
payload of `sla.clock.*` events and the target of `clockRevisionRef`. It contains
no `asOf`, freshness, remaining-time, read-time target state or `evaluationHash`.
A revision contains:

- transition `START | PAUSE | RESUME | STOP`; an unchanged reconciliation is an
  idempotent no-op and appends neither a clock revision nor an event;
- exact triggering operational/QA source ref;
- `effective_at` from platform-confirmed authority;
- cumulative business seconds through that instant;
- pinned policy/calendar/algorithm refs and input fingerprint.

Target state, remaining business seconds and computed target instant are derived
in `sla-snapshot@1.0.0` for a server-selected read time. Threshold crossings remain
separate immutable emission facts. Consequently one stored transition has one
canonical event payload even as later reads change from on-track to at-risk or
breached.

Each `RUNNING` or `PAUSED` interval is an immutable half-open segment with start,
nullable end, reason code and opening/closing revision refs. Only one open segment
exists per clock. An unknown pause reason leaves the clock RUNNING. A Jira outage
or stale read preserves the last confirmed state; it does not invent a pause.

Public SLA refs are structurally typed: mapping refs are
`JIRA_STATUS_MAPPING_REVISION`; start sources are either a confirmed
`JIRA_OPERATIONAL_PROJECTION_REVISION` or the one-time
`SLA_ROLLOUT_AUTHORITY_VERIFICATION`; pause boundaries use a confirmed Jira
projection; segment refs are `SLA_CLOCK_SEGMENT_REVISION`; stop sources are
goal-specific `QA_TEST_SESSION_REVISION` or `QA_VERDICT_REVISION`. Composed checks
prove same scope, clock cycle/lineage and goal/ref compatibility.

Reads calculate current elapsed time as persisted closed-segment business seconds
plus the calendar intersection from an open RUNNING segment start through a
server-selected `asOf = now`, echoed in the response. Clients cannot supply an
evaluation instant. The Work Item response contains each goal enabled by the
current authorized Project policy facet exactly once; without a published facet it
returns both closed v1 goals as `NOT_STARTED/POLICY_NOT_PUBLISHED`. It repeats the
path scope on every snapshot and shares one `asOf`. A started snapshot resolves
`clockRevisionRef` and must match its transition field-for-field for scope,
goal/cycle, pins, sources, state and effective time; STOP and PAUSE details must
match the corresponding transition source/reason. Provider observation time must
come from the resolved start authority. Target and warning values must equal the
pinned policy goal, and remaining time, target instant and risk state derive from
those exact inputs. There are no per-second tick writes. Every clock/queue transition
also records the earliest next SLA warning/breach or READY aging-band boundary.
A bounded worker claims due PostgreSQL rows, recalculates under the pinned calendar
and appends only semantic state/band changes; BullMQ is a wake-up accelerator, not
truth. Startup and periodic overdue sweeps recover lost jobs and process every
threshold through the idempotent emission table below.

### 6.8. `sla_threshold_emissions`

One idempotent notification fact per
`(clock_id, clock_cycle, project_policy_facet_ref, threshold_kind)` where threshold kind
is `WARNING_<index> | BREACH`. It records exactly one NotificationIntent ref using
the fixed v1 Project `REQUEST_STATUS` route, calculated time, outbox ref and
semantic hash. That public ref is `(notificationIntentId, creationHash)`, where
the hash covers the existing intent's immutable creation tuple and excludes its
mutable delivery state, attempts and `rowVersion`. Its public payload carries
`slaClockId` plus the exact immutable
`clockRevisionRef`; it never labels the dynamic `sla-snapshot` read DTO as a clock
revision. The two IDs must match. Audience resolution happens in the existing
delivery layer and does not change emission cardinality. Rebuild may correct the clock but cannot replay an
already emitted external effect; any explicit corrective notification has a new
correction kind and audit link.

## 7. Migration Core 0140: controls and capacity

### 7.1. `work_item_queue_control_heads/revisions`

One head per scoped Work Item; immutable revisions contain accepted planning
values only:

- effective service class `STANDARD | FIXED_DATE | EXPEDITE`;
- optional expiry/review instant and previous effective class;
- HUMAN-accepted risk/business-impact/dependency/effort fields;
- referenced TriageAssessment ID/version/hash, if used as evidence;
- per-field before/after, reason and acceptance provenance;
- policy and operational/readiness refs validated at the decision;
- state `ACTIVE | EXPIRED | SUPERSEDED`.

Top-level `QUEUE_CONTROL_ACCEPT` is structurally split into closed effects.
`ACCEPT_PLANNING_VALUES` carries one preserved service class plus before/after
planning-only values. `SET_FIXED_DATE` carries the single retained planning-value
object and may change only `STANDARD` to `FIXED_DATE` with a confirmed due-date
ref. `CLEAR_SERVICE_CLASS` carries the single retained planning-value object and
is the sole `FIXED_DATE` to `STANDARD` path. Any transition into or out of
`EXPEDITE` uses its dedicated capacity-serialized action; accepting unrelated
triage fields can never silently clear or create EXPEDITE.

`STANDARD` is the effective default even when no head exists. `FIXED_DATE` requires
a current confirmed Jira-owned due date. `EXPEDITE` requires an exact approved
PlatformAction. Neither changes Jira priority or due.

### 7.2. `queue_order_scope_heads`

Allocates monotonic move sequence and queue epoch for a `PROJECT` lane or an
authorized `PORTFOLIO` scope.

| Column | Meaning |
|---|---|
| `order_scope_id` | PK |
| `workspace_id` | required |
| `scope_kind` | `PROJECT | PORTFOLIO` |
| `project_id` | required only for PROJECT |
| `authorized_project_set_hash` | required only for PORTFOLIO; exact canonical entitled/classified set identity |
| `next_sequence`, `queue_epoch`, `resource_version` | locked allocation/CAS values |
| `current_base_set_hash` | last reconciled visible/base subject set hash; not a public count |

Unique identities are `(workspace_id, PROJECT, project_id)` and
`(workspace_id, PORTFOLIO, authorized_project_set_hash)`. A head advances only
for a move or base-visible-set change applicable to that exact identity. A new
entitlement/classification set resolves a separate head (with the documented
zero/no-head sentinel); old heads remain audit history. A forbidden-only Project
change cannot advance an authorized portfolio version or epoch.

`queue_order_scope_projects` stores `(order_scope_id, project_id)` for every
PORTFOLIO head. The first accepted move creates the head and its rows atomically
from the trusted server-derived authorized set; reads before that use the documented
zero/no-head sentinel and never materialize a head. A constraint/repository invariant
recomputes `authorized_project_set_hash` from the rows. The base-set projector joins
a changed Project through this table and advances only existing heads containing it,
so it never needs to reverse a hash or enumerate entitlement combinations.

### 7.3. `queue_order_overrides`

Append-only move operation:

```text
subject_work_item_id
target_queue_entry_id / revision / semantic_hash / input_fingerprint
placement = FIRST | LAST | BEFORE | AFTER
anchor_project_id? / anchor_work_item_id? // requested keys; required only for BEFORE/AFTER
sequence
expected_order_scope_version
expected_projection_generation
base_comparator_ref
authorized_project_set_hash
before_list_hash / after_list_hash
expected_queue_epoch
reason
approval_ref
effective_from / expires_at
state = ACTIVE | EXPIRED | SUPERSEDED | INVALIDATED
```

Readers authorize and filter first, base-sort, then resolve the requested anchor
keys and apply active moves by sequence. The stored keys do not assert that an
anchor exists. A filtered/missing anchor is a no-op and does not reveal whether it
exists. Resolution happens before any Approval creation: an unavailable anchor
produces a terminal consumed `ANCHOR_UNAVAILABLE_NO_OP` candidate with
`NO_SECOND_APPROVAL`, no expiry and no public anchor. The raw requested key is
retained only in the private witness/idempotency audit; no unconsumable pending
Approval is created. Its consumed receipt `resultRef` is the durable public
`QUEUE_ACTION_CANDIDATE` itself—`(action_id, 1, public_intent_hash)`—not a
nonexistent public no-op audit revision and never the private witness. Canonical QueueEntry revisions/events never embed an order override: one
portfolio move can have different outcomes for overlapping authorized Project
sets. Instead each QueuePage item may carry an `appliedOrderOverride` calculated
for that exact scope head/set, with a redacted view-local ref, scope, placement,
`APPLIED | ANCHOR_UNAVAILABLE_NO_OP`, reason, accepted time and expiry—never the
requested anchor identity or internal action hash. Expiry is present only for an
applied move; the terminal unavailable-anchor no-op has none. Its ref hash is JCS of the
complete `AppliedOrderOverride` with `appliedOverrideRef` omitted. Its opaque ID is
deterministic UUIDv5 over the retained `(order_scope_id, subject_work_item_id,
effective_override_revision_id)` and its version is the exact order-scope
`resource_version` used for the page. It is therefore reproducible after restart
from retained scope/override history without creating a read-time mutable row. A later move for the same
subject supersedes its effective placement in that scope but not its history.
Absolute ordinals and mutable priority numbers are not stored.

### 7.3.1. `queue_order_invalidation_heads/revisions`

One durable invalidation head exists per
`(workspace_id, project_id, work_item_id)` **only for the PROJECT lane**. Whenever
an accepted, expired, superseded or base-visible-set change alters that Project
lane's order, the command/projector appends one closed
`queue-order-view-invalidated@1.0.0` revision and advances the head in the same
transaction. The payload contains only scope IDs, a bounded reason and occurrence
time; it contains no anchor, portfolio-set hash, ordinal, free-text reason or
internal action hash.

`invalidationRef.id/version/hash` identify the durable revision; its hash excludes
the wrapper. The EventEnvelope uses `entityId = workItemId` and
`entityVersion = invalidationRef.version`. Consumers treat `queue.order.changed`
as a hint to re-read the Project lane and derive order under current authorization.
A PORTFOLIO move or expiry never fans out a target-Project event: doing so would let
a Project-only subscriber infer activity in a wider authorized set. The command
receipt and exact portfolio head/version inform the caller; other portfolio readers
observe it on their next authorized poll, while ordinary Project-scoped source/
QueueEntry events already invalidate base-set changes visible to them.

### 7.4. `queue_action_candidates`

Exact action payloads integrate with the existing Approval/PlatformAction model.
Action kinds are closed:

- `QUEUE_CONTROL_ACCEPT`;
- `QUEUE_ORDER_OVERRIDE`;
- `SERVICE_CLASS_EXPEDITE`;
- `EXPEDITE_CAPACITY_OVERRIDE`;
- `WIP_ADMISSION_OVERRIDE`.

Every stored PlatformAction is Project-scoped and owns two immutable projections
under the same opaque `action_id`:

1. `queue-action-candidate@1.0.0` is the complete caller-visible intent, requested
   effect and authorized QueueEntry/page/capacity-facet tokens. Its RFC 8785
   content hash is `public_intent_hash`.
2. `queue-control-action@1.0.0` is an internal execution witness that additionally
   binds the full policy ref, Workspace capacity head/count/set witnesses and
   trusted idempotency/authorization context. Its `action_hash` is recomputed over
   all internal semantic fields except itself.

The table stores both schema IDs/versions and hashes, the closed public candidate
JSON, the closed private witness JSON, the private initiating authorization-basis
JSON/hash and creation/expiry state. Unique `(workspace_id, project_id, action_id)`
and one-to-one candidate/witness constraints prevent replacement under an existing
Approval. Full authorization evidence is available to audit/consumption but is
not a field of the public PLATFORM_ACTION Approval resource.

Public/private effect mapping is explicit rather than structural equality. For an
applicable order move both carry `MOVE_ORDER`; for an unavailable anchor the safe
candidate carries only `{kind=ANCHOR_UNAVAILABLE_NO_OP, placement}` while the
private witness also retains `requestedAnchor`. The mapper and conformance tests
reject every other cross-document pairing. For queue-control acceptance both
documents carry the same discriminated effect kind and semantically equal
service-class/planning values and refs; the public schema's typed refs map to the
corresponding exact internal refs.

Core creates additive `approval-subject:v2` for actions needing another human.
Its SchemaBoundValue target is the public candidate; `payloadHash`, candidate
`contentHash` and the receipt `publicIntentHash` are identical. Its
`expectedLocalState` pins candidate `{actionId, version=1, resourceVersion=1,
contentHash}`, the stable candidate-header version and
`currentPublishedVersion=0`. Unlike frozen v1, the PLATFORM_ACTION branch forbids
fabricated Binding/Profile refs; EXTERNAL_COMMAND still requires them. Core reads
v1 and v2, writes v2 for new Feature 006 actions and includes the subject schema
ID/version in canonical hashing. The generic Approval view is not redacted: it is
safe because its candidate contains no global witness and its PLATFORM_ACTION
authorization fields are viewer-safe scope witnesses, not membership,
entitlement or role-assignment record IDs.

The narrow public request never accepts trusted actor/authorization context or a
caller-invented hash. Consumption resolves the immutable internal witness by the
already-approved action ID, reauthorizes, recomputes both hashes and rechecks all
visible and hidden state under the relevant lock in the same transaction. Hidden-
Project-only churn may invalidate the internal witness without changing the public
hash; action identity prevents an Approval from being applied to a replacement
witness.

The public candidate is still subject-authorized data. For an authorized-
portfolio move, Approval v2 publishes only an `AuthorizationScopeWitness` with the
Workspace, permission and exact authorized Project-set hash; the complete
initiator/approver authorization bases remain private execution/audit evidence.
For Project scope, the witness hashes only the target Project authorization facet,
never the actor's wider entitlement set. Approval GET and decision first authorize
the path Project without disclosure, then require current access to every Project
named by target/anchor and equality with the recomputed authorized Project-set
hash. A Lead who sees only the target Project receives the same 404/timing class
as a missing Approval and never receives the candidate bytes or opaque
authorization-record IDs.
For WIP/EXPEDITE policy overrides, `SELF_APPROVAL_FORBIDDEN` requires a currently
authorized QA Lead distinct from the initiating HUMAN. SERVICE/Hermes never
approves. Consumption reauthorizes and rechecks the exact state under the relevant
lock. `EXPEDITE_CAPACITY_OVERRIDE` additionally pins the originating
public `SERVICE_CLASS_EXPEDITE` candidate ref, whose ref semantic hash is exactly
its public intent hash, plus the paired private execution-witness `actionHash` and
complete before-class/after-`EXPEDITE`/review-time effect. Composed validation
requires the same action ID/kind/effect; it cannot authorize a reconstructed,
unrelated or different expedite mutation.

`SET_EXPEDITE`, capacity override and WIP override require expiry and a distinct
approver. `CLEAR_EXPEDITE` is a QA Lead exact action under the capacity-first lock
but uses `NO_SECOND_APPROVAL` and no expiry; fixed-date clearing remains
`QUEUE_CONTROL_ACCEPT`. A denied admission creates a WIP override candidate only
when the caller supplied schema-closed `overrideIntent {reason, expiresAt}` and
policy permits escalation. Without it, the immutable denial is the only result.
For `MANUAL_SESSION_RESUME`, its requested state is the exact `blockedFrom`
milestone on the pinned Session revision (`RUNNING | REVIEW_REQUIRED`); only that
activity may request `REVIEW_REQUIRED`. Manual starts and automated launches
request `RUNNING`.

### 7.5. `workspace_capacity_heads`

One serialized capacity state per Workspace and current policy revision.

| Column | Meaning |
|---|---|
| `workspace_capacity_id` | PK |
| `workspace_id` | unique |
| `policy_revision_id/hash` | policy used by next decision |
| `human_occupied_count` | distinct current claimed Work Items |
| `review_reserved_count` | distinct current reserved-only Work Items |
| `human_committed_count` | cardinality of union(claimed, reserved) |
| `forced_external_count` | claims created by unavoidable external facts |
| `active_expedite_count` | distinct Active EXPEDITE Work Items |
| `claim_set_hash`, `reservation_set_hash`, `expedite_set_hash` | canonical current-set hashes |
| `capacity_state` | `MEASURE_ONLY | AVAILABLE | AT_LIMIT | OVER_CAPACITY_EXTERNAL | REBUILDING` |
| `resource_version`, `reconciled_at` | lock/CAS and freshness |

Counts are cached integrity witnesses, not standalone truth. The transaction
recomputes or incrementally validates them against current rows before an admission
decision. A database constraint enforces non-negative counts and
`human_committed_count <= human_occupied_count + review_reserved_count`; the exact
union is verified by repository invariant checks.

### 7.5.1. `capacity_scope_projection_heads/revisions`

Public capacity refs resolve to durable authorization-filtered projections rather
than the global head. Heads are keyed by `(workspace_id, scope_kind,
project_id|null, authorized_project_set_hash)` for one Project or one exact
authorized portfolio. For Project scope the set hash is the canonical singleton
Project, never the actor's wider entitlement set. Revisions store the closed `capacity-snapshot@1.0.0` body,
monotonic `authorizedProjectionRef` ID/version/hash, public policy-facet ref, and
internal source capacity-head version. The projection hash is RFC 8785 over the
complete document excluding the ref wrapper itself, avoiding a self-hash. The
internal source version is never serialized.

`capacity_scope_projection_projects` persists one `(projection_head_id, project_id)`
row per member, including the singleton Project form. Creation uses the current
trusted authorization result and atomically verifies that its canonical hash equals
the head key. The service filters claims/reservations/controls to that authorized
set before
deriving counts/set hashes and appends a revision only when public semantic bytes
change. A hidden-only source change that leaves the authorized projection unchanged
only updates an internal reconciliation watermark;
it cannot advance the public ref. Admission before/after refs point to exact
persisted revisions, making every public ref resolvable after restart and suitable
for event replay. Project-local changes can eagerly find affected persisted scopes
through the membership rows; every capacity read/admission still reconciles or
materializes its current exact scope under the relevant source-version check.

### 7.6. `work_item_human_wip_claims`

At most one current claim per scoped Work Item. It stores a sorted cause set:

- MANUAL Session `RUNNING` or `REVIEW_REQUIRED`;
- AUTOMATED Session `REVIEW_REQUIRED`;
- configured confirmed external active/review state;
- held post-start block;
- `FORCED_EXTERNAL` ingestion without prior discretionary reservation.

The head/current row has `ACTIVE | RELEASED_BLOCK | RELEASED_TERMINAL`, source-set
hash, acquired/released instants and current revision. Claim revisions are
append-only. Multiple Sessions for the same Work Item never create multiple human
occupancy units.

### 7.7. `review_capacity_reservations`

At most one current reservation per scoped Work Item. A platform-controlled
AUTOMATED launch creates `HELD`; terminal result converts it to a WIP claim in the
same transaction and marks it `CONVERTED`. Cancellation before review marks it
`RELEASED`. If a human claim already exists, the reservation can be represented as
`COVERED_BY_CLAIM` and does not add to the union count.

The reservation is not displayed as active human WIP. It is a durable future-review
commitment used only for admission headroom and capacity explanation. Each
revision stores a sorted WorkItem-local reservation cause set and
`reservation_cause_set_hash`; QueueEntry exposes that value with the exact
reservation ref. The Workspace-global `reservation_set_hash` never enters a
QueueEntry, its `sourceRefs`, `inputFingerprint` or Project event.

### 7.8. `capacity_admission_decisions`

Immutable record for every discretionary admission attempt and every
non-discretionary reconciliation:

| Group | Fields |
|---|---|
| request | request/idempotency key, action kind, target Work Item and nullable Session for external Jira facts, actor/auth basis |
| expected | policy/control/session/operational refs and versions |
| before | counts, claim/reservation/EXPEDITE set hashes, violated constraint set |
| outcome | `ADMITTED | DENIED | ADMITTED_WITH_EXACT_OVERRIDE | NON_DISCRETIONARY_APPLIED | NON_DISCRETIONARY_OVERFLOW | NO_CHANGE` |
| effect | claim/reservation/session/control refs created or changed |
| approval | nullable exact Approval/PlatformAction/action hash |
| after | counts and set hashes |
| provenance | reason, correlation/causation, decided/recorded times, semantic hash |

Those count/set/head fields are the internal persistence witness used for exact
locking and approval recheck. The public API/event `capacity-admission@1.0.0`
projection exposes only the policy mode and authorized-scope snapshot ref in
`before`/`after`; it never serializes global state, head version, count or set hash
whose change could reveal hidden Project activity. Its operation-local outcome and
violations explain only why the caller's authorized target mutation did or did not
occur; the internal global `capacity_state` is not a reusable public snapshot.
Committed-effect refs are structurally limited to Project-safe Session, WIP-claim,
review-reservation and queue-control revisions. A consumed override returns a
closed Approval-v2 subject ref plus a `QUEUE_ACTION_CANDIDATE` v1 ref whose
semantic hash equals `publicIntentHash`; neither position can carry a global
capacity/policy ref or private `actionHash`.
Composed dereference validation requires the candidate ID, action/effect kind,
target and public hash to equal those declarations, and requires Approval v2's
action ID, SchemaBoundValue target, target hash and payload hash to bind that same
candidate. An unrelated Approval or candidate can never authorize the decision.

The public decision schema closes activity/effect cardinality:

| `activityKind` | Actor | Committed public mutation refs |
|---|---|---|
| `MANUAL_SESSION_START | MANUAL_SESSION_RESUME` | HUMAN | exactly Session + human-WIP-claim revisions |
| `AUTOMATED_SESSION_LAUNCH` | HUMAN initiator | exactly Session + review-reservation revisions |
| `AUTOMATED_RESULT_APPLY` + `CONVERT_RESERVATION_TO_REVIEW_CLAIM` | SERVICE | exactly Session + reservation + claim revisions |
| `AUTOMATED_RESULT_APPLY` + `RELEASE_RESERVATION` | SERVICE | exactly Session + reservation revisions |
| `EXTERNAL_JIRA_RECONCILIATION` | SERVICE | one or more human-WIP-claim revisions; no Session ref |
| `SET_EXPEDITE | CLEAR_EXPEDITE` | HUMAN | exactly one Work Item queue-control revision; no Session ref |
| `EXPIRE_EXPEDITE` | SERVICE | exactly one Work Item queue-control revision; no Session ref |

`ADMITTED` and `NON_DISCRETIONARY_APPLIED` may carry only project-soft/reservation
warnings. `DENIED` requires a closed blocking constraint. Exact override requires
`ENFORCED` plus `HARD_WIP` or `EXPEDITE_SINGLETON`; MEASURE_ONLY can never report
either hard violation or external-overflow state. `NO_CHANGE` has no violation.
Its request projection uses `authorizationScopeWitnessHash` over only
`{workspaceId, projectId, requiredPermission, classificationDecision}`. The full
actor authorization-basis JSON/hash remains restricted internal audit evidence and
never turns another Project's entitlement churn into a public admission token.

Same idempotency key and same request hash returns the stored outcome. The same key
with another hash is a conflict.

Public action receipts are endpoint- and lifecycle-closed. Queue-control routes
return only `QUEUE_CONTROL_ACCEPT | SERVICE_CLASS_EXPEDITE`; order routes return
only `QUEUE_ORDER_OVERRIDE`. `resultRef` is forbidden before `CONSUMED`. A
consumed control-accept action resolves a Work Item control revision, a consumed
order action resolves an order-override revision (or its own public candidate for
the unavailable-anchor no-op), and EXPEDITE/WIP admission actions resolve a
capacity-admission decision.

## 8. State transitions

### 8.1. Queue subject

```text
CANDIDATE --confirmed/linked--> BACKLOG
BACKLOG --current DoR + confirmed Jira READY--> READY
READY --first consuming activity / confirmed active Jira--> ACTIVE
ACTIVE --confirmed terminal Jira--> COMPLETED

Any Work Item stage --source correction/reconciliation--> deterministically derived stage
```

The arrows describe common derived changes, not editable state-machine commands.
Reconciliation may derive a different stage while keeping every prior revision.

### 8.2. Human capacity

```text
NONE --manual start/review/external active--> OCCUPIED
NONE --automated launch---------------> REVIEW_RESERVED
REVIEW_RESERVED --result needs review-> OCCUPIED   (no union-count increase)
REVIEW_RESERVED --cancel--------------> NONE
OCCUPIED --mapped releasing block------> RELEASED_BLOCK
RELEASED_BLOCK --resume----------------> OCCUPIED   (new admission)
OCCUPIED --all causes terminal---------> NONE
NONE --unavoidable external fact-------> FORCED_EXTERNAL_OCCUPIED
```

### 8.3. SLA

```text
NOT_STARTED --confirmed configured Jira state--> RUNNING
RUNNING --confirmed mapped pause reason--------> PAUSED
PAUSED --confirmed mapped resume state---------> RUNNING
RUNNING|PAUSED --exact goal stop fact----------> STOPPED
```

Policy/calendar publication cannot transition an existing clock.

## 9. Transaction boundaries and lock order

### 9.1. Projection update

1. Consume source invalidation through the existing inbox.
2. Read current exact Candidate/Draft, operational, QA, control, policy and capacity
   refs locally.
3. Run pure stage/order/SLA display reducers.
4. Lock the scoped queue-entry head.
5. Re-read current head and compare canonical input fingerprint.
6. If changed, append revision, update head, audit consistency changes and append
   derived outbox events; otherwise record inbox success as a no-op.
7. Commit. No provider/model call occurs inside or after a queue GET.

### 9.2. Manual start or resume

Use one PostgreSQL `SERIALIZABLE` transaction:

1. lock `workspace_capacity_heads` for the Workspace;
2. lock Work Item queue-control head;
3. lock target QA Session/current revision in the shared transaction-aware UoW;
4. re-read current policy, operational freshness, readiness/activity and current
   claim/reservation cause sets;
5. validate authorization independently from capabilities;
6. evaluate WIP and EXPEDITE constraints;
7. consume an exact still-valid override if required;
8. atomically transition Session, append/restore claim, update capacity head,
   append admission/audit/outbox records;
9. commit.

SQLSTATE `40001`/`40P01` gets a bounded retry with a new database transaction but
the same request identity. Business denial is not retried.

### 9.3. Automated launch

The existing automated-session launch UoW takes the same capacity lock before
publishing provider work. It creates/validates the Session/Attempt and a
`REVIEW_CAPACITY_RESERVATION` atomically with the launch outbox intent. A provider
call is never made when the database transaction denied admission.

### 9.4. Automated terminal result

Result ingestion remains idempotent and authority-preserving:

- with a matching reservation, convert it to one human claim and move Session to
  `REVIEW_REQUIRED` in one transaction, recording `NON_DISCRETIONARY_APPLIED`;
- with an existing claim, close/cover the reservation without double count;
- without a reservation, accept the result or Jira observation and create a
  `FORCED_EXTERNAL` claim. Record `NON_DISCRETIONARY_APPLIED` while within the
  limit, or `NON_DISCRETIONARY_OVERFLOW` plus a Lead alert above it;
- never discard, delay or rewrite the technical result to protect a counter.

### 9.5. Queue control/order command

For any action that adds, removes, expires or overrides EXPEDITE, lock the
Workspace capacity head first, then the target control head and recheck the exact
capacity/control witness. Atomically update the control revision and active
EXPEDITE count/set hash; a stale approval is invalidated and cannot be repurposed.
Other control actions lock the target control head directly. Order moves then lock
their order-scope head. Reauthorize the actor, validate expected versions and
source refs, consume the exact approval, allocate move sequence, append
control/move/audit/outbox and advance resource versions in one transaction. A move
target must be currently entitled. Anchors are resolved only inside the already
authorized visible set; a hidden or missing anchor is the same accepted no-op.

### 9.6. Rebuild

1. Capture a repeatable-read source snapshot and high-watermarks.
2. Build shadow generation entries by Workspace/Project cursor.
3. Validate subject uniqueness, scope, hashes, stage counts and capacity set
   equality.
4. Under Workspace locks, consume changes after high-watermarks.
5. Atomically flip the active generation.
6. Emit only semantic correction events; do not replay external effects or old SLA
   notifications.

## 10. Query and authorization model

### 10.1. Project lane

Authenticate a HUMAN, verify active Workspace membership, authorize the exact
Project through Project Entitlement/classification policy, then query only that
`(workspace_id, project_id)` partition. Item-detail lookup includes both scope keys;
an inaccessible and nonexistent item have the same external response shape.

### 10.2. Portfolio

1. Verify `queue.portfolio.read` in the Workspace.
2. Resolve the current authorized Project ID set server-side.
3. Join that set to queue-entry and capacity/SLA rows **before** count, facet,
   aggregation, sorting or pagination.
4. Apply base comparator then visible manual moves.
5. Return visible-only counts and response-local ordinals.

A cursor binds:

```text
principalId
workspaceId
authorizedProjectSetHash
normalizedQueryHash
comparatorRef
authorizedProjectionGeneration
asOf
lastVisibleSortTuple
```

The first page chooses `asOf` from the server clock. Every cursor page re-evaluates
current authorization first, then reads immutable projection revisions and
effective control/order revisions at or before that same instant. Entitlement,
policy or generation drift, unavailable retained history or any token mismatch
invalidates the cursor. Logs, metrics and
traces use bounded codes and counts after the same authorization boundary; they do
not attach forbidden item IDs or raw request content.

The queue-page ETag is a strong quoted SHA-256 of the exact returned JCS JSON body,
not merely the projection generation. It therefore binds the server `asOf`,
normalized filters, cursor/page boundary, authorized generation and effective order
head represented in that body. Item and capacity GETs use the same strong exact-
representation rule over their persisted public DTO. Internal Workspace generation
or capacity-head versions are never ETag inputs.

Authorized reads also make exact commands constructible without leaking the global
capacity head. Each Work Item QueueEntry returns `(queueEntryId, revision,
semanticHash, inputFingerprint)` plus `control.resourceVersion` (`0` for the
default/no-head state). Each QueuePage returns an `orderState` containing its
scope-head resource version, queue epoch and authorized base-visible-set hash; the
page returns comparator, the canonical authorized-view generation digest and
authorized Project-set hash; neither its order head nor generation uses the
internal Workspace rebuild identity. The
existing authorized QA Session read supplies Session resource version. These are
the only public CAS inputs; internal capacity version/count/set witnesses are
locked and re-derived server-side.

The policy read similarly returns only its independent Workspace-neutral
`policyViewRef` and view ETag. QueueEntry/SLA use a Project `policyFacetRef`, while
capacity pages use the facet for the exact authorized set. Source-policy IDs,
versions and hashes remain internal and are never copied into public hashes.

### 10.3. Availability and routing

Routing may compare Work Item required capabilities with current HUMAN capability
claims and separately supplied availability/capacity facts. It returns a planning
explanation only. It does not grant Project visibility, role permission, claim a
Session or auto-assign a person.

## 11. Events

Source invalidations consumed by the projector include Candidate/Draft changes,
confirmed operational projection updates, QA readiness/session/automation/final
Verdict changes, control/policy/calendar publication and capacity decisions.
QA owns and emits the registered Project-scoped `qa.queue-facts.changed` payload;
it contains only exact changed fact refs/kinds and triggers a local re-read.

Feature 006 emits provider-neutral events:

- `queue.projection.updated`;
- `queue.stage.changed` with exact previous/current QueueEntry refs, stages and
  bounded transition reasons;
- `queue.control.changed`;
- `queue.order.changed` with the durable Project-scoped
  `queue-order-view-invalidated@1.0.0` payload; consumers re-read their own
  view-local order scope and the event never serializes a QueueEntry, portfolio
  set, anchor or internal action identity;
- `capacity.admission.decided`;
- `capacity.occupancy.changed`;
- `capacity.over-limit-detected`;
- `sla.clock.started | paused | resumed | stopped` with the immutable
  `sla-clock-transition@1.0.0` payload, never the dynamic SLA read snapshot;
- `sla.warning | breached` with exact threshold index/kind, clock cycle,
  idempotency hash and NotificationIntent ref.

Event ID is deterministic from source semantic identity plus output semantic hash.
The canonical envelope always carries scope, aggregate identity/version and
correlation/causation. Payloads carry derivation refs, public policy facets and
bounded reason codes only where their closed per-event schema declares them; no
generic field is fabricated for QA READY, invalidation, capacity or SLA payloads.
Consumers deduplicate by `(consumer_key,event_id)` and reject a duplicate ID with
a different payload hash.
Every QueueEntry revision emits exactly one of the two QueueEntry event names on
the same projection channel: `queue.control.changed` iff a Work Item control
transition caused it, otherwise `queue.projection.updated`. Every capacity
decision emits `capacity.over-limit-detected` iff its outcome is
`NON_DISCRETIONARY_OVERFLOW`, otherwise `capacity.admission.decided`. These pairs
are mutually exclusive; stage transitions and capacity-projection changes have
their own entity identities/versions and may accompany them safely.
Before inbox gap/version handling, both producer and consumer apply the normative
contract table that equates envelope scope/entity/version/time and any duplicated
correlation fields with the payload's durable identity. A mismatch is quarantined
and cannot advance a cursor for either the claimed or actual aggregate.

## 12. Migration, backfill and compatibility

### 12.1. Order

1. Core `0130`: policy/calendar heads and immutable revisions.
2. Core `0135`: generations, queue entries and SLA clock history.
3. Core `0140`: controls, order moves, capacity heads/claims/reservations/decisions.
4. QA `2070`: queue-fact heads/revisions and current indexes.

Registries remain owner-ordered. The obsolete migration test that assumes Core
ends at `0095` and QA at `2030` must be replaced with current additive inventory or
owner/prefix/monotonicity assertions; published migrations are never edited.

### 12.2. Expand/backfill/validate

1. **SQL expand/validate:** Core `0130`–`0140` and QA `2070` create their own
   tables, nullable current pointers, constraints, indexes and append-only guards.
   They are schema-only; no Core migration reads QA data or creates a projection,
   SLA clock, control, claim or reservation.
2. **Runtime projection bootstrap:** only after all owner registries complete, a
   feature-gated worker projects existing accepted Work Items from current
   confirmed local facts into one shadow generation. It may derive
   Backlog/Ready/Active/Completed, but never invents Candidate conversion, an old
   SLA start, service class, control, claim or reservation. Existing Work Items
   receive no retroactive clock. A genuinely new qualifying operational revision
   starts it; already-qualifying items require the separate post-enable
   authoritative verification receipt described above, including the
   Feature 003 duplicate-read path.
3. **Runtime current-state capacity reconciliation:** before `ENFORCED` admission
   becomes available, a separately checkpointed worker locks each Workspace and
   materializes claims/reservations from exact current Session, automation and
   configured operational causes. It records `NON_DISCRETIONARY_APPLIED` when the
   current fact fits and `NON_DISCRETIONARY_OVERFLOW` plus external debt when it
   does not. This establishes present occupancy only; it never reconstructs a
   historical occupancy interval or erases activity.
4. **Activation validation:** prove same-scope references, unique current heads,
   append-only guards, semantic hashes and current-set/count equality before the
   shadow generation switches and `ENFORCED` commands are allowed. Until then,
   readers expose `REBUILDING` and new capacity-increasing commands fail closed.

### 12.3. Downgrade and replay

Feature disablement stops new consumers/commands but preserves tables and history.
Rollback code can ignore additive tables; migrations are not destructively undone
in production. Fresh, upgrade, repeat, current-minus-one and injected failure
recovery run on PostgreSQL 17 and 18.

## 13. Indexes and integrity constraints

Minimum indexes:

- queue entries `(workspace_id, project_id, suppressed, stage, updated_at,
  queue_entry_id)` and `(workspace_id, work_item_id)`;
- projection revisions `(queue_entry_id, revision_number desc)` and
  `(workspace_id, generation_id, input_fingerprint)`;
- QA facts `(workspace_id, project_id, work_item_id)` and revision descent;
- controls `(workspace_id, project_id, work_item_id)` and active expiry scan;
- order moves `(order_scope_id, state, sequence)` and expiry scan;
- order invalidations `(workspace_id, project_id, work_item_id)` unique heads and
  revision descent;
- public policy/capacity projection heads by exact scope and revision descent, plus
  reverse membership indexes `(project_id, scope_head_id)` for authorized policy,
  capacity and portfolio-order scopes;
- action candidates `(workspace_id, project_id, action_id)` unique with one
  immutable public/private pair;
- current claims/reservations `(workspace_id, state, work_item_id)` with partial
  unique active rows;
- decisions `(workspace_id, idempotency_key)` unique plus target/time audit scan;
- clocks `(workspace_id, project_id, work_item_id, goal)` unique and threshold due
  scans by state/target instant;
- outbox/inbox indexes reused for delivery and dedupe.

Core database checks enforce closed states, non-negative counts/durations, tagged
subject union, required anchor/placement combinations, `expires_at > effective_at`,
and MEASURE_ONLY/ENFORCED nullability. Repository tests prove composite scope; no
global-ID-only fetch is allowed.

## 14. Retention and audit

Queue revisions, admission decisions, control revisions, SLA segments and
threshold emissions are business audit records and follow the existing Workspace
audit retention policy. Current read projections may be compacted only after their
input/output hashes and exact retained revisions make an explanation reproducible.
Deletion/erasure workflows remove or pseudonymize user content according to the
existing policy while retaining bounded decision reason codes and integrity hashes.

## 15. Required invariants and proving tests

1. **No dual authority:** changing a queue row cannot change Jira priority/due/
   status or QA readiness/Verdict.
2. **No double count:** one effective request yields one unsuppressed queue entry;
   one Work Item occupies at most one human WIP unit.
3. **Hard controlled admission:** in `ENFORCED`, no discretionary transaction can
   increase committed human capacity beyond the hard limit without one exact,
   still-valid approval.
4. **Authority convergence:** unavoidable external facts are accepted and visible;
   overflow becomes explicit debt and blocks later discretionary work.
5. **EXPEDITE:** a discretionary second active EXPEDITE is denied without an exact
   override; concurrent commands cannot both pass a stale check.
6. **Authorization first:** forbidden Projects cannot affect returned rows, counts,
   facets, ranks, cursors, metrics or timing-sensitive batch sizes.
7. **SLA confirmation:** pending Jira commands, local DoR and provider timestamps do
   not start/backdate SLA; only platform-confirmed configured Jira state does.
8. **Pinned history:** new policy/calendar revisions do not recalculate old clocks.
9. **Explainability:** stage, ordering and admission responses contain rule/policy
   refs, factors, exact sources and reason codes; no opaque total AI score exists.
10. **Model independence:** deterministic fallback/manual triage, queue, admission
    and SLA work while the model provider is unavailable.
11. **Replay equality:** duplicate/out-of-order invalidations and a full rebuild
    converge to the same current semantic hashes without duplicate notifications.
12. **Idempotency:** same key+hash replays; same key+different hash conflicts for
    every mutation.

## 16. Pilot-gated fields

The design is complete while these operational inputs intentionally remain absent:

| Input | Representation before pilot supplies it | Publication gate afterward |
|---|---|---|
| timezone/calendar source/owner | no effective calendar; setup is `SKIPPED_GATED`, not PASS | validated IANA calendar revision with owner/source/hash |
| baseline window/sample/metric owners | explicit baseline evidence status `NOT_CONFIGURED` | immutable evidence ref matching current metric definitions |
| hard WIP, EXPEDITE and project values | `MEASURE_ONLY`, all enforcement numbers null | positive values plus baseline ref in `ENFORCED` policy |
| SLA targets/warnings/pause mappings | clocks/elapsed facts may be measured; target state `NOT_CONFIGURED` | complete goal targets, ordered thresholds and closed mappings |

Tests use explicit fixture policy/calendar values labelled as test data. Fixture
numbers are never migration defaults or production recommendations.
