# Data Model: Project onboarding, evidence and security

**Feature:** `007-project-onboarding-evidence-security`  
**Date:** 2026-09-03  
**Status:** Phase 1 design

## 1. Modeling rules

1. Every durable entity below carries `workspaceId`; every Project/content entity
   also carries `projectId`.
2. Stable headers are mutable only by expected-version CAS. Semantic revisions,
   validation/probe/gate results, signatures, audit and events are append-only.
3. `contentHash` is `SHA-256` over RFC 8785/JCS canonical semantic content.
   Lifecycle state, current availability and provenance pointers excluded from a
   content hash are named explicitly.
4. Exact references include ID, version and content hash whenever the target is a
   semantic revision. Header refs alone are insufficient for evidence or actions.
5. Credentials, tokens, cookies, signed URLs and raw test data are not valid model
   fields. Only opaque resolver refs and safe fingerprints are permitted.
6. Provider observations are facts, not Project state. Project state changes only
   through the onboarding aggregate transaction.

## 2. Shared value objects

### ExactRevisionRef

```text
id: UUID|string
version: integer >= 1
contentHash: sha256:<64 lowercase hex>
```

### SchemaBoundResourceRef

```text
key: stable key
schemaRef: { id, version, digest }
resourceRef: ExactRevisionRef
```

The referenced value must validate against `schemaRef`, and its JCS digest must
equal both `resourceRef.contentHash` and the surrounding content hash input.

### HumanActorSnapshot

```text
principalId
kind: HUMAN
roleKey
authorizationBasisRef
authenticationContextRef
stepUpAt?                  # mandatory only for policy-classified privileged actions
```

The actor snapshot is evidence of a decision. It is not reused as current
authorization; authorization is recalculated when an action is consumed.

### ClassificationReference

```text
key
rank
catalogVersion
```

When multiple resources contribute content, the effective classification is the
highest rank. Unknown keys fail closed.

## 3. Core Project and onboarding entities

### 3.1. ProjectHeader (existing `projects` identity/current projection)

| Field | Rule |
|---|---|
| `id` | Stable internal `projectId`; never derived from Jira/GitLab/Mattermost |
| `workspaceId` | Immutable owning Workspace |
| `key`, `name` | Current display projection; unique key in Workspace |
| `registrationStatus` | `ACTIVE|ARCHIVED`; not capability or suspension |
| `currentRegistryVersion` | Exact latest ProjectRegistryRevision version |
| `rowVersion` | CAS token |

Compatibility columns on the existing table may remain during expand/contract,
but they are projections from the revision/onboarding heads and never independent
authorities.

### 3.2. ProjectRegistryRevision

| Field | Rule |
|---|---|
| `revisionId` | UUID primary key |
| `workspaceId`, `projectId`, `version` | Unique semantic revision identity |
| `key`, `name` | Stable/display project identifiers |
| `businessOwnerId`, `technicalOwnerId`, `qaOwnerId`, `securityOwnerId`, `escalationOwnerId` | HUMAN identities with active Workspace membership at publication |
| `criticalityKey` | Registered policy value |
| `dataClassificationKey` | Authoritative Project classification |
| `verificationStatus` | `CURRENT|DUE|NEEDS_REVIEW` |
| `lastVerifiedAt`, `nextVerificationAt` | Optional until verification policy is published |
| `reason`, `createdBy`, `createdAt` | Required provenance |
| `contentHash` | Covers semantic fields and owner IDs |

Revision 1 is created with the Project. Later owner/name/classification changes
append a revision; stable `projectId` and `workspaceId` cannot change.

### 3.3. ProjectOnboardingHeader

| Field | Rule |
|---|---|
| `onboardingId` | One per `(workspaceId, projectId)` |
| `workspaceId`, `projectId` | Composite scope and FK |
| `currentVersion` | Latest immutable revision |
| `currentStage` | Projection of latest revision |
| `currentCapabilityMode` | Projection of latest revision |
| `currentOperationalState` | Projection of latest revision |
| `intendedCapabilityMode` | Preserved through suspension |
| `rowVersion` | CAS/lock token |

### 3.4. ProjectOnboardingRevision

