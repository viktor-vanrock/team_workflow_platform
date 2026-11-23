# Feature 006 capabilities and authorization

Feature 006 uses Core operation identities and current authorization; a
capability, skill, availability record, Workspace role or possession of a ref is
never itself permission. All Project content operations require an active HUMAN
or allowlisted SERVICE identity, active Workspace membership where applicable,
Project Entitlement and classification clearance evaluated at execution time.

## Exact operation identities

| Identity | Operations | Trusted server context | Authorized caller |
|---|---|---|---|
| `queue.project-lane.read@1.0.0` | `queue.project-lane.read`, `queue.entry.read` | Principal, Workspace membership, one entitled Project, authorized-set hash, query hash, comparator ref and projection generation | HUMAN with `queue.project.read` and that Project Entitlement |
| `queue.portfolio.read@1.0.0` | `queue.portfolio.read`, `queue.entry.read` | Principal, Workspace, server-derived entitled Project set/hash, query hash, comparator ref and projection generation | HUMAN with `queue.portfolio.read`; normally QA Lead; only entitled Projects are visible |
| `queue.policy.read@1.0.0` | `queue.policy.read`, `queue.calendar.read` | Workspace membership, authorization-neutral policy-view ref/revision and exact calendar ref; full policy head stays internal | Authorized HUMAN; grants no Project content access and never returns unfiltered project allocations |
| `queue.capacity.read@1.0.0` | `queue.capacity.read`, `queue.admission.read` | Workspace, server-derived Project scope, authorized-scope policy facet and durable capacity-projection ref; global head stays internal | Authorized HUMAN; counts are filtered to the same allowed scope |
| `queue.sla.read@1.0.0` | `queue.sla.read` | Exact scoped Work Item, clock goal, authorized Project and server-selected `asOf = now` | HUMAN with `queue.sla.read` and that Project Entitlement |
| `queue.policy.publish@1.0.0` | `queue.calendar.publish`, `queue.policy.publish` | Exact draft hash/version, owner, baseline evidence for `ENFORCED`, current header version and request key; separate Workspace CAS/idempotency/audit UoW, not a queue-control PlatformAction | Workspace Owner with policy permission; role does not imply Project content access |
| `queue.control.request@1.0.0` | `queue.service-class.set`, `queue.order.move`, `queue.wip-override.request` | Exact subject/scope, policy/control/capacity versions and hashes, visible-set hash where relevant, reason, expiry and request key | Entitled HUMAN; accepted service class/order requires QA Lead authority; WIP candidate may originate from a denied authorized start |
| `queue.control.decide@1.0.0` | `queue.control.approve`, `queue.control.reject`, `queue.control.consume` | Additive Approval v2 pins the public candidate hash; the same action ID resolves an immutable internal execution witness/action hash, current authorization, expiry and all hidden CAS values | Currently authorized QA Lead distinct from the initiating HUMAN |
| `queue.work-admit@1.0.0` | `queue.manual-session.start`, `queue.manual-session.resume`, `queue.automated-session.launch` | Existing QA command authority, exact Work Item/Session refs, queue policy and locked capacity head | HUMAN already authorized for the underlying QA mutation; admission adds no new business authority |
| `queue.projection-maintain@1.0.0` | `queue.project.invalidate`, `queue.project.rebuild`, `queue.sla.reconcile`, `queue.capacity.reconcile` | Allowlisted consumer identity, bounded Workspace/Project cursor and local immutable source refs | Internal SERVICE only; never exposed to browser/model grants |

Operation strings are closed. A generic `queue.write`, arbitrary patch, client
supplied Project list or free-form provider operation is not a valid capability.
Core contract contribution order `600` declares these Feature 006 operation and
permission identities. They are not connector capability requirements. The
additive outer `competency-qa@1.3.0` manifest selects inner
`qa.validation@1.3.0`; the inner keeps V12 connector requirements and adds the
queue Work Item UI action. Both V12 serialized objects remain byte-identical.

## Read authorization and non-disclosure

For a project lane, the authorizer resolves exactly one Project Entitlement before
the query. For a portfolio read it performs this sequence:

1. authenticate a HUMAN and verify active Workspace membership;
2. require the `queue.portfolio.read` permission;
3. derive Project IDs through the current entitlement and classification policy;
4. join that exact set before `COUNT`, facets, comparator or cursor calculation;
5. bind `principalId + workspaceId + authorizedProjectSetHash + queryHash +
   comparatorRef + authorizedProjectionGeneration` into the opaque cursor.

The public generation is the canonical SHA-256 of the exact authorized-set hash,
comparator ref and sorted per-Project visible QueueEntry-set hashes; the raw
Workspace rebuild ID stays internal. An
entitlement, classification, comparator or visible projection-generation change
invalidates the cursor. A hidden-only rebuild/change cannot alter the returned
generation, ETag, order-head version/epoch or timing. Responses never include
excluded totals, positions, identifiers, timing, anchors or error differences.
Workspace Owner receives no implicit access to Project content.

Policy tokens obey the same rule. The Workspace policy GET uses an independent
public view ID/version/hash and ETag that advance only when the returned neutral
fields change. Project QueueEntry/SLA and authorized-scope capacity reads use
separately versioned policy facets containing only applicable entries. None reuse
the full policy header/revision token, so another Project's allocation-only change
is not observable.

Public QueueEntry source refs and admission mutation/action refs are structurally
allowlisted to Project-safe revision families. A full QueuePolicy ref, Workspace
capacity-head/set ref, authorization-record ref or private action witness cannot
validate in those positions. Runtime then proves the property-specific ref family,
same Workspace/Project scope and declared hash equality before serialization.

## Exact mutations

