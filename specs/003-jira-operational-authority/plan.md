# Implementation Plan: Jira operational authority

**Feature:** `003-jira-operational-authority`  
**Branch:** `003-jira-operational-authority`  
**Specification:** [spec.md](spec.md)  
**Originally planned:** 2026-08-28
**Implementation status:** Locally verified on 2026-08-31; the task-bound aggregate gate passes for `qa-jira-local`. Optional live non-prod remains `SKIPPED_GATED` until the immutable Jira pilot metadata C1 package and operator opt-in are supplied. Production writes remain excluded.

## 1. Planning outcome

Feature 003 replaces the mock operational-authority implementation planned in feature 002 with an independent, statically composed Jira Connector. Jira becomes the real source of truth for accepted QA Request status, assignee, priority, due date, workflow, links and comments. Core retains only a monotonic projection with explicit freshness, conflicts, import provenance, exact Profile/Binding pins and audit.

The implementation adds:

- pure `@awp/connector-jira`, with explicit Cloud v3 and versioned Data Center v2 dialect families, plus separate `@awp/connector-jira-persistence-typeorm` storage contribution;
- versioned Jira Connection/Mapping/Central Request/Source Context/Defect Profile contracts;
- additive `operational-work-item@1.1.0` typed assign/priority/due operations while preserving 1.0;
- provider-neutral operational observation/import/projection/conflict/reconciliation primitives in Core;
- verified external-principal bindings and a safe direct-Jira acceptance path;
- exact raw-byte webhook ingress, durable dedupe and authoritative re-read;
- JQL reconciliation with watermark/overlap, per-Connection rate budgets and drift isolation;
- protocol-faithful Jira surfaces in Mock Hub and optional real non-prod contract tests;
- UI that separates confirmed Jira facts, freshness, pending intent and conflicts.

The plan does not promise native Jira exactly-once transport or atomic version-CAS. Jira create lacks a documented native idempotency key, and issue update/transition lacks documented version preconditions. The design therefore serializes platform commands, uses a searchable effect marker, stops on ambiguous create, performs expected-token pre-read and immediate post-read, and makes the residual Jira REST TOCTOU limitation an explicit pilot gate.

## 2. Inputs, dependencies and gates

### 2.1. Normative inputs

Priority order on conflict:

1. [Constitution 1.1.1](../../.specify/memory/constitution.md)
2. [Feature specification](spec.md)
3. [ADR-0002: Jira operational authority](../../docs/adr/0002-jira-operational-authority.md)
4. [ADR-0006: Project Integration Binding](../../docs/adr/0006-project-integration-binding-versioning.md)
5. [ADR-0007: action-specific exact Approval](../../docs/adr/0007-action-specific-exact-approval.md)
6. [Feature 001 design package](../001-extension-kernel-local-skeleton/plan.md)
7. [Feature 002 design package](../002-qa-manual-walking-skeleton/plan.md)
8. [External systems integration request](../../docs/external-systems-integration-request-v2.md)
9. [research.md](research.md) and this plan

### 2.2. Satisfied implementation prerequisite

The prerequisite remains fail-closed, and the current task-bound Feature 003 gate proves that it is satisfied. `tools/verification/feature-003-prerequisites.mts` verifies the final machine-readable reports and live exports for 001/002, including:

- Core/Pack/Connector architecture gates;
- generic operational binding and confirmed-effect UoW;
- durable command/outbox/inbox/approval/recovery contracts;
- `competency-qa@1.0.0` and `operational-work-item@1.0.0`;
- command logical-role/configuration-pin round-trip, ordered primary/auxiliary chain support and runnable API/worker composition from the final 001/002 foundation;
- QA request creation, readiness transitions and defect confirmation hooks;
- runnable API, worker, PostgreSQL, Redis delivery and Mock Hub composition;
- clean `smoke:001`, `smoke:002` and regression reports.

Feature 003 must not implement substitute QA entities, confirmation logic or mock operational capability to bypass this gate.

This prerequisite result authorizes the verified local composition only. Live corporate non-prod publication/execution still requires C1 metadata, credentials and attestations; absent inputs remain visible as `SKIPPED_GATED`. Production writes remain excluded.

### 2.3. Jira C1 metadata gate

Local development and protocol conformance use deterministic fixture metadata. A non-local Jira Connection/Profile cannot validate or publish until a schema-bound `JiraPilotMetadataPackage@1` supplies:

- edition, exact build/version, adapter family/version and API flavor;
- base URL/cloudId/context path and TLS/network owner;
- approved service auth kind, opaque secret ref, credential owner/rotation/revoke path;
- central/source/defect project and issue-type IDs;
- field, status, priority, transition, identity and link IDs/directions;
- strict import/update JQL and project-discriminator field;
- searchable effect-marker field and ambiguity policy;
- webhook kind, HMAC/delivery-ID capability, retry horizon and rotation policy;
- page/concurrency/overlap/freshness/full-sweep budgets;
- least-privilege evidence and service owner;
- concurrency safety mode `JIRA_SIDE_CAS | COMPARE_AND_VERIFY` and the required review evidence.

No secret value or unrestricted sample payload is part of this package.

