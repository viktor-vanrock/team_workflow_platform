# Implementation Plan: Mattermost и Hermes intake

**Feature:** `004-mattermost-hermes-intake`

**Planning branch identifier:** `004-mattermost-hermes-intake`

**Repository checkout during planning:** `codex/feature-003-jira-authority` (left unchanged because the verified Feature 003 implementation is still uncommitted)

**Specification:** [spec.md](spec.md)

**Planned:** 2026-08-31

**Constitution:** `2.0.0`

## 1. Planning outcome

Feature 004 makes Mattermost plus the Hermes QA coordinator the preferred intake and notification surface while preserving the existing authority chain:

```text
Mattermost /awp create
  → stateless text-only first-party OIDC continuation
  → canonical OIDC HUMAN + current authorization
  → project-scoped WEB PROJECT_SELECT intent
  → project-scoped versioned Draft or discovered Candidate
  → deterministic QA completeness + schema-bound Hermes proposals
  → exact HUMAN confirmation of one Draft revision
  → existing Feature 003 durable Jira request.create path
  → authoritative Jira read-back + Work Item materialization
  → independent durable Mattermost NotificationIntent
```

The design adds:

- a pure, statically composed `@awp/connector-mattermost` adapter and a protocol-faithful stateful Mock Hub contour;
- an authority-free static slash bootstrap plus versioned project-scoped ingress declarations for dialogs and interaction callbacks, separate from outbound Broker effects;
- canonical OIDC authentication with verified reverse Mattermost binding, full authorization filtering and project-scoped single-use `InteractionIntent` records;
- provider-neutral Candidate/source-observation/decision contracts and append-only Intake Draft revisions;
- a Core-owned Agent Runtime, Skill Registry, immutable derived Tool Grants and Tool Gateway;
- QA-owned Hermes skill definitions, deterministic fallbacks, TriageAssessment and SessionPlanProposal records;
- durable NotificationIntent delivery through the existing Connector command/outbox/worker machinery;
- local-first security, failure, migration, browser and process gates for US-001…US-004.

Mattermost is not a source of truth, Hermes is not a human principal, and neither receives a second Jira-create path. Production actions, arbitrary channel history, model-controlled grants, final verdicts and critical approvals in chat remain excluded.

## 2. Inputs, dependencies and entry gates

### 2.1. Normative inputs

Priority order on conflict:

1. [Constitution 2.0.0](../../.specify/memory/constitution.md)
2. [Feature specification](spec.md)
3. [ADR-0004: Workspace and Project Entitlement](../../docs/adr/0004-workspace-project-entitlement.md)
4. [ADR-0005: Hermes coordinator and approvals](../../docs/adr/0005-hermes-coordinator-approval.md)
5. [ADR-0006: Project Integration Binding versioning](../../docs/adr/0006-project-integration-binding-versioning.md)
6. [ADR-0007: action-specific exact Approval](../../docs/adr/0007-action-specific-exact-approval.md)
7. [Accepted ADR-0008: exact Agent Run subject union](../../docs/adr/0008-agent-run-subject-union.md)
8. [Feature 003 design and verified evidence package](../003-jira-operational-authority/plan.md)
9. [Agentic Workspace Platform master specification](../../docs/agentic-workspace-platform-master-spec-v2.md)
10. [External systems integration request](../../docs/external-systems-integration-request-v2.md)
11. [research.md](research.md), [data-model.md](data-model.md), and this plan

The former governance conflict is resolved. ADR-0005 Decision 1 and Constitution VI previously
restricted every Agent Run to a Work Item, while guided intake necessarily operates on an exact
Draft/Candidate before any Work Item may exist. Accepted ADR-0008 partially supersedes only that
subject clause, and Constitution 2.0.0 defines the closed `DRAFT | CANDIDATE | WORK_ITEM` union
without weakening Project scope, Jira authority or the remaining Hermes/approval invariants.
Explicit human review accepted both changes on 2026-09-01; no exception was granted.

### 2.2. Feature 003 implementation prerequisite

Story/domain implementation beyond Phase 1 setup begins only when a task-bound prerequisite
verifier proves:

- `reports/003-jira-operational-authority/final-gate.json` is a valid local `PASS` for the exact current sources/contracts;
- the published Core/QA/Jira contract digests consumed by 004 match that report;
- the Feature 003 intake confirmation, command outbox, worker recovery, authoritative read-back and Work Item materialization path still passes;
- migrations through Core `0095`, QA `2030`, and Mock Hub Jira `0042` are registered and verified;
- optional live Jira non-prod evidence is reported honestly as `PASS`, `FAIL`, or `SKIPPED_GATED`.

`SKIPPED_GATED` corporate Jira evidence does not block the required local 004 contour. It also does not authorize a live contour or become a synthetic PASS.

### 2.3. Mattermost/model C1 metadata gates

The required contour is `qa-jira-mattermost-local`, using the stateful Mock Hub and deterministic fake model. Live validation is opt-in and requires immutable `MattermostPilotMetadataPackage@1.0.0` with:

- exact server/build/API and adapter compatibility;
- base URL, TLS/network owner and environment class;
- exact Workspace/Project, fixed bootstrap-continuation/evidence refs and project-scoped Connection/Profile/validation-report refs and hashes;
- project/environment-scoped bot and optional callback-gateway credential refs plus immutable distinct Core presentation-token envelope-key metadata when callbacks are enabled (exact key version/purpose/scope/environment/fingerprint/decrypt horizon), safe credential-identity fingerprints and owner/rotation/revocation path;
- immutable presentation-token retention policy/evidence with numeric maximum capsule lifetime, expiry sweep/purge SLA, same-UoW terminal purge, WAL/backup bounds and key-disable SLA;
- team, bot and exact channel IDs plus bot membership evidence;
- explicit project-scoped callback scheme or `DISABLED` for a profile that omits the optional callback capability;
- callback delivery identity, freshness/retry horizon and receipt-retention rules;
- external-principal binding source and current membership source;
- versioned templates, audience/classification ceilings and redaction policy;
- message/rate/timeout/retry/reconciliation limits plus immutable validation-evidence hashes for static bootstrap, callback ingress, membership, notification, redaction and reconciliation;
- explicit operator opt-in and production-deny attestation.

