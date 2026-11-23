# Data Model: GitLab automated validation

**Feature:** `005-gitlab-automated-validation`

**Contract baseline:** published Feature 002 MANUAL contracts `1.0.0` remain
unchanged; additive `qa.validation@1.2.0`; AUTOMATED storage representation
`contract_schema_version=2`; distinct QA/GitLab wire schemas and capability
contracts `1.0.0`

**Persistence:** PostgreSQL 17/18, TypeORM migrations, `synchronize:false`

## 1. Normative boundary and ownership

This feature adds an `AUTOMATED` mode to the existing QA Session aggregate. It does not create a second Work Type, a second Finding taxonomy, or an automated verdict path.

| Fact or aggregate | Authority/owner | Stored platform representation |
|---|---|---|
| Repository, Merge Request, commit, build, pipeline/job actual state | GitLab | Connector-owned normalized observation/projection with exact external authority and revision tokens. |
| Artifact bytes and provider expiry | GitLab Artifacts in V1 | Core `ArtifactReference` plus Connector-owned opaque locator; QA stores exact memberships/checksums only. |
| Connection, Profile, Mapping, Project Integration Binding and validation report | Platform Core integration registry | Existing versioned configuration types in `packages/platform-core/src/integration-registry/model.ts`. |
| Connector command, outbox, effect gate, target lane, idempotency and generic reconciliation | Platform Core | Existing `ConnectorCommand`, `CommandGatewayUnitOfWork`, `TargetExecutionLane` and reconciliation primitives under `packages/platform-core/src/commanding/`. |
| Suite Binding, automated Session/Plan Item, launch claim, Attempt lineage, retry/quarantine policy result | QA Pack | Canonical project-scoped QA state described below. |
| Observation, human Plan Item Result, Finding, Evidence Manifest, Session Outcome and QA Verdict | QA Pack, HUMAN-decided where adjudicative | Existing Feature 002 aggregates extended to consume provider-neutral Attempt identity. |
| GitLab discovery, request/response dialect, webhook verification, trigger lookup and provider locator | GitLab Connector | Connector-specific tables in the `connector:gitlab` migration namespace. |
| Credentials | Vault/secret manager | Only secret reference/fingerprint and owner/rotation evidence; never a secret value. |
| Hermes review material | QA proposal contract when Feature 004 is installed | Non-authoritative proposal; never an Attempt result, Finding classification, Session Outcome or Verdict. |

Every QA product row and every accepted Connector observation carries `workspace_id` and `project_id`. Every Work Item/Session/Plan Item/Attempt relationship uses a same-scope composite FK or a deferred same-scope validation trigger. Connector tables never foreign-key into QA tables, and QA tables never foreign-key into Connector tables. Cross-owner communication uses typed commands/events and Core stable IDs.

### 1.1. Reused published types

The implementation extends rather than copies these existing types:

- `QaTestSessionState`, snapshots and session locks from `packages/competency-qa/src/domain/test-session.ts` and `snapshots.ts`;
- `QaRequiredSessionPlanRequirement` from `packages/competency-qa/src/domain/required-session-plan.ts`;
- `QaPlanItem` from `packages/competency-qa/src/domain/plan-item.ts`;
- `QaManualAttempt` and the shared technical outcome vocabulary from `packages/competency-qa/src/domain/manual-attempt.ts`;
- `QaPlanItemResultRevision`, `QaFlakyDispositionBasis` and exact membership hashes from `packages/competency-qa/src/domain/plan-item-result.ts`;
- `QaObservation`, `QaFinding`, `QaEvidenceManifestRevision` and `QaSessionReview` from the corresponding files under `packages/competency-qa/src/domain/`;
- Core `ConnectionRevision`, `ProfileRevision`, `BindingRevision`, `ValidationReport` and `VersionedReference` rather than GitLab-specific copies of configuration headers;
- Core `ArtifactReference`, command/outbox, webhook inbox, authorization and audit records rather than QA-owned transport tables.

Feature 002 V1 TypeScript types remain MANUAL-only. Feature 005 adds an
AUTOMATED storage representation marked `contract_schema_version=2` and new
AutomationAttempt types. On the wire, that representation uses first versions
of distinct automation-specific schema identities rather than widening or
renaming any published Feature 002 schema.

## 2. Shared storage conventions

### 2.1. Scope, identifiers and time

- Platform and QA identifiers are server-generated opaque UUID/text IDs. GitLab numeric IDs are opaque provider facts and never replace scoped platform identity.
- All timestamps are UTC `timestamptz` from an injected clock. Provider timestamps are facts, distinct from receive/observe times.
- Mutable headers use positive `resource_version` CAS and HTTP `ETag`; append-only revisions use positive contiguous versions.
- Schema digests are `sha256:` plus lowercase SHA-256 of the UTF-8 RFC
  8785/JCS serialization of the complete JSON Schema document.
- A schema-bound root `contentHash` follows the existing platform convention:
  first validate the complete instance against the exact registered schema
  ID/version/digest, clone it, omit only the clone's root `contentHash`, then
  compute the literal prefix `sha256:` plus
  `lowercase-hex(SHA-256(UTF-8(JCS(clone))))`. Nested hashes and all other
  properties remain. The schema identity is bound by the preceding registry
  validation and the instance `schemaVersion`; it is not an extra ad-hoc hash
  frame. Hashing occurs before persistence/publication, and a mismatched root
  hash fails closed.
- Configuration refs are exact `{id, version, contentHash}` where the owning contract exposes a hash. An unversioned alias or “current profile” is never persisted as execution provenance.
- Every JSON column is validated against a closed schema with `additionalProperties:false`; raw GitLab responses, logs, webhook bodies, secrets and arbitrary pipeline variables are forbidden in QA storage.

### 2.2. Environment and provider-neutral capabilities

Only Core environment classes `LOCAL | DEVELOPMENT | TEST` are eligible. `PRODUCTION`, deployment targets and ambiguous environment aliases fail before secret resolution or adapter invocation.

The exact capability set is:

| Capability | Logical role | Allowed operations |
|---|---|---|
| `source-context.read@1.0.0` | `SOURCE_CONTEXT` | `merge-request.read`, `commit.read`, `build.read` |
| `test-executor.trigger-status@1.0.0` | `TEST_EXECUTION` | `pipeline.trigger`, `pipeline.read`, `pipeline.lookup` |
| `artifact.ci-read@1.0.0` | `ARTIFACT_SOURCE` | `artifact.metadata`, `artifact.stream` |

No row or contract can name pipeline retry/cancel/delete, repository push, CI configuration mutation, CI secret read, deployment or production operations.

The three logical Profile roles may share one exact Core Connection revision.
Its schema-bound `connectorConfiguration`
`gitlab-connection-configuration@1.0.0` contains distinct read, trigger and
webhook `secretref://` references plus a closed operation-to-slot map:
`pipeline.trigger→TRIGGER`, source/status/lookup/artifact reads `→READ` and
webhook verification `→WEBHOOK`. The outer Core
`serviceIdentitySecretRef` must equal the read reference. Connector validation
rejects equal refs/fingerprints, invalid scopes or routing drift and pins the
Connection content hash in every Session configuration pin; no Core schema or
DDL change is required.

