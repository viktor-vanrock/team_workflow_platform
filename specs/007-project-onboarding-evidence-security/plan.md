# Implementation Plan: Project onboarding, evidence and security

**Feature:** `007-project-onboarding-evidence-security`

**Planning branch identifier:** `007-project-onboarding-evidence-security`

**Repository branch at planning time:** `codex/feature-006-queue-triage-capacity-sla`

**Baseline:** `2c5f3d6` (`feat(platform): implement queue triage, capacity and SLA`)

**Specification:** [spec.md](spec.md)

**Planned:** 2026-09-03

**Constitution:** `2.0.0`

## 1. Summary

Feature 007 turns the minimal Project, Project Entitlement and
`ProjectIntegrationBinding` skeleton into a safe, repeatable per-Project onboarding
control plane. Platform Core keeps stable Project identity, scoped authorization,
versioned connector configuration, exact approvals, audit and artifact access.
The QA Competency Pack owns environments, test-data/account-lease references,
capability requirements and evidence semantics. Existing API, worker and web
deployment units are extended; no new service or external system is introduced.

```text
Project registration + owners + classification
                    │
                    ├─→ versioned Project onboarding package
Entitlements ───────┤       │
Published Profiles ─┤       ├─→ DRAFT → VALIDATING → SHADOW → PILOT_ACTIVE
QA context/resources┤       │
Probe + conformance ┘       ├─→ MANUAL_ONLY | FULL_QA
                            └─→ ACTIVE | SUSPENDED

Session + exact TargetSnapshot
          └─→ immutable Evidence Manifest v2
                ├─→ human attestation + cryptographic signature
                ├─→ revision chain; no in-place correction
                └─→ artifact availability/retention projection outside signed content
```

Feature 007 implements and proves the local L0 onboarding package and the
provider-neutral C1/N2/P3 contracts. Corporate endpoints, identities, retention
values and pilot cohort remain explicit deployment inputs. Real corporate runtime
wiring and the controlled pilot rollout remain Feature 008.

## 2. Inputs, dependencies and entry gates

### 2.1. Normative input order

Conflicts are resolved in this order:

1. [Constitution 2.0.0](../../.specify/memory/constitution.md)
2. [Feature 007 specification](spec.md)
3. [ADR-0003: QA Session, Evidence, Finding and Verdict](../../docs/adr/0003-qa-session-evidence-verdict.md)
4. [ADR-0004: Workspace and Project Entitlement](../../docs/adr/0004-workspace-project-entitlement.md)
5. [ADR-0006: Project Integration Binding and versioning](../../docs/adr/0006-project-integration-binding-versioning.md)
6. [ADR-0007: action-specific exact Approval](../../docs/adr/0007-action-specific-exact-approval.md)
7. [Feature 006 design and completion evidence](../006-queue-triage-capacity-sla/plan.md)
8. [Master specification sections 9, 15 and 20](../../docs/agentic-workspace-platform-master-spec-v2.md)
9. [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/) and this plan

### 2.2. Implementation prerequisite gate

`verify:007:prerequisites` must reject implementation unless the checked-out
source, contracts and migration registries match a fresh `PASS` for Feature 006,
including transitive Features 001-005 compatibility. The planning baseline is
commit `2c5f3d6`; a copied historical report without matching source and contract
digests is insufficient.

The prerequisite gate also proves that:

- Core migrations through `0140` and QA migrations through `2070` are registered,
  immutable and repeat-safe;
- Project scope is present on Work Item, Session, Attempt, Finding, Evidence,
  Artifact, Approval, Agent Run, queue facts and integration commands;
- exact `PLATFORM_ACTION` approval and authorization-at-consumption semantics are
  intact;
- Jira remains operational authority, and GitLab/Mattermost bindings remain
  provider-owned adapters rather than Project-state authorities;
- the existing `qa-jira-gitlab-mattermost-local` contour has external egress and
  production effects denied.

### 2.3. Pilot-input resolution

There is no unresolved product-design clarification. Pilot inputs are immutable,
secret-free onboarding metadata supplied at deployment time:

- Project owners, classification and cohort;
- Jira/GitLab/Mattermost identifiers and mappings;
- retention/legal-hold/export policy;
- opaque secret references and their resolver policy;
- environment, test-data and account-pool references;
- incident, suspension and resume owners/procedure.

L0 uses deterministic synthetic values. Missing C1/N2/P3 inputs produce an
explicit `BLOCKED_INPUT` gate result and `SKIPPED_GATED` external verification,
never a guessed identifier, retention duration, security clearance or PASS.