```text
revisionId
workspaceId, projectId, onboardingId, version
onboardingStage: DRAFT | VALIDATING | NEEDS_FIX | SHADOW | PILOT_ACTIVE
qaCapabilityMode: MANUAL_ONLY | FULL_QA
projectOperationalState: ACTIVE | SUSPENDED
intendedCapabilityMode: MANUAL_ONLY | FULL_QA
projectRegistryRef: ExactRevisionRef
bindingRef?: ExactRevisionRef
qaProjectContextRef?: ExactRevisionRef
starterEntitlementSetHash
gateResultRefs[]: ExactRevisionRef
ownerSetHash
reasonCode, reason
incidentRef?
actor: HumanActorSnapshot
correlationId, causationId?
createdAt
contentHash
```

`bindingRef` and `qaProjectContextRef` are absent in early DRAFT revisions and
required from SHADOW. `PILOT_ACTIVE` requires all applicable P3 gate results PASS.
`SUSPENDED` may coexist with SHADOW or PILOT_ACTIVE and preserves
`intendedCapabilityMode`.

### 3.5. ProjectOnboardingGateResult

```text
gateResultId, version=1
workspaceId, projectId
gateKind: L0 | C1 | N2 | P3
checkKey, checkVersion
subjectRefs[]
outcome: PASS | FAIL | BLOCKED_INPUT
safeIssueCodes[]
evidenceRefs[]
evaluatedBy: HUMAN | SERVICE actor snapshot
evaluatedAt, validUntil?
contentHash
```

Gate results never contain secret values or raw provider responses. A result can
expire; expiry does not mutate it and simply makes it ineligible for a new
transition.

### 3.6. WorkspaceProjectRolloutLease

```text
workspaceId                       # primary key
holderProjectId
leaseVersion
acquiredBy
acquiredAt, expiresAt
purpose: FIRST_PILOT_ACTIVATION
rowVersion
```

The lease is required only for the first transition of a Project to
`PILOT_ACTIVE`. Expiry/recovery is deterministic and audited.

## 4. Project Entitlement entities

### 4.1. ProjectEntitlementHeader/current projection

The existing `project_entitlements` row remains the hot authorization projection.
Feature 007 adds an exact semantic version and a revision ledger.

```text
entitlementId
workspaceId, projectId, principalId
currentVersion
effect: ALLOW | DENY
permissions[]
classificationCeilingKey
validFrom, validUntil?, revokedAt?
rowVersion
```

There may be multiple entitlement IDs for a principal, but an exact permission is
denied if any current matching DENY applies. Duplicate equivalent active grants are
rejected.

### 4.2. ProjectEntitlementRevision

```text
revisionId
entitlementId, version
workspaceId, projectId, principalId
operation: GRANT | REPLACE | REVOKE
effect
permissions[]                    # canonical sorted unique set
classificationCeilingKey
validFrom, validUntil?, revokedAt?
previousRevisionRef?
actor: HumanActorSnapshot
reason
correlationId
createdAt
contentHash
```

Revoke appends a revision and atomically updates the current projection. Business
data and historical evidence are not moved or deleted.

## 5. Integration Binding entities

### 5.1. ProjectIntegrationBindingHeader/Revision (existing, completed)

The normative semantic content remains Feature 001 v1:

```text
bindingId, workspaceId, projectId, version
state: DRAFT | VALIDATED | PUBLISHED | RETIRED
dataClassificationKey
entries[] {
  capabilityKey, exactContractVersion, logicalRole, environmentScope,
  classificationCeilingKey, profileRef, externalScope
}
configurationRefs[]
resourceRefs[]
schemaVersion, contentHash, resourceVersion
validationReportId?
createdAt, validatedAt?, publishedAt?, retiredAt?
```

Header invariant: at most one current PUBLISHED version. Entry uniqueness is
`(projectId, environmentScope, capabilityKey, logicalRole)` within a revision.
`validationReportId` and lifecycle timestamps are excluded from semantic content
hash but constrained by state.

### 5.2. BindingFunctionalAcceptance

```text
acceptanceId, version=1
workspaceId, projectId
bindingRef: ExactRevisionRef
validationReportRef: ExactRevisionRef
qaProjectContextRef: ExactRevisionRef
acceptedResourceRefs[]
checklistRef: ExactRevisionRef
outcome: ACCEPTED | REJECTED
safeIssueCodes[]
acceptedBy: HumanActorSnapshot       # QA Lead
acceptedAt
contentHash
```

