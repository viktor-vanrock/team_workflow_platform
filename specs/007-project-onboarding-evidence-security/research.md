# Research: Project onboarding, evidence and security

**Feature:** `007-project-onboarding-evidence-security`  
**Date:** 2026-09-03  
**Status:** Phase 0 complete - all implementation questions resolved

## 1. Dependency and implementation entry gate

**Decision:** implement Feature 007 only on a source-bound fresh Feature 006 PASS.
The planning baseline is commit `2c5f3d6`; `verify:007:prerequisites` must verify
the current source, contract and migration digests rather than trust a task list or
copied report.

**Rationale:** onboarding changes authorization, configuration and evidence paths
consumed by every earlier feature. A stale prerequisite could produce a locally
green onboarding flow over queue, approval or migration semantics that no longer
match the checkout.

**Alternatives considered:** trust the Feature 006 commit alone; trust only
`final-gate.json`; rerun all history manually. Rejected because a commit does not
prove generated artifacts, a report may be stale, and the existing digest-bound
gate pattern is more precise.

## 2. Feature boundary versus Feature 008

**Decision:** Feature 007 owns provider-neutral onboarding domain contracts,
local L0 acceptance and C1/N2/P3 evidence shapes. It reuses the existing
`qa-jira-gitlab-mattermost-local` composition. Corporate OIDC/secret/observability
wiring, real non-prod endpoints, backup/restore and pilot operation remain 008.

**Rationale:** the current non-local API composition does not yet wire the full
Project/Integration/Audit control plane. Making corporate deployment a 007
requirement would mix domain completion with environment-specific rollout and
duplicate the purpose of 008.

**Alternatives considered:** wire a production-like deployment in 007; create a
new onboarding microservice; add another local composition key. Rejected because
they expand scope, introduce a distributed boundary, or duplicate the already
complete local connector contour.

## 3. Project registry and independent state dimensions

**Decision:** keep the existing `projects` record as stable identity/current read
header, add immutable Project registry and onboarding revisions, and model
`onboardingStage`, `qaCapabilityMode` and `projectOperationalState` independently.
Archive remains a registry lifecycle, not suspension.

**Rationale:** capability availability and emergency effect denial answer different
questions. A suspended full-QA Project must remember its intended mode without
allowing new work, while a manual-only Project may still be operational.

**Alternatives considered:** one combined status enum; encode capability by the
presence of a GitLab Profile; treat archived as suspended. Rejected because each
creates invalid state combinations, loses intent or silently derives authority
from configuration presence.

## 4. Sequential onboarding

**Decision:** allow many registered Projects but serialize only each Project's
first `PILOT_ACTIVE` promotion through a Workspace rollout lease. Already onboarded
Projects continue ordinary operations independently.

**Rationale:** the constitution requires one reference Project followed by
sequential onboarding packages. A narrow promotion lock enforces that without
turning the whole Workspace into a single-threaded runtime.

**Alternatives considered:** documentation-only sequencing; one global lock for
all Project mutations; one Workspace per Project. Rejected because the first is not
enforceable, the second harms normal throughput, and the third breaks the shared QA
Workspace model.

## 5. Project Entitlement mutation and access evaluation

**Decision:** represent grant/replace/revoke as append-only revisions plus a current
authorization projection updated atomically under expected-version CAS. Apply the
same default-deny policy before data access, aggregation, cursor creation, event
subscription and export.

**Rationale:** revocation must be immediate and auditable without migrating Work
Items. Filtering after lookup leaks existence, counts or timing and does not protect
background work.

**Alternatives considered:** overwrite the entitlement row; frontend filtering;
derive access from Jira visibility or Workspace Owner status. Rejected because they
lose history or violate the four-way policy intersection.

## 6. Existing Binding v1 versus a new Core version

**Decision:** retain the published Feature 001 ProjectIntegrationBinding v1 and
make runtime TypeScript/persistence conform to it, including
`configurationRefs[]`, `resourceRefs[]`, lifecycle timestamps and canonical
environment scopes. Do not create a new Core binding schema merely to implement
already-specified fields.

**Rationale:** the normative v1 JSON Schema already contains the Feature 007 domain
contract. Mutating or replacing it would create unnecessary compatibility work and
could reinterpret earlier commands.

**Alternatives considered:** publish Binding v2; store QA environment/suite fields
as Core columns; embed arbitrary JSON. Rejected because v1 is sufficient, Pack
semantics belong to QA, and unbound JSON is not verifiable.

## 7. Validation, functional acceptance and publication

