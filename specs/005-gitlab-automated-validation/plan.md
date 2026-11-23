# Implementation Plan: GitLab automated validation

**Feature:** `005-gitlab-automated-validation`

**Planning branch identifier:** `005-gitlab-automated-validation`

**Repository branch:** `codex/feature-005-gitlab-automated-validation`

**Specification:** [spec.md](spec.md)

**Planned:** 2026-09-01

**Constitution:** `2.0.0`

## 1. Planning outcome

Feature 005 adds reproducible, explicitly launched, non-production automated QA sessions through an allowlisted GitLab CI pipeline without granting GitLab, the Connector, or Hermes authority over QA findings, Session Outcome, Jira workflow, or release verdict.

```text
authorized HUMAN confirms one AUTOMATED Session
  → QA pins Work Item, target, suite and configuration chain
  → one QA launch-request claim and immutable AutomationAttempt
  → one Core ConnectorCommand/outbox transaction
  → GitLab Connector validates the typed allowlisted request
  → exactly one pipeline trigger or exact effect reconciliation
  → webhook signal and/or bounded polling
  → authoritative pipeline/job/result read
  → immutable technical result and authorized artifact references
  → optional single policy-controlled infrastructure retry
  → sticky REVIEW_REQUIRED
  → HUMAN reviews attempts/findings/flaky flag and signs outcome
```

The implementation will add:

- provider-neutral source-context, test-execution and CI-artifact ports to Connector SDK;
- pure `@awp/connector-gitlab` and TypeORM-backed `@awp/connector-gitlab-persistence-typeorm` packages;
- QA-owned Suite Binding, automated Session planning, immutable Attempt lineage, retry, quarantine and human-review integration;
- a provider-neutral shared Attempt identity so automated evidence uses the existing Observation, Finding, result, manifest and review path rather than a parallel verdict path;
- additive `qa.validation@1.2.0` capabilities while keeping the published manual contracts unchanged;
- a stateful protocol-faithful Mock GitLab in Mock Hub and the mandatory `qa-jira-gitlab-local` composition;
- contract, architecture, migration, security, process, browser, trace and final-evidence gates for US-001…US-004 and FR-001…FR-025.

Mattermost remains optional for the standalone GitLab implementation and local
conformance contour. Constitution X nevertheless requires the actual pilot
release/deployment to use the combined Jira+GitLab+Mattermost composition and a
fresh Feature 004 evidence gate; Mattermost outage still cannot block the core
Jira/QA flow. Production/deploy targets, CI configuration writes, autonomous
regression and automatic QA/release verdict remain impossible in V1.

## 2. Inputs, dependencies and entry gates

### 2.1. Normative inputs

Priority on conflict:

1. [Constitution 2.0.0](../../.specify/memory/constitution.md)
2. [Feature specification](spec.md)
3. [Feature 003 design](../003-jira-operational-authority/plan.md) and its immutable final evidence
4. [Feature 002 design](../002-qa-manual-walking-skeleton/plan.md) and published manual QA contracts
5. [ADR-0004: Workspace and Project Entitlement](../../docs/adr/0004-workspace-project-entitlement.md)
6. [ADR-0006: Project Integration Binding versioning](../../docs/adr/0006-project-integration-binding-versioning.md)
7. [ADR-0007: action-specific exact Approval](../../docs/adr/0007-action-specific-exact-approval.md)
8. [Agentic Workspace Platform master specification](../../docs/agentic-workspace-platform-master-spec-v2.md)
9. [External systems integration request](../../docs/external-systems-integration-request-v2.md)
10. [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/) and this plan

No unresolved design question remains. The pilot-specific GitLab version, URL, identity, project, suite/result dialect, retention and runner facts are immutable live-validation inputs. Their absence produces `SKIPPED_GATED`; it does not weaken or block the mandatory local implementation.

### 2.2. Upstream prerequisite gate

Implementation beyond setup must run `verify:005:prerequisites`, which proves:

- `reports/003-jira-operational-authority/final-gate.json` is a fresh local `PASS` for the exact checked-out Feature 003 sources and contracts;
- consumed Core, QA and Jira contract hashes match that evidence package;
- Feature 003 durable request/create, outbox, worker recovery, authoritative Jira read-back and Work Item materialization still pass;
- existing Core, QA and Jira migrations remain registered and immutable;
- Feature 002 manual schemas, example digests and negative `AUTOMATED` fixtures remain unchanged.

Feature 004 evidence is optional at the standalone Feature 005 implementation
entry gate, so GitLab packages/tests have no Mattermost dependency. It becomes
mandatory at `verify:005:pilot-release`, which admits only a combined
Jira+GitLab+Mattermost composition as required by Constitution X.

### 2.3. Live GitLab metadata gate

Required validation uses Mock Hub. Opt-in live validation accepts a secret-free, immutable `GitLabPilotMetadataPackage@1.0.0` containing:

