# Implementation Plan: Pilot Hardening & Conformance

**Feature:** `008-pilot-hardening-and-conformance`

**Planned:** 2026-09-03 · **Constitution:** 2.0.0

**Planning identifier:** `008-pilot-hardening-and-conformance`

**Repository branch:** `codex/feature-008-pilot-hardening-and-conformance`

**Baseline:** `9dd759e` (`feat(platform): implement project onboarding and evidence security`). Feature 008 branches from the committed Feature 007 implementation.

**Specification:** [spec.md](spec.md)

**Status:** Design complete for local implementation; corporate executions require the inputs and gates below.

## Summary

Build the complete non-local QA runtime, prove connector/security/recovery
behavior, and introduce a controlled pilot through the existing Project onboarding
and exact-approval machinery. Start with one reference web/API Project, one QA
Workspace, one Jira workflow, one non-production environment, one smoke suite and
one QA Lead. Add further Projects sequentially after review.

Report two separate outcomes:

1. **L0 engineering readiness:** working local infrastructure adapters, stateful
   provider failures, adversarial tests, actual isolated database restore,
   rollout controls and reproducible evaluation/reporting.
2. **P3 pilot evidence:** selected corporate bindings, sandbox conformance, scans
   of actual release artifacts, recovery drill, shadow comparison, approved
   limited writes and an observed pilot review.

A green local run cannot satisfy a corporate gate. Platform deployment operations
belong to operator tooling; the product never gains deployment, product-production
QA or release-decision capabilities.

## Inputs and entry gate

Normative order: [constitution](../../.specify/memory/constitution.md),
[specification](spec.md), ADRs 0002–0008, Feature 007 contracts, then this design.
The [external-systems request](../../docs/external-systems-integration-request-v2.md)
defines C1/N2/P3/R4. C1 metadata is required before implementing a specific
corporate dialect/auth profile. This plan fixes generic interfaces and conditional
work, without selecting the company's systems or claiming provider support.

Observed Feature 007 completion: `final-gate.json` reports PASS for 27 stages,
`deploymentApproval=LOCAL_CONFORMANCE_ONLY`, corporate runtime owner Feature 008.
Before implementation, `verify:008:prerequisites` must bind that report and its
children to actual source, lockfile, contracts and migration registries, including
untracked Feature 007 files. Stale/missing evidence fails. Documentation planning
does not require rerunning the previous full suite.

External values are tracked in [pilot-inputs.md](pilot-inputs.md). Missing inputs
yield `BLOCKED_INPUT`; dependent runs yield `SKIPPED_GATED`. Neither means PASS.
The design defines behavior for absent inputs; actual endpoint, owner and policy
values remain deployment data.

## Technical Context

| Area | Decision |
|---|---|
| Language/runtime | Existing TypeScript 6.0.3, strict ESM; Node 24.20.0 and pnpm 11.21.0 from package.json |
| Applications | Existing Nest API/worker and React web; static package registration |
| Persistence | TypeORM/PostgreSQL owners; additive Core migrations after 0160; QA after 2085 only if needed; PostgreSQL 17/18 compatibility |
| Delivery | PostgreSQL inbox/outbox/effect records durable; Redis/BullMQ rebuildable |
| Identity/secrets | JOSE guard extended by a pinned access-token policy; corporate OIDC and Vault-compatible runtime adapters |
| Observability | Existing OpenTelemetry API plus actual SDK/exporter lifecycle and secured Collector |
| Contracts | JSON Schema 2020-12, canonical hashing, versioned HTTP/events; additive contributions |
| Tests | Vitest, Playwright, Testcontainers, Mock Hub; actual runtime HTTP/browser flows and isolated restore |
| Target | Existing Linux containers; Mac/Linux local tooling; corporate topology is input |
| Performance | Measure latency/queue age/throughput before targets; bounded retries, queries and export batches; no invented RPO/RTO |
| Scope | One QA Work Type; initial FULL_QA reference Project; other Projects may remain MANUAL_ONLY |
| Dependencies | Reuse lockfile; review and scan any new OTel SDK/exporter or adapter package; no blanket upgrade |

