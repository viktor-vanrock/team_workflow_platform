# Data Model: Jira operational authority

**Feature:** `003-jira-operational-authority`  
**Date:** 2026-08-28  
**Status:** Phase 1 design complete

## 1. Scope and ownership

This model extends the provider-neutral foundation designed by features 001/002. It does not create a second QA Work Item model and does not move Jira-specific fields into the QA Pack.

```text
Jira
  canonical: workflow/status, assignee, priority, due date, Jira links/comments

Platform Core
  canonical: Work Item identity/scope, exact integration pins, projection history,
             import evidence, conflicts, external identity binding, commands,
             approvals, inbox/outbox, reconciliation progress and audit

QA Pack
  canonical: request input/readiness, Sessions, Findings, Evidence, DefectDraft,
             Verdict and feature-002 confirmation hooks

Connector Jira
  canonical: adapter/dialect metadata, sanitized discovery snapshots,
             provider effect/sub-effect reconciliation and protocol normalization
```

Connector-owned tables never foreign-key into QA tables. QA tables may reference stable Core Work Item/command/binding IDs through the contracts already defined by feature 002. Cross-owner updates happen only through generic transaction-aware hooks.

## 2. Shared conventions

### 2.1. Scope and identifiers

- UUIDs are server-generated and opaque.
- Every project-scoped Core row includes `workspace_id` and `project_id`.
- Composite unique/FK constraints include scope even when `id` is globally unique.
- Workspace-scoped Jira identity/Connection metadata never grants Project access.
- External issue identity uses immutable Jira issue ID, not mutable display key.
- Authority uniqueness uses `{connection_header_id, external_entity_type, external_entity_id}`, not Profile version, so configuration upgrades cannot import the same Jira issue twice.

### 2.2. Time and versions

- Platform timestamps are UTC `timestamptz` from an injected clock.
- Mutable headers use positive `resource_version` CAS.
- Immutable revisions use positive contiguous `revision` within their header and canonical `content_hash`.
- Jira `updated` is a provider fact, not the platform receive time.
- `external_revision_token` is an opaque digest computed by the pinned adapter from provider `updated`, optional changelog identity and canonical authority-field hash.

### 2.3. Hashing and JSON

- Semantic hashes are `sha256:` + SHA-256 over RFC 8785/JCS canonical JSON.
- Schema ID/version/digest is included in every schema-bound payload hash.
- Raw credential values and unrestricted raw Jira responses are forbidden in every table.
- Sanitized JSON columns use closed schemas and `additionalProperties:false` at the contract boundary.
- Mapping AST depth/node/output limits are validated before storage and again before publication.

### 2.4. Environment

Canonical values are:

```text
LOCAL | NON_PROD | PREPROD | PLATFORM_PROD
```

Feature 003 permits effect-capable Jira Connection/Profile content only for `LOCAL | NON_PROD`. Generic environment metadata may name PREPROD/PLATFORM_PROD, but 003 supplies no credential, Profile publication, composition or egress path for those scopes. Compatibility parsing of earlier planned values occurs at ingress and is audited; persisted rows never mix synonyms.

## 3. Existing Core entities changed by expand/contract

### 3.1. `work_items`

Add/standardize:

| Column | Type | Rule |
|---|---|---|
| `acceptance_source` | enum | `PLATFORM_DRAFT | OPERATIONAL_IMPORT` |
| `intake_draft_id` | uuid nullable | required iff `PLATFORM_DRAFT` |
| `operational_import_intent_id` | uuid nullable | required iff `OPERATIONAL_IMPORT` |
| `operational_binding_id` | uuid | required at Work Item commit |
| `title` | text | immutable accepted structural title |
| `normalized_status` | enum | derived only from current confirmed projection |
| `requester_principal_id` | uuid | verified canonical HUMAN requester |
| `assignee_principal_id` | uuid nullable | derived current verified mapping |
| `data_classification_key` | stable key | immutable accepted authority classification |
| `updated_at` | timestamptz | platform row update time |
| `row_version` | bigint | optimistic CAS |

Check constraints:

```text
PLATFORM_DRAFT     => intake_draft_id IS NOT NULL AND operational_import_intent_id IS NULL
OPERATIONAL_IMPORT => intake_draft_id IS NULL AND operational_import_intent_id IS NOT NULL
```