- exact environment class `LOCAL | DEVELOPMENT | TEST`, Workspace/Project and contour key;
- exact `CONFORMANCE_VALIDATION | PILOT_REHEARSAL | PILOT_DEPLOYMENT` purpose;
  rehearsal requires immutable refs/hashes for fresh Feature 003/004/005 and
  combined local Mattermost composition evidence but grants no deployment
  approval, while deployment requires the same bindings, combined
  DEVELOPMENT/TEST HTTPS metadata and an immutable successful-rehearsal
  ref/hash;
- GitLab base URL, exact edition/version/build, API family and TLS/network ownership;
- numeric GitLab project, source-context contract, allowed refs and pipeline trigger dialect;
- project-scoped read, trigger and webhook signing references/fingerprints,
  owners, scopes/key version, rotation, revocation and exact operation-to-slot
  routing evidence;
- exact three-role Connection/Profile/validation-report/Project Integration Binding pin set and Suite Binding refs/hashes;
- exact suite/environment/input allowlists and non-production/no-deploy attestations;
- result schema ref/digest, result job/path, maximum size, artifact checksum/classification/retention policy;
- webhook verification mode, event kinds, replay/dedupe horizons and delivery semantics;
- polling, lookup-consistency, timeout/concurrency and Connector pre-effect
  transport-retry bounds;
- exact QA-owned retry policy ref/hash, allowlisted deterministic infrastructure
  codes and `maxAutomaticRetries=1`;
- runner/network/container readiness evidence, explicit operator opt-in and `productionDenied=true`.

Embedded secrets, `PRODUCTION`, deploy jobs/refs, a foreign project, incompatible versions, unverified legacy webhook token-only mode, missing exact schema/policy evidence, or a mutable reference fails before secret resolution or network access.

### 2.4. Phase outputs

- [research.md](research.md) — Phase 0 decisions and rejected alternatives;
- [data-model.md](data-model.md) — ownership, entities, constraints, migrations, state machines and atomicity;
- [contracts/](contracts/) — Phase 1 capability, HTTP, event and JSON Schema contracts;
- [quickstart.md](quickstart.md) — planned executable local and gated-live validation journey;
- `tasks.md` — generated later by `speckit-tasks`, not by this planning phase.

## 3. Technical context

| Area | Decision for 005 |
|---|---|
| Language/runtime | TypeScript `6.0.3`, strict ESM/ES2024, Node.js `24.20.x` |
| Workspace/tooling | pnpm `11.21.x`, Nx `23.1.x`, frozen lockfile |
| Backend/runtime | NestJS `11.2.x` adapters; Core, QA and Connector domain logic framework-independent |
| Web | React `19.2.x`, Vite `8.2.x`, MUI through `platform-ui`; no browser-to-GitLab calls |
| GitLab transport | Native `fetch` behind injected HTTP, auth, secret, clock and telemetry ports; no vendor SDK required |
| Contracts | OpenAPI 3.1, AsyncAPI 3.0, JSON Schema 2020-12, TypeBox/Ajv and canonical SHA-256 fingerprints |
| Durable storage | PostgreSQL 17/18, TypeORM `1.1.x`, `synchronize:false`; Redis/BullMQ remains reconstructible scheduling only |
| GitLab state | Pipeline/job/source/artifact bytes remain authoritative in GitLab; exact normalized observations and receipts are persisted locally |
| Artifacts | Existing Core `ArtifactReference` and authorization proxy; opaque provider locator, checksum, classification and expiry; no raw URL authority |
| Testing | Vitest 4, real PostgreSQL/Testcontainers, stateful Mock Hub, Playwright Chromium, process smoke and trace/evidence gates |
| Observability | Structured audit/log/trace/metrics with safe project/suite/outcome labels; no IDs, SHA or request keys as metric labels |
| Deployment | Required local contour; opt-in `DEVELOPMENT`/`TEST`; `PRODUCTION` denied at identity, CI, Profile, runtime policy and egress |
| Performance targets | Durable launch acknowledgement p95 ≤ 2 s; webhook-to-visible normalized state p95 ≤ 30 s; lost-webhook repair ≤ 120 s/two polls; terminal-to-artifact metadata ≤ 120 s |
| Reliability targets | zero duplicate pipelines, production/deploy invocations, cross-project provider effects or automatic verdicts; at most one automatic infra retry |
| Scale/scope | Pilot one QA Workspace/reference Project and one Suite per Session; conformance uses at least two Projects and multiple concurrent Sessions |

External GitLab queue and pipeline execution duration is measured but is not claimed as a platform SLO. Live numeric targets may be tightened by immutable pilot metadata; deterministic CI uses virtual clocks rather than wall-clock percentile assertions.

## 4. Constitution check — before design