## 3. Technical context

| Area | Decision for 007 |
|---|---|
| Language/runtime | TypeScript `6.0.3`, strict ESM/ES2024/NodeNext; Node.js `24.20.x` |
| Workspace/tooling | pnpm `11.21.x`, Nx `23.1.x`, frozen lockfile |
| Backend/UI | NestJS `11.2.x`, React `19.2.x`, Vite `8.2.x` |
| Persistence | PostgreSQL via TypeORM `1.1.0`; additive owner migrations tested on PostgreSQL `17` and `18` |
| Async/recovery | Existing PostgreSQL inbox/outbox and BullMQ `6.3.x`/Redis `8.2.x`; onboarding, audit and signatures never live only in Redis |
| Validation | JSON Schema 2020-12 with Ajv `8.20.x`; OpenAPI 3.1 and AsyncAPI 3.0 snapshots; existing RFC 8785 canonical hashing |
| Evidence crypto | Provider-neutral signer/verifier ports; local detached JWS with EdDSA/Ed25519 via existing JOSE/runtime support; exact `kid` and algorithm policy pin |
| Testing | Vitest `4.1.x`, Testcontainers `12.1.x`, Playwright `1.62.x`, deterministic clocks and stateful Mock Hub |
| Target platform | Existing API, worker and browser units in Linux containers; local-first Mac/Linux development |
| Project type | TypeScript monorepo with Platform Core, QA Competency Pack, typed Connectors, TypeORM adapters and static runtime composition |
| Performance goals | No invented product SLO before Feature 008 baseline; authorization precedes aggregation, reads have bounded query counts and no connector/model calls |
| Constraints | Default deny; no secret values in business state; no production targets; exact CAS/approval; published revisions and signed evidence are immutable |
| Initial scope | One reference Project onboarded first; security fixtures use at least two visible Projects and one forbidden Project; additional Projects are sequential |

No new third-party runtime dependency is required. The existing canonical hash and
JOSE support are reused behind explicit ports.

## 4. Constitution check - pre-design gate

| Principle | Result and design obligation |
|---|---|
| I. Product scope | PASS - extends the single QA Work Type and sequential Project onboarding; adds no new Competency Pack or reusable test library. |
| II. Jira authority | PASS - onboarding configures exact Jira roles/profiles but never stores or mutates Jira-owned operational state directly. |
| III. Workspace/Project boundary | PASS - registry, entitlement, binding, environment, lease, evidence, artifact and action rows carry exact Workspace/Project scope; authorization filters before lookup/aggregation. |
| IV. Pack/Core/Connector ownership | PASS - Core owns generic registry/security/configuration; QA owns project test context and evidence semantics; Connectors own provider protocol only. |
| V. Deterministic core | PASS - gate evaluation, capability mode, authorization, retention eligibility, hashing and signature verification do not depend on a model. |
| VI. Hermes/exact approvals | PASS - publish/retire/resume use exact `PLATFORM_ACTION`; Hermes cannot initiate, approve or consume these actions. |
| VII. Human verdict | PASS - evidence cryptographically preserves human attestation and references the separate human QA Verdict; no automation creates a Verdict. |
| VIII. Evidence/target snapshot | PASS - new manifests contain exact immutable target/configuration pins, signatures and append-only correction lineage. |
| IX. Reliability/audit | PASS - durable idempotency, outbox, audit and recovery cover every mutation; Redis is advisory only. |
| X. Integrations/local-first | PASS - L0 uses existing stateful Jira/GitLab/Mattermost mocks; external values gate only C1/N2/P3. |
| XI. Versioning/compatibility | PASS - published v1 contracts remain byte-identical; additive v2 evidence/target contracts and expand/contract migrations preserve history. |
| XII. Production boundary | PASS - Project bindings reject product-production targets and no Feature 007 flow deploys, releases or performs production tests. |

Gate result: **PASS**. No constitutional exception or complexity waiver is
required.

## 5. Architecture and ownership

