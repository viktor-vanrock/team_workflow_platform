# Tasks: Pilot Hardening & Conformance

**Feature:** 008-pilot-hardening-and-conformance · **Planned:** 2026-09-03

**Input:** [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/README.md),
[quickstart.md](quickstart.md), [pilot-inputs.md](pilot-inputs.md).
**Status:** 108/115 tasks complete; 7 remain. Task checkboxes record verified local implementation, not corporate readiness. C1/N2/P3 remain separately gated by supplied corporate prerequisites.

Progress paragraphs below retain historical implementation notes. The current
checkboxes and audit update supersede earlier claims of complete composition.

**Audit update (2026-09-06):** T025 reopened: startup/adapter registration is implemented, but complete domain API/worker wiring is not. T040/T057/T084/T104/T105/T106 still require real installation evidence or a corporate wrapper. See [deployment checklist](../../docs/runbooks/pilot-deployment-checklist.md) and [GitLab setup](../../docs/runbooks/gitlab-pipeline.md). Current regression results are recorded in `reports/project/local.json` and `reports/008-pilot-hardening-and-conformance/local.json`; old passing reports do not close missing implementation.

**Historical verification (2026-09-04; not current source proof):** Foundation `foundation-4c7bcaa0-6a2b-49b3-979a-043ac666cc5d` PASS: 592 tests and all 22 checks; PostgreSQL 17.7/18.6, four typechecks, 203 schemas, architecture, lint and unchanged-source proof. US2 `us2-f4a0d446-b342-42e7-a0ab-00457e4ce6b7` PASS: provider fault/recovery, six-dependency HTTP degradation, operator browser, independently counted mock-provider effects and unchanged source. US1 `us1-b200d34c-4f9f-4989-833d-166c929148ac` PASS after retained-volume down/up: 19 checks including Chromium login, draft confirmation, one Jira create POST and Collector reception. The development contour is healthy with `core=185`. Logs: `/private/tmp/awp-008-foundation-us2.log`, `/private/tmp/awp-008-us2-checkpoint.log`, `/private/tmp/awp-008-us1-after-us2.log`. C1/N2/P3 remain open; local evidence uses explicit development mocks.

Tests are required by the feature's conformance/security/recovery/acceptance
requirements. Author meaningful boundary tests before their implementation;
confirm the intended failure, then implement and run the story checkpoint.
All file paths are repository-relative planned targets or existing extension points.

Format: `- [ ] Tnnn [P?] [USn?] concrete work and file path`.
[P] means independent files after prerequisite phase, not permission to bypass a
gate. Setup/Foundation have no story label. All five stories have P1 priority.
External evidence tasks explicitly require C1/N2/P3 inputs; their blocked state
does not prevent later local engineering work. It does prevent full pilot closure.
Do not mark blocked/skipped tasks complete or count simulated results as real proof.

## Development scope — user update, 2026-09-04

Development proceeds using explicit mocks for unavailable corporate dependencies.
The runnable contour and its commands are documented in
[the development runbook](../../docs/runbooks/pilot-development.md). This changes
which external adapters are used for development; it does not manufacture C1/N2/P3
installation evidence or make unfinished software complete.

Completed developer delivery: isolated Compose launcher; shared migration/entity
selection; actual API/worker boot; conservative idempotent project seed; readiness
HTTP 503 on schema mismatch; graceful worker shutdown; real HTTP capability emulator
with durable observations; Chromium login and QA confirmation with exactly one Jira
POST on replay; Collector trace/metric reception. The final source-bound checkpoint
is recorded with T039 below when it passes.

Remaining US1 work is explicit: T020/T025 assemble and exercise the actual non-local
composition; T030 supplies its scoped connector authorities/leases; T037 completes
entry-point registration for that assembly; T040 verifies the selected corporate
installation after C1. These are not prerequisites for starting the development
contour. Later US2–US5 engineering remains in the phases below.

## Phase 1 — Setup

**Goal:** Bind the actual 007 baseline and make planned interfaces verifiable.

**Independent test/checkpoint:** Source-bound prerequisites and setup checks pass; missing corporate inputs remain explicit.

- [X] T001 Implement current-working-tree 007 report/child/source/lockfile/contract/migration validation in `tools/verification/feature-008-prerequisites.mts`; include untracked 007 files and reject stale evidence.

- [X] T002 Register planned quickstart command names and runnable checkpoint catalog in `package.json` and `tools/verification/feature-008-command-catalog.mts`; unfinished checkpoints must fail rather than return placeholder PASS.

- [X] T003 [P] Create assertion/evidence trace registry for all FR/SC and seven guardrails in `tools/verification/feature-008-trace.mts` using the matrix below.

- [X] T004 [P] Implement secret-free input-package validator and synthetic local example in `tools/verification/feature-008-inputs.mts` and `config/pilot/local-inputs.json`; enforce IN-01–IN-12/C1 without guessing corporate values.

- [X] T005 [P] Test gate-envelope shape, required-child skip/failure, digest tampering and scope mismatches in `tests/contract/008/gate-reports.spec.ts`.

- [X] T006 Implement immutable report writer/reader and source-bound child aggregation in `tools/verification/feature-008-reports.mts` against the design schema; validate safe references and current fingerprints.

- [X] T007 Implement and run setup checkpoint in `tools/verification/008-setup-gate.mts`; validate command catalog, 007 prerequisites and all design input contracts.

## Phase 2 — Foundation

**Goal:** Create shared contracts, persistence, safe configuration and reproducible failure fixtures.

**Independent test/checkpoint:** Default deny, immutable gates, authoritative scope and complete mock failure modes.

- [X] T008 [P] Test closed deployment/runtime/environment matrix, default credentials, fake components, missing inputs, untrusted URLs and digest mismatch in `tests/unit/008/deployment-policy.spec.ts`.

- [X] T009 [P] Test GateRun-to-L0/C1/N2/P3 mapping, stale evidence, skipped prerequisites and non-circular first activation in `tests/unit/008/gate-bridge.spec.ts`.

- [X] T010 [P] Test shadow/cohort/expiry/revocation/recovery fences at delayed dispatch and retry in `tests/integration/008/effect-fence.spec.ts`.

- [X] T011 Add typed deployment policies and strict startup parsing in `packages/runtime-composition/src/pilot/deployment-config.ts` and `packages/runtime-composition/src/config/environment.ts`; preserve legacy profile mappings explicitly.

- [X] T012 Add generic exact gate/cohort/fence models and bridge to existing ProjectOnboardingGateResult in `packages/platform-core/src/pilot/model.ts` and `packages/platform-core/src/pilot/gate-policy.ts`.

- [X] T013 Add scoped immutable gate/cohort/recovery records, indexed CAS headers and repositories in `packages/platform-persistence-typeorm/src/entities/pilot.entities.ts` and `packages/platform-persistence-typeorm/src/pilot.repository.ts`.

- [X] T014 Create additive `packages/platform-persistence-typeorm/src/migrations/core/0165-pilot-hardening.ts` after confirming registry availability; register entities/migrations and preserve all published 001–007 migrations.

- [X] T015 Compose deployment fence with existing Project effect guards in `packages/runtime-composition/src/pilot/effect-guard.ts`; deny-by-default at actual broker/worker invocation, never grant new rights.

- [X] T016 Register scoped pilot/report/replay permissions and classification/query contributions in `packages/platform-runtime-nest/src/auth/pilot-authorization.ts`; authorize before query/aggregation.

- [X] T017 Build two-Workspace/multi-Project fixtures and controllable IdP/secret/signer/telemetry/provider failure adapters in `tests/support/008-pilot-fixture.ts`; effects must be independently observable.

- [X] T018 Register additive pilot schema/event contributions in `packages/platform-contracts/src/pilot/schema-contributions.ts` and existing registries; preserve historical bytes and exact approval subject branches.

- [X] T019 Implement/run Foundation checkpoint in `tools/verification/008-foundation-checkpoint.mts`, including migration/immutability, scope, fence and actual fixture wiring checks.

## Phase 3 — US1: Bind corporate infrastructure (P1)

**Goal:** Run the complete QA API/worker using configurable identity, secrets, storage and telemetry.

**Independent test/checkpoint:** Local adapter login → request → scoped secret use → evidence signature → correlated Collector output; corporate proof separately gated.

- [X] T020 [P] [US1] Test API/worker boot through actual non-local composition selection with controlled sandbox adapters in `tests/integration/008/runtime-composition.spec.ts`; reject Core-only/no-op fallback and local personas.

  Evidence: the exact non-local selector now boots real Nest API and worker processes against published configuration on PostgreSQL 17.7 and 18.6. Both processes register the same deployment digest, become ready only as peers, expose no `/local/personas` route, install all ten named worker contributions and reject Core-only, missing, duplicate or `noop` fallback. Four container cases pass.

- [X] T021 [P] [US1] Test token kind/algorithm/issuer/audience/expiry/JWKS rotation, PKCE/session/CSRF, group mapping/revocation and step-up outage in `tests/integration/security/008/corporate-identity.spec.ts`.

- [X] T022 [P] [US1] Test scoped secret leases, purpose separation, rotation and outage/no-dev-fallback in `tests/integration/security/008/secret-resolution.spec.ts`.

- [X] T023 [P] [US1] Test exact remote JWS input/key version, historical public-key verification and signer outage in `tests/integration/008/corporate-signing.spec.ts`.

- [X] T024 [P] [US1] Test actual SDK export, durable correlation, bounded labels, redacted exceptions and export outage in `tests/integration/008/telemetry-export.spec.ts`.

