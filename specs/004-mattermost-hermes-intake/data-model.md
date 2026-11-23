# Data Model: Mattermost и Hermes intake

**Feature:** `004-mattermost-hermes-intake`

**Contract baseline:** Core/Connector/QA schemas `1.0.0`; additive Intake Draft contract `1.1.0`

**Persistence:** PostgreSQL 17/18, TypeORM migrations, `synchronize:false`

## 1. Authority and ownership

| Model | Owner | Authority rule |
|---|---|---|
| External Mattermost post/team/channel/member | Mattermost | Connector reads/writes only through an exact Connection/Profile; Platform stores safe refs/projections only. |
| External user binding, Candidate, Draft, confirmation, InteractionIntent | Platform Core | Canonical project-scoped intent and authorization records; none is operational Jira work. |
| Accepted status/assignee/priority/due date | Jira | Feature 003 command/projection path remains authoritative. |
| QA request semantics and TriageAssessment | QA Pack | Proposal/domain state, separate from Jira-owned values and future accepted queue order. |
| Agent Run, grants, Tool Invocation, notification intent | Platform Core | Canonical audit/runtime state; no raw credential or unrestricted prompt. |
| Skill definitions and deterministic QA fallbacks | QA Pack static artifacts | Immutable versioned registrations in the monorepo. |
| Connector Connection/Profile/Mapping/Binding | Platform Core registry | Immutable published configuration; secret value remains outside the database. |
| Queue delivery scheduling | Redis/BullMQ | Reconstructible transport only; PostgreSQL remains authoritative. |

Every product row, callback receipt and durable action below carries both `workspace_id` and `project_id`. The public `/awp create` bootstrap is deliberately outside persistence: it has no Connection/credential, ignores provider identity/scope fields, returns one fixed first-party OIDC continuation and creates no receipt, audit, intent or product state. Raw request bodies are never retained.

### 1.1. Common action provenance

Every automatic Candidate observation/create, HUMAN Candidate decision, Mattermost/web Draft mutation/validation/confirmation, Agent Run start, Agent tool invocation and NotificationIntent stores or references one immutable `ActionProvenance` value:

- `action_id`, closed `action_kind`, exact Workspace/Project scope and subject kind/id/version/content hash;
- initiator kind/id (`HUMAN` or canonical `SERVICE`) and exact authorization-basis hash; delegated Agent actions retain both Hermes SERVICE and initiating HUMAN bases;
- request schema/version/hash and idempotency/request key;
- exact rules/policy/skill refs where applicable and named, versioned Project Binding/Profile/Mapping/Connection pins for integration actions;
- requested effect class, correlation/causation IDs and immutable audit-event ref;
- external command/result ref and safe result hash when an effect is attempted.

Core `0100` creates append-only `action_provenance_records` keyed by `action_id`. Every row requires `workspace_id + project_id` and the exact subject snapshot. Product/proposal tables carry a non-null same-scope provenance reference, while child observations, decisions and revisions each reference the exact action that created that immutable row.

The action/subject/effect combinations are closed: Candidate observe/decide target `CANDIDATE` and record a domain mutation; Draft revise targets `DRAFT_REVISION`, deterministic `DRAFT_VALIDATE` records a `PROPOSAL` with exact rules/policy/skill refs, and Draft confirm pins Binding/Profile/Mapping/Connection plus the existing Connector-command ref; Agent Run start targets the exact `DRAFT | CANDIDATE | WORK_ITEM` snapshot; Notification creation targets `NOTIFICATION_INTENT` and pins Binding/Profile/Connection; and an Agent tool action preserves the exact run subject plus the delegated HUMAN authorization basis. Contract tests reject mixed combinations.

Rejected project callbacks may create only a minimal project-scoped SERVICE record under the resolved Connection in the existing generic security-audit facility, outside `ActionProvenance` and domain `EventEnvelope`; the static bootstrap creates none. Provider display identity, raw body, token and prompt are never provenance authority.

## 2. Migration inventory

| Order | Owner | Content |
|---|---|---|
| Core `0100` | Platform Core | Common action provenance, Candidate/source-observation/decision aggregates, Intake Draft revision/confirmation expansion and legacy Draft backfill. |
| Core `0105` | Platform Core | Project-scoped callback receipts, exact single-use InteractionIntents and bounded AEAD-sealed presentation capsules. |
| Core `0110` | Platform Core | Agent Runs, immutable prompt-manifest provenance, derived grants, steps and Tool Invocations. |
| Core `0120` | Platform Core | Notification intents and delivery-attempt history. |
| Pack `2040` | `pack:qa` | Append-only QA TriageAssessment and SessionPlanProposal revisions/current pointers. |
| Mock `0050` | Mock Hub app | Mattermost teams/channels/users/memberships/posts. |
| Mock `0051` | Mock Hub app | Mattermost fault-scenario state and inbound command/action fixtures. |
| Mock `0052` | Mock Hub app | Effect-call audit, pending-post reconciliation and callback delivery history. |

Core migrations stay below `1000`, Pack migrations remain in the Pack-owned `2000+` range, and Mock Hub keeps a separate database/migration registry. No Mattermost table is added to the QA Pack schema.

## 3. Candidate discovery

### 3.1. `intake_candidates`

Canonical discovery header; it is neither a Work Item nor an SLA/WIP member.

| Column | Rule |
|---|---|
| `id` | UUID stable identity. |
| `workspace_id`, `project_id` | Required hard scope; composite FKs/queries use both. |
| `work_type_key`, `work_type_definition_version`, `work_type_definition_hash` | Exact proposed Work Type pin. |
| `source_kind` | `MATTERMOST_TRIGGER | JIRA_TRIGGER | GITLAB_TRIGGER | PLATFORM_WEB_DISCOVERY`; explicit `/awp create` does not create a Candidate. |
| `source_connection_header_id` | Stable external authority namespace; nullable only for `PLATFORM_WEB_DISCOVERY`. |
| `source_entity_type`, `source_entity_id` | Stable opaque source identity; never inferred from title. |
| `current_source_observation_version`, `current_source_fingerprint` | Pointer to the latest immutable source observation; not part of dedupe identity. |
| `trigger_key`, `trigger_version`, `trigger_content_hash` | Exact allowlisted trigger definition. |
| `deduplication_key` | Canonical SHA-256 over scope + source authority + source entity type/id + trigger key/version. |
| `minimal_summary` | Schema-bound, policy-redacted JSON; no arbitrary chat history. |
| `classification_key` | Server-derived classification. |
| `requester_principal_id` | Verified canonical HUMAN where known. |
| `state` | Candidate lifecycle below. |
| `current_decision_version`, `converted_draft_id` | Nullable current pointer; converted Draft must share scope. |
| `snoozed_until`, `expires_at` | Snooze time is nullable; Candidate expiry is required and immutable for deterministic lifecycle projection. |
| `row_version`, timestamps | CAS and audit metadata. |
| `creation_action_provenance_ref` | Immutable provenance for the first accepted observation that created this Candidate. |

