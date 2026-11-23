# Tasks: GitLab Automated Validation

**Input**: Design documents from `/specs/005-gitlab-automated-validation/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`, Constitution 2.0.0

**Tests**: Required. The specification defines independent acceptance scenarios, migration and security matrices, and evidence-producing checkpoints. Tests are authored before the corresponding implementation and must fail for the intended reason before implementation starts.

**Organization**: Tasks are grouped by setup, shared foundation, then user story. Every story phase ends with an independently runnable evidence checkpoint. QA migrations 2050/2055/2060, GitLab migrations 4000/4010/4020, and Mock Hub migrations 0060/0061/0062 are created once in Phase 2 with their complete planned shape; later story phases activate behavior without rewriting applied migrations.

## Format: `[ID] [P?] [Story?] Description with file path`

- **[P]**: Can run in parallel after its phase prerequisites because it owns different files and has no incomplete dependency.
- **[US1]–[US4]**: Requirement traceability label for user-story phases only.
- Each task names the concrete file or files it owns.

---

## Phase 1: Setup and fail-closed entry gates

**Purpose**: Establish trustworthy prerequisites, governance metadata, package shells, and contract-generation entrypoints before runtime implementation.

- [X] T001 [P] Add stale, missing, hash-drift, Feature 003 evidence, Feature 002 manual-contract, and explicit Feature 004 non-requirement vectors in tests/contract/005/prerequisite-gate.spec.ts
- [X] T002 [P] Add Constitution 2.0 authority and pilot-contour vectors proving technical result is not a human verdict and standalone GitLab conformance does not require Mattermost in tests/contract/005/governance-gate.spec.ts
- [X] T003 [P] Define secret-free GitLabPilotMetadataPackage@1.0.0 and three-role Connection/Profile metadata contracts in packages/platform-contracts/src/extensions/gitlab-pilot-metadata.ts and export them from packages/platform-contracts/src/index.ts
- [X] T004 [P] Add deterministic valid metadata and invalid identity-routing, scope, schema, rehearsal, release, and production fixtures in config/local/gitlab-pilot-metadata.v1.json and tests/fixtures/005/gitlab-pilot-metadata.invalid.json
- [X] T005 Test schema shape, cross-field semantics, JCS root hash, distinct secret references/fingerprints, purpose conditionals, secret absence, and production denial in tests/contract/005/pilot-metadata.spec.ts
- [X] T006 [P] Scaffold packages/connector-gitlab/package.json, packages/connector-gitlab/project.json, packages/connector-gitlab/tsconfig.json, packages/connector-gitlab-persistence-typeorm/package.json, packages/connector-gitlab-persistence-typeorm/project.json, and packages/connector-gitlab-persistence-typeorm/tsconfig.json
- [X] T007 Add closed package entrypoints and capability manifests in packages/connector-gitlab/src/index.ts, packages/connector-gitlab/src/manifest.ts, and packages/connector-gitlab-persistence-typeorm/src/index.ts
- [X] T008 Register TypeScript paths, Nx dependency boundaries, runtime package dependencies, and the resulting lockfile changes in tsconfig.base.json, tools/architecture/dependency-rules.mts, packages/runtime-composition/package.json, and pnpm-lock.yaml
- [X] T009 Register the immutable Feature 005 contract contribution at order 500 and regenerate the schema registry through packages/platform-contracts/src/schema-contributions.ts, tools/contracts/build-registry.mts, and packages/platform-contracts/src/generated/schema-documents.ts
- [X] T010 Extend Feature 005 OpenAPI/schema roots and regenerate API and Mock Hub snapshots through tools/contracts/build-openapi-snapshots.mts, apps/api/openapi.generated.json, and apps/mock-hub/openapi.generated.json
- [X] T011 Implement offline validation for all Feature 005 JSON Schema, OpenAPI, AsyncAPI, examples, references, and digests in tools/contracts/verify-005-contracts.mts
- [X] T012 Wire planned test:005, verify:005, ci:005, smoke:005, trace:005, local:gitlab, and gitlab:scenario entrypoints in package.json, tools/ci/feature-005.mts, and tools/ci/feature-005-tests.mts
- [X] T013 [P] Implement the fail-closed upstream verifier and atomic prerequisites report in tools/verification/feature-005-prerequisites.mts and reports/005-gitlab-automated-validation/prerequisites.json
- [X] T014 [P] Implement the Constitution and deployment-purpose verifier in tools/verification/feature-005-governance.mts and reports/005-gitlab-automated-validation/governance.json
- [X] T015 Aggregate prerequisite, governance, contract, and package checks with exact local PASS semantics in tools/verification/005-setup-gate.mts and reports/005-gitlab-automated-validation/setup-gate.json

**Checkpoint**: `verify:005:setup` fails closed on stale or absent upstream evidence, validates the complete design contract offline, and leaves production/deployment authority denied.

---

## Phase 2: Shared blocking foundation

**Purpose**: Publish provider-neutral ports, immutable model/storage foundations, adapter boundaries, stateful Mock Hub support, and static runtime composition required by every story.

### Foundation tests — author and observe RED first

- [X] T016 [P] Validate all 31 schemas, offline references, declared positive/negative fixtures, rejection keywords, pilot JCS hash, and detached JUnit checksum in tests/contract/005/design-contracts.spec.ts
- [X] T017 [P] Validate the 21-operation OpenAPI surface, six AsyncAPI event payloads, digest pins, and schema parity in tests/contract/005/openapi-asyncapi.spec.ts
- [X] T018 [P] Validate exact operations for source-context.read@1.0.0, test-executor.trigger-status@1.0.0, artifact.ci-read@1.0.0, prohibited aliases, and additive qa.validation@1.2.0 compatibility in tests/contract/005/capability-compatibility.spec.ts
- [X] T019 [P] Add QA model tests for one Suite per Session, immutable three-role pins, shared MANUAL/AUTOMATED Attempt identity, contiguous numbering, sticky review, one terminal result, and human-only completion in tests/unit/005/automation-foundation.spec.ts
- [X] T020 [P] Enforce Core/QA/UI-to-GitLab, pure-adapter, persistence, no-Mattermost, static-composition, and no-dynamic-loading boundaries in tests/architecture/005-gitlab-boundaries.spec.ts and tests/architecture/005-gitlab-runtime-wiring.spec.ts
- [X] T021 [P] Add migration owner, order, collision, entity-parity, no-Core-DDL, and foreign-key-direction checks for QA 2050/2055/2060, GitLab 4000/4010/4020, and Mock 0060/0061/0062 in tests/integration/migrations/005-migration-registry.spec.ts
- [X] T022 [P] Add PostgreSQL 17/18 fresh, current-head, current-minus-one, repeat, failure-recovery, manual Attempt backfill, and Feature 002 byte-stability coverage in tests/integration/migrations/005-gitlab-automation.spec.ts
- [X] T023 [P] Test Connection/Profile discovery, numeric project/ref/dialect, CI Lint, distinct role identities, retention/retry separation, and fail-closed publication in tests/integration/005/gitlab-profile-lifecycle.spec.ts
- [X] T024 [P] Test auth leases, redirects, SSRF, redaction, caller authority, cross-project substitutions, forbidden input/job/path, and terminal 401/403 behavior in tests/integration/security/005/gitlab-auth-egress.spec.ts
- [X] T025 [P] Prove production/deploy denial occurs before secret resolution and produces zero provider calls in tests/integration/security/005/production-boundary.spec.ts
- [X] T026 [P] Add native-fetch REST v4 transport, auth, dialect, bounded-response, redaction, and forbidden retry/cancel/config/deploy API foundation conformance in tests/contract/005/gitlab-connector-conformance.spec.ts
- [X] T027 [P] Add stateful Mock Hub project/MR/commit fixture persistence, scoped control authorization, restart durability, and fail-closed unknown-route coverage without assuming story-specific trigger/result/webhook behavior in tests/contract/005/mock-hub-gitlab.spec.ts and tests/integration/005/mock-hub-gitlab.spec.ts
- [X] T028 [P] Prove capability-keyed worker ownership, reconstructible Redis hints, and fail-closed unknown command handling before story-specific effect recovery exists in tests/unit/005/command-recovery.spec.ts
- [X] T029 [P] Prove existing manual/Jira command paths and every prior composition selector remain unchanged in tests/integration/005/worker-command-routing.spec.ts

