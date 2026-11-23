# Data model — Feature 008

## Conventions and ownership

Reuse 007 `ProjectScope`, `ExactRevisionRef`, canonical JSON hashing, append-only
audit, authorized query tokens and persisted exact Approval subjects. Every
project-bearing object carries workspaceId/projectId; a workspace deployment
record lists explicit projectRefs and requires operator permission plus access to
all included Projects. Restricted summary views are separate filtered projections,
not edits of the original signed/hashed report. Secret references are opaque;
values, URLs with credentials, raw tokens and private keys are never stored here.

Immutable records have `id`, `schemaVersion`, `version`, `contentHash`,
`createdAt`, `actorRef`, `correlationId` and optional `causationId`. Exact refs
contain id/version/contentHash. Hash excludes itself and report-provenance fields
where the existing owner contract requires that exclusion. Mutable headers use
rowVersion CAS; deleting or altering a published revision is prohibited.

## 1. DeploymentRevision — runtime-owned configuration

Fields: deploymentId/version, deploymentProfile, runtimeProfile,
environmentScope, compositionKey, workspaceId, projectRefs[], imageDigest,
inputPackageRef, identityPolicyRef, secretResolverPolicyRef, signingPolicyRef,
telemetryPolicyRef, networkPolicyRef, artifactMode, artifactPolicyRef,
modelPolicyRef, connectorBindingRefs[], recoveryPolicyRef, contentHash.

Validation: closed profile/environment matrix; HTTPS and exact trusted origins in
non-local profiles; no local persona/default credential/fake component; exactly
one compatible binding per required capability; all three pilot connector types;
QA production target denied. GitLab-only evidence requires policy acceptance.
API and worker report the same immutable revision/digest.

DeploymentRevision is configuration, not an authority over Project stage. A
mutable DeploymentHeader identifies the selected revision and effect fence.

Runtime presence is recorded separately in `pilot_runtime_registrations` (additive
Core migration 0175). Each process incarnation has an immutable instance ID,
Workspace/deployment/version, component, configuration digest and image digest.
Database-clock timestamps, a bounded expiry, state and row version record its
renewal. Stopped or expired incarnations cannot renew, and identity/digest fields
cannot change. Current readiness requires both API and worker and rejects any
live mismatching incarnation. Presence grants no business authority: the current
Project guard, exact published deployment and original effect pins still apply.

## 2. PilotInputPackage and InputValidation

Immutable metadata: provider editions/versions/dialects, auth strategies, sanitized
payload/document hashes, exact Connection/Profile/Binding refs, named owner IDs,
OIDC policy, secret-store mapping policy, egress/callback policy, telemetry/scanning/
backup policies, cohort and incident/rollback refs. No secret values.

InputValidation records requiredInputIds, validInputIds, missingInputIds,
unsupportedCapabilities, verifierVersion, inputHash and status. Missing inputs are
`BLOCKED_INPUT`; conflicting/unsafe values fail. C1 metadata validation does not
claim endpoint reachability, correct credentials or N2 conformance.

### Published runtime configuration storage

Additive Core migration 0180 stores the runtime-owned input package, eight
policy documents and three provider configuration bundles. This is configuration
persistence, not a second Project authority or a conformance result.

`runtime_configuration_revisions` contains an immutable publication envelope:
Workspace, explicit Project IDs, configuration kind, exact document ref,
`document`, publisher, publication time, expiry and correlation ID. The ref hashes
the canonical document; a separate publication hash covers the complete envelope,
including scope, provenance and validity. `runtime_configuration_projects` enforces
Project/Workspace foreign keys for every included Project. Current reads verify
both hashes and their stored identity/time columns.

`runtime_configuration_headers` selects the current version with row-version CAS
and PUBLISHED/REVOKED state. A revoked version cannot be republished or revived;
only a new version can become current. Identical publication replay adds nothing
and does not extend expiry. Append-only `runtime_configuration_events` records
publication and revocation in the same transaction; a failed event write rolls
back the document, scope rows and header. The publishing application must still
authorize its operator for every included Project before this persistence call;
no public configuration-administration endpoint is added by this increment.