Constraints:

- `UNIQUE(workspace_id, project_id, deduplication_key)`;
- `converted_draft_id` is populated only in `CONVERTED` and references one same-scope Draft;
- a repeated trigger returns the existing Candidate; an identical source fingerprint is a no-op and a changed fingerprint appends an observation rather than another Candidate;
- source text, actor display name and channel name never participate in identity.

Lifecycle:

```text
PENDING_CONFIRMATION → CONVERTED | SNOOZED | IGNORED | EXPIRED
SNOOZED → PENDING_CONFIRMATION | EXPIRED
CONVERTED | IGNORED | EXPIRED are terminal
```

An accepted discovery trigger creates the Candidate directly in `PENDING_CONFIRMATION`; `discovered` is the creation event, not a separately observable aggregate state. An explicit authorized Mattermost/web create action opens a Draft directly after project selection. Candidate rows are reserved for discovery triggers; accepting a Candidate preserves it as provenance and opens a Draft in a separate conversion transaction.

`SNOOZED → PENDING_CONFIRMATION` and time-based expiry are effective projections computed on every read and command. Expiry has precedence: `now >= expires_at` yields `EXPIRED`; only otherwise does `now >= snoozed_until` wake a snoozed Candidate. A SNOOZE decision is rejected unless `snoozed_until < expires_at`. The clock alone does not mutate the Candidate row or emit a domain event. The next human command locks the row and re-evaluates effective state before CAS. A scheduled reminder may create a separately deduplicated `NotificationIntent`, with its own provenance, without changing Candidate history.

### 3.2. `intake_candidate_source_observations`

Append-only source revisions keep source drift out of Candidate identity.

| Column | Rule |
|---|---|
| `candidate_id`, `version`, scope | Unique ordered observation under the same Candidate scope. |
| `source_entity_version`, `source_fingerprint` | Exact provider revision/token and canonical normalized fact hash. |
| `trigger_evaluation_ref`, `trigger_evaluation_hash` | Exact allowlisted trigger rule/result. |
| `minimal_summary` | Schema-bound, policy-redacted snapshot; never a raw webhook/chat transcript. |
| `classification_key` | Server-derived maximum classification of the observation. |
| `observed_at`, `source_observed_at` | Platform and provider times. |
| `correlation_id`, `causation_id` | Authoritative-read provenance. |
| `action_provenance_ref` | Exact `CANDIDATE_OBSERVE` provenance for this immutable observation. |

`UNIQUE(candidate_id, version)` and `UNIQUE(candidate_id, source_fingerprint)` make exact replay a no-op. Provider events append an observation only after authoritative read and allowlisted trigger evaluation; raw webhook fields never become Candidate facts directly.

### 3.3. `intake_candidate_decisions`

Append-only decision history.

| Column | Rule |
|---|---|
| `candidate_id`, `version` | Unique ordered revision under same scope. |
| `decision` | Closed FR-014 set `CREATE | SNOOZE | IGNORE`. Waking a snoozed Candidate is a deterministic lifecycle transition, not a fourth human decision. |
| `expected_candidate_version` | CAS snapshot displayed to the actor. |
| `reason_code`, `reason_text_hash` | Closed reason plus optional sanitized-text hash. |
| `snoozed_until` | Required only for `SNOOZE` and must be strictly earlier than the Candidate `expires_at`. |
| `actor_principal_id`, `actor_kind` | `HUMAN` required for decisions; Hermes/service denied. |
| `authorization_basis_hash` | Exact live membership/entitlement/role/classification basis. |
| `interaction_intent_id` | Optional consumed Mattermost interaction intent. |
| `action_provenance_ref` | Exact `CANDIDATE_DECIDE` provenance. |
| `created_at`, `correlation_id`, `causation_id` | Provenance. |

Rows cannot update/delete. The current pointer in `intake_candidates` changes in the same transaction.

## 4. Versioned Intake Draft

### 4.1. Additive `intake_drafts` header

The existing table remains the stable header. Core `0100` adds/backfills:

- nullable `origin_candidate_id` (null for direct Mattermost/web intake);
- `current_revision` and `current_revision_id`;
- `current_content_hash`;
- `confirmation_state` (`UNCONFIRMED | CONFIRMED | INVALIDATED`);
- `linked_work_item_id` nullable same-scope pointer;
- `expires_at`, `cancelled_at`, `updated_at`;
- additive `conversation_state` below while the legacy `status` contract remains readable.

Legacy rows are backfilled with immutable revision `1` from the exact `intake_payload + intake_schema_ref`. Backfill is total and fail-closed: legacy `DRAFT → conversation DRAFT`, `CANCELLED → CANCELLED`, and `SUBMITTED → LINKED` only when the existing same-scope Work Item is present; an orphan `SUBMITTED` row quarantines/fails migration instead of inventing acceptance.

During the compatibility window, every reader uses one shared Draft repository that treats `current_revision` as canonical. Appending a revision atomically shadow-writes the same normalized content/schema ref into legacy `intake_payload/intake_schema_ref`, so unported 001–003 readers cannot see older content. Direct controller SQL is removed. The legal state projection is:

```text
legacy DRAFT     ↔ DRAFT | VALIDATING | NEEDS_INFO | READY_FOR_CONFIRMATION
                   | CONFIRMED | OPERATIONAL_CREATE_PENDING
                   | FAILED_RETRYABLE | FAILED_FINAL
legacy SUBMITTED ↔ LINKED only; submitted_at is set only here
legacy CANCELLED ↔ CANCELLED only
```

Once every 001–003 reader is proven revision-aware, a later contract/migration may retire the shadow columns; Feature 004 does not drop or reinterpret them.

Lifecycle:

```text
DRAFT → VALIDATING
VALIDATING → NEEDS_INFO | READY_FOR_CONFIRMATION
NEEDS_INFO → DRAFT | VALIDATING | CANCELLED
READY_FOR_CONFIRMATION → DRAFT | CONFIRMED | CANCELLED
CONFIRMED → OPERATIONAL_CREATE_PENDING
OPERATIONAL_CREATE_PENDING → LINKED | FAILED_RETRYABLE | FAILED_FINAL
FAILED_RETRYABLE → OPERATIONAL_CREATE_PENDING | CANCELLED
Any editable non-terminal → CANCELLED
LINKED | FAILED_FINAL | CANCELLED are terminal for that confirmation
```

Editing a `READY_FOR_CONFIRMATION` Draft creates a new revision and returns the header to `DRAFT`. A confirmed revision is immutable; changing content requires cancelling the pending confirmation/command where safe and creating a successor revision with a new confirmation identity.

### 4.2. `intake_draft_revisions`

Append-only normalized content.