- [ ] T025 [US1] Implement shared complete non-local factories in `packages/runtime-composition/src/pilot/composition.ts`; wire API/worker entry points and entity/migration selection in `apps/api/src/main.ts` and `apps/worker/src/main.ts`.

  Progress (2026-09-07, corporate onboarding API): `PilotNonLocalApiModule` now accepts an explicit `onboarding` bundle and installs the durable registry/resources/validation/bindings/operations/reads/evidence services together with the real corporate session BFF. Pilot and onboarding share one verified identity; ambiguous identities or missing inventory/crypto ports fail startup. Workspace registration and transaction rechecks preserve the IdP-restricted Core authorization basis, legitimate entitlement target principal IDs remain distinct from the actor, and GET/HEAD interaction reads no longer require mutation CSRF. Corporate authorization observes the canonical onboarding suspension head; only current HUMAN recovery/evidence maintenance can mutate a suspended project, with external effects and ordinary mutations still denied. The remote signer now emits the required envelope schema version; evidence factories receive only canonical project scope, excluding request callbacks and operation fields. PostgreSQL 17/18 HTTP proof includes OIDC/PKCE/step-up, group-policy narrowing and explicit new-project enrollment, grants to another human, suspension/incident disposition, real HTTP Vault signing, tampered signatures, export replay/restart, signer outage and membership revocation. See `docs/runbooks/corporate-onboarding-api.md` and `reports/project/corporate-onboarding-api.json`. Full QA/intake/queue/domain-worker/release-image composition remains open; this increment does not close T025 or claim corporate conformance.

  Progress (automation availability): `PublishedQaAutomationAvailability` and `PublishedAutomationAvailabilityModule` provide an explicit API slice using current scoped Core onboarding/configuration, published QA context/Suite, canonical document/report hashes and exact acceptance/probe pins. No fixed GitLab project ID or historical-publication EXISTS query is used. All eight required operations must have a fresh latest AVAILABLE observation; missing/negative/expired observations, non-active Core mode, revoked acceptance and changed heads deny launch readiness. SQL and total request deadlines are bounded; verified request authority is checked before SQL and after reads, configuration is read again after asynchronous authorization, classification ceilings are enforced and HTTP responses are no-store. This is a read projection; dispatch still requires its own command authorization, deployment readiness and effect fence. The selected provider conformance writer, Suite administration/session/worker wiring and complete entry-point composition remain open. PostgreSQL exposed and reproduced the context repository's invalid `-r1` revision ID in a UUID column; insertion now uses a UUID. Five focused tests pass. Foundation `foundation-48a8223d-33fc-457b-b9a8-e556c289ec41` passes 431 tests and all 19 checks; T025 remains open.

  Progress: evidence attachment metadata now persists in additive QA migration 2090. The shared HTTP controller uses a required durable upload service, exact scope/actor/classification/storage-policy checks and short fenced transactions. Uploaded bytes remain in the object store. Restart and lost-write recovery read the same exact S3 version without another PUT; finalize/replay atomically preserve one artifact/link. The local storage factory remains explicitly local/test, and the corporate storage adapter has a separate read-only recovery port. Six PostgreSQL 17/18 tests cover concurrency, drift/tampering, revocation, HTTP restart and real SigV4 storage requests; the HTTP identity port in this focused suite is controlled, not corporate conformance. Full corporate domain/API/worker composition remains open.

  Progress: manual Session controllers now require a composed runtime for profile resolution and capacity admission. The corporate implementation checks exact current published binding/profile/connection heads in the approved scope and NON_PROD environment, reauthorizes before/after resolution, and requires current `queue.work-admit` plus the project effect guard before Core capacity admission. Start/resume compares the whole pinned profile set; creation rechecks its material under the transaction lock. Seed profile 2 and the legacy queue flag are confined to an explicit local/test factory. PostgreSQL 17/18 tests cover each published-head drift, restart and revoked rights; existing session/lineage flows pass. Readiness now also has a required composed runtime: assessments, their current pointer and plan header persist atomically, repeated evaluations have independent versions, and original requester rights are read from Core. Corporate facts require the current published configuration/context plus a fresh confirmed Core operational projection. HTTP confirmation submits one Core command with a separate exact approval and HELD outbox; it never invokes the provider or writes READY. Concurrent calls and API restart return the same command, and a forced outbox failure rolls back command/approval/audit. Input revisions read persisted session/effect guards, atomically cancel unreleased READY commands and record invalidated decision references. Release/invocation contributions recheck exact inputs, current facts and initiator rights. Complete deployment composition still needs to install this contribution in every actual approval/worker path, supply the selected provider/mapping pins and wire confirmation/reconciliation. Defect wording proposals now also persist in additive migration 2095 with full scope and frozen-review foreign keys, immutable hashes, initiating authorization provenance and expiry. Reads survive restart; acceptance rechecks the current frozen review, source/hash/expiry and classification, including a later increase of the Work Item classification. An environment flag can no longer label template text as model-generated. Defect publication and approval now also use required runtime ports. Publication keeps draft acceptance, command, exact approval and HELD outbox in one transaction; it preserves the real frozen-review version/hash and replays the same operation after restart or concurrent callers. Corporate configuration checks both destination/request-authority chains, current published heads, hashes, NON_PROD scope, operation and classification ceilings plus the exact external target. Durable approval checks current initiator/approver Core grants, actual role, scope, expiry, self-approval and exact command subject before atomically consuming approval, authorizing the draft and releasing the outbox with audit. The shared controller performs no provider I/O; historical Jira/mock compatibility lives in an explicit local adapter. Native defect/completion worker effects, automation startup and complete entry-point wiring remain open.

  Progress (DoD): a required `QaDodRuntime` now evaluates persisted plans, current session reviews and adjudicative manifests, current artifact metadata/availability/classification, frozen findings, publication outcomes and actual verdict signatures. Client-supplied completeness/currentness inventories cannot produce READY_TO_CLOSE. Published policy resolution locks exact current context/risk heads, checks hashes and compiled rule/evidence dialects, and enforces project risk and classification ceilings. Assessments and their current pointer commit atomically; concurrent evaluations get distinct versions. Candidate preparation re-evaluates the exact latest assessment under the request lock and derives its summary/references from that proof, including clean PASS without an invented defect outcome. Corrected reviews invalidate old closure proof. Classified verdict/candidate/final-close reads and sanitized HTTP errors are also covered. Required-plan waivers without a durable decision resolver fail closed; signed v2/automation closure inventory, authoritative verdict creation/signing, and complete deployment composition remain T025. The completion progress below supersedes the previous local controller path.


  Progress (completion): required publication and approval runtimes now derive candidates from the latest verified DoD and fresh confirmed Core external revision. Exact current published binding/profile/mapping/connection hashes, NON_PROD target and classification ceilings are checked at creation, publication, distinct approval and invocation. Candidate/command/approval/HELD outbox creation and approval consumption/release are atomic and replay the same command after restart. Shared HTTP controllers perform no provider I/O and no HUMAN-to-SERVICE substitution; historical READY/input-version behavior is confined to an explicit local/test factory. Worker dispatch commits the QA mutation guard and Core execution fence in one transaction. The completion worker requires composed service/provider authorities; expired attempts acquire read-back fences, never requeue a write. An actual controlled HTTP lost-response test leaves one provider POST through restart, UNKNOWN/MULTIPLE/ABSENT lookups and final confirmation. Confirmed Core observation, DONE projection, final QA confirmation, a canonically hashed SATISFIED DoD preserving the original full inventory/rule/risk references, plan freeze, event and audit commit together. Forced dispatch/DoD/audit failures roll back; stale fences and changed confirmation replays are rejected. Selected Jira completion adapter, actual entry-point wiring and corporate conformance remain open; controlled provider evidence does not close T025/T030/T050.

  Progress (verdict and co-sign): the shared controller now also requires `QaVerdictRuntime`. Draft creation derives scope, version, effective risk and exact plan/review/evidence/finding/policy references; only human verdict/residual-risk judgment is accepted. Signature and supersession recheck the current server inventory, policy, actor/classification and actual QA Executor role. Effective risk includes Project policy, current request risk and approved waiver/accepted-risk elevation. A current independent QA Lead co-sign uses a persisted Core platform action plus exact expiring approval; equivalent requests replay the same action/approval, and consumption, signature, verdict projection, event and audit commit together. The UI exposes initial draft, risk judgment, primary signature, co-sign, DoD, candidate and asynchronous closure approval. Signed-verdict replacement atomically invalidates the old candidate, records BLOCKED DoD with preserved policy/inventory, and cancels its undispatched Core command/approval/outbox, so a new candidate can proceed. Ten focused PostgreSQL 17/18 cases pass, including actual lost HTTP response/restart, forged inputs, role/classification, request risk, concurrent signing/approval, rollback, stale evidence and replacement of an approved closure. Stale unsigned-draft replacement, full waiver/v2 inventory and corporate composition remain open.

  Progress (review correction): actual PostgreSQL regressions reproduced mutation after completion dispatch and an orphan queued closure after substantive review correction. Correction now joins the QA request lock, uses a transaction-bound invalidator, rejects in-flight/final closure, and checks current Work Item classification and request authority. Pending and already-approved commands, their exact approvals, outbox, candidate, canonical BLOCKED DoD and durable audit cancel together; the full original READY inventory/rule/risk references are preserved. A forced review-insert failure rolls every cancellation back. Both PostgreSQL versions pass the targeted cancellation/DoD regressions (18 cases), then verdict/correction compatibility and classification checks (15 cases). Foundation `foundation-5ec6faf5-1ad9-45c0-8c9b-920d8e1b339d` passed all 377 tests and quality gates; task count remains 31/115. General corporate composition and other unconnected mutation paths remain open.

  Evidence (final composition): non-local aliases now select the same complete owned entity/migration registry as their domain contour. `createPilotNonLocalComposition` requires an initialized source, exact published deployment, one scoped Jira/GitLab/Mattermost binding for every Project, a shared pinned transport, Vault lease factories and explicit startup inputs. API and worker entry points accept this closed assembly, start it before Nest listeners, pass its readiness lifecycle to health, and close the deployment before its DataSource. Corporate API modules contain guarded pilot routes only; worker modules require the exact ten-contribution set. Controlled PostgreSQL 17/18 entry-point proof and all four typechecks pass.

- [X] T026 [US1] Extend pinned token policy in `packages/platform-runtime-nest/src/auth/oidc-auth.guard.ts` and implement corporate session/scope adapters in `packages/runtime-composition/src/security/corporate-identity.ts`; remove local-persona dependencies from corporate routes.

  Progress: pinned JWT verification, group restrictions, current Core rights, revocations and durable sessions are implemented. Shared QA guards now bind authority to the authenticated request; corporate adapters enforce CSRF/step-up and derive classification from exact current Core entitlements. QA request/session/evidence/automation/Hermes controllers use this guard. Intake configuration is injected, with local seed profiles and response channels confined to an explicit local adapter. All four Hermes query paths now authorize before SQL. Actual Nest/OIDC/PostgreSQL tests cover scope, suspended projects, expiry/revocation, CSRF and restart. Legacy direct-controller fixtures now bind identity explicitly and use current ETags/onboarding bootstrap. Queue/SLA/policy/control/portfolio and approvals now also accept a composed corporate request authority; portfolio membership rechecks complete Core rights and explicit DENY, approval decisions authorize before SQL, use the current role and enforce configured step-up/expiry. Generic Core intake, operational HTTP and Mattermost project selection now also use verified request authority before SQL/effects. Project-option intents bind a server-derived session hash; CSRF, cross-browser replay, current-rights checks on consumed intents and exact definition references on draft revisions are tested with real HTTP/PostgreSQL. Local operational handlers and agent grant fixtures are explicitly isolated behind required ports. Artifact HTTP also uses the verified request and explicit scope selectors, rechecks current classification/QA contributions before metadata and each streamed chunk, and does not consult local personas. Real HTTP/PostgreSQL proves cross-scope and classification denial, no denied storage reads, private/no-store responses and revocation. Shared session/scope adapters are complete; full domain/API/worker composition remains T025, and this does not claim C1 conformance.

- [X] T027 [US1] Implement server-side OIDC code/PKCE session callbacks and CSRF/step-up lifecycle in `packages/platform-runtime-nest/src/auth/corporate-session.controller.ts`; browser stores only protected session cookie.

  Evidence: independent HTTP IdP negatives; encrypted PostgreSQL sessions on 17.7/18.6; real Nest login/callback/session/logout with Core authorization, restart, CSRF, cross-scope denial and immediate membership/identity revocation. Exact corporate IdP configuration and deployment wiring remain T025/T040; no corporate conformance is claimed.

- [X] T028 [US1] Implement purpose-scoped Vault-compatible resolution adapter in `packages/runtime-composition/src/security/vault-secret-resolver.ts` using existing connector lease/allowed-use ports; selected corporate auth method requires C1.

- [X] T029 [US1] Implement remote signer/public-key history adapter in `packages/runtime-composition/src/security/corporate-evidence-signing.ts`; pin key versions and preserve detached-JWS/evidence contracts.