`work_items.normalized_status` and `assignee_principal_id` are read-optimized derived fields. The projection transaction updates them together with the binding current pointer. They are never accepted from HTTP or Connector payload independently.

### 3.2. `operational_bindings`

This is the existing one-to-one authority binding, expanded rather than replaced.

Immutable origin fields:

| Column | Meaning |
|---|---|
| `id`, `workspace_id`, `project_id`, `work_item_id` | scoped identity |
| `project_integration_binding_id/version` | exact Project Binding used at acceptance/import |
| `connector_profile_id/version` | exact central authority Profile used at acceptance/import |
| `connection_header_id` | stable Jira tenant/authority namespace |
| `connection_id/version` | exact Connection used at acceptance/import |
| `mapping_id/version` | exact Mapping used at acceptance/import |
| `adapter_family`, `adapter_contract_version` | exact provider dialect |
| `external_entity_type` | provider-neutral `OPERATIONAL_REQUEST` |
| `external_entity_id` | opaque immutable provider entity ID |
| `initial_external_display_key` | provider display key at acceptance, for history |
| `acceptance_source` | `CREATE_READ_BACK | VERIFIED_IMPORT` |
| `created_at`, `created_by` | acceptance provenance |

Mutable current pointer/health:

| Column | Meaning |
|---|---|
| `current_projection_revision_id` | exact append-only current projection |
| `current_external_display_key` | latest display key |
| `current_external_revision_token` | latest applied token |
| `sync_state` | `SYNCED | ERROR | CONFLICT | MAPPING_REQUIRED | AUTH_BLOCKED` |
| `freshness_state` | `CURRENT | STALE | UNKNOWN` |
| `fresh_until` | derived from Profile SLO at observation time |
| `last_observed_at` | latest authoritative read observation |
| `last_webhook_at` | latest accepted relevant webhook signal |
| `last_reconciled_at` | latest completed bound refresh |
| `last_error_code` | sanitized nullable code |
| `updated_at`, `row_version` | CAS metadata |

Constraints:

- `UNIQUE(workspace_id, project_id, work_item_id)`;
- `UNIQUE(connection_header_id, external_entity_type, external_entity_id)`;
- current projection must have the same scope/binding ID;
- one Work Item and one binding point to each other through deferrable same-transaction constraints;
- immutable origin fields cannot update; Profile upgrades create new commands/observations with their exact refs but do not rewrite origin.

The current observation may use a newer compatible Profile/Mapping than origin; every projection revision records the exact refs that interpreted it. Origin remains the acceptance proof.

### 3.3. `connector_commands`

Platform Core owns the command model. The final 001/002 gate must already round-trip logical role and the primary configuration chain correctly; 003 extends the Core model only through the explicit additive fields below:

- closed capability operation including `request.assign`, `request.set-priority`, `request.set-due-date`;
- `expected_external_state` with revision token and operation-specific current value;
- immutable ordered primary+auxiliary configuration-chain set and adapter family/version for every entry;
- full typed target/payload hashes;
- `AMBIGUOUS` terminal/reconciliation category represented without pretending success;
- initial/effect-time authorization basis;
- invocation/sub-effect/confirmation receipt refs;
- no hard-coded logical role during persistence reload.

No command row stores secret values, raw Jira body or client-selected Jira transition/field ID.

### 3.4. `connector_command_configuration_pins`

Provider-neutral immutable ordered configuration set resolved before outbox publication:

| Column | Rule |
|---|---|
| `command_id`, `sequence` | unique ordered membership |
| `purpose` | `PRIMARY | AUXILIARY` with exactly one PRIMARY |
| `requirement_key`, `logical_role` | closed manifest-owned role request |
| `project_integration_binding_id/version` | same exact Project Binding version for the set |
| `connector_profile_id/version`, `mapping_id/version`, `connection_id/version` | exact immutable refs |
| `content_hash`, `adapter_family`, `adapter_contract_version` | execution/audit pins |
| `authority_namespace_hash` | opaque compatibility key for native versus remote linking |

The ordered-set hash is part of command and Approval identity. Source/defect link policy declares required auxiliary roles; a payload cannot supply these refs. Cross-Connection native linking is rejected unless the pins prove one compatible authority namespace; otherwise only an explicitly published remote-link strategy may be used.