The public bootstrap has no Connector Connection, credential, bot authority, Project access, identity claim or durable receipt. It validates only the bounded `/awp create` form and returns deterministic text containing the configured first-party OIDC continuation. Every callback/delivery Connection, Profile, bot and optional gateway credential is scoped to exactly one Workspace and Project. The composed-package validator resolves every reference and verifies matching digests, scope, role, fixed-bootstrap evidence and policy evidence; JSON shape alone is not a publication PASS. Publication also rejects inverted retry bounds, duplicate `(teamId, channelId, purpose)` tuples, reuse of a Mattermost bot user or credential-identity fingerprint across Projects or environment classes, and an active team/channel alias claimed by another Project Profile. The external Mattermost bot/credential is distinct from the internal Hermes SERVICE principal and never receives Agent Tool Grants.

An optional real model contour requires a separate immutable provider package with endpoint/region, model/version, classification ceiling, retention/training policy, credential ref, budgets and opt-in. Missing or incompatible metadata yields `SKIPPED_GATED`, never a guessed Profile or live PASS. `PRODUCTION` is rejected before network access.

### 2.4. Phase outputs

- [research.md](research.md) — resolved transport, identity, Candidate, Agent, prompt, notification and rollout decisions;
- [data-model.md](data-model.md) — entities, constraints, state machines and atomicity;
- [contracts/](contracts/) — versioned HTTP, event, ingress, capability and domain schemas;
- [quickstart.md](quickstart.md) — runnable local and gated live validation guide;
- [tasks.md](tasks.md) — dependency-ordered implementation tasks generated after governance acceptance.

## 3. Technical Context

| Area | Decision for 004 |
|---|---|
| Language/runtime | TypeScript `6.0.3`, strict ESM/ES2024, Node.js `24.20.x` |
| Workspace/tooling | pnpm `11.21.x`, Nx `23.1.x`, frozen lockfile |
| Backend/runtime | NestJS `11.2.x` transport adapters; Core/QA/Mattermost domain logic framework-independent |
| Web fallback | React `19.2.x`, Vite `8.2.x`, MUI via `platform-ui`; no direct Connector calls |
| Mattermost transport | Native `fetch` behind injected HTTP/auth/secret/clock ports; no vendor SDK required |
| Contracts | OpenAPI 3.1, AsyncAPI 3.0, JSON Schema 2020-12, TypeBox/Ajv, offline refs and canonical SHA-256 fingerprints |
| Durable storage | PostgreSQL 17/18, TypeORM `1.1.x`, `synchronize:false`; Redis/BullMQ is reconstructible delivery/scheduling only |
| Identity | Canonical OIDC HUMAN first; existing project Connection-scoped `external_principal_bindings` provide exact verified reverse routing to an opaque Mattermost user ID |
| Agent runtime | Core state machine and Tool Gateway in existing API/worker deployment units; no new service or free-form memory store |
| Model use | Optional narrow `ModelProposalPort`; deterministic local fallback is mandatory and provider-independent |
| Testing | Vitest 4, real PostgreSQL/Testcontainers, stateful Mock Hub conformance, Playwright Chromium, process smoke and trace/evidence gates |
| Observability | OTel-compatible structured audit/log/trace/metrics with safe scope/config/correlation refs and strict redaction |
| Deployment | Required local contour; opt-in `DEVELOPMENT`/`TEST`; `PRODUCTION` denied at schema, composition, policy, credentials and network |
| Performance goal | The static bootstrap performs no identity, Project, Jira/model/Mattermost outbound or durable operation before its deterministic acknowledgement. OIDC project-option issuance is a bounded local authorization/intent transaction; project callbacks commit a receipt before asynchronous domain work. Worker latency/retry follows immutable Profile budgets. |
| Reliability goal | Bootstrap retries are deterministic/stateless; callback delivery, InteractionIntent, Agent request, Draft confirmation and notification effect are independently idempotent; ambiguous external effects are never blindly retried |
| Scale/scope | Pilot: one QA Workspace/reference project/team, DM plus bound project channels; conformance uses at least two Projects to prove isolation and remains multi-project safe |

No major toolchain upgrade is introduced. Any new package request must satisfy the repository dependency, lockfile and release-age policy; the preferred implementation adds no Mattermost SDK or autonomous-agent framework.

## 4. Constitution Check — before design

| Principle | Status | Enforcement |
|---|---|---|
| I. QA-first release | PASS | Reuses `qa.validation`; adds only QA intake/proposal/notification surfaces. |
| II. Jira authority | PASS | Exact Draft confirmation enters the existing Feature 003 `request.create` command and authoritative read-back; Candidate/Draft/Agent output is never operational work. |
| III. Workspace/Project boundary | PASS | Candidate, Draft revision, InteractionIntent, callback receipt, Agent Run, tool invocation, assessment, proposal, command and notification are project-scoped. Before OIDC there is no durable state; after authentication each presented option is an exact project-scoped `WEB PROJECT_SELECT` intent and no projectless row is created. |
| IV. Core/Pack/Connector | PASS | Core owns generic identity, workflow, Agent and delivery primitives; QA owns semantics/skills; Mattermost owns only wire protocol and Profile validation. |
| V. Deterministic core | PASS | Auth, scope, state, validation, idempotency, retry, Jira invocation and fallback do not depend on a model. |
| VI. Hermes/exact approvals | PASS | Accepted ADR-0008 and Constitution 2.0.0 authorize the exact Draft/Candidate/Work Item subject union while preserving project scope, minimal grants and existing exact approvals. |
| VII. Human verdict | PASS | No Hermes/chat action signs verdict or release state. |
| VIII. Evidence/snapshot | PASS | Proposals pin fact refs/versions/hashes and become stale on drift; raw history and attachments are not model context. |
| IX. Reliability/audit | PASS | Stateless bootstrap, project-scoped callback receipt/event/command outboxes, separate replay CAS, effect reconciliation, bounded retry and full actor/config provenance. |
| X. Local-first | PASS | Same connector/runtime runs against a stateful protocol Mock Hub; corporate credentials are optional gates. |
| XI. Versioning | PASS | Additive contracts/migrations and immutable Profiles; 001–003 rows and capability versions remain readable. |
| XII. Production boundary | PASS | Only `LOCAL | DEVELOPMENT | TEST` are allowed; `PRODUCTION` is denied before egress. |

**Constitution exceptions:** none requested or silently granted.
**Governance gate:** satisfied by Accepted ADR-0008 and Constitution 2.0.0; no exception was granted.

## 5. Architecture and critical flows

### 5.1. Ingress, identity and project selection

