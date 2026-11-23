# Research: Mattermost и Hermes intake

**Feature:** `004-mattermost-hermes-intake`

**Date:** 2026-08-31

**Status:** Phase 0 complete — planning decisions resolved; corporate pilot values remain explicit validation inputs, not architecture unknowns

## 1. Dependency and implementation entry gate

**Decision:** Feature 004 builds only on the task-bound, locally verified Feature 003 composition. The implementation entry gate verifies `reports/003-jira-operational-authority/final-gate.json`, runs the independent Feature 003 evidence verifier, and checks the published Core/QA/Jira contracts that 004 consumes. Optional corporate Jira non-prod evidence may remain `SKIPPED_GATED`; it is not replaced or silently treated as live PASS.

**Rationale:** The current repository already owns confirmed Intake Draft → durable Jira command → authoritative read-back → Work Item materialization. Reimplementing any part of that flow inside Mattermost or Hermes would create a second operational authority and invalidate the completed 003 guarantees.

**Alternatives considered:** duplicate a simplified Jira create path in the bot; require corporate Jira before local 004 work; treat the old mock operational authority as the 004 target. All are rejected because they either violate Jira authority/local-first rules or discard verified 003 behavior.

## 2. Mattermost integration shape

**Decision:** Add a statically composed, independent `@awp/connector-mattermost` package. It implements typed `messaging.intake@1.0.0`, `messaging.notify@1.0.0`, and optional `messaging.callback@1.0.0` capabilities behind injected HTTP/auth/secret/clock ports. Project-scoped dialog and post-action callbacks are declared through a new versioned `ConnectorIngressContract`; they are not mislabelled as a Broker `WRITE` operation because the current Capability Contract models only read/write effects. The public slash bootstrap is a separate stateless HTTP adapter with no Connection, credential or durable state. Platform Core, QA Pack, Hermes skills, API controllers, and UI never import Mattermost SDKs or vendor DTOs.

**Rationale:** This mirrors the established Connector boundary and keeps provider details, channel IDs, bot REST requests, slash-command encoding, and callback envelopes outside Core and Pack semantics. Separating the authority-free bootstrap avoids inventing a Workspace-scoped Connector credential. Native `fetch` is sufficient; no Mattermost runtime dependency is required.

**Alternatives considered:** put bot calls in `apps/api`; make Mattermost a QA Pack adapter; install a Mattermost SDK; implement a server plugin. These increase coupling, secret exposure, or deployment burden without adding a required MVP capability.

## 3. Guided intake transport

**Decision:** V1 starts guided intake with `/awp create`, whose public endpoint accepts only a bounded form and always returns deterministic text-only ephemeral JSON containing one fixed first-party OIDC continuation. It ignores Mattermost actor, team, channel, token, trigger and `response_url`; it performs no identity/project lookup and creates no receipt, audit, intent or product state. After canonical OIDC login, the web flow performs project selection and creates the Draft. Project-scoped dialog/post-action callbacks may continue structured field collection with opaque, expiring, one-time interaction intents; arbitrary channel history and generic bot-message listening are not enabled.

**Rationale:** Mattermost slash commands can return an ephemeral response, while canonical OIDC supplies the only trusted human session. A fixed continuation preserves the specified personal entry point without trusting spoofable slash fields, holding a Workspace credential or granting a websocket consumer access to unrelated message history.

**Alternatives considered:** scan bot DMs through the websocket event stream; use outgoing webhooks; parse any channel mention as an intake request. Outgoing webhooks do not cover private/DM use, and broad listeners violate the explicit history/prompt boundary.

## 4. Inbound authentication and replay

**Decision:** The public bootstrap has no authentication mode because it has no authority-bearing behavior: its response is fixed, it ignores provider identity/scope fields, and it stores nothing. Authentication mode is immutable project Connection-bound `ConnectorIngressContract` metadata only for dialog/post-action callbacks:

- `AWP_OPAQUE_INTENT` is allowed only in the isolated local contour and validates the high-entropy one-time token in constant time;
- `SIGNED_PROXY_HMAC_PLUS_AWP_INTENT` validates an allowlisted project-scoped gateway signature over timestamp, delivery ID and exact raw body and still requires the one-time Platform intent;
- the token hash and all exact claims (actor, Project, logical presentation target plus immutable delivery-result route, subject/version/hash, action, expiry and Binding/Profile/Connection refs) live server-side in a project-scoped `InteractionIntent`.

No plan assumes that Mattermost natively HMAC-signs every callback. Callback authentication/replay is satisfied by the selected declared transport mechanism, opaque one-time intent and separate project-scoped durable receipt/inbox. Callback order is normative: request-size/content-type gate → exact project Connection policy → constant-time authentication → freshness → bounded schema normalization → project-scoped receipt CAS → route-valid `200`. Raw bodies are never stored; normalized dialog/action envelopes contain only schema-valid fields and exact InteractionIntent ref and are cleared under retention policy.

When a callback gateway supplies a trustworthy delivery ID, uniqueness is `(connectionId, transportKind, deliveryId)` and a different body hash is quarantined. Otherwise the exact project Connection-bound contract declares `EXACT_BODY_FINGERPRINT`: exact-body replay deduplicates, while a changed attempt receives a distinct receipt and is stopped by InteractionIntent CAS. The token is never a delivery ID, so a wrong actor cannot pre-claim the legitimate actor's receipt identity. Receipt retention is at least the retry horizon plus clock skew. Bootstrap replay needs neither a receipt nor recoverable plaintext intent tokens because it always returns the same fixed continuation.

Token recovery differs by transport. A `WEB PROJECT_SELECT` token is returned once and never retained in recoverable form; retry replaces the pending option set. An actionable Mattermost projection instead atomically creates one queued NotificationIntent, one `callback.present` command/outbox and an ordered 1–8 independently single-use InteractionIntents with one project-scoped AEAD capsule per action. Routing is separate (`PROJECT_CHANNEL | PRINCIPAL_DM | INTERACTION_RESPONSE { sourceInteractionIntentId }`) from the newly presented `actionInteractionIntentIds`, so Candidate CREATE/SNOOZE/IGNORE is one post/effect and a response cannot materialize the source token by mistake. A new DM stays a logical principal target until the immutable delivery result pins exact provider channel/post IDs used for callbacks.

Each capsule uses fixed `AWP_INTERACTION_TOKEN_AEAD_V1`/`AES_256_GCM`, exact non-normalized UTF-8 token bytes, a unique random 12-byte nonce per key version and a 16-byte tag. `AWP_CANONICAL_JSON_V1` is the UTF-8/no-BOM/no-newline RFC 8785 JCS serialization of the closed versioned `InteractionPresentationAadV1`: every immutable intent authority/action/parameters/configuration/transport/subject field plus token hash/expiry/correlation and exact capsule ID/key version/NotificationIntent/slot/command/capability/effect-key-hash/target/payload/render/`retainUntil` commitments. Mutable state and encryption outputs are excluded; `aadHash` commits the exact bytes. Post-decrypt hashing of the exact token bytes must match `nonceHash`, which is distinct from the AEAD nonce. A machine-readable golden vector fixes schema digest, AAD hash, ciphertext and tag. A Core materializer lends a one-shot non-serializable sensitive value only under exact unexpired/fenced state; the Connector builds the DTO with capture disabled and only best-effort buffer clearing. Callers, commands, logs and audit never receive plaintext or ciphertext.

The Connector renders exact bytes before the worker durably commits `effectInvocationStartedAt`. Only a crash before that marker may reconstruct/retry. After it, the immutable Profile mode selects a closed reconciliation ref: `PENDING_POST_ID_LOOKUP` or `EFFECT_MARKER_LOOKUP` enters `LOOKUP_REQUIRED`, while `NONE_AMBIGUOUS` transitions directly to terminal `AMBIGUOUS`. One exact match delivers; V1 unsupported/zero/multiple matches become terminal `AMBIGUOUS` and never resend. A future versioned provider contract may retry only after durable `NOT_APPLIED` proof. Delivery, ambiguity, other terminal failure, consumption and invalidation purge capsule material in the same UoW; expiry is rejected at unwrap and closed by a bounded sweeper. WAL/backup/key retention is bounded honestly; the design claims neither guaranteed Node memory zeroization nor shared-key cryptographic erasure. Re-presentation creates a replacement action set and invalidates the old intents.