### 3.5. `connector_target_execution_lanes`

Durable fenced serialization across distinct commands for one provider entity:

| Column | Rule |
|---|---|
| `connection_header_id`, `external_entity_type`, `external_entity_id` | unique target lane key |
| `active_command_id` | one command owns the lane |
| `lease_token`, `lease_expires_at`, `attempt` | fenced recovery metadata |
| `state` | `CLAIMED | EFFECT_STARTED | AWAITING_RECONCILIATION | RELEASED` |
| `resource_version`, timestamps | CAS and audit metadata |

The lane is not released merely because a worker lease expires. A different command cannot call the provider until the prior effect is confirmed, reaches final conflict/failure, or its ambiguity is explicitly resolved. Recovery may reacquire only the same command/effect identity with a newer fencing token.

## 4. External principal binding — Core migration 0095

### 4.1. `external_principal_bindings`

Versioned Workspace-scoped mapping from an opaque external authority subject to a canonical platform principal.

| Column | Rule |
|---|---|
| `id`, `workspace_id` | stable header |
| `connection_header_id` | tenant/authority namespace, not mutable Connection version |
| `provider_namespace` | opaque Connector/Connection authority namespace |
| `external_principal_kind` | provider-neutral `EXTERNAL_HUMAN | EXTERNAL_SERVICE` |
| `external_principal_id` | opaque stable subject; Cloud/DC interpretation remains adapter-owned |
| `principal_id` | canonical platform identity |
| `state` | `PENDING | VERIFIED | REVOKED | CONFLICT` |
| `verification_method` | closed key from policy |
| `verification_evidence_hash` | sanitized immutable proof digest |
| `verified_by`, `verified_at` | HUMAN/admin provenance, nullable until VERIFIED |
| `revoked_by`, `revoked_at`, `revoke_reason` | nullable lifecycle provenance |
| `resource_version`, `created_at`, `updated_at` | CAS metadata |

Constraints:

- one active external subject maps to at most one canonical principal per Connection header;
- one canonical principal may have multiple historical/revoked mappings but at most one active mapping for the same external kind/tenant;
- VERIFIED requires verifier/evidence/timestamp;
- REVOKED requires revoke provenance;
- email, display name and username are diagnostic only and absent from uniqueness;
- resolving a binding never skips live membership/Project Entitlement/role/classification checks.

Lifecycle:

```text
PENDING → VERIFIED → REVOKED
PENDING | VERIFIED → CONFLICT
CONFLICT → VERIFIED | REVOKED   (new verified resolution evidence required)
```

## 5. Projection history — Core migration 0090

### 5.1. `operational_projection_revisions`

Append-only authoritative observation history.

Identity/provenance:

- `id`, `workspace_id`, `project_id`, `binding_id`, `revision`;
- `observation_id`, `observation_source`:
  `CREATE_READ_BACK | IMPORT_READ | COMMAND_CONFIRMATION | WEBHOOK_READ | RECONCILIATION_READ | CONFLICT_READ`;
- exact `project_integration_binding_ref`, `profile_ref`, `mapping_ref`, `connection_ref`;
- `adapter_family`, `adapter_contract_version`, `discovery_snapshot_ref`;
- `provider_updated_at`, nullable `provider_changelog_id`;
- `external_revision_token`, `authority_fields_hash`, `observation_hash`;
- `observed_at`, `applied_at`, `correlation_id`, `causation_id`.

Authority fields:

- `external_entity_id`, `external_display_key`, safe `external_web_url`;
- `raw_status_id`, `raw_status_name`, `normalized_status`;
- `requester_external_principal_id`, `requester_principal_id`;
- `assignee_external_principal_id`, `assignee_principal_id` nullable;
- `raw_priority_id`, `raw_priority_name`, `normalized_priority_key` nullable;
- `due_date` nullable date;
- sanitized current Jira link/comment index refs where Profile allows them;
- `data_classification_key`.

Constraints:

- `UNIQUE(binding_id, revision)` and `UNIQUE(binding_id, observation_hash)`;
- insert-only; update/delete denied by DB trigger/grant;
- exact refs belong to the same Workspace and compatible authority namespace;
- current raw status must be declared by that exact Profile mapping or the observation is not applied and a drift report is created;
- canonical principal ref is nullable only when mapping is genuinely absent; a required requester mapping blocks import/apply according to Profile policy;
- content hash covers all semantic fields and exact refs.