```text
POST /api/v1/public/mattermost/awp-bootstrap
  → bounded form shape requires exactly /awp + create
  → ignore actor/team/channel/token/trigger/response_url
  → deterministic text-only 200 with one fixed first-party OIDC URL
  → no Connection, credential, receipt, identity lookup, audit or durable state
  → canonical OIDC login in first-party web UI
  → POST fresh project-option set with full current qa.request.create authorization
  → one project-scoped WEB PROJECT_SELECT intent per permitted Project
  → HUMAN consumes one exact opaque token in the authenticated web session
  → direct versioned Draft transaction
  → optional project-scoped DM NotificationIntent
```

Before OIDC authentication, no Candidate, Draft, InteractionIntent, receipt, action-provenance row, Agent Run, tool grant, command or external effect exists. The bootstrap response is byte-stable for one configured continuation version and cannot reflect Mattermost fields, list Projects, issue tokens or invoke a bot. After OIDC, the option-set API uses the full `qa.request.create` policy—not the current entitlement-only `listVisibleProjects` helper—and creates one separately scoped, expiring `WEB PROJECT_SELECT` intent per authorized option. Each issuance atomically invalidates prior PENDING option intents for the same principal/OIDC session/continuation and returns a fresh set, so no raw token is retained merely to reconstruct an ambiguous response. The browser receives safe labels plus opaque tokens; it never supplies authoritative Workspace/Project IDs. Each intent pins the canonical principal, verified Mattermost binding needed for later DM, exact Project authorization snapshot, Binding/Profile/Connection refs and OIDC-session hash. A DM may lack `team_id`, so scope is never inferred from a team, channel name, free text or client-supplied identifier.

Dialog and post-action callbacks exist only after Project scope is known. They enter exact project Connection routes and follow body-size/content-type gate → immutable callback contract → opaque-intent and optional gateway-HMAC verification → freshness/delivery identity → bounded normalization → project-scoped durable receipt CAS → asynchronous domain processing. Each callback token pins actor, Project, logical presentation target plus immutable delivery-result route, subject/version/hash and configuration; callback input cannot reinterpret them or invent a DM channel/post.

Transport replay and domain action consumption are separate:

- the static bootstrap is deterministic and stateless, so retry needs no receipt or plaintext token reconstruction;
- a trusted callback gateway delivery ID uses same-ID/same-hash replay and same-ID/different-hash quarantine;
- a project callback contour without such an ID uses exact-body fingerprint receipts; a changed attempt is distinct and still cannot bypass the InteractionIntent CAS;
- wrong actor/team/channel cannot consume an InteractionIntent;
- expected actor with revoked binding/permission or stale subject terminally invalidates it;
- one CAS winner performs the mutation; replay returns its stable safe result.

The InteractionIntent token is never a callback delivery ID, so a wrong actor cannot poison the legitimate actor's receipt key. Every callback receipt is already project-scoped, its normalized envelope is bounded and schema-valid, and no raw body is persisted.

### 5.2. Guided intake and exact Jira creation

```text
selected Project
  → Draft header + immutable revision 1
  → QA pre-confirmation completeness assessment
  → optional Hermes qa-intake-assist / qa-intake-readiness proposal
  → HUMAN accepts bounded QA field patch through revision CAS
  → immutable confirmation summary pins:
       Project, requester, classification, Draft revision/hash,
       Work Type definition, Jira Binding/Profile/Mapping/Connection,
       source refs, target/environment, expiry and request key
  → exact HUMAN DRAFT_CONFIRM InteractionIntent or web confirmation
  → shared confirmQaIntake application use case
  → existing Feature 003 command/outbox/worker/Jira read-back
  → exactly one Jira QA Request and then one accepted Work Item
```

The existing controller-local raw-SQL Draft creation and confirmation assembly are moved behind one provider-neutral application use case used by web and Mattermost. Draft revisions use one standalone structural-partial schema with exactly the canonical Feature 002 `urn:awp:schemas:qa:intake:v1` field vocabulary and value types; there is no parallel chat-specific QA vocabulary. `VALID` requires the canonical structural minimum `{schemaVersion, title, requestKind, requestedClassificationKey}`, while confirmation still revalidates the exact pinned full schema and current business-readiness rules. Pre-confirmation completeness is a new QA assessment; it does not reuse the existing post-acceptance readiness evaluator that requires an accepted request.

Editing creates a new revision and invalidates old summaries/intents. Hermes can propose a closed QA-content patch but cannot change Project, requester, classification, configuration pins, confirmation, Jira-owned fields, verdict or release fields.

### 5.3. Candidate discovery

```text
allowlisted Jira event
  → existing verified ingress signal
  → authoritative Jira read under exact Feature 003 binding
  → allowlisted trigger evaluation
  → Candidate dedupe by Project + authority/type/id + trigger ref/version
  → append source observation for new source version/fingerprint
  → notification/web presentation
  → HUMAN CREATE | SNOOZE | IGNORE
       CREATE → origin-linked Draft only
       others → append decision only
```

A Candidate never creates Jira work, SLA or WIP. Source version is deliberately excluded from Candidate identity so an updated Jira entity appends an observation instead of producing duplicates. The GitLab producer remains disabled until Feature 005 publishes authoritative source observations, but it will consume the same contract.

The existing Feature 003 unknown-Jira import path is not reused for candidate triggers: an allowlisted `Ready for QA` signal must not silently become direct operational import.

### 5.4. Hermes Agent Runtime and Tool Gateway

```text
verified HUMAN request on exact DRAFT | CANDIDATE | WORK_ITEM
  → canonical Hermes SERVICE identity + current authorization
  → static AgentDefinition/SkillDefinition
  → derive immutable grant =
       service ceiling ∩ skill allowlist ∩ HUMAN current permission
       ∩ exact scope/profile/classification
  → typed PromptManifest of allowlisted UNTRUSTED fact segments
  → deterministic step and optional ModelProposalPort
  → closed JSON Schema validation
  → semantic Tool Gateway reauthorization
  → read/proposal/Draft-CAS/NotificationIntent only
```

Core owns run/grant/step/invocation/audit/idempotency. QA Pack owns the nine versioned skill definitions and QA outputs. Each Run selects one Skill and therefore one output schema:

- `qa-intake-assist`;
- `qa-intake-readiness` for Draft pre-confirmation completeness;
- `qa-work-item-readiness` for accepted Work Item QA readiness;
- `qa-triage`;
- `qa-session-plan`;
- `qa-result-review-prep`;
- `qa-defect-draft`;
- `qa-dod-check`;
- `qa-notify`.

