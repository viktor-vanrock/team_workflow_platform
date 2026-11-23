# Feature 005 contract package

This directory is the Phase 1 interface package for
`005-gitlab-automated-validation`. It adds provider-neutral automated QA
contracts and one GitLab adapter dialect without granting GitLab, the
Connector, Mock Hub or Hermes authority over Jira workflow, Findings, Session
Outcome, QA Verdict or release decisions.

The package is a design input for implementation. A listed schema, example or
runtime entrypoint that has not landed yet is **planned**, not passing evidence.

## Authority and interpretation

Authority is deliberately split:

| Subject | Authority |
|---|---|
| Product/security invariants | Constitution 2.0.0, then `spec.md`, then `plan.md` |
| Capability identity, operation set and provider-neutral semantics | [capabilities.md](capabilities.md) |
| Serialized request/result/entity shape | Exact JSON Schema `$id`, version and digest under `schemas/` |
| Platform HTTP transport, headers, status and RFC 9457 errors | OpenAPI document |
| Event channel, envelope and payload schema identity | AsyncAPI document plus referenced JSON Schema |
| GitLab project/ref/job/input mapping and provider behavior | One immutable validated GitLab Profile version |
| Source, pipeline, job and raw artifact facts | GitLab, observed through the pinned Connector Profile |
| Work Item operational state | Jira through Feature 003 authority contracts |
| Attempt review, Finding classification, Session Outcome and QA Verdict | QA domain and an authorized HUMAN |

Examples are conformance fixtures, not an additional source of semantics. This
README is navigation and compatibility policy; it cannot weaken a schema or a
higher-authority invariant. A conflict fails publication rather than selecting
the more permissive interpretation.

Schema digests and schema-bound root `contentHash` values use the exact JCS
projection in `data-model.md` section 2.1. The pipeline-result artifact list never
lists the machine-result JSON itself: its source bytes/hash are recorded by the
Connector as `sourceResultArtifactRef`, while the result manifest contains only
detached evidence artifacts and therefore cannot be self-referential.

## Artifact catalog

- [capabilities.md](capabilities.md) — the three exact capability identities,
  operations, trusted context, provider-neutral request/result boundaries,
  effect recovery and prohibited surface;
- `openapi/gitlab-automated-validation-api.v1.yaml` — additive project-scoped
  availability, Suite Binding, automated Session/Attempt status/result/retry,
  quarantine administration and authenticated GitLab ingress routes;
- `asyncapi/gitlab-automated-validation-events.v1.yaml` — scoped immutable
  automation Attempt, retry, artifact and quarantine facts;
- `schemas/gitlab-connection.v1.schema.json` — one Core Connection's
  schema-bound configuration with distinct read, trigger and Standard Webhook
  HMAC identity references plus an exact operation-to-identity-slot map;
- `schemas/gitlab-profile.v1.schema.json` — provider-specific schema-bound
  configuration content nested in the existing Core Profile revision. The
  published Feature 001 wire wrapper names this field `connectorConfiguration`;
  the current TypeScript domain model names the same content
  `profileConfiguration`:
  numeric project, source/trigger dialect, ref/suite/environment/input mappings,
  lookup, webhook, result, artifact, rate/transport-retry controls and normalized
  infrastructure-code vocabulary; QA retry authority stays in the Suite policy,
  and this is not a second Profile header or lifecycle;
- `schemas/gitlab-pilot-metadata.v1.schema.json` — secret-free immutable
  local/live metadata gate for one Workspace/Project and non-production GitLab
  project;
- `schemas/gitlab-pilot-gate-evidence.v1.schema.json` — immutable successful
  rehearsal/release receipt that binds the exact metadata, Feature 003/004/005,
  Mattermost composition and, for release, successful rehearsal hashes;
- `schemas/gitlab-normalized-webhook.v1.schema.json` — safe normalized pipeline/job
  routing hint after raw-byte authentication and replay checks;
- `schemas/source-context-read.v1.schema.json`,
  `test-executor-trigger-status.v1.schema.json` and
  `artifact-ci-read.v1.schema.json` — exact closed provider-neutral operation
  request/result unions for the three capability identities;
- `schemas/gitlab-pipeline-result.v1.schema.json` — exact machine-readable
  pipeline/job result and artifact declarations;
