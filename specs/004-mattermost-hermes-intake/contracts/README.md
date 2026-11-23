# Feature 004 contract package

This directory is the planning baseline for `004-mattermost-hermes-intake`. All contracts are additive, provider-neutral at the Core/QA boundary, offline-resolvable, project-scoped after selection, and denied in `PRODUCTION`.

The `DRAFT | CANDIDATE | WORK_ITEM` Agent subject schemas are governed by Accepted ADR-0008 and Constitution 2.0.0. The former governance publication block is closed; ordinary implementation, compatibility and verification gates still apply.

## Inventory

- [capabilities.md](capabilities.md) — Connector capability, ingress and Tool Gateway boundaries.
- [OpenAPI](openapi/mattermost-hermes-intake-api.v1.yaml) — authority-free static `/awp create` bootstrap, OIDC project selection, project-scoped callback ingress, immutable administration and project-scoped product APIs. The existing QA confirmation route is consumed unchanged from Feature 002/003 and is deliberately not redeclared here.
- [AsyncAPI](asyncapi/mattermost-hermes-events.v1.yaml) — normalized domain/integration events with compact payloads bound to exact canonical EventEnvelope schema identities; no duplicate scope/actor fields or raw Mattermost payloads.
- `schemas/events/*.v1.schema.json` — registry-backed compact event payloads referenced directly by AsyncAPI, each with an immutable top-level schema identity.
- `schemas/connector-ingress-contract.v1.schema.json` — declared project-scoped dialog/post-action authentication and replay contract; the static bootstrap is deliberately outside this registry.
- `schemas/ingress/normalized-{dialog-submission,post-action}.v1.schema.json` — strict safe project-scoped callback receipt envelopes with resolved InteractionIntent references, bounded schema-valid dialog input and opaque provider identifiers; raw bodies/tokens are excluded.
- `schemas/ingress/slash-command-acknowledgement.v1.schema.json` — text-only static bootstrap response, plus `dialog-submission` and `post-action` acknowledgement schemas for project callbacks.
- `schemas/action-provenance.v1.schema.json` — immutable actor/request/config/effect/audit chain for durable actions.
- `schemas/mattermost-profile.v1.schema.json` — immutable one-Workspace/one-Project published callback/delivery Profile content.
- `schemas/mattermost-pilot-metadata.v1.schema.json` — gated local/non-prod contour metadata pinning the fixed bootstrap evidence and project-scoped callback/bot authority.
- `schemas/intake-candidate.v1.schema.json` — Candidate plus current source observation.
- `schemas/qa-intake-partial-content.v1.schema.json` — standalone structurally valid partial Draft content using exactly the canonical Feature 002 QA intake field names and value types.
- `schemas/intake-draft-revision.v1.1.schema.json` — append-only Draft content revision referencing that partial-content schema; `VALID` additionally requires the canonical structural minimum.
- `schemas/intake-draft-assistance.v1.schema.json` — bounded missing/invalid-field questions and patch proposal.
- `schemas/intake-completeness.v1.schema.json` — deterministic exact-revision completeness result.
- `schemas/interaction-intent.v1.schema.json` — server-side exact one-time intent; token value excluded, with `RETURN_ONCE` web handling or a safe ref to bounded sealed Mattermost presentation material.
- `schemas/interaction-presentation-aad.v1.schema.json` and its AEAD golden-vector contract — exact closed AAD DTO, UTF-8/JCS codec and deterministic encrypt/decrypt conformance fixture.
- `schemas/hermes-agent-run.v1.schema.json` — project-scoped Agent Run summary.
- `schemas/prompt-manifest.v1.schema.json` — allowlisted typed model input, never a transcript.
- `schemas/result-review-preparation.v1.schema.json` — non-adjudicative Work Item review preparation.
- `schemas/triage-assessment.v1.schema.json` — QA-owned explainable proposal.
- `schemas/session-plan-proposal.v1.schema.json` — QA-owned plan proposal, separate from accepted Sessions.
- `schemas/notification-intent.v1.schema.json` — durable project-scoped one-command delivery union: plain message or bounded interaction presentation.
- `examples/mattermost-pilot-metadata.local.v1.json`, `examples/guided-intake.local.v1.json` and `examples/interaction-presentation-aead.vector.v1.json` — deterministic local fixtures; the guided fixture is reachable Mattermost revision 2 after the OIDC selection transaction created minimal revision 1, and the AEAD values are test-only non-secrets.