| Skill | Allowed subject | Versioned output | Deterministic fallback | Tool allowlist |
|---|---|---|---|---|
| `qa-intake-assist@1.0.0` | DRAFT | [`intake-draft-assistance@1.0.0`](contracts/schemas/intake-draft-assistance.v1.schema.json) | Missing/invalid-field selector plus structured form | Draft read; bounded patch proposal only |
| `qa-intake-readiness@1.0.0` | DRAFT | [`intake-completeness@1.0.0`](contracts/schemas/intake-completeness.v1.schema.json) | Exact QA intake schema/rules; ask only missing/invalid fields | Draft read; proposal only |
| `qa-work-item-readiness@1.0.0` | WORK_ITEM | existing [`qa readiness v1`](../002-qa-manual-walking-skeleton/contracts/schemas/qa/readiness-assessment.v1.schema.json) | Existing accepted-request DoR rules | Work Item read; proposal only |
| `qa-triage@1.0.0` | DRAFT, CANDIDATE, WORK_ITEM | [`triage-assessment@1.0.0`](contracts/schemas/triage-assessment.v1.schema.json) | Dimension/risk rules | Scoped fact reads; proposal creation only |
| `qa-session-plan@1.0.0` | WORK_ITEM | [`session-plan-proposal@1.0.0`](contracts/schemas/session-plan-proposal.v1.schema.json) | Stable plan template | Scoped QA reads; proposal creation only |
| `qa-result-review-prep@1.0.0` | WORK_ITEM | [`result-review-preparation@1.0.0`](contracts/schemas/result-review-preparation.v1.schema.json) | Existing evidence/result checklist | QA evidence/result reads; proposal only |
| `qa-defect-draft@1.0.0` | WORK_ITEM | existing [`defect-draft-proposal v1`](../002-qa-manual-walking-skeleton/contracts/schemas/qa/defect-draft-proposal.v1.schema.json) | Existing deterministic defect form | Finding/evidence reads; existing DefectDraft proposal only |
| `qa-dod-check@1.0.0` | WORK_ITEM | existing [`dod-assessment v1`](../002-qa-manual-walking-skeleton/contracts/schemas/qa/dod-assessment.v1.schema.json) | Existing completion/DoD rules | QA state/evidence reads; proposal only |
| `qa-notify@1.0.0` | DRAFT, CANDIDATE, WORK_ITEM | [`notification-intent@1.0.0`](contracts/schemas/notification-intent.v1.schema.json) | Versioned template renderer | NotificationIntent creation only |

For guided intake, the question selector returns a stable ordered list of missing/invalid field keys and their schema-bound prompts; fields already valid in the exact revision are never asked again. E2E and property tests prove this independently of model output.

The model sees no tokens, Profile selectors, tool grants, system-policy fields, arbitrary channel history or attachment bodies. Invalid/timeout/rate-limited/unavailable model steps use a typed deterministic fallback. The Run is `COMPLETED` only if that fallback succeeds; otherwise it fails with a stable reason and zero unauthorized tool/Connector calls.

TriageAssessment and SessionPlanProposal are append-only QA-owned proposals. A current fingerprint mismatch marks them stale before display/use. They do not overwrite Jira priority/due/assignee, queue order, accepted Sessions, human verdict or release decision.

### 5.5. Notification delivery and outage behavior

```text
Jira/QA domain transaction
  → canonical event/outbox commits independently of Mattermost
  → idempotent notification projection chooses exactly one branch
      ├─ MESSAGE: NotificationIntent → one messaging.notify command
      └─ INTERACTION_PRESENTATION: queued NotificationIntent
           + 1..8 action InteractionIntents/capsules
           + one messaging.callback command/outbox in one UoW
  → effect-time service/profile/channel/classification recheck
  → interactive command lends one-shot token values to Connector only
  → Connector renders exact bytes and worker durably records effectInvocationStartedAt
  → connector POST /api/v4/posts with deterministic marker
      ├─ confirmed post → DELIVERED
      ├─ 400/401/403/channel-policy failure → terminal + health degradation
      └─ 429/5xx/timeout/network loss after invocation marker
           → Profile-matched reconciliation, never another POST
           ├─ PENDING_POST_ID/EFFECT_MARKER → LOOKUP_REQUIRED
           │    ├─ one exact post → DELIVERED
           │    └─ zero/multiple → AMBIGUOUS, erase capsules
           └─ NONE_AMBIGUOUS/unsupported → direct AMBIGUOUS, erase capsules
  → a future versioned provider contract may add bounded retry only after durable
    NOT_APPLIED proof; V1 exposes no such outcome
```

Semantic notification dedupe is `source event + template ref + target ref + delivery kind + optional action-set hash`; the exact Connector effect-idempotency-key string derives from immutable intent ID + render hash + optional action-set hash, while domain/event contracts retain only its SHA-256 commitment. `INTERACTION_RESPONSE.sourceInteractionIntentId` routes an existing response and is distinct from `delivery.actionInteractionIntentIds`. `PRINCIPAL_DM` remains a logical target until the effect result pins exact provider channel/post IDs; callbacks verify those IDs through that immutable result. A reconciliation ref must match the pinned Profile and exact invocation-owning command attempt/fence: the pending ID is byte-equal, or the marker hash is SHA-256 of that attempt's exact UTF-8 marker bytes. Configuration drift before first invocation is terminal and never silently redirects to a new channel/Profile. Terminal intent/command transitions purge capsule material in the same UoW; wall-clock expiry is fail-closed and swept. Mattermost outage cannot roll back or rewrite Jira/QA state; web and manual flows continue.

### 5.6. Bounded ownership

| Module | Owns | Must not own |
|---|---|---|
| Platform Core | Candidate/Draft revision/confirmation, external interaction receipt/intent and sealed presentation-materializer, Agent Runtime/Tool Gateway, NotificationIntent, policy/audit/idempotency/outboxes | QA scoring/readiness semantics, Mattermost DTO/auth, Jira REST |
| `competency-qa` | Intake completeness, Hermes QA Skill Definitions/fallbacks, TriageAssessment, SessionPlanProposal and acceptance into existing QA use cases | tokens, channel IDs, Jira DTOs, generic Agent authorization |
| Connector SDK/contracts | Typed messaging presentation/delivery contracts, runtime context, fenced presentation-materializer port and provider-neutral receipts/errors | domain policy, raw-token persistence or provider HTTP parsing |
| `connector-mattermost` | Auth dialects, form/callback normalization, Profile discovery/validation, bot REST, target resolution and reconciliation | Core/QA persistence, project authorization truth, model orchestration |
| Core persistence adapter | Scoped rows, append-only/CAS constraints and atomic UoWs | vendor mapping or HTTP calls |
| Runtime composition | Static manifests/registries, Profile validators, ingress handlers and named worker contributions | dynamic plugins or domain exceptions |
| Mock Hub Mattermost | External teams/channels/users/membership/posts, delivery IDs, effect markers and fault scenarios | Platform identity/authorization or canonical QA/Jira state |
| Web/QA UI contribution | Candidate, Draft, assessment/proposal, delivery health and web-only approval views | direct Connector/model calls or authorization truth |