### 2.3. Derived capability and live availability

Feature 005 does not persist a second onboarding aggregate. `qaCapabilityMode` is a deterministic read projection:

```text
FULL_QA = at least one current PUBLISHED Suite Binding
          ∩ one compatible current PUBLISHED Project Integration Binding
          ∩ exactly resolvable Profile/Connection chains for all three roles
          ∩ exact non-production policy and successful matching validation evidence

MANUAL_ONLY = otherwise
```

Live `automationAvailability` is separate: `AVAILABLE | DEGRADED | UNAVAILABLE`. An outage can make launch unavailable without rewriting the configuration mode or historical Session pins. New automated Session/launch commands fail with a stable reason when unavailable; existing pending/reconciling Attempts remain visible. Manual QA and Jira flows do not consult this projection.

## 3. Existing QA aggregate expansion — migration 2050

### 3.1. `qa_required_session_plan_requirements`

Replace only the DB mode CHECK with `MANUAL | AUTOMATED` and add `contract_schema_version` (`1` for backfilled MANUAL, `2` for new discriminated rows).

For `AUTOMATED` requirements:

- `required_capabilities` contains the complete three-role automation group;
- `target_policy_ref`, `scope_policy_ref` and checklist refs remain the existing exact immutable references;
- `automation_suite_binding_key` and the permitted suite-selection policy are included in the automated row content hash;
- waiver and carry-forward rules remain unchanged; a requirement is not satisfied merely by another Session with a similar suite name.

Published old versions are never rewritten. A new automated requirement is introduced only by a new RequiredSessionPlan revision. Exact unchanged carry-forward continues to use the existing predecessor hash rule.

### 3.2. `qa_test_sessions`

Additive columns:

| Column | Rule |
|---|---|
| `contract_schema_version` | Backfill `1`; `MANUAL => 1`, `AUTOMATED => 2`. |
| `automation_suite_binding_id` | Nullable for MANUAL; required for AUTOMATED. |
| `automation_suite_binding_version` | Positive exact published version; required with ID. |
| `automation_suite_binding_content_hash` | Required exact semantic hash for AUTOMATED. |
| `automation_configuration_pin_set_hash` | Hash of the complete ordered rows in `qa_automation_session_configuration_pins`; required for AUTOMATED. |
| `automation_parameter_set_hash` | Hash of server-validated allowlisted parameter values embedded in TargetSnapshot; required for AUTOMATED. |

Existing columns continue to pin Work Item, RequiredSessionPlan version/requirement, owner, immutable Target/Scope snapshots, structure hash and parent Session. For the AUTOMATED representation, `target_snapshot` additionally contains exact build/commit/MR facts, environment ID+revision, at least one immutable versioned test-data or account-lease ref, suite version ref/hash, result/artifact/retry policy refs and the bounded accepted parameter values plus their canonical hash. It contains no arbitrary GitLab variables, raw job name, secret ref or client-selected Profile.

Constraints:

- mode-specific fields are all-null for MANUAL and all-present for AUTOMATED;
- referenced Suite version has the same Workspace/Project, is `PUBLISHED`, and its content hash matches;
- one V1 automated Session has exactly one Suite Binding and exactly one generated suite-root Plan Item;
- `automation_configuration_pin_set_hash` is recomputed and validated by a deferred trigger;
- target/environment/suite/profile change before start increments `structure_revision` and resets `READY→PLANNED`; after `started_at` it is forbidden and requires a linked Session;
- parent Session remains same Work Item/scope and acyclic; replacement reason is closed to `TARGET_CHANGED | REVIEW_FROZEN` and records the old target hash;
- existing monotonic state set is unchanged: `PLANNED | READY | RUNNING | REVIEW_REQUIRED | COMPLETED | BLOCKED | CANCELLED`.

### 3.3. `qa_automation_session_configuration_pins`

Normalized immutable execution-chain membership:

| Column | Rule |
|---|---|
| `pin_id`, scope, `work_item_id`, `session_id` | Stable same-scope identity. |
| `ordinal` | Canonical order, unique within Session. |
| `logical_role` | `SOURCE_CONTEXT | TEST_EXECUTION | ARTIFACT_SOURCE`. |
| `capability_key`, `exact_contract_version`, `operation_set_hash` | Exact contract and allowed operation subset. |
| `project_integration_binding_id/version/content_hash` | Same exact published Project Binding for the composed Session. |
| `profile_id/version/content_hash` | Exact resolved Profile for this role. |
| `connection_id/version/content_hash`, `mapping_ref` | Exact transitive configuration chain; mapping nullable only where the Profile contract permits it. |
| `external_scope_hash`, `validation_report_id/content_hash` | Exact validated project/environment/scope evidence. |
| `pin_content_hash`, `created_at` | Immutable canonical row hash and time. |

`UNIQUE(session_id, logical_role)` and `UNIQUE(session_id, ordinal)`. Exactly the three logical roles must exist for AUTOMATED; MANUAL has zero rows. The set and Session hash commit atomically. Configuration retirement later does not rewrite a Session, but a new launch/rerun rechecks that the pinned chain remains effect-authorized and not revoked.

### 3.4. `qa_plan_items`

Replace only the mode CHECK with `MANUAL | AUTOMATED` and add `contract_schema_version`. The mode must equal the owning Session mode. An AUTOMATED Plan Item:

- is generated from the exact Suite Binding definition, not arbitrary client text;
- has `ordinal=1` in V1 and is the only Plan Item in that Session;
- uses the existing `PLANNED | RUNNING | TERMINAL | WAIVED` lifecycle and human result pointer;
- keeps the existing Observation/Finding/result/evidence path; pipeline PASS never directly changes `latest_result_revision_id`.

### 3.5. `qa_attempt_identities`

Provider-neutral immutable parent for MANUAL and AUTOMATED execution facts:

| Column | Rule |
|---|---|
| `attempt_id`, scope, `work_item_id`, `session_id`, `plan_item_id` | Same-scope identity; child detail uses the same `attempt_id`. |
| `mode` | `MANUAL | AUTOMATED`; must equal Session and Plan Item mode. |
| `attempt_no` | Positive contiguous sequence per Plan Item. |
| `target_snapshot_hash`, `scope_snapshot_hash` | Exact locked Session snapshots. |
| `trigger_kind` | `HUMAN_MANUAL | HUMAN_LAUNCH | HUMAN_RERUN | AUTO_INFRA_RETRY`. |
| `initiator_kind`, `initiator_principal_id`, `authorization_basis_hash` | HUMAN for manual/explicit launch/rerun; canonical SERVICE plus causal HUMAN basis for automatic retry. |
| `correlation_id`, `causation_id`, `created_at` | Immutable provenance. |
| `identity_content_hash` | Canonical hash of all identity fields. |

Constraints:

- `PRIMARY KEY(attempt_id)` plus scoped composite unique keys;
- `UNIQUE(workspace_id, project_id, plan_item_id, attempt_no)`;
- exactly one child exists in `qa_manual_attempts` or `qa_automation_attempts`, selected by mode, enforced deferred;
- UPDATE/DELETE is rejected;
- insertion locks Session and Plan Item, derives `MAX(attempt_no)+1` server-side and never trusts a caller-supplied number.