**Rationale:** Official Mattermost custom commands expose provider-controlled identity fields and deployment-specific command authentication, while interactive-message documentation recommends a confidential token, signature, or unguessable action identifier in callback context. The static bootstrap avoids treating a Workspace command credential as project authority; exact project intents and optional project-scoped gateway authentication protect later callbacks.

**Alternatives considered:** accept `user_id` as proof; trust network source IP alone; store a reusable approval token in callback context; assume one HMAC protocol for all deployments. All fail replay, rotation, or exact-action requirements.

## 5. Project selection before project-scoped state

**Decision:** After canonical OIDC login, `POST /api/v1/intake/mattermost/project-option-sets` computes Projects using the full `Workspace membership ∩ Project Entitlement ∩ Role permission ∩ Data Classification` policy for `qa.request.create` and creates one opaque project-selection intent per permitted Project. Issuance atomically invalidates prior PENDING option intents for the same principal/OIDC session/continuation and returns a fresh set, so it never stores raw tokens merely to replay an earlier response. Each server-side intent is pinned to exactly one `workspaceId + projectId`, exact authorization/configuration snapshot and OIDC-session hash; the browser receives safe labels and opaque tokens but never supplies authoritative scope. `POST /api/v1/intake/mattermost/project-selections` consumes one exact intent, reauthorizes the HUMAN and creates/replays Draft revision 1. Before OIDC there is no durable state; before one intent is consumed there is no Candidate, Draft, Agent Run, integration command or tool grant.

**Rationale:** This lets the user see only entitled projects while preserving the constitutional rule that all durable product/agent/action state is project-scoped. A client-supplied project name or free text is never authoritative.

The static bootstrap has no Connection or credential at all. After selection, the exact Project Binding resolves a project-scoped Connection/Profile/bot and optional callback-gateway credential. This directly preserves the accepted minimum credential-scope rule without a projectless Connector exception.

**Alternatives considered:** create a projectless Draft; let Hermes guess and persist a Project; keep the entitled list in client state; default to the first project. Each either weakens the hard boundary or removes explicit human selection.

## 6. External user identity

**Decision:** Reuse the Core `external_principal_bindings` model introduced by Feature 003, keyed by the project Mattermost Connection header/provider namespace and opaque Mattermost user ID. Canonical OIDC authentication identifies the HUMAN first; only a `VERIFIED` `EXTERNAL_HUMAN` reverse binding may route later DM/callback work to that Mattermost identity. Project-option issuance, selection and every callback recheck live Workspace membership, Project Entitlement, role, classification, and—where configured—Mattermost team/channel membership. Email and username remain diagnostics only.

**Rationale:** Identity proof and current authorization are different facts. A previously verified mapping does not preserve entitlement after revocation, and display attributes are not stable identifiers.

**Alternatives considered:** automatic email match; username match; bot-user impersonation; caching authorization for the conversation lifetime. All are rejected by FR-006…FR-010 and the Workspace boundary.

## 7. Candidate discovery and deduplication

**Decision:** Core owns a provider-neutral `IntakeCandidate` aggregate, append-only source observations and append-only human decisions. An authorized manual Mattermost/web flow creates a Draft directly after project selection; it does not manufacture a Candidate. Allowlisted Jira events create `PENDING_CONFIRMATION`; the GitLab source contract is registered but has no producer until Feature 005. Candidate deduplication identity is the canonical hash of `workspaceId + projectId + source authority namespace + source entity type/id + trigger key/version`. A changed source entity version/fingerprint appends a source observation/revision to the existing Candidate instead of creating a duplicate.

Every human decision requires a closed `reasonCode`, actor and time. A SNOOZE is valid only when `snoozedUntil < expiresAt`. Effective state checks expiry first (`now >= expiresAt → EXPIRED`) and only otherwise wakes snooze (`now >= snoozedUntil → PENDING_CONFIRMATION`). These are deterministic projections, not autonomous Candidate mutations: no event or action-provenance row is invented merely because time advanced, and the next command recomputes the effective state under lock.

