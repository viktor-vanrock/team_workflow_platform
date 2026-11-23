# Quickstart validation: Mattermost и Hermes intake

**Feature:** `004-mattermost-hermes-intake`

**Required contour:** `qa-jira-mattermost-local`

**Purpose:** prove US-001…US-004 through the real API/worker/PostgreSQL/Redis, Feature 003 Jira Connector, Mattermost Connector, stateful Mock Hub and deterministic model provider.

This is the Phase 1 validation contract. The named `004` scripts are implementation deliverables for `tasks.md`; until those tasks land, missing scripts are expected and must not be reported as PASS.

## 0. Blocking entry gates

Run from the repository root:

```bash
corepack pnpm verify:003:evidence
corepack pnpm verify:004:governance
```

Expected:

- Feature 003 exact source/contract evidence is `PASS` for the local Jira contour;
- optional corporate Jira evidence may be `SKIPPED_GATED` but is never relabelled;
- `verify:004:governance` binds the exact digests of [Accepted ADR-0008](../../docs/adr/0008-agent-run-subject-union.md) and Constitution 2.0.0 and returns `PASS`;
- story/domain implementation beyond Phase 1 setup begins only after both mandatory entry-gate verifiers return `PASS`.

## 1. Install and validate static contracts

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm test:contract:004
corepack pnpm test:architecture:004
```

Expected contract evidence:

- every JSON Schema, OpenAPI 3.1 and AsyncAPI 3.0 document parses with offline refs;
- Draft fixtures and append commands use the standalone structural-partial contract with only canonical Feature 002 QA intake field names/types; `VALID` requires the canonical structural minimum, and confirmation still checks the exact pinned full schema plus business readiness;
- local examples pass their declared schemas and negative fixtures reject extra fields, production environment, raw URL/channel selection, invalid subject/action/effect unions, bare schema refs and contradictory ingress route/auth/replay combinations;
- `competency-qa@1.1.0`/`qa.validation@1.1.0` register alongside immutable 1.0 definitions with required intake/notification and optional callback logical roles;
- the public `/awp create` bootstrap is byte-stable, authority-free and zero-state; `ConnectorIngressContract@1.0.0` covers only project-scoped callbacks and remains directionally separate from Broker `READ | WRITE` effects;
- architecture tests reject Mattermost/Jira/model imports from Core/QA/UI and runtime dynamic loading.

## 2. Start the required local contour

```bash
corepack pnpm local:mattermost:up
corepack pnpm local:mattermost:status
corepack pnpm local:mattermost:migrate
corepack pnpm local:mattermost:seed
```

The status command must show:

- API and worker on the `qa-jira-mattermost-local` composition;
- PostgreSQL and Redis healthy;
- Mock Hub Jira and Mattermost modules healthy;
- two synthetic Platform Projects, one local Mattermost team, a DM route and exact per-Project channels;
- one fixed first-party OIDC bootstrap continuation with static-purity evidence plus distinct project-scoped Profile/Connection/bot credential identity per synthetic Project, all separate from the Hermes SERVICE principal;
- deterministic model provider selected; no corporate or production endpoint/credential loaded.

The public bootstrap has no credential; both its continuation and the Mattermost server must be loopback in the `LOCAL` contour. Any `DEVELOPMENT`/`TEST` server/continuation requires TLS; project callbacks require their declared opaque-intent plus optional signed-proxy mechanism.

## 3. US-001 — guided intake and one Jira Request

```bash
corepack pnpm mattermost:scenario -- us1-guided-intake
corepack pnpm mattermost:scenario -- us1-repeat-callback
corepack pnpm mattermost:scenario -- us1-valid-fields-not-reasked
```

Checkpoint evidence must prove:

1. `/awp create` returns deterministic text-only HTTP `200` with the exact configured first-party OIDC continuation while ignoring Mattermost token/actor/team/channel/trigger/`response_url`; repeated and forged requests create zero receipt, audit, intent or product rows. Bare `/awp`, `/awp status` and unknown subcommands do not acquire create/read semantics.
2. Before canonical OIDC login there is no durable state. After login and before selection, only one separately project-scoped `WEB PROJECT_SELECT` intent per authorized option may exist; there is still no Candidate, Draft, Agent Run, tool grant, command or effect.
3. The OIDC-authenticated HUMAN sees only Projects allowed by current membership, entitlement, `qa.request.create` role permission and classification; the browser submits no authoritative Workspace/Project ID.
4. Reissuing the option set atomically invalidates the prior pending set for that principal/OIDC session/continuation and returns fresh tokens; no plaintext token is stored to reconstruct an old response.
5. Selecting one opaque web intent creates one project-scoped Draft revision and may enqueue a project-scoped DM NotificationIntent; it does not manufacture a Candidate.
6. The deterministic question selector asks only missing/invalid fields in stable order and never repeats currently valid fields.
7. Hermes output is a schema-valid bounded proposal; accepting it creates a new immutable Draft revision through exact CAS.
8. The confirmation summary pins Project, requester, classification, environment, source refs, Work Type and exact Jira Binding/Profile/Mapping/Connection refs.
9. Repeated/concurrent confirmation returns the same safe result and produces exactly one Feature 003 Jira `request.create`, one Jira issue, one Work Item and one notification intent.
10. One actionable NotificationIntent creates exactly one `callback.present` command and 1–8 action intents/capsules; a Candidate presentation exposes CREATE/SNOOZE/IGNORE in one post, and an `INTERACTION_RESPONSE.sourceInteractionIntentId` is never confused with its new action IDs.
11. A crash before durable `effectInvocationStartedAt` reconstructs identical provider bytes from exact project-scoped AEAD capsules while commands/logs contain no plaintext. After that marker only reconciliation runs: one match delivers; V1 zero/multiple/unsupported is terminal `AMBIGUOUS` with no resend. Delivery/consumption/terminal/invalidation/expiry purges capsule material transactionally or by bounded sweeper.

Inspect the evidence report rather than querying provider state manually:

```bash
corepack pnpm verify:004:checkpoint -- us1
```

## 4. US-002 — Candidate discovery and decisions

```bash
corepack pnpm mattermost:scenario -- us2-jira-candidate-create
corepack pnpm mattermost:scenario -- us2-jira-candidate-snooze
corepack pnpm mattermost:scenario -- us2-jira-candidate-ignore
corepack pnpm mattermost:scenario -- us2-source-version-update
```

Expected:

- an allowlisted Jira signal is followed by authoritative Jira read and trigger evaluation;
- dedupe uses Project + source authority/type/id + trigger ref/version;
- a changed Jira source version appends one source observation to the same Candidate;
- only a verified HUMAN records `CREATE | SNOOZE | IGNORE`, always with a closed reason code and timestamp;
- SNOOZE rejects `snoozedUntil >= expiresAt`; reads/commands evaluate expiry first and only otherwise wake elapsed snooze, without an unaudited Candidate mutation; reminders use a separate NotificationIntent;
- `CREATE` opens an origin-linked Draft only; no Candidate decision directly creates Jira issue, Work Item, SLA or WIP;
- GitLab producer remains gated until Feature 005 while the provider-neutral contract is already valid.

## 5. US-003 — Hermes proposals, staleness and fallback

```bash
corepack pnpm mattermost:scenario -- us3-triage-valid
corepack pnpm mattermost:scenario -- us3-source-drift-stale
corepack pnpm mattermost:scenario -- us3-model-invalid-json
corepack pnpm mattermost:scenario -- us3-model-timeout
corepack pnpm mattermost:scenario -- us3-prompt-injection
```

Expected:

- every Run pins exact `DRAFT | CANDIDATE | WORK_ITEM` subject, HUMAN initiator, Hermes SERVICE identity, skill/rules/policy/template/model refs, PromptManifest fingerprint and immutable grant set;
- TriageAssessment keeps separate dimensions, including a bounded `{lower, upper, unit}` effort range or explicit `UNKNOWN`, plus non-authoritative complexity, priority and queue-band proposals, explanation, confidence and exact facts; semantic tests reject `lower > upper` and every `factRefs` index outside `0 <= ref < facts.length`;
- `qa-intake-readiness` and `qa-work-item-readiness`, and separately `qa-triage` and `qa-session-plan`, are distinct one-output Skills; Work Item session planning creates a SessionPlanProposal, never accepted Sessions directly;
- source drift makes a current proposal stale before read/accept;
- invalid/unavailable/timeout/rate-limited model uses the typed deterministic fallback; a Run is `COMPLETED` only when fallback succeeds;
- injection or forbidden tool JSON yields a denial with zero grant expansion, Connector call or cross-Project data.

## 6. US-004 — durable notification and outage

```bash
corepack pnpm mattermost:scenario -- us4-outage-before-send
corepack pnpm mattermost:scenario -- us4-rate-limit-recovery
corepack pnpm mattermost:scenario -- us4-timeout-after-effect
corepack pnpm mattermost:scenario -- us4-permanent-auth-failure
```

Expected:

- Jira/QA mutation and NotificationIntent commit independently;
- stopping/restarting Mock Hub or worker does not roll back or lose Jira/QA state;
- local validation/materialization/scheduler throttling before the invocation marker uses bounded retry budgets; after the marker, `429`/`5xx`/timeout/network loss uses the pinned pending-ID/marker lookup or direct `NONE_AMBIGUOUS` terminal path and never repeats the POST in V1;
- timeout after possible post creation uses the pinned Profile branch: exact same-attempt pending-ID/marker lookup confirms at most one post, while `NONE_AMBIGUOUS`, unsupported, zero or multiple results become `AMBIGUOUS` without blind resend;
- permanent auth/channel/schema/policy failure updates existing Connection health to `DEGRADED`/`UNAVAILABLE` with a closed reason;
- a successful explicit recovery validation returns health to `HEALTHY` and is visible in the integration-health view.

## 7. Security and concurrency suite

```bash
corepack pnpm test:security:004
corepack pnpm test:integration:004 -- callback-concurrency
corepack pnpm test:integration:004 -- scope-isolation
```

Required negative fixtures:

- invalid/oversize bootstrap shape and proof that forged provider fields cannot alter its fixed response or create state;
- project callback wrong content type, invalid opaque intent/HMAC, stale timestamp and replay conflict;
- unknown/PENDING/CONFLICT/REVOKED external binding;
- wrong user/team/channel, foreign Project/Profile, lost membership/entitlement/role/classification;
- one outbound Profile/Connection/bot credential reused by two Projects, or one active team/channel claimed by different Projects;
- wrong actor cannot consume or poison the legitimate actor's project-scoped InteractionIntent/receipt;
- same provider delivery ID with changed body is quarantined; exact-body mode treats a changed attempt separately but domain CAS still prevents mutation;
- stale/expired Draft/Candidate/configuration intent;
- arbitrary `response_url`, URL/channel injection, secret leakage and attachment-body ingestion;
- forged capsule ID; mutable/foreign/aliased/expired key version; duplicate AEAD nonce; codec/AAD/token-hash mismatch; mismatched actor/subject/transport/Project/Profile/Connection/command/slot/target/payload/render/effect/fence;
- altered AAD schema digest, `retainUntil`, UTF-8/JCS bytes, 12-byte nonce or 16-byte tag; the golden vector must reproduce exact AAD hash, ciphertext, tag, token hash and decrypt result;
- missing/foreign retention policy evidence, capsule lifetime above the declared maximum, sweep interval above purge SLA, nonzero terminal purge SLA, or runtime WAL/backup/key-disable settings above pilot bounds;
- a logical DM with invented pre-delivery channel authority, routing a response with a new action ID, multiple posts for one action set, both `notify` and `callback.present` for one NotificationIntent, plaintext/ciphertext in command/log/audit/body capture, resend after invocation-marker ambiguity, or reuse after capsule purge;
- a reconciliation kind mismatching the pinned Profile, a pending ID from another command/fence/attempt, or an effect-marker hash not equal to the exact UTF-8 marker bytes of the invocation-owning attempt;
- model attempt to select grants, Profile, Project, approval, verdict, priority/due/assignee or production target.

## 8. PostgreSQL 17/18 and recovery matrix

```bash
corepack pnpm verify:004:migrations -- postgres=17
corepack pnpm verify:004:migrations -- postgres=18
corepack pnpm test:integration:004 -- durable-recovery
```

Both versions must pass fresh, 003→004 upgrade, repeat, failed-migration recovery and legacy Draft backfill. Backfill proves:

- legacy `DRAFT`, `SUBMITTED+WorkItem`, and `CANCELLED` map to the legal conversation states;
- orphan `SUBMITTED` fails/quarantines;
- `current_revision` is canonical and shadow-writes legacy payload/schema columns until every reader is revision-aware;
- same-scope foreign keys and exactly-one Agent subject constraints reject cross-Project rows;
- concurrent receipt/intents/decisions/revisions/confirmations have one CAS winner and stable replay.
- actionable notification, N action intents/capsules and one command/outbox commit atomically; terminal intent/command transitions erase capsules in the same UoW, while an expiry sweeper closes abandoned rows;
- crash before the invocation marker is byte-reproducible, crash after it is lookup-only, and active-store/WAL/backup/key retention honors the bounded purge/decrypt horizon.

## 9. Browser and full-process acceptance

```bash
corepack pnpm test:e2e:004
corepack pnpm smoke:004
corepack pnpm trace:004
corepack pnpm verify:004
```

`smoke:004` must launch real child processes, exercise all four user scenarios, restart worker/Mock Hub during durable work, and shut down cleanly. `trace:004` maps every FR-001…FR-025 and SC-001…SC-007 to executable evidence. `verify:004` checks task/source/contract/runtime digests and may return PASS only after all task-bound checkpoints exist.

Expected final local report:

```text
reports/004-mattermost-hermes-intake/final-gate.json
status: PASS
contour: qa-jira-mattermost-local
liveMattermost: SKIPPED_GATED | PASS
liveModel: SKIPPED_GATED | PASS
production: DENIED
```

## 10. Optional live non-prod validation

```bash
AWP_LIVE_MATTERMOST_OPT_IN=true corepack pnpm verify:004:nonprod --metadata config/mattermost-pilot-metadata.json
```

The metadata must validate against [mattermost-pilot-metadata.v1.schema.json](contracts/schemas/mattermost-pilot-metadata.v1.schema.json), identify one exact Workspace/Project, pin the fixed bootstrap continuation/static-purity evidence and project-scoped Connection/Profile/bot/callback contracts, and provide membership/redaction/retry/reconciliation evidence. Callback-enabled contours additionally pin the exact presentation key plus immutable retention policy/evidence and numeric capsule-lifetime, sweep/purge, WAL/backup and key-disable bounds; the verifier compares live settings and sampled expiry rows to every bound. A registry `DEVELOPMENT`/`TEST` contour runs only under runtime `NON_PROD`/`PREPROD` and proves distinct Project/environment credential fingerprints. Missing metadata, opt-in, approved callback contour or network access returns `SKIPPED_GATED`. A `PRODUCTION` value or endpoint fails before any network call.

## 11. Cleanup

```bash
corepack pnpm local:mattermost:down
```

Use the explicit local reset only when fixture data may be discarded:

```bash
corepack pnpm local:mattermost:reset
```

The reset command must refuse non-local contours and print the exact local volumes it removes.