## 6. Project structure

### 6.1. Documentation and contracts

```text
specs/004-mattermost-hermes-intake/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── README.md
    ├── capabilities.md
    ├── openapi/mattermost-hermes-intake-api.v1.yaml
    ├── asyncapi/mattermost-hermes-events.v1.yaml
    ├── schemas/
    │   ├── events/*.v1.schema.json
    │   ├── ingress/{normalized-*,*-acknowledgement}.v1.schema.json
    │   ├── connector-ingress-contract.v1.schema.json
    │   ├── action-provenance.v1.schema.json
    │   ├── mattermost-profile.v1.schema.json
    │   ├── mattermost-pilot-metadata.v1.schema.json
    │   ├── intake-candidate.v1.schema.json
    │   ├── qa-intake-partial-content.v1.schema.json
    │   ├── intake-draft-revision.v1.1.schema.json
    │   ├── intake-draft-assistance.v1.schema.json
    │   ├── intake-completeness.v1.schema.json
    │   ├── interaction-intent.v1.schema.json
    │   ├── interaction-presentation-aad.v1.schema.json
    │   ├── interaction-presentation-aead-vector.v1.schema.json
    │   ├── hermes-agent-run.v1.schema.json
    │   ├── prompt-manifest.v1.schema.json
    │   ├── result-review-preparation.v1.schema.json
    │   ├── triage-assessment.v1.schema.json
    │   ├── session-plan-proposal.v1.schema.json
    │   └── notification-intent.v1.schema.json
    └── examples/
        ├── mattermost-pilot-metadata.local.v1.json
        ├── guided-intake.local.v1.json
        └── interaction-presentation-aead.vector.v1.json
```

### 6.2. Target source layout

```text
packages/connector-mattermost/
├── src/index.ts
├── src/manifest.ts
├── src/auth/
├── src/http/
├── src/ingress/
├── src/profile/
├── src/presentation/
├── src/notifications/
└── src/reconciliation/

packages/platform-core/src/
├── work-management/{intake-candidate,intake-draft-revision}.ts
├── interactions/{ingress-contract,interaction-intent,presentation-materializer}.ts
├── agent-runtime/{agent-definition,agent-run,skill-registry,tool-gateway,model-proposal-port}.ts
└── notifications/notification-intent.ts

packages/platform-persistence-typeorm/src/
├── {intake-candidate,intake-draft-revision,interaction-intent,interaction-presentation-secret}.repository.ts
├── {agent-runtime,notification-intent}.repository.ts
├── entities/composition.ts
└── migrations/core/{0100,0105,0110,0120}-*.ts

packages/competency-qa/src/
├── application/{intake-completeness,session-plan-proposal}.ts
├── domain/{triage-assessment,session-plan-proposal}.ts
├── skills/
└── persistence/migrations/2040-hermes-proposals.ts

packages/runtime-composition/src/
├── mattermost/
├── hermes/
└── config/environment.ts

packages/platform-runtime-nest/src/http/
├── intake-candidates.controller.ts
├── intake-draft-revisions.controller.ts
├── agent-runs.controller.ts
└── notification-intents.controller.ts

apps/api/src/extensions/
├── mattermost-bootstrap.controller.ts
├── mattermost-project-selection.controller.ts
├── mattermost-ingress.controller.ts
├── mattermost-integration.controller.ts
└── qa-hermes-proposals.controller.ts

apps/mock-hub/src/mattermost/
├── state/
├── api/
├── control/
└── scenarios/

tests/
├── architecture/004-*.spec.ts
├── contract/004/
├── integration/004/
├── integration/security/004/
└── e2e/004-*.spec.ts
```

**Structure decision:** extend the existing monorepo boundaries and deployment units. Generic Core
HTTP surfaces remain in `platform-runtime-nest`; provider-specific Mattermost bootstrap, ingress,
selection and administration controllers live in the API app extension layer so the generic Nest
adapter never imports provider vocabulary. One new pure Connector package is justified by the
independent provider boundary; no standalone Hermes service, Mattermost persistence package,
agent-memory store or duplicate notification outbox is added.

## 7. Contract design

### 7.1. Capability and ingress model

The 004 composition publishes successor `competency-qa@1.1.0` and `qa.validation@1.1.0` definitions alongside immutable 1.0 history. The successor declares logical requirements `INTAKE_MESSAGING → messaging.intake` and `NOTIFICATION_MESSAGING → messaging.notify` as required for 004 pilot readiness, plus optional `INTERACTION_MESSAGING → messaging.callback`. Prior 001–003 compositions remain pinned to 1.0; accepted rows are never silently rebound.

The Mattermost manifest advertises the FR-001 contract keys:

- `messaging.intake@1.0.0` — provider-owned guided-intake presentation;
- `messaging.notify@1.0.0` — outbound `WRITE` delivery through ConnectorBroker;
- optional `messaging.callback@1.0.0` — provider-owned interactive presentation.

Project-scoped dialog/post-action routes are declared separately as versioned `ConnectorIngressContract@1.0.0`. The existing `READ | WRITE` effect enum is not widened with a fake write. Each callback contract pins route kind, accepted content type/size, opaque-intent plus optional gateway auth, freshness/retry horizon, transport-attempt identity mode, exact normalized/acknowledgement SchemaRefs, Profile compatibility and route-valid `200` response. Its closed schema binds route/auth/replay combinations; publication semantics additionally require an ordered Profile SemVer range and receipt retention of at least retry horizon plus clock skew.

The V1 public bootstrap accepts only `/awp create` and returns text-only static continuation content. It is neither a Connector ingress contract nor a Profile command: there is no preselection Project Profile, Connection, credential, actor trust or receipt. Bare `/awp`, `/awp status`, or any unknown subcommand is safe help/denial and never acquires create or read semantics. A later status command requires its own authenticated subject/authorization/presentation contract rather than sharing project-selection behavior implicitly.

After canonical OIDC authentication, the web API issues exact project-scoped selection intents from current authorization. Consuming one resolves a project-scoped Binding/Connection/Profile/bot credential before any Mattermost content read or send; no Workspace-scoped Connector credential exists.