## Constitution Check

| Principle | Pre-design obligation | Post-design result |
|---|---|---|
| I Product scope | One reference Project first; separate Session modes | PASS; no new Pack |
| II Jira authority | Confirm effects through provider observations | PASS; no blind unknown-result replay |
| III Scope | Authorize before query/aggregation and at effect time | PASS; cohort only narrows entitlements |
| IV Ownership | Vendor protocol outside Core/QA | PASS; existing Connector packages |
| V Deterministic core | Gates/security/recovery independent of model | PASS; mandatory model-disabled path |
| VI Exact approvals | Same action, payload, scope and exact dependencies on consumption | PASS; reuse 007 activation/resume with pinned gate evidence |
| VII Human verdict | Test/evaluation scores do not become verdicts | PASS; separate human decision |
| VIII Evidence | Signed history survives rotation/retention/restore | PASS; key history and artifact inventory |
| IX Reliability/audit | Durable dedupe, bounded retry, immutable audit | PASS; fenced reconciliation |
| X Local-first | Critical engineering tests need no corporate access | PASS; external reports separately gated |
| XI Compatibility | Immutable published contracts/migrations | PASS; additive schemas and expand-first migrations |
| XII Production boundary | No production testing/deployment/release actions | PASS; target, credential and network gates |

No waiver is proposed. A provider without required guarantees remains unsupported
for that capability until a conforming adapter exists; the plan does not weaken
the specification to accommodate an unsigned or unsafe protocol.

## Architecture and ownership

| Owner | Responsibility |
|---|---|
| Platform Core | Generic gate attestations, effect fence, replay decisions, pilot scope constraint and audit references |
| QA Pack | Evidence/completion, session/attempt outcomes, QA metrics and evaluation semantics |
| Core work management | Existing 006 queue/WIP/SLA facts and exact calendar/pause policy |
| Jira/GitLab/Mattermost Connectors | Protocol auth, normalization, provider-specific confirmation/dedupe and conformance fixtures |
| Runtime composition | Identity, secrets, signer, telemetry, complete wiring, effect guards and recovery orchestration |
| Persistence | Scoped immutable records, CAS/unique keys, transactional audit/outbox and delivery projections |
| API/web | Authorized readiness/health/dead letters/drill/evaluation views; existing activation/suspension commands |
| Operator tooling | Input import, scans, backup/restore and rollout with separately scoped operator credentials |

### Deployment and runtime profiles

Keep `RuntimeProfile=local|test|non-local`; add separate
`DeploymentProfile=local|integration|pilot` with explicit compatibility validation.

| Deployment | Runtime | Targets | Default external business effects |
|---|---|---|---|
| local | local or test | Local disposable mocks | Local mocks only |
| integration | non-local | Pinned sandbox Projects/channels/non-prod suites | Denied until an explicitly scoped conformance run |
| pilot | non-local | Approved cohort/non-production product environment | Denied until gates and exact activation; denied on suspension/expiry |

Add a complete `qa-jira-gitlab-mattermost-nonprod` composition from shared domain
contributions. Preserve old composition names with explicit compatibility mappings;
never reinterpret them as pilot permission. API/worker must share an immutable
deployment digest and reject disagreement. Pure schema/network/reference-format validation runs before migrations. Resolve
published registry refs after controlled migration/bootstrap and before listener
readiness, worker dispatch or connector I/O; secrets are not printed.

Current gaps are concrete: API/worker route all non-local profiles to Core-only
modules; local guards/personas are hardwired; GitLab authority factories and both
S3-compatible transport classes are local-only; scheduled probe/retention adapters
contain empty-work stubs. Implement corporate factories and real repositories;
do not simply remove local checks.