### 2.4. Planning outputs

- [research.md](research.md) — resolved decisions and official Jira constraints;
- [data-model.md](data-model.md) — Core/Connector persistence, constraints and state machines;
- [contracts/](contracts/) — HTTP/event/profile/capability/projection contracts;
- [quickstart.md](quickstart.md) — runnable local and gated non-prod validation;
- [tasks.md](tasks.md) — dependency-ordered implementation tasks.

## 3. Technical Context

| Area | Decision for 003 |
|---|---|
| Language/runtime | Inherit TypeScript `6.0.3`, strict ESM/ES2024, Node.js `24.x` |
| Workspace/tooling | pnpm `11.21.0`, Nx `23.1.2`, frozen lockfile |
| Backend/runtime | NestJS `11.2.x` adapters; Core/QA/Jira domain code framework-independent |
| Web | React `19.2.8`, Vite `8.2.2`, MUI `9.3.x` only through `platform-ui` |
| Jira transport | Node native `fetch`/WebCrypto behind injected typed transport/auth/secret ports; no direct SDK in Core/QA/UI |
| Durable storage | PostgreSQL 17/18, TypeORM `1.1.0`, `synchronize:false`, Core `0090…0095`, Jira persistence contribution `3000…3020`, Mock Hub separate migrations |
| Async delivery | PostgreSQL command/event/inbox state + BullMQ 6/Redis as reconstructible delivery/scheduling only |
| Contracts | OpenAPI 3.1, AsyncAPI, JSON Schema 2020-12, TypeBox/Ajv, RFC 8785 canonical SHA-256, offline refs |
| Identity/security | OIDC canonical principals plus verified Connection-scoped Jira principal bindings; service credential by secret ref |
| Tests | Vitest 4, real PostgreSQL Testcontainers, provider-neutral/Jira conformance, protocol Mock Hub, Playwright Chromium |
| Observability | OTel structured traces/metrics/logs with connection/profile/project/work item/correlation refs and strict redaction |
| Deployment | Local protocol mock and real non-prod only; no production Connection/credential/egress |
| Performance | Webhook endpoint persists and ACKs without Jira call; projection must meet Profile-configured freshness target; command lane outranks sweep |
| Scale/scope | Pilot: one QA Workspace, one reference Platform Project, one central QA project, one source project/profile and one defect project/profile; design remains multi-project safe |

No major toolchain upgrade is introduced. New dependency requests must follow the existing catalog/release-age/lockfile policy. The preferred Jira implementation adds no runtime package beyond existing platform libraries.

## 4. Constitution Check — before design

| Principle | Status | Enforcement |
|---|---|---|
| I. QA-first release | PASS | Reuses the single `qa.validation` Work Type and feature-002 QA entities; adds no second tracker/domain flow. |
| II. Jira authority | PASS | Jira owns operational fields; local writes are durable typed commands and projection changes only after authoritative read. |
| III. Workspace/Project boundary | PASS | Import, observation, command, projection, conflict, cursor and identity access are scoped; project-discriminator routing is mandatory. |
| IV. Core/Pack/Connector | PASS | Jira API/JQL/mapping/dialects live in `connector-jira`; Core receives only provider-neutral ports/events. |
| V. Deterministic core | PASS | Mapping, routing, ordering, approvals, idempotency, retry, projection and reconciliation use no model. |
| VI. Exact approvals | PASS | Transition/assign/priority/due/defect use exact one-time external-command approval and effect-time recheck. |
| VII. Human verdict | PASS | No verdict/release semantics change; defect still originates from a human-classified/approved feature-002 draft. |
| VIII. Evidence/snapshot | PASS | Defect payload and audit pin exact Session/build/evidence and immutable integration refs without copying raw evidence. |
| IX. Reliability/audit | PASS | Durable command/inbox/outbox, searchable marker, stop-on-ambiguity, monotonic projection and full audit chain. |
| X. Local-first | PASS | Same Jira connector runs against protocol Mock Hub; live corporate Jira is an opt-in gated suite. |
| XI. Versioning | PASS | 1.0 remains valid; additive 1.1 operations, immutable Profile/discovery/mapping revisions and expand/contract migrations. |
| XII. Production boundary | PASS | Only LOCAL/NON_PROD compositions and credentials; production denied at config, policy, network and tests. |

**Constitution exceptions:** none.

The absence of Jira atomic update CAS is not hidden. `COMPARE_AND_VERIFY` meets the defined expected-token/pre-read/no-known-stale-write contract but leaves a residual transport race. If pilot acceptance requires strict atomic no-overwrite, only `JIRA_SIDE_CAS` passes the live gate.

## 5. Architecture

### 5.1. Confirmed intake → central QA Request

```text
Requester confirms exact feature-002 Intake Draft version
  → QA Pack builds provider-neutral request.create@1.0/1.1 intent
  → Core policy/idempotency/Broker pins ordered chains:
       PRIMARY QA_REQUEST_AUTHORITY
       AUXILIARY SOURCE_CONTEXT when a source Jira link is required
  → PostgreSQL command + outbox + audit
  → worker resolves exact runtime Connection/Profile/Mapping
  → connector-jira pre-searches exact effect marker
      ├─ one matching issue → read and reconcile same effect
      ├─ ambiguous search → AMBIGUOUS, no create retry
      └─ no match/proven-safe → Jira create + required source link
  → authoritative issue read/read-after-write
  → generic confirmation UoW atomically:
       command CONFIRMED + Draft LINKED + Work Item
       + OperationalAuthorityBinding + projection revision
       + feature-002 QA extension/input hook + audit/event outbox
```