| Principle | Status | Enforcement |
|---|---|---|
| I. QA-first release | PASS | Adds only QA automated validation; one Suite maps to one independent Session in V1. |
| II. Jira authority | PASS | Jira remains operational work authority; automated execution cannot close or mutate a Jira Work Item. |
| III. Workspace/Project boundary | PASS | Suite, Session, request claim, Attempt, result, artifact, webhook and review records carry exact scope and same-scope constraints. |
| IV. Core/Pack/Connector | PASS | QA owns testing semantics and verdict flow; Core owns generic integration/reliability primitives; GitLab owns only provider protocol/state projection. |
| V. Deterministic core | PASS | Authorization, validation, allowlists, idempotency, retry, result mapping and review guards are deterministic and model-independent. |
| VI. Hermes/exact approvals | PASS | Explicit authorized non-prod smoke needs no second approval; Hermes can only prepare proposals. Autonomous regression remains out of scope. |
| VII. Human verdict | PASS | Technical result stops at `REVIEW_REQUIRED`; only a HUMAN resolves findings/flaky state and signs Session Outcome/Verdict. |
| VIII. Evidence/snapshot | PASS | Exact target, suite, Binding/Profile chain, schema, checksums and Attempt lineage are pinned and immutable. |
| IX. Reliability/audit | PASS | QA request claim, command/outbox, effect marker, no-blind-retry rule, reconciliation and append-only observations are explicit. |
| X. Integrations/local-first | PASS | Stateful Mock GitLab is mandatory and standalone tests need no corporate systems; the pilot release gate requires the combined Jira+GitLab+Mattermost composition, while each outage degrades independently. |
| XI. Versioning | PASS | Additive manifests/schemas/migrations; Feature 002 manual contracts remain byte-stable and readable. |
| XII. Production boundary | PASS | Production/deploy denied independently by identity, GitLab CI policy, Profile allowlist, platform policy and network. |

**Constitution exceptions:** none requested or granted.

## 5. Architecture and critical flows

### 5.1. Ownership and package boundaries

| Boundary | Owns | Must not own |
|---|---|---|
| Platform Core | Connection/Profile/Binding/ValidationReport, command/outbox/idempotency/effect gates, webhook inbox, generic ArtifactReference, authorization and audit | GitLab DTOs, suite/retry semantics, QA outcome or verdict |
| `competency-qa` | Suite Binding, AUTOMATED Session/PlanItem, shared Attempt identity, AutomationAttempt/result/retry/quarantine, Findings, review, Outcome and verdict policy | GitLab HTTP/auth/IDs as domain authority |
| Connector SDK | Typed provider-neutral source-context, test-executor and CI-artifact ports | provider persistence or QA lifecycle |
| `connector-gitlab` | GitLab auth/HTTP DTOs, discovery, Profile validation, source reads, trigger/status lookup, webhook normalization, artifact streaming | QA persistence, review, retry policy or arbitrary GitLab operations |
| `connector-gitlab-persistence-typeorm` | provider discovery facts, webhook/reconciliation state, effect lookup receipts and provider artifact locators | canonical QA Attempt/result/Finding/verdict |
| Runtime composition | static manifests, capability bindings, adapters, workers, controllers and named contours | dynamic plugin loading or policy exceptions |
| Mock Hub GitLab | protocol-faithful projects/MRs/commits/pipelines/jobs/artifacts/webhooks/faults | platform authorization or QA truth |
| UI contribution | availability, Suite/Session/Attempt/artifact/review projections | direct GitLab calls or client-supplied Profile/variable/job authority |

QA depends only on provider-neutral SDK ports. Connector packages do not import QA persistence. The runtime composition layer is the sole assembly boundary.

### 5.2. Capability projection and Suite publication

`qa.validation@1.2.0` adds an optional automation capability group:

```text
SOURCE_CONTEXT  → source-context.read@1.0.0
TEST_EXECUTION  → test-executor.trigger-status@1.0.0
ARTIFACT_SOURCE → artifact.ci-read@1.0.0
```

`FULL_QA` is the derived `qaCapabilityMode` configuration projection, not a
second onboarding aggregate:

```text
published Suite Binding
∩ compatible active Project Integration Binding/Profile chain
∩ all three GitLab capability roles
∩ current authorization and entitlement
∩ exact non-production policy
```

If the configuration intersection is incomplete, the API returns
`capabilityMode=MANUAL_ONLY` plus stable configuration reasons. Transient
GitLab health is returned separately as
`liveAvailability=AVAILABLE | DEGRADED | UNAVAILABLE` and never rewrites
`FULL_QA`; only `FULL_QA + AVAILABLE` permits launch. Manual QA stays usable.
GitLab and messaging requirements are optional in manifest 1.2 so manual-only
composition remains publishable. Versions 1.0 and 1.1 are never edited.