All provider-owned message requests use versioned template refs/hashes, schema-bound variables, a logical target (`PROJECT_CHANNEL | PRINCIPAL_DM | INTERACTION_RESPONSE { sourceInteractionIntentId }`), classification/redaction decisions and opaque interaction refs. Hermes/client requests cannot supply arbitrary markdown, `channelId`, `response_url`, URL, credential or token. A `callback.present` command separately carries an ordered bounded `actionInteractionIntentIds` set; one post may therefore expose CREATE/SNOOZE/IGNORE without three effects. Its projection transaction creates the queued NotificationIntent, one command/outbox and all exact intents plus project-scoped AEAD capsules atomically.

Each capsule pins the versioned `InteractionPresentationAadV1` schema digest, exact UTF-8/JCS codec, 12-byte-nonce/16-byte-tag AES-256-GCM parameters, AAD/ciphertext hashes, immutable scope-specific key version/decrypt horizon, exact command ID/capability/effect-key hash, target/payload/render hashes, full intent authority/configuration/transport/subject commitments, `retainUntil` and unique slot. A machine-readable golden vector fixes cross-runtime encrypt/decrypt bytes. The Core materializer validates those commitments and returns a one-shot non-serializable sensitive lease; the Mattermost Connector builds the transient DTO with logging/tracing/body capture suppressed. Only a crash before durable `effectInvocationStartedAt` may rebuild the same bytes. Once marked, the command can only reconcile; V1 zero/multiple/unsupported lookup is terminal `AMBIGUOUS`, not a resend. Delivery, ambiguity, other terminal failure, consumption, invalidation and expiry purge recoverable capsule material transactionally or by bounded expiry sweeper. Active-store/backup/key retention is explicit; no guaranteed Node memory or shared-key crypto-zeroization claim is made.

### 7.2. HTTP surface

The public bootstrap and OIDC project-selection APIs accept no caller-supplied `workspaceId` or `projectId` as authority. Project callback paths carry a server-resolved project Connection ID:

```text
POST /api/v1/public/mattermost/awp-bootstrap
POST /api/v1/intake/mattermost/project-option-sets
POST /api/v1/intake/mattermost/project-selections
POST /api/v1/connectors/mattermost/connections/{connectionId}/dialog-submissions
POST /api/v1/connectors/mattermost/connections/{connectionId}/post-actions
```

Administration mirrors the immutable Feature 003 publication flow:

```text
POST /api/v1/integrations/mattermost/connections/{connectionId}/versions/{version}/discover
POST /api/v1/integrations/mattermost/profiles/{profileId}/versions/{version}/validate
POST /api/v1/integrations/mattermost/profiles/{profileId}/versions/{version}/preview
POST /api/v1/integrations/mattermost/profiles/{profileId}/versions/{version}/dry-run
```

Project-scoped product APIs:

```text
GET  /api/v1/workspaces/{w}/projects/{p}/intake-candidates
GET  /api/v1/workspaces/{w}/projects/{p}/intake-candidates/{candidateId}
POST /api/v1/workspaces/{w}/projects/{p}/intake-candidates/{candidateId}/decisions
POST /api/v1/workspaces/{w}/projects/{p}/intake-drafts/{draftId}/revisions
GET  /api/v1/workspaces/{w}/projects/{p}/intake-drafts/{draftId}/revisions
POST /api/v1/workspaces/{w}/projects/{p}/intake-drafts/{draftId}/commands/validate
POST /api/v1/workspaces/{w}/projects/{p}/intake-drafts/{draftId}/qa-confirmation
POST /api/v1/workspaces/{w}/projects/{p}/agent-runs
GET  /api/v1/workspaces/{w}/projects/{p}/agent-runs/{runId}
GET  /api/v1/workspaces/{w}/projects/{p}/triage-assessments/{assessmentId}
GET  /api/v1/workspaces/{w}/projects/{p}/session-plan-proposals/{proposalId}
GET  /api/v1/workspaces/{w}/projects/{p}/notification-intents/{intentId}
```

The canonical QA confirmation wire contract from Feature 002/003 remains unchanged. Its Draft-row CAS resolves and pins the exact current 1.1 revision/content/summary server-side; a Mattermost InteractionIntent already pins those values and invokes the same application use case, so no alternative chat submit endpoint or incompatible request/response shape is introduced. `POST agent-runs` accepts only `skillRef + closed subjectRef + requestKey`, never arbitrary tools or a provider Profile.

### 7.3. Event surface

Async events use the existing scoped envelope and compact event-specific payloads containing normalized safe refs, not full resource projections or raw provider payloads. Workspace, Project, entity identity/version and actor appear only in the canonical envelope, so payloads cannot disagree with its authority fields:

- `intake.candidate.source-observed`, `intake.candidate.discovered`, `intake.candidate.decision-recorded`, `intake.candidate.converted`;
- `intake.draft.revised`, `intake.draft.validation-completed`, `intake.draft.confirmed`;
- `agent.run.started`, `agent.run.completed`, `agent.run.failed`, `agent.run.fallback-used`, `agent.action.denied`;
- `qa.triage-assessment.created`, `qa.triage-assessment.stale`, `qa.session-plan-proposal.created`, `qa.session-plan-proposal.stale`;
- `messaging.notification.queued`, `messaging.notification.delivered`, `messaging.notification.failed`, `messaging.notification.expired`.

The authority-free bootstrap produces no durable security/domain event. Rejected project callbacks use the existing generic project-scoped security-audit facility, outside both `ActionProvenance` and the domain `EventEnvelope` list.

Candidate wake and expiry are effective time projections, not persisted lifecycle mutations. `expiresAt` has precedence: when `now >= expiresAt`, `PENDING_CONFIRMATION | SNOOZED → EXPIRED`; only otherwise may `SNOOZED → PENDING_CONFIRMATION` when `now >= snoozedUntil`. A SNOOZE command is rejected unless `snoozedUntil < expiresAt`. No synthetic Candidate event/provenance row is emitted merely because the clock advanced; the next human command re-evaluates the effective state under lock, while reminder creation has its own `NotificationIntent` provenance.

Versioning stays in the existing envelope's `payloadVersion` plus canonical `payloadSchemaRef { id, version, digest }` and in the channel contract version; event type strings do not grow an extra `.v1` suffix.

## 8. Persistence and migration strategy