### Foundation implementation

- [X] T030 [P] Define and export provider-neutral source-context, test-executor, CI-artifact, and trusted-context ports in packages/connector-sdk/src/source-context.ts, packages/connector-sdk/src/test-executor.ts, packages/connector-sdk/src/ci-artifacts.ts, and packages/connector-sdk/src/index.ts
- [X] T031 [P] Add immutable competency-qa@1.2.0 and qa.validation@1.2.0 manifests alongside 1.0/1.1 in packages/competency-qa/src/manifest-v1.2.ts, packages/competency-qa/src/index.ts, packages/runtime-composition/src/qa/contributions.ts, and packages/runtime-composition/src/qa/composition.ts
- [X] T032 Narrow historical Feature 002 automated-mode exclusions to its V1 files/exports while preserving manual-path and dynamic-loading guards in tests/architecture/002-qa-pack-boundaries.spec.ts and tests/architecture/002-hard-boundaries.spec.ts
- [X] T033 [P] Implement provider-neutral Suite Binding and shared AutomationAttempt identity primitives without copying canonical Session/Plan Item models or changing MANUAL wire types in packages/competency-qa/src/domain/suite-binding.ts and packages/competency-qa/src/domain/automation-attempt.ts
- [X] T034 Implement the complete QA 2050 Suite, validation-report, configuration-pin, session-mode, and manual Attempt backfill migration in packages/competency-qa/src/persistence/migrations/2050-qa-automation-foundation.ts
- [X] T035 Implement the complete QA 2055 launch, Attempt, status, result, retry, artifact-membership, and mode-neutral evidence-FK migration after 2050 in packages/competency-qa/src/persistence/migrations/2055-qa-automation-execution.ts
- [X] T036 Implement the complete QA 2060 quarantine, sticky-review, freeze, and completion-guard migration after 2055 in packages/competency-qa/src/persistence/migrations/2060-qa-automation-review-quarantine.ts
- [X] T037 Register QA entity parity and generic attempt-aware repository shells for later story behavior in packages/competency-qa/src/persistence/entities.ts, packages/competency-qa/src/persistence/automation-suite.repository.ts, and packages/competency-qa/src/persistence/automation-execution.repository.ts
- [X] T038 Register QA migrations, persistence contributions, and node exports in packages/competency-qa/src/persistence/migrations/index.ts, packages/competency-qa/src/persistence/contributions.ts, and packages/competency-qa/src/node.ts
- [X] T039 [P] Implement injected native-fetch/auth/clock/secret/telemetry foundations and fail-closed instance dialect routing in packages/connector-gitlab/src/http/gitlab-rest-client.ts, packages/connector-gitlab/src/auth/gitlab-auth.ts, and packages/connector-gitlab/src/profile/gitlab-dialect.ts
- [X] T040 [P] Implement bounded discovery and Profile/Suite probe validation for source facts, CI Lint, non-production/no-deploy, result, and artifact policies in packages/connector-gitlab/src/profile/gitlab-discovery.ts and packages/connector-gitlab/src/profile/gitlab-profile-validator.ts
- [X] T041 Export only the three exact capabilities and prohibited-surface declaration from packages/connector-gitlab/src/manifest.ts and packages/connector-gitlab/src/index.ts
- [X] T042 Implement GitLab migration 4000 only for discovery snapshots, Profile validation details, and Suite probes that reference Core-owned Connection/Profile revisions in packages/connector-gitlab-persistence-typeorm/src/migrations/4000-gitlab-discovery-profiles.ts
- [X] T043 Implement GitLab migration 4010 for webhook normalization, observation history/heads, reconciliation cursors, and rate snapshots after 4000 in packages/connector-gitlab-persistence-typeorm/src/migrations/4010-gitlab-webhook-status-reconciliation.ts
- [X] T044 Implement GitLab migration 4020 for trigger reconciliation, invocation markers, artifact locators, and stream receipts after 4010 in packages/connector-gitlab-persistence-typeorm/src/migrations/4020-gitlab-trigger-artifacts.ts
- [X] T045 Register GitLab migrations/entity parity and scoped configuration, reconciliation, effect, and artifact repository shells for later story behavior in packages/connector-gitlab-persistence-typeorm/src/migrations/index.ts, packages/connector-gitlab-persistence-typeorm/src/entities.ts, packages/connector-gitlab-persistence-typeorm/src/repositories/gitlab-configuration.repository.ts, packages/connector-gitlab-persistence-typeorm/src/repositories/gitlab-reconciliation.repository.ts, packages/connector-gitlab-persistence-typeorm/src/repositories/gitlab-effect.repository.ts, packages/connector-gitlab-persistence-typeorm/src/repositories/gitlab-artifact.repository.ts, and packages/connector-gitlab-persistence-typeorm/src/index.ts
- [X] T046 Implement Mock Hub migration 0060 for GitLab project, MR, commit, pipeline, and job state in apps/mock-hub/src/persistence/migrations/0060-gitlab-state.ts
- [X] T047 Implement Mock Hub migration 0061 for machine results and artifact bytes/checksums after 0060 in apps/mock-hub/src/persistence/migrations/0061-gitlab-results-artifacts.ts
- [X] T048 Implement Mock Hub migration 0062 for effect audit, faults, webhook deliveries, and restart state after 0061 in apps/mock-hub/src/persistence/migrations/0062-gitlab-effects-faults-webhooks.ts
- [X] T049 Implement persistent Mock GitLab entities and repository behavior in apps/mock-hub/src/gitlab/state/gitlab.entities.ts and apps/mock-hub/src/gitlab/state/gitlab.repository.ts
- [X] T050 Implement narrow Mock GitLab protocol, control, scenario, webhook, and module surfaces in apps/mock-hub/src/gitlab/api/gitlab.controller.ts, apps/mock-hub/src/gitlab/control/gitlab-control.controller.ts, apps/mock-hub/src/gitlab/scenarios/gitlab-scenarios.ts, apps/mock-hub/src/gitlab/webhooks/gitlab-webhook-emitter.ts, and apps/mock-hub/src/gitlab/gitlab.module.ts
- [X] T051 Register Mock Hub entities/migrations/seed and module composition in apps/mock-hub/src/persistence/data-source.ts, apps/mock-hub/src/persistence/entities.ts, apps/mock-hub/src/persistence/seed.ts, and apps/mock-hub/src/app.module.ts
- [X] T052 Compose GitLab/Profile validation and register migration, entity, QA, and worker contributions statically in packages/runtime-composition/src/gitlab/composition.ts, packages/runtime-composition/src/gitlab/profile-validation.ts, packages/runtime-composition/src/migrations/composition.ts, packages/runtime-composition/src/persistence/entity-composition.ts, packages/runtime-composition/src/worker/contributions.ts, and packages/runtime-composition/src/index.ts
- [X] T053 Add qa-jira-gitlab-local plus optional combined/non-local selectors without rebinding existing keys in packages/runtime-composition/src/config/environment.ts and packages/runtime-composition/src/non-local.composition.ts
- [X] T054 Add deterministic local seed, readiness, migrate/seed CLI, GitLab lifecycle CLI, and scenario runner in packages/runtime-composition/src/seed/qa-jira-gitlab-local-seed.ts, packages/runtime-composition/src/bootstrap/local-readiness.ts, packages/runtime-composition/src/cli/migrate.ts, packages/runtime-composition/src/cli/seed.ts, tools/local/gitlab-cli.mts, and tools/local/gitlab-scenario.mts
- [X] T055 Wire PostgreSQL, Redis, Mock Hub, API, worker, and selected static composition in infra/compose/docker-compose.local.yml, apps/api/src/app.module.ts, apps/api/src/main.ts, apps/worker/src/app.module.ts, and apps/worker/src/main.ts
- [X] T056 Run the foundation suites RED-to-GREEN and persist task/source/runtime-bound evidence through tools/verification/005-foundation-checkpoint.mts to reports/005-gitlab-automated-validation/foundation.json