Only `ACCEPTED` for the exact candidate is eligible for publish. A newer Binding or
QA context invalidates it without changing the record.

### 5.3. CapabilityProbeResult

```text
probeId, version=1
workspaceId, projectId
bindingRef, profileRef, connectionRef: ExactRevisionRef
mappingRef?: ExactRevisionRef
validationReportRef: ExactRevisionRef
logicalRole, capabilityKey, exactContractVersion, operation
environmentScope
status: AVAILABLE | DEGRADED | UNAVAILABLE
safeIssueCodes[]
observedAt, validUntil
actorKind: SERVICE
contentHash
```

Only safe normalized issue codes are persisted. Provider response payloads and
credentials remain in Connector-local diagnostics subject to policy.

### 5.4. CapabilityModeAssessment

```text
assessmentId, version=1
workspaceId, projectId
bindingRef, qaProjectContextRef, requirementSetRef
probeRefs[]
manualRequirements: SATISFIED | UNSATISFIED
automationRequirements: SATISFIED | UNSATISFIED
pilotMessagingRequirement: SATISFIED | DEGRADED | UNSATISFIED
derivedMode: MANUAL_ONLY | FULL_QA
reasonCodes[]
evaluatedAt
contentHash
```

Mode assessment is immutable. The onboarding revision chooses an exact current
assessment; it never stores an untraceable boolean.

### 5.5. PlatformAction extensions

Existing `PlatformAction`/`Approval` uses four new action kinds:

- `BINDING_PUBLISH`
- `BINDING_RETIRE`
- `PROJECT_RESUME`
- `ONBOARDING_PILOT_ACTIVATE`

Each action pins one candidate revision, aggregate header version, required
acceptance/gate/probe refs, target hash and initiator. The existing closed
`PLATFORM_ACTION` Approval subject remains the approval contract; no second
consumption reference is added.

Emergency suspend is not an Approval action. It is a direct, capability-reducing
command with exact Project header/onboarding version and audit.

## 6. QA Project Context and resources

### 6.1. QaProjectContextRevision v2

```text
contextId, version
workspaceId, projectId
state: PUBLISHED | RETIRED
environmentRefs[]
testDataCatalogRefs[]
accountPoolRefs[]
targetPolicyRefs[], scopePolicyRefs[], checklistPolicyRefs[]
defaultTargetPolicyRef, defaultScopePolicyRef, defaultChecklistRefs[]
evidencePolicyRef, retentionPolicyRef, redactionPolicyRef, exportPolicyRef
riskReviewPolicyRef, dorRuleSetRef, dodRuleSetRef
capabilityRequirementSetRef
maximumClassificationKey
createdBy, publishedBy, publishedAt
contentHash, resourceVersion
```

V1 remains readable. V2 is required for new Feature 007 onboarding.

### 6.2. QaEnvironmentHeader and QaEnvironmentRevision

```text
environmentId
workspaceId, projectId
key, currentVersion, currentPublishedVersion, rowVersion

revisionId, version
name
scope: LOCAL | NON_PROD | PREPROD
ownerPrincipalId
dataClassificationKey
status: DRAFT | PUBLISHED | RETIRED
configurationRef: SchemaBoundResourceRef
allowedTestDataPolicyRefs[]
contentHash
createdBy, createdAt, publishedAt?, retiredAt?
```

`PLATFORM_PROD` is not a valid QA test environment in this feature. The
configuration ref may resolve an endpoint alias or infrastructure descriptor but
never a secret value.

### 6.3. QaTestDataCatalogEntry

```text
entryId, version
workspaceId, projectId
kind: DATASET | PREPARATION_PROCEDURE
externalRef: ExactRevisionRef
ownerPrincipalId
allowedEnvironmentRefs[]
dataClassificationKey
retentionPolicyRef
state: PUBLISHED | RETIRED
contentHash
```

The entry describes a reference and policy only. Dataset content remains external.

### 6.4. QaAccountPoolReference