Make artifact-source mode explicit. `GITLAB_ONLY` is valid only if every required
artifact can be retained and verified under the exact QA policy. Required manual
attachments without an available store block completion. Optional S3 never means
optional evidence. Existing local S3 transport remains local-only; add a distinct
corporate adapter with TLS, scoped credentials, checksums and redirect denial.

Evidence attachment sessions are durable QA metadata (additive migration 2090),
with a required storage-policy port and stable artifact/link identifiers. The API
stores bytes during upload and only finalizes after an exact-version checksum
read. Short database leases fence concurrent attempts; recovery after an uncertain
write is read-only. No attachment state or evidence bytes depend on API process
memory. Local storage initialization stays outside shared controllers.

Manual Session controllers require a composed profile/admission port. Corporate
resolution reads the exact published binding/profile/connection chain and verifies
the request authority's NON_PROD scope. Core capacity admission and current queue
permission are mandatory for entry/resume into consuming states; a local queue
feature flag cannot disable them. Local compatibility behavior is isolated in the
explicit local/test factory. This increment does not complete other QA command
factories or corporate startup.

### Identity, secrets, signing and telemetry

Use `(issuer, subject)` identity. API accepts access tokens under a pinned
resource-server dialect, never an ID token. Group mapping is versioned; current
entitlements/clearance/roles apply at request and effect time. During OIDC outage,
only sessions still valid under the bounded policy may continue; unknown keys,
expired tokens and unverifiable step-up fail closed. Opaque access tokens require
an explicit introspection adapter or an unsupported-input result.

Vault-compatible adapters resolve opaque references only for their allowed purpose
inside runtime operations. Use workload identity, narrow leases, rotation and
bounded cache lifetimes. Separate Jira, GitLab read/trigger/webhook, Mattermost,
artifact, test-account and signer permissions. Pin evidence key version and retain
public verification history. No secret values enter business state or reports.

Initialize OTel before instrumented modules, propagate context through durable
messages and flush on shutdown. Redact before export and in the Collector. Audit
commits transactionally without depending on telemetry. Export outage degrades
readiness and blocks new gate promotion; audit persistence failure blocks the
mutation. Use bounded metric dimensions, not correlation/Work Item IDs. Correlation
IDs belong in authorized logs/traces/audit joins. Replace raw exception logging.

### Protocol conformance and uncertain effects

[Connector contract](contracts/connector-conformance.md) records capabilities for
each exact provider version/dialect. Native signature, timestamp, idempotency and
CAS require evidence. C1 fixes the selected protocol matrix before adapter work.

Authenticate ingress before business events. For a protocol unable to satisfy
FR-008-007 natively, a trusted ingress adapter must authenticate the original source
and attest a signed, fresh canonical envelope with durable replay protection.
Signing anonymous inbound data is insufficient. Until proven, the capability is
`BLOCKED_UNSUPPORTED`; token-only ingress is not labeled conformant. Pending
validation receipts remain separate from accepted domain events.

Persist dispatch intent before I/O. Use existing exact approvals, semantic keys
and provider readback. A possibly dispatched timeout requires lookup/reconciliation.
Only proven-not-applied effects can retry with the original identity and valid
authorization. Delayed search absence is not such proof. This includes issues,
defects, comments, links, transitions, pipelines and notifications. Pre/post reads
are not advertised as atomic provider CAS; preserve the selected conflict model
and detect divergence without an uncontrolled corrective write.

### Recovery

1. Fence external effects and prevent the former runtime from writing.
2. Restore into an isolated target at the selected backup/PITR point.
3. Check canonical/audit/binding history, manifests, verification keys and required
   artifacts. Secret recovery remains the secret-store owner's responsibility.
4. Rebuild queues from durable records with writes still fenced.
5. Reconcile against current provider state, including effects after the backup.
   Missing local effect history cannot authorize a new write; quarantine gaps.
6. Measure actual data loss/service restoration and compare with approved RPO/RTO;
   authorize resume only after complete checks.