**Checkpoint**: The repository compiles with immutable 005 schemas and migrations, static qa-jira-gitlab-local composition, stateful Mock Hub, exact capability boundaries, and no trigger/result/webhook story behavior hidden in another layer.

---

## Phase 3: User Story 1 — Configure and create an automated validation Session (Priority: P1) 🎯 MVP

**Goal**: A HUMAN user can publish a compatible Suite Binding and create exactly one immutable READY AUTOMATED Session; incompatible configurations explain MANUAL_ONLY and preserve the manual flow.

**Independent Test**: Seed a published compatible Suite, create an automated Session, and verify one Session, one Plan Item, three exact role pins, immutable scope/target snapshots, and no GitLab trigger call. Invalid selectors create no partial rows; MANUAL_ONLY keeps manual QA usable; a post-start target change creates a linked Session rather than mutating history.

### Tests for User Story 1 — author and observe RED first

- [X] T057 [P] [US1] Validate availability, Suite Binding, validation-report, automated requirement/session/plan-item, target-snapshot schemas, and the eight US1 OpenAPI operations in tests/contract/005/us1-availability-suite-session.spec.ts
- [X] T058 [P] [US1] Validate the exact three-role qa.validation@1.2.0 intersection, FULL_QA versus MANUAL_ONLY, live availability, identity-slot separation, provider-neutral selectors, and bounded MR/commit/build real-adapter reads against stateful Mock Hub in tests/contract/005/us1-capability-profile-conformance.spec.ts and tests/contract/005/us1-gitlab-source-context-conformance.spec.ts
- [X] T059 [P] [US1] Add Suite state/version/content-hash, publication evidence, and immutable target/configuration-pin unit tests in packages/competency-qa/src/domain/suite-binding.spec.ts and packages/competency-qa/src/domain/test-session.spec.ts
- [X] T060 [P] [US1] Prove QA 2050 same-scope constraints, one Suite/Plan Item, three role pins, manual Attempt backfill, and append-only Suite/report history in tests/integration/migrations/005-qa-automation-foundation.spec.ts
- [X] T061 [P] [US1] Test DRAFT-to-VALIDATED-to-PUBLISHED, durable validate command/outbox processing with zero inline API-to-GitLab calls, INVALID report retention, stale-validation rejection, and successor retirement in tests/integration/005/us1-suite-publication.spec.ts
- [X] T062 [P] [US1] Test the automated-session transaction, immutable Project Integration Binding/Profile/Suite pins, build/commit/MR/environment/test-data/account-lease snapshots, one Plan Item, and rollback without partial rows in tests/integration/005/us1-automated-session.spec.ts
- [X] T063 [P] [US1] Test MANUAL_ONLY fallback, projection-only API reads with zero inline GitLab calls, and pre-start versus post-start target changes with TARGET_CHANGED lineage in tests/integration/005/us1-availability-and-target-lineage.spec.ts
- [X] T064 [P] [US1] Prove RBAC, entitlement, cross-project, suite/ref/environment/parameter, non-HUMAN, autonomous-origin, production, and deploy denials occur before secret resolution or trigger in tests/integration/security/005/us1-session-authorization.spec.ts
- [X] T065 [P] [US1] Add the independent API/PostgreSQL/Mock Hub journey from published Suite through FULL_QA to a READY automated Session, including negative allowlist and manual-flow cases, in tests/e2e/005-us1-automated-session.spec.ts

### Implementation for User Story 1