Browser/model input may name only the requested Feature 006 operation and its
schema-valid payload. Trusted middleware supplies authenticated actor, role,
Workspace membership, entitlement/classification decision, current internal
policy ref, matching public policy facet, current visible-set hash and
idempotency/CAS context. Callers cannot inject or replace them.

Every mutation requires:

- one `requestKey` and canonical `requestHash`; same key/same hash replays, while
  same key/different hash conflicts;
- exact Workspace and, for Project content, exact Project and subject refs;
- expected header/control/capacity/session versions appropriate to the action;
- exact policy/comparator/source-set hashes used to make the decision;
- bounded reason and expiry where an override is requested;
- a current authorization recheck immediately before commit/consumption.

Every caller-supplied expected value is obtainable from an authorized read:
QueueEntry supplies its exact revision/fingerprint and control-head version;
QueuePage supplies its authorized-set/base-set hashes, projection generation,
comparator, queue epoch and order-head version; the existing QA Session read
supplies the admission Session version. The public API never exposes or accepts an
expected global capacity-head version.

Every action stores an immutable public `queue-action-candidate@1.0.0` and a
separate internal `queue-control-action@1.0.0` witness under the same action ID.
`publicIntentHash` is the candidate semantic content hash and is also the additive
Core Approval v2 `payloadHash`; it covers the requested effect and authorized read
tokens only. The internal `actionHash` additionally covers global capacity
witnesses and is never returned. The Approval view is not a lossy redaction: its
target is the complete safe public candidate. Its PLATFORM_ACTION authorization
fields contain only a scope witness: a target-Project-only facet hash for PROJECT
or the exact authorized-set hash for AUTHORIZED_PORTFOLIO. Full initiator/approver
membership, entitlement and role-assignment refs remain private audit/execution
evidence. Consumption resolves the immutable private witness by the already-approved
action ID and verifies both in one transaction, so hidden churn can invalidate
without becoming a public token.

“Public” here means authorized-subject-visible, not Workspace-wide. Before either
GET or decision serializes a portfolio candidate, Core reauthorizes every Project
named by its target and optional anchor and requires the caller's current exact
authorized Project-set hash to match the candidate scope. The private initiator
basis pins the corresponding entitlement-ref set; the public v2 subject never
serializes those record IDs. A caller entitled only to the target
Project receives the same 404 shape/timing as a missing Approval and cannot use the
generic route to probe the anchor or portfolio-set hash.

Service-class and manual-order changes are append-only controls; they do not
modify Jira priority/due/status. A portfolio move requires entitlement to its
target at initiation and consumption. The anchor is resolved only against the
server-authorized visible set before an Approval is created. Hidden and missing
anchors produce the same terminal consumed `ANCHOR_UNAVAILABLE_NO_OP` candidate
with no public anchor, expiry or second approval; the raw key remains restricted
to the private witness/idempotency audit. Thus no pending Approval can expose or
become permanently unreadable because of a hidden anchor.

`WIP_ADMISSION_OVERRIDE`, `EXPEDITE_CAPACITY_OVERRIDE` and `SET_EXPEDITE` use the
exact Platform Action/Approval lifecycle with `SELF_APPROVAL_FORBIDDEN`.
`CLEAR_EXPEDITE` is an authorized QA Lead action with `NO_SECOND_APPROVAL` and no
expiry, still serialized under the capacity-first lock. Approval is not reusable for another
Session, state, policy version, capacity count or later action. An unavoidable
external observation is recorded by SERVICE as a fact; it does not use or create
an Approval.

A denied discretionary admission may atomically persist the immutable denial and
one exact WIP override PlatformAction/Approval only when the caller included
`overrideIntent {reason, expiresAt}` and policy permits escalation, while leaving
the Session, claim and reservation unchanged. Without that object the response is
the ordinary stored denial. The `202` response returns the exact refs and the
existing Core Approval `Location`; the additive Core Approval API 1.1 response
union returns v1 or v2 by `subjectSchemaId`, and its generic decision endpoint
performs the only approval/consumption step and invokes the Feature 006 handler
atomically.

Calendar and queue-policy publication do not use `queue-control-action` or the
project-scoped PlatformAction wrapper. They use the dedicated Workspace-scoped
publication capability with expected header version, request idempotency, audit
and an exact draft hash. Workspace publication still grants no Project content
authority. Publication transport is intentionally outside this Feature 006 public
queue OpenAPI v1; implementation reuses the internal Workspace configuration
surface rather than pretending that a read route can publish.

## Hermes and routing boundary

Hermes may receive a single-use, Project-scoped grant to read a bounded typed
input manifest and produce `triage-assessment@1.1.0` or notification wording. It
cannot receive any of these operations:

- policy/calendar publication;
- service-class acceptance or order mutation;
- WIP override initiation, approval or consumption;
- Session start/resume/launch;
- Jira priority, due, status or assignment mutation;
- SLA segment or capacity-ledger mutation.

Routing evaluates authorization, capability and availability independently and
may return eligible HUMAN hints only. It never assigns work or derives access
from a capability/availability fact.

## Failure behavior

- Unknown capability/schema/policy versions, stale CAS values, unresolved scope,
  stale/conflicting source facts and revoked authorization fail closed.
- Jira outage preserves last confirmed values with visible freshness; it creates
  neither a local Jira guess nor an automatic SLA pause.
- Model outage keeps deterministic stage, admission, comparator and SLA behavior.
- Mattermost outage leaves a durable NotificationIntent and cannot change a
  clock. GitLab outage prevents new automated launches through Feature 005 but
  does not disable manual queue work.
- External facts and automated terminal evidence are never rejected to protect a
  capacity counter. Forced overflow is persisted, alerted and blocks later
  discretionary admission until capacity is restored or an exact override is
  consumed.