| Column | Rule |
|---|---|
| `id`, `workspace_id`, `project_id`, `draft_id`, `revision` | Stable scoped identity and ordered version. |
| `previous_revision_id`, `previous_content_hash` | Null only for revision 1. |
| `intake_schema_ref`, `work_type_definition_ref` | Exact immutable schema/definition pins. |
| `content` | Structurally valid partial content under `urn:awp:schemas:004:qa-intake-partial-content:v1`, using exactly the canonical Feature 002 QA intake field names/types; no parallel chat vocabulary and no secret/raw transcript. |
| `content_hash` | Canonical semantic SHA-256 including refs. |
| `source_kind` | `HUMAN_FORM | MATTERMOST_ACTION | HERMES_PROPOSAL_ACCEPTED | DETERMINISTIC_NORMALIZATION`. |
| `source_message_ref` | Optional safe Mattermost team/channel/post ref; content is not copied. |
| `validation_result` | Exact deterministic rule/schema version, blockers and input hash. |
| `action_provenance_ref` | Exact `DRAFT_REVISE` provenance for this revision. |
| `created_by`, `created_at`, `correlation_id`, `causation_id` | Provenance. |

Constraints:

- `UNIQUE(workspace_id, project_id, draft_id, revision)` and `UNIQUE(draft_id, content_hash)`;
- revision and previous pointer are contiguous;
- append-only trigger rejects update/delete;
- header current pointer and new revision commit atomically;
- `VALID` requires canonical `{schemaVersion, title, requestKind, requestedClassificationKey}`; confirmation separately revalidates the exact pinned full `urn:awp:schemas:qa:intake:v1` schema and current business-readiness rules;
- a model proposal is not a revision until an authorized human accepts the structured delta or an explicitly permitted deterministic normalization applies.

### 4.3. `intake_draft_confirmations`

Exact explicit submit intent.

| Column | Rule |
|---|---|
| `id`, scope, `draft_id`, `draft_revision_id`, `draft_content_hash` | Exact immutable Draft subject. |
| `candidate_id` | Nullable exact origin Candidate; null for direct Mattermost/web intake. |
| `requester_principal_id`, `actor_kind` | Verified HUMAN; service/model rejected. |
| `summary_schema_ref`, `summary_manifest`, `summary_hash` | Closed immutable confirmation-card snapshot and hash. It pins the Project/requester/classification, environment, source refs, Work Type and exact Jira target/configuration labels shown to the HUMAN. |
| `request_hash` | Canonical hash of the full confirmation request, including summary and exact configuration pins. |
| `aggregate_snapshot_hash`, `expected_draft_row_version` | Current-state guard. |
| `project_integration_binding_ref` | Exact published Project Binding version. |
| `jira_profile_ref`, `jira_mapping_ref`, `jira_connection_ref` | Exact Feature 003 authority chain. |
| `idempotency_key` | Stable explicit request key. |
| `connector_command_id` | Exact `request.create` command after queueing. |
| `action_provenance_ref` | Exact `DRAFT_CONFIRM` provenance. |
| `state` | `RECORDED | COMMAND_PENDING | LINKED | INVALIDATED | FAILED_FINAL`. |
| `expires_at`, `recorded_at`, `invalidated_at` | Lifecycle timestamps. |
| correlation/causation and authorization basis | Required audit chain. |

Constraints:

- one active confirmation per Draft revision;
- `UNIQUE(workspace_id, project_id, idempotency_key)` with same-key/different-hash conflict;
- effect identity derives from confirmation ID + draft hash + exact configuration pins;
- revalidation occurs before command creation and again at Connector effect time through Feature 003;
- Work Item and Jira binding appear only in the existing authoritative confirmation transaction.

## 5. External interaction security

### 5.1. `external_interaction_receipts`

Durable transport/replay ledger for project-scoped callbacks only. The public static bootstrap is not receipted.

| Column | Rule |
|---|---|
| `id`, `workspace_id`, `project_id` | Required hard scope resolved by the exact project Connection route. |
| `connection_id`, `connection_version`, `connection_digest`, `ingress_contract_ref`, nullable `auth_secret_version_ref` | Exact project Connection, `ConnectorIngressContract@1.0.0` and optional project gateway key version. No secret value. |
| `profile_ref` | Required exact project Profile pinned by the InteractionIntent/configuration. |
| `transport_kind` | `DIALOG_SUBMISSION | POST_ACTION`, matching `ConnectorIngressContract`. |
| `external_delivery_id` | Nullable provider/gateway delivery identity; never trusted alone. |
| `delivery_identity_mode`, `transport_attempt_key` | `PROVIDER_DELIVERY_ID | EXACT_BODY_FINGERPRINT`; stable receipt key from the exact project Connection-bound contract. |
| `body_hash` | SHA-256 of exact received body before parsing; raw body is not retained. |
| `auth_mode`, `auth_result`, `auth_evidence_hash` | No token value. |
| `external_user_id`, `team_id`, `channel_id`, `post_id` | Opaque safe callback routing identifiers matched to the exact intent. |
| `normalized_schema_ref`, `normalized_envelope` | Bounded schema-valid Draft/action input plus resolved InteractionIntent ref. Never a raw body/transcript/token. |
| `received_at`, `replay_deadline`, `retain_until` | Acceptance and retention; `retain_until` is at least retry horizon plus allowed clock skew. |
| `state` | `ACCEPTED | PROCESSING | DUPLICATE | DENIED | PROCESSED | FAILED`. |
| `lease_owner`, `lease_expires_at`, `fencing_token`, `attempt` | Recoverable inbox worker claim; nullable before processing. |
| `result_ref`, correlation/causation | Stable replay response and trace. |

For `PROVIDER_DELIVERY_ID`, `UNIQUE(connection_id, transport_kind, external_delivery_id)` claims one provider delivery identity across immutable revisions of the same project Connection: same ID/hash returns the prior acknowledgement and same ID/different hash is quarantined. For `EXACT_BODY_FINGERPRINT`, `transport_attempt_key` is derived from stable project Connection ID + transport kind + body hash, so an altered attempt receives a distinct receipt and the separate InteractionIntent CAS remains the semantic replay boundary. The InteractionIntent token is never the transport delivery ID. The exact project Connection-bound ingress contract selects the mode and its Profile cannot reinterpret receipt identity.

The receipt is itself a project-scoped durable leased inbox. Authentication, intent resolution and bounded schema normalization finish before receipt commit; raw bytes are discarded. Normal project-scoped audit/events use the existing outbox, and the normalized receipt envelope is cleared according to retention while hashes/status/result remain. The static bootstrap returns deterministic content without entering this table.

### 5.2. `interaction_intents`

Project-scoped, exact, single-use server-side intents addressed by an opaque high-entropy token. They are not Approval records, and callback payload fields are never authority.