| Owner | Owns in Feature 007 | Must not own |
|---|---|---|
| Platform Core | Stable Project registry, entitlement ledger/current projection, onboarding header/gates, operational state, generic Binding lifecycle, exact platform actions, audit, artifact authorization/availability | QA suite/environment meaning, vendor payloads, human Verdict |
| QA Competency Pack | `qa.validation` capability requirements, QA Project Context v2, environment/test-data/account-pool references, leases, target snapshots, Evidence Manifest v2/package rules | Workspace membership, generic Connector lifecycle, secret values |
| Core persistence adapter | Scoped headers/revisions, constraints, locks, exact action UoWs, artifact retention decisions | QA semantic evaluation or provider calls |
| QA persistence | QA context/resources/leases, manifests/signatures/packages and immutable lineage | Connector credentials or global Project authorization |
| Runtime composition | Application services, probes, cross-owner typed ports, effect guards, signer/verifier adapters, recovery workers and notifications | New business authority or provider-specific DTOs in Core |
| API/UI | Authorized project catalog/onboarding/evidence views, exact commands, conflict and gate explanations | Client-computed permissions/modes, raw secret/artifact locators |
| Connectors | Capability probes and provider operations behind exact Profile/Connection pins | Project lifecycle, entitlement, capability-mode or evidence policy authority |
| Hermes | Optional explanation of already-safe missing information | Project selection, entitlement, publish/retire/resume, evidence signature or retention decision |

### 5.1. Source-of-truth separation

| Concern | Authority |
|---|---|
| Project identity, owners, classification and operational state | Platform Core onboarding aggregate |
| Workspace membership, roles and Project Entitlements | Platform Core identity/access model |
| Connection/Mapping/Profile/Binding revisions | Platform Core integration registry |
| Connector health/probe observation | Connector result; immutable Core observation and current projection |
| QA capability requirements and mode derivation | QA Pack definition evaluated deterministically over Core binding/probe facts |
| Environments, test-data/account-pool refs and leases | QA Pack Project Context |
| Artifact metadata/access/availability | Core artifact module; binary remains GitLab or approved object storage |
| Session/Attempt/Finding/Outcome/Verdict/Evidence semantics | QA Pack; Verdict and review attestation are HUMAN |
| Secret values | External secret manager/runtime resolver only |

## 6. Project onboarding aggregate

The existing `projects` row remains the stable identity/current read header. New
append-only revisions hold owner/classification/verification changes. A separate
onboarding header serializes transitions and points to the latest immutable
onboarding revision. This avoids reinterpreting existing Project IDs or treating a
mutable UI form as the source of truth.

```text
OnboardingStage:
DRAFT ──validate──→ VALIDATING ──failure──→ NEEDS_FIX ──revise──→ VALIDATING
                              └─local/conformance pass──→ SHADOW
SHADOW ──P3 acceptance──→ PILOT_ACTIVE

QaCapabilityMode:       MANUAL_ONLY ⇄ FULL_QA
ProjectOperationalState: ACTIVE ⇄ SUSPENDED
```

The three state dimensions are independent. A Project may be `SHADOW`,
`MANUAL_ONLY`, `ACTIVE`; suspension preserves intended capability mode but the
effective effect guard is always deny. Archival remains a registry lifecycle and
is not an alias for emergency suspension.

Every onboarding revision pins:

- exact Project registry revision and starter entitlement set hash;
- exact published Binding, QA Project Context and policy/resource refs;
- owners for business, technical, QA, security and escalation duties;
- immutable gate result refs for all applicable L0/C1/N2/P3 checks;
- resulting capability mode, operational state, actor, reason, correlation ID,
  content hash and resource version.

Only one Project is promoted at a time. A Workspace-level rollout lease prevents
two first-time `PILOT_ACTIVE` transitions from bypassing sequential review; it does
not serialize ordinary work in already onboarded Projects.

## 7. Entitlements and authorization

Grant, replace and revoke commands use an idempotency key and expected current
entitlement-set version. One serializable transaction appends an entitlement
revision, updates the current authorization projection and writes redacted audit
before/after hashes. Revoke takes effect immediately without moving business rows.

Every read and mutation uses the same server-side policy intersection:

```text
active Workspace membership
AND current Project Entitlement
AND current role permission
AND resource classification permitted by both ceilings
AND Project operational rule for the requested effect
```

Project listing, direct URL, API lookup, queue, search, event subscription,
evidence export and artifact download filter scope before lookup, count, cursor or
cache computation. Missing and forbidden resources share a safe public response;
the private reason is audit-only. Cache keys, partitions, outbox payloads and
background jobs contain `workspaceId + projectId` and reauthorize at execution.

Integration Administrator permissions manage configuration but do not grant
Project content. Workspace Owner also requires explicit `project.admin`
entitlement for publish/retire/resume in that Project.

## 8. ProjectIntegrationBinding lifecycle