- [X] T066 [US1] Implement Suite Binding versions, state transitions, content hashes, and exact validation-evidence publication guards in packages/competency-qa/src/domain/suite-binding.ts
- [X] T067 [P] [US1] Extend automated RequiredSessionPlan, Session, Plan Item, and snapshot representations without widening published manual V1 contracts in packages/competency-qa/src/domain/required-session-plan.ts, packages/competency-qa/src/domain/test-session.ts, packages/competency-qa/src/domain/plan-item.ts, and packages/competency-qa/src/domain/snapshots.ts
- [X] T068 [US1] Implement scoped Suite header/version/report repositories with append-only history, CAS pointers, and exact report matching in packages/competency-qa/src/persistence/automation-suite.repository.ts
- [X] T069 [US1] Implement create/list/publish use cases plus durable Core command/outbox-based Suite validation executed only by a worker in packages/competency-qa/src/application/manage-automation-suite.ts, packages/runtime-composition/src/gitlab/suite-validation.ts, packages/runtime-composition/src/gitlab/suite-validation-worker.ts, and packages/runtime-composition/src/worker/contributions.ts
- [X] T070 [P] [US1] Complete GitLab project/version/permission discovery, CI lint/dry-run, Suite contract probes, and persistence exports through packages/connector-gitlab/src/profile/gitlab-discovery.ts, packages/connector-gitlab/src/profile/gitlab-profile-validator.ts, packages/connector-gitlab-persistence-typeorm/src/repositories/gitlab-configuration.repository.ts, and packages/connector-gitlab-persistence-typeorm/src/index.ts
- [X] T071 [P] [US1] Implement bounded MR, commit, and build reads against the Profile-selected numeric project and export the source-context handler in packages/connector-gitlab/src/source-context/gitlab-source-context.ts and packages/connector-gitlab/src/index.ts
- [X] T072 [US1] Derive FULL_QA or MANUAL_ONLY, independent live availability, stable reason codes, and launchPermitted from the current intersection in packages/competency-qa/src/application/automation-availability.ts and packages/runtime-composition/src/qa/automation-availability.ts
- [X] T073 [US1] Implement the single-transaction automated Session planner with allowlists, one Session/Plan Item, Project Integration Binding plus three role pins, complete target snapshots, audit/outbox facts, and closed QA exports but no GitLab call in packages/competency-qa/src/application/plan-automated-session.ts, packages/competency-qa/src/persistence/automated-session.uow.ts, packages/competency-qa/src/index.ts, and packages/competency-qa/src/node.ts
- [X] T074 [US1] Implement server-owned configuration/source resolution from authoritative projections, durable source-refresh command/worker handling, immutable target-change linked Sessions, and closed runtime exports without inline API-to-GitLab reads in packages/runtime-composition/src/gitlab/automated-session-service.ts, packages/runtime-composition/src/gitlab/source-context-worker.ts, packages/runtime-composition/src/worker/contributions.ts, and packages/runtime-composition/src/index.ts
- [X] T075 [US1] Expose exact availability, Suite administration, and automated Session operations while enqueueing validation without any inline GitLab call in apps/api/src/extensions/gitlab-automation/qa-automation-availability.controller.ts, apps/api/src/extensions/gitlab-automation/qa-automation-suite-bindings.controller.ts, apps/api/src/extensions/gitlab-automation/qa-automated-sessions.controller.ts, and apps/api/src/app.module.ts
- [X] T076 [P] [US1] Add deterministic discovery, project/MR/commit/build, CI-lint, denied-suite/environment, manual-only, and target-change scenarios in apps/mock-hub/src/gitlab/scenarios/gitlab-scenarios.ts
- [X] T077 [US1] Render availability reasons, Suite selection, bounded target/environment/parameters, immutable pins, and the preserved manual entry path in packages/competency-qa/src/ui/automated-session.tsx, packages/competency-qa/src/ui/contribution.tsx, apps/web/src/routes/qa/automated-session.tsx, and apps/web/src/App.tsx
- [X] T078 [US1] Register and execute the five US1 scenarios with exact persistence and zero-trigger assertions in tools/local/gitlab-scenario-catalog.mts, tools/verification/005-us1-checkpoint.mts, and reports/005-gitlab-automated-validation/us1.json

**Checkpoint**: `verify:005:us1` satisfies the independent test and is the MVP boundary. Pipeline launch is intentionally absent until US2.

---

## Phase 4: User Story 2 — Trigger exactly one pipeline for an authorized request (Priority: P1)

**Goal**: A confirmed HUMAN launch creates one shared Attempt and at most one provider pipeline for a Session plus idempotency key, including concurrent delivery and timeout-after-effect recovery.

**Independent Test**: Seed one READY automated Session and submit the same Session plus Idempotency-Key repeatedly and concurrently. Same-hash calls return one Attempt, Core command, effect identity, and pipeline; a different hash conflicts. After a possible provider acceptance, recovery performs lookup only; EXACT_ONE binds the receipt, while ZERO/MULTIPLE becomes visible ambiguity without a second POST.

### Tests for User Story 2 — author and observe RED first

- [X] T079 [P] [US2] Validate Attempt/status and test-executor schemas plus list, launch, detail, and status OpenAPI operations while rejecting client-supplied provider authority in tests/contract/005/us2-trigger-contract.spec.ts
- [X] T080 [P] [US2] Add launch-confirmation hash, request hash, effect key, immutable identity, contiguous numbering, and legal CREATED/TRIGGER_PENDING transition tests in packages/competency-qa/src/domain/automation-attempt.spec.ts
- [X] T081 [P] [US2] Validate QA 2055 actor-independent launch uniqueness, shared Attempt children, append-only status rows, and atomic command references in tests/integration/migrations/005-qa-automation-execution.spec.ts
- [X] T082 [P] [US2] Prove HUMAN confirmation with no second approval for an allowlisted non-production smoke launch, current If-Match, actor-independent same-key replay, different-hash conflict, and one Attempt/Core command/outbox transaction in tests/integration/005/us2-launch-idempotency.spec.ts
- [X] T083 [P] [US2] Prove concurrent API calls, duplicate worker delivery, and Redis-loss recovery preserve one request claim, Attempt, effect identity, and provider pipeline in tests/integration/005/us2-trigger-once.spec.ts
- [X] T084 [P] [US2] Test pure Profile-selected trigger/lookup mapping, classified pre-invocation transport failure, and EXACT_ONE, ZERO, and MULTIPLE vectors in tests/contract/005/us2-gitlab-trigger-conformance.spec.ts
- [X] T085 [P] [US2] Test bounded retry only for proven pre-marker/no-effect failure versus durable EFFECT_STARTED, timeout-after-possible-acceptance lookup-only recovery, bounded ambiguity, and prohibition of a second POST in tests/integration/005/us2-trigger-reconciliation.spec.ts
- [X] T086 [P] [US2] Prove stale/mismatched confirmation, non-HUMAN origin, revoked configuration, cross-project target, and arbitrary provider input create no claim, command, or effect in tests/integration/security/005/us2-launch-boundary.spec.ts
- [X] T087 [P] [US2] Add the full-process same-key replay and timeout-after-effect journey in tests/e2e/005-us2-trigger-once.spec.ts

### Implementation for User Story 2