```text
poolId, version
workspaceId, projectId
environmentRef: ExactRevisionRef
resolverRef: SchemaBoundResourceRef
ownerPrincipalId
maximumConcurrentLeases
maximumLeaseDurationSeconds
dataClassificationKey
state: PUBLISHED | RETIRED
contentHash
```

`resolverRef` is an opaque runtime lookup contract. It cannot contain a username,
password, token or cookie.

### 6.5. QaTestAccountLease

```text
leaseId, version
workspaceId, projectId
poolRef, environmentRef: ExactRevisionRef
subject: { kind: WORK_ITEM | SESSION, id, version?, contentHash? }
leasedToPrincipalId
opaqueAccountRef
state: ACTIVE | RELEASED | EXPIRED | REVOKED
acquiredAt, expiresAt
releasedAt?, revokedAt?
reasonCode?
createdBy
contentHash
resourceVersion
```

One pool-account slot may have at most one ACTIVE unexpired lease. Lease expiry or
revoke appends a lifecycle revision/current-state projection; existing Target
Snapshots continue to reference the historical lease.

## 7. Exact Target Snapshot v2

```text
snapshotId, version=1
schemaVersion: qa-target-snapshot@2.0.0
workspaceId, projectId, workItemId, sessionId
mode: MANUAL | AUTOMATED
sourceRefs[]
buildRef: ExactRevisionRef
environmentRef: ExactRevisionRef
testDataRefs[]: ExactRevisionRef
accountLeaseRefs[]: ExactRevisionRef
definitionRefs[]: ExactRevisionRef
configurationPins[] {
  ordinal, logicalRole, capabilityKey, exactContractVersion,
  bindingRef, profileRef, connectionRef, mappingRef?, validationReportRef,
  operationSetHash, externalScopeHash
}
policyRefs[]
modeConfiguration: SchemaBoundValue
capturedAt
contentHash
```

The full snapshot validates against its schema and is immutable. All configuration
pins use one exact Binding revision. The environment belongs to the same Project,
is PUBLISHED/non-production and was eligible at capture. At least one test-data or
account-lease ref is required by the current QA policy. An expired lease after
capture changes start eligibility but not the snapshot.

## 8. Evidence entities

### 8.1. QaEvidenceManifestHeader

```text
manifestId
workspaceId, projectId, workItemId, sessionId
currentRevision
currentAdjudicativeRevision
rowVersion
```

One Session has one logical manifest header. All versions are retained.

### 8.2. QaEvidenceManifestRevision v2

```text
manifestRevisionId, manifestId, version
kind: INITIAL | SUBSTANTIVE_CORRECTION | CLERICAL
previousRevisionRef?
correctionReason?
workspaceId, projectId, workItemId, sessionId
workTypeDefinitionRef
targetSnapshot: { schemaRef, value, contentHash }
scopeSnapshotRef
planItemResults[]
attempts[]
observations[]
frozenFindingReviewRefs[]
artifactMembers[] {
  artifactRef, checksum, classificationKey,
  availabilityAtSigning, retentionPolicyRef
}
sessionOutcome
outcomeSummary
definitionRefs[], ruleRefs[], policyRefs[]
bindingRefs[], profileRefs[], connectionRefs[], mappingRefs[]
humanAttestation: HumanActorSnapshot + attestedAt
correlationId, causationId
effectiveClassificationKey
createdAt
contentHash
```

`contentHash` covers every semantic field above except itself. The full target
snapshot is embedded as a schema-bound value. `previousRevisionRef` is forbidden
for INITIAL and required for corrections. A correction cannot change Workspace,
Project, Work Item or Session identity.

### 8.3. EvidenceSignatureEnvelope

```text
signatureId, version=1
workspaceId, projectId
manifestRevisionRef: ExactRevisionRef
payloadHash
serialization: JCS_RFC8785
format: JWS_DETACHED
protectedHeader: { alg: EdDSA, kid, typ: application/awp-evidence+json }
signature
signingPolicyRef
publicKeyRef
signedAt
contentHash
```

The private key is never stored. `(manifestRevisionRef, signingPolicyRef)` is
unique. Verification recomputes JCS bytes, payload hash, JWS input and public-key
resolution. A valid signature does not bypass current read authorization.

### 8.4. QaEvidencePackage