**Rationale:** Candidate is discovery, not operational work. One contract serves Mattermost, Jira, future GitLab, and web without giving any Connector ownership over workflow state.

**Alternatives considered:** create Jira directly from triggers; reuse Jira issues as candidates; deduplicate on title; add GitLab implementation early. These respectively violate explicit confirmation, provider neutrality, deterministic identity, or feature scope.

## 8. Versioned Intake Draft and exact confirmation

**Decision:** Evolve the existing Core Intake Draft additively. The header points to append-only `IntakeDraftRevision` records with a semantic content hash. Revision content uses a standalone structural-partial schema whose fields and value types exactly match canonical Feature 002 `urn:awp:schemas:qa:intake:v1`; partial editing does not create a Mattermost-specific QA vocabulary. A deterministic question selector evaluates that exact QA intake schema/rules, returns only missing or invalid canonical field keys in stable order, and never re-asks a currently valid field. `VALID` requires the canonical structural minimum, but exact pinned full-schema and business-readiness evaluation remains a confirmation gate. Validation and accepted Hermes suggestions create a new revision through CAS; they never mutate a confirmed revision. Confirmation pins the exact revision, current aggregate snapshot, requester, selected Project, QA Work Type definition, Jira Binding/Profile/Mapping/Connection chain, immutable summary manifest/hash, request hash, expiry, and idempotency key. It then reuses the Feature 003 durable `request.create` command path.

**Rationale:** Existing 001–003 code already prevents Work Item materialization before confirmed external create. Revision history and exact confirmation close the missing conversational editing/stale-callback gap without inventing a new acceptance transaction.

**Alternatives considered:** overwrite one JSON draft row; confirm whatever is current at callback time; let Hermes submit; create a local Work Item before Jira. All make replay/staleness or authority unverifiable.

## 9. Agent runtime ownership

**Decision:** Platform Core owns provider-neutral Agent Definition/Run, derived Tool Grant, Tool Invocation, audit, idempotency, and state-machine primitives. A new generic runtime module under `platform-core` plus persistence/runtime-composition adapters orchestrates them; QA Pack owns nine `hermes-qa-coordinator` skill definitions, input/output schemas, deterministic rules/fallbacks, and QA proposal semantics. `qa-intake-readiness` and `qa-work-item-readiness` are separate Skills, as are `qa-triage` and `qa-session-plan`, so every Run has one subject branch, one closed output schema and one result ref. No new standalone service or unrestricted agent framework is introduced in V1. The required `DRAFT | CANDIDATE | WORK_ITEM` subject union is normative under Accepted ADR-0008 and Constitution 2.0.0. ADR-0008 partially supersedes only the Work Item-only subject clause of ADR-0005 Decision 1; the remaining Hermes and approval invariants stay active.

**Rationale:** This preserves Core/Pack ownership, uses the existing API and worker deployment units, and avoids a new network trust boundary. Horizontal work is already handled by durable worker delivery.

**Alternatives considered:** one global autonomous Hermes process; Pack-owned execution/audit; direct model tool calling; a new microservice. These create cross-project memory, bypass Core policy, or add unjustified operational complexity.

## 10. Tool Gateway and grants

**Decision:** Each Agent Run stores an immutable derived grant set scoped to one Workspace, Project, closed subject branch (`DRAFT | CANDIDATE | WORK_ITEM`), classification ceiling, tool/version, allowed operation, effect class, input schema hash, and expiry. Hermes is a canonical `SERVICE` principal with explicit membership, entitlement and permission ceiling; the per-run grant is the intersection of that service authorization, the skill allowlist, the initiating human's current authorization, Project/Profile scope and classification. Both authorization bases are pinned, but no user token or synthetic human role is copied. Tool Gateway reauthorizes on every invocation and accepts only schema-valid structured actions. Reads and proposal creation may execute automatically; Draft updates use CAS; notifications create durable intents; Jira or human-owned mutations remain proposals routed to the existing command/approval/web flows.

**Rationale:** Prompt text cannot add a tool, change target Project, or change effect class. The grant is an auditable upper bound, not a bearer credential and not a cached human role.