- [X] T088 [US2] Implement immutable AutomationAttempt identity, launch confirmation/request commitments, lineage, numbering, and append-only launch status rules in packages/competency-qa/src/domain/automation-attempt.ts
- [X] T089 [US2] Implement actor-independent request-key claim/replay, Attempt reads, status history, and atomic repository operations over the complete 2055 schema in packages/competency-qa/src/persistence/automation-execution.repository.ts
- [X] T090 [US2] Implement exact confirmation validation and the atomic Session, Plan Item, launch claim, Attempt, Core command, qa.automation-attempt.created outbox transaction, and QA exports in packages/competency-qa/src/application/trigger-automation.ts, packages/competency-qa/src/application/domain-events.ts, packages/runtime-composition/src/gitlab/automation-launch-service.ts, packages/competency-qa/src/index.ts, and packages/competency-qa/src/node.ts
- [X] T091 [P] [US2] Implement Profile-only pipeline trigger payload construction and exact pipeline lookup without retry/cancel/delete/deploy operations and export both handlers in packages/connector-gitlab/src/pipeline/gitlab-pipeline-trigger.ts, packages/connector-gitlab/src/reconciliation/gitlab-trigger-reconciliation.ts, and packages/connector-gitlab/src/index.ts
- [X] T092 [US2] Implement invocation markers, lookup windows, match counts, confirmed receipts, project-scoped effect reconciliation, and persistence exports in packages/connector-gitlab-persistence-typeorm/src/repositories/gitlab-effect.repository.ts and packages/connector-gitlab-persistence-typeorm/src/index.ts
- [X] T093 [US2] Allow bounded retry only while durable state proves pre-marker/no-effect failure, persist effectInvocationStartedAt before possible provider effect, route marked recovery to lookup only, attach only EXACT_ONE receipts, and publish closed runtime exports in packages/runtime-composition/src/gitlab/automation-worker.ts, packages/runtime-composition/src/gitlab/composition.ts, packages/runtime-composition/src/worker/contributions.ts, packages/runtime-composition/src/index.ts, and apps/worker/src/app.module.ts
- [X] T094 [P] [US2] Implement Mock pipeline trigger/list state, deterministic effect markers, distinct timeout-before-invocation and timeout-after-possible-effect faults, exact call audit, and ZERO/MULTIPLE lookup scenarios in apps/mock-hub/src/gitlab/api/gitlab.controller.ts, apps/mock-hub/src/gitlab/control/gitlab-control.controller.ts, apps/mock-hub/src/gitlab/state/gitlab.repository.ts, and apps/mock-hub/src/gitlab/scenarios/gitlab-scenarios.ts
- [X] T095 [US2] Expose launch/replay and Attempt list/detail/status operations through a closed composed query export with Idempotency-Key, If-Match, 200/201, and conflict semantics in packages/runtime-composition/src/gitlab/automation-attempt-query.ts, packages/runtime-composition/src/index.ts, apps/api/src/extensions/gitlab-automation/qa-automation-attempts.controller.ts, and apps/api/src/app.module.ts
- [X] T096 [US2] Render the server-issued confirmation unchanged, current ETag, Attempt lineage/status, and visible ambiguity without provider authority fields in packages/competency-qa/src/ui/automated-session-executor.tsx and apps/web/src/routes/qa/automated-session.tsx
- [X] T097 [US2] Register all seven documented US2 IDs—trigger-once, command-replay, stale-confirmation, mismatched-confirmation, timeout-after-trigger, lookup-zero, and lookup-multiple—in tools/local/gitlab-scenario-catalog.mts and tools/local/gitlab-scenario.mts
- [X] T098 [US2] Execute the US2 scenarios and persist exact one-claim, one-effect, one-pipeline evidence through tools/verification/005-us2-checkpoint.mts to reports/005-gitlab-automated-validation/us2.json

**Checkpoint**: `verify:005:us2` satisfies the independent test, including a durable post-marker recovery path that cannot issue another trigger POST.

---

## Phase 5: User Story 3 — Normalize technical results and prepare HUMAN review (Priority: P1)

**Goal**: Authoritative GitLab reads produce immutable normalized Attempt results and scoped artifacts; policy may append at most one eligible infra retry; every terminal path stops at sticky REVIEW_REQUIRED for HUMAN review.

**Independent Test**: Run PASS, assertion failure, infrastructure failure, timeout, cancellation, schema drift, checksum mismatch, quarantine, retry, and review-freeze scenarios. Verify assertion no-retry, exactly one allowlisted infra successor, immutable lineage, assertion-to-PASS FLAKY_SUSPECTED, scoped artifact proxying, sticky review, and zero automatic Outcome/Verdict/Jira transition.

### Tests for User Story 3 — author and observe RED first

- [X] T099 [P] [US3] Add result-normalization matrices and real-adapter/stateful-Mock conformance for authoritative pipeline.read, retried jobs, machine results, artifact metadata/stream, PASS, assertion, infra, timeout, cancellation, schema drift, target mismatch, and checksum mismatch in tests/unit/005/automation-result-reducer.spec.ts and tests/contract/005/us3-gitlab-result-artifact-conformance.spec.ts
- [X] T100 [P] [US3] Add retry/flaky truth tables for assertion no-retry, one allowlisted infra retry, second-retry denial, auth/policy denial, explicit HUMAN rerun confirmation/CAS, and retry-or-rerun-to-PASS disposition in tests/unit/005/automation-retry-policy.spec.ts
- [X] T101 [P] [US3] Author sticky review, complete Attempt-set CAS/freeze, duplicate terminal event, atomic retry, lineage, and review-versus-rerun PostgreSQL coverage in tests/integration/005/automation-review-readiness.spec.ts and tests/integration/005/us3-result-retry-review.spec.ts
- [X] T102 [P] [US3] Author artifact checksum/expiry/classification/isolation coverage and the full real-adapter/stateful-Mock technical-result, retry-job, artifact-stream, and HUMAN-review journey in tests/integration/security/005/artifact-access.spec.ts and tests/e2e/005-us3-technical-result-review.spec.ts

### Implementation for User Story 3