| Column | Rule |
|---|---|
| `id`, scope | Project required. |
| `action_kind` | Closed set: `PROJECT_SELECT | CANDIDATE_CREATE | CANDIDATE_SNOOZE | CANDIDATE_IGNORE | DRAFT_REVISION_SUBMIT | DRAFT_CONFIRM | OPEN_WEB`. |
| `action_parameters` | Closed action-specific data: Candidate/source expected versions; for snooze and Draft form submission the canonical `{id, version, digest}` input-schema ref plus rendered form hash; Draft header CAS version; and, for confirmation, the immutable summary hash. User-entered dialog values remain in the bounded normalized receipt/provenance request and are never pre-authorized by the intent. |
| `subject_kind`, `subject_id`, `subject_version`, `subject_content_hash` | Exact target snapshot. |
| `aggregate_snapshot_hash` | Action-specific current-state guard. |
| `external_user_id`, `principal_id` | Exact verified external/canonical HUMAN binding. |
| transport binding | Closed union: `WEB` pins OIDC-session hash and bootstrap-continuation ref for `PROJECT_SELECT`; `MATTERMOST` pins one logical presentation target: exact project team/channel, canonical principal DM, or `sourceInteractionIntentId` whose immutable delivery result routes an interaction response. A new DM need not invent a provider channel ID before delivery. |
| `binding_ref`, `profile_ref`, `connection_ref` | Exact project/messaging configuration pins. |
| `initial_authorization_basis_hash` | Full policy basis used when issuing the intent; current authorization is checked again on consumption. |
| `nonce_hash` | Hash of the only client-visible opaque token; plaintext is absent from this row, command payloads, logs and audit. |
| `token_handling` | Closed union: `RETURN_ONCE` for `WEB PROJECT_SELECT`; `SEALED_PRESENTATION` for every Mattermost action, with only safe capsule/codec/key-version/ciphertext commitments, NotificationIntent/command/slot refs, capability/effect-key hash, target/payload/render hashes and retention deadline serialized. |
| `state` | `PENDING | CLAIMED | CONSUMED | EXPIRED | INVALIDATED`. |
| `expires_at`, `claimed_at`, `consumed_at`, `invalidated_at`, `result_ref`, `result_hash` | CAS/replay result; consumed intents pin the exact safe result projection. |
| `created_at`, `correlation_id`, `causation_id` | Issuance and trace provenance; no plaintext token. |

Issuing an OIDC project-option set atomically invalidates every prior PENDING `WEB PROJECT_SELECT` intent for the same canonical principal, OIDC-session hash and bootstrap-continuation version, then inserts one fresh `RETURN_ONCE` intent per currently authorized Project. Raw option tokens are returned once and never persisted; an ambiguous/retried issuance replaces the old set instead of trying to reconstruct plaintext tokens.

State transitions:

```text
PENDING → CLAIMED → CONSUMED
PENDING | CLAIMED → EXPIRED | INVALIDATED
```

Wrong-actor/team/channel attempts are rate-limited and audited but do not claim or consume the intent. If the expected actor has lost binding, authorization or exact subject freshness, the intent becomes terminally `INVALIDATED`. Concurrent valid claims use row locking/CAS in the same transaction as the domain mutation. A duplicate callback for `CONSUMED` returns the same safe result; it never repeats the mutation. `DRAFT_CONFIRM` is an explicit exact-revision request submit, not an Approval for Jira-owned changes. Approval decisions, final verdicts and high-risk actions remain web-only.

`subject_kind` is an action-specific closed union: `PROJECT_SELECTION` pins the entitled Project and authorization snapshot and is valid only with `WEB` transport; `CANDIDATE` pins Candidate/source-observation versions; `DRAFT_REVISION` pins exact Draft revision/content; `WEB_ROUTE` pins an allowlisted navigation target. Every non-selection action uses `MATTERMOST` transport. `UNIQUE(nonce_hash)` prevents token aliasing across intents. A composed validator additionally requires a DM target principal to equal the actor and every presented action to match the immutable target/delivery result of its parent NotificationIntent.

### 5.3. `interaction_presentation_secrets`

Recoverable secret storage exists only for an outbound Mattermost action that has not yet reached a provable presentation outcome. It is not an alternative intent authority and is never exposed through a public/domain API.

| Column | Rule |
|---|---|
| `capsule_id`, `intent_id`, scope | Opaque local primary key and same-scope foreign key to one `MATTERMOST` InteractionIntent; `WEB PROJECT_SELECT` cannot have a capsule. |
| `format`, `algorithm`, `nonce`, `auth_tag`, `sealed_token_ciphertext`, `ciphertext_hash` | Fixed `AWP_INTERACTION_TOKEN_AEAD_V1`, `AES_256_GCM`, unique random 12-byte nonce per key version, 16-byte tag and ciphertext. Plaintext is the exact non-normalized UTF-8 token bytes; `ciphertext_hash` hashes ciphertext only. `SEALED` requires material; `ERASED` nulls nonce/tag/ciphertext and retains only the tombstone/hash. Plaintext is never persisted. |
| `encryption_key_version_ref` | Immutable `{keyId, version, purpose=INTERACTION_PRESENTATION_AEAD, workspaceId, projectId, environmentClass, keyIdentityFingerprint, metadataHash, decryptUntil}`. It must resolve to this scope/environment, remain decryptable through `retain_until`, and be distinct from every bot/gateway or foreign-Project key identity. |
| `aad_schema_ref`, `aad_canonicalization`, `aad_hash` | Exact `InteractionPresentationAadV1` registry digest, serialized with RFC 8785 JCS then UTF-8 without BOM/newline. The closed DTO contains immutable intent identity/scope/action/parameters/actor/subject/transport/configuration/authorization, `nonce_hash`, expiry/correlation plus capsule ID, exact key version, NotificationIntent/slot/command/capability, effect/target/payload/render commitments and `retain_until`; mutable state/result and ciphertext outputs are excluded. `aad_hash` hashes the canonical bytes. After decrypt, `SHA-256(exact UTF-8 plaintext token bytes) == nonce_hash` is mandatory; this hash is not the AEAD nonce. |
| `presentation_notification_intent_id`, `presentation_slot`, `presentation_command_id` | Same-scope refs; slots are unique and ordered `0..N-1` for the one command's bounded action set. |
| `state` | `SEALED | ERASED`; erase is monotonic in the same PostgreSQL UoW as the corresponding terminal transition. |
| `retain_until`, timestamps | `retain_until <= interaction_intent.expires_at <= key.decryptUntil` and covers only the permitted retry/lookup horizon. |

One projection UoW creates one actionable NotificationIntent in `QUEUED`, one Connector command/outbox row and 1–8 same-scope InteractionIntents/capsules. A Core-owned materializer unwraps only while the intent is `PENDING`, `now < retain_until <= expires_at`, the capsule is `SEALED`, every commitment matches, and the fenced command has no `effectInvocationStartedAt` (or a future contract has durably proven `NOT_APPLIED`). It returns a one-shot non-serializable `SensitiveValue` lease; the Mattermost Connector builds the DTO, with log/trace/body capture disabled and only best-effort clearing of mutable buffers.

The golden vector in `contracts/examples/interaction-presentation-aead.vector.v1.json` is a required cross-runtime conformance test: implementations recompute the schema digest, JCS bytes, `aad_hash`, token hash, ciphertext, tag and decrypt result exactly. It is test-only public material, not a production key or token.