Each provider bundle has `provider` and `projects[]`. Each Project selects exact
`integrationBindingRef`, `profileRef`, `connectionRef`, plus `connectorKey` and
`endpoint`. The runtime checks current published Core heads, canonical content
hashes, binding/profile/connection links, environment/capability declarations and
the deployment's selected endpoint. All declared Projects must be represented.
The document reference is distinct from each contained Core reference.

`PublishedDeploymentReferences` supplies startup reference validation and the
readiness input projection from this store. Input validation is shared with the
CLI and requires all IN-01–IN-12 metadata entries to cover the deployment's full
scope. SQL reads/locks and validation have deadlines; earliest publication expiry
bounds the result. `createPublishedDeploymentStartup` constructs this resolver
internally. Concrete policy dialects and provider credentials remain the owning
adapter factories' responsibility. Metadata readiness alone cannot produce a
C1/N2/P3 gate PASS, and full API/worker composition remains required.

## 3. GateRun and GateAssessment — Core generic attestations

GateRun fields: runId, gateKey, attempt, deploymentRef, scope, environment,
sourceDigest, contractDigest, migrationDigest, lockDigest, imageDigest (when
relevant), suiteVersion, inputDigest, startedAt/finishedAt, status,
checks[] {id, status, evidenceRefs, reasonCodes}, measuredValues,
prerequisiteRefs[], reportDigest, executorIdentity.

Status: `PASS | FAIL | BLOCKED_INPUT | SKIPPED_GATED`. A run is append-only.
GateAssessment is the current projection: `CURRENT | STALE | EXPIRED | REVOKED`,
with evaluatedAt and invalidationReason. Hash/config/version drift invalidates
promotion without rewriting the old report. Required child statuses other than
PASS prevent parent PASS; NOT_RUN is represented by absent evidence, not success.

Operational reports use the schema in contracts; immutable persisted refs pin the
complete bytes plus scope. No copied PASS text can authorize activation.

Bridge these reports into existing ProjectOnboardingGateResult L0/C1/N2/P3:
required execution FAIL maps to FAIL, missing input or required SKIPPED_GATED maps
to BLOCKED_INPUT, and only all-current PASS evidence can publish PASS. P3 includes
pre-activation security/recovery/shadow/cohort readiness, not the post-activation
observed pilot/report, avoiding a circular first-write gate.

## 4. Capability health — projection of existing Core probe facts

Reuse `CapabilityProbeResult` from
`platform-core/src/project-onboarding/binding-readiness.ts`, including exact
binding/profile/connection/mapping/validation refs, logical role, contract version,
operation, timestamps and `AVAILABLE | DEGRADED | UNAVAILABLE`. Connector adapters
produce observations through the existing Core-owned probe contract. Do not add a
competing persisted Connector-owned health model.

Add freshness/expiry and conformance references through an additive compatible
projection/enrichment. Missing/stale facts derive UNKNOWN in UI/admission; no
historical enum is reinterpreted. Real scheduled repositories feed the existing
probe worker. Health intersects Project mode/state and deployment fence without
rewriting historical binding or capability mode.

## 5. Effect certainty and DeadLetterRecord

Do not introduce a second command state machine. Map this semantic classification
to the existing connector effect records and command lifecycle:

| Semantic state | Meaning | Permitted next operation |
|---|---|---|
| NOT_DISPATCHED | Durable intent exists; no network dispatch | Recheck current guards and dispatch |
| POSSIBLY_APPLIED | Dispatch may have reached provider | Read-only reconciliation |
| CONFIRMED_APPLIED | Matching external effect verified | Commit observed outcome; no write retry |
| CONFIRMED_NOT_APPLIED | Non-application proven by supported protocol | Bounded retry under original identity/current guards |
| DIVERGENT | External state differs or marker conflicts | Controlled new action; do not overwrite |
| UNRESOLVED | Zero/multiple/incomplete lookup without proof | Quarantine and investigation |

DeadLetterRecord fields: project scope, commandRef, original idempotency/effect
key, semanticHash, exact binding refs, normalized class/reason, attemptCount,
firstFailureAt/lastFailureAt, ownerRef, age, nextEligibleAt, certainty,
redacted diagnosticRef, replayEligibility and resolutionRefs[].