```text
packageId, version
workspaceId, projectId, workItemId
manifestRevisionRefs[]
signatureRefs[]
qaVerdictRef: ExactRevisionRef
residualRiskHash
packagePolicyRef
createdBy: HumanActorSnapshot
createdAt
contentHash
```

The package is created only after the human Verdict exists and all required
manifests verify. Correction creates a new package version; previous packages stay
immutable.

### 8.5. EvidenceVerificationResult

```text
verificationId, version=1
workspaceId, projectId
subjectKind: MANIFEST | PACKAGE
subjectRef
status: VALID | INVALID | KEY_UNAVAILABLE
verifiedContentHash
signatureRefs[]
safeIssueCodes[]
verifiedAt
verifierPolicyRef
contentHash
```

This result is an observation. It does not mutate the signed subject.

## 9. Artifact retention and export entities

### 9.1. ArtifactAvailabilityRevision

```text
availabilityRevisionId
workspaceId, projectId, artifactId, version
state: AVAILABLE | EXPIRED | QUARANTINED | UNAVAILABLE
reasonCode
observedObjectVersionOrEtag?
observedChecksum?
observedAt
source: PROVIDER | RETENTION_WORKER | SECURITY_REVIEW
previousRevisionRef?
contentHash
```

The current projection may change; signed manifest membership does not.

### 9.2. ArtifactRetentionDecision

```text
decisionId, version=1
workspaceId, projectId, artifactId
retentionPolicyRef
legalHoldRef?
decision: RETAIN | EXPIRE | QUARANTINE
eligibleAt
effectiveAt?
ownerPrincipalId
reasonCode
createdAt
contentHash
```

An EXPIRE decision cannot execute while a current legal hold applies. Provider-side
expiry is still recorded as an availability observation.

### 9.3. EvidenceExportRecord

```text
exportId, version=1
workspaceId, projectId
subjectRef
requestedBy: HumanActorSnapshot
authorizationBasisRef
redactionPolicyRef, exportPolicyRef
includedManifestRefs[], includedArtifactRefs[]
resultHash
status: COMPLETED | DENIED | FAILED
safeReasonCode
correlationId
createdAt
contentHash
```

The record contains no exported bytes or secret locator. The export stream is
short-lived and requires the same current authorization during streaming.

## 10. Relationships

```text
Workspace 1 ── * ProjectHeader 1 ── * ProjectRegistryRevision
                         │
                         ├── 1 ProjectOnboardingHeader ── * OnboardingRevision
                         │                                  └── * GateResult refs
                         ├── * ProjectEntitlementHeader ── * EntitlementRevision
                         ├── * BindingHeader ── * BindingRevision
                         │                      ├── * FunctionalAcceptance
                         │                      └── * CapabilityProbeResult
                         └── * QaProjectContextRevision
                                ├── * EnvironmentRevision
                                ├── * TestDataCatalogEntry
                                ├── * AccountPoolReference ── * TestAccountLease
                                └── * Session ── 1 TargetSnapshot
                                              └── 1 EvidenceManifestHeader
                                                     └── * ManifestRevision
                                                            └── 1 SignatureEnvelope

WorkItem 1 ── * Session manifests ── 1..* EvidencePackage versions ── 1 Verdict
ArtifactReference 1 ── * AvailabilityRevision
                  └── * RetentionDecision
```

All cross-table foreign keys include Workspace and Project where both are known.
No unscoped ID lookup is accepted by a repository.

## 11. State transitions

### Project onboarding

| From | Command | To | Guards |
|---|---|---|---|
| none | register | DRAFT/MANUAL_ONLY/ACTIVE | stable ID, owners, classification, starter admin entitlement |
| DRAFT or NEEDS_FIX | validate | VALIDATING | exact candidate refs and current actor authorization |
| VALIDATING | record failure | NEEDS_FIX | immutable failing gate result |
| VALIDATING | accept shadow | SHADOW | required L0/C1 results, published Binding/context, functional acceptance |
| SHADOW | activate pilot | PILOT_ACTIVE | P3 results, rollout lease, exact Owner approval |
| any non-archived ACTIVE | emergency suspend | same stage/SUSPENDED | Integration Administrator, reason, incident, CAS |
| any SUSPENDED | resume | same stage/ACTIVE | fresh probes, incident disposition, exact distinct Owner approval |