Published Feature 001 Binding v1 remains the contract. Feature 007 closes the
runtime/persistence gaps rather than mutating it:

- TypeScript content gains the already-published `configurationRefs[]` and
  `resourceRefs[]`, lifecycle timestamps and canonical environment-scope values;
- validation resolves and pins the exact published Profile/Connection/Mapping
  chain and an immutable successful Validation Report;
- QA Lead creates a separate `BindingFunctionalAcceptance` over exact candidate
  version/content hash, environment/suite/evidence-policy refs and acceptance
  checklist hash;
- Integration Administrator requests a `BINDING_PUBLISH` or `BINDING_RETIRE`
  platform action; a distinct Workspace Owner with current `project.admin`
  entitlement approves it;
- consumption rechecks authorization, candidate and header versions, exact
  Validation Report, functional acceptance, current probes and configuration
  fingerprints under one PostgreSQL transaction;
- publish atomically retires the previous current version and advances the header;
  competing publications yield one winner and an explicit stale result;
- rollback clones a historical published/retired semantic payload into a new
  DRAFT version, then repeats validation, acceptance and publication.

Retired transitive dependencies remain resolvable only for historical reads and
recovery of effects whose first provider invocation already occurred. New work
always resolves the current published Binding.

## 9. Capability probes and mode derivation

Each probe result is immutable and scoped to an exact Binding entry and transitive
Profile/Connection/Mapping chain. It records requested capability/operation,
observed status, safe issue codes, checked time, validity window and content hash;
raw credentials or sensitive provider payloads are forbidden.

The QA Pack exposes a versioned requirement matrix:

- `MANUAL_ONLY`: published Jira `QA_REQUEST_AUTHORITY`, `SOURCE_CONTEXT` and
  `DEFECT_DESTINATION` roles plus applicable QA context/resources;
- `FULL_QA`: all manual requirements plus GitLab `SOURCE_CONTEXT`,
  `TEST_EXECUTION`, `ARTIFACT_SOURCE` and an accepted suite binding;
- Mattermost `MESSAGING` is mandatory for P3 onboarding readiness but an outage
  does not lower QA mode; web fallback and notification outbox remain active.

Mode is recalculated only from exact current facts after publish, probe refresh or
resume. A missing or stale required probe lowers the effective mode safely; it
never fabricates capability. Historical Sessions retain their pinned mode and
Binding refs.

## 10. Suspension and resume

Emergency suspension is a fail-safe explicit Integration Administrator command
with reason, incident ref and idempotency key. Under the Project onboarding-header
lock it appends a state revision, invalidates pending new-effect actions, writes
audit and queues owner/QA Lead notifications. It requires no second approval
because it only reduces capability.

A shared Project effect guard runs both when a command/session/lease is created and
immediately before first external invocation or Session start. While suspended it
denies new external writes, new Sessions and new account leases. Authorized reads,
audit, evidence verification and local reconciliation remain available. An effect
already invoked before suspension may perform read-only confirmation with its old
pins and idempotency key, but cannot be silently redirected or retried as a new
write.

Resume is an exact `PROJECT_RESUME` platform action. Its candidate pins successful
fresh probes, incident disposition, current Project/onboarding versions and the
intended capability mode. A distinct Workspace Owner consumes it with step-up
evidence and current `project.admin` entitlement. The effective mode is
recalculated; it is not blindly restored.

## 11. QA Project Context, environments, test data and account leases

QA Project Context v1 stays readable. New Projects publish an additive v2 context
that references immutable environment, test-data, account-pool, evidence,
retention and redaction policies through exact schema-bound refs.

- Environment revisions have stable ID, integer version, owner, canonical
  `LOCAL|NON_PROD|PREPROD` scope, classification, status and a schema-bound
  configuration reference. They never contain endpoint credentials.
- Test-data entries are opaque immutable dataset/procedure refs with owner,
  classification and permitted environments; raw data is not copied into Core.
- Account-pool entries contain only an opaque resolver ref and policy metadata.
- A Test Account Lease is time-bounded, Project/environment scoped, owned by one
  principal and subject, and follows `ACTIVE → RELEASED|EXPIRED|REVOKED`.
  Credential material is resolved only in the runtime adapter.

Session start validates that exact environment revision and required test-data or
lease refs are current and allowed. A new target-snapshot contract pins their
content hashes plus the exact Binding/Profile/Connection/Mapping/Validation Report
chain. Mutable aliases such as `latest`, a default branch or an environment name
without revision are rejected.

## 12. Evidence integrity and revisioning