- [X] T103 [US3] Extend AutomationAttempt with immutable terminal result/status types, closed technical outcomes, contiguous lineage, and terminal invariants in packages/competency-qa/src/domain/automation-attempt.ts
- [X] T104 [US3] Implement the deterministic QA-owned retry matrix, atomic successor specification, and transactional qa.automation-retry.decided event in packages/competency-qa/src/application/automation-retry-policy.ts and packages/competency-qa/src/application/domain-events.ts
- [X] T105 [US3] Implement authoritative terminal synchronization, schema/target/checksum validation, same-scope Core ArtifactReference registration, QA artifact memberships, ASSERTION_FAILED-to-PASS FLAKY_SUSPECTED derivation, sticky REVIEW_REQUIRED transition, and transactional qa.automation-attempt.status-observed, qa.automation-attempt.completed, and qa.automation-artifact.registered events in packages/competency-qa/src/application/sync-automation-result.ts and packages/competency-qa/src/application/domain-events.ts
- [X] T106 [US3] Implement review blockers, complete Attempt-set hashing, PRODUCT/INFRA/INCONCLUSIVE/DUPLICATE/ACCEPTED_RISK taxonomy, high/critical/waiver reviewer policy, mandatory HUMAN resolution through existing QaFlakyDispositionBasis, and explicit HUMAN rerun semantics in the existing launch path with fresh confirmation/resource version/request key and a new Attempt/command/effect from REVIEW_REQUIRED; make rerun-first stale an older review CAS and review-first reject rerun or require a linked REVIEW_FROZEN Session while preserving MANUAL behavior in packages/competency-qa/src/application/automation-review-readiness.ts, packages/competency-qa/src/application/trigger-automation.ts, packages/competency-qa/src/application/record-plan-item-result.ts, packages/competency-qa/src/application/review-manual-session.ts, packages/competency-qa/src/application/session-review-preconditions.ts, packages/runtime-composition/src/gitlab/automation-launch-service.ts, and apps/api/src/extensions/gitlab-automation/qa-automation-attempts.controller.ts
- [X] T107 [US3] Complete immutable result/status/artifact persistence plus one atomic retry UoW that records the decision, causal HUMAN authorization basis, deterministic automatic launch claim, successor Attempt, fresh Core command/effect key/outbox, and sticky Session state over QA 2055 in packages/competency-qa/src/persistence/automation-execution.repository.ts, packages/competency-qa/src/persistence/manual-execution.repository.ts, packages/competency-qa/src/persistence/result-evidence.uow.ts, packages/competency-qa/src/index.ts, and packages/competency-qa/src/node.ts
- [X] T108 [US3] Implement accountable quarantine owner/reason/expiry revisions, activation/lift/clock expiry, original-failure preservation, policy guards, sticky completion, freeze persistence, and transactional qa.automation-quarantine.changed outbox emission over QA 2060 in packages/competency-qa/src/application/automation-quarantine.ts and packages/competency-qa/src/application/domain-events.ts
- [X] T109 [P] [US3] Implement project-scoped authoritative pipeline/job reads and safe provider-status mapping in packages/connector-gitlab/src/pipeline/gitlab-pipeline-reader.ts
- [X] T110 [P] [US3] Implement exact machine-result download/validation and fail-closed normalization without log-text inference in packages/connector-gitlab/src/pipeline/gitlab-result-normalizer.ts
- [X] T111 [US3] Implement artifact.metadata refresh, provider/clock expiry classification, and authorized checksum-verifying artifact.stream with redirect-host enforcement and export the T109–T111 result/artifact handlers in packages/connector-gitlab/src/artifacts/gitlab-ci-artifacts.ts and packages/connector-gitlab/src/index.ts
- [X] T112 [US3] Implement append-only locator revisions for AVAILABLE, EXPIRED, MISSING, and CHECKSUM_MISMATCH that preserve descriptor metadata/checksum plus stream receipts without bytes or raw-locator exposure, and export the persistence handler in packages/connector-gitlab-persistence-typeorm/src/repositories/gitlab-artifact.repository.ts and packages/connector-gitlab-persistence-typeorm/src/index.ts
- [X] T113 [US3] Wire normalized status/result/artifact facts into a transactional QA consumer, resolve same-scope Core ArtifactReferences, refresh/persist expiry on metadata or stream access, dispatch ObjectStoragePort reads to the GitLab adapter, atomically enqueue an eligible successor with a fresh effect key, publish all six exact Feature 005 AsyncAPI envelopes from durable outbox rows, and register closed runtime/worker exports in packages/runtime-composition/src/gitlab/result-sync.ts, packages/runtime-composition/src/gitlab/artifact-storage.ts, packages/runtime-composition/src/gitlab/composition.ts, packages/runtime-composition/src/qa/platform-adapters.ts, packages/runtime-composition/src/worker/contributions.ts, packages/runtime-composition/src/index.ts, and apps/worker/src/app.module.ts
- [X] T114 [US3] Extend scoped Attempt detail, status revisions, result, retry decision, and Session artifact metadata query reads and wire the existing Core ArtifactsController/ArtifactService stream path in packages/runtime-composition/src/gitlab/automation-attempt-query.ts, apps/api/src/extensions/gitlab-automation/qa-automation-attempts.controller.ts, and apps/api/src/app.module.ts
- [X] T115 [US3] Expose and statically register quarantine list/get/revisions/activate/lift operations with HUMAN authorization and CAS in apps/api/src/extensions/gitlab-automation/qa-automation-quarantines.controller.ts and apps/api/src/app.module.ts
- [X] T116 [US3] Extend and statically register the optional qa-result-review-prep proposalOnly path with summaries, shared-taxonomy Finding drafts, attemptSetHash, evidence refs, quarantine warnings, no artifact bytes, and no Mattermost/GitLab compile dependency in packages/competency-qa/src/skills/qa-result-review-prep.ts, packages/runtime-composition/src/hermes/qa-automation-review-packet.ts, packages/runtime-composition/src/hermes/qa-proposal-skill-contribution.ts, packages/runtime-composition/src/hermes/composition.ts, and packages/runtime-composition/src/index.ts
- [X] T117 [P] [US3] Add Attempt timeline, artifact availability, quarantine warnings, flaky disposition, and HUMAN review blockers to packages/competency-qa/src/ui/automated-session-executor.tsx
- [X] T118 [US3] Add deterministic timeout/cancellation fixtures and register all ten documented US3 IDs—pass-review-required, assertion-failed-no-auto-retry, allowlisted-infra-retry, unknown-infra-no-retry, explicit-rerun-pass-flaky, result-schema-drift, artifact-checksum-mismatch, quarantine-lifecycle, review-packet-proposal-only, and post-review-linked-session—in apps/mock-hub/src/gitlab/scenarios/gitlab-scenarios.ts and tools/local/gitlab-scenario-catalog.mts
- [X] T119 [US3] Drive the pre-authored PostgreSQL suite GREEN for duplicate terminal events, atomic retry decision/claim/successor/Core-command/fresh-effect chain, immutable lineage, shared Finding taxonomy, reviewer enforcement, sticky review, and review/rerun races in tests/integration/005/us3-result-retry-review.spec.ts
- [X] T120 [US3] Drive the pre-authored API/worker/Mock Hub journey GREEN for all documented US3 scenarios and prove technical PASS never signs a verdict or mutates Jira in tests/e2e/005-us3-technical-result-review.spec.ts
- [X] T121 [US3] Execute exact normalized-result, retry, artifact, quarantine, and review assertions through tools/verification/005-us3-checkpoint.mts to reports/005-gitlab-automated-validation/us3.json

**Checkpoint**: `verify:005:us3` satisfies the independent test and proves technical execution stops before human adjudication.

---

## Phase 6: User Story 4 — Recover from loss, duplication, and GitLab outages (Priority: P1)

**Goal**: Signed webhook hints and bounded polling converge to authoritative monotonic state after loss, duplication, reordering, or restarts, while GitLab degradation never blocks manual QA or Jira.

**Independent Test**: Run lost, duplicate, and out-of-order webhook, full outage/manual-flow, auth-revoked, and rate-limit recovery scenarios. Verify webhook-as-hint semantics, authoritative convergence, restart durability, closed 401/403 degradation, bounded read retry, manual/Jira continuity, and no automatic Jira close or QA verdict.

### Tests for User Story 4 — author and observe RED first

- [X] T122 [P] [US4] Author Standard Webhooks HMAC, freshness, replay, duplicate, same-ID/different-body, oversized-body, and cross-project attack coverage in tests/unit/005/gitlab-webhook-verifier.spec.ts and tests/integration/security/005/webhook-ingress.spec.ts
- [X] T123 [P] [US4] Author monotonic observation, lost-event repair, 401/403 degradation, bounded 429/5xx backoff, restart durability, manual continuity, and browser-state coverage in tests/unit/005/gitlab-reconciliation.spec.ts, tests/integration/005/us4-outage-reconciliation.spec.ts, and tests/e2e/005-us4-outage-recovery.spec.ts