### Binding

```text
DRAFT --successful validate--> VALIDATED --exact approved publish--> PUBLISHED
PUBLISHED --exact approved retire--> RETIRED
historical semantic clone --> new DRAFT version
```

Failed validation appends a report and leaves DRAFT unchanged. Publication retires
the former current version atomically.

### Account lease

```text
ACTIVE → RELEASED
ACTIVE → EXPIRED
ACTIVE → REVOKED
```

Terminal states do not return to ACTIVE. A new lease uses a new ID.

### Evidence

```text
Session REVIEW_REQUIRED
  → candidate built and signed
  → manifest revision + signature + Session COMPLETED committed atomically

INITIAL v1 → correction v2 → correction v3 ...
```

No transition mutates a prior manifest or signature.

## 12. Database constraints and indexes

- unique Project key: `(workspace_id, key)`;
- unique revision numbers per header;
- one onboarding header per `(workspace_id, project_id)`;
- one current published Binding per header, enforced under header lock and partial
  uniqueness where practical;
- Binding entry uniqueness on the exact logical-role/capability/environment tuple;
- all post-DRAFT Binding states require a matching successful immutable Validation
  Report; DRAFT forbids `validation_report_id`;
- one accepted functional-acceptance record per exact Binding content hash and
  checklist version;
- probe `valid_until > observed_at` and exact same-scope chain;
- unique `(workspace_id, project_id, entitlement_id, version)`;
- terminal entitlement/lease/evidence revisions are immutable by trigger and
  repository contract;
- one active account lease per pool-account slot;
- one signature per exact manifest revision and signing policy;
- evidence predecessor version increments exactly by one and cannot form a cycle;
- artifact availability revisions are monotonic per artifact;
- all authorization hot paths index `(workspace_id, project_id, principal_id,
  state/effect)` before content joins.

## 13. Transaction boundaries

### Registration

One transaction inserts Project header, revision 1, onboarding header/revision 1,
starter entitlement revisions/current rows, audit and events. Partial registration
is impossible.

### Entitlement change

Lock entitlement/current-set head, verify expected version and initiator authority,
append revision, update current projection, invalidate affected cursors/grants,
write audit/outbox, commit.

### Binding publish/retire

Lock Project/onboarding and Binding headers, reauthorize action/approver, validate
exact candidate/report/acceptance/probes and current published pointer, CAS-consume
Approval, apply state changes, append onboarding/mode assessment if needed, write
audit/outbox, commit.

### Emergency suspension

Lock Project/onboarding, verify expected version, append SUSPENDED revision,
invalidate pending pre-invocation effects and new leases/sessions, enqueue
notifications, write audit, commit. Provider calls are outside the transaction.

### Evidence completion

Build/sign outside the DB transaction. Then lock Session and manifest header,
recheck candidate hashes and current authorization, insert manifest/signature,
complete Session, update evidence projection, write audit/outbox, commit.

## 14. Migration mapping

| Migration | Tables/changes |
|---|---|
| Core `0150` | `project_registry_revisions`, `project_onboarding_headers`, `project_onboarding_revisions`, `project_onboarding_gate_results`, `workspace_project_rollout_leases` |
| Core `0155` | `project_entitlement_revisions`, current-set versioning, `binding_functional_acceptances`, `capability_probe_results`, `capability_mode_assessments`, platform-action constraints |
| Core `0160` | `artifact_availability_revisions`, `artifact_retention_decisions`, `evidence_export_records` and access indexes |
| QA `2080` | QA context v2 columns/tables, `qa_environment_*`, `qa_test_data_catalog_entries`, `qa_account_pool_references`, `qa_test_account_leases` |
| QA `2085` | `qa_target_snapshots_v2`, manifest-v2 payload support, `qa_evidence_signatures`, `qa_evidence_packages`, `qa_evidence_verification_results` |

Feature 006-to-007 backfill creates deterministic Project registry/onboarding
revisions from existing rows. It does not manufacture pilot gate PASS, a
cryptographic signature or historical lease data. Existing manifest v1 remains
readable with `LEGACY_INTEGRITY_ONLY` status.