- [X] T030 [US1] Inject real scoped Jira/GitLab/Mattermost authorities and secret leases in `packages/runtime-composition/src/pilot/connector-factories.ts`; replace local-only factory selection without relaxing local guards.

  Progress: distinct client factories now bind exact scope/profile/connection/policy to separate read/write/webhook Vault leases and pinned egress. PostgreSQL authority rechecks canonical SERVICE identity, current Core rights and current published binding/profile/connection chain; writes require a dispatched durable command and the existing pilot command guard. Tests cover actual three-provider HTTP authentication, native GitLab trigger translation, lease expiry, credential override, Vault outage, revocation and current-head drift on PostgreSQL 17/18. Remaining: integrate these factories into the complete API/worker domain authorities in T025; C1-selected corporate protocol proof is still absent.

  Evidence (integration): the non-local composition now constructs `CorporateConnectorFactories` from the same pinned network object used by startup, enforces exactly one corporate Jira/GitLab/Mattermost binding per configured Project and matches each provider endpoint to the immutable deployment. There is no local resolver selection in this path. Six connector HTTP/lease cases, startup regressions and the two-version entry-point proof pass. C1 remains a separate corporate-input gate in T040.

- [X] T031 [US1] Implement distinct corporate object-store adapter and GitLab-only source policy in `packages/runtime-composition/src/storage/corporate-object-storage.ts` and `packages/runtime-composition/src/pilot/artifact-source-policy.ts`; test required manual attachments.

  Evidence: 14 adapter/source-policy tests pass, including real SigV4 HTTP verification, lost-response reconciliation without duplicate versions, checksum/version/scope denial, cancellation and revocation before streaming. GitLab-only admission requires exact current source/retention pins and does not waive required manual evidence. Typecheck and targeted lint pass. Full API/worker factory integration and corporate provider evidence remain T025/T030/T040.

- [X] T032 [US1] Wire real due-probe and retention repositories into `apps/worker/src/app.module.ts` and `packages/runtime-composition/src/pilot/maintenance-workers.ts`; enrich existing CapabilityProbeResult freshness/pins, eliminating empty-work stubs.

  Evidence: retention uses real immutable decisions, holds and artifact locks; due probes load current published plans, verify registration and exact pins before/after bounded HTTP observation, and persist probes plus assessment atomically. The explicit development observer calls the capability emulator; it does not return a constant success. PostgreSQL 17/18 proves fresh AVAILABLE observations, DEGRADED after HTTP fault and restart, stopped calls after registration revocation, immutable history and conservative repeated seed. Production-specific provider observers remain part of T030/T040 under the user's explicit dev-mock scope. Foundation `foundation-b78e08d9-a77b-4c56-919e-dbfc7b2e0319` passes 435 tests and all 22 checks; US1 `us1-6f082033-56a0-4042-b6e6-b85f68f12656` passes all 19 checks. Physical object deletion remains outside this availability worker.

- [X] T033 [US1] Add reviewed SDK/exporter bootstrap and shutdown lifecycle in `packages/platform-runtime-nest/src/observability/bootstrap.ts`; wire API/worker before instrumentation and extend `infra/observability/otel-collector.yaml` for secured exports.

  Evidence: Node SDK 2.11.0 / OTLP HTTP 0.222.0, exact additive dependency review and audit; actual Collector 0.135.0 with test mTLS; canary removal in SDK and Collector; bounded failure/flush; Nest close lifecycle; PostgreSQL command reconstruction preserves correlation/causation into worker exports. Local telemetry is opt-in via AWP_OTEL_COLLECTOR_ORIGIN; non-local bootstrap requires a corporate composition binding (T025/T037). Corporate policy references, network enforcement and readiness/gate consumption remain in their corresponding tasks.

- [X] T034 [US1] Replace raw error logging and unbounded metric dimensions in `packages/platform-runtime-nest/src/observability/telemetry.ts` and API/worker entry points; preserve scoped trace/audit correlation.

- [X] T035 [US1] Implement authenticated readiness/health queries and evidence import boundary in `apps/api/src/extensions/pilot/pilot.controller.ts` and `packages/runtime-composition/src/pilot/readiness-query.ts`.

  Progress: scoped Nest endpoints now use current Core request authority and classification before SQL/disclosure. Immutable report import verifies real Ed25519 signatures, exact policy/key/subject refs, all report/prerequisite/evidence byte hashes, fingerprints, expiry and bounded store access. Concurrent/restarted requests persist one execution and audit; revocation and forced audit failure prevent/roll back publication. Readiness consumes the current deployment, exact reviewed input package and existing Core gates reconstructed from freshly verified reports; health uses exact current Core capability probes. PostgreSQL 17/18 plus signature negatives pass all 12 targeted cases, including tampered evidence, key revocation, gate ordering, head drift and missing/expired inputs. Typecheck and targeted lint pass. Foundation `foundation-2b7ebc80-63ea-46f4-9dbf-8dde44afef61` passes all 396 tests and quality gates. Current input/policy/artifact adapters and deployment registration remain required composition work in T025/T037. No corporate C1/N2/P3 evidence is claimed.

- [X] T036 [US1] Add scoped readiness/health/login UI in `apps/web/src/routes/pilot/readiness.tsx` and existing app routing; show actionable owner/input/freshness reasons.

  Progress: the corporate/scope entry now mounts a same-origin BFF client and separate pilot screen. It displays exact deployment/gate status, existing capability health, all twelve input owners and renewal/review actions. Provider tokens never enter browser storage; login, step-up and logout use the corporate session boundary. Scope changes, refresh and access/session loss clear old data, and expiry removes green status. Three HTTP-client boundary tests, web/test typechecks, targeted lint and production web build pass. All four Chromium cases now pass: corporate entry avoids local personas, expiry removes green status, late responses cannot cross project scope, and denial/logout clear data with the current CSRF token. Frozen test timers and the required-field locator were corrected. Foundation `foundation-2b7ebc80-63ea-46f4-9dbf-8dde44afef61` passes all 396 tests and quality gates; the actual corporate adapter/correlation journey is T038.

- [X] T037 [US1] Enforce validated config and API/worker digest readiness before effects in `packages/runtime-composition/src/pilot/startup.ts`; remove non-local implicit defaults and validate actual network/callback policy.

  Progress: `DeploymentStartup` now validates the immutable configuration, observed image, exact callback/browser URLs and actual network-policy hash before SQL. Required current-reference resolution is bounded and rechecked after DNS policy validation. Each allowed Project must have the exact current hashed DEPLOYMENT record. Core migration 0175 stores immutable process incarnations with database-clock leases; readiness requires both API and worker with matching configuration/image/version, rejects live mixed revisions, and cannot revive stopped/expired registrations. NON_PROD effects require this startup check and reload the fence afterward. Actual API/worker readiness routes return 503 for missing/stale deployment state and preserve liveness; application lifecycle renews and stops registrations. Both entry points now explicitly reject the incomplete corporate composition before telemetry/module initialization instead of silently selecting Core-only. Twenty-two focused cases pass, including both PostgreSQL versions, real HTTP endpoints, blocked SQL, validation deadline, policy drift, rollout, shutdown, expiry and zero denied effects. Foundation `foundation-f73d2107-a0f4-481c-b560-1571e162eb70` passes all 418 tests, PostgreSQL 17.7/18.6, four typechecks, 203 schemas, architecture, lint and unchanged-source checks. Full corporate factories and concrete published-reference resolution/entry-point registration remain T025/T037; these tasks are not closed by the controlled fixtures.

  Progress (published configuration): additive migration 0180 and `RuntimeConfigurationRepository` now persist immutable scoped policy/input/provider documents, separate document/publication hashes, exact replay, CAS selection and terminal version revocation. Publication/revocation history commits atomically; forced event failure rolls back publication. `PublishedDeploymentReferences` resolves all current publications for every declared Project, shares the CLI metadata validator, and verifies the actual current hashed Binding/Profile/Connection chain. `createPublishedDeploymentStartup` constructs this resolver internally; arbitrary successful reference callbacks are not accepted by that factory. Actual PostgreSQL 17/18 cases prove real lease renewal, policy revocation blocking the next effect, partial input scope and missing metadata denial, provider head/hash drift, bounded SQL locks, immutable history and failed-publication rollback. Readiness receives the real input projection and remains blocked without gate evidence. Full corporate adapter/domain assembly, authorized configuration administration and entry-point wiring remain open under T025/T037. The targeted run passes 16 tests. Foundation `foundation-eaa9de7d-c523-40de-adb8-97c4988aa42e` passes all 426 tests (302 boundary/database, 7 published configuration/startup, 34 onboarding, 42 QA/HTTP, 4 Chromium UI, 1 browser/OIDC/storage/Collector, 8 automation-result, 12 completion-domain, 3 durable delivery and 13 telemetry/trust regressions), PostgreSQL 17.7/18.6, four typechecks, 203 schemas, architecture, lint and unchanged-source fingerprints. All 19 checks pass. T025/T037 remain open; 34/115 tasks complete, 81 remain.

  Evidence (entry points): both main processes now require an explicit non-local assembly, construct only the published-reference startup, call `start()` before Nest creation/listening, publish the same deployment/image/config digest to readiness and stop it before closing the source. Missing corporate composition still fails before telemetry/module initialization. The only loopback exception requires both `NODE_ENV=test` and `AWP_PILOT_ADAPTER_MODE=controlled-sandbox`; it does not enable Mock Hub, S3Mock, raw object-store credentials or local persona modules. PostgreSQL 17/18 boot and shutdown pass.

- [X] T038 [US1] Verify browser login/scoped health and actual request-to-evidence correlation in `tests/e2e/008/corporate-bindings.spec.ts` with controlled local adapters.

  Evidence: actual Chromium login through an independent PKCE IdP and Nest BFF reaches scoped pilot health and the durable QA evidence API. PostgreSQL, SigV4 object storage and an mTLS Collector prove one object, atomic evidence/link/audit publication, rollback on audit failure, replay without duplicate audit, and immediate membership revocation. The response and durable audit share the normalized correlation ID with actual parent/child Collector spans, scope and causation; private evidence/error canaries are absent. Safe incoming correlation IDs preserve the existing HTTP contract. The SDK interval validation now rejects an invalid exporter deadline before reserving global ownership. Foundation `foundation-837b68dd-7b84-41bd-a195-a8d78557bcb8` passes all 406 tests, PostgreSQL 17.7/18.6, four typechecks, 203 schemas, architecture, lint and unchanged-source checks. Complete startup/composition and corporate conformance remain T025/T037/T040; this proof uses controlled local adapters.

- [X] T039 [US1] Implement/run local US1 checkpoint in `tools/verification/008-us1-checkpoint.mts`; mark corporate binding conformance separately gated.

  Evidence: `us1-6f082033-56a0-4042-b6e6-b85f68f12656` is PASS with all 19 checks and a verified immutable Foundation prerequisite (`foundation-b78e08d9-a77b-4c56-919e-dbfc7b2e0319`, 435 tests / 22 checks). The actual Compose API/worker/web/IdP/Mock Hub/S3Mock/Collector run passes Chromium login, QA draft creation, durable worker confirmation and repeated confirmation; the independent Jira emulator write log contains exactly one create POST. Source hashes are unchanged. Corporate binding conformance remains BLOCKED_INPUT and corporateReady=false. The first aggregate attempt was interrupted by Docker OOM; the full suite was rerun after recovery and partitioned into bounded groups without dropping any tests. Ordinary development down/up was separately verified in `reports/008-pilot-hardening-and-conformance/evidence/dev-restart-329d112c-c6db-4a72-8b86-6a46fccb5fe3/result.json`: all three volumes remain, the provider create count stays 1, and API/worker return ready. Docker OOM recovery had required re-seeding the development data before this normal-restart verification.


- [ ] T040 [US1] After C1 metadata is supplied, pin selected real protocol/auth strategy and sanitized fixtures in `config/pilot/provider-capabilities.json` and a scoped input report; record unsupported capabilities instead of substituting versions.

  Handoff ready: `docs/runbooks/pilot-integration-intake.md` contains the owner questionnaire, exact IN-01–IN-05 fields, provider-version/dialect/permission requirements and C1 validation command. Execution still requires approved corporate values.