Existing Evidence Manifest v1 remains byte-identical and readable as historical
`LEGACY_INTEGRITY_ONLY`; it is not counted as cryptographically signed pilot
evidence. New Sessions use Evidence Manifest v2:

- the canonical payload contains the full schema-bound target snapshot, exact
  Work Item/Session/Plan Item/Attempt lineage, expected/actual results,
  classifications, artifact metadata/checksums, policy/definition/configuration
  pins, human reviewer attestation and correlation/causation IDs;
- `contentHash = SHA-256(JCS(payload))`; signature fields are excluded from the
  payload hash to avoid a cycle;
- a provider-neutral signer produces a detached JWS over the canonical payload and
  stores protected `alg`, exact `kid`, signature, signing-policy ref and time;
- local L0 uses EdDSA/Ed25519; pilot algorithm/key/provider are validated inputs and
  `none`, symmetric shared-secret MACs and unknown algorithms are rejected;
- read/export recomputes the content hash and verifies the signature against the
  immutable public-key version. Failure is deny-by-default, audited and metered;
- correction always creates a new manifest revision with predecessor hash, reason,
  new human attestation and new signature. Previous revisions are unchanged.

Signature generation occurs before the final serializable Session-review commit.
The commit rechecks the Session snapshot, persists manifest+signature and completes
the Session atomically. Provider failure leaves the Session in `REVIEW_REQUIRED`;
same-key retry either commits once or returns the existing signed revision.

A separate immutable Work Item Evidence Package references all accepted Session
manifest revisions and the exact human-signed QA Verdict. This avoids adding a
future Work Item Verdict to an earlier Session manifest.

## 13. Classification, retention, access and export

Evidence classification is the maximum of Project, environment, test-data/account
lease, observations and artifact classifications. A lower client-supplied value is
ignored/rejected. Redaction is applied before logs, notifications, model input or
export serialization using an exact policy ref; the signed canonical manifest
retains only fields permitted by that policy.

Artifact availability is a mutable projection outside signed content. The signed
manifest records availability at signing and immutable metadata/checksum. Current
`AVAILABLE|EXPIRED|QUARANTINED|UNAVAILABLE` status, last verification and reason
live in append-only availability revisions. Retention evaluation pins the policy,
owner, eligible time and legal-hold decision. Legal hold blocks platform deletion;
provider expiry is observed and recorded, never hidden.

Every metadata read, content stream and export rechecks current membership,
entitlement, role and classification. Export creates an immutable audit record with
requester, exact manifest/package refs, redaction policy, result hash and
correlation ID. Raw provider URLs, signed URLs, cookies, tokens and secret refs are
not returned.

## 14. API, events and UI

[OpenAPI](contracts/openapi/project-onboarding-evidence-api.v1.yaml) defines:

- Project registration/catalog and exact entitlement grant/revoke commands;
- onboarding package and gate reads;
- Binding validate, functional-acceptance, publish/retire/rollback actions;
- emergency suspend and approved resume;
- environment/test-data/account-lease operations;
- signed manifest/package verify and audited export.

[AsyncAPI](contracts/asyncapi/project-onboarding-evidence-events.v1.yaml) carries
project-scoped immutable events for entitlement changes, gate evaluation, Binding
publication/retirement, capability-mode/operational-state changes, lease changes,
evidence signing and artifact availability. Event consumers reauthorize and treat
delivery as at-least-once.

Web adds an Integration Administrator onboarding workspace and authorized QA
evidence verification views. UI presents gates, exact versions, mode/state,
probes, approvals, signature status and retention state. It never computes an
authorization or capability decision locally.

## 15. Persistence and migrations

Feature 007 owns additive migrations after the completed Feature 006 tails:

| Migration | Ownership and content |
|---|---|
| Core `0150` | Project registry revisions, onboarding headers/revisions/gate results and rollout lease |
| Core `0155` | Entitlement revision ledger, Binding functional acceptance/probes and exact publication/retire/resume action support |
| Core `0160` | Artifact availability/retention decision revisions and export audit indexes |
| QA `2080` | QA Project Context v2, environment/test-data/account-pool revisions and account leases |
| QA `2085` | Target Snapshot v2, Evidence Manifest v2 signatures, evidence packages and predecessor constraints |

Migration rollout is expand-first. Existing v1 Project/Binding/Session/Evidence
rows remain readable. Existing Projects receive deterministic registry/onboarding
bootstrap revisions but are not labelled P3 or cryptographically signed without
evidence. New writes cut over only after backfill validation. Contract phase then
removes no old field; destructive cleanup is deferred beyond Feature 007.

