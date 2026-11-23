# Feature 007 contracts

These contracts define the provider-neutral boundary for Project onboarding,
Project-scoped administration and cryptographically verifiable QA evidence.

## Contract map

- `schemas/common.v1.schema.json` - shared exact refs, hashes, actors and scopes;
- `schemas/project/project-onboarding-package.v1.schema.json` - Project registry,
  onboarding stage, capability mode, operational state and gate refs;
- `schemas/project/project-entitlement-revision.v1.schema.json` - audited grant,
  replacement and revoke revisions;
- `schemas/integration/binding-functional-acceptance.v1.schema.json` - QA Lead
  acceptance of an exact validated Binding;
- `schemas/integration/capability-probe-result.v1.schema.json` - safe immutable
  connector capability observation;
- `schemas/project/project-operational-action.v1.schema.json` - emergency suspend
  and exact resume candidate shapes;
- `schemas/qa/qa-project-context.v2.schema.json` - exact QA-owned Project policies
  and resource catalogs;
- `schemas/qa/project-environment-revision.v1.schema.json` - immutable non-product-
  production environment configuration reference;
- `schemas/qa/test-account-lease.v1.schema.json` - time-bounded account lease
  metadata without credentials;
- `schemas/qa/target-snapshot.v2.schema.json` - full immutable Session target and
  transitive configuration pins;
- `schemas/qa/evidence-manifest.v2.schema.json` - canonical signed content;
- `schemas/qa/evidence-signature-envelope.v1.schema.json` - detached JWS metadata;
- `schemas/qa/evidence-package.v1.schema.json` - Work Item package linking Session
  manifests and the human QA Verdict;
- `schemas/artifacts/artifact-retention-state.v1.schema.json` - availability and
  retention decisions outside signed content;
- `schemas/events/project-onboarding-events.v1.schema.json` - closed event payload
  union;
- `openapi/project-onboarding-evidence-api.v1.yaml` - HTTP boundary;
- `asyncapi/project-onboarding-evidence-events.v1.yaml` - event boundary.

## Compatibility rules

1. Feature 001 ProjectIntegrationBinding v1 and Feature 002/005 historical target
   and evidence schemas remain byte-identical.
2. New Feature 007 Sessions use Target Snapshot v2 and Evidence Manifest v2.
3. Existing Evidence Manifest v1 reads as `LEGACY_INTEGRITY_ONLY` and cannot count
   toward the Feature 007 pilot signature criterion.
4. Schema validation is necessary but not sufficient. Semantic validators enforce
   same Workspace/Project scope, JCS hashes, exact reference resolution, sorted set
   uniqueness, valid state transitions, fresh probes and separation of duties.
5. No client field can authoritatively set actor, authorization basis, scope,
   effective classification, content hash, timestamps or current Project mode.
6. Secret values, provider tokens, cookies, signed URLs and raw test data are
   forbidden in every schema.

## Hashing and signing

Semantic `contentHash` values use SHA-256 over RFC 8785/JCS canonical JSON. Evidence
signatures use a detached JWS over the canonical manifest payload. Signature
metadata is excluded from the manifest payload hash and stored as its own immutable
resource to avoid a circular digest.

## Gate semantics

L0 is fully runnable with repository mocks. C1/N2/P3 accept immutable deployment
metadata and produce `PASS`, `FAIL` or `BLOCKED_INPUT`. Missing corporate values are
never replaced with local defaults outside L0.