Migration 2050 backfills one identity for every existing `qa_manual_attempts` row using the same `attempt_id`, exact scope/number/target hash and manual actor. `scope_snapshot_hash` is obtained from the same owning Session. Backfill count/hash checks must pass before new generic FKs are validated.

## 4. Suite Binding aggregate — migration 2050

### 4.1. `qa_automation_suite_bindings`

Stable project-scoped header:

| Column | Rule |
|---|---|
| `suite_binding_id`, `workspace_id`, `project_id`, `suite_key` | Stable identity; unique key in Project. |
| `current_published_version`, `current_published_version_id` | Nullable exact current pointer. |
| `resource_version` | Positive CAS token. |
| `created_by`, `created_at`, `updated_at` | HUMAN provenance. |

The header contains no mutable suite definition. Publishing a successor retires the old version for future selection without changing historical Sessions.

### 4.2. `qa_automation_suite_binding_versions`

| Column | Rule |
|---|---|
| `suite_binding_version_id`, scope, `suite_binding_id`, `version` | Positive contiguous version and same-scope header FK. |
| `state` | `DRAFT | VALIDATED | PUBLISHED | RETIRED`. |
| `owner_principal_id` | Required accountable HUMAN owner. |
| `suite_definition_ref`, `suite_definition_hash` | Immutable repository/path/commit definition or stored bounded snapshot. |
| `logical_pipeline_key`, `source_ref_policy_ref`, `result_job_key`, `logical_execution_contract_hash` | Provider-neutral pipeline/ref/result-job contract required by the Suite; resolved Profile supplies exact GitLab values. |
| `accepted_target_types` | Closed non-empty set from `MERGE_REQUEST | COMMIT | BUILD`. |
| `environment_policy_ref`, `allowed_parameter_schema_ref/digest` | Project-internal non-prod environments and closed allowed input vocabulary. |
| `result_schema_ref/digest`, `result_source_contract` | Exact machine result version, job/path and maximum size. |
| `artifact_policy_ref/content_hash` | Allowed kinds, classification, checksum and retention rules. |
| `retry_policy_ref/content_hash` | Exact infra-code allowlist and `maxAutomaticRetries=1`. |
| `quarantine_policy_ref/content_hash` | Expiry/owner/launch behavior. |
| `required_capability_set_hash` | Hash of the exact three-role capability set. |
| `validation_report_id`, `validation_report_content_hash` | Required exact successful report in VALIDATED/PUBLISHED. |
| `content`, `content_hash`, `created_by`, `created_at` | Closed schema-bound immutable definition. |

Constraints:

- `UNIQUE(suite_binding_id, version)` and `UNIQUE(suite_binding_id, content_hash)`;
- only DRAFT metadata/state may advance through the aggregate UoW; content change creates `version+1`;
- PUBLISHED/RETIRED content is append-only;
- publication requires exact VALID report for the same version/content hash, exact current Core Binding/Profile chain, and proof that project, ref, target and jobs are non-production/non-deploy;
- multiple Suites may be published for a Project, but a V1 Session pins exactly one version.

GitLab numeric project, exact trigger ref/job/artifact path and provider
variable mapping stay in the GitLab Profile. The Suite Binding contains the
provider-neutral logical pipeline/ref/result-job contract, suite semantics and
internal environment/parameter policy.

### 4.3. `qa_automation_suite_validation_reports`

Append-only composed validation evidence:

| Column | Rule |
|---|---|
| `report_id`, scope, `suite_binding_version_id`, `suite_content_hash` | Exact validation subject. |
| `status` | `VALID | INVALID`. |
| `core_binding_ref`, `profile_pin_set_hash` | Exact configuration evaluated. |
| `gitlab_discovery_snapshot_ref/hash`, `suite_probe_ref/hash` | Opaque Connector evidence refs, not Connector FKs. |
| `checks` | Exact ordered `PROJECT_SCOPE → IDENTITY_SEPARATION → LEAST_PRIVILEGE → SOURCE_REF_POLICY → CI_LINT_DRY_RUN → NON_PRODUCTION_TARGET → NO_DEPLOY_SURFACE → RESULT_SCHEMA → ARTIFACT_POLICY → RETRY_POLICY` results. |
| `issues` | Stable bounded codes/paths; no raw provider body. |
| `validated_by`, `authorization_basis_hash`, `created_at`, `content_hash` | HUMAN/service validation provenance. |

Reports never mutate. A Profile, Binding, suite content or discovery change makes an old report ineligible for a new publication; it does not rewrite past Sessions.

## 5. Automated execution — migration 2055

### 5.1. `qa_automation_launch_requests`

Actor-independent US-002 idempotency claim:

| Column | Rule |
|---|---|
| `launch_request_id`, scope, `work_item_id`, `session_id`, `plan_item_id` | Exact launch subject. |
| `request_key_hash` | Hash of bounded `Idempotency-Key`; raw key is not stored or logged. |
| `request_hash` | Canonical server-derived semantic request: Session/target/suite/config pins, trigger kind and accepted parameter hash. |
| `confirmation_hash`, `confirmed_session_resource_version`, `confirmed_at` | Exact server-issued launch summary echoed by a HUMAN launch/rerun; null only for policy-derived automatic retry. This is command confirmation, not a second approval. |
| `origin` | `HUMAN_LAUNCH | HUMAN_RERUN | AUTO_INFRA_RETRY`. |
| `decision` | `ACCEPTED | REJECTED`. |
| `attempt_id`, `connector_command_id`, `effect_idempotency_key` | All present iff ACCEPTED. |
| `rejection_reason_code` | Present iff REJECTED; bounded and non-disclosing. |
| `initiator_kind/id`, `authorization_basis_hash` | Exact initiating authority; automatic retry retains the causal HUMAN ref. |
| `correlation_id`, `causation_id`, `created_at`, `content_hash` | Immutable provenance. |

`UNIQUE(workspace_id, project_id, session_id, request_key_hash)`. A replay by any actor first reauthorizes the current caller, then returns the existing Attempt only when `request_hash` matches. A different hash is `IDEMPOTENCY_CONFLICT`. This claim supplements Core idempotency because the existing Core identity includes `actorId` in `packages/platform-core/src/commanding/idempotency.ts`.

An automatic retry uses deterministic key material derived from predecessor Attempt ID and pinned retry policy hash. A rejected request creates no Attempt, Connector command, outbox record or provider call.

### 5.2. `qa_automation_attempts`

Immutable automated child/header:

| Column | Rule |
|---|---|
| `attempt_id`, scope, `work_item_id`, `session_id`, `plan_item_id`, `attempt_no` | Same values as `qa_attempt_identities`; mode must be AUTOMATED. |
| `launch_request_id` | Unique accepted launch claim. |
| `predecessor_attempt_id` | Null only for first HUMAN launch; same Session/Plan Item for retry/rerun. |
| `lineage_kind` | `INITIAL | HUMAN_RERUN | AUTO_INFRA_RETRY`. |
| `suite_binding_id/version/content_hash` | Exact published Suite. |
| `configuration_pin_set_hash`, `target_snapshot_hash`, `scope_snapshot_hash`, `parameter_set_hash` | Must byte-match the Session pins/snapshots. |
| `result_schema_ref/digest`, `artifact_policy_ref/hash`, `retry_policy_ref/hash` | Exact immutable execution policies. |
| `connector_command_id`, `effect_idempotency_key` | Unique Core command/effect refs. |
| `current_status_revision_id`, `current_status_revision_no`, `resource_version` | Mutable CAS projection pointer only. |
| `created_at`, `identity_content_hash` | Immutable creation fact; hash excludes mutable head pointer. |