PITR requires a base backup and complete WAL chain. Logical dump/restore is a
separate rehearsal, never labeled PITR. Backup metadata includes configuration,
key history and artifact inventory. Policy-compliant expired artifacts keep their
metadata; loss of required bytes fails evidence verification. No destructive
restore targets the active local stack or live pilot. Runtime rollback uses a
compatible image/configuration; it does not undo external history or down-migrate
active data.

### Pilot operation and measurement

Use [pilot contract](contracts/pilot-operations.md). Stage, capability mode and
operational state stay independent. An additional deployment fence constrains
all adapters and retries. Shadow can persist local observations/proposals but
cannot write Jira/GitLab/Mattermost; shadow notification intents are never released
as an activation backlog.

The current activation service is partial (in-memory lease and receipt-only API).
Complete the existing action consumer with persisted exact Approval consumption,
transaction-scoped rollout lease, onboarding revision, audit and outbox in one
transaction under existing administrative lock order. Preserve action identity and
endpoint; do not nest the current standalone lease transaction.

Detailed GateRun evidence bridges into existing ProjectOnboardingGateResult
L0/C1/N2/P3, with required skipped runs mapped to BLOCKED_INPUT. P3 pre-activation
includes N2/security/recovery/shadow/cohort readiness; observed pilot/review evidence
comes afterward and cannot be a prerequisite of the first pilot write.

Promotion pins source/image/config, gate reports, cohort, baseline/target protocol
and input package. Revalidate fingerprints and actor authorization at consumption
of the 007 activation action. Missing/stale evidence, revoked scope and expired
cohort deny new effects. Incident suspension preserves history and in-flight
uncertainty for investigation; resume uses the existing exact approval.

Measure the current-process baseline before setting numeric targets. QA Lead and
sponsor freeze the comparison protocol before the comparison period. Preserve
sample membership, definitions, exclusions, censored cases and provenance. Separate
manual/automated Sessions and assertion/infra outcomes. Report sample size and
uncertainty; insufficient data yields `INSUFFICIENT_DATA`. All seven spec guardrails
remain mandatory irrespective of efficiency.

## Delivery sequence

| Increment | Output | Exit evidence |
|---|---|---|
| Setup | 007 prerequisite, contract/trace scaffold and C1 input validation | Source-bound prerequisite/setup PASS |
| Foundation | Config/report models, persistence, effect fence, mocks and auth contributions | Foundation PASS; no external egress |
| US1 | Complete runtime, identity/secrets/signing/telemetry, health UI | Actual local adapter flow; corporate run separately gated |
| US2 | Conformance/degradation, uncertain effects, dead letters/replay | Stateful failures through API/worker for all required connectors |
| US3 | Adversarial pack, redaction, scans, Hermes evaluation/rollback | No bypass; source/image/scanner DB pinned |
| US4 | Real backup/restore, fence, evidence validation and reconciliation | Isolated drill; measured RPO/RTO; no external duplicates |
| US5 | Baseline/dashboard, shadow, cohort gates, pilot review | L0 rehearsal and separate N2/P3 evidence |
| Final | Compatibility, migration, browser, smoke, quickstart, trace | Explicit local and corporate readiness summary |

US1 is the engineering MVP, not permission for pilot writes. US2/US3 can use shared
fixtures after Foundation; their real-provider checks need US1. US4 needs US2
certainty handling. US5 reporting can begin early; activation requires US1–US4 and
inputs. The pilot observation period is real elapsed work, never fabricated CI.

## Project Structure