A Suite Binding is provider-neutral and versioned. It pins owner, exact suite
definition/hash, a logical pipeline/ref/result-job contract, accepted target
types, internal environment refs, allowed parameter schema, result
schema/digest, artifact/retry/quarantine policy refs, capability requirements
and exact composed validation evidence. The GitLab Profile maps those logical
selectors to the exact numeric project, trigger ref/job/artifact path and input
mapping. V1 creates one Session per Suite Binding.

### 5.3. Automated Session creation

```text
HUMAN selects Work Item + published Suite + build/MR/commit + non-prod environment
  → current RBAC, entitlement and derived FULL_QA availability
  → resolve exact Binding/Profile/Suite/configuration chain
  → validate allowed target/environment/parameters before adapter access
  → create AUTOMATED Session + PlanItem
  → pin immutable ScopeSnapshot and TargetSnapshot
  → state PLANNED → READY
```

TargetSnapshot includes exact build/commit/MR, environment revision, at least
one immutable versioned test-data or account-lease ref, browser/bounded accepted
parameter values plus canonical hash, Suite Binding ref/hash,
result/artifact/retry policies and actual Profile `{id, version}` refs. A
target change after start creates a linked new Session; validation requested
after human result/review freeze creates a linked same-target Session with a
closed replacement reason. Platform policy, production or cross-project denial
produces zero provider calls.

### 5.4. Exactly-once launch

The Session projection returns a current `launchConfirmation` only when a
launch/rerun is permitted. The user supplies `Idempotency-Key`, `If-Match` and
an exact echo of its target/Suite/configuration/session-version/action and
confirmation hashes. That POST is the explicit HUMAN command confirmation and
does not create a second approval. The caller never supplies arbitrary
variables, shell fragments, GitLab job names, Profile IDs, secret refs or raw
provider targets.

One PostgreSQL transaction:

1. reauthorizes HUMAN, scope, Session state/resource version, Suite and target allowlists;
2. claims unique `(workspaceId, projectId, testSessionId, requestKeyHash)` in `qa_automation_launch_requests`;
3. creates one shared Attempt identity and immutable AutomationAttempt;
4. pins the request/body hash, configuration chain, effect key and actor/correlation provenance;
5. creates one Core ConnectorCommand and outbox record;
6. transitions `READY → RUNNING` and commits.

Same key and same request hash returns the existing Attempt after current read authorization. Same key with a different hash is a conflict. This QA claim is required because the generic Core client-request identity also contains actor identity and cannot alone enforce US-002 across callers.

GitLab has no assumed native idempotent trigger. The connector uses a deterministic opaque marker/pipeline name derived from the Attempt and request-key commitment. Before a first trigger it may perform exact lookup. Once durable `effectInvocationStartedAt` exists, no blind trigger POST is allowed:

```text
trigger response confirmed → pin exact pipeline receipt
timeout/network loss after possible effect → LOOKUP_REQUIRED
  → exact lookup by project + marker + ref + SHA + bounded creation window
     one match → pin receipt and continue
     zero/multiple after bounded consistency window → AMBIGUOUS / INCOMPLETE
```

Transport retry of the same command is distinct from a QA domain retry. The latter always creates a new Attempt and a new pipeline after a completed technical result.

### 5.5. Status, result and webhook reconciliation

Pipeline/job webhook ingress performs body-size/content-type, exact connection/project, freshness, Standard Webhooks HMAC-SHA256, delivery dedupe/replay and same-ID/different-body conflict checks before durable receipt. A legacy `X-Gitlab-Token` value alone is not accepted as signature evidence. Exact supported dialect is pinned by Profile and pilot metadata.

Webhook delivery is an unordered signal, not terminal truth. The worker performs an authoritative pipeline/job/result read under the pinned project/profile, reduces only monotonic provider observations and uses bounded polling to repair missing or out-of-order events. Unknown schema, missing result, ambiguity or checksum mismatch becomes `INCOMPLETE` and requires review; it can never become PASS.

Each AutomationAttempt consists of immutable identity/configuration, append-only status revisions and exactly one immutable terminal technical result. The normalized outcomes are:

```text
PASS | ASSERTION_FAILED | INFRA_FAILED | TIMEOUT | CANCELLED | INCOMPLETE
```

The first terminal result moves the Session `RUNNING → REVIEW_REQUIRED`. Automatic retry or explicit HUMAN rerun may append another Attempt while the Session remains in sticky `REVIEW_REQUIRED`; there is no transition back to `RUNNING`. UI exposes derived execution activity separately.

### 5.6. Retry, flaky, quarantine and human review

QA automatic retry is allowed only when all are true:

- terminal outcome is `INFRA_FAILED`;
- exact infrastructure code is in the pinned deterministic policy allowlist;
- no automatic retry has already been created in the lineage;
- target, suite and configuration pins are unchanged;
- current non-production and authorization gates still pass.

`ASSERTION_FAILED`, unknown/schema drift, policy denial, 401/403 and any second infra failure are not automatically retried. 429/5xx and pre-effect transport failures follow bounded connector backoff; they do not consume the domain retry budget. Explicit HUMAN rerun uses a new request key and new immutable Attempt.