CI covers PostgreSQL 17/18 fresh install, 006-to-007 upgrade, repeat, current-minus-
one recovery, partial failure, migration-order/owner constraints and unchanged
historical hashes. Published migrations are never edited.

## 16. Transactions, idempotency and recovery

Lock order is fixed to avoid deadlocks:

```text
Workspace rollout head
→ Project/onboarding header
→ Binding or entitlement header
→ platform action + Approval
→ Session/evidence or lease header
→ outbox/audit rows
```

All mutations require a request idempotency key and semantic request hash. Same
key/same hash replays the first result; same key/different hash conflicts. Binding
publish, entitlement replacement, suspension/resume, lease acquisition and
manifest correction have explicit race tests. Scheduled repair scans rebuild
current projections from immutable revisions without Connector writes.

## 17. Observability and safe diagnostics

Bounded low-cardinality telemetry covers:

- onboarding stage and gate outcomes by environment class;
- current/retired/suspended Binding counts and probe freshness;
- capability mode transitions and effect-guard denials;
- authorization denials by policy dimension without Project/resource identifiers
  in public metrics;
- active/expired/revoked leases;
- manifest sign/verify failures and artifact availability changes;
- command/action correlation from request through audit/outbox.

Logs contain scope-safe IDs, reason codes and hashes only. They never contain
credentials, raw external payloads, test data or evidence content.

## 18. Validation strategy

| Story/gate | Independent proof |
|---|---|
| US1 manual-only onboarding | Register Project, grant starter entitlements, publish Jira+Mattermost Binding/context, reach `MANUAL_ONLY`, create MANUAL Session and deny AUTOMATED Session. |
| US2 full QA promotion | Add GitLab roles and suite, pass exact probes/acceptance, publish new Binding, reach `FULL_QA`, launch one local automated Session; old Session keeps old refs. |
| US3 scoped access | Two principals, two visible Projects, one forbidden Project, two classifications; prove identical policy on list/direct URL/queue/search/events/export/artifacts. |
| US4 evidence | Complete manual and automated Sessions, verify JCS hash/JWS signature, correct by new revision, expire artifact and retain metadata/checksum/audit. |
| US5 suspension | Suspend between command creation and invocation, prove zero new effects/sessions/leases, preserve authorized reads, then resume only with probes+incident+distinct Owner approval. |
| Concurrency | Competing publish, entitlement revoke/read, suspend/effect, lease acquire/expiry and manifest correction each have one deterministic outcome. |
| Compatibility | V1 schemas and fixtures are byte-pinned; old manifests display `LEGACY_INTEGRITY_ONLY`; existing 001-006 acceptance remains green. |
| Production boundary | Product-production environment, credential, endpoint or effect is denied before persistence/resolution/network. |

## 19. Implementation sequence

1. Freeze contracts and add `verify:007:prerequisites`, compatibility byte pins and
   migration ownership checks.
2. Implement Core Project/onboarding/entitlement revisions and authorization-first
   query ports.
3. Productionize Binding validation/publication/retirement/rollback, exact actions,
   probes, mode derivation and suspend/resume guards.
4. Add QA Project Context v2, environment/test-data/account-pool catalogs, leases
   and exact target snapshots.
5. Add Evidence Manifest v2, signer/verifier ports, revision/package persistence,
   retention/availability and export audit.
6. Wire API/worker/web into the existing local composition, add deterministic
   multi-Project fixtures and browser flows.
7. Run contract, unit, architecture, PostgreSQL 17/18 migration, integration,
   security, concurrency, recovery, browser, smoke, traceability and final evidence
   gates.

Feature 008 starts only after a fresh source-bound `verify:007` PASS. It supplies
corporate OIDC/secret/observability bindings, real non-prod/pilot connectors,
failure injection, backup/restore and controlled rollout; it must not redesign the
Feature 007 domain contracts.

## 20. Project structure

