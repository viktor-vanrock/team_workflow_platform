---
description: "Dependency-ordered implementation tasks for Feature 004 Mattermost and Hermes intake"
---

# Tasks: Mattermost и Hermes intake

**Input**: design artifacts in `specs/004-mattermost-hermes-intake/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`
**Implementation status**: Ready for implementation. ADR-0008 is Accepted and Constitution 2.0.0 satisfies the former governance gate; no Feature 004 implementation task is complete yet.
**Tests**: mandatory. Setup, Foundation and every user-story phase write and observe their tests RED before story implementation; the cross-cutting final phase then adds hardening/drift tests before integrated runners and task-bound evidence.
**Organization**: Setup and Foundation are shared. US1–US4 are independently seedable P1 vertical slices after Foundation.

## Format: `[ID] [P?] [Story] Description`

- `[P]` means different files and no unmet dependency permit parallel execution.
- `[US1]`…`[US4]` map directly to the four stories in `spec.md`.
- Every task names exact owned file paths.
- Tasks touching shared registries, generated contracts, app modules, migration composition, worker routing or UI barrels are deliberately serialized.

## Paths

- Libraries/adapters: `packages/*/src/`
- Apps: `apps/{api,worker,web,mock-hub}/src/`
- Verification: `tests/{architecture,contract,integration,e2e}/` and `tools/{contracts,verification,smoke,ci,local}/`
- Evidence: `reports/004-mattermost-hermes-intake/`

---

## Phase 1 — Setup and fail-closed entry gates

**Purpose**: prove the accepted governance state and exact Feature 003 dependency, register the 004 contract/package surfaces and create runnable verification entrypoints before implementation.

### Tests first

- [X] T001 [P] Write failing exact-report/digest and consumed-contract prerequisite fixtures in `tests/contract/004/prerequisite-gate.spec.ts`
- [X] T002 [P] Write failing Accepted-ADR, partial-supersession, Constitution-version and digest fixtures in `tests/contract/004/governance-gate.spec.ts`
- [X] T003 [P] Write pilot metadata positive/negative shape, semantic, secret-absence and production-deny tests in `tests/contract/004/pilot-metadata.spec.ts`

### Setup implementation

- [X] T004 Implement the Feature 003 evidence and consumed-contract verifier in `tools/verification/feature-004-prerequisites.mts` and write `reports/004-mattermost-hermes-intake/prerequisites.json`
- [X] T005 Implement the ADR-0008/ADR-0005/Constitution 2.0.0 digest-bound verifier in `tools/verification/feature-004-governance.mts` and write `reports/004-mattermost-hermes-intake/governance.json`
- [X] T006 Aggregate both mandatory entry gates without relabelling optional live evidence in `tools/verification/004-setup-gate.mts` and `reports/004-mattermost-hermes-intake/setup-gate.json`
- [X] T007 [P] Create the pure ESM Connector package shell in `packages/connector-mattermost/package.json`, `packages/connector-mattermost/project.json` and `packages/connector-mattermost/tsconfig.json`
- [X] T008 [P] Create the closed Connector entrypoint and initial manifest in `packages/connector-mattermost/src/index.ts` and `packages/connector-mattermost/src/manifest.ts`
- [X] T009 Register the package path, Nx/dependency boundary, runtime dependency and lockfile without changing workspace globs in `tsconfig.base.json`, `tools/architecture/dependency-rules.mts`, `packages/runtime-composition/package.json` and `pnpm-lock.yaml`
- [X] T010 [P] Compile the Mattermost pilot metadata package into runtime-safe contracts and exports in `packages/platform-contracts/src/extensions/mattermost-pilot-metadata.ts` and `packages/platform-contracts/src/index.ts`
- [X] T011 [P] Add deterministic secret-free local metadata plus invalid scope/key/retention/reconciliation/production fixtures in `config/local/mattermost-pilot-metadata.v1.json` and `tests/fixtures/004/mattermost-pilot-metadata.invalid.json`
- [X] T012 [P] Implement offline parsing, duplicate-key detection, strict schema compilation, reference resolution, example validation and AEAD-vector verification in `tools/contracts/verify-004-contracts.mts`
- [X] T013 Register the order-400 design contribution and regenerate, rather than hand-edit, the schema registry in `packages/platform-contracts/src/schema-contributions.ts`, `tools/contracts/build-registry.mts` and `packages/platform-contracts/src/generated/schema-documents.ts`
- [X] T014 Wire all quickstart-compatible 004 contract, architecture, integration, security, E2E, migration, checkpoint, smoke, trace and verify entrypoints in `package.json`, `tools/ci/feature-004.mts` and `tools/ci/feature-004-tests.mts`
- [X] T015 Run the prerequisite and governance suites through the setup gate and require exact local `PASS` evidence in `reports/004-mattermost-hermes-intake/prerequisites.json`, `reports/004-mattermost-hermes-intake/governance.json` and `reports/004-mattermost-hermes-intake/setup-gate.json`

**Checkpoint**: T015 must pass before Phase 2. Optional corporate Jira evidence may remain `SKIPPED_GATED`; governance may not.

---

## Phase 2 — Shared blocking foundation

**Purpose**: establish versioned contracts, scoped persistence, provider-neutral runtime primitives, the pure Mattermost adapter, protocol-faithful Mock Hub and safe worker routing required by every story.

**Critical dependency**: no story work begins before T094. In particular, capability-aware worker routing and policy-aware recovery must exist before any Mattermost command can execute.

### Tests first