All columns except the current-status pointer and `resource_version` reject UPDATE; DELETE always rejects. Pointer advancement must be `n→n+1` and commit with the referenced revision. Provider pipeline/job IDs are observations, not mutable identity fields, so they live in status/result rows.

The wire `automationAttemptId` is this shared `qa_attempt_identities.attempt_id`;
there is no second independently supplied child identity.

### 5.3. `qa_automation_attempt_status_revisions`

Append-only monotonic technical state:

| Column | Rule |
|---|---|
| `status_revision_id`, scope, `attempt_id`, `revision_no` | Positive contiguous sequence. |
| `previous_revision_id`, `previous_state_hash` | Null only for revision 1. |
| `state` | `CREATED | TRIGGER_PENDING | RUNNING | TERMINAL`. |
| `external_authority_hash` | Exact Connection header + numeric GitLab project namespace. |
| `external_pipeline_id`, `external_job_ids` | Opaque strings; absent until authoritative receipt/read supplies them. |
| `provider_status`, `provider_revision_token`, `provider_updated_at` | Closed normalized provider observation and monotonic token. |
| `source_kind` | `COMMAND_RECEIPT | WEBHOOK_SIGNAL | POLL_READ | RECONCILIATION_READ | SYNTHETIC_FAILURE`. |
| `source_receipt_ref/hash`, `observed_at` | Exact Connector/Core provenance. |
| `result_id`, `result_content_hash` | Both required only in TERMINAL. |
| `content`, `content_hash` | Closed normalized status, append-only. |

`UNIQUE(attempt_id, revision_no)` and dedupe uniqueness over `(attempt_id, source_receipt_ref, provider_revision_token, content_hash)`. Legal transitions:

```text
CREATED → TRIGGER_PENDING → RUNNING → TERMINAL
                         └──────────→ TERMINAL
```

An equal observation is a no-op. Older/out-of-order provider state is retained in Connector observation history but does not append a regressive QA revision. A conflicting same provider token is a security/reconciliation error and produces no QA state change.

### 5.4. `qa_automation_attempt_results`

Exactly one immutable technical result per TERMINAL automated Attempt:

| Column | Rule |
|---|---|
| `result_id`, scope, `attempt_id`, `attempt_no` | Same-scope unique Attempt result. |
| `normalization_kind` | `SCHEMA_VALIDATED | SYNTHETIC_INCOMPLETE`. |
| `result_schema_ref/digest` | Exact expected schema; observed schema/digest is also retained when mismatch caused INCOMPLETE. |
| `technical_outcome` | `PASS | ASSERTION_FAILED | INFRA_FAILED | TIMEOUT | CANCELLED | INCOMPLETE`. |
| `infrastructure_error_code` | Optional bounded normalized code for INFRA_FAILED/diagnostic INCOMPLETE; never inferred from free text. Missing or unknown code makes INFRA_FAILED ineligible for automatic retry. |
| `cancellation_reason_code` | Required only for CANCELLED. |
| `external_pipeline_id`, `external_job_ids` | Must match the terminal authoritative observation. |
| `commit_sha`, `build_ref`, `merge_request_ref`, `environment_ref`, `suite_ref` | Exact normalized facts and target-equality proof. |
| `queued_at`, `started_at`, `completed_at`, `duration_ms` | Provider facts with non-negative duration. |
| `artifact_descriptor_set_hash`, `artifact_sync_state` | `COMPLETE | PARTIAL | UNAVAILABLE | EXPIRED`; exact membership hash. |
| `source_result_artifact_ref`, `normalization_report` | Safe Core/Connector refs and closed validation codes. |
| `received_at`, `content`, `content_hash` | Platform time and canonical immutable result. |

`UNIQUE(attempt_id)`. A deferred constraint requires the Attempt head to be TERMINAL and point to this exact result, and forbids a terminal result whose project/commit/environment/suite differs from the locked Session. Unknown/missing/oversized schema, ambiguous trigger identity or checksum mismatch is `SYNTHETIC_INCOMPLETE`; it never maps to PASS.

Technical PASS is only an execution fact. It never creates a human Plan Item Result, Session Outcome, QA Verdict or Jira transition.

### 5.5. `qa_automation_attempt_artifact_memberships`

Append-only exact descriptor set:

| Column | Rule |
|---|---|
| `membership_id`, scope, `attempt_id`, `result_id`, `ordinal` | Exact ordered result membership. |
| `artifact_reference_id` | Same-scope Core ArtifactReference. |
| `external_descriptor_hash` | Exact GitLab project/pipeline/job/path descriptor hash. |
| `checksum`, `size_bytes`, `media_type`, `artifact_kind` | Pinned metadata; size is non-negative and bounded by policy. |
| `classification_key`, `retention_policy_ref`, `expires_at` | Access and provider availability facts. |
| `availability_at_result` | `AVAILABLE | MISSING | EXPIRED | CHECKSUM_MISMATCH`. |
| `content_hash` | Immutable membership hash. |

`UNIQUE(result_id, artifact_reference_id)` and `UNIQUE(result_id, ordinal)`. Deferred equality recomputes `artifact_descriptor_set_hash`. Missing/expired artifacts remain explicit facts and cannot be omitted to manufacture a clean evidence set.

### 5.6. Generic Observation/result/evidence expansion

Migration 2055 changes only references, not public Feature 002 semantics:

- `qa_observations.attempt_id` becomes a scoped FK to `qa_attempt_identities`; MANUAL observations still resolve to `qa_manual_attempts`, AUTOMATED observations resolve to the exact immutable technical result;
- `qa_plan_item_result_attempt_memberships.attempt_id` references the shared identity. Its existing `attempt_content_hash` means the mode-specific finalized technical fact hash: final `qa_manual_attempts.content_hash` or `qa_automation_attempt_results.content_hash`;
- `qa_plan_item_result_observation_memberships` remains unchanged after its Observation FK becomes mode-neutral transitively;
- `qa_evidence_artifact_links` replaces persisted owner enum `MANUAL_ATTEMPT` with mode-neutral `ATTEMPT` for new rows and points `owner_attempt_id` to `qa_attempt_identities`; compatibility reads map legacy `MANUAL_ATTEMPT` to wire `ATTEMPT`;
- deferred versions of `qa_assert_attempt_lineage_decision()`, `qa_assert_negative_evidence_membership()` and `qa_assert_session_reviewable()` join the shared identity and the correct mode-specific terminal child.

For each technical negative automated Attempt, an authorized HUMAN creates a current `NEGATIVE | AMBIGUOUS` Observation before final human result/review. Machine output may prepare a proposed Observation but is not inserted as HUMAN evidence without explicit acceptance.

## 6. Retry, quarantine and review freeze — migrations 2055/2060