```text
specs/008-pilot-hardening-and-conformance/
  spec.md, plan.md, research.md, data-model.md, pilot-inputs.md, quickstart.md
  contracts/                         # protocol/API/gate/evaluation contracts
  tasks.md                           # subsequent task-generation output
packages/platform-core/src/pilot/    # generic gates/scope/fence
packages/platform-persistence-typeorm/src/ # pilot/recovery repositories
packages/runtime-composition/src/pilot/    # complete non-local wiring
packages/runtime-composition/src/security/ # identity/Vault/signer adapters
packages/runtime-composition/src/recovery/ # fenced reconciliation
packages/platform-runtime-nest/src/observability/
packages/connector-{jira,gitlab,mattermost}/src/
packages/competency-qa/src/application/
apps/api/src/extensions/pilot/
apps/web/src/routes/pilot/
config/pilot/
infra/observability/
tools/{ci,contracts,verification,local,recovery}/
tests/{unit,contract,integration,e2e}/008/
tests/integration/security/008/
docs/runbooks/pilot-*.md
reports/008-pilot-hardening-and-conformance/
```

Paths above include planned additions. Reuse static registration and current
package owners; add no separate service or generalized deployment engine.

## Validation and completion

Trace all 31 FR and seven SC to tasks and real assertions. Reports bind exact
input/config/source/suite/fixture/image hashes and are revalidated on aggregation.
Fixture tests cannot satisfy live-provider gates. New quickstart commands are
explicitly planned, not currently runnable.

Local completion requires all engineering stories and the local gate. Full pilot
completion additionally requires corporate conformance, approved security/recovery,
the actual pilot window and human review. No scan, target or deployment approval
is claimed during planning.

## Complexity Tracking

No constitutional violation. Reuse application boundaries, action identities,
authority and the contract registry. Add trusted ingress only when a selected
protocol needs it and keep unsupported capabilities blocked until verified.


### Readiness runtime implementation status (2026-09-04)

The shared readiness controller requires `QaReadinessRuntime`. The local adapter is explicitly restricted to local/test; `PublishedQaReadinessFacts` reads current published Binding/Profile/Connection and QA Context, Project Registry, original requester Core rights, and a fresh confirmed operational projection. A missing or stale projection cannot supply an accepted request fact.

Readiness assessments, current aggregate JSON/hash/version and the required-plan header commit together. Confirmation creates a durable Core command with an exact approval and HELD outbox. It never calls a provider from HTTP or locally assigns READY. The gateway can join the aggregate transaction, preserving rollback across command, idempotency, approval, audit and outbox writes. Request revisions share the manual-session lock, read persisted session/READY-command guards, cancel unreleased READY commands, and retain exact invalidation references. The runtime provides an approval/invocation contribution that rechecks current input/assessment/configuration facts and current Core initiator rights.

This increment does not close T025. Actual corporate API/worker composition must still install this contribution in every approval and worker route, resolve deployment/provider pins, and wire the provider confirmation/reconciliation path; defect/completion and remaining startup work are also open. Controlled database proofs are L0 engineering evidence only.

The shared defect controller also requires `QaDefectPublicationRuntime` and `QaDefectApprovalRuntime`. Published configuration resolves both exact destination and request-authority chains; transactional publication, replay and approval release are covered on PostgreSQL 17/18. Current HUMAN permissions, role, classification, approval expiry and full command subject are rechecked before the HELD outbox becomes READY. The native worker composition still needs to install the current-input lifecycle contribution and wire scoped provider lookup/confirmation. Historical local Jira/mock behavior is confined to explicit local adapters; those adapters are not corporate proof.

The verdict/completion controller now requires `QaDodRuntime` for DoD assessment and candidate preparation. An assessment request supplies only `expectedAggregateSnapshotHash` and an exact `verdictRef`; claimed client inventory flags are ignored. The runtime reconstructs the current plan/review/manifest/finding/defect inventory and the verdict signature aggregate. It verifies artifact availability, metadata and classification against the signed inventory and the current caller/policy ceilings. `PublishedQaDodPolicy` requires exact current published context/risk heads and known compiled DoD/evidence rules, with project risk as the minimum effective risk. Assessment publication and pointer/hash/version update are atomic under the request lock. Candidate preparation re-evaluates the latest exact assessment and derives summary references and risk from the persisted signed verdict. A substantive review correction makes the earlier closure proof stale even if a legacy aggregate projection has not advanced yet.