ReplayDecision binds original command/action identity, current actor, exact report
and deployment fence, rowVersion, expiry and decision reason. Replay never replaces
an expired approval or changes payload. Changed intent creates a new command and
required approval. Unique constraint: scope + original command + replay request key.

## 6. RecoveryRun and BackupManifest

BackupManifest: backupId, sourceDeploymentRef, database identity/major version,
backupKind `LOGICAL | PHYSICAL_PITR`, backupStartedAt/completedAt,
consistentRecoveryPoint, WAL range/timeline when applicable, schema/migration pins,
artifactInventoryRef, publicKeyInventoryRef, configRef, audit/effectWatermarks,
protectedLocationRef, retentionPolicyRef, integrityHashes, verificationReportRef.

RecoveryRun: isolatedTargetId, backupRef, requestedPoint, faultDeclaredAt,
lastConfirmedRecoverableCommitAt, serviceRestoredAt, rpoObservedSeconds,
rtoObservedSeconds, approvedPolicyRef, oldRuntimeFenceProofRef,
newRuntimeFenceProofRef, stages[], unresolvedEffects[], signatureChecks[],
artifactChecks[], reconciliationReportRef, ownerRef, status.

Phases: `PLANNED → FENCED → RESTORED → VERIFIED → RECONCILED → READY_FOR_RESUME`;
any failure goes to `BLOCKED`, preserving stage evidence. READY_FOR_RESUME is not
an automatic resume. RPO measures observed data loss against the fault point;
RTO ends only when the defined service recovery checks pass, not at DB startup.

## 7. PilotCohortRevision and PilotRun

PilotCohortRevision: workspaceId, ordered projectRefs[], humanPrincipalRefs[],
channelRefs[], approvedEnvironmentRefs[], suiteRefs[], startAt/endAt,
sponsorRef, qaLeadRef, onCallRef, inputPackageRef, incidentRunbookRef,
rollbackRunbookRef, comparisonProtocolRef, contentHash. Initially one Project;
expansion creates a new revision and invalidates pending activation.

PilotRun: cohortRef, deploymentRef, stage `PREPARING | SHADOW | LIMITED | REVIEW |
STOPPED | CLOSED`, gateRefs[], activatedProjectRefs[], guardrailObservations[],
reviewRef. This is operational reporting, not a second Project lifecycle. LIMITED
requires the matching existing Project onboarding `PILOT_ACTIVE` state and
operational ACTIVE state. Project suspension always wins over pilot stage.

Fence: `DENY | SANDBOX_CONFORMANCE | SHADOW | COHORT_WRITES | RECOVERY` plus
revision, owner and expiry. The intersection with 007 authorization narrows effects;
no mode grants new human roles. Expiry/revocation/incident closes the fence.

## 8. MeasurementProtocol, BaselineDataset and PilotReport

Metric ownership: Core owns queue/WIP/SLA/calendar/pause facts; QA owns Session/
Attempt/rework/automation/flaky facts; Connectors own reliability. Reporting
composes versioned facts and never computes a competing SLA clock.

MeasurementProtocol: versioned metricDefinitions[], sourceMappings[], inclusion/
exclusionRules, timestamp/timezone policy, baselineWindow, comparisonWindow,
minimumSamplePolicy, targetValues (absent until baseline), stratification,
missingDataPolicy, spotCheckPolicy, signed qaLead/sponsor attestations.

BaselineDataset: protocolRef, immutable authorized sample membership, source
provenance and hashes, sampleSize, excluded/censored counts and reasons,
observationWindow, measuredValues and spotCheckRefs. Current-process baseline
cannot be silently reconstructed solely from platform outcomes.

PilotReport: cohort/deployment/protocol/baseline refs, observed sample,
measurement completeness, metrics, guardrails, incidents, operator load,
limitations, residualRisks, recommendation `CONTINUE | ADJUST | STOP |
INSUFFICIENT_DATA`, separate human review decision and reviewer refs. Recommendation
cannot activate a Project or decide product release. Closed reports are immutable.

## 9. HermesEvaluationRun