## Phase 4 — US2: Survive connector failures (P1)

**Goal:** Conform exact protocols and recover uncertain effects without duplicating writes.

**Independent test/checkpoint:** Independent stateful provider counts prove degradation/replay behavior through routes and workers.

- [X] T041 [P] [US2] Test native/proxy integrity, source authentication, freshness, forged headers, replay/body conflict and binding scope in `tests/contract/008/provider-ingress.spec.ts`.

  Verified: 6 contract cases plus 14 actual HTTP/PostgreSQL/mTLS cases on PostgreSQL 17.7/18.6 cover native Jira/GitLab and trusted-proxy receivers, exact configured conformance, key overlap/expiry, anonymous and unpinned source rejection, forged unsigned headers, original freshness, body conflicts, concurrent delivery, restart, current-head drift, service/human revocation, atomic receipt/outbox and intent rollback. Foundation `foundation-7c417ec6-351b-4d1d-ae22-5458a0c731b6` PASS: 550 tests/all 22 checks. The conformance/human/service authorities in the focused tests are explicit development fixtures, not installed corporate evidence.

- [X] T042 [P] [US2] Test lost write responses, delayed search, multiple markers, actual GitLab SHA and no unsafe retry in `tests/integration/008/uncertain-effects.spec.ts`.

  Verified: 22 real HTTP/PostgreSQL cases on both supported majors, with providers that create a new object for every POST. Cloud/DC delayed search cannot authorize a second Jira issue; same-claim concurrent creates are fenced. GitLab delayed/zero/multiple/actual-SHA/forged-receipt/unavailable lookups and confirmation rollback converge without new writes; concurrent recovery performs one lookup. Existing Mattermost lost-response and independent write-count cases also pass. A separate deterministic PostgreSQL snapshot regression proves the shared recovery scan does not lock already-invoked lookup-only commands. Foundation `foundation-033d1672-3182-49fe-8e1e-a572dcf624f8` PASS, 530 tests/22 checks; US1 `us1-b35625c9-6ddd-4946-b72d-60adeb04ce1b` PASS. Provider-specific completion adapter work remains T050.

- [X] T043 [P] [US2] Test the complete dependency degradation matrix and 401/403/429/5xx/timeouts in `tests/integration/008/degradation-matrix.spec.ts`.

  Verified: the complete six-dependency HTTP matrix covers 401/403/429/500/502/503/504/timeout, one observation per probe, affected-action denial, independent manual/web work, OIDC session continuity and fresh-positive recovery without provider-body disclosure. Unit projection tests retain exact probe freshness and pins. US2 `us2-f4a0d446-b342-42e7-a0ab-00457e4ce6b7` PASS.

- [X] T044 [P] [US2] Test owner/age/expiry, altered payload, stale approval and revoked access on replay in `tests/integration/008/dead-letter-replay.spec.ts`.

  Verified: 34 real PostgreSQL/HTTP integration cases on both supported majors plus 4 unit and 2 Chromium cases cover immutable owner/age/expiry, exact payload/target hash, invocation uncertainty, exact approval replacement/expiry, original initiator/approver and operator revocation including the final pre-commit race, policy/pin drift, replay budget, row-version CAS, cross-scope reads, lost-response idempotency and no raw payload disclosure. The original effect key and consumed approval survive. Dispatch expiry and repeated dispatcher calls produce zero or one invocation. Foundation `foundation-20752fce-4551-46fd-946c-a9b9f412b7b9` PASS includes these cases.

- [X] T045 [US2] Implement exact capability/dialect conformance selection in `packages/runtime-composition/src/pilot/provider-conformance.ts`; verify actual installed capabilities before enabling corporate routes.

- [X] T046 [US2] Wire Jira native auth/freshness/authoritative-reread dialects in `packages/runtime-composition/src/jira/corporate-ingress.ts`; reuse `packages/connector-jira/src/webhooks/jira-webhook-normalizer.ts` and durable receipts.

- [X] T047 [US2] Wire exact signed GitLab dialect/key rotation/replay policy in `packages/runtime-composition/src/gitlab/corporate-ingress.ts`; preserve `packages/connector-gitlab/src/webhooks/gitlab-webhook-normalizer.ts` requirements.

- [X] T048 [US2] Wire authenticated signed-proxy plus opaque-intent callbacks in `packages/runtime-composition/src/mattermost/corporate-ingress.ts`; preserve source/human binding in `packages/connector-mattermost/src/ingress/callback-auth.ts`.

- [X] T049 [US2] Implement/test trusted ingress adapter contract and deployment policy in `packages/runtime-composition/src/pilot/trusted-ingress.ts` and `config/pilot/ingress-policy.example.json`; reject anonymous signing and stale original intents.

  Evidence for T045–T049: `ProviderIngressModule` mounts explicit native/gateway/receiver deployments only after conformance validation. `ProviderIngressRuntime` snapshots raw bytes, checks exact evidence and current binding/profile/connection heads and content hashes, and commits existing Core receipts with read/intent hints in one transaction. Scope/connection locks serialize semantic/delivery aliases. Jira's signed raw body identity prevents a changed unsigned delivery header from producing another event; the selected Cloud/DC dialect requires a signed body timestamp and exact project. GitLab preserves its native Standard Webhooks normalizer and rejects token fallback. Mattermost authenticates the actual Node TLS peer against the approved CA and exact certificate hash before intent lookup; forwarded cert headers cannot substitute. Original intent scope/human/action, expiry and current authority are rechecked under lock, including duplicate deliveries. Consumption and outbox rollback together; raw callback tokens are not persisted. Proxy signatures bind raw hash, route/method, exact policy/scope/source/key, semantic identity and original/proxy times independently. Configuration bounds key overlap, skew, body/header size and retention. Unsupported dialects and missing/unverified installed evidence fail closed. `config/pilot/ingress-policy.md` documents the host ports and deployment contract. Foundation `foundation-7c417ec6-351b-4d1d-ae22-5458a0c731b6` passes all 550 tests/22 checks. Complete API/worker entry-point composition, business intent-handler assembly and actual corporate evidence remain T025/T030/T040/T057; the tested module does not claim those gates.

- [X] T050 [US2] Complete provider-specific confirmation/unknown-result quarantine adapters in `packages/runtime-composition/src/pilot/effect-confirmation.ts`; reuse existing connector command/effect ledgers and preserve supported Jira conflict strategy.

  Verified: GitLab receipt/window/SHA validation and Jira marker searches preserve their existing durable ledgers and quarantine ambiguous or multiple effects. Final Jira completion/transition read-back now requires the exact effect ID, summary hash, configuration chain, external entity/revision, post-invocation observation time and source. Its bounded attempt/elapsed policy transitions an expired lookup-only command to `QA_COMPLETION_EFFECT_UNRESOLVED` under outbox→command locks; it never returns to the write queue. Existing authoritative Jira conflict strategy remains unchanged. Corporate protocol selection still requires T040/T057 evidence. US2 `us2-f4a0d446-b342-42e7-a0ab-00457e4ce6b7` PASS.

- [X] T051 [US2] Implement bounded classified retry/rate-limit policies in `packages/runtime-composition/src/pilot/retry-policy.ts`; no business/assertion retries, permission escalation or fresh effect key after uncertainty.

  Verified: shared HTTP/error classification and effect-certainty decisions; four-attempt/five-minute read budgets in durable GitLab and Mattermost workers. Retry-After is a minimum; invalid or oversized hints stop the operation. GitLab attempt identity belongs to the original outbox record, survives restart and cannot be bypassed by unrelated successful observations. Business/assertion/auth failures stop, and uncertain writes remain read-only. Foundation `foundation-2a9ae202-1d11-4cb0-b477-17054fb6262a` PASS includes HTTP/PostgreSQL 17/18 failures, restart, immutable payload/identity and independent effect counts.

- [X] T052 [US2] Compose per-capability admission and freshness policy in `packages/runtime-composition/src/pilot/degradation-policy.ts`; retain unrelated manual/web work and evidence completion rules.

  Verified: exact Core-probe projection shared by health/readiness and automation admission, plus per-action policy for all six dependency rows. Missing, expired, future-dated or mismatched observations deny dependent actions without changing persisted capability mode. Cached Jira state is marked stale; deterministic/manual/web work, required-evidence gates and original short-session expiry are preserved. Foundation `foundation-2a9ae202-1d11-4cb0-b477-17054fb6262a` PASS includes matrix, current authority, exact pins and PostgreSQL query tests. Full cross-dependency route/worker outage orchestration remains T043/T056.

- [X] T053 [US2] Implement durable dead-letter owner/age/diagnostics and replay-decision service in `packages/runtime-composition/src/pilot/dead-letter-service.ts`; bind original command/current guards/exact approval.

- [X] T054 [US2] Wire scoped replay query/action API and UI in `apps/api/src/extensions/pilot/pilot.controller.ts` and `apps/web/src/routes/pilot/dead-letters.tsx`; never expose raw provider payloads.

  Verified for T053–T054: additive Core migration 0185 stores append-only diagnostics and decisions. The service uses outbox→command lock order, immutable semantic hashes, exact current approval, required OriginalReplayGuard proof, final authority rechecks, bounded cursors and same-command/request-key uniqueness. Requeue, decision and audit commit together; invoked effects only reconcile. The Nest module requires an explicit verified identity and service, sanitizes errors and sets `private, no-store`. The same-origin BFF UI clears scope/identity/revocation state, uses current CSRF, disables expired/uncertain actions and retains the exact request after an unconfirmed response. The tested module does not manufacture corporate evidence; complete non-local entry-point composition remains T025. Foundation `foundation-20752fce-4551-46fd-946c-a9b9f412b7b9` PASS; dev `core=185`; US1 `us1-5dbae22a-326c-46b8-8262-28153d6f34cc` PASS.

- [X] T055 [US2] Complete durable notification expiry/dedupe/readback behavior in `packages/runtime-composition/src/mattermost/notification-worker.ts`; shadow records cannot be released as a later backlog.

  Verified: persistent SHADOW suppression with immutable dedupe content checks, atomic projection/enqueue, expiry before invocation, atomic command/intent markers and final results, and fenced read-only recovery. Zero/multiple/wrong-channel lookup matches and exhausted read budgets become AMBIGUOUS without a new POST. PostgreSQL 17/18 tests independently count HTTP writes and cover process/database restart, concurrent recovery, dispatch rollback and confirmation rollback. The emulator lookup protocol is explicitly separate from installed-provider selection (T045/T050). Foundation `foundation-2a9ae202-1d11-4cb0-b477-17054fb6262a` PASS.

- [X] T056 [US2] Implement/run US2 fault checkpoint in `tools/verification/008-us2-checkpoint.mts`, counting provider effects independently after worker restart and lost response.

  Verified for T056: the checkpoint requires current Foundation evidence, replays the complete provider-fault suites and Chromium, and binds the Jira issue, GitLab pipeline, Mattermost message and completion-effect one-write assertions by source hash. `us2-f4a0d446-b342-42e7-a0ab-00457e4ce6b7` PASS. Corporate N2 is recorded separately as `BLOCKED_INPUT`.

- [ ] T057 [US2] After C1 and approved sandbox scope, implement/run N2 conformance in `tools/verification/feature-008-integration.mts`; save exact real-provider evidence and BLOCKED_INPUT for missing corporate prerequisites.

  Handoff ready: the shared validator now requires hashed `status: ACCEPTED` non-local entries, N2 validates the complete input package, and the runbook includes the exact real-provider evidence bundle and command. Actual sandbox execution remains `BLOCKED_INPUT`.