Jira outage or ambiguous response preserves Draft/command. No Work Item, binding or invented Jira status exists until the confirmation transaction.

### 5.2. Direct Jira issue → accepted import

```text
Jira create webhook or import reconciliation JQL
  → exact raw receipt, transport verification, durable invalidation job
  → connector-jira GETs issue and proves published JQL/type/project scope
  → project discriminator resolves one active Project Binding
  → creator resolves one VERIFIED HUMAN external-principal binding
  → Core rechecks membership, entitlement, role and classification
      ├─ valid VERIFIED_HUMAN_ISSUE_CREATE evidence
      │    → OperationalImportIntent ADOPTED transaction
      │       Work Item + binding/projection + QA extension/input
      │       → feature-002 completeness assessment (possibly NEEDS_INFO)
      └─ invalid/ambiguous
           → quarantined diagnostic/AWAITING_CONFIRMATION, zero Work Items
```

`NEEDS_INFO` here is QA-owned completeness/readiness. It does not rewrite the Jira status or invent a normalized operational state.

### 5.3. Human Jira change → projection

```text
webhook (unordered signal) OR scheduled reconciliation
  → durable dedupe receipt / cursor lease
  → authoritative Jira GET under pinned Connection/Profile
  → normalize + compute revision token/authority-fields hash
  → one PostgreSQL projection UoW:
       consumer marker
       ├─ duplicate/equal → metric only
       ├─ older → stale ignored event/metric
       ├─ gap/incomparable → enqueue reconciliation
       └─ newer → append projection revision + move binding pointer
                    + update Work Item derived normalized status
                    + audit + event outbox
```

Webhook body is never directly promoted to canonical operational state.

### 5.4. Exact Jira command and conflict

```text
HUMAN prepares typed transition/assign/priority/due intent
  → exact EXTERNAL_COMMAND Approval subject
  → worker effect-time auth/profile/expiry/expected-token recheck
  → per-issue platform mutex + authoritative Jira pre-read
      ├─ expected token/value mismatch
      │    → command CONFLICT + approval INVALIDATED
      │       + newest projection + visible SyncConflict
      └─ match
           → minimum Jira patch/transition + effect marker
           → immediate Jira post-read
              ├─ expected result → command confirmation/projection UoW
              └─ mismatch/uncertain → CONFLICT or AMBIGUOUS; no blind retry
```

Requested values are displayed as pending intent only. Current Jira projection is unchanged until read confirmation.

### 5.5. Approved defect

```text
feature-002 PRODUCT Finding → immutable DefectDraft → human approval
  → defect.create under exact DEFECT_DESTINATION chain
  → exact marker lookup / bounded duplicate-candidate search
  → create issue with allowlisted mapped fields
  → ensure exact QA Request link and safe session/build/evidence refs
  → authoritative read
  → generic confirmation UoW + QA hook writes one DefectLink
```

Natural-key replay confirms only the same effect. Heuristic similar-defect results are presented to a human and never auto-linked as the created defect.

### 5.6. Bounded ownership

| Module | Owns | Must not own |
|---|---|---|
| Platform Core | Operational binding/projection/import/conflict, external principal refs, command/approval/audit/inbox/outbox, generic reconciliation orchestration | Jira REST/JQL/fields, QA readiness/session/finding/verdict |
| `competency-qa` (002) | QA request semantics, completeness/readiness, typed action intent, defect draft and confirmation hooks | Jira Profile IDs/REST/auth/raw response |
| Connector SDK/contracts | Typed operations, observation/discovery/runtime ports, normalized result/error contracts | Jira policy or QA rules |
| `connector-jira` | Pure dialects, auth headers, REST/JQL, mapping, discovery, effect marker, provider read-back, webhook normalization, rate decoding | TypeORM, Work Item/QA tables, approvals, generic authorization decisions |
| `connector-jira-persistence-typeorm` | Jira-owned discovery/validation, normalized webhook/rate, effect/sub-effect/ambiguity rows and migrations | Jira REST calls, Core/QA tables, raw secrets/payloads |
| Core persistence adapter | Provider-neutral rows, scopes, transactions, CAS/append-only constraints | Vendor mapping decisions or Jira-owned tables |
| Runtime composition | Static factories, exact port adapters, Profile validators and worker registrations | Runtime downloads or domain special cases inside Core |
| Mock Hub Jira | External Jira-wire state, changelog/effect/link/comment ledger, delivery/failure scenarios | Platform/QA database or authorization truth |
| Web/UI | Confirmed projection, pending intent, conflict/freshness/admin validation views | Direct Jira call or authorization truth |

### 5.7. Target source structure