- [X] T016 [P] Validate all 43 JSON Schemas, 3 examples, offline refs and required positive/negative combinations in `tests/contract/004/design-contracts.spec.ts`
- [X] T017 [P] Validate the 20-operation OpenAPI surface, 5-channel/20-message AsyncAPI surface and payload-schema parity in `tests/contract/004/openapi-asyncapi.spec.ts`
- [X] T018 [P] Prove immutable 1.0 history plus additive `competency-qa@1.1.0` and `qa.validation@1.1.0` logical-role compatibility in `tests/contract/004/capability-compatibility.spec.ts`
- [X] T019 [P] Write Profile/pilot semantic publication tests for exact scope, bot/key/channel uniqueness, retry bounds, retention bounds and reconciliation evidence in `tests/contract/004/mattermost-profile.spec.ts`
- [X] T020 [P] Write Core unit rules and schema-parity tests for closed ActionProvenance actor/subject/effect/configuration combinations in `tests/unit/004/action-provenance.spec.ts` and `tests/contract/004/action-provenance.spec.ts`
- [X] T021 [P] Write unit and contract tests for InteractionIntent single-use consume/stable replay, wrong-actor non-consumption, action/subject/transport/token handling and routing-versus-action-ID unions in `tests/unit/004/interaction-intent.spec.ts` and `tests/contract/004/interaction-intent.spec.ts`
- [X] T022 [P] Recompute RFC 8785 JCS, schema/AAD/token/ciphertext hashes, AES-256-GCM bytes/tag and decrypt round-trip in `tests/unit/004/presentation-materializer.spec.ts` and `tests/contract/004/interaction-presentation-aead.spec.ts`
- [X] T023 [P] Enforce Core/QA/UI/provider import boundaries, forbid provider vocabulary in generic Nest runtime and forbid API imports of the Connector package in `tests/architecture/004-mattermost-boundaries.spec.ts`
- [X] T024 [P] Enforce static Connector/Pack/worker contribution wiring and preserve every prior composition in `tests/architecture/004-mattermost-runtime-wiring.spec.ts`
- [X] T025 [P] Write owner/order/collision/entity-parity tests for Core 0100–0120, QA 2040 and Mock 0050–0052 in `tests/integration/migrations/004-migration-registry.spec.ts`
- [X] T026 [P] Write PostgreSQL fresh/003-upgrade/repeat/failed-recovery/legacy-Draft-backfill tests in `tests/integration/migrations/004-mattermost-hermes-intake.spec.ts`
- [X] T027 [P] Write append-only scoped ActionProvenance and closed combination persistence tests in `tests/integration/004/action-provenance.spec.ts`
- [X] T028 [P] Write Candidate lifecycle/dedupe/observation and Draft revision/CAS unit tests plus scoped contiguous-history, shadow-write and PostgreSQL foundation tests in `tests/unit/004/intake-candidate.spec.ts`, `tests/unit/004/intake-draft-revision.spec.ts` and `tests/integration/004/intake-foundation.spec.ts`
- [X] T029 [P] Write callback receipt-conflict unit tests plus single-use intent, wrong-actor non-consumption and replay-result integration tests in `tests/unit/004/external-interaction-receipt.spec.ts` and `tests/integration/004/interaction-intent.spec.ts`
- [X] T030 [P] Write grant derivation/non-expansion unit tests plus exact-subject Agent Run, immutable grant-set, idempotency-conflict and denied-invocation integration tests in `tests/unit/004/agent-grants.spec.ts` and `tests/integration/004/agent-runtime.spec.ts`
- [X] T031 [P] Write one-branch/one-command NotificationIntent dedupe, atomic action-set and audited policy-denial tests proving zero NotificationIntent/command on denial in `tests/integration/004/notification-foundation.spec.ts`
- [X] T032 [P] Write forged capsule/key/AAD/slot/command/fence, nonce reuse, expiry and plaintext-leak tests in `tests/integration/security/004/presentation-capsule.spec.ts`
- [X] T033 [P] Write two-Project scope, external binding, Profile/Connection/channel/bot/key alias and enumeration-resistance tests in `tests/integration/security/004/scope-isolation.spec.ts`
- [X] T034 [P] Prove all production configuration, credential, model, target and egress paths fail before network access in `tests/integration/security/004/production-boundary.spec.ts`
- [X] T035 [P] Write native-fetch request, callback normalization, Profile validation, logical target and reconciliation conformance vectors in `tests/contract/004/mattermost-connector-conformance.spec.ts`
- [X] T036 [P] Write stateful Mock Hub team/channel/user/membership/post/callback/fault/restart protocol tests in `tests/contract/004/mock-hub-mattermost.spec.ts` and `tests/integration/004/mock-hub-mattermost.spec.ts`
- [X] T037 [P] Prove Jira workers cannot claim Mattermost commands and neither Core in-memory nor TypeORM recovery can return marked Mattermost effects to READY/RETRY_SCHEDULED in `tests/unit/004/command-recovery.spec.ts` and `tests/integration/004/worker-command-routing.spec.ts`

### Provider-neutral contracts and Core

- [X] T038 [P] Define logical targets, messaging capability requests/results and safe provider refs in `packages/connector-sdk/src/messaging.ts`
- [X] T039 [P] Define versioned inbound route/auth/replay/normalization contracts without provider DTOs in `packages/connector-sdk/src/connector-ingress.ts`
- [X] T040 [P] Define fenced one-shot non-serializable presentation leases and sensitive-value ports in `packages/connector-sdk/src/presentation-materializer.ts`
- [X] T041 Export the new SDK contracts from `packages/connector-sdk/src/index.ts`
- [X] T042 [P] Implement immutable scoped action provenance and its closed actor/subject/effect rules in `packages/platform-core/src/audit/action-provenance.ts`
- [X] T043 [P] Implement Candidate identity, observations, effective expiry/snooze lifecycle and HUMAN decisions in `packages/platform-core/src/work-management/intake-candidate.ts`
- [X] T044 [P] Implement additive Draft revisions, structural partial validation, confirmation snapshot and CAS lifecycle in `packages/platform-core/src/work-management/intake-draft-revision.ts`
- [X] T045 [P] Implement generic ingress declaration and bounded normalized receipt contracts in `packages/platform-core/src/interactions/ingress-contract.ts`
- [X] T046 [P] Implement exact single-use InteractionIntent action/subject/transport/token unions and replay lifecycle in `packages/platform-core/src/interactions/interaction-intent.ts`
- [X] T047 Implement the exact AAD commitment verifier, capsule lease rules and fail-closed materializer in `packages/platform-core/src/interactions/presentation-materializer.ts`
- [X] T048 [P] Implement immutable AgentDefinition and SkillDefinition registration in `packages/platform-core/src/agent-runtime/agent-definition.ts` and `packages/platform-core/src/agent-runtime/skill-registry.ts`
- [X] T049 [P] Implement exact-subject Agent Run/grant/step lifecycle and request-key conflict rules in `packages/platform-core/src/agent-runtime/agent-run.ts`
- [X] T050 Implement dual-principal reauthorization, grant intersection, typed invocation policy and narrow model port in `packages/platform-core/src/agent-runtime/tool-gateway.ts` and `packages/platform-core/src/agent-runtime/model-proposal-port.ts`
- [X] T051 [P] Implement durable NotificationIntent delivery union, dedupe/effect commitments, attempts and terminal states in `packages/platform-core/src/notifications/notification-intent.ts`
- [X] T052 Extend command source identity and gateway validation for Candidate, AgentRun and NotificationIntent without weakening Draft/WorkItem behavior in `packages/platform-core/src/commanding/connector-command.ts` and `packages/platform-core/src/commanding/command-gateway.ts`
- [X] T053 Export the new Core surfaces once from `packages/platform-core/src/index.ts`

### Persistence and migrations

- [X] T054 Implement Core 0100 ActionProvenance, Candidate/observations/decisions and additive Draft revision/confirmation/backfill schema in `packages/platform-persistence-typeorm/src/migrations/core/0100-action-candidate-draft.ts`
- [X] T055 Implement Core 0105 project callback receipts, InteractionIntents, AEAD capsules and same-scope/exactly-one constraints in `packages/platform-persistence-typeorm/src/migrations/core/0105-interaction-intents.ts`
- [X] T056 Implement Core 0110 Agent Runs, manifests, immutable grants, steps and tool invocations in `packages/platform-persistence-typeorm/src/migrations/core/0110-agent-runtime.ts`
- [X] T057 Implement Core 0120 NotificationIntents, delivery attempts, command linkage and purge/reconciliation state in `packages/platform-persistence-typeorm/src/migrations/core/0120-notification-intents.ts`
- [X] T058 Add entity mappings for all 0100–0120 tables in `packages/platform-persistence-typeorm/src/entities/intake-interaction.entities.ts` and `packages/platform-persistence-typeorm/src/entities/agent-notification.entities.ts`
- [X] T059 Register Core migrations/entities and preserve ordered ownership/parity in `packages/platform-persistence-typeorm/src/migrations/core/index.ts`, `packages/platform-persistence-typeorm/src/migration-registry.ts` and `packages/platform-persistence-typeorm/src/entities/composition.ts`
- [X] T060 [P] Implement scoped append-only ActionProvenance persistence in `packages/platform-persistence-typeorm/src/action-provenance.repository.ts`
- [X] T061 [P] Implement Candidate and revision-aware Draft repositories with contiguous append/CAS and legacy shadow-write in `packages/platform-persistence-typeorm/src/intake-candidate.repository.ts` and `packages/platform-persistence-typeorm/src/intake-draft-revision.repository.ts`
- [X] T062 Implement normalized callback receipt, exact intent and presentation-capsule repositories without reusing raw-byte webhook storage in `packages/platform-persistence-typeorm/src/external-interaction-receipt.repository.ts`, `packages/platform-persistence-typeorm/src/interaction-intent.repository.ts` and `packages/platform-persistence-typeorm/src/interaction-presentation-secret.repository.ts`
- [X] T063 [P] Implement Agent runtime and NotificationIntent repositories with immutable child-set hashes and fenced attempts in `packages/platform-persistence-typeorm/src/agent-runtime.repository.ts` and `packages/platform-persistence-typeorm/src/notification-intent.repository.ts`
- [X] T064 Implement atomic Candidate/Draft/callback/action-presentation and Agent/notification units of work with audit/event/command outboxes in `packages/platform-persistence-typeorm/src/intake-interaction-unit-of-work.ts` and `packages/platform-persistence-typeorm/src/agent-notification-unit-of-work.ts`
- [X] T065 Export every new persistence adapter from `packages/platform-persistence-typeorm/src/index.ts`

