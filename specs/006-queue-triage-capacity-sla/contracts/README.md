# Feature 006 contract package

This directory is the Phase 1 interface package for
`006-queue-triage-capacity-sla`. It defines a provider-neutral, explainable QA
work queue without creating a second Jira workflow or allowing Hermes to own
business priority, accepted order, capacity admission or SLA state.

The package is a design input for implementation. A schema described here is
not runtime or release evidence until its registry, implementation and
conformance tests exist and pass.

## Authority and interpretation

Conflicts are resolved in this order:

1. Constitution 2.0.0 and the Feature 006 specification;
2. accepted decisions in `plan.md` and `research.md`;
3. exact JSON Schema `$id`, semantic version and published digest;
4. `capabilities.md` for operation, authorization and trusted-context rules;
5. examples and generated transport descriptions, which may not weaken an
   invariant above them.

Authority remains separated:

| Concern | Authority |
|---|---|
| Jira status, priority, due date and assignee | Latest confirmed Feature 003 operational projection |
| Candidate/Draft lifecycle | Platform Core Feature 004 aggregates |
| QA readiness, required work and Session state | QA Competency Pack |
| Technical automation activity | QA Feature 005 Attempt and Session facts |
| Queue stage, comparator, capacity ledger and SLA clock | Platform Core derived state |
| Accepted service class and manual order | Exact HUMAN queue-control revision |
| Recommendation | QA-owned TriageAssessment proposal |
| Workspace calendar and queue settings | Published immutable policy/calendar revisions |

No contract in this package makes a webhook, browser, model response, Redis job,
provider timestamp or pending Connector command authoritative.

The public policy read is an authorization-neutral Workspace view and omits the
source policy's unfiltered `projectEntries`; safe Project facets appear in
Project queue/SLA projections, and exact authorized-set facets appear only in the
already-filtered capacity projection. The calendar read exposes
Workspace configuration only. The neutral view also omits the full baseline-
evidence and publisher/source refs and exposes only the closed
`JIRA_STATUS_MAPPING_REVISION` mapping family. Policy/calendar publication is an internal admin
configuration contract and is not a route in this public queue OpenAPI v1.

## Schema catalog

- `schemas/business-calendar.v1.schema.json` — immutable Workspace calendar
  revision with IANA timezone, bounded interval arrays, dated closures/working
  overrides, explicit DST rules and exact source/algorithm commitments. A policy
  may activate only the open-ended (`validThrough=null`) form;
- `schemas/queue-policy.v1.schema.json` — published Workspace policy revision.
  `MEASURE_ONLY` represents missing pilot numbers explicitly; `ENFORCED`
  requires exact baseline evidence and numeric settings supplied after baseline;
- `schemas/queue-entry.v1.schema.json` — one entitlement-safe Candidate/Draft/
  Work Item projection with separate Jira authority, queue stage, source and
  projection freshness, explainable comparator components and WIP/SLA facets;
- `schemas/capacity-snapshot.v1.schema.json` — scoped, point-in-time counts of
  distinct occupied/reserved Work Items, with an explicit unconfigured union;
- `schemas/capacity-admission.v1.schema.json` — immutable serializable admission
  decision binding the exact request, subject, policy and authorized source set
  observed under lock; internal global head versions/set hashes are never public;
- `schemas/sla-snapshot.v1.schema.json` — explicit not-started/active/completed
  clock projection, pinned policy/calendar/source refs and target state;
- `schemas/sla-clock-transition.v1.schema.json` — immutable clock-revision event
  projection with exact lineage/source and no read-time evaluation fields;
- `schemas/sla-threshold-emission.v1.schema.json` — idempotent warning/breach
  emission with threshold identity, exact immutable clock-revision ref and
  NotificationIntent ref;
- `schemas/queue-stage-transition.v1.schema.json` — exact previous/current stage
  transition rather than an ambiguous second copy of a current projection;
- `schemas/qa-queue-facts-changed.v1.schema.json` — QA-owned Project-scoped
  invalidation carrying exact fact refs/kinds and no business-content duplicate;
- `schemas/qa-automated-session-ready.v1.schema.json` — closed physical payload
  for the existing QA READY outbox fact; V13 writes use canonical EventEnvelope,
  while a bounded reader validates immutable legacy raw payload rows in memory;
- `schemas/queue-control-action.v1.schema.json` — exact Platform Action payload
  used only as the private execution witness for service-class, manual-order and
  WIP overrides;