```text
packages/connector-jira/
├── src/index.ts
├── src/manifest.ts
├── src/contracts/
├── src/http/jira-rest-client.ts
├── src/dialects/
│   ├── jira-cloud-v3.ts
│   ├── jira-dc-9-v2.ts
│   ├── jira-dc-10-v2.ts
│   └── jira-dc-11-v2.ts
├── src/auth/
├── src/discovery/
├── src/mapping/
├── src/operational/
├── src/import/
├── src/webhooks/
└── src/reconciliation/

packages/connector-jira-persistence-typeorm/
├── src/index.ts
├── src/entities.ts
├── src/migrations/
│   ├── 3000-jira-discovery-profiles.ts
│   ├── 3010-jira-webhook-rate.ts
│   └── 3020-jira-effect-reconciliation.ts
├── src/jira-configuration.repository.ts
├── src/jira-effect.repository.ts
└── src/jira-rate.repository.ts

packages/platform-core/src/
├── commanding/target-execution-lane.ts
├── identity-access/external-principal-binding.ts
├── integration-registry/connector-validation-port.ts
├── events/external-entity-observation.ts
└── work-management/
    ├── operational-authority.ts
    ├── operational-import.ts
    └── operational-projection.ts

packages/platform-persistence-typeorm/src/
├── entities/operational-authority.entities.ts
├── migrations/core/0090-operational-authority.ts
├── migrations/core/0095-external-identity-import-reconciliation.ts
├── operational-authority.repository.ts
├── operational-import.repository.ts
└── reconciliation-cursor.repository.ts

packages/platform-runtime-nest/src/http/
├── connector-webhooks.controller.ts
├── integration-discovery.controller.ts
└── operational-authority.controller.ts

packages/runtime-composition/src/jira/
├── composition.ts
├── profile-validation.ts
├── webhook-handlers.ts
└── reconciliation-jobs.ts

apps/api/src/
├── main.ts                 # exact raw-body bootstrap before JSON parsing
└── app.module.ts           # selected Jira HTTP/runtime registrations

apps/worker/src/app.module.ts  # Jira command/webhook/reconciliation workers

apps/mock-hub/src/jira/
├── jira.controller.ts
├── jira.repository.ts
├── jira-scenarios.ts
└── jira-webhook-emitter.ts

packages/platform-ui/src/operational-authority/
├── operational-authority-panel.tsx
└── operational-conflict-panel.tsx

packages/competency-qa/src/ui/contribution.tsx

tests/{architecture,contract,integration,e2e}/...
tools/{verification,smoke,ci}/...
```

### 5.8. Dependency directions

```text
competency-qa ──► competency-sdk / platform-contracts
connector-jira ──► connector-sdk / platform-contracts
connector-jira-persistence-typeorm ──► connector-jira / platform-contracts / TypeORM
platform-runtime-nest ──► platform-core
platform-persistence-typeorm ──► platform-core
runtime-composition ──► selected Core/Pack/Connector adapters
apps ──► runtime-composition

forbidden:
platform-core ─X─► connector-jira / competency-qa
competency-qa ─X─► connector-jira / Jira REST / vendor fields
connector-jira ─X─► competency-qa / QA tables / Nest / React
connector-jira ─X─► TypeORM / connector-jira-persistence-typeorm
connector-jira-persistence-typeorm ─X─► platform-core / competency-qa / Nest / React
web ─X─► connector-jira / Jira REST
```

The existing Connector SDK dependency on a Core effect-context type should be narrowed into platform-contracts rather than expanded.

## 6. Design decisions

### 6.1. Connection, Mapping and Profiles

Connection content is immutable and contains adapter family/version, edition/build, endpoint/cloud/context metadata, auth kind, opaque secret ref, tenant identity, environment and quarantine policy. A `BOOTSTRAP` version intentionally has no capability snapshot and is sufficient only for discovery; discovery produces the immutable snapshot, and a new `VALIDATED` Connection version must pin it before any Profile validation/publication. Mutable health/credential expiry/rate state is separate.

Mapping is an immutable bounded AST plus lookup tables and target field IDs. It consumes only closed provider-neutral inputs and produces only fields allowlisted by the selected Profile.

Central QA Request Profile contains:

- exact target project and issue type IDs;
- create/import/update JQL templates from closed server-owned fragments;
- required project discriminator and searchable effect-marker field;
- create/import field mapping and structural minimum;
- raw status→normalized status mapping;
- priority and verified identity mapping;
- allowed transition graph and assign/priority/due operations;
- source link/comment/remote-link rules;
- webhook and reconciliation/freshness/rate policy;
- direct import confirmation mode and actor requirements.

Source Context Profile is read-only and pins project/issue-type/JQL scope plus allowed Jira/remote link types/directions. Defect Profile separately pins target project/issue type, required/allowed fields, effect marker, duplicate-search policy, exact QA Request link type/direction and required exact approval policy.

Only IDs are authoritative; names are diagnostic snapshots. Published content is immutable and references its successful discovery/validation report.

#### 6.1.1. Ordered command configuration chain set

An operation declares its required logical roles before command persistence. Core resolves all roles from the same exact Project Integration Binding version and persists an immutable ordered set:

- one `PRIMARY` chain (`QA_REQUEST_AUTHORITY` or `DEFECT_DESTINATION`);
- zero or more explicitly declared `AUXILIARY` chains such as `SOURCE_CONTEXT` or the already-bound central request authority needed for an exact link;
- exact Binding/Profile/Mapping/Connection refs, content hashes, adapter family/version, authority namespace and purpose for every entry.

The whole set is hashed into command/audit and, for approved effects, Approval. Effect-time authorization and Profile health are rechecked for every entry. Client/Pack payloads cannot choose a Jira project, Profile, Connection or provider subject. The Connector receives only resolved trusted configuration and never calls the Core registry. Cross-Connection Jira links require a published remote-link strategy; an undeclared or incompatible authority namespace rejects publication before any effect.

Assignment uses an injected provider-neutral external-principal resolution port. Runtime resolves a live canonical binding into a trusted opaque provider subject after authorization; a Jira account/user ID is never accepted from HTTP or Pack input.

### 6.2. Additive typed operations

`operational-work-item@1.1.0` preserves the three 1.0 operation names, target schema and every valid 1.0 payload/result meaning, and adds:

| Operation | Typed payload | Required expected state | Approval |
|---|---|---|---|
| `request.assign` | verified canonical assignee ref or explicit unassign | revision token + current assignee | exact |
| `request.set-priority` | normalized priority key | revision token + current priority | exact |
| `request.set-due-date` | ISO date or explicit clear | revision token + current due | exact |

The pinned 1.0 transition schema remains byte-for-byte unchanged and permits only its original `READY | DONE` targets. A 1.1 Profile may pin an additive 1.1 transition-input schema whose normalized target is selected from the expanded Profile allowlist; every valid 1.0 payload remains valid with identical meaning. Runtime validates the request against the exact pinned input schema. Clients never send Jira transition ID. Connector fetches available transitions for the current issue, verifies source status and chooses the exact pinned mapping.

Public HTTP action bodies carry only the requested provider-neutral value. `If-Match` identifies the current server projection; Core resolves and byte-compares that ETag, then derives the external revision token and authority-field hash server-side for command/Approval. Client-controlled preconditions cannot replace or contradict the confirmed projection.

All result variants return a complete normalized authority snapshot or a sanitized conflict/error receipt. Read-back remains infrastructure confirmation, not a public capability operation.

### 6.3. External revision and Jira REST limitation

The revision token is computed from provider `updated`, latest changelog identity when available and the canonical hash of status, assignee, priority, due date and other Profile-declared authority fields. Token comparison and value comparison happen after a fresh read under a platform issue mutex. A minimum patch touches only the approved field/effect. A post-read is mandatory.

This catches any change that already exists before invocation and prevents blind writes from stale projections. It cannot atomically exclude a human write inside the Jira REST pre-read/write interval. The live gate records the selected mitigation; no code or UI may label `COMPARE_AND_VERIFY` as native optimistic locking.

### 6.4. Import routing and acceptance

One central Jira project can serve multiple Platform Projects only through a mandatory immutable discriminator field mapped to an internal Project key/ref. Validation proves every published central import scope is pairwise non-overlapping. The issue creator must resolve through a verified external-principal binding and pass live access policy.

Import receives no synthetic Draft. Core introduces `acceptanceSource = PLATFORM_DRAFT | OPERATIONAL_IMPORT`; the atomic import UoW creates Work Item/binding/projection and invokes a generic Pack import hook that creates the same QA extension and immutable initial input shape used by confirmed intake. The original requester/title/request kind/classification/external request/profile/binding tuple becomes frozen structural identity.

### 6.5. Webhook and observation contract

The HTTP route is Connection-scoped and configured for exact raw body. Transport verification happens before JSON normalization. Receipt identity is connection plus provider delivery ID or deterministic fallback hash; same ID with another body hash is a security conflict.

Normalized observation contains only scope candidates, entity/change identity, provider timestamps and a re-read instruction. Resolution validates Connection, published Profile, Project discriminator or existing binding, external entity and classification before creating a project-scoped event. A worker always reads Jira and generates a complete normalized observation before projection apply.

### 6.6. Reconciliation

Each published Profile has three schedulable lanes:

1. `IMPORT_DISCOVERY` — strict JQL for newly created central issues;
2. `BOUND_REFRESH` — direct/batched read of every active binding even if it left import JQL;
3. `FULL_DRIFT_SWEEP` — bounded periodic metadata/entity drift recovery.

The durable cursor is `(updated,key)` plus overlap. Leases, attempt state, counts and rate snapshots are in PostgreSQL. Redis jobs contain only run/profile/scope IDs. Watermark moves only on complete page traversal; partial runs retain safe prior progress. 401/403 pause the Connection, 429 observes Retry-After, and schema drift marks only the Profile.

### 6.7. Command, link and comment idempotency

The platform command/effect key is unique and stable. Create/defect first looks up a Profile-required searchable marker. Started/unknown response never triggers an unqualified second create. Jira-to-Jira link retry first reads exact link tuple; remote link uses deterministic globalId; comment retry reads a stable marker. A logical multi-step receipt lists each sub-effect and its confirmed external identity/hash.