### QA definitions, Connector and local provider

- [X] T066 [P] Add immutable successor `competency-qa@1.1.0` and `qa.validation@1.1.0` definitions with required messaging roles and optional callback role in `packages/competency-qa/src/manifest-v1.1.ts`
- [X] T067 Register 1.0 and 1.1 side by side without rebinding prior compositions in `packages/runtime-composition/src/qa/contributions.ts`, `packages/runtime-composition/src/qa/composition.ts` and `packages/runtime-composition/src/qa/operational-work-item.contract.ts`
- [X] T068 [P] Create the nine-versioned-skill catalog skeleton and exact subject/output/allowlist declarations in `packages/competency-qa/src/skills/catalog.ts`
- [X] T069 Add QA 2040 proposal migration/entity parity and ordered registration in `packages/competency-qa/src/persistence/migrations/2040-hermes-proposals.ts`, `packages/competency-qa/src/persistence/contributions.ts`, `packages/competency-qa/src/persistence/migrations/index.ts` and `packages/competency-qa/src/persistence/entities.ts`
- [X] T070 Export the browser-safe 1.1 manifest/skill contracts through `packages/competency-qa/src/index.ts` and keep persistence/runtime contributions exclusively in `packages/competency-qa/src/node.ts`
- [X] T071 [P] Implement allowlisted native-fetch transport and short-lived bot/gateway secret leases in `packages/connector-mattermost/src/http/mattermost-rest-client.ts` and `packages/connector-mattermost/src/auth/mattermost-auth.ts`
- [X] T072 [P] Implement bounded dialog/post-action normalization and opaque-intent plus optional signed-proxy verification in `packages/connector-mattermost/src/ingress/dialog-submission.ts`, `packages/connector-mattermost/src/ingress/post-action.ts` and `packages/connector-mattermost/src/ingress/callback-auth.ts`
- [X] T073 [P] Implement server discovery and composed Profile/metadata validation in `packages/connector-mattermost/src/profile/mattermost-discovery.ts` and `packages/connector-mattermost/src/profile/mattermost-profile-validator.ts`
- [X] T074 Implement deterministic logical-target rendering, exact transient callback/notification bytes and the bounded template-only send adapter with capture suppressed in `packages/connector-mattermost/src/presentation/mattermost-presentation.ts` and `packages/connector-mattermost/src/notifications/mattermost-notification.ts`
- [X] T075 Implement the pending-ID/effect-marker lookup executor with exact one/zero/multiple/unsupported classification and no V1 resend outcome in `packages/connector-mattermost/src/reconciliation/mattermost-reconciliation.ts`
- [X] T076 Finalize `messaging.intake`, `messaging.notify`, optional `messaging.callback`, ingress declarations and public exports in `packages/connector-mattermost/src/manifest.ts` and `packages/connector-mattermost/src/index.ts`
- [X] T077 [P] Implement Mock Hub Mattermost state migrations/entities/repository in `apps/mock-hub/src/persistence/migrations/0050-mattermost-state.ts`, `apps/mock-hub/src/persistence/migrations/0051-mattermost-faults.ts`, `apps/mock-hub/src/persistence/migrations/0052-mattermost-effect-audit.ts`, `apps/mock-hub/src/mattermost/state/mattermost.entities.ts` and `apps/mock-hub/src/mattermost/state/mattermost.repository.ts`
- [X] T078 Implement narrow Mattermost API, control, callback and stateful fault surfaces over T077 persistence in `apps/mock-hub/src/mattermost/api/mattermost.controller.ts`, `apps/mock-hub/src/mattermost/control/mattermost-control.controller.ts`, `apps/mock-hub/src/mattermost/scenarios/mattermost-scenarios.ts` and `apps/mock-hub/src/mattermost/mattermost.module.ts`
- [X] T079 Register Mock 0050–0052 entities/migrations/module and deterministic two-Project seed in `apps/mock-hub/src/persistence/data-source.ts`, `apps/mock-hub/src/persistence/entities.ts`, `apps/mock-hub/src/persistence/seed.ts` and `apps/mock-hub/src/app.module.ts`

### Worker, composition and HTTP foundations

- [X] T080 Implement and export capability-keyed named worker contributions plus central command routing before the worker app consumes them in `packages/runtime-composition/src/worker/contributions.ts` and `packages/runtime-composition/src/index.ts`
- [X] T081 Make both Core in-memory and TypeORM command recovery handler- and reconciliation-policy-aware so `effectInvocationStartedAt` can never blind-requeue Mattermost writes in `packages/platform-core/src/commanding/connector-command.ts` and `packages/platform-persistence-typeorm/src/command-delivery.store.ts`
- [X] T082 Restrict Jira worker steps to owned capabilities and integrate the central router in `packages/runtime-composition/src/jira/qa-worker-steps.ts`
- [X] T083 Replace fixed worker loop tokens with named contributions and composition selection in `apps/worker/src/app.module.ts` and `apps/worker/src/main.ts`
- [X] T084 [P] Compose the Mattermost Connector, Profile validation, ingress registry and presentation materializer ports in `packages/runtime-composition/src/mattermost/composition.ts`, `packages/runtime-composition/src/mattermost/profile-validation.ts` and `packages/runtime-composition/src/mattermost/ingress-handlers.ts`
- [X] T085 [P] Implement the runnable durable generic Agent Run executor, incremental SkillDefinition registry and named worker contribution without requiring all nine story implementations in `packages/runtime-composition/src/hermes/composition.ts`, `packages/runtime-composition/src/hermes/skill-registry.ts`, `packages/runtime-composition/src/hermes/agent-run-worker.ts` and `packages/runtime-composition/src/hermes/worker-steps.ts`
- [X] T086 Add `qa-jira-mattermost-local` and gated non-prod environment selection while preserving all prior contours in `packages/runtime-composition/src/config/environment.ts` and `packages/runtime-composition/src/non-local.composition.ts`
- [X] T087 Register 004 migrations/entities, QA 1.1 and runtime exports serially in `packages/runtime-composition/src/migrations/composition.ts`, `packages/runtime-composition/src/persistence/entity-composition.ts`, `packages/runtime-composition/src/qa/composition.ts` and `packages/runtime-composition/src/index.ts`
- [X] T088 Add deterministic local seed/readiness and migrate/seed CLI support in `packages/runtime-composition/src/seed/qa-jira-mattermost-local-seed.ts`, `packages/runtime-composition/src/bootstrap/local-readiness.ts`, `packages/runtime-composition/src/cli/migrate.ts` and `packages/runtime-composition/src/cli/seed.ts`
- [X] T089 Implement and statically register the shared policy-gated source-event→NotificationIntent→command pipeline, audited zero-effect denial, exact pre-marker materialization/rebuild, durable invocation marker, post-marker lookup-only reconciliation and same-UoW capsule purge in `packages/runtime-composition/src/mattermost/notification-projection.ts`, `packages/runtime-composition/src/mattermost/notification-worker.ts`, `packages/runtime-composition/src/mattermost/reconciliation.ts`, `packages/runtime-composition/src/mattermost/expiry-sweeper.ts`, `packages/runtime-composition/src/mattermost/worker-contribution.ts`, `packages/runtime-composition/src/mattermost/composition.ts`, `packages/runtime-composition/src/worker/contributions.ts`, `packages/runtime-composition/src/index.ts` and `apps/worker/src/app.module.ts`
- [X] T090 [P] Create the provider-specific Profile/Connection administration controller without bootstrap, project-selection or callback story behavior in `apps/api/src/extensions/mattermost-integration.controller.ts`
- [X] T091 Replace the hard-coded `INTERNAL` authorization default with real resource/template classification resolution in `packages/platform-runtime-nest/src/auth/authorize-use-case.interceptor.ts` and `packages/platform-runtime-nest/src/auth/authorization-contributions.ts`
- [X] T092 Wire the administration controller, shared ports, DataSource and composition selector without importing the Connector package in `apps/api/src/app.module.ts` and `apps/api/src/main.ts`
- [X] T093 Add PostgreSQL/Redis/Mock Hub/IdP API-worker local contour wiring without production credentials in `infra/compose/docker-compose.local.yml`
- [X] T094 Run all foundation contract, architecture, migration, security, worker-routing and Mock Hub gates in `tools/verification/004-foundation-checkpoint.mts` and persist `reports/004-mattermost-hermes-intake/foundation.json`