- `schemas/queue-action-candidate.v1.schema.json` — complete caller-visible
  immutable PlatformAction candidate whose content hash is the Approval v2
  payload hash;
- `schemas/approval-subject.v2.schema.json` — additive Core Approval successor:
  external commands retain exact Connector refs, while Feature 006 platform
  actions use a safe candidate plus viewer-safe authorization-scope witnesses;
- `schemas/queue-order-view-invalidated.v1.schema.json` — Project-lane-only durable
  order-view invalidation with no QueueEntry, anchor or portfolio-set payload;
- `schemas/triage-assessment.v1.1.schema.json` — additive Feature 004 assessment
  successor with bounded missing-information declarations, per-dimension detail
  and exact fingerprint components. Published v1.0 bytes remain unchanged.

All schemas use JSON Schema draft 2020-12 and closed objects. New Feature 006
families use stable `urn:awp:schemas:006:*` identifiers; the additive assessment
successor deliberately remains in its originating
`urn:awp:schemas:004:triage-assessment:*` family and Approval v2 remains in the
Core `urn:awp:contracts:*` family. All references resolve from the offline
registry. Digests are `sha256:<64 lowercase hex>` over RFC 8785/JCS bytes of the
parsed JSON document, never raw source-file bytes.

The package also publishes the primary
`openapi/queue-triage-capacity-sla-api.v1.yaml`, the additive existing-route
`openapi/core-approval-api.v1.1.yaml` response union, and
`asyncapi/queue-triage-capacity-sla-events.v1.yaml`.

### Canonical envelope binding

AsyncAPI shape validation is necessary but not sufficient because JSON Schema
cannot express equality between arbitrary envelope and payload properties. Every
producer and consumer therefore runs this composed binding validator before an
event enters version/gap sequencing:

| Event | Envelope `entityId` / `entityVersion` | Envelope `occurredAt` | Additional equality |
|---|---|---|---|
| `queue.projection.updated`, `queue.control.changed` | `payload.queueEntryId` / `payload.revision` | `payload.calculatedAt` | envelope and payload Workspace/Project |
| `queue.stage.changed` | `payload.transitionId` / `1` | `payload.occurredAt` | envelope and payload Workspace/Project |
| `queue.order.changed` | `payload.workItemId` / `payload.invalidationRef.version` | `payload.occurredAt` | `invalidationRef.id` resolves the named Project/Work Item head; envelope and payload Workspace/Project |
| `qa.queue-facts.changed` | `payload.invalidationId` / `1` | `payload.occurredAt` | envelope and payload Workspace/Project |
| `qa.automated-session.ready` | `payload.sessionId` / exact persisted Session revision entering READY | exact persisted Session READY occurrence | envelope Workspace/Project/Work Item resolve to that Session; legacy raw rows bypass canonical-envelope validation only through the documented compatibility adapter |
| `capacity.admission.decided`, `capacity.over-limit-detected` | `payload.admissionDecisionId` / `1` | `payload.decidedAt` | envelope Workspace/Project, `correlationId`, `causationId` and `recordedAt` equal payload fields |
| `capacity.occupancy.changed` | `payload.authorizedProjectionRef.id` / `.version` | `payload.reconciledAt` | payload scope is PROJECT and its project ID equals envelope Project; envelope Workspace equals payload Workspace |
| `sla.clock.started|paused|resumed|stopped` | `payload.slaClockId` / `payload.clockRevisionRef.version` | `payload.effectiveAt` | `clockRevisionRef.id=slaClockId`; envelope and payload Workspace/Project |
| `sla.warning`, `sla.breached` | `payload.thresholdEmissionId` / `1` | `payload.emittedAt` | envelope and payload Workspace/Project; warning/breach event type equals threshold kind |

Emission cardinality is part of this validator. Each new QueueEntry revision emits
exactly one event on `queueProjectionEvents`: `queue.control.changed` iff its
semantic cause is a Work Item control transition, otherwise
`queue.projection.updated`. Each capacity decision emits exactly one event:
`capacity.over-limit-detected` iff outcome is `NON_DISCRETIONARY_OVERFLOW`,
otherwise `capacity.admission.decided`. Dual emission of either pair is invalid,
so the second event can never be misclassified as stale in the shared entity stream.

`payloadSchemaRef` must equal the registered ID/version/JCS digest for the exact
payload document. `recordedAt >= occurredAt` remains the canonical envelope rule.
A producer cannot publish and a consumer must quarantine (without advancing its
inbox cursor) any mismatch. Contract vectors mutate each duplicated scope, ID,
version, time, correlation and causation field independently.