Fields: model/skill/prompt/config versions, corpusVersion/hash, caseIds,
case scope and exact DRAFT/CANDIDATE/WORK_ITEM subject snapshots, expected safety
properties, actual schema/grounding/completeness results, leakage/injection
results, fallback reason, reviewRef and deployment rollback targetRef.

Synthetic approved cases contain no production secrets. Scores do not become
verdicts/priority. A prompt/model change must pass evaluation before promotion;
rollback selects an earlier evaluated compatible revision.

Local implementation stores selections as immutable Core `MODEL_POLICY`
revisions named `hermes:<projectId>`. Each selection pins the evaluated candidate,
evaluation/review/compatibility refs, mode, request hash and invalidation counts.
Promotion and rollback use CAS with the existing runtime-configuration event
journal. Rollback creates a new revision; the historical target stays immutable.

QA migration 2100 adds nullable `model_policy_ref` to triage and session-plan
proposals. Once a Hermes policy is selected, a new CURRENT proposal must carry
that exact current, published, unexpired ref. A shared transaction lock fences
late responses against concurrent selection. Existing pending proposals become
STALE atomically with policy publication; ACCEPTED session plans are preserved.
Before a policy is selected, legacy deterministic generation remains supported.

## Persistence, migration and retention

Reuse existing command, approval, onboarding, binding, evidence and audit tables.
Add Core-owned tables for generic pilot/gate/recovery metadata and QA-owned
contributions only where QA semantics require persistence. Allocate migration
numbers after inspecting the registry immediately before implementation; never
edit published 001–007 migrations. Validate expand-first on PostgreSQL 17 and 18.

Use composite scope FKs, scoped unique idempotency keys, immutable revision
constraints, CAS on headers and bounded indexed queries. Preserve archived reports,
public key metadata, reconciliation evidence and audit for the approved retention.
Replay/receipt retention must cover provider retry and approved recovery windows;
if it cannot, require additional provider evidence or keep effects blocked.

### Durable QA evidence uploads (migration 2090)

`qa_evidence_uploads` stores immutable workspace/project/work-item/session scope,
canonical initiating actor, polymorphic evidence owner, media/size/classification,
exact storage policy, stable artifact/link identifiers, expiry and authorization
basis hash. Bytes and credentials are never stored in this table. The states are
`AUTHORIZED → UPLOAD_PENDING → UPLOADED → FINALIZED`; the pending state owns a
bounded lease and pins the checksum before any external write. A later lease may
only reconcile the same object through a read, never repeat an uncertain PUT.

The upload API preserves public versions 1/2/3 and maps internal pending state to
AUTHORIZED. Every operation rechecks current access and immutable metadata;
finalize verifies the exact stored version and atomically creates the Core artifact
and QA link. Replays return that same link, including timestamp precision. Pending
expiry denies further operations; expiry does not delete evidence or silently
release uncertain writes. Cleanup remains subject to the retention policy.

### Published automation availability

The read model selects a server-owned pin set per Workspace/Project: current Core
Binding and QA context, selected Suite header/version and validation report, binding
validation report, functional acceptance, environment/evidence policy and three
role/profile/connection pairs. The pin-set hash uses a versioned canonical envelope
containing the scope, Binding, fixed role order, exact capability versions, eight
operations and NON_PROD environment. It is not compatible with arbitrary local
fixture digests; the corporate validation writer must produce this format.

Existing immutable Core/QA records remain authoritative. Current published headers
are joined explicitly. Binding validation and Suite validation select the latest
report for the selected version before checking its outcome. Functional acceptance
and each operation's latest probe must match the full selected references and hashes.
The configured maximum evidence age is checked along with each probe's `valid_until`;
an expired report or acceptance requires renewed evidence. Failure yields safe
unavailable readiness without refreshing timestamps or granting a Core mode change.

No new table or schema version is required. QA context revision identity remains the
existing UUID column; the repository now supplies a UUID instead of a suffixed string.
The API performs scoped current-authority checks and a second configuration read
before returning, with bounded SQL/request time and no-store responses. Its
`launchPermitted` field describes readiness only; actual launch/dispatch retains its
own current permission, command, deployment and effect-fence checks.