Every assertion-failure-to-PASS lineage retains both results and sets the existing `FLAKY_SUSPECTED` flag until HUMAN disposition. A purely allowlisted `INFRA_FAILED → PASS` recovery keeps its full infrastructure lineage but is not automatically classified as product flakiness. The disposition records actor, reason and evidence and does not introduce an automation-only Finding classification. Quarantine records owner, reason, expiry and provenance and never hides or rewrites failures.

Human review reuses Feature 002 Observation, Finding, result membership, evidence manifest, Session review and verdict primitives. Completion is blocked while any Attempt/command is nonterminal, a retry decision is open, reconciliation is incomplete, the Attempt-set hash changed, or required finding/flaky/risk review is unresolved.

Review/rerun races serialize on Session/PlanItem:

- rerun-first changes the Attempt-set hash and makes an older review CAS stale;
- review-first freezes the set and rejects later Attempts;
- after HUMAN result/review freeze, further validation requires a linked new Session.

Hermes, when Feature 004 is installed, may produce a schema-bound review packet and Finding drafts from authorized summaries. Raw artifact content is never automatic model context, and Hermes cannot trigger a pipeline, classify a Finding, resolve flaky state or sign an outcome/verdict.

### 5.7. Artifact authority

GitLab retains raw artifact bytes. After authoritative job/result validation, the platform creates a Core ArtifactReference owned exactly by the AutomationAttempt with:

- opaque provider locator and pinned project/pipeline/job/path identity;
- media/type metadata, byte size, checksum and descriptor-set hash;
- classification ceiling, retention/expiry and source Profile refs;
- Work Item/Session/Attempt provenance and audit correlation.

Artifact download always uses the Core authorization proxy, current Project Entitlement and classification policy, then streams through the pinned Connector Profile. A raw GitLab URL or possession of an external job ID is never authorization. Expired or checksum-mismatched content fails closed. No long-term platform copy is introduced in V1.

## 6. Project structure

### 6.1. Planning artifacts

```text
specs/005-gitlab-automated-validation/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── README.md
│   ├── capabilities.md
│   ├── openapi/gitlab-automated-validation-api.v1.yaml
│   ├── asyncapi/gitlab-automated-validation-events.v1.yaml
│   ├── schemas/*.schema.json
│   └── examples/*.json
└── tasks.md                 # generated later by speckit-tasks
```

### 6.2. Planned source changes

```text
packages/
├── connector-sdk/src/
│   ├── source-context.ts
│   ├── test-executor.ts
│   └── ci-artifacts.ts
├── connector-gitlab/src/
│   ├── auth/ http/ profile/ source-context/
│   ├── pipeline/ webhooks/ artifacts/ reconciliation/
│   └── manifest.ts
├── connector-gitlab-persistence-typeorm/src/
│   ├── entities.ts
│   ├── migrations/
│   └── repositories/
├── competency-qa/src/
│   ├── domain/suite-binding.ts
│   ├── domain/automation-attempt.ts
│   ├── application/plan-automated-session.ts
│   ├── application/trigger-automation.ts
│   ├── application/sync-automation-result.ts
│   └── application/automation-retry-policy.ts
├── platform-contracts/src/
│   └── schema-contributions.ts
└── runtime-composition/src/
    ├── gitlab/
    ├── qa/composition.ts
    └── worker/contributions.ts

apps/
├── api/src/extensions/
│   └── gitlab-automation/
├── web/src/
│   └── QA automated-session contribution
└── mock-hub/src/gitlab/
    ├── api/ control/ state/ scenarios/ webhooks/
    └── gitlab.module.ts

tests/
├── contract/005-*.spec.ts
├── architecture/005-*.spec.ts
├── integration/005-*.spec.ts
├── security/005-*.spec.ts
├── e2e/005-*.spec.ts
└── process/005-*.spec.ts

tools/
├── verification/feature-005-*.mts
├── smoke/feature-005-*.mts
└── scenarios/gitlab/*.mts
```

Also update root workspace/package exports, TypeScript path aliases, Nx/package manifests, architecture dependency rules and OpenAPI snapshot roots. No new deployable service or dynamic module system is introduced.

## 7. Contract design

### 7.1. Provider-neutral capabilities

| Capability | Allowed operations | Effect |
|---|---|---|
| `source-context.read@1.0.0` | `merge-request.read`, `commit.read`, `build.read` | READ |
| `test-executor.trigger-status@1.0.0` | `pipeline.trigger`, `pipeline.read`, `pipeline.lookup` | WRITE/READ |
| `artifact.ci-read@1.0.0` | `artifact.metadata`, `artifact.stream` | READ |

There are no typed operations for pipeline retry/cancel/delete, repository push, branch mutation, CI configuration edit, variable/secret read, deployment or production targeting.