**Checkpoint**: Foundation is green; provider-specific code stays outside generic runtime, callbacks retain no raw body, worker ownership is capability-safe and marked writes cannot be resent.

---

## Phase 3 — US1: Guided intake через личный диалог (P1) — MVP

**Goal**: static `/awp create` leads through canonical OIDC and exact project selection to a revisioned Draft, only missing-field guidance, one exact HUMAN confirmation, one Feature 003 Jira request/Work Item and one safe notification.

**Independent test**: start from the public bootstrap with no state, authorize one of two synthetic Projects, revise/confirm the Draft twice concurrently and prove one Jira issue/Work Item plus stable replay and zero unauthorized/projectless state.

### Tests first

- [X] T095 [P] [US1] Write exact bootstrap shape/static-response and OIDC project-option/selection contract vectors in `tests/contract/004/us1-bootstrap-project-selection.spec.ts`
- [X] T096 [P] [US1] Write structural-partial, stable-question-order, valid-field-not-reasked and bounded patch skill vectors in `tests/contract/004/us1-intake-skills.spec.ts`
- [X] T097 [P] [US1] Write forged/oversize bootstrap, project enumeration, revoked authorization and zero-state tests in `tests/integration/security/004/us1-bootstrap-authorization.spec.ts`
- [X] T098 [P] [US1] Write full-policy option issuance, prior-set invalidation and direct Draft revision-1 transaction tests in `tests/integration/004/us1-project-selection-draft.spec.ts`
- [X] T099 [P] [US1] Write revision append/shadow-write/expected-hash CAS and stale suggestion rejection tests in `tests/integration/004/us1-draft-revision-cas.spec.ts`
- [X] T100 [P] [US1] Write callback receipt/action claim concurrency, wrong-actor non-consumption and stable-result replay tests in `tests/integration/004/us1-callback-concurrency.spec.ts`
- [X] T101 [P] [US1] Write exact summary/configuration pin, duplicate confirmation and one Feature 003 command/issue/Work Item tests in `tests/integration/004/us1-confirmation-idempotency.spec.ts`
- [X] T102 [P] [US1] Write the complete API/worker/PostgreSQL/Redis/Mock Hub guided-intake journey in `tests/e2e/004-us1-guided-intake.spec.ts`
- [X] T103 [P] [US1] Write the OIDC selection, guided form, immutable summary and replay browser journey in `tests/e2e/acceptance/004-mattermost-browser-journey.spec.ts`

### Implementation

- [X] T104 [US1] Implement the bounded authority-free byte-stable `/awp create` adapter and controller in `packages/runtime-composition/src/mattermost/bootstrap.ts` and `apps/api/src/extensions/mattermost-bootstrap.controller.ts`
- [X] T105 [US1] Compute project options from membership∩entitlement∩permission∩classification and issue fresh project-scoped web intents in `packages/runtime-composition/src/mattermost/project-selection.ts`
- [X] T106 [US1] Atomically consume one OIDC-session-bound option, reauthorize and create/replay Draft revision 1 in `packages/platform-persistence-typeorm/src/intake-interaction-unit-of-work.ts` and `apps/api/src/extensions/mattermost-project-selection.controller.ts`
- [X] T107 [US1] Authenticate, normalize, receipt and asynchronously dispatch dialog/post-action callbacks in `packages/runtime-composition/src/mattermost/ingress-handlers.ts` and `apps/api/src/extensions/mattermost-ingress.controller.ts`
- [X] T108 [US1] Extract controller-local Draft SQL into one revision-aware provider-neutral service used by web and Mattermost in `packages/runtime-composition/src/qa/intake-draft-service.ts` and `apps/api/src/extensions/qa-pack.controller.ts`
- [X] T109 [US1] Implement/export scoped Draft revision HTTP behavior and register all US1 bootstrap, selection, ingress and Draft controllers in `packages/platform-runtime-nest/src/http/intake-draft-revisions.controller.ts`, `packages/platform-runtime-nest/src/index.ts` and `apps/api/src/app.module.ts`
- [X] T110 [P] [US1] Implement exact-revision deterministic completeness assessment in `packages/competency-qa/src/application/intake-completeness.ts`
- [X] T111 [P] [US1] Implement and incrementally register `qa-intake-assist@1.0.0` and `qa-intake-readiness@1.0.0` one-output definitions/fallbacks in `packages/competency-qa/src/skills/qa-intake-assist.ts`, `packages/competency-qa/src/skills/qa-intake-readiness.ts` and `packages/runtime-composition/src/hermes/intake-skill-contribution.ts`
- [X] T112 [US1] Implement the canonical stable missing/invalid-field selector, statically bind the US1 contribution and start, persist and execute both exact-Draft skills through the foundational Agent Run worker in `packages/competency-qa/src/application/intake-question-selector.ts`, `packages/runtime-composition/src/hermes/intake-assistance.ts` and `packages/runtime-composition/src/hermes/composition.ts`
- [X] T113 [US1] Route web and Mattermost exact confirmation through the existing QA confirmation and Feature 003 Jira materializer only in `packages/runtime-composition/src/qa/intake-confirmation-service.ts`, `packages/competency-qa/src/application/confirm-qa-intake.ts` and `packages/runtime-composition/src/jira/qa-command-materializer.ts`
- [X] T114 [US1] Implement exact Draft revise/validate/confirm callback actions with intent invalidation and capsule purge in `packages/runtime-composition/src/mattermost/draft-actions.ts`
- [X] T115 [US1] Add bootstrap/selection/revision/confirmation/replay/crash scenarios in `apps/mock-hub/src/mattermost/scenarios/mattermost-scenarios.ts`
- [X] T116 [US1] Render deterministic guided intake, questions, revision history and immutable confirmation summary in `packages/competency-qa/src/ui/intake.tsx` and `packages/competency-qa/src/ui/contribution.tsx`
- [X] T117 [US1] Add the Mattermost intake route and register its Chromium process entrypoint before the US1 checkpoint in `apps/web/src/routes/qa/mattermost-intake.tsx`, `apps/web/src/App.tsx`, `tools/smoke/feature-004-browser-process.mts` and `playwright.config.ts`
- [X] T118 [US1] Project the confirmed-request safe notification through the shared NotificationIntent path in `packages/runtime-composition/src/mattermost/intake-notifications.ts` and `packages/runtime-composition/src/extensions/confirmation-hooks.ts`
- [X] T119 [US1] Execute API and browser journeys plus duplicate/crash checks in `tools/verification/004-us1-checkpoint.mts` and persist `reports/004-mattermost-hermes-intake/us1.json`