| Order | Owner | Purpose |
|---|---|---|
| Core `0100` | Platform Core | Common action provenance, Candidate/source observations/decisions, Draft revisions/confirmation and legacy backfill |
| Core `0105` | Platform Core | Project-scoped callback receipt/inbox, InteractionIntents and bounded AEAD-sealed presentation capsules |
| Core `0110` | Platform Core | Agent Runs, immutable prompt-manifest provenance, grants, steps and tool invocations |
| Core `0120` | Platform Core | NotificationIntents and command-linked attempt audit |
| QA `2040` | QA Pack | TriageAssessment and SessionPlanProposal revisions |
| Mock `0050` | Mock Hub | Mattermost teams/channels/users/memberships/posts |
| Mock `0051` | Mock Hub | Fault scenarios and inbound fixtures |
| Mock `0052` | Mock Hub | Effect-call/reconciliation/callback audit |

All Core/product foreign keys include Workspace+Project scope; append-only histories reject update/delete; current pointers and child append commit atomically. The legacy Draft `status` and payload remain readable, while an additive conversation state and revision chain carry 004 semantics. Upgrade backfills one revision per legacy Draft without rewriting accepted Work Items or Feature 003 bindings. One shared repository makes `current_revision` canonical and shadow-writes its normalized content into legacy payload columns until all readers migrate; `DRAFT` covers every non-linked/non-cancelled conversation state, `SUBMITTED` maps only to `LINKED`, and `CANCELLED` maps only to `CANCELLED`. Orphan legacy `SUBMITTED` rows fail/quarantine migration.

Every Candidate observation/create, Candidate decision, Draft mutation/confirmation, Agent Run start, Agent tool invocation and NotificationIntent references a common immutable action-provenance envelope: exact scope/subject snapshot, initiator and authorization basis, request schema/hash/key, applicable rules/policy/skill and named configuration pins, requested effect, correlation/causation/audit refs and safe external result refs. Every such record is project-scoped; the static bootstrap creates none.

Migration tests cover fresh, upgrade, repeat, rollback/failure recovery and backfill against PostgreSQL 17 and 18. Mock Hub keeps a separate migration registry. No Mattermost-specific durable table is placed in QA Pack, and no second dispatcher state competes with `connector_commands`/`command_outbox`.

## 9. Security and failure-mode matrix

| Condition | Required outcome |
|---|---|
| Invalid/oversize static bootstrap request | Safe denial; no identity/scope interpretation, durable state, audit or effect. |
| Callback oversize/wrong content type/auth failure/stale transport | Reject before domain normalization; optional minimal redacted record in the generic project-scoped security-audit facility (not `ActionProvenance` or a domain event); zero product state/effect. |
| Same callback delivery/same hash | Return prior acknowledgement; no second event or mutation. |
| Same callback delivery/different hash | Quarantine/conflict and alert; zero mutation. |
| Missing/PENDING/CONFLICT/REVOKED identity binding | Generic deny without project enumeration. |
| Wrong user/team/channel or lost membership/entitlement/role/classification | Generic deny; wrong actor does not consume intent; expected actor invalidates stale intent. |
| Expired/stale Draft/Candidate/config intent | `EXPIRED`/`INVALIDATED`; require a fresh summary/action. |
| Concurrent callbacks | One CAS winner; exact replay returns the same result. |
| Crash before durable interactive `effectInvocationStartedAt` | Rehydrate all action tokens only from exact project-scoped capsules and reproduce the same provider bytes under the fenced command; no caller/command/log plaintext. |
| Crash/timeout after durable invocation marker | Use the pinned reconciliation mode: pending-ID/marker enters `LOOKUP_REQUIRED`, while `NONE_AMBIGUOUS` ends directly in `AMBIGUOUS`; V1 never POSTs again. Only a future versioned provider contract may introduce durable `NOT_APPLIED` proof. |
| Interactive presentation delivered/consumed/terminal/expired | Purge capsule material in the same UoW, or by fail-closed bounded expiry sweeper; later presentation requires a fresh action set and invalidates the old one. |
| Interactive presentation lookup is unsupported/zero/multiple | Terminal `AMBIGUOUS`, purge capsules and never blind resend. |
| Jira outage/ambiguous create | Draft and command remain durable; no Work Item invented; Feature 003 rules decide retry/ambiguity. |
| Mattermost outage | Jira/web/QA continue; NotificationIntent remains durable; delivery recovers or ends visibly. |
| Invalid/timeout/injection/forbidden model output | Typed deterministic fallback or policy denial; no unauthorized tool/Connector call. |
| Notification timeout after invocation marker | Profile-matched pending-ID/marker lookup may deliver one exact match; `NONE_AMBIGUOUS`, zero, multiple or unsupported becomes terminal `AMBIGUOUS`; never blind resend. |
| Profile/binding drift before first notification effect | Terminal failure; never silently redirect. |
| Production endpoint/credential/model/target | Reject at validation/composition/policy before network call. |

The generic authorization interceptor must receive the real resource/template classification; its existing hardcoded `INTERNAL` default is not reused for 004 decisions.

## 10. Runtime composition and local contour

Add composition variants without changing prior ones:

```text
foundation
qa-local
qa-jira-local
qa-jira-nonprod
qa-jira-mattermost-local
qa-jira-mattermost-nonprod
```

`qa-jira-mattermost-local` extends the verified Jira composition with Mattermost Profile/Connector, ingress worker, Agent Run worker, NotificationIntent worker, Mock Hub state and deterministic model provider. Worker wiring becomes a static list of named contributions instead of adding more special cases to the fixed loop.

Environment enums remain separate and are mapped explicitly:

| Runtime scope | Registry Connection class | Competency requirement scope | Feature 004 |
|---|---|---|---|
| `LOCAL` | `LOCAL` | `LOCAL` | Required Mock Hub contour |
| `NON_PROD` | declared `DEVELOPMENT` or `TEST` | `NON_PRODUCTION` | Metadata + operator opt-in |
| `PREPROD` | `TEST` | `NON_PRODUCTION` | Metadata + operator opt-in |
| `PLATFORM_PROD` | `PRODUCTION` | no allowed mapping | Rejected before egress |

`qa.validation@1.1.0` uses competency scope `LOCAL | NON_PRODUCTION`; this does not change the existing Core registry or runtime enum types.

Mock Hub implements exact narrow surfaces needed by the production Connector, including `/api/v4/posts`, membership reads, deterministic marker lookup and control routes that submit the public bootstrap form and emit project-scoped dialog/action deliveries. Persisted one-shot faults cover invalid bootstrap shape, callback auth/replay, wrong actor/scope, 401/403/429/5xx, crash before/after the durable invocation marker, zero/one/multiple/unsupported reconciliation, attempted resend from `LOOKUP_REQUIRED`, membership revocation, archived channels, schema drift and restart recovery.

## 11. Verification and evidence plan

### 11.1. Required gates