### 6.1. `qa_automation_retry_decisions` — migration 2055

One append-only deterministic decision for every terminal automated Attempt:

| Column | Rule |
|---|---|
| `retry_decision_id`, scope, `attempt_id`, `attempt_result_id` | Unique exact terminal subject. |
| `decision` | `NOT_APPLICABLE | DENIED | SCHEDULED`. `NOT_APPLICABLE` means the technical outcome/code/budget is ineligible; `DENIED` means otherwise eligible but current authorization/policy/quarantine/pins reject creation; `SCHEDULED` atomically owns one successor. |
| `reason_code` | Closed code: outcome, allowlist, budget, auth, quarantine, policy or pin mismatch. |
| `retry_policy_ref/hash`, `infrastructure_code` | Exact deterministic basis. |
| `automatic_retry_ordinal` | `1` only for SCHEDULED; otherwise null. |
| `successor_attempt_id`, `successor_launch_request_id` | Present together only for SCHEDULED. |
| `authorization_recheck_hash` | Current non-prod/config/revocation result. |
| `decided_by_kind/id`, `decided_at`, `content_hash` | Canonical SERVICE decision and causal provenance. |

`UNIQUE(attempt_id)`. `SCHEDULED` is valid only for `INFRA_FAILED`, an exact allowlisted deterministic code, unchanged target/suite/config pins and no earlier automatic retry in the lineage. The retry decision, deterministic launch claim, successor identity/Attempt, Core command/outbox and Session state update commit in one transaction. Duplicate terminal events replay that transaction without creating another Attempt.

`ASSERTION_FAILED`, unknown/schema error, TIMEOUT/CANCELLED/INCOMPLETE and a second infrastructure failure produce settled `NOT_APPLICABLE`. Policy/auth/quarantine/pin failure produces `DENIED`. Connector transport backoff for pre-effect 429/5xx is not a QA retry and creates no Attempt.

An explicit HUMAN rerun is a new launch request with a new key and `lineage_kind=HUMAN_RERUN`; it does not mutate the deterministic decision for its predecessor.

### 6.2. `qa_automation_quarantines` and `qa_automation_quarantine_revisions` — migration 2060

Stable header plus append-only human decisions:

`qa_automation_quarantines` contains `quarantine_id`, scope, subject kind/id (`SUITE_BINDING_VERSION | INFRASTRUCTURE_CODE`), current revision pointer, `resource_version`, created/updated times. Subject uniqueness prevents two active headers for the same exact subject.

Each `qa_automation_quarantine_revisions` row contains:

- contiguous revision and previous content ref;
- action `ACTIVATE | LIFT`;
- accountable owner principal;
- required bounded reason and evidence refs/hash;
- required `expires_at` for ACTIVATE, strictly after creation and within the pinned policy maximum;
- HUMAN actor, current authorization basis, created time and content hash.

Effective state is derived from the current revision and injected clock:
`ACTIVATE` creates `ACTIVE` until `expires_at`, `LIFT` creates `INACTIVE`, and
clock expiry projects `EXPIRED` without appending a synthetic revision. Expiry
never deletes history. An active quarantine blocks automatic retry; V1 also
surfaces a launch warning and allows an explicit rerun only if the pinned
policy and current HUMAN grant permit it. It never changes or hides an Attempt
result, removes Observation/Finding/evidence obligations, or turns a failure
into NOT_RUN/PASS.

### 6.3. Flaky lineage

The existing Feature 002 rule is extended across both Attempt modes. For a Plan Item containing:

```text
any ASSERTION_FAILED Attempt followed by any PASS Attempt
```

the exact human result carries `FLAKY_SUSPECTED`. Clean unflagged PASS is rejected. Flag resolution reuses `QaFlakyDispositionBasis`: every failed Attempt, current negative/ambiguous Observation, Finding membership, current DISPOSED review, policy and later positive PASS source is pinned. No automation-specific classification enum is introduced.

`INFRA_FAILED→PASS` keeps retry/recovery lineage and human-visible infrastructure evidence, but is not automatically a product-flaky classification. A HUMAN may still classify the Finding under the existing taxonomy based on evidence.

### 6.4. Sticky automated review and completion guard — migration 2060

The Session state graph remains monotonic:

```text
PLANNED → READY → RUNNING → REVIEW_REQUIRED → COMPLETED
   │        │        │              │
   └────────┴────────┴──────────────→ BLOCKED
                                      │
                                      └→ same recorded milestone only
zero-execution preterminal Session ───→ CANCELLED
```

Mode-specific meaning:

- MANUAL V1 keeps the existing closed-execution invariant: entering `REVIEW_REQUIRED` forbids new Attempts.
- the AUTOMATED representation uses sticky review: the first terminal result performs `RUNNING→REVIEW_REQUIRED`; automatic infrastructure retry or explicit HUMAN rerun may append Attempts while state stays `REVIEW_REQUIRED`. There is no back edge to RUNNING.
- execution activity is a derived projection `IDLE | TRIGGER_PENDING | RUNNING | RETRY_PENDING | RECONCILING | TERMINAL`, not another Session lifecycle state. `TERMINAL` means every current Attempt/retry decision is settled while HUMAN review may still remain open.

This satisfies the monotonic-state and human-verdict rules without an ADR: no state is inserted and no terminal/human decision is reversed.

AUTOMATED completion requires, under one locked snapshot:

1. at least one Attempt and a contiguous identity sequence;
2. every accepted launch has exactly one Attempt/Core command and every command/effect is terminal or conclusively reconciled;
3. every Attempt head is TERMINAL with exactly one immutable result;
4. every result has one settled retry decision and every `SCHEDULED` successor exists;
5. no trigger/status/reconciliation/artifact-sync worker holds an active lane for the Session;
6. the complete server-derived Attempt set/hash and maximum Attempt number exactly match the human Plan Item Result memberships;
7. current Observation leaves, negative evidence, Findings, quarantine warnings and `FLAKY_SUSPECTED` are disposed under existing risk policy;
8. artifact descriptor/evidence membership and adjudicative Manifest hashes match;
9. an authorized HUMAN signs the Session review and Outcome.

After a human Plan Item Result is finalized/frozen or Session review begins, a new Attempt is forbidden. Further execution uses a linked Session. Completion never closes the Jira Work Item automatically.

## 7. GitLab Connector persistence — migrations 4000/4010/4020

Connector rows are provider protocol facts. They contain no QA classification/outcome authority and no FK to QA tables.

### 7.1. GitLab `4000_gitlab_discovery_profiles`

Creates `gitlab_discovery_snapshots`:

- `id`, `workspace_id`, exact Core `connection_ref` and connector/adapter version;
- GitLab edition/version/build/API family and TLS endpoint fingerprint;
- numeric project ID, canonical project path hash, default branch/ref facts and supported trigger/read/artifact features;
- service-identity permission/scope probe hash, runner/network readiness hash and `production_denied` proof;
- sanitized closed metadata, schema ref/digest, content hash, validation status, collected/expiry times.

Creates `gitlab_profile_validation_details`:

- exact Profile ref and candidate content hash;
- discovery snapshot ref, numeric project and external-scope hash;
- allowed refs/environments/variable mapping/result/artifact contract hashes;
- permission, CI lint/dry-run, no-deploy/non-production and lookup-marker probe results;
- `VALID | INVALID`, stable issues, preview/probe hashes and created time.