**Checkpoint**: US1 is the MVP. It is complete without US2–US4 when Foundation is seeded and proves one Jira QA Request/Work Item with no chat authority shortcut.

---

## Phase 4 — US2: Candidate notification and HUMAN decision (P1)

**Goal**: authoritative allowlisted Jira discovery creates or updates one Candidate, presents one bounded action set and records HUMAN `CREATE | SNOOZE | IGNORE` without creating operational work.

**Independent test**: seed an allowlisted Jira signal and exact read; prove one Candidate plus appended source observations, then exercise each decision from a fresh fixture and prove only `CREATE` opens an origin-linked Draft.

### Tests first

- [X] T120 [P] [US2] Write Candidate identity/observation/decision/event and snooze-before-expiry contract vectors in `tests/contract/004/us2-candidate.spec.ts`
- [X] T121 [P] [US2] Write allowlisted Jira signal→authoritative read→Candidate and direct-import separation tests in `tests/integration/004/us2-jira-candidate-trigger.spec.ts`
- [X] T122 [P] [US2] Write stable dedupe, identical no-op and changed-source-version append tests in `tests/integration/004/us2-candidate-dedupe.spec.ts`
- [X] T123 [P] [US2] Write CREATE/SNOOZE/IGNORE CAS, expiry precedence, wake projection and no issue/SLA/WIP tests in `tests/integration/004/us2-candidate-decisions.spec.ts`
- [X] T124 [P] [US2] Write one-post/three-intent action-set, route/action-ID separation and sibling invalidation tests in `tests/integration/004/us2-candidate-presentation.spec.ts`
- [X] T125 [P] [US2] Write HUMAN-only decision, revoked/foreign scope, stale observation and cross-project denial tests in `tests/integration/security/004/us2-candidate-authorization.spec.ts`
- [X] T126 [P] [US2] Write the independent Jira-trigger and three-decision E2E journey in `tests/e2e/004-us2-candidate-decisions.spec.ts`

### Implementation

- [X] T127 [US2] Complete Candidate create/observe/dedupe/effective-state/decision use cases in `packages/platform-core/src/work-management/intake-candidate.ts`
- [X] T128 [US2] Implement atomic observation, HUMAN decision, conversion-to-Draft and stable replay methods in `packages/platform-persistence-typeorm/src/intake-candidate.repository.ts` and `packages/platform-persistence-typeorm/src/intake-interaction-unit-of-work.ts`
- [X] T129 [P] [US2] Implement allowlisted authoritative Jira Candidate discovery separately from operational import in `packages/runtime-composition/src/jira/candidate-discovery.ts`
- [X] T130 [US2] Route webhook and reconciliation hints through exact Jira read/trigger evaluation into one Candidate producer in `packages/runtime-composition/src/jira/webhook-handlers.ts` and `packages/runtime-composition/src/jira/reconciliation-jobs.ts`
- [X] T131 [US2] Implement, export and register scoped Candidate list/detail/decision HTTP operations in `packages/platform-runtime-nest/src/http/intake-candidates.controller.ts`, `packages/platform-runtime-nest/src/index.ts` and `apps/api/src/app.module.ts`
- [X] T132 [P] [US2] Create/replay one Candidate presentation with ordered CREATE/SNOOZE/IGNORE intents and capsules in `packages/runtime-composition/src/mattermost/candidate-actions.ts`
- [X] T133 [US2] Project Candidate discovered/updated/reminder events to deduplicated NotificationIntents in `packages/runtime-composition/src/mattermost/candidate-notifications.ts`
- [X] T134 [US2] Render Candidate list/detail, source observation, expiry/snooze and HUMAN decision controls in `packages/competency-qa/src/ui/candidate-intake.tsx` and `packages/competency-qa/src/ui/contribution.tsx`
- [X] T135 [US2] Add the independently seedable Candidate route in `apps/web/src/routes/qa/intake-candidates.tsx` and `apps/web/src/App.tsx`
- [X] T136 [US2] Add Jira trigger/version-update and CREATE/SNOOZE/IGNORE callback scenarios in `apps/mock-hub/src/mattermost/scenarios/mattermost-scenarios.ts` and `apps/mock-hub/src/jira/jira-scenarios.ts`
- [X] T137 [US2] Emit compact Candidate observation/discovery/decision/conversion events through the canonical outbox in `packages/runtime-composition/src/intake/candidate-events.ts`
- [X] T138 [US2] Register the provider-neutral GitLab source kind while keeping its producer fail-closed until Feature 005 in `packages/runtime-composition/src/intake/candidate-sources.ts`
- [X] T139 [US2] Run the API/worker/Mock Hub Candidate decision E2E from independent seeds in `tests/e2e/004-us2-candidate-decisions.spec.ts`
- [X] T140 [US2] Persist exact Candidate identity/decision/no-operational-work evidence in `tools/verification/004-us2-checkpoint.mts` and `reports/004-mattermost-hermes-intake/us2.json`

**Checkpoint**: US2 is independently testable after Foundation and never converts discovery into operational work without the later exact Draft confirmation path.

---

## Phase 5 — US3: Completeness, triage proposals and deterministic degradation (P1)

**Goal**: run one exact-subject Hermes skill with immutable intersected grants, produce an explainable schema-valid QA proposal, mark it stale on drift and fall back or deny safely when the model fails or attacks policy.

**Independent test**: seed exact DRAFT, CANDIDATE and WORK_ITEM snapshots; execute allowed skills, mutate one source fact, inject invalid JSON/timeout/rate limit/prompt injection and prove typed results or DENIED records with zero grant expansion/effect.

### Tests first

- [X] T141 [P] [US3] Write the six US3 skill subject/output/allowlist/fallback vectors, triage fact-index and effort-range semantic negatives, while verifying all nine catalog declarations without requiring the US4 notify implementation in `tests/contract/004/us3-hermes-skills.spec.ts`
- [X] T142 [P] [US3] Write exact subject, dual authorization, immutable grants, request-key conflict and lifecycle tests in `tests/integration/004/us3-agent-run.spec.ts`
- [X] T143 [P] [US3] Write TriageAssessment fact-index/staleness unit tests plus revision, source drift, expiry, stale-before-read and supersession integration tests in `tests/unit/004/triage-assessment.spec.ts` and `tests/integration/004/us3-triage-staleness.spec.ts`
- [X] T144 [P] [US3] Write Work Item-only SessionPlanProposal creation/staleness and no accepted-Session mutation tests in `tests/integration/004/us3-session-plan.spec.ts`
- [X] T145 [P] [US3] Write deterministic fallback-selection unit tests plus valid/invalid JSON, timeout, rate-limit, unavailable and fallback-completion integration tests in `tests/unit/004/model-fallback.spec.ts` and `tests/integration/004/us3-model-fallback.spec.ts`
- [X] T146 [P] [US3] Write tool selection, Profile/scope/classification mutation, revoked HUMAN/SERVICE and forbidden-effect denial tests in `tests/integration/security/004/us3-tool-gateway.spec.ts`
- [X] T147 [P] [US3] Write PromptManifest allowlist/minimization unit tests plus prompt injection, raw history/attachment/token exclusion and diagnostic-retention security tests in `tests/unit/004/prompt-manifest.spec.ts` and `tests/integration/security/004/us3-prompt-boundary.spec.ts`
- [X] T148 [P] [US3] Write the independent triage/staleness/fallback/denial E2E journey in `tests/e2e/004-us3-hermes-proposals.spec.ts`