**Alternatives considered:** pass connector clients into the model; authorize once at Run start; let the model select Profile IDs; use prompt instructions as policy. All violate deterministic policy and exact-action rules.

## 11. Model provider and deterministic fallback

**Decision:** Real model use is optional and disabled in the required local gate. A narrow `ModelProposalPort` receives only policy-approved, minimized, classification-compatible snapshots and returns schema-bound proposals. Timeouts, rate limits, unavailable configuration, policy denial, or invalid JSON produce stable fallback reason codes and deterministic results. An orchestration may report `COMPLETED` after a model-step failure only when the typed deterministic fallback itself succeeds; otherwise it fails with the stable reason. Model output never directly changes accepted priority, dates, assignment, QA verdict, release decision, entitlement, or Connector state.

**Rationale:** The repository already has a narrow QA draft assistant, classification input policy, and deterministic fake-model scenarios. Feature 004 generalizes those patterns instead of introducing an AI SDK dependency.

**Alternatives considered:** require a model for intake; persist the full prompt/transcript; parse free-form output; permit model-selected tools. These fail SC-004/SC-007 and Constitution V.

## 12. Prompt and context boundary

**Decision:** Model input is a typed `PromptManifest`, never a transcript. It pins scope and subject revision, skill/rules/policy/model/template refs, an input fingerprint, and allowlisted fact segments `{sourceKind, sourceRef, sourceVersion, sourceHash, classification, trust=UNTRUSTED, sanitizedValue}`. Classification is checked before construction; redaction does not silently downgrade classification, and a sanitized derivative has its own provenance and rule version. System policy, tool schemas and immutable grants never share a model-controlled field. Output uses closed JSON Schemas (`additionalProperties:false`, size/count/range bounds) followed by semantic Tool Gateway policy. A Draft patch may update only QA content fields through expected-revision CAS—not project, requester, classification, bindings, Profiles, confirmation, Jira-owned fields, verdict or release fields. Audit retains hashes/provenance, not raw prompts or completions. Raw channel history is never fetched; attachments are metadata-only in 004.

**Rationale:** Minimal context and stable fingerprints make staleness, leakage, and injection tests deterministic. Storing a raw prompt would duplicate sensitive system data and make retention policy unclear.

**Alternatives considered:** last-N channel messages; raw Jira comments; implicit model memory; log full prompts for debugging. All are rejected for cross-project and classification risk.

## 13. TriageAssessment ownership and staleness

**Decision:** QA Pack owns revisioned `TriageAssessment` content with CAS lifecycle projection. Each separates business impact, urgency/SLA facts, risk, a structured bounded effort range `{kind=ESTIMATE, lower, upper, unit} | {kind=UNKNOWN}`, scope breadth, environment/data complexity, uncertainty, and automation availability and carries distinct non-authoritative complexity, priority and queue-band recommendations. Composed semantic validation requires `lower <= upper` and every zero-based recommendation fact ref to satisfy `0 <= ref < facts.length`; dangling evidence refs are rejected. It includes explanation, confidence, exact fact refs/hashes, rule/skill/policy/model refs, input fingerprint, expiry, and state `CURRENT | STALE | SUPERSEDED`. A source fingerprint change marks it stale before read/use. It never overwrites Jira priority or future Feature 006 accepted queue decisions.

**Rationale:** The assessment is QA-specific proposal semantics, while operational priority and later queue ordering have different authorities. Append-only revisions preserve why an earlier recommendation existed.

**Alternatives considered:** one opaque score; store recommendation in Jira priority; recompute silently on read; put queue order in Feature 004. These obscure facts, cross authority boundaries, or pre-implement Feature 006.

## 14. Notification intent and delivery