This DoD increment covers the persisted manual v1 review inventory. Required-plan waivers without an exact durable decision resolver are unavailable, and signed v2/automation closure inventory still needs composition. Authoritative verdict creation/signing and full deployment composition remain open. Completion publication, approval and invocation now recheck this proof through required runtime ports, as described below. Local fixtures and their legacy policy references do not satisfy C1/N2/P3 conformance.

The completion controller now requires `QaCompletionRuntime` and `QaCompletionApprovalRuntime`. Published configuration resolves exact current binding/profile/mapping/connection heads and the fresh confirmed Core request revision. Atomic publication creates one HELD command/approval; distinct current approval consumes the exact subject and releases the outbox. Worker dispatch installs the QA guard and Core attempt in one transaction. `DurableQaCompletionWorker` requires composed provider/service authorities and only reads an already-started effect after lease expiry. Confirmation preserves the exact READY_TO_CLOSE inventory and policies in a canonically hashed SATISFIED assessment and commits Core projection, QA confirmation, plan freeze, event and audit together. The controlled HTTP test loses a write response and independently counts one POST across restart and several uncertain readbacks. Foundation `foundation-5f24bb30-a956-47c5-bc97-9233ecfbb591` passes 367 tests, types, schemas, architecture and lint. Selected Jira completion protocol and actual non-local entry-point wiring remain open; this is not corporate conformance.

The authoritative verdict runtime now derives scope, evidence references, effective risk and version from current persisted state. Exact Core co-sign actions bind the primary signer and independent current QA Lead, with atomic approval consumption, signature, verdict projection, event and audit. The UI exposes human judgment, initial drafts, co-sign, DoD and asynchronous external completion approval. Supersession and substantive review correction now share a transaction-bound completion invalidator: it preserves the original full DoD provenance and cancels undispatched Core command/approval/outbox authority before making the candidate terminal. An in-flight or frozen completion rejects review correction. Forced persistence failures roll back both the correction and cancellation; classified Work Items require the current caller ceiling. These changes retain the old evidence and do not claim corporate conformance.

Foundation `foundation-5ec6faf5-1ad9-45c0-8c9b-920d8e1b339d` verifies this verdict/review cancellation increment with 377 tests, PostgreSQL 17.7/18.6, four typechecks, 203 schemas, architecture, lint and unchanged-source evidence. T025 remains open.

The T035 read/import boundary now verifies detached Ed25519 report artifacts,
their prerequisites and current policy/fingerprints before atomic immutable import.
Current Core rights/classification are checked before lookup and persistence.
Readiness reconstructs existing Core gates for the exact current deployment from
freshly verified artifacts; health projects current Core capability probes. These
endpoints require the reviewed input, current report policy and scoped artifact
ports from deployment composition and do not provide corporate defaults.

The T036 web entry mounts a separate same-origin corporate BFF screen, with
explicit project/deployment selection, all input owners, freshness and actions.
It clears results on scope/session/access changes and revalidates visible data.
Three client boundary cases, four Chromium interaction cases and the web build
pass. Controlled browser response fixtures are UI evidence only; the actual
corporate login/request/evidence/Collector journey remains T038.

The subsequent full run `foundation-2b95d1e3-402a-40d5-b002-8d89ba25850c`
is retained as FAIL: one of 389 tests assumed a newly released outbox row was
immediately due on the host clock. The fixture now polls at the persisted
PostgreSQL availability boundary, accounting for precision and clock skew.
Both database versions pass the focused 12-case completion/import regression.
The replacement full checkpoint will also cover the browser suite and include
root build/lint/test configuration in its freshness fingerprints.

The replacement checkpoint `foundation-2b7ebc80-63ea-46f4-9dbf-8dde44afef61` is PASS: 396 tests, PostgreSQL 17.7/18.6, four typechecks, all 203 schemas, architecture, lint and unchanged-source fingerprints. T035 and T036 are complete; 33/115 tasks are complete and 82 remain. The registered required ports and browser components are verified; complete corporate entry-point composition and the actual request/evidence/Collector journey remain separate open tasks.