### Implementation

- [X] T149 [P] [US3] Implement revisioned TriageAssessment dimensions, recommendations, fact refs and staleness in `packages/competency-qa/src/domain/triage-assessment.ts`
- [X] T150 [P] [US3] Implement revisioned Work Item SessionPlanProposal semantics and separate acceptance boundary in `packages/competency-qa/src/domain/session-plan-proposal.ts`
- [X] T151 [US3] Implement proposal creation, semantic validation, supersession and stale-before-use application services in `packages/competency-qa/src/application/triage-assessment.ts` and `packages/competency-qa/src/application/session-plan-proposal.ts`
- [X] T152 [US3] Implement QA proposal repositories and 2040 CAS/current-pointer behavior in `packages/competency-qa/src/persistence/triage-assessment.repository.ts` and `packages/competency-qa/src/persistence/session-plan-proposal.repository.ts`
- [X] T153 [P] [US3] Implement `qa-work-item-readiness@1.0.0` over existing accepted-request DoR rules in `packages/competency-qa/src/skills/qa-work-item-readiness.ts`
- [X] T154 [P] [US3] Implement `qa-triage@1.0.0` deterministic dimensions/facts/recommendations in `packages/competency-qa/src/skills/qa-triage.ts`
- [X] T155 [P] [US3] Implement `qa-session-plan@1.0.0` stable proposal-only planning in `packages/competency-qa/src/skills/qa-session-plan.ts`
- [X] T156 [P] [US3] Implement `qa-result-review-prep@1.0.0` without verdict authority in `packages/competency-qa/src/skills/qa-result-review-prep.ts`
- [X] T157 [P] [US3] Implement existing-policy-backed `qa-defect-draft@1.0.0` and `qa-dod-check@1.0.0` definitions in `packages/competency-qa/src/skills/qa-defect-draft.ts` and `packages/competency-qa/src/skills/qa-dod-check.ts`
- [X] T158 [US3] Build allowlisted classified PromptManifest facts and canonical input fingerprints without persisting rendered prompts in `packages/runtime-composition/src/hermes/prompt-manifest-builder.ts`
- [X] T159 [P] [US3] Extend deterministic fake-model outcomes for valid, invalid, injection, timeout, rate-limit, unavailable and contradictory evidence in `packages/runtime-composition/src/model/deterministic-fake-model.ts`
- [X] T160 [US3] Implement QA subject loaders and dual-principal typed Tool Gateway bindings without direct provider or model effects in `packages/runtime-composition/src/hermes/qa-tool-gateway.ts`
- [X] T161 [US3] Incrementally register the six completed US3 SkillDefinitions with one output schema and closed tool set each in `packages/runtime-composition/src/hermes/qa-proposal-skill-contribution.ts`
- [X] T162 [US3] Bind the six proposal skills, optional ModelProposalPort and typed deterministic fallbacks to the foundational Agent Run worker in `packages/runtime-composition/src/hermes/composition.ts` and `packages/runtime-composition/src/hermes/proposal-agent-run.ts`
- [X] T163 [US3] Mark proposal/current pointers stale on exact source/configuration fingerprint drift before display/use in `packages/runtime-composition/src/hermes/proposal-staleness.ts`
- [X] T164 [US3] Implement, export and register scoped Agent Run start/get endpoints that accept only `skillRef + subjectRef + requestKey` in `packages/platform-runtime-nest/src/http/agent-runs.controller.ts`, `packages/platform-runtime-nest/src/index.ts` and `apps/api/src/app.module.ts`
- [X] T165 [US3] Expose scoped triage/session-plan proposal reads through QA-owned app controllers in `apps/api/src/extensions/qa-hermes-proposals.controller.ts` and `apps/api/src/app.module.ts`
- [X] T166 [US3] Render explainable dimensions/facts/confidence, proposal lineage and stale state in `packages/competency-qa/src/ui/hermes-proposals.tsx` and `packages/competency-qa/src/ui/contribution.tsx`
- [X] T167 [US3] Add independently seedable Hermes proposal routes in `apps/web/src/routes/qa/hermes-proposals.tsx` and `apps/web/src/App.tsx`
- [X] T168 [US3] Run exact-subject, drift, fallback and injection E2E cases in `tests/e2e/004-us3-hermes-proposals.spec.ts`
- [X] T169 [US3] Persist run/grant/fact/fallback/denial trace evidence in `tools/verification/004-us3-checkpoint.mts` and `reports/004-mattermost-hermes-intake/us3.json`

**Checkpoint**: US3 is independently testable from seeded subjects; no model result becomes accepted Jira, queue, verdict, entitlement or release state.

---

## Phase 6 — US4: Durable notification, outage and ambiguity (P1)

**Goal**: preserve Jira/QA state independently of Mattermost, deliver one durable intent once when provable and expose typed terminal/ambiguous health without any blind resend after the invocation marker.

**Independent test**: seed a committed source event, stop/restart worker and Mock Hub around the write marker, then prove one delivery or visible `FAILED_FINAL/AMBIGUOUS`, unchanged source state and no second POST.

### Tests first

- [X] T170 [P] [US4] Write `qa-notify` subject/output/allowlist/fallback vectors plus MESSAGE versus INTERACTION_PRESENTATION, target, template, effect-key and reconciliation contracts in `tests/contract/004/us4-qa-notify.spec.ts` and `tests/contract/004/us4-notification-delivery.spec.ts`
- [X] T171 [P] [US4] Write source transaction versus NotificationIntent/outbox independence and dedupe tests in `tests/integration/004/us4-outbox-independence.spec.ts`
- [X] T172 [P] [US4] Write pre-marker rebuild, post-marker lookup-only, restart and zero/one/multiple/unsupported recovery tests in `tests/integration/004/us4-notification-recovery.spec.ts`
- [X] T173 [P] [US4] Write auth/channel/schema/policy degradation and explicit recovery-to-HEALTHY tests in `tests/integration/004/us4-connection-health.spec.ts`
- [X] T174 [P] [US4] Prove 429/5xx/timeout/network loss after the marker cannot schedule or issue a second POST in `tests/integration/security/004/us4-no-blind-resend.spec.ts`
- [X] T175 [P] [US4] Prove delivery/ambiguity/failure/consumption/invalidation same-UoW purge plus fail-closed expiry sweep in `tests/integration/security/004/us4-capsule-purge.spec.ts`
- [X] T176 [P] [US4] Write the independent outage/recovery/health API-worker-process E2E journey in `tests/e2e/004-us4-notification-outage.spec.ts`

### Implementation