The worker builds and hashes provider bytes, then durably writes `effectInvocationStartedAt` before network I/O. A crash before that marker may reconstruct the same bytes. Once marked, a resend is forbidden. Pinned pending-post/effect-marker modes record their typed ref and move to `LOOKUP_REQUIRED`; `NONE_AMBIGUOUS` moves directly to `AMBIGUOUS`. Exact lookup yields `DELIVERED` for one match and terminal `AMBIGUOUS` for unsupported/zero/multiple matches in V1. `DELIVERED`, `AMBIGUOUS`, other terminal command failure, callback `CONSUMED`, intent `INVALIDATED`, and explicit expiry erase all affected capsules in the same UoW. An unwrap-time expiry guard plus bounded sweeper closes wall-clock-only expiry. Active-store ciphertext/WAL/backup retention is bounded by policy and the key decrypt horizon; the plan does not claim cryptographic zeroization under a shared project key. Re-presentation creates a new action set and invalidates the old intents.

## 6. Agent Runtime

### 6.1. Static `AgentDefinition` and `SkillDefinition`

Registered immutable artifacts, not mutable database-owned behavior.

`AgentDefinition` pins:

- `hermes-qa-coordinator@1.0.0` identity and content hash;
- supported skill refs;
- maximum classification;
- default policy/prompt catalog refs;
- allowed model-provider kinds;
- no-memory and production-deny declarations.

Each `SkillDefinition` pins input/output JSON Schemas, deterministic fallback, allowed tool requirements, effect classification, timeout/budget, staleness inputs and acceptance/eval catalog. V1 keys are:

```text
qa-intake-assist
qa-intake-readiness
qa-work-item-readiness
qa-triage
qa-session-plan
qa-result-review-prep
qa-defect-draft
qa-dod-check
qa-notify
```

### 6.2. `agent_runs`

| Column | Rule |
|---|---|
| `id`, scope | Exact Workspace and Project. |
| `subject_kind`, `draft_id`, `candidate_id`, `work_item_id`, `subject_version`, `subject_content_hash` | Closed exact `DRAFT | CANDIDATE | WORK_ITEM` snapshot; exactly one same-scope subject ID is populated. Draft version is the immutable revision, Candidate version is `sourceObservationVersion`, and Work Item version is `resourceVersion`. |
| `initiator_principal_id`, `initiator_kind` | Verified `HUMAN` in Feature 004; deterministic service events create notifications/candidates without starting an Agent Run. Never used as a model credential. |
| `service_principal_id` | Exact canonical Hermes `SERVICE` identity; never substituted with the initiator. |
| `agent_definition_ref`, `skill_ref`, `rules_ref`, `policy_ref`, `prompt_template_ref` | Exact immutable refs/hashes. |
| `model_ref` | Nullable; absent in deterministic mode. |
| `input_fingerprint`, `prompt_manifest_ref` | Canonical approved fact manifest, not a raw prompt/transcript. |
| `classification_key`, `classification_decision_hash` | Effective data boundary. |
| `grant_set_hash` | Exact immutable child-set hash. |
| `state` | Lifecycle below. |
| `fallback_reason_code` | Nullable closed failure/degradation reason. |
| `output_schema_ref`, `output_hash`, `result_ref` | Schema-valid result/proposal only. |
| `action_provenance_ref` | Exact immutable provenance for Run creation and its initiating request. |
| `attempt`, `row_version`, timestamps, correlation/causation | Retry and audit. |

Lifecycle:

```text
CREATED → VALIDATING_INPUT → PLANNING → EXECUTING
EXECUTING → WAITING_FOR_APPROVAL → EXECUTING
EXECUTING → COMPLETED
Any non-terminal → RETRY_SCHEDULED | FAILED | CANCELLED
RETRY_SCHEDULED → VALIDATING_INPUT
```

Feature 004 does not route web-only high-risk Approval decisions through Mattermost, but the provider-neutral runtime retains `WAITING_FOR_APPROVAL` for an existing exact web Approval workflow.

Idempotency uniqueness uses scope + the full subject kind/ID/version/content-hash snapshot + skill ref + caller request key and deliberately excludes the input fingerprint. The first Run stores the canonical request/input fingerprint; the same key with a different fingerprint or subject snapshot is a conflict rather than a second Run.

### 6.3. `agent_run_tool_grants`

Immutable child set:

- `run_id`, ordered `sequence`;
- `tool_key`, `tool_version`, `operation`;
- exact scope and subject;
- `effect_class` (`READ_ONLY | PROPOSAL | DRAFT_MUTATION | NOTIFICATION_INTENT | APPROVAL_REQUIRED | FORBIDDEN`);
- classification ceiling;
- input/output schema hashes;
- exact Binding/Profile refs where a Connector-backed read is allowed;
- issued/expires timestamps;
- separate `service_authorization_basis_hash` and `initiating_human_authorization_basis_hash` proving the intersection used to derive the grant.

No row contains a user token, Connector credential, synthetic human role or broad wildcard Project. The ordered set hash must match `agent_runs.grant_set_hash`. At invocation time Tool Gateway recomputes current service and initiating-human authorization and intersects both with the stored upper bound, skill allowlist, current Project/Profile binding and classification ceiling.

### 6.4. Typed `PromptManifest`

The manifest is a schema-bound value addressed by `prompt_manifest_ref`; persistence retains exact refs, hashes and approved sanitized facts, never a rendered prompt or completion:

- exact Workspace, Project, subject kind/id/revision/content hash;
- agent, skill, rules, policy, prompt-template and optional model refs/hashes;
- ordered fact segments `{sourceKind, sourceRef, sourceVersion, sourceHash, classification, trust=UNTRUSTED, sanitizedValue, sanitizationRuleRef}`;
- maximum segment classification, classification decision hash and canonical `input_fingerprint`;
- closed tool-output schema ref with `additionalProperties:false` and size/count/range bounds.

System/policy/tool-grant fields are assembled outside model-controlled input. A sanitized derivative retains its source classification unless an explicit versioned classification rule produces and records a new derivative classification. Draft patches may modify only schema-declared QA content fields and require the exact expected Draft revision/content hash.

`agent_prompt_manifests` is an immutable child of one same-scope Run and stores `id`, schema ref/hash, subject snapshot, ordered fact source refs/versions/hashes/classifications/sanitization-rule refs, template/policy/skill/model refs, classification-decision hash, input fingerprint, provider-bound manifest hash and timestamps. The transient provider-bound `sanitizedValue` fields are assembled in memory and are not persisted; neither rendered prompt nor completion is stored. Retention clears any separately approved diagnostic derivative while preserving the provenance/hash ledger.

### 6.5. `agent_run_steps`

Append-only execution trace:

- ordered step number and kind (`INPUT_VALIDATION | DETERMINISTIC_RULE | MODEL_PROPOSAL | TOOL_GATEWAY | FALLBACK | OUTPUT_VALIDATION`);
- status, started/completed timestamps;
- safe input/output hashes and schema refs;
- reason/error code, latency/budget counters;
- no raw prompt, credential, message body or foreign-project identifier.