**Decision:** Core owns a project-scoped `NotificationIntent`; its closed delivery union selects exactly one command: `MESSAGE → messaging.notify` or `INTERACTION_PRESENTATION → messaging.callback`. Semantic dedupe is `source event + template ref + target ref + delivery kind + optional action-set hash`; the effect key derives from immutable intent ID + render hash + optional action-set hash. The closed `CommandIntent.source` union gains Candidate, AgentRun and NotificationIntent branches instead of overloading Draft/WorkItem. The intent pins logical target, Profile/Connection/Binding, versioned template, canonical redacted variables, classification decision, expiry and correlation chain. An interaction branch additionally pins the ordered action-intent IDs/action-set hash and is created in one UoW with exactly one command and all capsules; it never also emits `messaging.notify`. Mattermost response stores only safe post/channel references and binds a previously logical DM route. Terminal auth/channel/schema/policy failures update existing Connection health. Before the invocation marker, local failure may retry. After it, V1 uses the exact pinned Profile reconciliation branch or direct `NONE_AMBIGUOUS` terminal outcome; only a future versioned provider contract with durable `NOT_APPLIED` proof may authorize another POST.

**Rationale:** Mattermost is not part of the Jira/QA transaction. Durable intent prevents loss, while explicit ambiguity avoids promising a native exactly-once guarantee not proven by the target server.

**Alternatives considered:** send inline from the Jira confirmation transaction; fire-and-forget HTTP; unbounded retry; assume `POST /api/v4/posts` is inherently idempotent. All risk rollback coupling, loss, spam, or duplicate effects.

## 15. Templates, channels, and classification

**Decision:** Immutable Mattermost Profile content belongs to exactly one `workspaceId + projectId` and includes exact team/channel IDs and channel kind, template refs/hashes, allowed audience, maximum classification, DM/project-channel rules, mention/expiry/retry policy, exact project callback-contract refs that pin compatible authentication, and delivery reconciliation mode; it contains no preselection command vocabulary or project-selection policy. Quiet-hour/digest scheduling is deferred from V1. A project channel receives only a policy-approved minimal summary; full intake content stays in DM/web. Each Project and environment has a distinct Mattermost bot user and secret credential identity, proven by safe secret-manager fingerprint; publication rejects cross-Project/cross-environment reuse and rejects an active channel alias owned by another Project Profile. The external Mattermost bot is distinct from the canonical Platform Hermes `SERVICE` principal and never receives Tool Grants. The bot must be a member only of bound channels unless a separately accepted deployment proves equivalent least privilege.

**Rationale:** A channel name, visibility flag, or UI selection is not a security boundary. Exact IDs and policy pins make delivery decisions replayable.

**Alternatives considered:** resolve channels by name on each send; one unrestricted bot; allow arbitrary template/body; rely on Mattermost channel membership alone. These allow drift or cross-project disclosure.

## 16. Stateful local mock and conformance

**Decision:** Extend Mock Hub with protocol-faithful static-bootstrap submission, project callback emission and `/api/v4/posts`/membership/profile surfaces backed by separate mock migrations. Scenarios cover exact/rejected bootstrap shapes and proof of zero state, callback token/signature failure, replay, wrong team/channel/user, 401/403, 429 with retry metadata, 5xx, timeout before/after post creation, duplicate callback, stale action/draft, membership revocation, schema drift, and recovery. Fake model scenarios cover valid, invalid JSON/action, injection, timeout, rate limit, unavailable, and contradictory/low-confidence evidence.

**Rationale:** The same production connector/runtime must run locally without VPN or corporate credentials, and failure behavior must be stateful enough to prove retry/idempotency rather than only DTO parsing.

**Alternatives considered:** mocked functions in unit tests only; a real Mattermost dependency in required CI; stateless canned responses. They cannot prove the critical process and outage contracts.

## 17. Non-prod metadata gate

**Decision:** Corporate non-prod remains opt-in and requires an immutable `MattermostPilotMetadataPackage@1.0.0` for one exact Workspace/Project: server/build/API capabilities and network ownership; fixed bootstrap-continuation and static-purity evidence refs; project-scoped Connection, Profile and validation-report refs; project callback-contract refs; project/environment-scoped bot and optional callback-gateway secret refs plus distinct immutable Core presentation-key metadata (ID/version/purpose/scope/environment/fingerprint/hash/decrypt horizon) when callbacks are enabled, all with rotation/revocation ownership; an immutable retention policy/evidence with numeric maximum capsule lifetime, expiry sweep/purge SLA, same-UoW terminal purge, WAL/backup maxima and key-disable SLA; bot/channel/membership evidence; identity and membership sources; template catalog and redaction policy; validated server limits; callback-ingress/membership/notification/redaction/reconciliation evidence hashes; and explicit operator opt-in. Publication rejects key aliases, retention settings above those bounds, sweep lag above purge SLA and key horizons shorter than capsule recovery. Missing input yields `SKIPPED_GATED`, never live PASS. A separate optional model-provider package follows the same rule.