**Decision:** separate mechanical Binding validation, QA Lead functional
acceptance and Workspace Owner publication. Publish/retire are exact
`PLATFORM_ACTION` branches consumed in one serializable PostgreSQL transaction.
Rollback clones old semantic content into a new DRAFT and repeats all gates.

**Rationale:** a connector probe cannot confirm that mappings, environments and
evidence policy are functionally acceptable; a QA Lead acceptance cannot replace
Owner authorization. Revalidation is required because historical configuration may
no longer meet current policy.

**Alternatives considered:** publish directly after validation; let the Integration
Administrator self-approve; reactivate an old RETIRED row. Rejected for separation
of duties, stale policy risk and immutable-history requirements.

## 8. Capability probes and QA mode

**Decision:** persist immutable probe results for the exact Binding/Profile/
Connection/Mapping chain. Let the QA Pack publish a versioned requirement matrix
that deterministically derives `MANUAL_ONLY` or `FULL_QA`. Mattermost is a separate
P3 readiness requirement whose outage enables web/outbox degradation but does not
downgrade QA execution mode.

**Rationale:** Core must remain unaware of QA logical-role semantics, while mode
must be explainable from exact current facts. Connector health is an observation,
not the authority to change a Project by itself.

**Alternatives considered:** Core enum for Jira/GitLab/Mattermost roles; mutable
boolean `hasAutomation`; mode based only on Profile presence. Rejected for Pack
ownership, auditability and false-positive availability.

## 9. Suspension as an effect boundary

**Decision:** implement one shared Project effect guard at command/session/lease
creation and immediately before first provider invocation/start. Emergency suspend
is an audited fail-safe command without a second approval; resume is an exact
Owner-approved platform action with fresh probes and incident disposition.

**Rationale:** checking only at the UI or command boundary leaves a time-of-check/
time-of-use window. Suspension must stop new effects while still permitting
authorized investigation and idempotent read-only reconciliation of an already
invoked effect.

**Alternatives considered:** disable Profiles only; cancel/delete all commands;
require dual approval to suspend. Rejected because Profile state is not Project
state, deleting history breaks recovery, and a fail-safe capability reduction must
be immediate.

## 10. QA Project Context and resource catalogs

**Decision:** publish QA Project Context v2 with exact schema-bound references to
immutable environments, test-data procedures/datasets, account pools and evidence/
retention/redaction policies. Store no raw data or credentials in these records.

**Rationale:** these are QA-specific readiness and execution semantics. Generic
Core references preserve extension boundaries while exact versions make Sessions
reproducible.

**Alternatives considered:** add environment/suite/account columns to Core Binding;
store connection parameters or test accounts in JSON; rely on display names.
Rejected because they leak secrets, mix ownership and permit mutable aliases.

## 11. Test Account Lease

**Decision:** model a lease as a scoped, time-bounded QA record with one subject,
owner, exact environment/account-pool refs and lifecycle
`ACTIVE → RELEASED|EXPIRED|REVOKED`. The credential itself is resolved only in the
runtime adapter. Lease acquisition is denied while Project is suspended.

**Rationale:** target reproducibility requires an immutable lease reference, while
least privilege requires the usable secret to remain outside business state.

**Alternatives considered:** store a username/password in the Session; share one
mutable test account; represent a lease only as free text. Rejected for secret
exposure, concurrency ambiguity and unverifiable lineage.

## 12. Target snapshot compatibility

**Decision:** keep existing manual/automated target schemas readable and publish an
additive exact Target Snapshot v2 for new Sessions. It pins environment and
test-data/lease content hashes plus exact Binding/Profile/Connection/Mapping/
Validation Report refs. Evidence embeds the full schema-bound snapshot, not only a
hash.

**Rationale:** current manual snapshots do not pin the full transitive configuration
chain, and current v1 manifests store only target/scope hashes. Historical schemas
must not be silently reinterpreted.

**Alternatives considered:** resolve latest configuration during evidence read;
rewrite old snapshots; store only display names. Rejected because they destroy
reproducibility and violate published-contract immutability.

## 13. Cryptographic evidence format

**Decision:** define Evidence Manifest v2 as a JCS-canonical payload plus detached
JWS signature envelope. `contentHash` covers the payload and excludes the signature;
the protected header pins `alg`, `kid` and media type. A provider-neutral port owns
sign/verify; local L0 uses EdDSA/Ed25519. Human review attestation remains inside
the payload and is distinct from the platform key that cryptographically seals it.

**Rationale:** RFC 8785 provides deterministic JSON canonicalization for repeatable
hashing/signing, RFC 7515 defines JWS and detached content, and RFC 8037 defines
EdDSA/Ed25519 use in JOSE. The repository already has RFC 8785 hashing and JOSE
support, so no new third-party dependency is needed.