### 5.2. Monotonic comparison

The reducer compares a new authoritative read with the current revision:

```text
same observation hash                       → DUPLICATE
same external token + different field hash  → INCOMPARABLE / reconciliation + security diagnostic
strictly older provider token/time/changelog → STALE_IGNORED
strictly newer comparable token              → APPLIED
gap or dialect cannot prove ordering          → GAP_REQUIRES_RECONCILIATION
```

Receive time never establishes provider order. `GAP_REQUIRES_RECONCILIATION` does not mutate the current projection.

### 5.3. Freshness

Freshness is orthogonal to sync result:

```text
CURRENT: last_observed_at + pinned freshness target > now
STALE:   target elapsed and no newer confirmed observation
UNKNOWN: no confirmed observation or Profile target unavailable due drift
```

A scheduler may mark the binding header `STALE` without inserting a fake projection revision. A later read applies a revision and recomputes `fresh_until`.

## 6. Import model — Core migration 0095

### 6.1. `operational_import_intents`

Durable intake/import evidence for an existing central Jira issue.

Immutable discovery fields:

- `id`, `workspace_id` and nullable `project_id` until safe routing;
- `connection_header_id`, exact `connection_ref`, `profile_ref`;
- `external_entity_type`, `external_entity_id`, `external_display_key`;
- `discovery_source`: `WEBHOOK | IMPORT_RECONCILIATION | OPERATOR_REPLAY`;
- provider event/delivery/change refs and `discovery_payload_hash`;
- authoritative read hash/revision token and create timestamp/changelog proof;
- external creator ID and nullable `external_principal_binding_ref`;
- project discriminator value and nullable resolved Binding ref;
- accepted payload schema ref/hash;
- `created_at`, correlation/causation IDs.

Mutable lifecycle fields:

- `state`;
- `routing_reason_code`, `security_reason_code`, `last_error_code`;
- `result_work_item_id`, `result_binding_id` nullable;
- `adopted_at`, `ignored_at`, `next_attempt_at` nullable;
- `attempt_count`, `row_version`, `updated_at`.

Lifecycle:

```text
DISCOVERED
  → ROUTED
  → IDENTITY_VERIFIED
  → ADOPTED

DISCOVERED | ROUTED | IDENTITY_VERIFIED
  → AWAITING_CONFIRMATION
  → BLOCKED_MAPPING
  → FAILED_RETRYABLE → prior safe stage
  → IGNORED_OUT_OF_SCOPE
  → REJECTED_SECURITY
```

Rules:

- `ADOPTED` requires exact issue/Profile/Binding/Project, verified HUMAN creator, live access basis, content hash, Work Item and binding refs;
- `AWAITING_CONFIRMATION` creates no Work Item and discloses no restricted issue content;
- out-of-scope/security states are terminal for that immutable discovery evidence but a new provider observation may create a new intent only if its authoritative hash/version changed;
- `UNIQUE(connection_header_id, external_entity_type, external_entity_id)` for the active/adopted identity prevents webhook/reconciliation/create races;
- adoption and all resulting Core/QA rows occur in one transaction.

### 6.2. Import adoption transaction

Lock order:

1. external issue authority key advisory lock;
2. import intent;
3. matching existing operational binding/import row;
4. Project/identity/entitlement/configuration snapshots;
5. Work Item/binding/projection rows;
6. feature-002 Pack extension lock through the registered generic import hook;
7. audit/event outbox.

Replay returns the same Work Item/binding. Any scope/config/identity drift before commit leaves the intent non-adopted and writes zero Work Item/QA rows.

## 7. Conflict model — Core migration 0090

### 7.1. `operational_sync_conflicts`

Append-only mismatch fact with a small mutable resolution header.