Creates `gitlab_suite_contract_probes` for the opaque Connector evidence referenced by a QA Suite validation report: exact Profile/discovery refs, suite/result/artifact inputs, dry-run/fixture result hashes, status/issues and creation time. The QA report consumes only the opaque ref/hash.

All three tables are append-only. Discovery expiry makes a report ineligible for new publication but does not erase historical execution provenance.

### 7.2. GitLab `4010_gitlab_webhook_status_reconciliation`

Creates `gitlab_webhook_normalizations`:

- Core inbox receipt ref, exact Connection header/project authority, adapter/dialect version;
- Standard Webhooks key-version ref, signature/freshness/replay result;
- provider delivery ID, retry number, event kind, body hash and normalized signal hash;
- `ACCEPTED | DUPLICATE | REJECTED | SCOPE_PENDING | SECURITY_CONFLICT`, stable reason and received time;
- uniqueness on `(connection_header_id, numeric_project_id, provider_delivery_id)` and a guard that same ID/different body becomes SECURITY_CONFLICT.

Creates append-only `gitlab_pipeline_observations`:

- exact provider authority, pipeline/job IDs, opaque provider status/revision token/update time;
- commit/ref/marker facts, normalized job set hash, source receipt/poll ref;
- observation hash and platform observed time.

Creates mutable `gitlab_pipeline_projection_heads` with only the current monotonic observation pointer, last reconciliation time/error and CAS version. Older/out-of-order observations remain history but never regress the head.

Creates `gitlab_reconciliation_cursors` and `gitlab_rate_limit_snapshots` for per-Profile/project lane, bounded poll window, lease/fencing token, next eligible time and sanitized error/rate facts. Redis jobs contain only reconstructible scheduling hints.

### 7.3. GitLab `4020_gitlab_trigger_artifacts`

Creates `gitlab_trigger_reconciliations`:

- Core command/effect ID, exact Connection/Profile/project/ref/commit pins and request/payload hashes;
- deterministic opaque marker and bounded creation window;
- `NOT_STARTED | EFFECT_STARTED | LOOKUP_REQUIRED | ONE_FOUND | CONFIRMED | AMBIGUOUS | FAILED_FINAL`;
- external pipeline ID, lookup query hash/match count, receipt hash, attempt count, lease/fencing token and retry time;
- `UNIQUE(effect_id)` and provider uniqueness for a confirmed pipeline under its exact authority.

Once `EFFECT_STARTED` is durable, recovery can perform only `pipeline.lookup`; a second `pipeline.trigger` is rejected unless the same record proves absence before invocation. Zero/multiple matches after the consistency window becomes AMBIGUOUS/INCOMPLETE, never a blind POST.

Creates `gitlab_artifact_locator_revisions`:

- Core ArtifactReference ID, exact authority/project/pipeline/job/path and Profile ref;
- opaque encrypted/sealed locator, checksum/size/media/kind, classification and provider expiry;
- descriptor/content hash, availability `AVAILABLE | EXPIRED | MISSING | CHECKSUM_MISMATCH`, observed time and previous revision ref.

Creates `gitlab_artifact_stream_receipts` containing authorized request ref, locator revision, streamed checksum/bytes, outcome/error code, audit correlation and time. It stores no artifact bytes. Locator values never appear in QA API/event/read models.

## 8. State machines

### 8.1. Suite Binding

```text
DRAFT → VALIDATED → PUBLISHED → RETIRED
  ↑          │
  └──────────┘ content/probe change creates a new version, not mutation
```

INVALID validation appends a report and leaves the version DRAFT. A published version's content and report are immutable.

### 8.2. Launch request and Core command

```text
Launch request: one immutable ACCEPTED | REJECTED decision
ACCEPTED → exactly one Attempt + exactly one Core ConnectorCommand/effect

Core command uses the existing lifecycle:
AWAITING_APPROVAL | QUEUED → DISPATCHED/RETRY_SCHEDULED
                         → CONFIRMED | CONFLICT | FAILED | CANCELLED
```

An explicit allowlisted HUMAN non-prod smoke launch requires exact confirmation but no second approval. Large/autonomous regression is outside V1 and has no accepted launch origin.

### 8.3. AutomationAttempt

```text
CREATED → TRIGGER_PENDING → RUNNING → TERMINAL(result)
                         └──────────→ TERMINAL(result)
```

Attempt identity, pins and terminal result never mutate. Retry/rerun creates Attempt `n+1` with explicit predecessor and lineage kind.

### 8.4. Review/finding

Existing human lifecycles remain authoritative:

```text
PlanItem: PLANNED → RUNNING → TERMINAL(human result)
Finding:  DRAFT → CLASSIFIED → DISPOSED → FROZEN
Session:  ... → REVIEW_REQUIRED → COMPLETED(human outcome)
```

Pipeline/result events may set Session to REVIEW_REQUIRED and propose review material. They cannot transition a Finding, finalize a Plan Item Result, sign a Session Outcome/Verdict or change Jira.

## 9. Transactions, locks and concurrency

### 9.1. Automated Session creation UoW

One transaction:

1. verifies identity → Workspace membership → Project Entitlement → QA permission/classification;
2. reads current Work Item/RequiredSessionPlan and derives FULL_QA/live availability;
3. resolves exactly one compatible Binding/Profile chain and current published Suite version;
4. validates target/environment/parameters before resolving credentials or calling a Connector;
5. locks the RequiredSessionPlan header and Session ordinal allocator;
6. inserts Session, exactly one Plan Item and three configuration-pin rows;
7. verifies structure/pin hashes and commits PLANNED/READY state plus audit/event.

Failure writes no partial Session. No GitLab call is part of this transaction.

### 9.2. Explicit launch/rerun UoW

Take a transaction-scoped advisory key and `FOR UPDATE` locks in order `Work Item extension → Session → Plan Item → launch identity`. Reauthorize current caller and revalidate pinned non-prod/config revocation state. Then atomically:

- claim `(scope, session, request_key_hash)`;
- for an initial launch, transition `READY→RUNNING`; for rerun require AUTOMATED `REVIEW_REQUIRED` and no frozen human result/review;
- allocate the next Attempt identity and insert automated child plus CREATED/TRIGGER_PENDING revisions;
- create Core command, command idempotency, target-lane claim intent, audit and outbox through the existing transaction-aware contribution;
- insert the accepted launch row and emit outbox events.

Same-key replay takes the same lock and returns the existing Attempt. Conflicting payload fails. If Core and QA cannot share the transaction-aware gateway, implementation stops at the prerequisite boundary; an eventual dual-write is not allowed.

### 9.3. Provider effect and reconciliation

The Connector target lane key contains exact Connection header, numeric project and effect marker. Lease/fencing tokens reject stale workers. `effectInvocationStartedAt` and `EFFECT_STARTED` persist before/with invocation fencing. After possible invocation, only exact lookup/reconciliation is allowed. Worker crash, Redis loss and duplicate delivery therefore do not create another pipeline.

### 9.4. Status/result/retry UoW