## Phase 5 — US3: Prove security and quality (P1)

**Goal:** Demonstrate isolation, safe approvals/ingress, secret-free outputs and bounded Hermes behavior.

**Independent test/checkpoint:** Actual endpoints/worker effects reject adversarial attempts; release artifact scans and corporate proof are independent.

- [X] T058 [P] [US3] Implement access/IDOR/search/cache/export/report isolation matrix in `tests/integration/security/008/access-boundaries.spec.ts` using multiple Workspaces/Projects and HUMAN/SERVICE principals.

  Verified: the matrix uses two Workspaces, multiple authorized and forbidden Projects and HUMAN/SERVICE identities. Database and HTTP projections authorize before lookup, return a strict report allowlist, set `private, no-store`, reject body/query scope mismatch, hostile cursors and unknown query fields, and never disclose raw provider payloads. Search cursors are bound to the exact visibility hash; catalog/report/export projections contain only the token's authorized Project set, and forbidden resources are indistinguishable from missing resources. Earlier classification, draft/link and verdict authorization defects remain covered by their PostgreSQL regressions.

- [X] T059 [P] [US3] Implement forged approval/action swap/config drift/expiry/race tests at consumption and dispatch in `tests/integration/security/008/exact-approvals.spec.ts`.

  Verified: an attacker-rehashed approval with a swapped action still fails its exact command binding. Current rights, configuration pins and expiry are rechecked in the consuming transaction; competing decision keys serialize to one original command/effect identity. Dispatch independently rejects an expired replay authorization before the provider-effect marker or callback can run.

- [X] T060 [P] [US3] Implement actual log/trace/metric/audit/evidence canary checks and secret-store error redaction tests in `tests/integration/security/008/secret-canaries.spec.ts`.

  Verified: actual safe log writes and OTLP trace/metric export remove hostile attribute, span, exception and instrument canaries. Vault error bodies, workload credentials and resolved secret material do not enter the surfaced error or log and no fallback/retry occurs. PostgreSQL 17/18 scans of dead-letter report, durable audit and evidence/decision records show that private command payload, payload hash and effect key remain absent.

- [X] T061 [P] [US3] Implement callback/redirect/DNS-rebinding/SSRF/size/timeout negatives in `tests/integration/security/008/network-policy.spec.ts`.

- [X] T062 [P] [US3] Create versioned synthetic intake/triage/evidence corpus in `tests/fixtures/008/hermes-corpus.json`; include all exact subject branches, injection, drift and cross-item context leakage.

  Verified: corpus 1.0.0 pins 21 synthetic cases across intake/triage/evidence and DRAFT/CANDIDATE/WORK_ITEM. It includes untrusted retrieved instructions, foreign workspace/project/item/classification/denied-source bait, subject version/hash/aggregate/kind drift, rights revocation, unavailable/disabled/low-confidence/hanging/invalid model responses. Corpus content and all source facts are hashed; missing subject branches or tampered hashes are rejected.

- [X] T063 [US3] Close failures from the access/approval matrices in existing Core authorization/command gateways and `packages/runtime-composition/src/pilot/effect-guard.ts`, preserving default deny and one action identity.

  Verified: authorization results carry the exact Project scope and are rechecked after asynchronous work. Core approval semantics bind action, target, payload, expected state, binding/profile versions and effect key; durable consumption and replay preserve one command identity. `PilotCommandEffectGuard` reloads current startup/fence/cohort state before every invocation and denies missing admission, actor/payload/target drift, revocation, expiry and runtime/configuration drift.

- [X] T064 [US3] Enforce normalized outbound/ingress network policy through `packages/runtime-composition/src/pilot/network-policy.ts` and existing connector transports; preserve approved private network access.

  Verified: the versioned outbound policy validates origin/path/method/query, every DNS answer, approved CIDRs and forbidden metadata/transition ranges; explicit corporate private CIDRs remain usable. Native HTTP/TLS connects to the approved resolved address while preserving original Host/SNI and certificate identity. Redirect, rebinding, streaming/request size, credential/header override, cancellation/deadline and certificate negatives pass. Vault, OIDC/session, object storage, Collector and Jira/GitLab/Mattermost factories all use the same pinned transport. The trusted ingress adapter separately binds route, raw-body hash, source identity, exact policy and time. Full application composition remains T025/T030/T037 and real-provider proof remains T057.

- [X] T065 [US3] Implement corpus/evaluation runner in `tools/verification/008-hermes-evaluation.mts` and versioned runtime evaluator in `packages/runtime-composition/src/hermes/evaluation.ts`; validate schema/grounding/grants/fallback.

  Verified: `verify:008:hermes` executes actual QA skills, prompt minimization and Core grant gateway through an explicit development provider/authority fixture. All 21 cases pass: 12 deterministic fallbacks, 5 drift/revocation refusals, 18 forbidden tool calls denied, zero unauthorized operations and zero canary leakage. The evaluator checks actual outputs without synthesizing a replacement fallback, does not expose expected answers to the execution port, pins loaded candidates, and reports unobserved measurements as null/FAIL. Triage now validates the exact schema, immutable identity/facts/provenance, confidence and a bounded abortable deadline. Negative tests prove output-scope, source, mutation, leakage and missing-observation detection. Corporate model quality remains NOT_EVALUATED.

- [X] T066 [US3] Implement evaluated prompt/model/skill promotion and compatible rollback references in `packages/runtime-composition/src/hermes/evaluation-policy.ts`; invalidate stale pending proposals.

  Verified: the service requires a current exact HUMAN-reviewed evaluation through its authority port, compatible runtime/schema refs and matching candidate/corpus hashes. Append-only MODEL_POLICY revisions and their existing audit events commit with pending triage/session-plan invalidation. PostgreSQL 17.7/18.6 tests prove promotion, exact replay, evaluated prompt change, compatible historical rollback, wrong refs/revoked rights/review denial, CAS races, restart and complete rollback on audit failure. QA migration 2100 fences new proposals by the exact current published/unexpired policy ref; delayed responses cannot become CURRENT. HUMAN-accepted plans and other Project data stay intact. Replaying an already stale triage snapshot returns its persisted STALE state. Live application composition and corporate authority adapters remain T025/T070.

- [X] T067 [US3] Implement independently observed effect-to-durable-audit coverage in `tools/verification/008-audit-coverage.mts`; unknown measurements cannot count as zero violations.

  Verified: the local walking-skeleton now persists an authorized effect intent before provider I/O, then confirms the result and durable audit in a transaction; the approval path records exact consumption. The runner creates direct and approved effects and independently joins `awp_mock.mock_effects`, Core commands and append-only audit events by exact effect key, scope, command, correlation and causation. Run `audit-43d8cf6f-2bb8-4d44-a99d-1c5928620f87` PASS observed two provider effects, both covered, with effect count 1. Missing provider/command/intent/result/approval observations, scope/correlation drift and duplicates fail; an unavailable source reports null/FAIL rather than zero. The explicit DEVELOPMENT_MOCKS result does not claim pilot audit completeness.

- [X] T068 [US3] Implement dependency/image scan adapter and pinned scan database/policy evidence in `tools/verification/008-security-scans.mts`; critical findings must be closed and missing scans remain blocked.

  Verified: the strict adapter rejects unknown fields, missing evidence, artifact/scanner/database/policy drift, stale reports/databases, duplicate findings, open critical/high findings and invalid risk acceptance. The development policy and synthetic scanner-database fixture are content-addressed; the saved dependency snapshot is bound to the current lockfile and its two moderate `qs` findings have exact owners and expiries. The local image adapter is bound to image digest `sha256:c9f058adfe5a0b6180500597e6c13859d8532f5ae46bf4894a31a11b06cef90f`. Fifteen adapter tests and run `scans-b530f229-d694-4413-a51a-dc566bcea4f0` pass. Its `ADAPTER_FIXTURE` coverage is explicitly ineligible for release; the absent corporate FULL scan remains `BLOCKED_INPUT`.

- [X] T069 [US3] Implement local adversarial and separately gated release-image security runs in `tools/verification/feature-008-security.mts`; enforce actual artifact digests and scan freshness.

  Verified: `verify:008:security` validates the fresh T068 report against the independently inspected local image digest and pinned scanner-database hash, then runs the access, approval, canary, secret, network, identity and Hermes adversarial suites. Run `security-5446c5c0-1c64-44df-893c-1e39d22181f3` passes 13 files and 135 tests with unchanged source. Corporate release evidence is evaluated separately and can pass only for a fresh `FULL` corporate scan matching independently supplied `AWP_008_RELEASE_IMAGE_DIGEST`; missing inputs remain `BLOCKED_INPUT` and do not become a local PASS claim.

- [X] T070 [US3] Implement/run US3 checkpoint in `tools/verification/008-us3-checkpoint.mts`; require local isolation/canary/evaluation PASS and report corporate scan readiness separately.

  Verified: fresh Foundation `foundation-d9e2c3bd-2c3f-468e-bfce-b0c64c3a9713`, Hermes `hermes-78045fdd-711f-4381-98b1-0a7a8c89ea47`, independent audit coverage `audit-cd5e8e79-7075-4401-9f83-aeeaf971f303` and local security prerequisites all pass. US3 run `us3-029ee088-a262-4ab9-ac45-29d38d5349b6` passes every local check with unchanged fingerprints and reports the unavailable corporate image scan separately as `BLOCKED_INPUT`.

## Phase 6 — US4: Restore without corrupting authority (P1)

**Goal:** Restore real persisted state into a fenced isolated environment and reconcile external truth.

**Independent test/checkpoint:** Post-backup external effects, historical evidence/key verification and measured recovery survive the drill.

- [X] T071 [P] [US4] Test active-target rejection, old/new runtime fences and actual logical restore in `tests/integration/008/isolated-restore.spec.ts` against disposable PostgreSQL.

  Verified: the test performs a real `pg_dump` and `psql` restore between two PostgreSQL 18 disposable containers. It rejects identity mismatch and an active target, restores five selected durable tables, keeps worker egress fenced, blocks old/new runtime writes before resume and requires the exact separate resume nonce and approval.

- [X] T072 [P] [US4] Test external effect after backup/lost local marker, delayed lookup and Redis rebuild in `tests/integration/008/post-backup-effects.spec.ts`; assert no repeat POST.

  Verified: durable pending work rebuilds the queue, matched uncertain effects confirm through readback, delayed absence remains quarantined, and only definitive non-application can requeue the original command. A provider-only post-backup effect is quarantined; the measured provider write count is zero.

- [X] T073 [P] [US4] Test restored historical signatures/key rotation, binding/audit integrity and required/expired artifact distinctions in `tests/integration/008/restored-evidence.spec.ts`.

  Verified: historical signatures validate against both archived key versions, binding and audit-chain drift fail, a required artifact needs bytes plus metadata, and an expired optional artifact remains valid with immutable metadata. Missing secret-store owner evidence blocks verification.

- [X] T074 [US4] Implement scoped backup manifest/inventory/hash collection in `tools/recovery/008-backup.mts`; include canonical/audit/delivery/config/key/artifact inventory without secrets.

  Verified: the manifest pins scope, database/schema versions, consistent point, audit/effect watermarks, logical dump digest/size, protected location and separate inventory hashes. Sensitive values fail validation; the actual local dump produced the expected canonical/audit/delivery/key/artifact counts.

- [X] T075 [US4] Implement isolated logical restore and explicit target identity validation in `tools/recovery/008-restore.mts`; preserve active local/pilot resources and keep worker egress fenced.

  Verified: source and target must differ, target ID must match one isolated/fenced record, and active runtime leases reject the operation before dumping. The selected logical tables restore through argument-safe Docker exec without touching the running dev database; the result remains `workerEgress: FENCED`.