`AMBIGUOUS` is a visible non-retryable integration state until an authorized operator resolves it by attaching the exact existing issue or proving absence. Resolution is audited and cannot reuse the command with another target.

### 6.8. Approval and conflict lifecycle

Exact Approval pins command identity, full typed payload, expected revision/value, exact Binding/Profile/Mapping/Connection refs, target, effect key, expiry and both initiator/approver authorization bases. Effect-time policy reload precedes Jira reads. Any drift invalidates authorization with zero Connector call.

Pre-read mismatch makes command `CONFLICT`, writes an append-only `OperationalSyncConflict`, applies the newer read as projection and requires a new human intent/approval. Conflict record can be acknowledged/resolved without erasing the original mismatch.

### 6.9. Least privilege and data boundary

The runtime service principal may receive only Profile-needed Browse, metadata read, Create/Edit/Assign/Transition/Link/Add Comment permissions in allowlisted non-prod Jira projects. Administer/Delete/workflow/field/user management are denied. Webhook registration is a separate bootstrap/admin responsibility; runtime does not need global Jira admin.

Profile/JQL remains defense in depth. Backend Project Entitlement and classification checks occur before external issue text is returned, mapped, logged or emitted. Discovery snapshots and receipts are sanitized; raw tokens and raw vendor responses are never persisted.

### 6.10. UI contract

Work Item detail shows:

- Jira display key and safe web link;
- raw Jira status and normalized status side by side;
- confirmed requester/assignee/priority/due date;
- source of current projection, Jira updated time, observed time and freshness;
- pending command/approval separately from confirmed values;
- conflict/mapping/auth/error state with safe resolution guidance;
- exact Profile/Binding versions in diagnostics available only to authorized roles.

Admin surfaces provide discovery, validation, preview, dry-run and immutable publication diagnostics. UI never accepts raw JQL fragments, Jira field IDs outside validated selectors or roles/actor identity from the request body.

## 7. Contract and versioning strategy

The design contract package contains:

```text
contracts/
├── README.md
├── capabilities.md
├── openapi/jira-operational-authority-api.v1.yaml
├── asyncapi/jira-operational-events.v1.yaml
├── schemas/jira/
│   ├── connection-config.v1.schema.json
│   ├── mapping.v1.schema.json
│   ├── qa-request-profile.v1.schema.json
│   ├── source-context-profile.v1.schema.json
│   ├── defect-profile.v1.schema.json
│   ├── pilot-metadata-package.v1.schema.json
│   ├── secret-lease.v1.schema.json
│   ├── discovery-snapshot.v1.schema.json
│   └── normalized-webhook-event.v1.schema.json
├── schemas/operational-work-item/
│   ├── action-input.v1.1.schema.json
│   ├── action-result.v1.1.schema.json
│   └── operational-error.v1.1.schema.json
└── schemas/operational-authority/
    ├── projection.v1.schema.json
    ├── import-intent.v1.schema.json
    ├── conflict.v1.schema.json
    └── reconciliation-report.v1.schema.json
```

The 003 contract directory owns additive 1.1 input/result schemas; no applied 002 contract file is edited. A generalized multi-feature offline registry compiles both generations and verifies every positive/negative example. Compatibility rules:

- old `1.0.0` profiles/commands/history remain readable and executable only for their pinned operations;
- added optional operation and result fields are minor-compatible;
- changing meaning/type/requiredness of a 1.0 operation requires a new major;
- exact adapter family/version and discovery capability hash are Profile content;
- Connection/Mapping/Profile/Binding revisions are immutable integers with canonical hashes;
- pending approval/command never migrates to a new Profile;
- historical projection records preserve the refs used for that observation.

## 8. Persistence and transactions

### 8.1. Migration ownership

| Range | Owner | Contents |
|---|---|---|
| Core `0090` | Platform Core | operational binding expansion, projection revisions/current pointers, sync conflicts |
| Core `0095` | Platform Core | external principal bindings, import intents, generic reconciliation cursors/runs |
| Jira `3000` | Connector Jira TypeORM adapter | sanitized discovery/capability snapshots and validation details |
| Jira `3010` | Connector Jira TypeORM adapter | normalized webhook/provider delivery metadata and rate snapshots |
| Jira `3020` | Connector Jira TypeORM adapter | Jira target lanes, effect/sub-effect reconciliation markers and ambiguity resolution metadata |
| Mock Hub `0040` | Mock Hub DB | external Jira issues/changelog/properties/links/comments/webhook/effect/scenario state |

Feature 003 does not alter feature-002 `qa_*` tables except through public QA migrations introduced by 002. Generic hooks use one transaction but keep table ownership intact.

### 8.2. Atomic boundaries

Required PostgreSQL transactions:

1. command intent + idempotency + approval/outbox + initial audit;
2. effect-time gate + authorization consumption + execution claim;
3. confirmed create + Draft/Work Item/binding/projection + QA confirmation hook + event/audit;
4. accepted import intent + Work Item/binding/projection + QA import hook + event/audit;
5. observation consumer marker + monotonic projection + current pointer/derived Work Item + audit/event;
6. conflict command terminal state + approval invalidation + latest projection + conflict record;
7. defect confirmation + QA DefectLink hook;
8. reconciliation run/page item results + safe cursor progress.