**Rationale:** Pilot values are deployment facts, not design choices. Keeping them machine-readable prevents placeholders from entering published profiles or CI secrets.

**Alternatives considered:** embed corporate values in docs/env examples; make local tests depend on live endpoints; treat absent provider as failure of deterministic intake. These harm security or local-first development.

## 18. Versioning, migrations, and compatibility

**Decision:** Publish additive `1.0.0` Mattermost/Agent/Candidate/Triage/Notification contracts and an additive Intake Draft `1.1.0` contract. Publish `competency-qa@1.1.0` and `qa.validation@1.1.0` alongside immutable 1.0 history; the successor declares required logical roles for `messaging.intake` and `messaging.notify`, optional `messaging.callback`, and the versioned QA Skill catalog. Prior compositions remain pinned to Pack/Work Type 1.0; the 004 composition selects 1.1. Core uses ordered expand/contract migrations after `0095`; QA uses a Pack-owned migration after `2030`; Mock Hub uses its own next range. No published row/profile is reinterpreted in place.

**Rationale:** Feature 004 crosses several public boundaries but does not require a breaking change to the operational authority or QA lifecycle. Explicit versions allow Feature 005/006 to consume Candidate and Agent outputs safely.

**Alternatives considered:** mutate existing schemas silently; reuse `operational-work-item` for messaging; keep mutable Profiles; reserve dynamic plugin versions. All conflict with compatibility and static composition rules.

## 19. Verification and evidence

**Decision:** Required verification includes offline schema/ref examples, authority-free/bootstrap determinism and zero-state tests, architecture imports, real PostgreSQL 17/18 migrations, stateful connector conformance, OIDC identity/callback/prompt security suites, deterministic/model-degraded scenarios, API/worker/browser E2E for US1–US4, full local process smoke with worker/Mock Hub restarts, traceability for every FR/SC, and a task/runtime-bound final gate. Corporate non-prod is reported separately.

**Rationale:** The highest risks are process-level replay, scope, outage, and cross-system behavior, not simple line coverage. Task-bound evidence prevents stale green reports after implementation drift.

**Alternatives considered:** unit tests only; manual bot demo; a single happy-path E2E; evidence generated before all tasks. None prove the stated safety and recovery properties.

## 20. Production boundary

**Decision:** Environment types remain distinct and are mapped explicitly: registry `LOCAL` maps to runtime `LOCAL` and competency `LOCAL`; registry `DEVELOPMENT | TEST` maps only from a declared runtime `NON_PROD | PREPROD` contour and competency `NON_PRODUCTION`; runtime `PLATFORM_PROD`/registry `PRODUCTION` has no allowed 004 competency mapping. Live contours require immutable validation metadata and operator opt-in. `PRODUCTION` Connections, Profiles, model contours, credentials, egress, actions, and release decisions are denied by configuration schema, runtime policy, composition allowlists, CI, and network policy. Production writes remain excluded.

**Rationale:** This is a constitutional invariant and cannot rely on UI labels or operator convention.

**Alternatives considered:** “dry run” against production; production notification-only bot; environment name checks. Each leaves an avoidable credential or routing path.

## Primary external references

- [Mattermost custom slash commands](https://developers.mattermost.com/integrate/slash-commands/custom/)
- [Mattermost slash commands](https://developers.mattermost.com/integrate/slash-commands/)
- [Mattermost interactive messages](https://developers.mattermost.com/integrate/plugins/interactive-messages/)
- [Mattermost interactive dialogs](https://developers.mattermost.com/integrate/plugins/interactive-dialogs/)
- [Mattermost bot accounts](https://developers.mattermost.com/integrate/reference/bot-accounts/)
- [Mattermost API Post schema](https://github.com/mattermost/mattermost-api-reference/blob/master/v4/source/definitions.yaml)