### Implementation for User Story 4

- [X] T124 [US4] Implement durable webhook receipt, observation, cursor, rate, fencing, same-ID/different-body quarantine behavior, and persistence exports over GitLab 4010 in packages/connector-gitlab-persistence-typeorm/src/repositories/gitlab-reconciliation.repository.ts and packages/connector-gitlab-persistence-typeorm/src/index.ts
- [X] T125 [P] [US4] Implement raw-byte limits, content-type checks, exact Connection/project routing, Standard Webhooks HMAC-SHA256, freshness/replay defense, and safe normalization in packages/connector-gitlab/src/webhooks/gitlab-webhook-normalizer.ts
- [X] T126 [P] [US4] Implement monotonic observation reduction, authoritative pipeline.read repair, and bounded polling cursors in packages/connector-gitlab/src/reconciliation/gitlab-reconciliation.ts
- [X] T127 [US4] Implement closed 401/403 and server-hint-aware bounded 429/5xx health/backoff without retrying a post-marker write and export the T125–T127 webhook/reconciliation handlers in packages/connector-gitlab/src/reconciliation/gitlab-rate-health.ts and packages/connector-gitlab/src/index.ts
- [X] T128 [US4] Expose and statically register an authenticated ACK-only webhook endpoint with no inline provider read in apps/api/src/extensions/gitlab-automation/gitlab-webhook.controller.ts and apps/api/src/app.module.ts
- [X] T129 [US4] Wire webhook inbox, authoritative-read outbox, poll scheduler, worker fencing, restart-safe recovery, and closed runtime/worker exports in packages/runtime-composition/src/gitlab/reconciliation-worker.ts, packages/runtime-composition/src/gitlab/composition.ts, packages/runtime-composition/src/worker/contributions.ts, packages/runtime-composition/src/index.ts, and apps/worker/src/app.module.ts
- [X] T130 [US4] Add derived Connection freshness/health and execution activity, feed them through composed availability/Attempt query ports into API reads, and keep structural FULL_QA distinct from live availability in packages/runtime-composition/src/gitlab/operational-health.ts, packages/runtime-composition/src/qa/automation-availability.ts, packages/runtime-composition/src/gitlab/automation-attempt-query.ts, packages/runtime-composition/src/gitlab/composition.ts, packages/runtime-composition/src/index.ts, apps/api/src/extensions/gitlab-automation/qa-automation-availability.controller.ts, and apps/api/src/extensions/gitlab-automation/qa-automation-attempts.controller.ts
- [X] T131 [P] [US4] Surface pending/error freshness and preserved manual-flow availability in packages/competency-qa/src/ui/automated-session-executor.tsx
- [X] T132 [US4] Implement signed/duplicate/out-of-order/lost webhook delivery plus REST 401/403 auth-revoked, 429 rate-limit, 5xx outage, and persisted one-shot restart faults in apps/mock-hub/src/gitlab/webhooks/gitlab-webhook-emitter.ts, apps/mock-hub/src/gitlab/api/gitlab.controller.ts, apps/mock-hub/src/gitlab/control/gitlab-control.controller.ts, and apps/mock-hub/src/gitlab/state/gitlab.repository.ts
- [X] T133 [US4] Register all six US4 scenarios and their persisted fault state in apps/mock-hub/src/gitlab/scenarios/gitlab-scenarios.ts and tools/local/gitlab-scenario-catalog.mts
- [X] T134 [US4] Drive the pre-authored integration suite GREEN for webhook convergence, worker/Redis/Mock Hub restart durability, manual Jira independence, and health recovery in tests/integration/005/us4-outage-reconciliation.spec.ts
- [X] T135 [US4] Drive the pre-authored security suite GREEN for invalid signature, stale timestamp, replay, oversized body, cross-project, and changed-body delivery attacks in tests/integration/security/005/webhook-ingress.spec.ts
- [X] T136 [US4] Drive the pre-authored browser/E2E suite GREEN for visible pending/error state and uninterrupted manual Session/Jira flow during outage in tests/e2e/005-us4-outage-recovery.spec.ts
- [X] T137 [US4] Execute exact convergence, degradation, restart, and manual-continuity assertions through tools/verification/005-us4-checkpoint.mts to reports/005-gitlab-automated-validation/us4.json

**Checkpoint**: `verify:005:us4` satisfies the independent test and shows recovery is monotonic, durable, bounded, and non-adjudicative.

---

## Phase 7: Polish, cross-cutting validation, and handoff

**Purpose**: Close contract, migration, architecture, security, SLO, local-process, traceability, pilot, and release evidence without granting production or deployment authority from local conformance.