## Implementation checkpoint — browser evidence correlation (2026-09-04)

The T038 journey now runs Chromium against the actual Nest BFF and QA API,
an independent PKCE IdP, PostgreSQL, SigV4 object storage and a real mTLS
Collector. It verifies scoped health, denied foreign-project access, one stored
object, atomic evidence/link/audit publication, rollback on audit failure,
replay without another audit and immediate membership revocation. The response,
durable audit and actual parent/child trace share normalized correlation; the
child also binds authoritative scope and audit causation. Unsafe correlation
headers and private evidence/error canaries do not reach the Collector. Existing
safe incoming correlation IDs retain their HTTP compatibility contract.

The journey exposed missing attachment audit and a telemetry policy boundary
that admitted an interval rejected by the SDK after reserving global ownership.
Both are fixed. The focused browser/upload/telemetry run passes 11 cases on
PostgreSQL 17/18; the compatibility/telemetry run passes 13 cases.

Intermediate checkpoint `foundation-13912d9d-9919-411c-8ac5-52a9d5daea04`
is retained as FAIL: correlation compatibility was corrected during that run,
and the unchanged-source guard correctly rejected its mixed source state.
Final frozen-source checkpoint `foundation-837b68dd-7b84-41bd-a195-a8d78557bcb8` is PASS: 406 tests, PostgreSQL 17.7/18.6, four typechecks, 203 schemas, architecture, lint and unchanged-source fingerprints. T038 is complete; 34/115 tasks are complete and 81 remain. The legacy correlation trust-boundary suite is now included in Foundation.
This is controlled local engineering proof, not corporate C1/N2/P3 conformance.


## Implementation checkpoint — startup agreement (2026-09-04)

The startup barrier now checks configuration/image agreement, exact current
DEPLOYMENT records in every declared Project, reviewed reference resolution,
actual network-policy hashes and callback/browser endpoints. Reference validation
is bounded and repeated after DNS validation. Additive Core migration 0175 stores
process incarnations and database-clock leases. Both components must be present
with the same current configuration; mixed live revisions, stopped/expired
incarnations, policy changes and SQL lock timeouts fail closed. NON_PROD effects
require the barrier and reload the original fence after asynchronous validation.

Actual API and worker health endpoints keep liveness available and return 503
when deployment readiness is absent or lost. The shared Nest lifecycle renews
and stops registrations. Non-local entry points now explicitly reject the still
incomplete corporate composition before telemetry/module initialization, removing
the former Core-only fallback. The remaining full factory must supply the actual
published-reference adapter and bind this runtime to the complete API/worker;
T020/T025/T037 therefore remain open. Controlled fixtures do not prove C1/N2/P3.

The initial regression proved an external effect without startup agreement;
HTTP regressions also proved false 200 readiness with unconfigured dependencies.
Twenty-two focused cases now pass, including PostgreSQL 17/18, real health HTTP,
rollout mismatch, shutdown/expiry, blocked SQL, bounded policy validation and a
fence change during startup validation. Types, lint and diff whitespace checks
pass. Full checkpoint `foundation-f73d2107-a0f4-481c-b560-1571e162eb70` is PASS: 418 tests, four typechecks, 203 schemas, architecture, lint and unchanged-source fingerprints. Task count remains 34/115 complete and 81 open.


## Implementation checkpoint — published deployment references (2026-09-04)

The deployment startup factory now constructs a concrete database-backed
reference resolver. Additive Core migration 0180 stores scoped immutable
configuration publications, exact current references, CAS headers and terminal
revocation, with atomic publication/revocation history. Document and publication
hashes cover distinct responsibilities: adapter content versus scope/provenance
and validity. Project/Workspace foreign keys prevent cross-scope publication.