| Column | Meaning |
|---|---|
| `id`, scope, `binding_id`, `command_id` | conflict identity |
| `operation` | transition/assign/priority/due/create reconciliation kind |
| `expected_external_revision_token` | approved command expectation |
| `expected_value_hash` | operation-specific expected current value |
| `observed_external_revision_token` | fresh Jira read |
| `observed_value_hash` | observed current value |
| `observed_projection_revision_id` | newly applied/known projection |
| `approval_id`, exact chain refs | immutable authorization/config evidence |
| `reason_code`, `detected_at` | sanitized fact |
| `state` | `OPEN | ACKNOWLEDGED | RESOLVED | SUPERSEDED` |
| resolution actor/time/reason/ref | nullable until terminal resolution |
| `resource_version` | CAS |

Lifecycle:

```text
OPEN → ACKNOWLEDGED → RESOLVED
OPEN | ACKNOWLEDGED → SUPERSEDED
```

Resolving a conflict never resumes the old command or approval. A new human decision creates a new typed command with a new expected token and exact approval. Conflict history is never deleted.

## 8. Reconciliation — Core migration 0095

### 8.1. `reconciliation_cursors`

- `id`, `workspace_id`, `project_id`, exact `profile_ref`, `connection_ref`;
- lane `IMPORT_DISCOVERY | BOUND_REFRESH | FULL_DRIFT_SWEEP`;
- `watermark_updated_at`, `watermark_external_key`, `overlap_seconds`;
- configured `page_size`, `max_concurrency`, `budget_class`, `full_sweep_interval`;
- `next_due_at`, `last_success_at`, `last_full_success_at`;
- lease owner/token/until, `resource_version`;
- unique one cursor per exact Profile/lane/scope.

Provider `nextPageToken`/offset is not durable cross-run progress. It may be stored only inside the current run.

### 8.2. `reconciliation_runs`

- scoped ID, cursor/Profile/Connection refs and lane;
- start watermark/overlap and transient provider page state;
- state `PENDING | RUNNING | SUCCEEDED | PARTIAL | FAILED | CANCELLED`;
- counts: read/applied/duplicate/stale/gap/imported/out-of-scope/mapping-required/not-found/error;
- rate-limit snapshot, started/finished/next-retry times;
- sanitized terminal code, correlation ID, row version.

State machine:

```text
PENDING → RUNNING → SUCCEEDED
                  → PARTIAL → PENDING (same safe start watermark)
                  → FAILED
PENDING | RUNNING → CANCELLED
```

Only `SUCCEEDED` advances the durable watermark to the maximum fully processed tuple. `PARTIAL` keeps the previous cursor.

### 8.3. `reconciliation_run_items`

Append-only per-issue outcome for diagnostics and safe replay:

- run/scope/external entity ID/key/update tuple;
- action/result `APPLIED | DUPLICATE | STALE | GAP | IMPORTED | IGNORED | MAPPING_REQUIRED | NOT_FOUND | ERROR`;
- observation/import/projection refs nullable by result;
- sanitized code/hash/duration, created time;
- unique run + immutable issue ID + provider update tuple.

## 9. Jira TypeORM adapter-owned data — migrations 3000…3020

These rows and migrations live in `@awp/connector-jira-persistence-typeorm`, not in the pure protocol package and not in Core persistence. The migration registry accepts owner `connector:jira`; static runtime composition combines the contribution with Core/Pack migrations.

### 9.1. `jira_discovery_snapshots` — 3000

Immutable sanitized metadata:

- scoped Connection/Profile candidate ref;
- adapter family/version and Jira edition/build/API flavor;
- discovered projects/issue types/fields-contexts/statuses/transitions/priorities/link types/identity/webhook/search/auth capabilities;
- permission summary without user lists beyond explicitly requested identity records;
- source request hashes, collected time, expiry/revalidate time;
- schema ref, content hash, validation status;
- no raw credential or unrestricted issue body.

### 9.2. `jira_profile_validation_details` — 3000

Connector-owned details attached to generic immutable Validation Report:

- candidate Profile content hash and discovery snapshot ref;
- each referenced ID resolution;
- JQL parse/scope check;
- mapping compile/output schema check;
- marker/discriminator/search capability evidence;
- transition/link direction/permission evidence;
- webhook/reconciliation/rate/concurrency capability decision;
- preview/dry-run sanitized hashes;
- issue list with closed code/severity/path, never secret/raw provider body.

### 9.3. `jira_webhook_normalizations` — 3010

The generic webhook inbox owns exact raw receipt/quarantine. This table stores only normalized Connector metadata:

- generic receipt ref, connection header/ref, adapter family;
- provider delivery ID/retry number/event type;
- external entity/changelog IDs and provider timestamp if present;
- verification mode/result and secret-key version ref, never secret;
- normalization hash/status `ACCEPTED | DUPLICATE | REJECTED | SCOPE_PENDING`;
- sanitized reason and created time.

### 9.4. `jira_rate_limit_snapshots` — 3010

- Connection ref and lane;
- provider limit reason, remaining/reset/fill metadata when present;
- Retry-After and observed time;
- normalized budget decision and next eligible time;
- append-only, short retention allowed after aggregate metrics/audit retention policy.

### 9.5. `jira_effect_reconciliations` — 3020

One Connector-owned record per platform effect:

- command/effect ID and exact Connection/Profile refs;
- operation/target/external issue ID nullable before discovery;
- searchable marker and semantic payload/target hashes;
- state `NOT_STARTED | LOOKUP_REQUIRED | ISSUE_FOUND | EFFECT_IN_PROGRESS | CONFIRMED | AMBIGUOUS | FAILED_FINAL`;
- lookup window/query hash/match count;
- normalized provider receipt/hash and external revision token;
- attempt/next-retry/lease metadata;
- no duplicate independent command state; Core remains authoritative.

### 9.6. `jira_effect_sub_effects` — 3020

Ordered exact sub-effect ledger:

- parent effect, sequence, kind `ISSUE_CREATE | FIELD_EDIT | TRANSITION | ISSUE_LINK | REMOTE_LINK | COMMENT | PROPERTY`;
- semantic identity/hash and required/optional flag;
- normalized external identity/receipt hash;
- state `PENDING | OBSERVED | APPLIED | CONFIRMED | CONFLICT | AMBIGUOUS | FAILED`;
- attempt and timestamps;
- unique parent + semantic sub-effect identity.

The ledger is used for provider recovery, not as proof of canonical platform state; generic confirmation still requires an authoritative final read.

### 9.7. `jira_ambiguity_resolutions` — 3020

Append-only operator decision for an ambiguous same-effect lookup:

- effect ref, candidate issue refs/hashes;
- decision `ATTACH_EXACT_ISSUE | PROVE_ABSENT_AND_RETRY | ABANDON`;
- HUMAN actor and authorization basis, reason/evidence hash/time;
- exact expected Connector state/resource version;
- a resolution cannot retarget the command payload or approval.

## 10. Generic webhook inbox expansion

The actual feature-001 persistence is insufficient and must meet the target contract before 003:

- key includes exact Connection/tenant plus provider delivery identity;
- exact raw bytes or approved encrypted/quarantined blob ref are persisted before ACK;
- raw body hash, content type, size, received time and header allowlist are stored;
- verification result/secret-key version and replay/dedupe status are explicit;
- Project may be null until safe Connector normalization;
- same delivery ID with another body hash is a security conflict;
- raw payload is retention-limited and never emitted to normal project events/logs.

The Nest route must not parse/re-serialize before signature verification.

## 11. Profile/configuration state

### 11.1. Connection/Profile lifecycle

The generic lifecycle is refined without mutating existing published history:

```text
DRAFT → DISCOVERED → VALIDATED → PUBLISHED → RETIRED
```

If the generic registry exposes only DRAFT/VALIDATED/PUBLISHED/RETIRED, `DISCOVERED` is represented by an immutable discovery snapshot prerequisite while the candidate remains DRAFT. A new Profile version creates a new candidate under the existing stable header; it must not duplicate the header or mutate the previous row.

### 11.2. Mutable health

Separate health projection per exact Connection/Profile:

```text
Connection: HEALTHY | DEGRADED | AUTH_BLOCKED | RATE_LIMITED | UNREACHABLE | REVOKED
Profile:    HEALTHY | DEGRADED | MAPPING_REQUIRED | SCOPE_INVALID | DISABLED
```

Health changes do not change immutable content hash. A Profile-level fault blocks only commands/import/sync resolving through that exact Profile. Started recovery may read through retired exact refs according to Core recovery policy.

## 12. Mapping model

Jira Mapping content is schema-bound:

```text
MappingProgram {
  inputSchemaRef,
  outputFieldAllowlist,
  maxDepth,
  maxNodes,
  maxOutputBytes,
  expression,
  lookupTables,
  contentHash
}
```