- [X] T177 [US4] Harden the shared source projection with explicit source fingerprint dedupe, outbox independence and delivery-health event commitments in `packages/runtime-composition/src/mattermost/notification-projection.ts`
- [X] T178 [US4] Extend the foundational delivery worker with bounded provider-result classification and restart-safe outage attempt evidence in `packages/runtime-composition/src/mattermost/notification-worker.ts`
- [X] T179 [US4] Extend foundational lookup-only reconciliation with exact one/zero/multiple/unsupported terminal transitions and selector binding in `packages/runtime-composition/src/mattermost/reconciliation.ts`
- [X] T180 [P] [US4] Harden fail-closed intent/capsule expiry with bounded same-UoW purge and restart sweeps in `packages/runtime-composition/src/mattermost/expiry-sweeper.ts`
- [X] T181 [US4] Harden foundational provider-byte materialization with restart-stable hash commitments and fenced one-shot token leases in `packages/connector-mattermost/src/presentation/mattermost-presentation.ts`
- [X] T182 [US4] Harden the foundational template-only send adapter with outage classification, logical-target revalidation and capture-suppression assertions in `packages/connector-mattermost/src/notifications/mattermost-notification.ts`
- [X] T183 [US4] Harden the foundational pending-ID/effect-marker lookup executor across outage/restart faults while preserving exact one/zero/multiple/unsupported results in `packages/connector-mattermost/src/reconciliation/mattermost-reconciliation.ts`
- [X] T184 [US4] Implement, incrementally register and statically bind `qa-notify@1.0.0` as NotificationIntent creation only in `packages/competency-qa/src/skills/qa-notify.ts`, `packages/runtime-composition/src/hermes/qa-notify-skill-contribution.ts` and `packages/runtime-composition/src/hermes/composition.ts`
- [X] T185 [US4] Implement, export and register scoped NotificationIntent state/result without secrets or provider body in `packages/platform-runtime-nest/src/http/notification-intents.controller.ts`, `packages/platform-runtime-nest/src/index.ts` and `apps/api/src/app.module.ts`
- [X] T186 [US4] Render provider-neutral delivery, ambiguity and Connection health primitives without Mattermost vocabulary in `packages/platform-ui/src/integration-health/delivery-health.tsx` and `packages/platform-ui/src/index.ts`
- [X] T187 [US4] Add QA notification-health contribution and route wiring in `packages/competency-qa/src/ui/notification-health.tsx`, `packages/competency-qa/src/ui.ts`, `apps/web/src/routes/qa/notification-health.tsx` and `apps/web/src/App.tsx`
- [X] T188 [US4] Add outage, 401/403/429/5xx, timeout-before/after-effect and zero/one/multiple/unsupported lookup scenarios in `apps/mock-hub/src/mattermost/scenarios/mattermost-scenarios.ts`
- [X] T189 [US4] Update exact Connection health from terminal failures and explicit validation probes in `packages/runtime-composition/src/mattermost/connection-health.ts`
- [X] T190 [P] [US4] Add deterministic outage/restart scenario catalog entries in `tools/local/mattermost-scenario-catalog.mts`
- [X] T191 [US4] Run the independent stopped/restarted-worker and Mock Hub outage journey in `tests/e2e/004-us4-notification-outage.spec.ts`
- [X] T192 [US4] Persist source-state/delivery/attempt/marker/reconciliation/health evidence in `tools/verification/004-us4-checkpoint.mts` and `reports/004-mattermost-hermes-intake/us4.json`

**Checkpoint**: US4 delivers once only when provable; every uncertain marked write reconciles or stops visibly and never rewrites Jira/QA state.

---

## Phase 7 — Cross-cutting hardening, executable quickstart and final evidence

**Purpose**: close runtime drift, PostgreSQL-version, security, process, browser, optional-live and task-bound evidence gates across all selected stories.

- [X] T193 Regenerate both API and Mock Hub snapshots from the 004 OpenAPI/runtime surface and add drift tests in `tools/contracts/build-openapi-snapshots.mts`, `apps/api/openapi.generated.json`, `apps/mock-hub/openapi.generated.json` and `tests/contract/004/openapi-runtime-drift.spec.ts`
- [X] T194 [P] Verify all 20 AsyncAPI messages against canonical envelopes, payload schema IDs/versions/digests and runtime producers in `tests/contract/004/asyncapi-events.spec.ts`
- [X] T195 [P] Add multi-feature offline registry, generated-document, example and immutable-version parity tests in `tests/contract/004/schema-registry-parity.spec.ts`
- [X] T196 [P] Run PostgreSQL 17/18 fresh/upgrade/repeat/failed-recovery/backfill/lock tests and write migration evidence in `tools/ci/verify-004-migrations.mts` and `reports/004-mattermost-hermes-intake/migrations.json`
- [X] T197 [P] Add cross-workspace/project/principal/Profile/Connection/channel/bot/key/model isolation and enumeration hardening in `tests/integration/security/004/isolation-hardening.spec.ts`
- [X] T198 [P] Add bootstrap/callback forgery, replay, SSRF, redirect, secret/token/ciphertext/prompt/body capture and redaction scans in `tests/integration/security/004/connector-hardening.spec.ts`
- [X] T199 [P] Prove end-to-end HUMAN/SERVICE→subject→grant→action→command→attempt→result audit reconstruction in `tests/integration/security/004/audit-lineage.spec.ts`
- [X] T200 [P] Inject concurrent callbacks, source drift, worker/API/Mock Hub crashes and every delivery ambiguity across restart boundaries in `tests/integration/004/mattermost-chaos-recovery.spec.ts`
- [X] T201 [P] Implement local Mattermost contour commands and exact scenario dispatcher in `tools/local/mattermost-cli.mts`, `tools/local/mattermost-scenario.mts` and `tools/local/mattermost-scenario-catalog.mts`
- [X] T202 Wire local up/status/migrate/seed/down/reset and refusal of non-local reset in `tools/local/local.mts`, `infra/compose/docker-compose.local.yml` and `package.json`
- [X] T203 [P] Implement process launch/readiness/shutdown and task/runtime digest contract in `tools/smoke/feature-004-process-contract.mts` and `tools/smoke/feature-004-scenario-process.mts`
- [X] T204 Implement independent US1–US4 restartable process runners in `tools/smoke/feature-004-us1-process.mts`, `tools/smoke/feature-004-us2-process.mts`, `tools/smoke/feature-004-us3-process.mts` and `tools/smoke/feature-004-us4-process.mts`
- [X] T205 Extend the US1-registered Chromium process acceptance across US2–US4 and enforce final browser-project drift checks in `tools/smoke/feature-004-browser-process.mts` and `playwright.config.ts`
- [X] T206 Run all four stories through one real API/worker/PostgreSQL/Redis/Mock Hub contour in `tests/e2e/004-mattermost-hermes-intake.spec.ts` and `tools/smoke/feature-004.mts`
- [X] T207 Make every documented quickstart command executable and freshness-bound in `tools/verification/004-quickstart.mts` and `reports/004-mattermost-hermes-intake/quickstart.json`
- [X] T208 [P] Validate optional immutable live metadata, retention bounds, opt-in and production denial in `tools/verification/feature-004-nonprod-metadata-lib.mts`, `tools/verification/feature-004-nonprod-metadata.mts` and `reports/004-mattermost-hermes-intake/nonprod-metadata.json`
- [X] T209 Implement opt-in live Mattermost/model validation with honest `PASS | FAIL | SKIPPED_GATED` results in `tools/verification/feature-004-nonprod.mts` and `reports/004-mattermost-hermes-intake/nonprod.json`
- [X] T210 [P] Document bootstrap, callback credentials, key/retention operations, ambiguity recovery, health and local reset in `docs/runbooks/mattermost-hermes-intake.md`
- [X] T211 Map every FR-001…FR-025 and SC-001…SC-007 to fresh executable evidence in `tools/verification/feature-004-trace.mts` and `reports/004-mattermost-hermes-intake/traceability.json`
- [X] T212 [P] Implement canonical task/source/contract/runtime digest collection and safe report parsing in `tools/verification/feature-004-evidence-lib.mts`
- [X] T213 Aggregate setup/foundation/US1–US4/migrations/smoke/quickstart/trace/non-prod evidence without allowing stale or missing reports in `tools/verification/feature-004-evidence.mts` and `reports/004-mattermost-hermes-intake/documented-scenarios.json`
- [X] T214 Implement the sole final-gate writer with exact task/source/contract/runtime freshness checks in `tools/verification/feature-004-gate.mts` and `reports/004-mattermost-hermes-intake/final-gate.json`
- [X] T215 Run the complete local verification matrix, require `PASS`, and record handoff/optional-live status in `specs/004-mattermost-hermes-intake/release-readiness.md` and `reports/004-mattermost-hermes-intake/final-gate.json`