Webhook and poll workers first persist/dedupe Connector facts, then publish a scoped normalized event. QA consumer locks `Session → Plan Item → Attempt head` and:

- ignores exact duplicates and monotonic regressions;
- appends one status revision and CAS-advances the head;
- on terminal authoritative data, registers Core artifact references, inserts artifact memberships, immutable result and settled retry decision;
- transitions the first terminal Session `RUNNING→REVIEW_REQUIRED`;
- if and only if eligible, atomically creates Attempt `n+1`, automatic launch claim and Core command while Session remains REVIEW_REQUIRED.

The transaction emits events only through outbox. A failure rolls back the complete QA mutation; provider facts remain recoverable through Connector reconciliation.

### 9.5. Review versus rerun

Result/review/freeze and rerun use the same Session/Plan Item lock and exact server-derived Attempt-set hash/watermark:

- rerun-first appends an Attempt, changes hash/watermark and makes an older result/review `STALE_ATTEMPT_SET`;
- review-first atomically finalizes the Plan Item, freezes Findings/Manifest and rejects the later launch as `QA_PLAN_ITEM_EXECUTION_CLOSED`;
- status events for an already known Attempt may still reconcile to terminal before review; review cannot commit while any Attempt is nonterminal;
- a new execution after freeze requires a linked Session.

### 9.6. Isolation level

Default PostgreSQL `READ COMMITTED` is sufficient only with the explicit row/advisory locks, unique claims and deferred constraints above. Serialization failures/deadlocks retry the whole local transaction before any provider invocation. Provider effects never execute inside a retriable database transaction.

## 10. Migration inventory and rollout

Applied migrations `2000…2040`, Core migrations and Jira `3000…3040` are immutable.

### QA `2050_qa_automation_foundation`

Creates:

- `qa_automation_suite_bindings`;
- `qa_automation_suite_binding_versions`;
- `qa_automation_suite_validation_reports`;
- `qa_automation_session_configuration_pins`;
- `qa_attempt_identities`.

Additively alters RequiredSessionPlan requirements, `qa_test_sessions` and `qa_plan_items` with contract version/mode-specific columns and expands mode CHECKs. Backfills every MANUAL Attempt identity and validates counts, scopes, sequence and hashes. New AUTOMATED writes stay feature-gated until backfill validation succeeds.

### QA `2055_qa_automation_execution`

Creates:

- `qa_automation_launch_requests`;
- `qa_automation_attempts`;
- `qa_automation_attempt_status_revisions`;
- `qa_automation_attempt_results`;
- `qa_automation_attempt_artifact_memberships`;
- `qa_automation_retry_decisions`.

Expands Observation, result-attempt membership and evidence owner FKs to the shared identity; installs mode-aware exact-set/evidence/flaky functions and dual-validates legacy manual rows. It leaves `qa_manual_attempts` as canonical manual detail and does not rewrite its public content.

### QA `2060_qa_automation_review_quarantine`

Creates:

- `qa_automation_quarantines`;
- `qa_automation_quarantine_revisions`.

Installs sticky AUTOMATED review, retry-settlement, command/reconciliation/artifact, Attempt-set freeze and human completion guards. After validation it contracts obsolete direct-to-manual FKs/functions, but retains legacy columns/compatibility projection where published readers still require them. No historical row is deleted.

### GitLab Connector `4000/4010/4020`

- `4000_gitlab_discovery_profiles`: discovery snapshots, Profile validation details and suite contract probes;
- `4010_gitlab_webhook_status_reconciliation`: webhook normalizations, pipeline observations/heads, cursors and rate snapshots;
- `4020_gitlab_trigger_artifacts`: trigger reconciliation/ambiguity state, artifact locator revisions and stream receipts.

They use schema namespace ledger `connector:gitlab`. Connector migration order is independent of QA table FKs; runtime publication requires both namespaces at their declared minimum version.

### Migration behavior

- Fresh install, current-head upgrade, repeat/idempotence, current-minus-one and failed-migration recovery run on PostgreSQL 17 and 18.
- PostgreSQL DDL is transactional where supported. New NOT NULL/FKs use expand → backfill → `NOT VALID` constraint → validation → contract to avoid partial unreadable history.
- Before constraint replacement, migration asserts every old row is MANUAL and every old Attempt has exactly one same-ID shared identity.
- Down migrations are developer-only before data use. Signed/review/effect history is not destructively rolled back in deployed environments.
- Migration tests assert owner namespace, FK direction, append-only triggers and absence of Core/Connector DDL in the QA range.

## 11. Compatibility and backfill

### 11.1. Schema compatibility

- Feature 002 schema IDs, files, bytes, examples and digests are not edited. Its `AUTOMATED` negative fixture remains invalid against MANUAL V1.
- Existing mixed QA aggregates store `contract_schema_version=2` for the
  AUTOMATED representation. Its new wire contracts have distinct first-version
  identities: `automated-required-session@1.0.0`,
  `automated-test-session@1.0.0`, `automated-plan-item@1.0.0` and
  `automation-target-snapshot@1.0.0`. The wire version is scoped to that new
  schema identity and is not a claim that Feature 002 V1 was mutated.
- Automation launch/Attempt/status/result/retry/quarantine and successful
  `gitlab-pilot-gate-evidence` receipt schemas start at `1.0.0`. Rehearsal
  receipts cannot reference another rehearsal; release receipts must bind the
  exact successful rehearsal ref/hash.
- `qa.validation` manifest `1.2.0` adds the optional three-capability automation group; 1.0/1.1 remain publishable for MANUAL-only compositions.
- API reads return the unchanged Feature 002 MANUAL V1 representation or the
  distinct Feature 005 AUTOMATED representation according to mode plus stored
  `contract_schema_version`; they never synthesize automation fields into a
  MANUAL V1 response.

### 11.2. Manual Attempt backfill

For each `qa_manual_attempts` row:

1. lock/scan by `(workspace_id, project_id, plan_item_id, attempt_no)`;
2. insert same-ID `qa_attempt_identities(mode=MANUAL)` using owning Session scope hash and exact target hash;
3. verify one child, contiguous sequence and identical scope/parent ownership;
4. shadow-validate Observations, result memberships and evidence links against both old manual FK and new identity;
5. switch generic readers/functions to identity after zero mismatches;
6. retain the manual child and compatibility mapping permanently for the V1 API.

If any orphan, cross-scope row, sequence gap or hash mismatch exists, migration fails/quarantines the deployment; it never invents an Attempt or silently drops evidence.

### 11.3. Event and projection compatibility

Existing session/result/Finding/manifest/review events retain their versions. Feature 005 adds only automation fact events. Existing consumers that know only MANUAL ignore the optional automation contribution; they must not treat an unknown mode as MANUAL.

`QaWorkItemDetail` gains an optional automation section through the existing Pack section registry. Projection rebuild reads immutable source rows and never changes QA decisions.

## 12. Retention, access and security

### 12.1. Retention