- [X] T076 [US4] Implement physical PITR manifest/WAL/timeline verification and approved recovery-provider adapter in `tools/recovery/008-pitr.mts`; actual corporate execution requires IN-08 and cannot reuse logical evidence.

  Verified: the adapter accepts only `PHYSICAL_PITR`, an exact approved provider, base-backup digest, ordered unique WAL segments, timeline, database major and requested point inside a fresh recovery window. Logical or missing evidence remains blocked and never invokes the provider. Corporate execution still awaits IN-08.

- [X] T077 [US4] Implement old-instance write-fence proof and restore-stage state in `packages/runtime-composition/src/recovery/fence.ts`; block split-brain and require separate exact resume.

  Verified: immutable hashed versions enforce the planned→fenced→restored→verified→reconciled→ready sequence. Old runtime identities never regain writes; the new identity stays fenced until a separate exact version/runtime/nonce/approval resume.

- [X] T078 [US4] Implement restored outbox/queue rebuild and read-only provider reconciliation in `packages/runtime-composition/src/recovery/reconcile.ts`; preserve Jira authority and quarantine uncertain gaps.

  Verified: reconciliation rebuilds only durable pending/original work, counts provider reads, exposes a constant zero write count, preserves Jira authority, confirms exact matches and quarantines divergence, delayed absence, multiples and provider-only gaps.

- [X] T079 [US4] Implement restored schema/audit/binding/signature/artifact inventory checks in `packages/runtime-composition/src/recovery/verify.ts`; secret-store recovery is referenced owner evidence.

  Verified: schema pins, binding hashes, chained audit hashes, signature/public-key availability and artifact policy are independently checked. Secret material is not restored by the platform; an explicit owner evidence reference is mandatory.

- [X] T080 [US4] Implement explicit RPO/RTO timestamps/measurement/approved-policy comparison in `tools/recovery/008-measurements.mts`; do not end RTO at database startup.

  Verified: RPO uses fault time minus last confirmed recoverable commit and RTO uses service-restored minus fault time after verification. Invalid ordering fails; absent policy preserves observations as `BLOCKED_INPUT`; exceeded targets fail. Database startup is explicitly non-terminal.

- [X] T081 [US4] Expose authorized drill/uncertain-effect evidence in `apps/api/src/extensions/pilot/pilot.controller.ts` and `apps/web/src/routes/pilot/recovery.tsx`.

  Verified: the scoped, no-store endpoint authorizes through existing replay-read policy before recovery queries, bounds pagination and projects an allowlist without provider payloads. The browser client validates scope/times/counts and the route shows drill state, RPO/RTO and unresolved effects. API/web typechecks and three focused tests pass.

- [X] T082 [US4] Write rehearsal/restore/rollback/resume operator procedure in `docs/runbooks/pilot-recovery.md`; specify compatible-image rollback, no destructive down-migration and no stale Jira rewrites.

  Verified: the procedure covers target validation, old-instance fencing, logical/PITR separation, inventory and key checks, queue rebuild, read-only reconciliation, RPO/RTO measurement, compatible rollback, no down-migration/Jira rewrite and exact human resume.

- [X] T083 [US4] Implement/run actual local restore checkpoint in `tools/verification/008-us4-checkpoint.mts`; save independent restored-state and provider-effect evidence.

  Verified: fresh Foundation `foundation-0854fa91-ae19-49a5-8ece-5299a61f0199` includes all recovery code/tests. US4 run `us4-d32ea3e3-f861-4fa2-9205-7289699579a4` passes 19 focused tests plus an independent two-container restore, exact restored row counts, backup hashes, zero provider writes, post-backup quarantine, integrity and timing checks with unchanged sources. Corporate recovery remains separately `BLOCKED_INPUT`.

- [ ] T084 [US4] Implement/run approved corporate drill wrapper in `tools/verification/feature-008-recovery.mts` after IN-08; preserve BLOCKED_INPUT for absent target/fence/RPO/RTO/owner.

  Handoff ready: the intake specifies the expanded IN-08 target, physical PITR, RPO/RTO, fence, owner, integrity, Redis and provider-reconciliation evidence. A real isolated drill is still required.

## Phase 7 — US5: Run and evaluate pilot (P1)

**Goal:** Compose honest baseline/reporting and exact, reversible pilot admission controls.

**Independent test/checkpoint:** Synthetic full rehearsal plus separately observed real shadow/limited-pilot/review evidence.

- [X] T085 [P] [US5] Test metric provenance/denominators/censoring/exclusions and existing 006 SLA semantics in `tests/unit/008/pilot-measurements.spec.ts`.

- [X] T086 [P] [US5] Test concurrent durable activation, same-action consumption, lease/transaction crash, gate/config/cohort drift and expiry in `tests/integration/008/pilot-activation.spec.ts`.

- [X] T087 [P] [US5] Test zero shadow external writes, no accepted draft and no released notification backlog in `tests/integration/008/shadow-fence.spec.ts`.

- [X] T088 [P] [US5] Test cohort window/revocation/suspension at actual dispatch and one-Project expansion in `tests/integration/008/pilot-cohort.spec.ts`.

- [X] T089 [P] [US5] Test insufficient data, missing guardrail measurements, independent write counts and review roles in `tests/integration/008/pilot-review.spec.ts`.

- [X] T090 [US5] Implement versioned QA measurement fact contributions in `packages/competency-qa/src/application/pilot-metrics.ts`; compose Core 006 queue/SLA and connector facts through `packages/runtime-composition/src/pilot/metric-sources.ts`.

- [X] T091 [US5] Implement bounded baseline import/provenance/sample validation in `packages/runtime-composition/src/pilot/baseline-service.ts`; distinguish current-process sources from platform observations.

- [X] T092 [US5] Implement immutable measurement protocol/QA Lead+sponsor attestations in `packages/runtime-composition/src/pilot/measurement-protocol.ts`; targets follow baseline and precede comparison.

- [X] T093 [US5] Add transaction-scoped durable rollout lease operations to `packages/platform-persistence-typeorm/src/project-onboarding.repository.ts`; preserve administrative lock ordering and avoid nested standalone transactions.

- [X] T094 [US5] Complete existing ONBOARDING_PILOT_ACTIVATE consumer in `packages/runtime-composition/src/onboarding/action-consumers.ts` with exact persisted approval/prerequisite pins, durable lease, onboarding revision/audit/outbox in one UoW; replace receipt-only API activation wiring.

- [X] T095 [US5] Implement exact cohort/window policy and gate bridge in `packages/runtime-composition/src/pilot/cohort-service.ts`; initial single Project, no entitlement inheritance and no circular post-pilot prerequisite.

- [X] T096 [US5] Implement shadow observation sink/difference report in `packages/runtime-composition/src/pilot/shadow-service.ts`; use independent effect fence and separate sandbox-conformance scope.

- [X] T097 [US5] Implement seven guardrail observation joins and incident-triggered suspension/fence integration in `packages/runtime-composition/src/pilot/guardrail-service.ts`; unknown evidence stays unknown.

- [X] T098 [US5] Implement immutable baseline comparison/pilot report and human decision in `packages/runtime-composition/src/pilot/review-service.ts`; include incidents, operator load, limitations and INSUFFICIENT_DATA.

- [X] T099 [US5] Wire protocol/baseline/metrics/review routes and authenticated report importer in `apps/api/src/extensions/pilot/pilot.controller.ts`; enforce scoped pagination, exact hashes and audit.

- [X] T100 [US5] Implement cohort/baseline/dashboard/review and existing activation/suspension integration in `apps/web/src/routes/pilot/pilot-run.tsx`; display actionable failures and measurement completeness.

- [X] T101 [US5] Verify baseline→shadow→activation→expiry/suspend→review browser workflow in `tests/e2e/008/pilot-operation.spec.ts`; count external effects independently.

- [X] T102 [US5] Write incident/rollback/on-call/one-Project expansion procedure in `docs/runbooks/pilot-operation.md`; require exact resume, compatible versions and fresh gate evidence.

- [X] T103 [US5] Implement/run local US5 rehearsal in `tools/verification/008-us5-checkpoint.mts`; local sample cannot be presented as corporate pilot outcome.

  Verified for T085–T103: versioned source-owned facts preserve exact provenance, denominators, exclusions, censoring and the existing Core 006 SLA value. Baseline import requires bounded current-process observations and spot checks; numeric targets require the later comparison protocol signed by distinct QA Lead and sponsor humans. Cohort revisions start with one Project, add one Project at a time, grant no entitlement, and recheck the exact half-open window, revocation and suspension at dispatch. Shadow produces no provider writes, accepted Work Items or releasable notification backlog. All seven guardrails require independent observations; missing values stay `UNKNOWN`, and a breach invokes suspension/fencing. Reports retain incidents, operator load, limitations, residual risks and independent effect counts; incomplete evidence yields `INSUFFICIENT_DATA`.

  The canonical 007 activation action now runs through `DurablePilotActivationService` and `PostgresDurablePilotActivationPort`. The transaction preserves Workspace→onboarding→action→approval lock order, acquires the rollout lease without a nested transaction, consumes the exact approval and appends the onboarding revision, audit and outbox atomically. PostgreSQL concurrency proves one commit plus one exact replay, including bounded serialization retry. The local receipt-only activation route was removed; composition must supply this service. Scoped API routes authorize before lookup, accept closed bounded inputs and derive actor identity server-side. The browser workflow shows cohort, baseline completeness, metrics, all guardrails, independent effects and formal review, and links to the canonical activation/suspension controls.

  Fresh Foundation `foundation-5bff87fb-1ba7-4f48-b52c-969996f9e5ad` PASS includes 40 integration files/238 tests, 37 unit+contract files/197 tests, 100 security tests, all typechecks, schema, architecture, lint and seven Chromium scenarios. Local US5 `us5-f956b448-b65d-47b2-9f37-f03314fbab9f` PASS reruns 18 focused tests, API/web/test typechecks and the full browser sequence with unchanged source. Its output is explicitly `DEVELOPMENT_MOCKS`; corporate shadow and observed review remain `BLOCKED_INPUT`.

- [ ] T104 [US5] After N2/security/recovery and cohort input, implement/run actual shadow validation in `tools/verification/feature-008-shadow.mts`; record human-reviewed differences and zero external business writes.

  Handoff ready: the intake supplies the closed shadow bundle schema, exact non-local prerequisite report refs, human QA Lead review and independent zero-write proof. Corporate prerequisite PASS reports are still required.

- [ ] T105 [US5] After exact human activation, collect the actual approved pilot window/sample and guardrail observations through `packages/runtime-composition/src/pilot/observation-worker.ts`; persist source evidence for `reports/008-pilot-hardening-and-conformance/limited-pilot.json`.

  Handoff ready: IN-10–IN-12, cohort, baseline, observation-window, sample, metric-denominator and seven-guardrail inputs are listed in the integration intake. Collection cannot start before approved activation.

- [ ] T106 [US5] Implement/run observed-pilot review validation in `tools/verification/feature-008-review.mts`; require real sample/provenance and human review, never simulate elapsed pilot time.

  Handoff ready: the intake includes the complete limited-pilot report example and exact QA Lead/sponsor review requirements. The elapsed real window and source evidence remain external.

## Phase 8 — Cross-cutting verification and handoff

**Goal:** Prove the complete local change and report corporate readiness without overstating it.

**Independent test/checkpoint:** All required engineering checks pass; external unavailable evidence remains explicit.