**Checkpoint**: required local evidence is `PASS`, optional live contours are honest, production is denied and the final report is bound to the exact completed task/source/contract/runtime digests.

---

## Dependencies and execution order

### Phase graph

```text
Phase 1 Setup
  → Phase 2 Shared Foundation
      ├─→ Phase 3 US1 Guided Intake (MVP)
      ├─→ Phase 4 US2 Candidate Decisions
      ├─→ Phase 5 US3 Hermes Proposals
      └─→ Phase 6 US4 Notification Recovery
              all selected stories → Phase 7 Final Evidence
```

### Phase dependencies

- **Phase 1** has no implementation dependency; T015 is the fail-closed entry checkpoint.
- **Phase 2** depends on T015 and blocks every story. The hard chain is contracts/AAD tests → Core materializer → 0105 persistence/UoW → policy-aware worker marker/recovery → Connector rendering/reconciliation → T094.
- **US1, US2, US3 and US4** may start in parallel after T094 when each uses its independent seed fixture.
- **Phase 7** depends on every story selected for the release; the full Feature 004 final gate depends on US1–US4.

### User-story dependencies

- **US1**: no story dependency after Foundation. It reuses the existing Feature 003 Jira path and is the MVP.
- **US2**: no story dependency after Foundation. Its test seed starts from an authoritative Jira observation; `CREATE` stops at a Draft.
- **US3**: no story dependency after Foundation. Its tests seed exact DRAFT/CANDIDATE/WORK_ITEM subjects rather than requiring US1/US2 execution.
- **US4**: no story dependency after Foundation. Its tests seed a committed source event and shared NotificationIntent foundation.
- Integrated delivery is recommended in priority order US1 → US2 → US3 → US4, but this is not required for independent story testing.

### Critical chains

- **US1**: static bootstrap → OIDC full authorization → exact project intent → Draft revision → intake skill → HUMAN confirmation → Feature 003 command → Jira read-back → notification.
- **US2**: Jira signal → authoritative read → trigger evaluation → Candidate observation → HUMAN decision → optional Draft.
- **US3**: exact subject → dual authorization/grant intersection → PromptManifest → schema/semantic output → proposal → stale-on-drift.
- **US4**: source event → NotificationIntent → owned command → token materialization → durable invocation marker → POST or reconciliation → health/purge.

### Shared-file serialization

Do not run tasks touching these files concurrently:

- `package.json`, `pnpm-lock.yaml`, `tsconfig.base.json`, `tools/architecture/dependency-rules.mts`;
- `packages/platform-contracts/src/schema-contributions.ts` and generated schema documents;
- `packages/connector-sdk/src/index.ts`, `packages/platform-core/src/index.ts`, `packages/platform-runtime-nest/src/index.ts`;
- persistence entity/migration registries, `entities/composition.ts`, `migration-registry.ts`, `intake-interaction-unit-of-work.ts` and persistence `index.ts`;
- `packages/competency-qa/src/{manifest.ts,index.ts,node.ts,ui.ts}`, persistence parity/registry files and UI contribution;
- runtime environment, QA/migration/entity composition and `packages/runtime-composition/src/index.ts`;
- `apps/api/src/{app.module.ts,main.ts}`, `apps/worker/src/{app.module.ts,main.ts}`;
- Mock Hub app/data-source/entity/seed composition and `apps/mock-hub/src/mattermost/scenarios/mattermost-scenarios.ts`;
- `apps/web/src/App.tsx`, `packages/platform-ui/src/index.ts`, `playwright.config.ts`;
- generated OpenAPI snapshots and final evidence reports.

---

## Parallel examples

### US1

```text
T095 Contract: bootstrap/project selection
T096 Contract: intake skills
T097 Security: authority-free bootstrap
T098 Integration: option set and Draft
T099 Integration: Draft CAS
T100 Integration: callback concurrency
T101 Integration: exact confirmation
```

After the RED suite, T110 and T111 may run in parallel; shared Mock Hub and UI contribution files remain serialized.

### US2

```text
T120 Contract: Candidate
T121 Integration: Jira trigger
T122 Integration: dedupe/observations
T123 Integration: decisions/expiry
T124 Integration: one action presentation
T125 Security: HUMAN authorization
```

After Candidate persistence is green, T129 and T132 may run in parallel; shared UI contribution files remain serialized.

### US3

```text
T141 Contract: six US3 skills + nine catalog declarations
T142 Integration: Agent Run
T143 Integration: triage staleness
T144 Integration: session-plan proposal
T145 Integration: model fallback
T146 Security: Tool Gateway
T147 Security: prompt boundary
```

T149/T150, T153–T157 and T159 are parallel-safe domain/skill/model files; registry, persistence parity, API and UI barrels remain serialized.

### US4

```text
T170 Contract: notification delivery
T171 Integration: outbox independence
T172 Integration: recovery matrix
T173 Integration: connection health
T174 Security: no blind resend
T175 Security: capsule purge
```

T180 and T190 may run in parallel after the shared notification worker/reconciliation contract is fixed; T184 is serialized through the Hermes composition, and shared UI/Mock Hub files remain serialized.

---

## Implementation strategy

### MVP first

1. Complete T001–T015 and require both entry gates `PASS`.
2. Complete T016–T094 and require the Foundation checkpoint `PASS`.
3. Complete T095–T119 for US1.
4. Stop and independently validate one exact guided intake → one Jira QA Request/Work Item.

### Incremental delivery

1. Setup + Foundation establish safe contracts, persistence, Connector, Mock Hub and worker recovery.
2. US1 delivers the preferred guided intake MVP.
3. US2 adds discovery without automatic backlog pollution.
4. US3 adds explainable model-optional proposals without authority expansion.
5. US4 proves durable notification degradation and ambiguity safety.
6. Phase 7 binds every delivered story to process-level evidence and the final gate.

### Parallel team strategy

After T094, four teams may implement the domain slices of US1–US4 from independent seeds. An integrator serializes only the shared registries, UoWs, app modules, scenario catalogs, worker routing, generated artifacts, UI barrels and final evidence files listed above; this file-level coordination is not a semantic dependency between stories.

## Notes

- `[P]` is valid only for different files with no incomplete prerequisite.
- Story tasks always carry `[US1]`…`[US4]`; Setup/Foundation/Final tasks do not.
- Setup, Foundation and story tests must be observed RED before their implementation tasks and green at each checkpoint; Phase 7 hardening/drift tests must be green before the final gate.
- Generated contract files are regenerated by their tool, never edited manually.
- A provider write after `effectInvocationStartedAt` is reconciliation-only in V1; no task may reintroduce blind resend.
- Optional live evidence never substitutes for required local evidence and may remain `SKIPPED_GATED`.
- Commit after each task or coherent task group and stop at any checkpoint that is not fresh `PASS`.