### 6.6. `agent_tool_invocations`

| Column | Rule |
|---|---|
| run/step/scope/subject | Must equal parent Run. |
| `grant_sequence`, `tool_key/version/operation` | Must match one immutable grant. |
| `request_schema_ref`, `request_hash` | Validated typed request. |
| `target_ref`, `expected_state_hash` | Exact action-specific target. |
| `service_authorization_basis_hash`, `human_authorization_basis_hash` | Both recomputed at invocation. |
| `idempotency_key` | Required even for safe mutations/notification intent. |
| `state` | `PROPOSED | DENIED | QUEUED | EXECUTING | COMPLETED | FAILED`. |
| `result_schema_ref`, `result_hash`, `result_ref` | Safe result only. |
| `denial_reason_code`, timestamps | Auditable failure. |

Tool Gateway persists `DENIED` attempts too. A tool invocation cannot change the Run scope, grant, operation, Profile or classification.

## 7. QA TriageAssessment

### 7.1. `qa_triage_assessments`

Revisioned Pack-owned proposals. Semantic/fact/provenance fields of each revision are immutable; only the lifecycle projection may move by CAS from `CURRENT` to `STALE` or `SUPERSEDED`.

| Column | Rule |
|---|---|
| `id`, scope, `subject_kind`, `draft_id`, `candidate_id`, `work_item_id`, `revision` | Closed `DRAFT | CANDIDATE | WORK_ITEM` union; exactly one subject in the same scope. |
| `previous_assessment_ref` | Null for first revision; immutable chain thereafter. |
| `business_impact`, `urgency_sla`, `risk`, `effort_range`, `scope_breadth`, `environment_data_complexity`, `uncertainty`, `automation_availability` | Separate schema-bound dimensions; effort is `{ESTIMATE, lower, upper, unit}` or explicit `UNKNOWN`, with semantic `lower <= upper`; no hidden aggregate scalar. |
| `complexity_recommendation`, `priority_recommendation`, `queue_band_recommendation` | Structured non-authoritative proposals, each with a closed value and rationale plus zero-based refs into that revision's exact `facts`; never accepted Jira priority or Feature 006 queue order. |
| `facts` | Ordered safe fact refs with source/version/content hash and polarity. |
| `explanation`, `confidence` | Human-readable rationale and bounded numeric/enum confidence. |
| `input_fingerprint` | Hash of every fact that affects the output. |
| `rules_ref`, `skill_ref`, `policy_ref`, `agent_run_ref`, `model_ref` | Exact provenance; model nullable. |
| `action_provenance_ref` | Exact proposal-creation provenance. |
| `state` | `CURRENT | STALE | SUPERSEDED`. |
| `expires_at`, `stale_at`, `stale_reason_code`, timestamps | Lifecycle. |

Constraints:

- assessment cannot write Jira priority/due/assignee or future queue position;
- the composed validator rejects every recommendation fact index outside `0 <= fact_ref < facts.length`; a dangling evidence ref cannot be stored or displayed;
- changed/revoked fact or expired Profile/Binding marks `CURRENT → STALE` before response/use;
- a new revision changes the predecessor to `SUPERSEDED` atomically;
- Hermes/service may propose; any later accepted queue override belongs to human Feature 006 state.

### 7.2. `qa_session_plan_proposals`

Revisioned QA Pack proposals; they do not replace the accepted Required Session Plan owned by the existing QA lifecycle. Semantic/fact/provenance fields are immutable; lifecycle/acceptance fields advance by CAS with a separate audit event.

| Column | Rule |
|---|---|
| `id`, scope, `work_item_id`, `revision` | Same-scope accepted Work Item subject and ordered proposal revision. |
| `previous_proposal_ref` | Immutable chain; null only for revision 1. |
| `session_slices` | Schema-bound proposed modes, goals, environments and definition refs; no accepted Session IDs. |
| `facts`, `input_fingerprint` | Ordered source/version/hash facts and canonical fingerprint. |
| `explanation`, `confidence` | Bounded proposal rationale. |
| `rules_ref`, `skill_ref`, `policy_ref`, `agent_run_ref`, `model_ref` | Exact provenance. |
| `action_provenance_ref` | Exact proposal-creation provenance. |
| `state` | `CURRENT | STALE | SUPERSEDED | ACCEPTED`. |
| `accepted_plan_ref`, `accepted_by`, `accepted_at` | Populated only after a separate authorized QA Pack use case creates/revises the canonical Required Session Plan. |
| expiry/stale/timestamps | Deterministic freshness lifecycle. |

Source drift marks `CURRENT → STALE` before display or acceptance. Acceptance rechecks current Project permission, Work Item facts and expected proposal fingerprint; the Agent Run never mutates canonical Sessions directly.

## 8. Notification delivery

### 8.1. `notification_intents`

| Column | Rule |
|---|---|
| `id`, scope | Project-scoped canonical intent. |
| `source_event_ref`, `subject_ref` | Exact causation and resource. |
| `target_kind` | Closed logical target `PRINCIPAL_DM | PROJECT_CHANNEL | INTERACTION_RESPONSE`. |
| target details | Server-resolved principal; `purpose + REQUESTER | QA_PROJECT_MEMBERS | QA_LEADS`; or exact `source_interaction_intent_id` whose immutable delivery result supplies an existing route. New action IDs never double as routing IDs. Provider channel/team/post IDs resolved at delivery are retained only as safe attempt/result refs. |
| `delivery_kind`, capability | `MESSAGE → messaging.notify@1.0.0` or `INTERACTION_PRESENTATION → messaging.callback@1.0.0`; exactly one branch and one Connector command. |
| `action_interaction_intent_ids`, `action_set_hash` | Empty/absent for `MESSAGE`; ordered 1–8 same-scope, same-target, same-subject/config independently single-use actions for one interactive command/post. |
| `profile_ref`, `connection_ref`, `project_binding_ref` | Immutable configuration pins. |
| `template_ref`, `template_hash`, `variables`, `render_hash` | Allowlisted versioned template and canonical redacted values. |
| `classification_key`, `policy_decision_hash` | Must fit channel/audience ceiling. |
| `deduplication_key`, `expires_at` | Stable effect identity/bounded value. |
| `action_provenance_ref` | Exact `NOTIFICATION_CREATE` provenance. |
| `connector_command_id`, `external_post_id`, `reconciliation_ref` | Nullable delivery refs. Reconciliation is a closed `PENDING_POST_ID_LOOKUP {pendingPostId} | EFFECT_MARKER_LOOKUP {effectMarkerHash} | NONE_AMBIGUOUS {reasonCode=LOOKUP_UNSUPPORTED}` union matching the pinned Profile; the last branch transitions directly to `AMBIGUOUS`. A lookup ref must equal the immutable selector on the exact fenced command attempt that owns `effectInvocationStartedAt`: byte-for-byte pending ID or SHA-256 of its exact UTF-8 marker bytes. |
| `state` | `PENDING | QUEUED | LOOKUP_REQUIRED | DELIVERED | FAILED_RETRYABLE | FAILED_FINAL | AMBIGUOUS | EXPIRED`. An interactive presentation is created directly in `QUEUED` with its one command. |
| row version, timestamps, correlation/causation | CAS/audit. |