[`examples/README.md`](examples/README.md) maps positive and isolated negative/
semantic-negative fixtures to these schemas and records the precise boundary each fixture
must exercise.

## QA 1.3 manifest contribution

`packages/competency-qa/src/manifest-v1.3.ts` will export distinct frozen
`qaCompetencyManifestV13` and `qaValidationWorkTypeDefinitionV13` values extending
their V12 counterparts. Before adding Feature 004/006 events, the outer V13 event
map replaces the six incorrect inherited generic V12 declarations with the exact
Feature 005 refs already used by their emitters:

| Event | Payload schema ID | Registry JCS digest |
|---|---|---|
| `qa.automation-attempt.created` | `urn:awp:schemas:005:events:automation-attempt-created:v1` | `sha256:07101908cc07a63d2194ea3f3df52cccb4738835ea0b4fd2ad41b7a8dafb1faa` |
| `qa.automation-attempt.status-observed` | `urn:awp:schemas:005:events:automation-attempt-status-observed:v1` | `sha256:f239157329bf9ec812c482866c1e0276c3bbab58826b58a78cacc829a304ba82` |
| `qa.automation-attempt.completed` | `urn:awp:schemas:005:events:automation-attempt-completed:v1` | `sha256:2a451d898d26a0c07e7de186531cd76623e2727591977d9ce81ab60c873d6d5c` |
| `qa.automation-artifact.registered` | `urn:awp:schemas:005:events:automation-artifact-registered:v1` | `sha256:94f6ac23995addb0d3fa5dd669382e1ae0dc9507c62580d04f6d86905d9f8dc6` |
| `qa.automation-retry.decided` | `urn:awp:schemas:005:events:automation-retry-decided:v1` | `sha256:8873dbc4628de33dd5c5e4a6dff3a8fdeb87a3cde27d0623cb8981c41aea2f0b` |
| `qa.automation-quarantine.changed` | `urn:awp:schemas:005:events:automation-quarantine-changed:v1` | `sha256:cac8ae1b67aac952be1123b4cf1c331ab469c2e9aa0099742ecfaaffa09717b4` |

V13 then appends these exact declarations:

| Event | Payload schema ID | Registry JCS digest |
|---|---|---|
| `qa.triage-assessment.created` | `urn:awp:schemas:004:events:qa-triage-assessment-created:v1` | `sha256:9f6611fa9da4b54f6291619366e40a77f6e0a955bdf6b7614374cf7c677033b2` |
| `qa.triage-assessment.stale` | `urn:awp:schemas:004:events:qa-triage-assessment-stale:v1` | `sha256:d8410b634c06addac3a4a69371440acb4357f2906a8b4bc0590694715d4657bf` |
| `qa.automated-session.ready` | `urn:awp:schemas:qa:event-payload:automated-session-ready:v1` | `sha256:bae78a03a4505087921f17fc06ac6533b46c2a78597b6e24e02be1ec2a2d628e` |
| `qa.queue-facts.changed` | `urn:awp:schemas:006:qa-queue-facts-changed:v1` | `sha256:73db51fe616e5c5e332dfd50dafa1442823ff3c5f7638991e68994c51cdfb0ca` |

The final V13 declaration set has exactly one entry per event type. Regression
tests compare every declaration with the emitter's schema ref and reject the
generic `urn:awp:schemas:qa:events:v1` ref for all six automation events while
pinning serialized V12 bytes unchanged.

The inner V13 Work Type preserves V12 connector capability requirements and adds
only the queue Work Item action UI contribution. Core contribution order `600`
owns new `queue.*` operation/permission declarations.

## Normative invariants

1. Every project-content object carries an exact `workspaceId` and `projectId`.
   Workspace-only policy/calendar objects carry only `workspaceId`; possessing
   them never grants Project content access.
2. Portfolio authorization derives the visible Project set server-side and
   filters rows before count, facet, sort and cursor creation. The resulting
   hash is bound to the response/action. A hidden or removed order anchor is a
   no-op and reveals no existence signal.
3. Queue stage is one of `CANDIDATE | BACKLOG | READY | ACTIVE | COMPLETED` and
   is always displayed separately from confirmed Jira status. A started blocked
   item remains `ACTIVE`; release of its WIP claim is a separate policy result.
4. The page comparator is stage-partitioned and returns each component. Candidate/
   Draft uses only the Candidate Inbox tuple; accepted Work Items use the
   lexicographic business tuple within their stage. There is no weighted/opaque
   total. Unknown inputs occupy explicit stable buckets; effort and model
   confidence never become business priority.