- [X] T138 [P] Complete registry/API/event snapshot drift, exact examples, digest pins, contribution order 500, and unchanged Feature 002 MANUAL contract coverage in tests/contract/005/schema-registry-parity.spec.ts
- [X] T139 [P] Complete dependency-boundary coverage for forbidden GitLab imports, persistence ownership, prohibited operations, and dynamic loading in tests/architecture/005-gitlab-boundaries.spec.ts
- [X] T140 Add the aggregate PostgreSQL 17/18 fresh/upgrade/repeat/current-minus-one/failure-recovery matrix for all nine Feature 005 migrations in tests/integration/005-migration-matrix.spec.ts
- [X] T141 [P] Add aggregate RBAC, entitlement, tool-grant, cross-scope, injection, redaction, artifact-access, and zero-call production/deploy security coverage in tests/integration/security/005/production-and-scope-boundary.spec.ts
- [X] T142 [P] Author virtual-clock SLO, full trigger/result/dedupe/ambiguity/queue/retry/flaky/webhook/artifact/policy-denial metric coverage, bounded correlation labels, and secret/untrusted-text redaction verification in tests/integration/005/observability-slo.spec.ts
- [X] T143 Complete the stateful local scenario catalog/CLI, reject undocumented or missing identifiers, and emit reports/005-gitlab-automated-validation/documented-scenarios.json from tools/local/gitlab-scenario-catalog.mts
- [X] T144 Implement isolated child-process local smoke with API/worker/Mock Hub restarts, PostgreSQL inspection, clean shutdown, and output reports/005-gitlab-automated-validation/smoke.json from tools/smoke/feature-005.mts
- [X] T145 [P] Implement the visible HUMAN review browser journey process check in tools/smoke/feature-005-browser-process.mts
- [X] T146 Implement documented command, scenario, and fresh-report verification in tools/verification/005-quickstart.mts and emit reports/005-gitlab-automated-validation/quickstart.json
- [X] T147 Implement PostgreSQL matrix enforcement in tools/ci/verify-005-migrations.mts and emit reports/005-gitlab-automated-validation/migrations.json
- [X] T148 Implement bounded GitLab automation metrics/correlation instrumentation across launch, result, retry, reconciliation, artifact, and denial paths and generate reports/005-gitlab-automated-validation/observability.json from packages/runtime-composition/src/gitlab/observability.ts, packages/runtime-composition/src/gitlab/automation-worker.ts, packages/runtime-composition/src/gitlab/result-sync.ts, packages/runtime-composition/src/gitlab/reconciliation-worker.ts, packages/runtime-composition/src/gitlab/artifact-storage.ts, packages/runtime-composition/src/gitlab/composition.ts, packages/runtime-composition/src/index.ts, and tools/verification/feature-005-observability.mts
- [X] T149 Implement secret-free pilot metadata parsing, semantic hashing, and fail-closed contour/purpose validation in tools/verification/feature-005-nonprod-metadata-lib.mts and emit reports/005-gitlab-automated-validation/nonprod-metadata.json
- [X] T150 [P] Add valid local/live metadata and invalid HTTPS, purpose, production, rehearsal, and release fixtures in tests/fixtures/005/gitlab-pilot-metadata.local.v1.json and tests/fixtures/005/gitlab-pilot-metadata.live.invalid.v1.json
- [X] T151 Implement opt-in live non-production GitLab verification with honest SKIPPED_GATED outcomes when inputs are absent in tools/verification/feature-005-nonprod.mts and emit reports/005-gitlab-automated-validation/nonprod.json
- [X] T152 Implement combined local Jira, GitLab, and Mattermost rehearsal evidence requiring mattermostOutageDegradation=PASS with Jira/QA active and delivery pending, limiting authority to PILOT_REHEARSAL_ONLY, in tools/verification/feature-005-pilot-rehearsal.mts and emit reports/005-gitlab-automated-validation/pilot-rehearsal.json
- [X] T153 Implement the deployment release gate requiring DEVELOPMENT/TEST HTTPS metadata, fresh 003/004/005 evidence, mattermostOutageDegradation=PASS, and an exact successful rehearsal receipt/hash in tools/verification/feature-005-pilot-release.mts and emit reports/005-gitlab-automated-validation/pilot-release.json
- [X] T154 Implement FR-001–FR-025, SC-001–SC-007, and documented-scenario traceability over fresh task/source/contract/runtime/report hashes in tools/verification/feature-005-trace.mts and emit reports/005-gitlab-automated-validation/traceability.json
- [X] T155 Implement immutable child-report aggregation and final local evidence validation in tools/verification/feature-005-evidence.mts and emit reports/005-gitlab-automated-validation/evidence.json
- [X] T156 Implement aggregate verify:005, plan mode, CI, and smoke orchestration without hand-editable PASS reports in tools/verification/feature-005-gate.mts
- [X] T157 Finalize every Feature 005 test, verify, scenario, local contour, pilot, smoke, trace, and CI entrypoint in package.json
- [X] T158 Update executable commands, scenario expectations, report semantics, migration inventory, observability, and gated pilot instructions in specs/005-gitlab-automated-validation/quickstart.md
- [X] T159 Run the complete local gate and atomically generate fresh final evidence in reports/005-gitlab-automated-validation/final-gate.json

**Checkpoint**: Local completion is `qa-jira-gitlab-local`; live GitLab may be PASS or SKIPPED_GATED, Mattermost may be PASS or NOT_REQUESTED, production remains DENIED, and deploymentApproval remains LOCAL_CONFORMANCE_ONLY. Only the separate pilot release gate can emit PILOT_APPROVED after all declared prerequisites pass.

---

## Dependencies and execution order

### Phase dependencies

- **Phase 1 → Phase 2**: The setup gate and immutable contract contribution must pass before model, storage, or runtime work.
- **Phase 2 → US1**: Every story depends on the shared ports, full one-time migrations, static composition, and stateful Mock Hub foundation.
- **US1 → US2**: Pipeline launch consumes an independently seedable READY automated Session and its immutable pins.
- **US2 → US3**: Result synchronization consumes the shared Attempt identity, durable launch claim, and authoritative pipeline receipt/read path.
- **US2 → US4**: Webhook and polling infrastructure can proceed in parallel with most US3 work after the launch/read identity exists; terminal recovery acceptance also consumes US3 result synchronization.
- **US1–US4 → Phase 7**: Final traceability and evidence require every story checkpoint to be fresh and PASS.

### User-story dependency graph

`Setup → Foundation → US1 → US2 → US3`

`                              └→ US4 ─┘`

### Within each story

1. Author the listed tests and verify the intended RED state.
2. Implement domain/application behavior before transport and UI.
3. Add adapter, persistence, runtime, and API/UI integration in ownership order.
4. Run the story checkpoint and bind its report to source, contracts, runtime, and scenario hashes.

---

## Parallel execution examples

### User Story 1

- In parallel: T057–T065 test authoring.
- After domain primitives: T070, T071, and T076 own separate GitLab/Mock files and can run in parallel.
- Then serialize T072–T075 around shared session/runtime/API behavior before T077–T078.

### User Story 2

- In parallel: T079–T087 test authoring.
- After T090 defines the launch transaction: T091 and T094 can proceed in parallel.
- Serialize T092–T093 before API/UI integration and T098 evidence.

### User Story 3

- In parallel: T099–T102 test authoring.
- In parallel after QA result contracts settle: T109, T110, and T117; then export the result/artifact handlers in T111 and register the optional Hermes path in T116.
- Serialize T104–T108 and T112–T115 before T119–T121.

### User Story 4

- In parallel: T122–T123 test authoring.
- In parallel after T124 establishes durable storage semantics: T125, T126, and T131; then export the webhook/reconciliation handlers in T127.
- Serialize T128–T130 before full restart/security/E2E verification T134–T137.

---

## Implementation strategy

### MVP first

1. Complete Phase 1 and Phase 2.
2. Complete US1 through T078.
3. Validate the MVP: compatible configuration creates one immutable automated Session with zero pipeline calls; MANUAL_ONLY remains usable.
4. Demonstrate and review this boundary before adding provider side effects.

### Incremental delivery

1. **US1** adds trustworthy configuration and Session planning.
2. **US2** adds exactly-once launch and ambiguous-write reconciliation.
3. **US3** adds normalized evidence, bounded retry, quarantine, and HUMAN review readiness.
4. **US4** adds durable outage recovery and manual-flow continuity.
5. **Phase 7** proves the combined system and keeps pilot/deployment authority fail-closed.

### Completion rules

- A task is complete only when its named tests pass and no earlier feature contract regresses.
- Applied migrations are immutable; corrections require a later migration and design review.
- No technical result may sign a Session Outcome/Verdict or transition Jira automatically.
- No production/deploy operation, secret, raw artifact locator, or provider-controlled authority may enter the public surface.
- Reports are generated by their verifier from fresh evidence; planning files or manually edited JSON cannot produce PASS.

---

## Task summary

- **Total tasks**: 159
- **Setup**: 15 tasks
- **Shared foundation**: 41 tasks
- **US1**: 22 tasks
- **US2**: 20 tasks
- **US3**: 23 tasks
- **US4**: 16 tasks
- **Polish and handoff**: 22 tasks
- **MVP scope**: T001–T078 (Setup + Foundation + US1)