External Jira calls are outside PostgreSQL transactions. Recovery repeats the same durable identity and uses read/marker reconciliation.

### 8.3. Constraints

- exactly one active operational binding per Work Item;
- external issue uniqueness is Connection authority namespace + external entity type + immutable issue ID, independent of Profile version;
- current projection pointer references the same binding/scope and an append-only revision;
- import intent uniqueness prevents create/webhook/reconcile races from producing two Work Items;
- verified external principal uniqueness prevents one Jira subject mapping to multiple active canonical principals in a tenant;
- cursor/run leases are scoped and compare-and-swap protected;
- direct update/delete of projection history, accepted import evidence and conflict facts is denied;
- every project-scoped row contains Workspace and Project and uses composite scope constraints;
- no raw credential or raw unrestricted provider payload column exists.

## 9. Local and non-prod composition

Composition variants:

```text
foundation       # unchanged feature 001 composition
qa-local         # unchanged feature 002 generic Mock authority
qa-jira-local    # QA Pack + connector-jira → protocol Mock Hub Jira
qa-jira-nonprod  # QA Pack + connector-jira → validated corporate non-prod Jira
```

`qa-jira-local` is the default 003 verification target and uses fake OIDC, local secret refs, PostgreSQL/Redis/Mock Hub, deterministic Cloud/DC fixture profiles and no external network. `qa-jira-nonprod` is disabled unless the C1 metadata package, secret provider, TLS/network allowlist, least-privilege evidence and concurrency evidence validate. No 003 variant accepts production endpoints or credentials.

## 10. Verification strategy

Tests are mandatory because the specification and constitution require idempotency, conflict, isolation, approval and recovery evidence.

### 10.1. Contract/architecture

- compile all 001/002/003 schemas and local refs offline;
- prove 1.0 compatibility and closed 1.1 operation matrix;
- reject arbitrary mapping/JQL/code and unknown adapter family;
- scan dependency graph for Core/QA/Web → Jira imports and Connector → QA/Nest/React imports;
- compare generated OpenAPI/AsyncAPI and Mock Hub snapshots;
- validate event and error/envelope redaction.

### 10.2. Persistence/security

- PostgreSQL 17/18 fresh/upgrade/repeat/failed-recovery migrations;
- one binding/current projection, append-only history and scope constraints;
- create/import/webhook/reconcile concurrency convergence;
- external principal verification/revoke/conflict;
- exact approval, effect-time revoke/drift/expiry and separation of duties;
- wrong project/profile/Connection/discriminator/webhook/identity denial before downstream call;
- secret/raw-provider/log/audit disclosure scan;
- production endpoint/credential/egress denial.

### 10.3. Connector and resilience

- same provider-neutral conformance over `connector-mock`, Jira Cloud mock and DC mock;
- create/defect timeout before/after effect, marker lookup and ambiguity stop;
- link/comment partial-effect recovery;
- stale pre-read conflict and post-read mismatch;
- duplicate/out-of-order/lost webhook repaired by reconciliation;
- Cloud token and DC offset pagination under concurrent issue updates;
- 401/403 terminal alert, 429 Retry-After, 5xx/timeout bounded retry, schema drift isolation;
- connection/profile upgrade never retargets pending/started effect.

### 10.4. User-story acceptance

| Story | Independent evidence |
|---|---|
| US1 | Confirm one Draft and observe exactly one central Jira issue, Work Item and binding; duplicate/concurrent submit and crash recovery remain one; outage creates no fake Work Item. |
| US2 | Create an in-scope issue as verified Jira HUMAN and observe one import plus completeness; out-of-scope/unverified/ambiguous issue creates no Work Item or disclosure. |
| US3 | Human Jira change updates monotonic projection; duplicate/out-of-order event cannot roll back; stale exact command conflicts with zero known-stale write and requires a new approval. |
| US4 | Approve one defect draft and observe one exact defect plus one QA Request link/DefectLink; repeat/partial recovery creates no duplicate. |

### 10.5. Live non-prod gate

The opt-in suite verifies actual metadata, auth, least privilege, issue marker/search consistency, webhook delivery/HMAC/identifier behavior, rate headers, concurrency mode, create/link/transition/read-back and cleanup policy in a dedicated non-prod scope. It stores only sanitized evidence hashes/reports. A missing input is `SKIPPED_GATED`, never an assumed pass.

## 11. Requirement trace summary

| Spec area | Design coverage |
|---|---|
| FR-001…005 | Connection/adapters, secret/service identity, discovery and least privilege |
| FR-006…012 | three Profiles, lifecycle, immutable versions, exact pins, bounded mapping, drift isolation |
| FR-013…015 | one binding, authoritative read confirmation, explicit projection/freshness UI |
| FR-016…020 | semantic/effect idempotency, source link, verified import, completeness, convergence |
| FR-021…025 | raw webhook trust, dedupe, monotonic apply, reconciliation lanes/cursors/rate budget |
| FR-026…029 | typed 1.1 commands, exact approvals, conflict/read-back, closed errors |
| SC-001…007 | per-story checkpoints, least-privilege report and full correlation/audit trace |