- `schemas/automation-suite-binding.v1.schema.json` — provider-neutral
  versioned Suite publication contract;
- `schemas/automation-suite-validation-report.v1.schema.json` — immutable
  VALID/INVALID composed discovery, CI lint/dry-run and safety-check evidence;
- `schemas/automation-target-snapshot.v1.schema.json` and
  `automated-required-session.v1.schema.json`,
  `automated-test-session.v1.schema.json` and
  `automated-plan-item.v1.schema.json` — exact automated requirement,
  target/configuration pins, Session and Plan Item projections; published
  manual V1 schemas are not edited;
- `schemas/automation-attempt.v1.schema.json`,
  `automation-attempt-status-revision.v1.schema.json` and
  `automation-attempt-result.v1.schema.json` — immutable Attempt identity,
  append-only status and one terminal technical result;
- `schemas/automation-retry-decision.v1.schema.json`,
  `automation-artifact-descriptor.v1.schema.json`,
  `automation-availability.v1.schema.json` and
  `result-review-packet.v1.schema.json` — bounded retry, authorized provider
  artifact metadata, derived FULL_QA availability and proposal-only review data;
- `schemas/automation-quarantine.v1.schema.json` and
  `automation-quarantine-revision.v1.schema.json` — current quarantine header
  plus immutable accountable activation/lift history;
- `schemas/events/*.schema.json` — the six additive automation event payloads;
- `schemas/common.v1.schema.json` — offline shared ID/hash/ref and exact
  three-role configuration-pin definitions used by the 005-owned schemas;
- `examples/automated-session.local.v1.json`,
  `pipeline-result.pass.v1.json` and
  `gitlab-pilot-metadata.local.v1.json` plus
  `gitlab-connection-configuration.local.v1.json` — structurally valid local positive
  fixtures. The pilot root `contentHash` and detached artifact fixture checksum
  are recomputable semantic vectors; hashes that pin external policy/
  configuration objects are illustrative commitments until those exact runtime
  objects are materialized and verified by the live setup gate;
- `examples/artifacts/junit.xml` — deterministic detached artifact bytes whose
  exact size/checksum are declared by the positive pipeline-result fixture.
- `examples/negative/manifest.v1.json` and its four fixtures — targeted
  rejection of caller-injected provider authority, contradictory PASS/infra
  data, incomplete `FULL_QA` capability projection and target snapshots without
  an immutable test-data/account-lease reference.

All files resolve offline. Runtime and CI MUST NOT retrieve a remote `$ref` or
trust a producer-supplied digest without recomputing it.

## Normative invariants

1. QA and Core request provider-neutral capabilities. They never accept a
   GitLab base URL, numeric project, token, Profile/Connection ID, raw job name,
   arbitrary ref, arbitrary variable or artifact URL from a browser/model
   request.
2. Exactly one compatible published Project Integration Binding/Profile chain
   resolves for each required logical role. Core supplies its immutable pins as
   trusted execution context; provider responses cannot replace them.
3. A project derives `FULL_QA` only when all three roles
   `SOURCE_CONTEXT | TEST_EXECUTION | ARTIFACT_SOURCE`, one published Suite
   Binding and current non-production authorization are compatible. Otherwise
   it remains `MANUAL_ONLY`; manual QA is never disabled by GitLab health.
4. One explicit authorized HUMAN may launch an allowlisted non-production smoke
   Session without a second approval. Autonomous/event-driven regression is not
   represented by these contracts.
5. Launch idempotency is claimed in QA before the Connector command is emitted.
   Same Session/request key and request hash replays the existing Attempt;
   another hash is a conflict.
6. GitLab trigger is not assumed natively idempotent. After durable provider
   invocation starts, recovery is exact lookup only. Zero or multiple matches
   after the bounded window remain visible ambiguity and never authorize a
   blind second trigger.
7. Every domain retry creates a new immutable AutomationAttempt and pipeline.
   The Connector exposes no retry-pipeline operation. At most one automatic
   retry is allowed, only for a pinned allowlisted deterministic infra code.
8. Webhooks are authenticated unordered hints. Canonical status/result follows
   authoritative project-scoped pipeline/job/result read and monotonic
   reduction; duplicate/out-of-order/lost events cannot overwrite history.