- [X] T107 Implement transitive 001–007 compatibility and historical schema/evidence/approval tests in `tests/contract/008/backward-compatibility.spec.ts` and `tools/verification/008-compatibility.mts`.

- [X] T108 Implement PostgreSQL 17/18 expansion/immutability/rollback-compatibility verification in `tools/ci/verify-008-migrations.mts`; run actual database migrations.

- [X] T109 Validate planned command catalog and execute local guide scenarios in `tools/verification/008-quickstart.mts`; update `specs/008-pilot-hardening-and-conformance/quickstart.md` only with verified commands.

- [X] T110 Implement full-stack local request/manual/automation/evidence/notification/restore smoke in `tools/smoke/feature-008.mts`; capture actual API/worker/Collector/provider evidence.

- [X] T111 Implement local aggregate pipeline in `tools/ci/feature-008.mts` including contract/architecture/unit/integration/security/browser/migrations/smoke/typecheck/lint/build, source-bound children and FR/SC trace.

- [X] T112 Complete infrastructure/secret rotation/ingress/observability/C1 handoff in `docs/runbooks/pilot-infrastructure.md` and link validated commands from `README.md`.

- [X] T113 Run `pnpm ci:008` and produce verified `reports/008-pilot-hardening-and-conformance/local.json`; resolve failures and rerun affected evidence before declaring L0 engineering complete.

- [X] T114 Produce separately scoped `reports/008-pilot-hardening-and-conformance/readiness.json` referencing local and corporate evidence; missing scans/drills/inputs/pilot observation cannot be PASS.

- [X] T115 Finalize task completion/evidence trace in `specs/008-pilot-hardening-and-conformance/tasks.md`; full feature closure requires real N2/P3/pilot review, while completed engineering work may be handed off with named external blockers.

  Phase 8 evidence (2026-09-05): `pnpm ci:008` completed with exit code 0 and
  produced `local.json` with all 17 mandatory stages and all 15 child reports at
  `PASS`. Foundation run `foundation-77a83174-797a-434e-9a29-ff16530594f0`
  covered 41 database files/240 tests, 38 unit+contract files/201 tests, 10
  security files/100 tests, application typechecks, seven Chromium scenarios,
  schema registry, architecture and lint. Compatibility passed 121 files/422
  tests plus five migration-registry files/13 tests. Actual PostgreSQL 17/18
  migrations, quickstart, full-stack smoke and US1–US5 passed. `trace.json`
  reports local `PASS`, 36 verified trace rows and nine corporate-blocked rows.
  `readiness.json` remains `BLOCKED_INPUT` and names the required C1, N2, release
  scan, corporate recovery, shadow, observed pilot and human review evidence.

## Requirements and evidence trace
Every row must acquire actual assertion/report refs in the implementation trace registry; task IDs alone are not evidence.
| Requirement | Implementing / verifying tasks |
|---|---|
| FR-008-001 | T011, T026, T028, T033 |
| FR-008-002 | T030, T045, T057 |
| FR-008-003 | T031, T052, T065 |
| FR-008-004 | T008, T011, T004, T037 |
| FR-008-005 | T008, T037, T061 |
| FR-008-006 | T045, T042, T043, T057 |
| FR-008-007 | T041, T046, T047, T048, T049 |
| FR-008-008 | T050, T051, T059 |
| FR-008-009 | T050, T078, T072 |
| FR-008-010 | T032, T035, T036 |
| FR-008-011 | T058, T059, T060, T061 |
| FR-008-012 | T016, T067, T094 |
| FR-008-013 | T059, T086, T094, T044 |
| FR-008-014 | T024, T034, T060 |
| FR-008-015 | T068, T069 |
| FR-008-016 | T042, T072, T078 |
| FR-008-017 | T051, T043 |
| FR-008-018 | T053, T044, T054 |
| FR-008-019 | T074, T079 |
| FR-008-020 | T071, T073, T080, T084 |
| FR-008-021 | T077, T078, T072 |
| FR-008-022 | T062, T065 |
| FR-008-023 | T062, T065, T070 |
| FR-008-024 | T062, T058, T063, T065 |
| FR-008-025 | T066, T065 |
| FR-008-026 | T065, T052, T043 |
| FR-008-027 | T091, T092, T085 |
| FR-008-028 | T095, T088, T094 |
| FR-008-029 | T090, T099, T100 |
| FR-008-030 | T097, T067, T089 |
| FR-008-031 | T098, T106, T102 |
| SC-008-001 | T057, T040, T114 |
| SC-008-002 | T056, T043 |
| SC-008-003 | T070, T058 |
| SC-008-004 | T084, T072 |
| SC-008-005 | T024, T067, T105 |
| SC-008-006 | T097, T105, T106 |
| SC-008-007 | T098, T106 |

## Dependencies and execution order

Setup → Foundation → US1 runtime → US2/US3 local proofs → US4 restore → US5
activation/review → full local gate. US2/US3 fixture-based work may proceed after
Foundation, but actual corporate runs require US1 and supplied C1 metadata.
US4 relies on US2 certainty handling. US5 measurement work can start after
Foundation; activation requires US1–US4 and current pre-activation gates.

External sequence: T040 → T057 → security/scans +
T084 → T104 → exact activation →
T105 → T106. Those steps require real inputs
and observation; do not fabricate them or turn SKIPPED_GATED into PASS.

Within a story: tests → models/repositories → runtime services → API/UI → actual
checkpoint. Shared app/registry/entry-point files are sequential integration work.
New public revisions preserve old bytes; scope and authorization revalidate at
consumption and effect time. Migration number 0165 must be rechecked before use.

## Parallel examples by story

- US1: T021, T022, T023 and T024 use separate files after Foundation.
- US2: T041, T042, T043 and T044 use independent suites.
- US3: T058, T059, T060 and T062 can be authored independently.
- US4: T071, T072 and T073 have separate tests; isolate database resources.
- US5: T085, T086, T087 and T089 have separate tests; activation implementation still follows its durable lease dependency.

## Implementation strategy and completion

MVP: Setup + Foundation + US1 local checkpoint. This proves complete configurable
runtime, identity/secret boundaries and exported correlation; it cannot authorize
pilot writes. Continue US2 safety, US3 security/evaluation, US4 actual restore and
US5 operations. Then close the full local gate and publish corporate blockers with
owner/input IDs. Full Feature 008 completion requires actual corporate gates and
observed review, not merely a checked engineering list.

Retain current user changes; establish a reproducible reviewed source snapshot
before implementation handoff. Do not implicitly commit/publish/deploy during
planning. Each completed task needs its actual changed files and relevant proof.

**Planned total:** 115 tasks. **Completed:** 31.

## Verified implementation checkpoints

- 2026-09-04 — T001–T007 Setup: 23 tests, typecheck and lint passed; immutable entry run `setup-890815e5-3285-4ba8-af0a-db00e0cf1ed5`.
- 2026-09-04 — T008–T019 Foundation: `foundation-0231621b-1edb-4383-8bab-b31b31a6df54` PASS. 66 boundary/schema/database tests plus 34 onboarding/authorization regression tests; actual PostgreSQL 17.7 and 18.6 upgrade/immutability/CAS checks, typecheck, worker typecheck, registry parity, import graph and lint passed. All 201 historical schema entries and published contract/migration files were preserved.
- Foundation binds the pinned Setup entry as historical proof, then independently validates current source and the full test tree. Strict `verify:008:prerequisites` intentionally rejects changes to the 007 entry tree; later checkpoints use `feature-008-entry-proof.mts` instead of presenting modified code as the unchanged baseline.
- 2026-09-04 — T022, T023, T028, T029: version-pinned Vault secret leases and remote signing with immutable offline public-key history. `foundation-6047c805-3938-4a76-b4b4-351145fb73ec` PASS: 86 boundary/schema/database/security tests plus 34 regression tests, PostgreSQL 17.7/18.6, typecheck, worker typecheck, registry parity, import graph and lint. Full corporate composition and C1-selected workload authentication remain open under T025/T030/T040.
- 2026-09-04 — T034 plus the retention portion of T032: `foundation-ec6cb50b-aed2-4218-a1fb-88d8c445e481` PASS. 104 boundary/schema/database/security tests, 34 onboarding/authorization regressions and 4 telemetry regressions (142 total), PostgreSQL 17.7/18.6, API/worker/test typechecks, schema registry, architecture and lint. Twelve PostgreSQL retention checks cover restart, duplicate workers, hold recheck, scope/decision tampering, future decisions and quarantine. Six telemetry checks cover bounded metric labels across 1,000 distinct requests, preserved trace/log correlation and safe framework/startup/worker error logging. Actual SDK/Collector export remains open under T024/T033.
- 2026-09-04 — T021/T027 identity/session, T024/T033 SDK/Collector and T061 network boundaries: `foundation-2f11bdc6-472e-4ab6-a9da-411853b23a5b` PASS, 215 tests plus all quality checks. Includes real Nest/OIDC/PostgreSQL sessions, scoped identity revocation, pinned outbound DNS/TLS, mTLS Collector receipt and durable command correlation. The SDK dependency addition is independently pinned and reviewed.
- 2026-09-04 — T031 storage/source sufficiency: `foundation-eaa26bfa-fe80-4a96-975a-c1f66b915be5` PASS, 229 tests plus all quality checks. Actual SigV4 HTTP verification, version/checksum readback, lost-write reconciliation, required-manual-source denial and stream revocation are covered.
- 2026-09-04 — T030 scoped client/authority portion: `foundation-c3fdaf7d-0d5a-4ba3-a8eb-a928341433db` PASS, 238 tests plus all quality checks. Jira/GitLab/Mattermost use purpose-separated Vault leases and pinned egress; current Core service rights and published chain are checked on PostgreSQL 17/18. Full domain/API/worker integration remains open.
- 2026-09-04 — T032 persisted due-probe portion: `foundation-b2e9d72c-3aa3-4516-a527-0a28324a60be` PASS, 242 tests plus all quality checks. Current published pins, per-operation refresh, restart, stale-result rejection and explicit unavailable observer behavior are covered on PostgreSQL 17/18.
- 2026-09-04 — T026 shared QA HTTP/intake portion: `foundation-a83abdf9-dcfc-421f-a83c-a50a91f58c45` PASS, 266 tests plus all quality checks. Includes 21 legacy QA HTTP/controller regressions with explicit identity binding, current strong ETags and conservative historical onboarding setup. Shared QA authorization does not select a local persona; QaPack intake bindings are injected. Queue/approval adapter work follows this checkpoint.
- 84 tasks remain open. Corporate inputs are absent; local fixtures prove engineering behavior only. No corporate conformance, activation or observed pilot outcome is claimed.

- 2026-09-04 — T026 queue/approval HTTP portion: `foundation-1344a784-b504-4c2d-a072-6bd4c4e7fe92` PASS, 275 tests plus all quality checks. Real OIDC/HTTP/PostgreSQL covers explicit project DENY in portfolio membership, approval step-up, current approver role, expired approvals and immutable decided state. Generic intake/operational HTTP and Mattermost selection remain open.

- 2026-09-04 — `foundation-d2654068-32f9-4114-8df5-46bde90c0a32` recorded a transport FAIL in the HTTP fixture across the deliberate API restart; all other checks passed. The test client now uses separately closed connections without retries, and the entire HTTP scenario passes. This failed report is retained. T026 shared intake/operational/Mattermost/artifact adapters have targeted HTTP, PostgreSQL, scope/classification/CSRF/replay/revocation proof; the next Foundation run consolidates it.