Detailed task/test-level trace is generated and orphan-checked by `tools/verification/feature-003-trace.mts`.

## 12. Implementation milestones

### M1 — Prerequisite and contract shell

Verify 001/002, scaffold the pure Jira and Jira TypeORM persistence packages, normalize environment vocabulary, compile 003 contracts and freeze architecture boundaries.

### M2 — Operational authority foundation

Add provider-neutral external identity/import/projection/conflict/reconciliation models, migrations, repositories, transactions and HTTP/event surfaces.

### M3 — Jira configuration and protocol mock

Implement dialects, transport/auth/secret ports, discovery, mapping, Profile validation/preview/dry run, Mock Hub Jira and C1 metadata gate.

### M4 — US1 central request

Implement marker-based create/source link/read confirmation, atomic Work Item/QA hook and local UI/checkpoint.

### M5 — US2 direct import

Implement raw webhook/import reconciliation, discriminator routing, verified-human evidence, atomic adoption and completeness.

### M6 — US3 sync and commands

Implement projection reducer/history, webhook ordering, reconciliation scheduler/freshness, 1.1 approved commands, conflicts and UI.

### M7 — US4 defect

Implement Jira defect mapping, marker/duplicate policy, QA/session/build/evidence linking, exact confirmation and recovery.

### M8 — Security, resilience and non-prod evidence

Complete least privilege, failure injection, migration matrix, full E2E, trace/smoke/CI, optional live contract suite and handoff.

## 13. Risks and mitigations

| Risk | Mitigation/gate |
|---|---|
| 001/002 target primitives absent | Machine-readable prerequisite gate; no local reimplementation |
| Pilot edition/fields/auth unknown | Versioned C1 metadata package; local deterministic fixtures; non-local publish blocked |
| Jira lacks atomic issue CAS | Expected-token pre-read/minimum write/post-read; explicit concurrency mode; strict gate may require Jira-side CAS |
| Jira lacks native create idempotency | Platform serialization + searchable marker + read reconciliation + stop on ambiguity |
| JQL eventual consistency/offset drift | Watermark overlap, immutable issue-ID dedupe, no blind re-create, full sweeps |
| Central project misroutes Platform Project | Required discriminator, pairwise non-overlap validation, backend entitlement |
| Webhook loss/duplicate/out-of-order | Durable receipt, authoritative re-read, monotonic reducer and scheduled reconciliation |
| Custom field/workflow drift | Immutable discovery snapshot, per-Profile `MAPPING_REQUIRED`, no global outage |
| Credential/permission overreach | Service identity, secret refs, negative permission evidence and no admin runtime |
| Multi-step partial Jira effect | Durable sub-effect receipt and exact link/comment/state read-before-retry |
| External text leakage | Classification gate before mapping/return, sanitized snapshots, redaction scans |
| Profile upgrade retargets history | Exact pins and old-chain recovery only |

## 14. Explicit non-goals

- Jira workflow/field/project/user administration from the platform;
- delete issue or production Jira writes;
- arbitrary tracker support or dynamic Connector loading;
- user impersonation or personal PATs;
- autonomous priority, assignment, due date, transition, defect or release decisions;
- dual-master operational state or local optimistic mutation;
- reusable test-case management, GitLab automation, Mattermost/Hermes, SLA/queue or project onboarding beyond required 003 seams;
- claiming native Jira exactly-once/CAS guarantees that the selected API cannot prove.

## 15. Constitution Check — after design

Post-design review remains PASS for all twelve principles:

- authority, mapping, approval, idempotency, conflicts, projection and reconciliation are deterministic;
- Core/Pack/Connector ownership and static composition remain enforceable;
- every accepted/imported/project-scoped fact has Workspace/Project and exact integration refs;
- requested operational values never become canonical before Jira read confirmation;
- direct import has explicit verified-human intent evidence;
- all mandatory Jira writes use exact one-time approval except the explicitly confirmed request create;
- PostgreSQL remains authoritative for durable workflow/audit, Redis is reconstructible;
- local critical flow uses a stateful protocol mock and no corporate credential;
- history and pending effects never silently move to a new Profile;
- production effects are excluded by credential, configuration, policy, composition and network tests.

**Constitution exceptions:** none.  
**Complexity tracking:** not applicable; added modules correspond to mandated Core/Connector boundaries and external-authority failure modes.

## 16. Implementation and handoff status

Planning, implementation and convergence are complete for the local release scope. The exact Node.js 24.20.0 aggregate gate verifies prerequisites, contracts, architecture, migrations, security, process-level US1–US4, browser journey, documented quickstart, typecheck, lint, build and traceability. Its `BOUND` handoff report pins the completed task set, scoped runtime tree and every authoritative child report; `pnpm verify:003:evidence` fails closed after drift.

Real non-prod publication/execution is optional and additionally requires the immutable C1 metadata package, service credential, TLS/network allowlist, least-privilege and concurrency evidence plus explicit operator opt-in. Until then its reports remain `SKIPPED_GATED`, which is acceptable for local release readiness but is never represented as a live pass. Production writes remain excluded by scope and by credential, configuration, policy, composition, CI and network controls.