Startup resolves every selected policy/input/provider document and verifies the
current published Core Binding/Profile/Connection chain in each declared Project.
SQL and validation deadlines bound unavailable inputs; lease renewal and the next
effect fail closed after policy revocation. The same metadata validator serves
the CLI and the real input readiness projection. All twelve entries must cover
the complete deployment scope; valid metadata does not confer C1/N2/P3 readiness.

The targeted PostgreSQL 17/18, migration and input-contract run passes 16 cases.
It covers renewal, revocation preventing another effect, partial scope/missing
metadata, provider head/hash drift, SQL locks, immutable history, exact replay,
concurrent publication and rollback when history recording fails. The initial
Foundation CLI launch exposed an import of the entire contracts barrel into
Node's strip-only path. Using the existing public canonical-hash subpath fixes
that without adding a transpiler or changing the command runtime. The failed
launch log is retained at `/private/tmp/awp-008-foundation-published-config.log`.

Full corporate factories must still construct and validate each owning adapter's
policy dialect, credentials and domain dependencies, authorize configuration
administration and bind startup in the actual API/worker entry points. T025/T037
remain open; 34/115 tasks are complete and 81 remain. Corporate conformance is
not claimed. Foundation `foundation-eaa9de7d-c523-40de-adb8-97c4988aa42e` passes all 426 tests (302 boundary/database, 7 published configuration/startup, 34 onboarding, 42 QA/HTTP, 4 Chromium UI, 1 browser/OIDC/storage/Collector, 8 automation-result, 12 completion-domain, 3 durable delivery and 13 telemetry/trust regressions), PostgreSQL 17.7/18.6, four typechecks, 203 schemas, architecture, lint and unchanged-source fingerprints. All 19 checks pass.

### Published automation availability increment

The corporate API can install `PublishedAutomationAvailabilityModule` with a server-owned
scoped pin set and verified HTTP identity. Its reader selects the exact current Core
onboarding binding/context, published configuration heads and Suite, checks canonical
content/report hashes and accepted resource pins, and uses the latest observation of
each of the eight GitLab operations. A newer negative result is never hidden by a
query that filters successes first. FULL_QA launch readiness requires Core
PILOT_ACTIVE/FULL_QA/ACTIVE as well as this complete intersection.

The reader bounds SQL and total request time and rechecks current request authority
and configuration after asynchronous work. Classification includes both Project and
QA context, response reasons are fixed safe codes, and the endpoint uses no-store.
`qaAutomationProfilePinSetHash` defines the canonical validation pin format for this
path. It covers scope, Binding and ordered role/capability/operation/profile/connection
references with NON_PROD. The configured evidence age applies to validation reports,
functional acceptance and capability observations; once expired, the selected evidence
must be renewed and selected again. There is no implicit renewal of old reports.

Controlled PostgreSQL/HTTP fixtures exercise project 7249, current-head drift, Core
mode, revoked acceptance/access, incomplete/expired/negative probes and malformed
canonical hashes. They do not establish real installed GitLab capabilities. Provider
conformance/validation publication, automated-session planning/admission/dispatch and
complete corporate entry-point assembly remain T025/T030/T040/T045. Launch readiness
is a display projection, not an effect authorization. No task checkbox is closed by
this partial assembly; the count remains 34/115 complete and 81 open.

The actual QA context repository now inserts a UUID revision ID, matching the existing
schema. Its previous suffixed string failed when exercised against PostgreSQL; the
integration fixtures use this repository inside a transaction rather than bypassing it.

Frozen-source Foundation `foundation-48a8223d-33fc-457b-b9a8-e556c289ec41` is PASS:
431 tests, PostgreSQL 17.7/18.6, four typechecks, 203 schemas, architecture, lint
and unchanged-source fingerprints. All 19 checks pass. The published configuration
command now also contains the four automation database/HTTP cases, keeping the main
boundary command within its existing deadline. Five focused tests pass in
`/private/tmp/awp-008-automation-verified.log`. Full corporate assembly and C1/N2/P3
remain open; 34/115 tasks are complete and 81 remain.