Expression union:

```text
literal(value)
source(allowlistedPath)
coalesce(expressions[])
lookup(tableKey, expression)
concat(expressions[], separator)
format-date(expression, allowlistedFormat)
array(expressions[])
object(closedTargetFields)
omit-if-null(expression)
```

Validation rejects unknown node/type/path/target field, cyclic schema ref, non-total required-field expression, secret source path, over-limit AST/output and any executable string. Preview/dry run returns sanitized input/output hashes and field-level diagnostics.

## 13. Domain state interactions

### 13.1. Jira status vs QA readiness

These remain independent:

```text
Operational projection: NEW | NEEDS_INFO | READY | PLANNED | IN_PROGRESS |
                        REVIEW | BLOCKED | DONE | CANCELLED

QA readiness: NEEDS_INFO | READY | READY_WITH_WAIVER
```

Import completeness may yield QA `NEEDS_INFO` while Jira projection remains its actual mapped status. Only an exact approved Jira transition can change the Jira status.

### 13.2. Pending command

Pending intent is not a projection revision. API/UI reads combine:

```text
confirmedProjection
optional pendingCommand {operation, requestedValueHash/safeSummary, approvalState, commandState}
optional openConflict
```

No repository method writes requested assignment/priority/due/status into Work Item/binding current fields.

### 13.3. Mapping drift

An authoritative read that cannot map a required field/status:

1. stores sanitized Connector validation/drift evidence;
2. does not apply a partial projection as canonical;
3. sets exact Profile health and affected binding `MAPPING_REQUIRED`;
4. emits scoped diagnostic/audit;
5. preserves the last confirmed projection and shows its freshness;
6. blocks only operations/imports needing that Profile.

## 14. Transaction and lock matrix

| Flow | Locks | Atomic writes |
|---|---|---|
| Confirmed create | Draft, command, effect receipt, external authority key, Work Item/binding, QA hook | command + Draft + Work Item + projection + QA extension + audit/event |
| Direct import | external authority key, import intent, identity/config/access refs, Work Item/binding, QA hook | intent + Work Item + projection + QA extension + audit/event |
| Observation apply | consumer key, binding current pointer | inbox + projection/current derived fields + audit/event |
| Command claim/conflict | target execution lane CAS, approval/command/outbox, binding pointer | fenced lane claim; then command terminal + authorization invalidation + latest projection + conflict + audit/event |
| Reconciliation page | cursor lease/run, per binding/import key | item results + observations/imports; cursor only on complete success |
| Defect confirmation | command/effect receipt, QA DefectDraft lock | command receipt + QA hook DefectLink/draft state + audit/event |

External calls never occur while a database transaction/row lock is held. The committed target-lane state plus fencing token guards the call across transactions; recovery after lease expiry uses the same command/effect identity and a higher token, while a different command remains blocked until the lane is terminally released.

## 15. Indexes

Minimum indexes:

- `operational_bindings(workspace_id, project_id, sync_state, freshness_state, fresh_until)`;
- unique `operational_bindings(connection_header_id, external_entity_type, external_entity_id)`;
- `operational_projection_revisions(binding_id, revision DESC)`;
- `operational_projection_revisions(binding_id, provider_updated_at DESC, external_display_key)`;
- partial `operational_sync_conflicts(workspace_id, project_id, state) WHERE state IN ('OPEN','ACKNOWLEDGED')`;
- unique active import external identity and `operational_import_intents(state, next_attempt_at)`;
- unique active external principal subject/tenant and reverse principal lookup;
- `reconciliation_cursors(next_due_at)` and lease index;
- `reconciliation_runs(state, started_at)` plus run-item result index;
- `jira_effect_reconciliations(state, next_retry_at)`;
- `jira_effect_sub_effects(effect_id, sequence)`;
- unique `connector_target_execution_lanes(connection_header_id, external_entity_type, external_entity_id)` plus lease expiry index;
- generic webhook receipt Connection/delivery and received/retention indexes.

All user-facing queries add scope/entitlement/classification predicates before joining external identifiers.

## 16. Migration inventory and behavior

### `0090_operational_authority`