9. Provider `success` is not sufficient for QA PASS. The exact machine result
   schema, scope, target, Suite, pipeline/job identity and checksum must all
   validate. Unknown/missing/drifted data becomes `INCOMPLETE`.
10. `PASS | ASSERTION_FAILED | INFRA_FAILED | TIMEOUT | CANCELLED | INCOMPLETE`
    is technical Attempt truth only. Terminal automation remains
    `REVIEW_REQUIRED` until an authorized HUMAN performs the existing QA review.
11. Assertion-failure-to-PASS lineage retains every Attempt and
    `FLAKY_SUSPECTED` until HUMAN disposition. A purely allowlisted
    infrastructure recovery retains its evidence without automatically becoming
    product flakiness. No automation-only Finding taxonomy or verdict path exists.
12. Artifact bytes remain in GitLab. Platform authorization uses a scoped Core
    ArtifactReference with an opaque locator, checksum, classification and
    expiry. Raw URLs and provider IDs never grant access.
13. Raw artifact/source text is untrusted and is not automatic Hermes/model
    context. `artifact.stream` requires the normal human/service authorization
    path and cannot be called by a model-selected grant.
14. Production/deploy operations are denied independently by project identity,
    GitLab CI policy, Profile, platform runtime policy and egress. Denial occurs
    before secret materialization/provider invocation whenever request scope is
    already invalid.
15. Secrets are represented only by secret refs and safe identity fingerprints.
    Raw tokens, provider bodies and restricted artifact bytes are forbidden in
    contracts, examples, commands, events, audit and evidence reports.

## Compatibility and contribution order

Feature 005 registers schema contributions at deterministic **order `500`**,
after Feature 004. Duplicate order, duplicate `$id`, duplicate capability
identity or another digest for an existing identity fails composition.

Compatibility rules:

- `qa.validation@1.2.0` adds an optional automation capability group; published
  `1.0.0` manual and `1.1.0` Mattermost/Hermes manifests remain immutable;
- Feature 002 manual schema IDs, bytes, examples and the negative automated-mode
  V1 fixture remain unchanged;
- Feature 004 is optional for standalone `qa-jira-gitlab-local` conformance and
  does not enter the GitLab package dependency graph. Constitution X makes its
  fresh evidence and the combined Jira+GitLab+Mattermost key mandatory at the
  separate pilot gate; local combined evidence is rehearsal-only, and actual
  deployment approval requires the DEVELOPMENT/TEST HTTPS combined contour.
  The pilot metadata schema binds fresh Feature 003/004/005 and Mattermost
  composition evidence by immutable ref/hash pairs; deployment additionally
  binds the successful rehearsal report by immutable ref/hash, and the gate
  resolves and revalidates every referenced report before approval;
- new JSON Schemas use new stable 005-owned identities and closed trust-boundary
  objects; compatible evolution publishes a new version/digest instead of
  editing an applied contract;
- stored Suite, Session, Attempt, result, artifact and evidence history pins the
  exact schema/Profile/Binding versions actually used and is never silently
  reinterpreted;
- OpenAPI `/api/v1` and the existing scoped EventEnvelope evolve additively;
  breaking transport or payload semantics require a new version;
- an unknown schema, Profile or capability version fails closed. It is never
  treated as the nearest compatible PASS result.

## Required validation

Implementation gates MUST:

- parse all JSON/YAML offline and resolve every local reference;
- validate positive and negative examples against exact schema IDs, recompute
  the pilot root semantic hash and verify detached artifact bytes/size/checksum;
- verify deterministic contribution order `500` and registry/OpenAPI/AsyncAPI
  snapshots;
- prove old manual fixtures remain byte-compatible and automated shapes remain
  invalid against manual V1;
- run all three provider-neutral capability conformance suites against the
  stateful Mock GitLab and the GitLab adapter;
- prove trigger replay/ambiguity, webhook ordering/reconciliation, artifact
  authorization/expiry and sticky human review;
- scan contracts/examples/reports for secrets, production/deploy targets, raw
  provider URLs/bodies and forbidden operations;
- map every Feature 005 FR/SC and documented scenario to fresh task/source/
  contract/runtime-bound evidence.