- QA Attempt identity, result, retry/quarantine decision, human review, exact membership/checksum and audit provenance follow the existing Work Item/evidence retention policy and remain append-only for its legal/audit lifetime.
- Connector webhook normalizations, pipeline observations, effect reconciliation and stream receipts use bounded policy-configured retention sufficient for replay/dedupe and investigation. Exact horizons are live pilot metadata, not hard-coded constants.
- Raw artifact bytes remain in GitLab under the pinned artifact policy. V1 creates no long-term platform/S3 copy. On expiry, metadata changes availability to EXPIRED through a new Connector revision; signed historical checksums/memberships remain.
- Raw webhook body, raw result beyond the bounded validated schema, logs and artifact bytes are not copied into QA tables. Core inbox raw material follows its encrypted bounded retention policy.
- Decommission/erasure never cascades-delete signed QA history. Secret revocation/cryptographic erasure and identity pseudonymization follow Core policy while immutable decision provenance remains referentially valid.

### 12.2. Authorization and non-disclosure

Every use case follows:

```text
verified identity
→ Workspace membership
→ Project Entitlement
→ role/permission/tool grant
→ resource classification
→ scoped parent repository
→ Suite/config/artifact/Connector access
```

Failed authorization stops before the next step and returns a non-disclosing error. Global `findById`, provider lookup before project authorization and artifact resolution by raw GitLab ID are forbidden.

Artifact metadata and content are independently authorized on every request. QA API streams through the Core proxy and pinned Connector Profile; it never returns a raw URL, opaque locator or signed provider link. Raw content is never automatic Hermes/model context.

### 12.3. Defense in depth

- distinct narrow project-scoped read, trigger and webhook signing references
  with exact operation routing are required;
- identity permission, GitLab CI rules, Profile allowlist, platform effect gate and network/egress policy independently deny production/deploy;
- request values come only from the published closed Suite parameter schema; shell fragments, arbitrary variables/jobs/Profile IDs and secret refs are rejected;
- webhook verification binds key version, exact connection/project, body hash, freshness and delivery identity; same-ID/different-body is a security conflict;
- 401/403 is terminal auth degradation, 429/5xx uses bounded transport backoff, and neither can be misclassified as product PASS;
- safe log/metric labels exclude request keys, pipeline/job IDs, SHA, actor IDs, external paths and artifact locators.

## 13. Indexes and read projections

Minimum indexes:

- all QA tables: `(workspace_id, project_id, id)` or their named primary identity;
- Suite headers/versions: `(workspace_id, project_id, suite_key)`, `(suite_binding_id, version)`, current published pointer;
- Sessions: existing `(workspace_id, project_id, work_item_id, ordinal)` plus `(workspace_id, project_id, mode, state)`;
- pins: `(session_id, logical_role)`;
- shared Attempts: `(workspace_id, project_id, session_id, plan_item_id, attempt_no)`;
- launch claim unique `(workspace_id, project_id, session_id, request_key_hash)`;
- automated status: `(attempt_id, revision_no)` and nonterminal head partial index;
- results/retry: unique `attempt_id`, plus `(workspace_id, project_id, technical_outcome, completed_at)` for bounded operational queries;
- artifact memberships: `(attempt_id, ordinal)` and scoped Core ArtifactReference;
- active quarantine subject/current pointer and expiry index;
- GitLab observations: `(connection_header_id, numeric_project_id, external_pipeline_id, provider_updated_at)`;
- reconciliation: `(state, next_retry_at)` and lease-expiry indexes;
- artifact locators: `(artifact_reference_id, revision)` and `(availability, expires_at)`.

Read projections are derived, not new authority:

- `QaAutomationAvailability`: structural mode, live availability, stable blockers and current Suite choices;
- `QaAutomatedSessionDetail`: immutable target/config pins, sticky Session state, derived execution activity and human-review blockers;
- `QaAutomationAttemptTimeline`: ordered identity/status/result/retry/artifact provenance;
- `QaAutomationReviewReadiness`: exact Attempt/Observation/result/Finding/artifact sets and retry/reconciliation blockers;
- `QaAutomationOperationalHealth`: safe aggregate queue/wait/run/reconcile/error data without high-cardinality or sensitive metric labels.

## 14. Required invariants and data-model tests

| Invariant | Primary guard | DB boundary |
|---|---|---|
| Scope isolation | authorize before scoped repository | repeated scope + composite FKs/deferred trigger |
| One Suite per V1 Session | Session planner | mode-specific Session/Plan Item constraints |
| Exact immutable configuration | server resolver and validation report | pin rows + exact set hash + snapshot lock |
| One pipeline per request key | QA actor-independent claim | scoped unique launch identity |
| No blind trigger retry | effect reconciliation reducer | effect state/fencing/unique marker |
| Attempt sequence/immutability | Session lock and allocator | shared unique number + append-only child/status/result |
| One terminal result/decision | result reducer | unique Attempt result/retry + deferred terminal guard |
| One automatic infra retry | policy reducer | lineage query/deferred retry constraint |
| Assertion no auto retry | closed outcome matrix | retry decision CHECK/deferred function |
| Sticky review | mode-aware Session reducer | no AUTOMATED REVIEW_REQUIRED back edge; MANUAL still closed |
| Fail→PASS remains flaky | shared lineage reducer | mode-aware complete-set/flaky deferred function |
| Human verdict only | HUMAN use cases | no Connector/service DB grant/path to result/review/verdict |
| Artifact provenance/access | Core proxy and checksum verifier | exact descriptor/evidence memberships, no locator in QA |
| Production/deploy impossible | five-layer policy gates | Profile/suite/environment constraints and zero-call tests |

Mandatory tests include:

- fresh/upgrade/repeat/failure recovery for migrations 2050/2055/2060 and 4000/4010/4020 on PostgreSQL 17/18;
- manual backfill count/hash/FK equality and byte-stable Feature 002 contract fixtures;
- same-key same-hash replay across two authorized actors returns one Attempt/pipeline; different hash conflicts;
- concurrent first launch, automatic-retry duplicate delivery and two HUMAN reruns allocate one contiguous winner per request key;
- crash before invocation may retry transport; crash after invocation performs lookup only;
- duplicate/out-of-order/lost webhook and same-ID/different-body behavior;
- assertion failure has no auto retry; allowlisted infra failure creates exactly one successor; 401/403/schema drift do not retry;
- first terminal result makes review sticky; a later retry/rerun does not return Session to RUNNING;
- review/rerun race produces either a stale review or a closed-execution denial, never an unreviewed hidden Attempt;
- cross-project trigger/webhook/artifact and production/deploy requests produce zero provider effects;
- technical PASS cannot create Plan Item Result, Session Outcome, QA Verdict or Jira transition;
- artifact expiry/checksum mismatch remains visible and raw locator/content is never disclosed.

## 15. Pilot-gated values

There is no unresolved architectural question. These values are required only for opt-in live GitLab validation and remain immutable metadata inputs:

- GitLab URL, edition/version/API/auth mechanism and numeric project;
- exact source-context, trigger/ref/job and lookup-marker dialect;
- suite/environment/parameter allowlists and non-production/no-deploy proof;
- result schema/digest/path/size, artifact kinds/checksums/retention/access;
- webhook verification/dedupe/replay rules, rate budget and reconciliation bounds;
- deterministic infrastructure codes, cancellation semantics and runner/network readiness.

Their absence yields `SKIPPED_GATED` for live validation. It does not weaken the mandatory stateful local implementation or authorize a guessed/default provider contract.