### 7.2. Additive HTTP surface

```text
GET  /api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automation/availability
GET  /api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automation/suite-bindings
POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automation/suite-bindings
POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automation/suite-bindings/{bindingId}/versions/{version}/validate
GET  /api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automation/suite-bindings/{bindingId}/versions/{version}/validation-reports
POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automation/suite-bindings/{bindingId}/versions/{version}/publish

POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automated-sessions
GET  /api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automated-sessions/{sessionId}
GET  /api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automated-sessions/{sessionId}/attempts
POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automated-sessions/{sessionId}/attempts
GET  /api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automated-sessions/{sessionId}/attempts/{attemptId}
GET  /api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automated-sessions/{sessionId}/attempts/{attemptId}/status-revisions
GET  /api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automated-sessions/{sessionId}/attempts/{attemptId}/result
GET  /api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automated-sessions/{sessionId}/attempts/{attemptId}/retry-decision
GET  /api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automated-sessions/{sessionId}/artifacts

GET  /api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automation/quarantines
POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automation/quarantines
GET  /api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automation/quarantines/{quarantineId}
GET  /api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automation/quarantines/{quarantineId}/revisions
POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automation/quarantines/{quarantineId}/lift

POST /api/v1/connectors/gitlab/connections/{connectionId}/webhooks
```

Attempt creation requires `Idempotency-Key`, `If-Match`, current HUMAN authorization and a server-resolved configuration. Existing Feature 002 endpoints remain authoritative for Observations, Findings, result revisions, evidence manifests, Session review and verdict.

### 7.3. Event surface

Add only automation facts:

```text
qa.automation-attempt.created@1.0.0
qa.automation-attempt.status-observed@1.0.0
qa.automation-attempt.completed@1.0.0
qa.automation-retry.decided@1.0.0
qa.automation-artifact.registered@1.0.0
qa.automation-quarantine.changed@1.0.0
```

Reuse existing `qa.test-session.state-changed`, `qa.plan-item.result-recorded`, Finding, manifest and review events. All envelopes keep the existing scoped event contract and correlation/causation rules.

### 7.4. Schema compatibility

New JSON Schemas have new stable `$id` values and closed objects. Feature 002 manual schema IDs, bytes and examples remain unchanged; its negative automated fixture remains invalid against manual V1. Schema contribution order is `500`, after Feature 004. Contract tooling must resolve every local `$ref`, validate examples against exact schema IDs, build deterministic OpenAPI/AsyncAPI snapshots and reject drift.

## 8. Persistence and migrations

Applied migrations are never edited. Planned additive sequence:

| Migration | Responsibility |
|---|---|
| QA `2050` | Suite Binding header/versions/validation evidence, AUTOMATED Session/PlanItem mode and target extensions, provider-neutral Attempt identity plus safe manual backfill foundation |
| QA `2055` | AutomationAttempt, append-only status revisions, terminal results, launch request claims, retry lineage/decisions, artifact memberships; expand/backfill shared Observation/result/evidence FKs |
| QA `2060` | quarantine, Attempt-set/review freeze, sticky review and completion guards; validate new FKs/checks then contract obsolete direct-only paths |
| GitLab `4000` | discovery/Profile validation facts and exact project/source configuration |
| GitLab `4010` | webhook receipts/normalization, pipeline observations, rate and reconciliation state |
| GitLab `4020` | trigger effect lookup/ambiguity receipts and provider artifact locator state |
| Mock Hub `0060` | projects, MRs, commits, pipelines and jobs |
| Mock Hub `0061` | machine result/artifact descriptors and deterministic bytes/checksums |
| Mock Hub `0062` | trigger-call audit, webhook deliveries and persisted one-shot faults |

No Core migration is planned: existing command/effect, webhook and generic ArtifactReference models can hold the required opaque provider state. If implementation proves a structured Core invariant cannot be expressed through the existing locator/metadata contract, work stops for an explicit design/ADR review rather than smuggling GitLab semantics into Core.

The QA migration follows expand → backfill → dual validation → contract. Existing `qa_manual_attempts` remain canonical manual detail. Every row is backfilled into the shared Attempt identity, and Observation/result/evidence constraints move to that identity without changing manual contract digests. Fresh install, current-head upgrade, repeat/idempotence, rollback/failure recovery and PostgreSQL 17/18 are mandatory gates.

## 9. Security and failure behavior