Primary references:

- [RFC 8785 - JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html)
- [RFC 7515 - JSON Web Signature](https://www.rfc-editor.org/rfc/rfc7515.html)
- [RFC 8037 - EdDSA for JOSE](https://www.rfc-editor.org/rfc/rfc8037.html)

**Alternatives considered:** retain the current hash-of-metadata helper as a
signature; sign non-canonical `JSON.stringify` output; use a shared-secret MAC;
embed signature in its own content hash. Rejected because these provide no
asymmetric verification, are serialization-sensitive, broaden secret distribution
or create a hash cycle.

## 14. Signature transaction boundary

**Decision:** obtain a signature over an exact Session-review candidate, then enter
a serializable transaction that rechecks the Session snapshot and atomically stores
manifest+signature and completes the Session. Failure leaves the Session in
`REVIEW_REQUIRED`; idempotent retry commits or returns one revision.

**Rationale:** an external signer/KMS cannot join the PostgreSQL transaction. The
CAS recheck avoids signing stale state without requiring distributed commit.

**Alternatives considered:** complete Session before signing; hold a DB transaction
open across remote signing; persist unsigned completed manifests. Rejected because
they violate completion rules or create fragile long-running transactions.

## 15. Evidence corrections and Work Item package

**Decision:** every correction creates a new manifest revision and signature with
an exact predecessor hash. A separate immutable Work Item Evidence Package links
accepted Session manifests to the later human-signed QA Verdict.

**Rationale:** Session evidence exists before the Work Item Verdict. Mutating the
Session manifest later or predeclaring a Verdict would falsify chronology.

**Alternatives considered:** update manifest in place; add a nullable future Verdict
field and fill it later; copy all Session content into the Work Item Verdict.
Rejected because they break immutability or duplicate authority.

## 16. Artifact classification, retention and availability

**Decision:** keep immutable artifact metadata/checksum in signed evidence and
track current availability through append-only revisions outside the signature.
Classification is the maximum of all contributing facts. Retention decisions pin
exact policy and legal-hold result; every read/export reauthorizes and verifies.

**Rationale:** binary expiry is expected mutable reality, while the evidence of
what was reviewed must remain immutable. Re-signing a manifest on every provider
availability change would make history misleading.

**Alternatives considered:** delete metadata with the binary; mutate availability
inside the signed manifest; assume a raw provider URL grants access; always copy to
S3. Rejected because they lose audit evidence, invalidate signatures, bypass policy
or guess the pilot storage requirement.

## 17. Audit, events and observability

**Decision:** every administrative mutation writes actor, exact authorization
basis, before/after semantic hashes, reason, correlation/causation and idempotency
in the same transaction. Events are immutable, Project-scoped and at-least-once;
metrics use bounded reason/status labels without content identifiers.

**Rationale:** asynchronous consumers must be able to reconstruct scope and safely
replay, while security telemetry must not become a cross-Project side channel.

**Alternatives considered:** log-only audit; unscoped Workspace events; raw provider
errors as labels. Rejected because logs are not canonical durable state and dynamic
labels/payloads leak sensitive details.

## 18. Migrations and historical compatibility

**Decision:** use additive Core `0150/0155/0160` and QA `2080/2085` migrations with
fresh, 006-upgrade, repeat and recovery tests on PostgreSQL 17 and 18. Bootstrap
existing Projects deterministically but mark old evidence
`LEGACY_INTEGRITY_ONLY`; do not claim retrospective cryptographic signatures or P3
completion.

**Rationale:** existing local history is valid evidence of earlier contracts, but
it cannot satisfy guarantees that were not recorded at creation time.

**Alternatives considered:** edit old migrations; backfill invented signature/gate
facts; destructive table replacement. Rejected because they rewrite history and
break migration reproducibility.

## 19. Performance and scale

**Decision:** do not invent numerical SLOs before Feature 008 baseline. Enforce
structural performance gates: cursor pagination, authorization before aggregation,
bounded query count, no Connector/model calls on catalog/evidence metadata reads,
batched retention/probe workers and low-cardinality telemetry.

**Rationale:** the first release has one reference Project and sequential rollout;
numeric targets require measured deployment data. Structural bounds are testable
now and prevent obvious N+1/security regressions.

**Alternatives considered:** set arbitrary latency/throughput numbers; perform live
provider reads on every UI request; cache unscoped lists. Rejected because the first
is unverifiable and the latter two couple availability or leak scope.

## 20. Final clarification status

All product and architecture decisions required for Phase 1 are resolved. Corporate
values remain typed gate inputs with explicit blocked outcomes and do not block
implementation of the local and provider-neutral design.