`deduplication_key` is the canonical hash of `source_event_ref + template_ref + target_ref + delivery_kind + action_set_hash?`; `UNIQUE(workspace_id, project_id, deduplication_key)` prevents semantic duplicates. The exact bounded Connector effect-idempotency-key string derives from `notification_intent_id + render_hash + action_set_hash?`; `NotificationIntent.effectKey` and every capsule `presentationEffectKeyHash` store its SHA-256 commitment, not the raw string. The source Jira/QA mutation commits its event independently; an idempotent projection UoW creates either one plain NotificationIntent for later `messaging.notify`, or one actionable NotificationIntent plus all action intents/capsules and exactly one `messaging.callback` command/outbox row. A policy denial creates an audited denial record and no NotificationIntent or Connector command. `FAILED_FINAL` is therefore command-backed and compatible with the failed-event contract; a pre-command expiry may remain commandless.

### 8.2. `notification_delivery_attempts`

Append-only normalized attempt audit tied to the existing `connector_commands`/`command_outbox` attempt and fencing state; it is not a second outbox or retry authority:

- intent and Connector command/effect IDs;
- attempt/fencing token;
- command target/payload/render hashes, request marker/pending-post ID and exact provider request hash;
- materialized timestamp, durable `effect_invocation_started_at`, completed timestamps;
- normalized V1 result `LOOKUP_REQUIRED | DELIVERED | RETRYABLE | AUTH_BLOCKED | RATE_LIMITED | AMBIGUOUS | FAILED_FINAL`; `RETRYABLE`/`RATE_LIMITED` authorize another write only when no invocation marker exists;
- safe Mattermost status/request/post refs and `retry_after`;
- Profile/Connection refs, adapter version and current service-authorization basis hash.

Before `effect_invocation_started_at`, local validation, materialization or scheduler-throttling failure may safely retry because no network write has begun. The marker is committed before the first possible write. In V1 every `429`, `5xx`, timeout or connection loss observed after that marker invokes the pinned reconciliation mode; neither the status nor `Retry-After` proves non-application and no POST repeats. Pending-post/effect-marker modes enter `LOOKUP_REQUIRED`, while `NONE_AMBIGUOUS` ends directly. Exact lookup returns `DELIVERED` for one match. Unsupported, zero or multiple matches are terminal `AMBIGUOUS`, erase presentation capsules and never blind resend. Only a future versioned provider contract may add a durable `NOT_APPLIED` result and define a bounded same-command retry.

The reconciliation transaction joins `notification_intent.connector_command_id` to that exact attempt/fence and compares the stored selector before any provider query. A pending ID must match byte-for-byte; an effect marker is hashed from the attempt's exact UTF-8 marker bytes and must equal `reconciliation_ref.effectMarkerHash`. A selector from another command/attempt, or any mismatch after command supersession, is rejected and audited rather than queried.

Every terminal auth/channel/schema/policy delivery failure updates the existing mutable Core `connection_health` projection for the exact Connection to `DEGRADED` or `UNAVAILABLE` with a closed Mattermost reason code and check time; immutable Connection/Profile content is unchanged. A successful explicit validation/recovery probe may return it to `HEALTHY`. Project integration queries combine this Connection health with the exact Profile/Binding validation state so FR-025 is visible without adding a competing Mattermost health authority.

## 9. Mattermost Profile content

Stored as immutable `connector_profiles.content` validated by `mattermost-profile.v1`:

- exact `workspaceId + projectId`; one Profile cannot span Projects;
- adapter family/version and exact supported Mattermost server/API family;
- `teamId`, bot user ID, non-secret credential-identity fingerprint and bot membership evidence hash;
- channel bindings `{channelId, channelKind, purpose, audience, classificationCeiling}`, all belonging to the Profile's one Project;
- DM policy for already selected/authorized project interactions; project selection itself is owned by the OIDC web flow, not a Project Profile;
- exact compatible dialog/post-action ingress-contract refs, which pin project callback authentication and replay semantics outside outbound Profile content;
- allowed template refs/hashes and variables schemas;
- notification audience/mention/expiry/retry/rate policy; quiet-hour and digest scheduling are deferred from V1;
- callback replay window/delivery identity rules;
- outbound reconciliation mode and validated pending-post behavior;
- production-deny and environment class.

The published Connector manifest also pins a versioned `ConnectorIngressContract` for each accepted dialog/post-action route: exact content type and size limit, authentication dialect, freshness/retry horizon, delivery-identity extractor, normalizer schema and Profile compatibility range. These ingress declarations are separate from Broker effect `READ | WRITE` operations; `messaging.notify` remains an outbound `WRITE` capability. The public bootstrap is a separate stateless adapter and is not referenced by a Project Profile.

Secret values are never part of Profile content. There is no pre-project Connector Connection. After OIDC project selection, the Binding resolves a project-scoped Connection/Profile whose bot and optional callback-gateway credential authority does not exceed that Project/environment. Connection content contains only secret references and authority/network metadata.

When callbacks are enabled, the composed pilot/runtime package also pins immutable Core-owned project/environment presentation-token envelope-key metadata: exact key ID/version, purpose, scope, environment, identity fingerprint, metadata hash and decrypt horizon. It is not a bot/gateway credential and is absent from the Profile and Connector command; each Mattermost InteractionIntent records the exact key-version/capsule commitments needed for bounded recovery.

Publication validates the fixed bootstrap/evidence refs and that the Mattermost bot user, credential-identity fingerprint and Connection are not reused across Projects or environment classes. It also rejects a presentation-key fingerprint that aliases any bot/gateway key, appears in another Project/environment, or expires before the maximum capsule horizon. The resolved Profile mode must be supported by matching server evidence (`PENDING_POST_ID_LOOKUP → pendingPostIdLookupSupported`, `EFFECT_MARKER_LOOKUP → effectMarkerLookupSupported`); `NONE_AMBIGUOUS` deliberately requires neither. Callback-enabled pilot metadata pins a versioned retention policy and validation evidence plus numeric `max_capsule_lifetime`, expiry sweep/purge SLA, terminal purge SLA `0` (same UoW), WAL/backup maxima and key-disable SLA. The composed validator proves every `retain_until - created_at` fits the lifetime, sweep interval fits the purge SLA, runtime/storage settings do not exceed declared maxima and key access ends within the declared horizon. Within one Profile, `(teamId, channelId, purpose)` is unique; across active Profiles, `(teamId, channelId)` may belong to only one Project, and aliases cannot bypass either constraint. `baseBackoffMs <= maxBackoffMs` and every transitive metadata digest/scope/role match are semantic publication checks. Retired immutable pins remain readable only for bounded recovery. The Mattermost bot is an external Connector service identity and credential; it is distinct from the canonical Platform Hermes `SERVICE` principal and never receives Hermes Tool Grants. A repeated opaque secret reference with a different alias is detected through the secret manager's non-secret credential-identity fingerprint.