5. `STANDARD` is the initial accepted service class. `FIXED_DATE` requires a
   confirmed Jira-owned date plus a QA Lead action. `EXPEDITE` requires an exact,
   expiring QA Lead action and never follows automatically from Jira priority.
   Setting, explicitly clearing or expiring `EXPEDITE` updates the control and
   Workspace capacity heads atomically under the capacity-first lock order.
6. Human WIP counts distinct Work Items. MANUAL `RUNNING|REVIEW_REQUIRED` and
   AUTOMATED `REVIEW_REQUIRED` consume it. AUTOMATED `RUNNING` does not consume
   human WIP but an explicit launch reserves future review capacity.
7. An `ENFORCED` hard Workspace limit is checked under one durable capacity lock.
   Project soft limits/reservations only warn. An unavoidable external fact is
   recorded as `FORCED_EXTERNAL`/`OVER_CAPACITY_EXTERNAL`; it is never discarded
   or treated as implicit approval. Its claim cause is `FORCED_EXTERNAL`, its
   internal Workspace capacity state is `OVER_CAPACITY_EXTERNAL`, and the immutable
   target-scoped admission outcome is `NON_DISCRETIONARY_OVERFLOW`. Authorized
   capacity snapshots never expose the global state bit.
8. Candidate/Draft entries have no Jira issue, WIP claim or SLA clock. A Work
   Item clock starts only at the first post-feature confirmed Jira-owned start
   observation, using platform `confirmedAt`, never DoR time, a pending command,
   provider time or a backfilled guess.
9. SLA clocks pin the exact policy, calendar, mapping and start-source revisions.
   Only confirmed mapped events create segment boundaries. Unknown pause reasons
   continue running. Historical elapsed time is never reinterpreted by a newer
   policy/calendar. Clock events carry immutable transition revisions; dynamic
   read-time snapshots are never event payloads.
10. `MEASURE_ONLY` has `NOT_CONFIGURED` WIP/SLA settings and contains no numeric
    limit, target or warning value (closed schema fields are null/empty). Every
    capacity Project facet also has `policy.state=warningState=NOT_CONFIGURED`;
    in every mode a configured Project facet has a configured warning state and
    an unconfigured facet has `warningState=NOT_CONFIGURED`.
    `ENFORCED` requires values backed by immutable baseline evidence. This package
    defines no numeric WIP/SLA default.
11. TriageAssessment remains a proposal. Missing business impact is
    `businessImpact=UNKNOWN` plus an explicit `BUSINESS_IMPACT_MISSING` key. A
    HUMAN action copies selected accepted values; it never mutates the assessment
    or Jira priority/due date.
12. Every mutation is exact, idempotent and CAS-bound. Queue-control actions are
    Project/authorized-portfolio scoped. Policy/calendar publication instead uses
    a separate Workspace-scoped CAS/idempotency/audit UoW, is never encoded as a
    queue-control PlatformAction, and confers no Project visibility. WIP/EXPEDITE
    overrides require current QA Lead authorization and
    `SELF_APPROVAL_FORBIDDEN`; SERVICE/Hermes cannot initiate or approve them.
13. A queue-control `If-Match` binds the control head, order `If-Match` binds the
    order-scope head and admission `If-Match` binds the existing QA Session. The
    authorized preceding read supplies every other exact token. A global capacity
    head/version/set hash remains internal even when a denial creates an exact
    WIP-override candidate.
14. Time-driven ordering and risk do not depend on page reads. PostgreSQL stores
    the next SLA/READY-band transition; a bounded idempotent due-row worker and
    restart sweep append semantic revisions and threshold intents, while no
    per-second tick is written. Pagination holds one server `asOf` over immutable
    revisions and rechecks current authorization on every page.
15. Internal Workspace rebuild IDs/counters are never public. QueueEntry exposes
    only its own exact revision tuple. QueuePage generation is the canonical
    SHA-256 of authorized-set/comparator plus sorted per-Project visible-entry-set
    hashes; its ETag and portfolio order head use only that exact set. Hidden-only
    changes cannot advance or invalidate visible tokens.
16. Outer `competency-qa@1.3.0` and inner `qa.validation@1.3.0` are distinct
    manifest identities extending their corresponding frozen V12 objects. The
    outer list replaces six incorrect inherited generic automation refs with their
    exact Feature 005 refs, then adds triage, automated-ready and queue-fact refs,
    exactly once per event type; the inner retains connector requirements and adds
    the Work Item queue action.
    New ready-event outbox bytes are canonical; legacy raw rows use a bounded
    payload-only compatibility path. That path validates the exact stored payload
    and trusted row scope but never synthesizes or claims a canonical envelope.