## Normative invariants

1. `/awp create` is a public, stateless, authority-free bootstrap: it ignores provider identity/scope fields, creates no receipt/audit/intent/product row and returns only one fixed first-party OIDC continuation. Project callback routes accept no caller-supplied Workspace/Project scope as authority.
2. Only after canonical OIDC authentication may the web API compute current `qa.request.create` authorization and issue one expiring project-scoped `WEB PROJECT_SELECT` intent per authorized option; there is no projectless durable state.
3. Candidate, Draft, InteractionIntent, Agent Run, proposal, command and notification are scoped to exactly one Workspace and Project.
4. `InteractionIntent` is not an Approval. Canonical OIDC web selects a Project; after that, project-scoped Mattermost callbacks may collect bounded Draft fields, record `CREATE|SNOOZE|IGNORE`, confirm one Draft revision, or open web UI. High-risk approvals and verdicts remain web-only.
5. Exact Draft confirmation reuses the Feature 003 Jira command/read-back path; no Mattermost or Hermes Jira shortcut exists.
6. Model input is a typed PromptManifest. Output is schema-validated and reauthorized by Tool Gateway; a model cannot supply grants, Profile IDs or arbitrary tools.
7. NotificationIntent commits independently of Jira/QA state and is delivered by the existing durable command outbox. Ambiguous effects are reconciled or stopped, never blindly retried.
8. `LOCAL | DEVELOPMENT | TEST` are the only accepted environment classes. Live inputs without immutable metadata are `SKIPPED_GATED`; `PRODUCTION` is invalid.
9. There is no Workspace-scoped Connector registration or credential. Each active callback/delivery Profile, Connection, bot and optional gateway credential belongs to exactly one Project, and an active team/channel cannot alias another Project.
10. `/awp create` is the sole V1 bootstrap shape; bare, status and unknown forms have no implicit semantics. Candidate decisions always carry a closed reason code. A snooze deadline must precede expiry; expiry is evaluated first and time-based wake/expiry remains an effective projection rather than a silent mutation.
11. One actionable NotificationIntent maps to one `callback.present` command/post with 1–8 ordered action InteractionIntents/capsules; a routing `sourceInteractionIntentId` is a distinct field. Each capsule pins immutable codec/key/AAD plus exact command/slot/target/payload/render/effect commitments and may be leased only before the durable invocation marker.
12. After `effectInvocationStartedAt`, only Profile-matched reconciliation is legal. V1 zero/multiple/unsupported lookup is terminal `AMBIGUOUS`, never a resend; terminal/consumed/invalidated transitions purge recoverable capsule material atomically and expiry is fail-closed plus swept. Pilot metadata makes capsule/sweep/WAL/backup/key bounds measurable without claiming guaranteed Node memory or shared-key cryptographic zeroization.
13. Every TriageAssessment recommendation fact index must satisfy `0 <= ref < facts.length`; the composed semantic validator rejects dangling evidence refs and `ESTIMATE lower > upper`.

JSON Schema validates shape; publication also resolves the composed package and rejects bootstrap/evidence drift, transitive ref/digest/scope/role mismatch, inverted retry bounds, duplicate `(teamId, channelId, purpose)` tuples, and cross-Project active channel/bot/credential/Connection reuse.

Draft editing never introduces a parallel QA vocabulary. Revisions may be structurally partial, while confirmation revalidates the exact pinned `urn:awp:schemas:qa:intake:v1` contract and the current business-readiness rules before entering the existing Feature 003 Jira authority path.

Each AsyncAPI message references a standalone JSON event payload schema whose top-level `$id` is in the canonical `urn:awp:schemas:*` namespace. The message fixes that same ID and integer version in `payloadSchemaRef`; publication computes and verifies the digest rather than trusting a producer-supplied value.

## Versioning

Schemas use JSON Schema 2020-12, immutable `urn:awp:schemas:004:*` identifiers compatible with the canonical EventEnvelope `SchemaRef`, and semantic contract version `1.0.0`, except the additive Intake Draft surface which succeeds the legacy Draft contract as `1.1.0`. Canonical digests use `sha256:<64 lowercase hex>`. Unknown properties are rejected at trust boundaries. A published digest is immutable; compatible evolution requires a new version and migration evidence.