## 10. Cross-aggregate transactions and ordering

### 10.1. OIDC Project selection → direct Draft

One transaction:

1. claim exact `WEB PROJECT_SELECT` InteractionIntent and match its OIDC-session hash;
2. reauthorize canonical principal, verified Mattermost binding and pinned Project/configuration;
3. create/replay direct Draft header + revision 1 containing the canonical partial `{schemaVersion: 1}` under a request key;
4. consume the intent with a stable result ref;
5. enqueue project-scoped audit/event and optional DM NotificationIntent.

No Agent Run begins before this commits.

### 10.2. Candidate decision → Draft

One transaction claims the exact Candidate InteractionIntent, reauthorizes the HUMAN actor, verifies expected Candidate/source-observation versions, appends one `CREATE` decision, creates/replays the origin-linked Draft and revision 1, moves the Candidate to `CONVERTED`, consumes the intent with the stable result ref, erases the consumed capsule and every invalidated sibling capsule, and emits audit/event records. `SNOOZE` and `IGNORE` append the closed decision without creating a Draft, Work Item or Jira command and erase their consumed/invalidated capsules in that same UoW.

### 10.3. Draft revision

For a Mattermost-originated edit, one transaction first claims the exact `DRAFT_REVISION_SUBMIT` InteractionIntent, then locks the Draft header, verifies actor/current authorization and expected row/revision/content hash, appends the revision, updates the current pointer/state, marks earlier active recommendation/assessment stale, invalidates other intents for the old subject, consumes the claimed intent with the stable result ref, erases capsules for the consumed/invalidated intents, and emits an event. The web path performs the same mutation/CAS without an InteractionIntent.

### 10.4. Draft confirmation

For Mattermost, one transaction claims the exact `DRAFT_CONFIRM` InteractionIntent, reauthorizes the HUMAN and exact summary/configuration pins, records/replays the exact confirmation, claims idempotency, invalidates old callbacks, creates or resolves the same Feature 003 Jira command, links `connector_command_id`, consumes the intent with the stable result ref, erases capsules for the consumed/invalidated intents, and writes audit/outbox. The web path enters the same confirmation use case without an InteractionIntent. Jira effect and final Work Item materialization remain asynchronous and use the already verified Feature 003 confirmation UoW.

### 10.5. Mattermost action presentation

An idempotent source-event projection transaction creates one actionable NotificationIntent in `QUEUED`, one `messaging.callback` Connector command/outbox row, and an ordered set of 1–8 exact `MATTERMOST` InteractionIntents plus one capsule per action. Candidate `CREATE | SNOOZE | IGNORE` is therefore one provider post/effect with three independently consumable intents. The command has distinct `target { ...sourceInteractionIntentId? }` routing and `presentation.actionInteractionIntentIds`; it carries only refs and immutable target/payload/render/effect commitments, never token/ciphertext. Every capsule AAD pins the shared command plus its unique slot/action.

The Connector obtains one-shot sensitive leases, renders the exact bytes and hashes them before the worker commits `effectInvocationStartedAt`. A crash before that marker may rebuild the same bytes. After the marker, only reconciliation is legal: exactly one match delivers, while V1 zero/multiple/unsupported becomes terminal `AMBIGUOUS`; no resend occurs. Delivery/ambiguity/terminal failure and callback consumption/invalidation erase relevant capsules transactionally. Wall-clock expiry is denied at unwrap and closed by a bounded sweeper.

### 10.6. Notification

The source Jira/QA transaction commits only canonical state plus its event/outbox, so Mattermost failure cannot roll it back or rewrite it. The notification projection produces exactly one delivery branch. A non-actionable message creates/replays one `MESSAGE` NotificationIntent and later one `messaging.notify` command. An actionable presentation uses §10.5 and creates exactly one `INTERACTION_PRESENTATION` NotificationIntent plus one `messaging.callback` command; it never also creates `messaging.notify`. `INTERACTION_RESPONSE.sourceInteractionIntentId` is only the route to an existing result, while `delivery.actionInteractionIntentIds` are the new actions.

## 11. Deletion, retention, and redaction

- Candidate/Draft/Agent/Tool/Triage/Notification/audit histories are soft-retained according to classification policy; immutable audit and hashes are not hard-deleted by application paths.
- Message text and raw request bodies are not retained in interaction receipts. Normalized Draft content remains under Platform retention because it is canonical user input.
- Safe external post/channel IDs may remain for audit; bot tokens, slash tokens, OAuth tokens, plaintext callback nonces, cookies, raw prompts and full channel history may not. A callback token may exist durably only as the bounded project-scoped AEAD capsule in §5.3. Terminal UoWs purge recoverable material from the active store; WAL/replica/backup retention and key decrypt horizons are bounded and tested, without claiming guaranteed memory or cryptographic zeroization under a shared key.
- Expired InteractionIntents retain hashes/status/result ref but not reusable token material.
- The static bootstrap writes no receipt or audit. Rejected project callbacks may write only a SERVICE-attributed record under the resolved Connection in the existing generic project security-audit facility, outside `ActionProvenance` and domain `EventEnvelope`; after exact external-principal resolution, domain audit is attributed to the canonical HUMAN. Neither path logs raw external user/body/token/prompt values.
- A data-correction request creates an append-only revision/tombstone policy action rather than rewriting signed history.

## 12. Required persistence invariants

1. Every Candidate/Draft revision/Agent Run/TriageAssessment/Notification belongs to one Workspace and Project.
2. A user cannot choose, infer or enumerate a Project outside current membership, entitlement, role permission and classification decision.
3. Direct Draft creation and Candidate conversion never create a Jira issue or Work Item by themselves.
4. One Draft revision and idempotency key can produce at most one operational create command/effect identity.
5. Bootstrap retry is stateless/deterministic; callback replay and InteractionIntent consumption are separate CAS mechanisms, and either callback replay returns the original safe result without a second mutation.
6. Every actionable NotificationIntent maps to one `callback.present` command with 1–8 same-scope actions/capsules; it never creates a second notify effect, and routing source IDs remain distinct from newly presented action IDs.
7. Provider bytes may be reconstructed only before durable `effectInvocationStartedAt`; after it, the pinned Profile reconciliation branch is mandatory. Lookup-capable modes use only the exact selector bound to that fenced attempt, `NONE_AMBIGUOUS` ends directly, and V1 never resends an uncertain result.
8. Plaintext tokens are absent from storage/commands/logs; terminal intent/command transitions purge capsules in the same UoW, and expiry is fail-closed plus swept.
9. Agent Run grants cannot change after execution begins and contain no credential.
10. Model output is never the accepted Jira value, QA verdict, entitlement, or release decision.
11. Triage facts changing makes the recommendation stale before application.
12. Notification intent survives API/worker/Mattermost outage independently of Jira/QA state.
13. No required local flow depends on corporate Mattermost/model credentials or production connectivity.