17. SLA threshold identity is exactly `clockId + clockCycle + Project policy facet ref +
    WARNING:<index>|BREACH`; it owns one NotificationIntent on the fixed v1
    `REQUEST_STATUS` route. The public ref is ID plus immutable creation hash, not
    mutable delivery row version. Audience delivery does not multiply emission rows.
18. Each Feature 006 PlatformAction has one immutable safe public candidate and
    one same-`actionId` private execution witness; the private `actionHash` covers
    that ID as part of the complete witness. Approval v2 `payloadHash` and the
    receipt `publicIntentHash` equal the candidate content hash; the private
    `actionHash` additionally binds Workspace-global witnesses and is never
    returned. PLATFORM_ACTION Approval resources publish only target-scoped or
    exact authorized-set authorization witnesses, never membership, entitlement
    or role-assignment record IDs. Hidden-only churn may invalidate consumption
    without changing the public candidate hash.
19. Self-identifying refs are non-recursive: policy view, capacity projection,
    applied order and order-invalidation hashes omit their own ref wrapper; policy
    facets hash their independently persisted facet document; SLA clock revisions
    and read-time evaluations have separate hashes. Every public ref maps to a
    durable revision or a documented deterministic view identity.

## Semantic validation beyond JSON Schema

Publication and composed runtime validation additionally reject:

- a scope mismatch anywhere in a referenced object graph;
- an unresolved ref, wrong version/hash, non-current action snapshot or changed
  authorized-visible-set hash;
- overlapping or inverted calendar intervals, an invalid IANA timezone, an
  override outside the calendar validity window, a duplicate local date across
  CLOSED/WORKING overrides, or a semantic-hash mismatch;
- `ENFORCED` project reservation greater than its soft limit, warning threshold
  not strictly below the target, or an invalid SLA/release mapping;
- inconsistent capacity arithmetic, double-counted Work Items, a claim/source-set
  hash mismatch or admission committed from an unlocked/stale head;
- a queue comparator component inconsistent with its pinned source refs, including
  an `urgencyTiming` instant/basis that is not the earliest applicable exact
  latest-safe-start, active SLA target or confirmed Jira due-date end;
- a TriageAssessment fact index outside `facts`, duplicate missing-information
  keys, `ESTIMATE lower > upper`, or an input fingerprint inconsistent with its
  canonical component set.
- a private queue-control witness without the public candidate's exact `actionId`,
  or any public/private action/effect/target/ref mismatch;
- an admission override whose resolved candidate or Approval v2 target does not
  bind the same action ID, Work Item, declared action/effect and public hash;
- a queue page whose path/outer scope does not bind every entry, whose Project is
  outside the exact authorized set, whose total differs from the five stage
  counts, whose ordinals violate the effective full order, or whose base/set/
  generation hash does not recompute over the authorized filtered rows;
- an SLA item response with a foreign path scope, duplicate/missing enabled goal,
  inconsistent `asOf`, or a started snapshot whose immutable fields differ from
  the resolved clock transition, start authority or pinned policy goal;
- a pre-consumption action receipt carrying `resultRef`, a receipt action kind
  outside its endpoint, or a consumed action whose result family does not match
  its action kind;

Unknown, absent and not-applicable are distinct states. A consumer must not map
`UNKNOWN`, `NOT_CONFIGURED`, `NOT_APPLICABLE`, `STALE`, `ERROR` or a missing ref
to zero, false, medium priority, paused SLA, available capacity or permission.

## Compatibility and contribution order

Feature 006 registers schemas at deterministic contribution order `600`, after
Feature 005. Duplicate order, duplicate `$id` or a different digest for an
already-published ID fails composition.

Existing Feature 001–005 contract bytes and digests remain unchanged. Compatible
evolution publishes a new `$id`/semantic version and migration evidence. Stored
policy, calendar, projection, action, admission and clock history retains the
exact versions actually used. Unknown schema, comparator, reducer, policy or
calendar versions fail closed rather than being interpreted as the nearest known
version.

AsyncAPI uses a field-for-field local transport mirror of canonical Feature 001
EventEnvelope v1 because that immutable published schema combines a
non-hierarchical URN `$id` with relative child `$ref`s. A parity test must compare
required fields, property schemas and closure before publication; this adapter is
not an envelope v2 and may not add or omit a field.