- expand `work_items` and `operational_bindings`;
- create projection revisions and sync conflicts;
- create immutable command configuration pins and durable target execution lanes;
- add current pointers/deferrable scope constraints/indexes;
- backfill only deterministic feature-001/002 mock rows from confirmed receipts;
- unverifiable legacy rows remain `UNKNOWN/MAPPING_REQUIRED`, never fabricated;
- dual-read/write compatibility window before old columns contract.

### `0095_external_identity_import_reconciliation`

- create external principal bindings, import intents, reconciliation cursors/runs/items;
- add Work Item acceptance-source XOR constraints after safe backfill;
- add generic import hook/UoW persistence metadata;
- no automatic external identity verification from email/name.

### `3000_jira_discovery_profiles`

- create Connector-owned discovery and validation detail tables;
- register entity/migration contribution through static Jira composition.

### `3010_jira_webhook_rate`

- add normalized provider delivery/rate snapshots;
- extend generic raw webhook adapter without Connector owning generic inbox rows.

### `3020_jira_effect_reconciliation`

- create effect/sub-effect/ambiguity rows;
- no QA foreign keys or raw payload columns.

Migration rules:

- PostgreSQL 17 and 18 fresh, upgrade, repeat and failed-recovery paths;
- `synchronize:false` always;
- expand/contract, no destructive same-release column removal;
- module-owned migration/entity parity test;
- migration registry supports `connector:${string}` owners and rejects ownership/order collisions;
- no empty reserved migrations; new adapter state receives the next real migration only when its model exists;
- no retroactive edits to 001/002 applied migrations;
- Mock Hub migrations run in its separate database/role.

## 17. Required data-model tests

### 17.1. Constraints and concurrency

- simultaneous confirm/import/webhook/reconcile for one Jira issue yields one Work Item/binding;
- same external Jira issue cannot bind twice across Profile versions;
- one Work Item cannot have two active bindings;
- current pointer cannot reference another binding/project;
- projection history update/delete and revision gap are rejected;
- same observation hash is idempotent; same token/different hash is diagnostic, not overwrite;
- Work Item derived fields cannot diverge from current projection after transaction commit;
- import source XOR and verified-human adoption constraints hold;
- external principal active uniqueness and revoke behavior hold;
- cursor advances only after successful complete run.

### 17.2. Lifecycle

- import state transitions and terminal branches are closed;
- conflict resolution never resumes old command/approval;
- reconciliation PARTIAL retains previous watermark;
- freshness expiry does not create projection history;
- mapping drift preserves last good projection;
- Profile retirement does not alter historical refs or retarget started effect;
- ambiguity resolution cannot change payload/target/effect identity.

### 17.3. Security and recovery

- wrong Workspace/Project/Profile/Connection/discriminator/identity denied before issue content disclosure or Connector effect;
- credential/raw response cannot be inserted into schema-bound/audit/log columns;
- webhook same delivery/different hash creates security rejection;
- 401/403 pause auth path without retry, 429 schedules bounded retry, timeout uses lookup before write retry;
- crash after Jira effect but before platform commit recovers the same effect/sub-effects;
- revoked entitlement/approval/profile before invocation yields zero Jira calls and preserved effect-time denial basis;
- production endpoint/credential/environment is rejected before persistence/effect.

## 18. Invariant summary

1. Every accepted QA Work Item has exactly one Jira authority binding from the same commit.
2. Jira-owned values become canonical locally only from an authoritative read applied monotonically.
3. Pending requested value never overwrites the current projection.
4. Every observation preserves the exact Connection/Profile/Mapping/Binding/dialect that interpreted it.
5. Every direct import has verified HUMAN creation evidence and exact Project routing, or creates no Work Item.
6. Every required Jira mutation except confirmed request create has one exact, still-valid approval.
7. Known-stale expected token causes conflict before Jira write; post-read uncertainty is visible, never silent success.
8. Automatic retry never blindly re-creates an issue after a possibly started effect.
9. Webhook payload is an untrusted signal; reconciliation and read-back recover loss/order gaps.
10. Published configuration is immutable; drift blocks only its affected Profile/project feature.
11. Raw credentials/provider bodies are absent from commands, jobs, profiles, logs, audit and business tables.
12. PostgreSQL owns durable workflow, projection, cursor, conflict, approval and audit state; Redis is reconstructible.