| Condition | Required behavior |
|---|---|
| Missing authorization/entitlement/tool grant | deny before Connector call; audited stable reason |
| Suite/ref/environment/input not allowlisted | deny before secret resolution and provider call |
| Production/deploy target | deny at identity, CI job rules, Profile, runtime policy and egress; provider calls `0` |
| Cross-project trigger/webhook/artifact | reject/quarantine; never attach to a local Attempt |
| Trigger timeout before effect marker | bounded transport retry allowed by Profile |
| Possible trigger effect after invocation marker | exact lookup only; never blind POST |
| Exact lookup returns zero/multiple after bounded window | `AMBIGUOUS`/`INCOMPLETE`, HUMAN review; no second pipeline |
| Webhook duplicate/out of order/lost | dedupe/monotonic reduction/poll repair |
| Same delivery ID with different body | security conflict and quarantine |
| Invalid signature/stale timestamp | reject before domain projection |
| GitLab 401/403 | terminal auth/permission degradation; no retry |
| GitLab 429/5xx | bounded Profile backoff; preserve command/effect state |
| Unknown/missing result schema | `INCOMPLETE`; never PASS |
| Artifact expired/checksum mismatch/over classification | fail closed and audit; no raw content returned |
| GitLab outage | automated Sessions remain visible pending/error; manual QA and Jira continue |

Separate narrow project-scoped read, trigger and webhook signing references are
required. One schema-bound GitLab Connection configuration may hold the three
distinct `secretref://` references and an exact operation-to-slot map; the
outer Core `serviceIdentitySecretRef` must equal the read slot as a compatibility
anchor. Validation rejects equal slot refs/fingerprints. Secret values never
appear in configuration, logs, events, metadata, schemas or evidence. Source
text and artifact content are untrusted; neither becomes a tool instruction or
automatic model context.

## 10. Runtime and local contour

Mandatory standalone implementation/conformance key: `qa-jira-gitlab-local`.

Additional keys:

- `qa-jira-gitlab-mattermost-local` for the mandatory combined pilot release
  rehearsal and Feature 004 commands/notifications;
- metadata-gated development/test equivalents;
- no production equivalent.

`verify:005:pilot-release` accepts only the combined
`qa-jira-gitlab-mattermost-{development|test}` key with fresh Feature 003, 004
and 005 evidence. Local combined validation runs through
`verify:005:pilot-rehearsal` and can never emit deployment approval. Neither
gate creates a compile-time dependency from the GitLab Connector to Mattermost.

Stateful Mock GitLab implements only the used GitLab v4 surfaces: version, project, MR, commit/branch, CI lint, trigger pipeline, pipeline list/read/variables, jobs and exact job artifacts. Control routes set persisted faults, inspect state/call counts, advance pipelines and emit signed webhooks. It intentionally omits pipeline retry/cancel/delete, CI config writes, branch mutations, secret reads and deployments.

Required deterministic scenario catalog:

- Setup: Profile project discovery plus CI lint/dry-run, exact non-production
  identity/scope evidence and fail-closed publication on any drift;
- US1: automated Session, suite denial, environment denial, launch-origin denial
  for autonomous/non-human/large-regression requests, manual-only fallback and
  post-start target-change linked Session;
- US2: trigger once, command replay, stale/mismatched confirmation denial,
  timeout-after-effect, lookup zero and multiple;
- US3: PASS review-required, assertion no retry, allowlisted infra retry,
  unknown infra no retry, explicit assertion-failure→PASS flaky, schema drift,
  checksum mismatch, quarantine lifecycle, optional proposal-only Hermes review
  packet and post-review linked Session;
- US4: lost/duplicate/out-of-order webhook, outage with manual flow, auth revoked and rate-limit recovery.

## 11. Verification and evidence

Planned commands:

```text
verify:005:prerequisites
verify:005:governance
verify:005:setup
verify:005:foundation
verify:005:us1
verify:005:us2
verify:005:us3
verify:005:us4
verify:005:migrations
verify:005:observability
verify:005:quickstart
verify:005:nonprod
verify:005:pilot-rehearsal
verify:005:pilot-release
verify:005:evidence
verify:005
ci:005
smoke:005
trace:005
```

The standalone `final-gate.json` proves implementation/conformance only and
cannot authorize a pilot deployment. `verify:005:pilot-rehearsal` emits a local
`pilot-rehearsal.json` with no deployment authority. `verify:005:pilot-release`
emits a separate `pilot-release.json` bound to a combined DEVELOPMENT/TEST
contour plus fresh Feature 003, 004 and 005 evidence; no local or
`SKIPPED_GATED` dependency may be promoted to pilot PASS. Both successful
receipts validate against
`urn:awp:schemas:005:gitlab-pilot-gate-evidence:v1`; the release receipt and
metadata bind the exact successful rehearsal ref/hash.

Verification layers:

1. contract — JSON Schema/OpenAPI/AsyncAPI, examples, exact GitLab dialect, offline refs and registry drift;
2. architecture — dependency direction, static composition, no prohibited GitLab operations and no automated verdict path;
3. unit — canonical hashes, allowlists, status reducer, retry classifier, Attempt immutability and flaky truth table;
4. integration — transactionality, replay, worker restart, Redis loss, ambiguity lookup, webhook repair, artifact authorization and sticky review;
5. security — RBAC/entitlement/grants, scope isolation, injection/redaction, HMAC/replay and production/deploy denial;
6. migration — fresh/upgrade/repeat/failure recovery on PostgreSQL 17 and 18;
7. observability/performance — injected virtual clock proves acknowledgement
   p95, webhook visibility, polling recovery and terminal-to-artifact SLOs;
   bounded labels/cardinality and redaction checks prevent identifiers,
   request keys, credentials or untrusted text from becoming metric/log labels;