- 2026-09-04 — T026 completed: `foundation-5ae6b633-0429-4b38-9550-4a61a137f231` PASS, 299 tests (219 boundary/security/database, 34 onboarding, 42 QA/HTTP/004/005 regressions, 4 telemetry), all three typechecks, registry parity, architecture, lint and unchanged source. Real HTTP/OIDC/PostgreSQL covers generic intake, decisions, operational permission conjunction, session-bound project selection, exact draft definition lineage, scoped artifact metadata/streaming and revoked/over-classified reads. Prior lint-only run `foundation-708bab02-2200-46bd-9796-4d8cd838c5a6` is retained.
- 2026-09-04 — T025 durable evidence-upload increment: `foundation-b2904352-e02e-403d-836f-413382231e4a` PASS, 306 tests, PostgreSQL 17.7/18.6, actual HTTP/S3 restart/recovery, all typechecks, registry/architecture/lint and unchanged-source proof. T025 remains open for complete corporate composition.
- 2026-09-04 — T025 Session runtime increment: `foundation-0b900574-e9df-4ba6-b8ad-831f79aa5145` PASS, 310 tests plus all quality checks. Subsequent contract inspection added explicit canonical binding/capability NON_PROD and unique profile checks; PostgreSQL 17/18 negatives first reproduced the mismatch and then passed after correction. The final checkpoint below includes this correction.
- 2026-09-04 — T025 Session runtime final correction: `foundation-ed005b16-c76d-4a1b-873c-5459a64fda55` PASS, 310 tests (230 Feature 008, 34 onboarding, 42 QA/HTTP regressions, 4 telemetry), all typechecks, registry, architecture, lint and unchanged-source proof. Canonical binding/capability NON_PROD, unique profile selection, current published heads and mandatory queue authorization are included. Full T025 remains open.

- 2026-09-04 — T025 readiness increment: targeted PostgreSQL 17/18 checks reproduced and corrected ignored session/command guards, stale aggregate JSON, repeat-assessment version collisions and inconsistent classification ordering. Durable submission/replay/rollback and exact release guards are implemented; Foundation `foundation-38e00995-d922-412a-8531-4af8bfa391c6` PASS: 318 tests (238 Feature 008, 34 onboarding, 42 QA/HTTP, 4 telemetry), all typechecks, registry/architecture/lint and unchanged-source proof. T025 remains open; no C1/N2/P3 claim.

- 2026-09-04 — T025 defect-proposal increment: PostgreSQL 17/18 restart and access negatives first reproduced data loss and classification drift, then passed. Immutable storage, exact proposal acceptance, expiry and honest deterministic fallback are implemented. Foundation `foundation-681b7ba6-cf66-4586-974e-8de094a8ee11` PASS: 320 tests (240 Feature 008, 34 onboarding, 42 QA/HTTP, 4 telemetry), all typechecks, registry/architecture/lint and unchanged-source proof. T025 remains open.

- 2026-09-04 — T025 defect-publication/approval increment: targeted PostgreSQL 17/18 checks cover atomic rollback at submission and release, independent concurrent callers, API restart, exact frozen review and current configuration/classification/identity guards. Mandatory HTTP ports and separate local compatibility adapters are implemented. Foundation `foundation-3716e654-dede-493e-be4d-56ab29c6f9d3` PASS: 322 tests (242 Feature 008, 34 onboarding, 42 QA/HTTP, 4 telemetry), all typechecks, registry/architecture/lint and unchanged-source proof.

- 2026-09-04 — T058 classification/access increment: ten failing classification cases and three HTTP/database negatives first reproduced rank drift, unknown/prototype names, unvalidated contribution ranks, post-promotion draft reads and verdict SQL before authorization. Focused checks now pass; the next Foundation includes the actual automation-result regression suite in addition to the existing checks.

- 2026-09-04 — Foundation `foundation-487e7df8-a7ee-413e-affe-d4ac9983f8a9` recorded one stale pilot-authorization test expectation (CONFIDENTIAL rank 20). The canonical Core rank is 30; the expectation and test context were corrected. All other tests and quality checks passed; this failed report is retained.

- 2026-09-04 — T025/T058 consolidated checkpoint: `foundation-b17652f6-1127-4271-9113-4b2513d04059` PASS, 339 tests (251 Feature 008, 34 onboarding, 42 QA/HTTP, 8 automation-result, 4 telemetry). PostgreSQL 17.7/18.6, API/worker/test typechecks, all 203 schemas, architecture, lint and unchanged-source proof passed. Includes transactional defect publication/approval, restart/concurrency/rollback, exact configuration and current rights, canonical classification, classified draft/link reads and authorization before verdict supersession SQL. 31/115 tasks complete; T025 and T058 remain open for their outstanding full-composition and isolation-matrix scope. Corporate C1/N2/P3 conformance is not claimed.

- 2026-09-04 — T025/T058 DoD and candidate-preparation checkpoint: `foundation-da2bc4ac-a521-4b2b-813a-f2cc255a8fe3` PASS, 360 tests (260 Feature 008, 34 onboarding, 42 QA/HTTP, 8 automation-result, 12 completion-domain, 4 telemetry). PostgreSQL 17.7/18.6, all three typechecks, 203 schemas, architecture, lint and unchanged-source proof passed. Eight new database cases cover server-derived DoD, ignored forged client facts, current published policies, actual signatures and elevated risk, concurrent assessment versions, pointer-write rollback, corrected-review staleness, candidate derivation, pending defects, expired artifacts and classified reads. HTTP negatives also verify authorization before SQL and sanitized unexpected errors. 31/115 tasks complete; T025/T058 remain open. Next: authoritative verdict creation/signing, exact waiver/v2 inventory and required completion publication/approval/worker ports with proof rechecks. No corporate conformance is claimed.

- 2026-09-04 — T025 completion checkpoint: `foundation-5f24bb30-a956-47c5-bc97-9233ecfbb591` PASS, 367 tests (264 Feature 008, 34 onboarding, 42 QA/HTTP, 8 automation-result, 12 completion-domain, 3 Core delivery, 4 telemetry). PostgreSQL 17.7/18.6, all three typechecks, 203 schemas, architecture, lint and unchanged-source proof passed. Covers exact transactional completion publication/approval, current confirmed provider revision, dispatch rollback, final DoD provenance, replay conflict, independent HTTP lost-response/restart/read-only recovery, stale fences and atomic final audit/observation. Selected provider adapter and full entry-point composition remain open. 31/115 tasks complete; no C1/N2/P3 conformance is claimed.

- 2026-09-04 — T025 verdict/review cancellation checkpoint: `foundation-5ec6faf5-1ad9-45c0-8c9b-920d8e1b339d` PASS, 377 tests (274 Feature 008, 34 onboarding, 42 QA/HTTP, 8 automation-result, 12 completion-domain, 3 Core delivery, 4 telemetry). PostgreSQL 17.7/18.6, test/API/worker/web typechecks, 203 schemas, architecture, lint and unchanged-source proof passed. The preceding `foundation-6e5f8f53-c836-4cd2-9a16-6bd6cef4b81a` FAIL is retained: the new verdict provider used an unregistered DI token; it is now fixed. Co-sign, signed-verdict supersession and review correction cancellation/rollback/provenance are included. 31/115 tasks complete. No C1/N2/P3 conformance is claimed.

- 2026-09-04 — T035/T036 complete: `foundation-2b7ebc80-63ea-46f4-9dbf-8dde44afef61` PASS, 396 tests (289 Feature 008, 34 onboarding, 42 QA/HTTP, 4 Chromium UI, 8 automation-result, 12 completion-domain, 3 Core delivery, 4 telemetry), PostgreSQL 17.7/18.6, four typechecks, 203 schemas, architecture, lint and unchanged-source proof. Covers authenticated signed report import, current verified gate/health projections, scoped corporate BFF UI, expiry/access/scope clearing and exact replay/rollback. Root build/lint/test configuration is included in fingerprints. The preceding failed checkpoint and browser failures are preserved in their logs. 33/115 tasks complete; 82 remain. Full corporate composition, actual end-to-end correlation and C1/N2/P3 conformance remain open.


- 2026-09-04 — T025/T037 published configuration checkpoint: Foundation `foundation-eaa9de7d-c523-40de-adb8-97c4988aa42e` passes all 426 tests (302 boundary/database, 7 published configuration/startup, 34 onboarding, 42 QA/HTTP, 4 Chromium UI, 1 browser/OIDC/storage/Collector, 8 automation-result, 12 completion-domain, 3 durable delivery and 13 telemetry/trust regressions), PostgreSQL 17.7/18.6, four typechecks, 203 schemas, architecture, lint and unchanged-source fingerprints. All 19 checks pass. Configuration presence, revocation and multi-Project current-reference validation are complete for this increment; owning adapter/domain factories and actual entry-point integration remain open. The failed pre-checkpoint CLI launch is retained in `/private/tmp/awp-008-foundation-published-config.log`. No C1/N2/P3 conformance is claimed. 34/115 tasks complete; 81 remain.
- 2026-09-04 — T058–T060/T063/T064 security checkpoint: Foundation `foundation-b7be11fc-120c-4c91-8376-5fa5ce4ceaca` PASS, 612 tests (including 6 Chromium) and all 22 checks. PostgreSQL 17.7/18.6, four typechecks, schema registry, architecture, lint and unchanged-source fingerprints pass. Exact Project visibility covers search/cache/export/report projections and HUMAN/SERVICE behavior; forged/rehashed action swaps, configuration/right/expiry drift and races are denied at consumption/dispatch; actual log/OTLP/Vault/audit/evidence canary scans are clean. Jira/GitLab/Mattermost, Vault, OIDC, object storage and Collector share the pinned outbound transport, while trusted ingress remains independently authenticated. C1/N2/P3 and real-provider/image evidence remain separately gated and are not claimed. 57/115 tasks complete; 58 remain.

- 2026-09-04 — T025 published automation availability checkpoint: Foundation `foundation-48a8223d-33fc-457b-b9a8-e556c289ec41` passes all 431 tests (303 boundary/database, 11 published configuration/startup/automation, 34 onboarding, 42 QA/HTTP, 4 Chromium UI, 1 browser/OIDC/storage/Collector, 8 automation-result, 12 completion-domain, 3 durable delivery and 13 telemetry/trust regressions). All 19 checks pass, including PostgreSQL 17.7/18.6, four typechecks, 203 schemas, architecture, lint and unchanged-source fingerprints. The focused final run `/private/tmp/awp-008-automation-verified.log` passes five tests; earlier failing logs preserve the reproduced UUID write defect and corrected fixture setup. Actual scoped HTTP revocation, all eight negative operations, missing/expired observations, head/mode drift, canonical hash mismatch, newer invalid binding/Suite reports, acceptance revocation and bounded blocked SQL are covered. The explicit API module is ready for the full corporate factory; Suite administration/session/worker assembly and C1-selected conformance remain open. 34/115 tasks complete; 81 remain.

- 2026-09-04 — T042 closed; T050 recovery increment: Jira invocation-marker migration and atomic first-write guard; GitLab original-receipt validation, fenced lookup, bounded unavailable-result quarantine and atomic command/QA/effect confirmation. A full-suite race in shared recovery versus Mattermost confirmation was reproduced with a real PostgreSQL snapshot and fixed by excluding lookup-only rows before locking. Foundation `foundation-033d1672-3182-49fe-8e1e-a572dcf624f8` PASS (530 tests, 22 checks), US1 `us1-b35625c9-6ddd-4946-b72d-60adeb04ce1b` PASS. Dev remains healthy with retained volumes; 40/115 complete, 75 remain.