```text
specs/007-project-onboarding-evidence-security/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── README.md
    ├── capabilities.md
    ├── schemas/{common,project,integration,qa,artifacts,events}/
    ├── openapi/project-onboarding-evidence-api.v1.yaml
    └── asyncapi/project-onboarding-evidence-events.v1.yaml

packages/platform-core/src/
├── identity-access/
├── integration-registry/
├── approval/
├── artifacts/
└── project-onboarding/

packages/platform-persistence-typeorm/src/
├── entities/
├── migrations/core/
└── *onboarding*, *entitlement*, *binding*, *artifact* repositories/UoWs

packages/competency-qa/src/
├── domain/
├── application/
├── persistence/migrations/
└── ui/

packages/runtime-composition/src/
├── onboarding/
├── qa/
├── security/
└── seed/

packages/platform-runtime-nest/src/http/
apps/api/src/extensions/onboarding/
apps/web/src/routes/projects/
apps/worker/src/

tests/
├── architecture/007-*.spec.ts
├── contract/007/
├── unit/007/
├── integration/007/
├── integration/security/007/
└── e2e/007/

tools/{ci,contracts,local,smoke,verification}/
reports/007-project-onboarding-evidence-security/
```

**Structure decision:** extend the existing monorepo packages and deployment units.
No onboarding microservice, separate authorization database, new artifact store or
new Connector is justified.

## 21. Constitution check - post-design

The Phase 1 design preserves every pre-design result. Cross-owner interactions use
typed ports, authorization is enforced before data access, exact approvals remain
action-specific, signed evidence is append-only, external effects are idempotent
and Project-scoped, and production targets remain denied. **PASS; no exceptions.**

## 22. Complexity tracking

No constitutional violations require justification.

## 23. Implemented onboarding HTTP compatibility (2026-09-06)

The deployed local onboarding boundary publishes the additive
[`project-onboarding-api.v1.1.yaml`](contracts/openapi/project-onboarding-api.v1.1.yaml)
contract: 18 operations under the `/api` server prefix and `/v1/workspaces/...`
paths. Published controllers share the existing guarded PostgreSQL applications
and idempotency records with legacy `/v1/...` clients. Legacy DTOs and the original
1.0 design files remain unchanged. The new contract explicitly declares which
earlier document it supersedes; the registry permits an operation ID to recur only
for that declared predecessor and the same HTTP method and path.

The original acceptance command supplies exact revision refs, while its 1.0
response schema required schema metadata that an external policy ref cannot
establish. Acceptance schema v2 therefore represents exact accepted refs, actor,
reason and safe issue codes. This is an explicit response version, not a rewrite
of schema v1 or stored Core records. Project, entitlement and acceptance DTO hashes
bind their wire projections; `AWP-Resource-Ref` preserves the original Core ref.
Replay loads the exact committed revision rather than the latest head.

Runtime validation uses the generated offline OpenAPI schemas for requests and
responses. The HTTP acceptance matrix covers all 18 operations, statuses, strong
ETag/CAS, current authorization, safe errors, immutable replay and parallel legacy
routes on PostgreSQL 17/18. Corporate composition remains in 008/T025; full process
smoke T176 remains open. Independent journey T106 is now proven in section 25.
T059 is now proven by the independent manual journey described below.
Evidence's HTTP/crypto boundary is documented separately from this onboarding
contract. Deployment, compatibility and rollback steps are in
[`onboarding-openapi-convergence.md`](../../docs/runbooks/onboarding-openapi-convergence.md).

## 24. Independent manual onboarding journey (2026-09-06)

T059 now starts separate API and requested-probe worker child processes against
PostgreSQL 17/18. HTTP creates a new project, grants scoped entitlements, publishes
QA resources/context, validates and accepts the manual Binding, obtains distinct
owner approval, publishes it, evaluates L0 and starts a manual Session. Four safe
provider GETs are consumed from the durable request by the worker. API and worker
restarts preserve all outcomes; no GitLab Suite, automated Session or connector
write is created. IAM/provider metadata and the preceding confirmed QA Request,
readiness and required plan are explicit controlled prerequisites.

The journey exposed a missing shared identity for QA Context v2 and a manual
Session path that could not consume the published v2 facts. Context publication
now inserts its scoped identity for the existing QA Request FK without creating
a legacy policy revision. A repeatable upgrade SQL handles previously published
contexts. The Session controller reads published context/environment facts and
the actual Binding Profile refs, then captures an immutable v2 target snapshot
inside the transaction that starts execution. Configuration, data, policy and
source refs are exact; mode configuration is the schema-bound Context v2 body.
The existing Session DTO/hash stays compatible. Audit failure rolls back the
transition and snapshot together; head drift blocks new admission.

Automated Session admission checks Core mode before the Suite adapter and again
inside the persistence transaction. Administrative audit records preserve exact
Core onboarding refs before and after each operation plus its result ref. The
regression includes both positive FULL_QA persistence and the MANUAL_ONLY refusal.