8. E2E/process/browser — US1…US4, Mock Hub/worker restarts and visible HUMAN review journey;
9. trace/evidence — every FR, SC and documented scenario maps to fresh source/contract/runtime/report hashes.

Final evidence is written to `reports/005-gitlab-automated-validation/final-gate.json` with:

```text
contour: qa-jira-gitlab-local
local: PASS
liveGitLab: PASS | SKIPPED_GATED
mattermostCompatibility: PASS | NOT_REQUESTED
production: DENIED
productionRunsSupported: false
```

`SKIPPED_GATED` live evidence is honest and does not block local completion or become a synthetic PASS.

## 12. Implementation milestones

1. **Governance/setup:** prerequisite pins, package scaffolding, workspace exports, architecture rules and contract registry contribution.
2. **Foundation:** SDK ports, QA 1.2 manifest, Suite Binding and shared Attempt migration/backfill.
3. **US-001:** derived availability, Suite validation/publication, automated Session/target snapshots and UI/API denial reasons.
4. **US-002:** launch claim, command/outbox, GitLab trigger adapter, effect marker, exact lookup and ambiguity recovery.
5. **US-003:** status/result reducer, artifact proxy, single infra retry, fail→PASS flag, quarantine and shared HUMAN review.
6. **US-004:** signed webhook ingress, polling repair, health/degradation, outage-safe manual flow and observability.
7. **Mock/live validation:** stateful Mock GitLab, deterministic scenarios, optional metadata-gated non-prod verifier.
8. **Hardening/handoff:** PostgreSQL matrix, security/browser/process gates, full traceability and immutable final evidence.

Each milestone must keep the repository buildable and must not publish a partially authorized capability. Tasks will preserve these dependencies and mark safe parallel work explicitly.

## 13. Constitution check — after Phase 1 design

| Principle | Result after design |
|---|---|
| I | PASS — one Suite per independent automated Session; manual and automated Sessions are distinct. |
| II | PASS — GitLab technical facts never replace Jira authority or close Jira work. |
| III | PASS — exact scope is carried and constrained through every configuration, command, receipt, result and artifact. |
| IV | PASS — SDK ports and runtime assembly prevent QA↔GitLab protocol coupling. |
| V | PASS — model-free deterministic gates own all security, state, retry and result decisions. |
| VI | PASS — one explicit HUMAN smoke launch is exact and audited; no autonomous regression capability exists. |
| VII | PASS — sticky `REVIEW_REQUIRED`, Attempt-set freeze and existing HUMAN review preserve verdict authority. |
| VIII | PASS — immutable target/configuration/attempt/result/artifact provenance is complete. |
| IX | PASS — two-layer idempotency, effect fencing, append-only status and reconciliation cover retries/restarts. |
| X | PASS — stateful local GitLab is mandatory for conformance; live GitLab is optional only there and mandatory in the combined DEVELOPMENT/TEST contour for pilot deployment. |
| XI | PASS — additive schema identities and expand/backfill/contract migrations preserve published manual history. |
| XII | PASS — five independent production/deploy deny layers are tested before and at adapter boundaries. |

**Post-design gate:** PASS. No constitutional violation, exception or new ADR is required.

## 14. Complexity and risks

There are no Constitution violations to record in Complexity Tracking. The two new Connector packages are justified boundaries: the pure adapter keeps protocol code testable, while durable GitLab reconciliation/effect state cannot live safely in Redis or QA tables.

| Risk | Mitigation |
|---|---|
| GitLab trigger has no trusted native idempotency | QA request claim, durable invocation marker, opaque pipeline marker and exact lookup; ambiguity never causes blind POST |
| Existing QA evidence FKs point at manual attempts | expand/backfill shared Attempt identity with PostgreSQL 17/18 migration gates; no parallel automated review model |
| Webhook dialect/version drift | exact Profile/pilot metadata, Standard Webhooks verification, authoritative read and contract fixtures |
| Result schema drift or missing artifact | closed versioned schema, hash/checksum verification and fail-closed `INCOMPLETE` |
| Sticky review races with retry/rerun | Session lock, Attempt-set hash/CAS and review freeze |
| GitLab outage blocks QA | automation health is isolated; manual Session and Jira paths are independent and continuously tested |
| Capability 1.2 accidentally breaks manual installations | automation and messaging groups are optional; 1.0/1.1 manifests and manual schema digests remain immutable |
| Pilot metadata absent | live validation is `SKIPPED_GATED`; required local evidence remains complete |