1. **Prerequisite:** exact Feature 003 evidence/digest check.
2. **Contract:** OpenAPI/AsyncAPI/JSON Schema parsing, offline refs, positive/negative examples, static-bootstrap purity/determinism, contribution order/digest parity and callback-ingress/manifest/Profile compatibility.
3. **Architecture:** Core/Pack/Connector import boundaries, no direct Mattermost/Jira/model client from Core/QA/UI, static composition only.
4. **Unit:** Candidate lifecycle/dedupe/observation, Draft CAS, receipt conflict, single-use intent/token-handling union, grant derivation/non-expansion, PromptManifest, fallback, triage fact-index semantics and staleness.
5. **PostgreSQL 17/18:** scoped FKs, concurrent callbacks/decisions, atomic Draft revision/confirmation, one-notification/N-intent/N-capsule/one-command UoW, same-UoW capsule purge, expiry sweep, invocation marker and migration/backfill matrix.
6. **Connector conformance:** auth dialects, logical DM/result binding, source-route versus action IDs, template/classification policy, byte-stable rebuild only before the invocation marker, rejection of unversioned `NOT_APPLIED`, lookup-only ambiguity, 401/403/429/5xx and schema drift.
7. **Security/eval:** forged actor/scope/capsule/key/AAD/command/slot/target/payload/render/fence context, duplicate nonce, project enumeration, revoked binding, replay, plaintext/ciphertext command/log/trace/body-capture scans, arbitrary URL/`response_url` SSRF, injection, secret leakage, attachment denial and tool escalation.
8. **E2E/browser/process:** independent US-001…US-004 journeys with API, worker, PostgreSQL, Redis and restarted Mock Hub.
9. **Trace/evidence:** every FR/SC mapped to executable evidence; final report bound to exact task list, git/source tree and contract digests.
10. **Optional live:** explicit Mattermost/model metadata and operator opt-in, otherwise `SKIPPED_GATED`.

### 11.2. Acceptance journeys

- **US-001:** static slash response → canonical OIDC → only fully authorized project intents → revisioned Draft → immutable summary → repeated exact confirmation → one Jira issue/Work Item → one safe notification.
- **US-002:** authoritative Jira trigger → one Candidate/updated observations → HUMAN `CREATE|SNOOZE|IGNORE`; no issue/SLA/WIP before confirmation.
- **US-003:** typed TriageAssessment with provenance/confidence → source drift marks stale → invalid/unavailable model yields deterministic result and no forbidden call.
- **US-004:** Mattermost unavailable across Jira/QA commit → state continues → durable intent later delivers once or exposes a typed terminal/ambiguous health result.

The final gate is task-bound and runs only after all implementation tasks and independent journey checkpoints pass. A manual bot demo or stale report cannot satisfy it.

## 12. Implementation milestones for task generation

1. Prerequisite, contract-version and evidence foundation.
2. Candidate/source-observation and additive Draft revision Core model.
3. Stateless bootstrap, OIDC project selection, project-scoped callback receipt and InteractionIntent security.
4. Messaging schemas, Mattermost Connector/Profile validation and Mock Hub.
5. Guided intake plus shared web/Mattermost confirmation into Feature 003.
6. Jira Candidate trigger and decision flows.
7. Agent Runtime, Skill Registry, PromptManifest and Tool Gateway.
8. QA skills, TriageAssessment, SessionPlanProposal and deterministic/model-degraded gates.
9. NotificationIntent, outbound reconciliation, recovery and health.
10. Web fallback, security/conformance, migration matrix, US-001…US-004, trace and final evidence.

This ordering is dependency guidance for `/speckit.tasks`; it is not an implementation task list.

## 13. Constitution Check — after Phase 1 design

| Post-design gate | Status | Design evidence |
|---|---|---|
| Agent Run subject governance | PASS | Accepted ADR-0008 partially supersedes the Work Item-only subject clause of ADR-0005 Decision 1, and Constitution 2.0.0 makes the exact closed union normative. |
| Authority and acceptance | PASS | One exact Draft revision enters only the existing Jira authority path; Candidate/Agent/proposal state cannot materialize Work Item. |
| Scope and identity | PASS | Full authorization before project presentation, project-scoped intents/state, exact external binding and effect-time rechecks. |
| Core/Pack/Connector ownership | PASS | Ownership table, source tree and versioned contracts keep provider, generic and QA semantics separate. |
| Determinism and Hermes safety | PASS | Typed PromptManifest/output, immutable intersected grants, Tool Gateway and mandatory deterministic fallback. |
| Exact actions/approvals | PASS | InteractionIntent is single-use but explicitly not ApprovalDecision; high-risk actions stay on the existing exact web Approval path. |
| Reliability and audit | PASS | Stateless bootstrap, separate project-callback receipt/action/idempotency layers, durable outboxes, reconciliation and no blind retry. |
| Local-first/versioning | PASS | Stateful Mock Hub, additive migrations/contracts, legacy Draft compatibility and optional live gates. |
| Production boundary | PASS | Allowed enum `LOCAL | DEVELOPMENT | TEST`; `PRODUCTION` denied at every control layer. |

**Post-design constitution exceptions:** none.
**Unresolved technical clarifications:** none. Corporate deployment facts are explicit gated inputs, not design unknowns.
**Unresolved authority:** none.

## 14. Complexity tracking and principal risks

There is no requested exception. The subject-union change is governed by Accepted ADR-0008 and
Constitution 2.0.0, with ADR-0005 Decision 1 superseded only for its Work Item-only subject clause.
The one new Connector package is the existing required provider boundary, not a new service.

Primary implementation risks to preserve in task/checklist generation:

- silently reinterpreting legacy mutable Draft rows instead of additive revision/backfill;
- routing a Jira Candidate trigger through Feature 003 direct import;
- using post-acceptance readiness before a Jira request exists;
- accidentally replacing immutable `competency-qa@1.0.0`/`qa.validation@1.0.0` instead of registering the chosen 1.1 successors alongside them;
- treating inbound transport as a fake Broker write or weakening the generic JSON webhook policy;
- allowing the public bootstrap to trust/provider-reflect identity or scope fields, create durable state, or acquire a Workspace credential;
- retaining the current narrow CommandIntent source union and overloading WorkItem/Draft for notifications;
- using entitlement-only project listing or hardcoded `INTERNAL` classification;
- duplicating raw-SQL Draft/confirmation logic between web and Mattermost;
- persisting raw prompt/completion/history or adding free-form cross-project memory;
- assuming native Mattermost callback exactly-once/signature semantics not proven by the selected server contour.