Evidence: [manual-onboarding-journey.json](../../reports/project/manual-onboarding-journey.json)
(184/184 tests in 76 files, root TypeScript and targeted ESLint).
[Delivery files, SQL ordering, CI and rollback](../../docs/runbooks/manual-onboarding-journey.md)
retain T176, corporate composition and actual C1/N2/P3 as separate obligations.
T106 is now proven by the multi-principal journey below.

## 25. Independent multi-principal scope journey (2026-09-06)

T106 runs separate Nest API processes against PostgreSQL 17.7/18.6 and registers
three new projects over HTTP. Two readers have different roles and classifications;
an additional verified session of one reader has a stricter ceiling. Project
catalog, search, safe onboarding event notifications, scoped Work Item summaries,
actual queue projections/counts/cursors, artifact bytes/checksums, signed evidence
and exports are exercised independently. HTTP revocation invalidates reads, old
cursors and a previously created export, including idempotency replay and restart.
Explicit DENY and a restricted resource inside an otherwise readable project are
hidden; changing a forbidden project's metadata leaves visible pages unchanged.

The additive project-reads API v1 publishes three routes. Each read intersects the
verified identity adapter with current membership/role/entitlement/classification
facts. Local QA authorization now evaluates Core policy and intersects persona
ceilings. Queue projection filters resource classification before data selection
and pagination and consumes a current session ceiling from both HTTP adapters.
PostgreSQL UUID ordering is corrected. Forbidden/missing resource errors share a
safe 404; step-up failures remain 403. There is no schema migration beyond Core
200 / QA 2110, no raw outbox payload endpoint and no SSE implementation claim.

Final regression: 723/723 tests in 197 files, no failed/skipped/todo tests; root TypeScript,
targeted ESLint and registry/OpenAPI checks pass. Existing automation fixtures now
explicitly establish FULL_QA; historical migration 0190 tests pin that migration,
while foundation upgrade tests assert current Core 200 and preserved data.
Evidence: [project-scope-journey.json](../../reports/project/project-scope-journey.json).
[Delivery, ingress, session adapters, CI and rollback](../../docs/runbooks/project-scope-journey.md).
Controlled IAM/queue/evidence prerequisites do not close T176, 008/T025 or actual
corporate C1/N2/P3, recovery/pilot/review obligations.


## 26. T176 — isolated Compose restart/evidence smoke (2026-09-07)

`pnpm smoke:007` now builds the current image and boots a unique Compose project
with loopback ports and an internal network. API registration/entitlements,
explicit local step-up, durable signed evidence/export, a stopped/started worker
and one Jira-backed Work Item are exercised through actual HTTP. The input Jira
issue and IAM/signed evidence prerequisites are controlled fixtures. The worker
request uses seeded ALPHA; the new SMOKE007 project exercises onboarding,
suspension, event receipts and evidence. This does not claim a new-project Jira
configuration or corporate provider acceptance.

Seven services restart independently: PostgreSQL 18.6, Redis, Mock Hub, worker,
API, web and S3Mock. New StartedAt/PID/readiness, stable state/hash/effect counts,
idempotent command/export replay and S3 bytes are verified. All four project
events are acknowledged, and redelivery keeps four inbox receipts. Chromium
uses the actual web/API without route interception; HTTP plus browser leave
two exports and two export audit events. Cleanup removes only the isolated
project and verifies zero remaining containers, networks and volumes.

The smoke exposed missing onboarding heads for projects seeded after migrations,
an omitted operational-state event in the worker query, and a sink retry that
was incorrectly treated as an applied duplicate. Local bootstrap now preserves
existing heads/suspension; event delivery includes suspension and retries a
failed sink before acknowledging. CLI status reads persisted heads. Ordinary
Fake IdP sessions remain unchanged; development step-up is explicit and local.

Nine smoke stages PASS; 215/215 regression tests in 91 files, no skipped/todo;
root TypeScript and targeted ESLint pass. No schema migration was added. GitLab
`verify:local` now runs this smoke after `ci:008` and preserves the report/logs.
This turn did not rerun all of `ci:project` or `ci:008`.
[Closure report](../../reports/project/onboarding-compose-smoke.json),
[native smoke](../../reports/007-project-onboarding-evidence-security/smoke.json),
[runner, fixtures, deployment and cleanup instructions](../../docs/runbooks/onboarding-compose-smoke.md).
All 184 Feature 007 tasks are locally complete. 008/T025 and six corporate
acceptance tasks remain open; earlier section counts describe historical runs.
