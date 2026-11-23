# Tasks: Project onboarding, evidence and security

**Audit status (2026-09-07):** 184/184 tasks are marked complete. T142 has durable HTTP/DB/crypto/browser proof. T163 has durable suspend/resume and current approval/restart/rollback proof. T091 has durable binding publish/retire/rollback and pilot activation with CAS, exact current approval, Core revision compatibility, gate/lease checks, audit rollback and restart proof on PostgreSQL 17/18. T155 has an independent HTTP/PostgreSQL/child-worker journey: suspend after claim, zero denied effects, restart, distinct approved resume and exactly one newly admitted HTTP effect. T071 is now closed: durable registry, entitlements, QA resources/leases, validation/acceptance/publication/L0, scoped requested probes and FULL_QA evaluation are exposed through registered HTTP controllers. The additive onboarding OpenAPI 1.1 boundary validates all 18 operations, DTO/status/ETag/CAS and immutable replay on PostgreSQL 17/18; original 1.0 design files and legacy `/v1` responses remain unchanged. Acceptance schema v2 and canonical Core ref headers have an explicit [compatibility policy](../../docs/runbooks/onboarding-openapi-convergence.md). Regression: 165/165 tests in 71 files; [closure evidence](../../reports/project/published-onboarding-http.json). T059 is now closed: a new project reaches manual Session RUNNING through HTTP and separate API/worker processes on PostgreSQL 17/18; durable probes, restart, shared Context v2 identity, immutable target snapshot, audit rollback and MANUAL_ONLY automation refusal are verified. Regression: 184/184 tests in 76 files; [T059 evidence](../../reports/project/manual-onboarding-journey.json) and [deployment/upgrade guide](../../docs/runbooks/manual-onboarding-journey.md). T106 is now closed: independent API processes prove current multi-principal catalog/search/queue/event/Work Item/artifact/evidence/export isolation on PostgreSQL 17/18, including stricter session ceilings, HTTP revocation, cursor replay and restarts. Regression: 723/723 tests in 197 files; [T106 evidence](../../reports/project/project-scope-journey.json) and [deployment guide](../../docs/runbooks/project-scope-journey.md). T176 is now closed: a fresh isolated Compose runtime passes nine stages, seven actual service restarts, one worker-owned Jira effect/Work Item, event redelivery, signature/S3 persistence, live Chromium export and scoped cleanup. Regression: 215/215 tests in 91 files; [T176 evidence](../../reports/project/onboarding-compose-smoke.json) and [CI/deployment runbook](../../docs/runbooks/onboarding-compose-smoke.md). Resume currently returns MANUAL_ONLY; automatic FULL_QA restoration is not claimed. Corporate composition remains 008/T025. See [onboarding HTTP runbook](../../docs/runbooks/onboarding-http.md), [binding runbook](../../docs/runbooks/binding-http.md), [operations runbook](../../docs/runbooks/project-operations-http.md) and [deployment checklist](../../docs/runbooks/pilot-deployment-checklist.md).

**Input**: Design documents from `/specs/007-project-onboarding-evidence-security/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`, Constitution 2.0.0

**Tests**: Required. The specification defines an independent test for every user story, and the plan requires contract, unit, architecture, PostgreSQL migration, integration, security, concurrency, recovery, browser, smoke and traceability gates. Tests are authored first and must fail for the intended missing behavior before implementation.

**Organization**: Tasks are grouped by shared setup/foundation and the five P1 user stories in specification order. Core migrations `0150/0155/0160` and QA migrations `2080/2085` are created once with complete additive shapes in Phase 2; later phases implement behavior without rewriting applied migrations.

## Format: `[ID] [P?] [Story?] Description with file path`

- **[P]**: Can run in parallel after its phase prerequisites because it owns different files and has no dependency on an incomplete task.
- **[US1]–[US5]**: Maps Scenario 1 through Scenario 5 in `spec.md`; story labels appear only in story phases.
- Every task names the concrete file or files it owns.

---

## Phase 1: Setup and fail-closed entry gates

**Purpose**: Bind Feature 007 to fresh Feature 006 evidence, freeze design contracts, define runnable commands and reject unsupported corporate/production assumptions before runtime work.

- [X] T001 [P] Add missing, stale, source-drift, contract-drift, migration-drift and Feature 001–006 compatibility vectors in tests/contract/007/prerequisite-gate.spec.ts
- [X] T002 [P] Add Constitution 2.0 ownership, Jira authority, Project-scope, exact-approval, human-verdict, evidence-integrity, local-first and no-production-action vectors in tests/contract/007/governance-gate.spec.ts
- [X] T003 Replace Core-0140/QA-2070 tail assumptions with additive owner-range, monotonic-order, immutability and current registry assertions in tests/integration/002-qa-foundation-composition.spec.ts, tests/integration/migrations/002-qa-migration-order.spec.ts and tests/integration/migrations/us2-composition.spec.ts
- [X] T004 [P] Add deterministic positive and negative contract fixtures in specs/007-project-onboarding-evidence-security/contracts/examples/positive/manual-onboarding-package.json, specs/007-project-onboarding-evidence-security/contracts/examples/positive/full-qa-evidence-package.json, specs/007-project-onboarding-evidence-security/contracts/examples/positive/suspended-project.json, specs/007-project-onboarding-evidence-security/contracts/examples/negative/secret-bearing-environment.json, specs/007-project-onboarding-evidence-security/contracts/examples/negative/production-target.json, specs/007-project-onboarding-evidence-security/contracts/examples/negative/mutable-evidence-correction.json and specs/007-project-onboarding-evidence-security/contracts/examples/negative/self-approved-resume.json
- [X] T005 Register the immutable Feature 007 design-contract contribution at order 700 in packages/platform-contracts/src/schema-contributions.ts
- [X] T006 Extend deterministic API snapshot generation with the Feature 007 OpenAPI document and schema root in tools/contracts/build-openapi-snapshots.mts
- [X] T007 Implement strict offline JSON Schema 2020-12, OpenAPI 3.1, AsyncAPI 3.0, example, local-ref, duplicate-key, JCS-digest and closed-operation validation in tools/contracts/verify-007-contracts.mts
- [X] T008 [P] Define the five exact quickstart scenario IDs and reject unknown or duplicate IDs in tools/local/onboarding-scenario-catalog.mts
- [X] T009 Wire test:contract:007, test:architecture:007, test:unit:007, test:concurrency:007, test:integration:007, test:security:007, test:e2e:007, test:browser:007, verify:007:*, local:onboarding:*, onboarding:scenario, smoke:007, trace:007 and ci:007 entrypoints in package.json and tools/ci/feature-007-tests.mts
- [X] T010 [P] Implement the source/contract/migration-bound Feature 006 prerequisite verifier and atomic report writer in tools/verification/feature-007-prerequisites.mts and reports/007-project-onboarding-evidence-security/prerequisites.json
- [X] T011 [P] Implement the authority, ownership, corporate-input `BLOCKED_INPUT`/`SKIPPED_GATED` and production-boundary verifier in tools/verification/feature-007-governance.mts and reports/007-project-onboarding-evidence-security/governance.json
- [X] T012 Aggregate prerequisites, governance, contracts, contour and package checks into a fail-closed setup checkpoint in tools/verification/007-setup-gate.mts and reports/007-project-onboarding-evidence-security/setup-gate.json

**Checkpoint**: `verify:007:setup` accepts only fresh Feature 006 evidence and the existing `qa-jira-gitlab-mattermost-local` contour; absent corporate inputs remain explicit blocked/skipped results and grant no deployment or production authority.

---

## Phase 2: Shared blocking foundation

**Purpose**: Publish immutable contracts, common authorization/action primitives, complete additive migrations, repository shells and static composition required by every user story.

**Critical**: No user-story implementation starts until this phase is complete.

### Foundation tests — author and observe RED first

- [X] T013 [P] Validate all 15 Feature 007 schemas, declared examples, secret/production negatives, closed enums, immutable IDs, local refs and RFC 8785/JCS digests in tests/contract/007/design-contracts.spec.ts
- [X] T014 [P] Validate all 20 onboarding/evidence OpenAPI operations, three AsyncAPI channels, five operations, unique operation IDs, exact scope parameters and server-authored-field exclusion in tests/contract/007/openapi-asyncapi.spec.ts
- [X] T015 [P] Byte-pin published Binding v1, QA Project Context v1, Target Snapshot v1 and Evidence Manifest v1 while proving additive v2 identities and `LEGACY_INTEGRITY_ONLY` reads in tests/contract/007/historical-contract-compatibility.spec.ts
- [X] T016 [P] Validate `BINDING_PUBLISH`, `BINDING_RETIRE`, `PROJECT_RESUME` and `ONBOARDING_PILOT_ACTIVATE` candidates, exact `PLATFORM_ACTION` approval binding, separation of duties, step-up policy and one-time consumption in tests/contract/007/platform-actions.spec.ts
- [X] T017 [P] Add canonical content-hash, target-snapshot transitive-pin, detached JWS protected-header, public-key version and forbidden `none`/MAC algorithm golden vectors in tests/contract/007/evidence-crypto-vectors.spec.ts
- [X] T018 [P] Enforce Core/QA/Connector/runtime/API/UI ownership, static loading, no model authority, no secret-bearing domain fields, no new service and no provider DTOs in Core in tests/architecture/007/onboarding-boundaries.spec.ts and tests/architecture/007/runtime-wiring.spec.ts
- [X] T019 [P] Add owner/order/collision/no-cross-owner-DDL/entity-parity checks for Core 0150/0155/0160 and QA 2080/2085 in tests/integration/migrations/007-migration-registry.spec.ts
- [X] T020 [P] Add PostgreSQL 17/18 fresh, Core-0140/QA-2070 upgrade, repeat, current-minus-one, failed-migration recovery, bootstrap-backfill and historical-hash coverage in tests/integration/migrations/007-onboarding-foundation.spec.ts
- [X] T021 [P] Prove composite Workspace/Project foreign keys, scoped repository methods, immutable revision chains, one current published Binding, one active account slot lease and no global-ID-only fetch in tests/integration/007/scoped-foundation-persistence.spec.ts
- [X] T022 [P] Validate canonical event envelope/payload parity, Project partition keys, immutable exact refs, at-least-once replay dedupe and mismatch quarantine in tests/contract/007/event-envelope-binding.spec.ts
- [X] T023 [P] Validate deterministic bootstrap of existing Projects without invented P3/signature facts, v1 read compatibility and restart-stable current projections in tests/integration/007/historical-bootstrap.spec.ts
- [X] T024 [P] Add shared deterministic clocks, principals, classifications, exact-ref builders, signing keys and Project A/B/forbidden-C factory in tests/support/007-onboarding-fixture.ts

### Foundation implementation

- [X] T025 Generate and register Feature 007 schema documents with collision, contribution-order and digest enforcement in packages/platform-contracts/src/generated/schema-documents.ts and packages/platform-contracts/src/schema-registry.ts
- [X] T026 Regenerate standalone API and Mock Hub OpenAPI snapshots with the Feature 007 surface in apps/api/openapi.generated.json and apps/mock-hub/openapi.generated.json
- [X] T027 Define the closed onboarding, entitlement, binding, QA-resource, evidence, export and suspension operation/permission catalog in packages/platform-core/src/project-onboarding/authorization.ts and packages/platform-runtime-nest/src/auth/authorization-contributions.ts
- [X] T028 [P] Implement exact revision refs, owner/classification snapshots, onboarding gate results, canonical set ordering and shared transition errors in packages/platform-core/src/project-onboarding/primitives.ts
- [X] T029 [P] Implement stable Project registry plus independent onboarding-stage, capability-mode and operational-state revision invariants in packages/platform-core/src/project-onboarding/model.ts
- [X] T030 [P] Implement immutable entitlement grant/replace/revoke revisions and current-set hashing in packages/platform-core/src/identity-access/project-entitlement-revisions.ts
- [X] T031 Align runtime `ProjectIntegrationBinding` v1 with published configuration/resource refs, lifecycle timestamps and `LOCAL|NON_PROD|PREPROD` scopes without changing v1 bytes in packages/platform-core/src/integration-registry/model.ts and packages/platform-core/src/integration-registry/binding-lifecycle.ts
- [X] T032 [P] Define functional acceptance, capability-probe, requirement-set and immutable mode-assessment models in packages/platform-core/src/project-onboarding/binding-readiness.ts
- [X] T033 [P] Define exact operational action candidates, incident disposition and the common Project effect-guard port in packages/platform-core/src/project-onboarding/operational-actions.ts and packages/platform-core/src/commanding/project-effect-guard.ts
- [X] T034 [P] Implement QA Project Context v2, environment, test-data, account-pool and account-lease domain invariants without secret values in packages/competency-qa/src/domain/project-resources.ts and packages/competency-qa/src/domain/qa-project-context.ts
- [X] T035 [P] Implement Target Snapshot v2, Evidence Manifest v2, signature-envelope, evidence-package and artifact-membership domain types in packages/competency-qa/src/domain/evidence-manifest-v2.ts and packages/competency-qa/src/domain/snapshots-v2.ts
- [X] T036 [P] Define provider-neutral manifest signer/verifier, immutable public-key resolver, artifact availability and evidence export ports in packages/competency-qa/src/application/evidence-integrity-ports.ts and packages/competency-qa/src/application/evidence-export-port.ts
- [X] T037 Implement complete schema-only Core 0150 Project registry revisions, onboarding headers/revisions/gates and Workspace rollout-lease tables in packages/platform-persistence-typeorm/src/migrations/core/0150-project-onboarding.ts
- [X] T038 Implement complete schema-only Core 0155 entitlement revision, Binding header/revision/acceptance/probe/mode-assessment and exact action support in packages/platform-persistence-typeorm/src/migrations/core/0155-project-binding-entitlements.ts
- [X] T039 Implement complete schema-only Core 0160 artifact availability/retention decisions and evidence-export audit tables in packages/platform-persistence-typeorm/src/migrations/core/0160-artifact-retention-export.ts
- [X] T040 Add Core entity parity, composite scope constraints, indexes and append-only guards for 0150/0155/0160 in packages/platform-persistence-typeorm/src/entities/project-onboarding.entities.ts, packages/platform-persistence-typeorm/src/entities/projects-entitlements.entities.ts, packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts and packages/platform-persistence-typeorm/src/entities/work-and-artifacts.entities.ts
- [X] T041 [P] Register scoped Project registry/onboarding/gate/rollout repository shells and repair projections in packages/platform-persistence-typeorm/src/project-onboarding.repository.ts
- [X] T042 [P] Register atomic entitlement revision/current-projection repository shells in packages/platform-persistence-typeorm/src/project-entitlement.repository.ts
- [X] T043 [P] Register Binding revision, validation, acceptance, probe, assessment and exact lifecycle-action repository shells in packages/platform-persistence-typeorm/src/project-binding.repository.ts
- [X] T044 [P] Register artifact availability, retention-decision and audited-export repository shells in packages/platform-persistence-typeorm/src/artifact-retention.repository.ts and packages/platform-persistence-typeorm/src/evidence-export.repository.ts
- [X] T045 Implement complete schema-only QA 2080 Project Context v2, environment, test-data, account-pool and account-lease tables in packages/competency-qa/src/persistence/migrations/2080-project-resources.ts
- [X] T046 Implement complete schema-only QA 2085 Target Snapshot v2, manifest headers/revisions, signatures, evidence packages and predecessor constraints in packages/competency-qa/src/persistence/migrations/2085-evidence-integrity.ts
- [X] T047 Add QA 2080/2085 entity parity, composite scope constraints, lease uniqueness and immutable evidence guards in packages/competency-qa/src/persistence/entities.ts
- [X] T048 [P] Register scoped QA Project Context/resource/lease repository shells in packages/competency-qa/src/persistence/project-resource.repository.ts and packages/competency-qa/src/persistence/test-account-lease.repository.ts
- [X] T049 [P] Register Target Snapshot v2, manifest/signature/package repository and Session-review UoW shells in packages/competency-qa/src/persistence/evidence-integrity.repository.ts and packages/competency-qa/src/persistence/evidence-signing.uow.ts
- [X] T050 Register Core/QA migrations, entities, repositories, package exports and static API/worker composition, then emit fresh foundation reports in packages/platform-persistence-typeorm/src/migrations/core/index.ts, packages/platform-persistence-typeorm/src/entities/composition.ts, packages/platform-persistence-typeorm/src/index.ts, packages/competency-qa/src/persistence/migrations/index.ts, packages/competency-qa/src/persistence/contributions.ts, packages/competency-qa/src/index.ts, packages/runtime-composition/src/migrations/composition.ts, packages/runtime-composition/src/persistence/entity-composition.ts, packages/runtime-composition/src/onboarding/composition.ts, packages/runtime-composition/src/index.ts, apps/api/src/app.module.ts, apps/worker/src/app.module.ts and tools/verification/007-foundation-checkpoint.mts

**Checkpoint**: `verify:007:foundation` proves immutable contracts and migrations, exact ownership, v1 compatibility, scoped repositories, cryptographic policy shape and static composition before story behavior exists.

---

## Phase 3: User Story 1 — Onboard a manual-only Project (Priority: P1) MVP

**Goal**: Register one Project, assign owners/classification and starter entitlements, publish Jira/Mattermost plus QA resource context, derive `MANUAL_ONLY`, allow a manual Session and deny an automated Session.

**Independent Test**: Run `pnpm onboarding:scenario -- run manual-only-onboarding`; verify `SHADOW / MANUAL_ONLY / ACTIVE`, successful manual Session start, rejected automated Session, exact configuration refs and complete actor/timestamp/before-after/correlation audit.

### Tests for User Story 1 — author and observe RED first

- [X] T051 [P] [US1] Add Project registration, immutable owner/classification revision and onboarding DRAFT→VALIDATING→NEEDS_FIX/SHADOW transition truth tables in tests/unit/007/us1-project-onboarding.spec.ts
- [X] T052 [P] [US1] Validate project registration, authorized catalog, onboarding read/evaluation and exact ETag/idempotency response shapes in tests/contract/007/us1-project-api.spec.ts
- [X] T053 [P] [US1] Test atomic entitlement grant/replace/revoke revision, current projection, same-key replay/conflict and before/after audit in tests/integration/007/us1-entitlement-uow.spec.ts
- [X] T054 [P] [US1] Test QA Context v2, environment, test-data and account-pool publication with same-scope exact refs and secret/production rejection in tests/integration/007/us1-project-resources.spec.ts
- [X] T055 [P] [US1] Test account-lease acquisition/release/expiry, one active pool slot, credential resolution boundary and audit lineage in tests/integration/007/us1-account-leases.spec.ts
- [X] T056 [P] [US1] Validate Jira `QA_REQUEST_AUTHORITY`/`SOURCE_CONTEXT`/`DEFECT_DESTINATION` and Mattermost pilot-role Binding entries, exact validation report and QA Lead acceptance in tests/integration/007/us1-manual-binding.spec.ts
- [X] T057 [P] [US1] Add manual capability requirement, missing-GitLab `MANUAL_ONLY`, mandatory-probe freshness and deterministic safe-reason matrices in tests/unit/007/us1-capability-mode.spec.ts
- [X] T058 [P] [US1] Prove a manual Session captures the exact environment/Binding chain while an automated Session is denied before persistence or provider calls in tests/integration/007/us1-session-mode-guards.spec.ts
- [X] T059 [P] [US1] Add the independent API/PostgreSQL/worker manual-only onboarding journey in tests/e2e/007/us1-manual-onboarding.spec.ts
- [X] T060 [P] [US1] Add the authorized Integration Administrator/QA Lead manual-onboarding browser journey and reason display in tests/e2e/007/us1-manual-onboarding-browser.spec.ts

### Implementation for User Story 1

- [X] T061 [US1] Implement stable Project registration, owner/classification revision publication, starter onboarding header and server-authored audit/outbox in packages/runtime-composition/src/onboarding/project-registration-service.ts and packages/platform-persistence-typeorm/src/project-onboarding.repository.ts
- [X] T062 [US1] Implement serializable entitlement grant/replace/revoke with CAS, idempotency, immediate current-projection update and redacted audit in packages/runtime-composition/src/onboarding/entitlement-service.ts and packages/platform-persistence-typeorm/src/project-entitlement.repository.ts
- [X] T063 [P] [US1] Implement QA environment, test-data, account-pool and Project Context v2 publication services with exact schema-bound refs in packages/competency-qa/src/application/manage-project-resources.ts and packages/competency-qa/src/persistence/project-resource.repository.ts
- [X] T064 [P] [US1] Implement time-bounded account-lease acquire/release/expiry and opaque runtime credential resolution in packages/competency-qa/src/application/manage-test-account-lease.ts, packages/competency-qa/src/persistence/test-account-lease.repository.ts and packages/runtime-composition/src/qa/test-account-resolver.ts
- [X] T065 [US1] Implement Binding draft validation that pins exact Profile/Connection/Mapping/resources and leaves failed candidates DRAFT without validationReportId in packages/platform-core/src/integration-registry/binding-lifecycle.ts and packages/platform-persistence-typeorm/src/project-binding.repository.ts
- [X] T066 [P] [US1] Implement immutable safe Jira/Mattermost capability probes and freshness policy adapters in packages/runtime-composition/src/onboarding/capability-probes.ts, packages/runtime-composition/src/jira/profile-validation.ts and packages/runtime-composition/src/mattermost/profile-validation.ts
- [X] T067 [US1] Implement QA Lead functional acceptance over the exact Binding, validation report, QA context and checklist in packages/runtime-composition/src/onboarding/binding-acceptance-service.ts
- [X] T068 [US1] Implement exact Owner-approved Binding publication with distinct initiator, step-up/current authorization recheck, one current PUBLISHED revision and transactional audit/outbox in packages/platform-core/src/approval/binding-publication-executor.ts and packages/runtime-composition/src/onboarding/binding-lifecycle-service.ts
- [X] T069 [US1] Implement deterministic onboarding-gate evaluation and `MANUAL_ONLY` mode assessment without Core knowledge of Jira/GitLab/Mattermost semantics in packages/competency-qa/src/application/project-capability-mode.ts and packages/runtime-composition/src/onboarding/onboarding-service.ts
- [X] T070 [US1] Enforce current `ACTIVE + MANUAL_ONLY` rules, exact environment/resources/lease eligibility and Target Snapshot v2 capture at manual Session start in packages/competency-qa/src/application/session-start-guards.ts, packages/competency-qa/src/application/target-snapshot-builder.ts and packages/competency-qa/src/persistence/manual-execution.uow.ts
- [x] T071 [US1] Expose and register Project catalog/onboarding, entitlement, Binding validation/acceptance/publication, QA context/environment/resource and account-lease endpoints in packages/platform-runtime-nest/src/http/project-onboarding.controller.ts, apps/api/src/extensions/onboarding/onboarding.controller.ts and apps/api/src/app.module.ts
- [X] T072 [US1] Publish canonical Project registry, entitlement, gate, Binding, mode and lease events and process them idempotently in packages/runtime-composition/src/onboarding/events.ts, packages/runtime-composition/src/onboarding/worker.ts and apps/worker/src/app.module.ts
- [X] T073 [US1] Add Integration Administrator onboarding workspace with owners, classification, exact refs, gates, probes, approval and `MANUAL_ONLY` explanations in packages/competency-qa/src/ui/project-onboarding.tsx, apps/web/src/routes/projects/onboarding.tsx and apps/web/src/App.tsx
- [X] T074 [US1] Seed the deterministic manual-only Project and implement its exact CLI scenario in packages/runtime-composition/src/seed/qa-project-onboarding-local-seed.ts and tools/local/onboarding-scenario.mts
- [X] T075 [US1] Execute US1 contract/unit/integration/e2e/browser checks RED-to-GREEN and atomically emit reports/007-project-onboarding-evidence-security/us1.json through tools/verification/007-us1-checkpoint.mts

**Checkpoint**: `verify:007:us1` proves one Project can be onboarded safely in manual-only mode with complete audit and no GitLab or production dependency. This is the Feature 007 MVP.

---

## Phase 4: User Story 2 — Promote a Project to full QA (Priority: P1)

**Goal**: Add an exact GitLab execution/artifact/source Binding and accepted suite contract, derive `FULL_QA`, run one automated Session, preserve historical Session pins and support immutable rollback-by-new-version.

**Independent Test**: Run `pnpm onboarding:scenario -- run full-qa-promotion`; verify fresh mandatory probes and acceptance, exact Owner approval, `FULL_QA`, one completed local automated Session, unchanged old Session refs and no mode downgrade during a Mattermost delivery outage.

### Tests for User Story 2 — author and observe RED first

- [X] T076 [P] [US2] Add full-QA requirement-set truth tables for Jira authority, GitLab source/execution/artifact roles, exact suite acceptance, probe freshness and Mattermost fallback in tests/unit/007/us2-full-qa-mode.spec.ts
- [X] T077 [P] [US2] Test GitLab capability probes against exact Profile/Connection/Mapping/pipeline contract and reject stale, cross-Project or mismatched results in tests/integration/007/us2-gitlab-probes.spec.ts
- [X] T078 [P] [US2] Test new Binding publication retires the prior current version atomically while old Work Items/Sessions retain exact historical refs in tests/integration/007/us2-binding-version-history.spec.ts
- [X] T079 [P] [US2] Prove automated planning/launch requires `FULL_QA`, accepted exact suite and Target Snapshot v2 and performs zero provider effects on denial in tests/integration/007/us2-automated-session-guards.spec.ts
- [X] T080 [P] [US2] Race competing publish/retire/rollback candidates and prove one serializable current Binding, exact approval consumption and deterministic conflict results in tests/integration/007/us2-binding-concurrency.spec.ts
- [X] T081 [P] [US2] Add the independent local GitLab conformance, promotion, automated Session and historical reproducibility journey in tests/e2e/007/us2-full-qa-promotion.spec.ts
- [X] T082 [P] [US2] Test sequential first `PILOT_ACTIVE` promotions, rollout-lease expiry/recovery, C1/N2/P3 blocked inputs and exact activation approval in tests/integration/007/us2-pilot-activation.spec.ts

### Implementation for User Story 2

- [X] T083 [US2] Publish additive QA competency manifest v1.4 and versioned `qa.validation` capability requirement set without changing v1.3 bytes in packages/competency-qa/src/manifest-v1.4.ts, packages/competency-qa/src/index.ts and packages/competency-qa/src/node.ts
- [X] T084 [P] [US2] Implement safe GitLab source-context, trigger/status and artifact-read capability probes over exact configuration pins in packages/runtime-composition/src/gitlab/profile-validation.ts and packages/runtime-composition/src/onboarding/capability-probes.ts
- [X] T085 [US2] Extend QA Lead acceptance with exact automation suite, pipeline contract, environment and evidence-policy checks in packages/competency-qa/src/application/manage-automation-suite.ts and packages/runtime-composition/src/onboarding/binding-acceptance-service.ts
- [X] T086 [US2] Implement immutable capability-mode assessments and safe `MANUAL_ONLY ⇄ FULL_QA` onboarding revisions from the QA-owned requirement set in packages/competency-qa/src/application/project-capability-mode.ts and packages/runtime-composition/src/onboarding/onboarding-service.ts
- [X] T087 [US2] Implement rollback as semantic cloning into a new DRAFT version followed by validation, acceptance and publication; never reactivate a retired row in packages/platform-core/src/integration-registry/binding-lifecycle.ts and packages/runtime-composition/src/onboarding/binding-lifecycle-service.ts
- [X] T088 [US2] Implement publish/retire/rollback and `ONBOARDING_PILOT_ACTIVATE` exact action consumers with fixed lock order and Workspace rollout lease in packages/platform-core/src/project-onboarding/operational-actions.ts, packages/platform-persistence-typeorm/src/project-onboarding.repository.ts and packages/runtime-composition/src/onboarding/action-consumers.ts
- [X] T089 [US2] Build full transitive Target Snapshot v2 configuration pins for manual and automated Sessions in packages/competency-qa/src/application/target-snapshot-builder-v2.ts
- [X] T090 [US2] Integrate `FULL_QA` assessment, exact suite/Binding snapshot and Project effect guard with automated planning and launch in packages/competency-qa/src/application/plan-automated-session.ts, packages/competency-qa/src/application/trigger-automation.ts and packages/runtime-composition/src/gitlab/automation-launch-service.ts
- [X] T091 [US2] Expose exact Binding lifecycle and pilot-activation commands with CAS/idempotency/conflict/rejection response unions in apps/api/src/extensions/onboarding/bindings.controller.ts and apps/api/src/extensions/onboarding/onboarding.controller.ts
- [X] T092 [P] [US2] Run scheduled/commanded probes, expire stale observations and recompute mode without provider authority to mutate Project state directly in packages/runtime-composition/src/onboarding/probe-worker.ts and apps/worker/src/app.module.ts
- [X] T093 [P] [US2] Emit canonical Binding retired, capability-mode changed and onboarding-stage changed events with exact predecessor/result refs in packages/runtime-composition/src/onboarding/events.ts
- [X] T094 [US2] Add GitLab roles, suite acceptance, mode transition, history/rollback and Mattermost fallback views in packages/competency-qa/src/ui/project-onboarding.tsx and apps/web/src/routes/projects/onboarding.tsx
- [X] T095 [US2] Extend the local seed and scenario runner with exact GitLab promotion, Mattermost outage and sequential pilot-activation fixtures in packages/runtime-composition/src/seed/qa-project-onboarding-local-seed.ts and tools/local/onboarding-scenario.mts
- [X] T096 [US2] Execute US2 unit/integration/concurrency/e2e/browser checks RED-to-GREEN and atomically emit reports/007-project-onboarding-evidence-security/us2.json through tools/verification/007-us2-checkpoint.mts

**Checkpoint**: `verify:007:us2` proves exact full-QA promotion, automated execution, immutable version history, rollback-by-new-version and sequential pilot activation without treating connector health as Project authority.

---

## Phase 5: User Story 3 — Enforce Project-scoped access (Priority: P1)

**Goal**: Apply one default-deny intersection of Workspace membership, current Project Entitlement, role permission and classification to every read, mutation, aggregate, cache, event and export boundary.

**Independent Test**: Run `pnpm onboarding:scenario -- run cross-project-deny` with two principals, two visible Projects, one forbidden Project, two roles and two classifications; verify identical scope across catalog, direct URL, API, search, queue, events, artifacts and export with no existence/count/cursor/log leakage.

### Tests for User Story 3 — author and observe RED first

- [X] T097 [P] [US3] Add complete membership×entitlement×role×classification×operational-state authorization truth tables and DENY precedence in tests/unit/007/us3-authorization-policy.spec.ts
- [X] T098 [P] [US3] Prove every repository filters Workspace/Project authorization before row lookup, count, aggregate, cursor or cache computation in tests/integration/security/007/us3-repository-prefilter.spec.ts
- [X] T099 [P] [US3] Test Project catalog, direct onboarding URL, Work Item detail, queue and search parity including forbidden/not-found equivalence in tests/integration/security/007/us3-read-surface-isolation.spec.ts
- [X] T100 [P] [US3] Test Project-scoped event subscription/partition filtering, replay reauthorization and no hidden event metadata in tests/integration/security/007/us3-event-isolation.spec.ts
- [X] T101 [P] [US3] Test artifact metadata/content, manifest/package verification and export authorization/classification parity in tests/integration/security/007/us3-evidence-artifact-isolation.spec.ts
- [X] T102 [P] [US3] Prove scoped cache keys, outbox/jobs, delayed worker execution and connector commands reauthorize with `workspaceId + projectId` at consumption in tests/integration/security/007/us3-background-reauthorization.spec.ts
- [X] T103 [P] [US3] Race entitlement revoke against list/read/export/effect execution and prove immediate deterministic denial without moving business rows in tests/integration/007/us3-entitlement-revocation-race.spec.ts
- [X] T104 [P] [US3] Reject cross-Project exact-ref substitution for Binding, context, environment, lease, Session, manifest, artifact, approval and audit subjects in tests/integration/security/007/us3-cross-scope-substitution.spec.ts
- [X] T105 [P] [US3] Detect hidden count, cursor, cache, timing, log, metric and safe-error leakage with stable low-cardinality reason codes in tests/integration/security/007/us3-side-channel.spec.ts
- [X] T106 [P] [US3] Add the independent multi-principal API/search/queue/event/artifact/export journey in tests/e2e/007/us3-project-scope.spec.ts
- [X] T107 [P] [US3] Add browser navigation, direct forbidden URL and post-revocation disappearance coverage in tests/e2e/007/us3-project-scope-browser.spec.ts

### Implementation for User Story 3

- [X] T108 [US3] Extend the central policy evaluator with current entitlement revisions, classification ceilings, DENY precedence and safe private/public denial reasons in packages/platform-core/src/identity-access/authorization-policy.ts and packages/platform-core/src/identity-access/classification-policy.ts
- [X] T109 [US3] Implement authorization-safe Project catalog/read tokens and bounded query ports that cannot express unscoped lookup in packages/platform-core/src/project-onboarding/query-ports.ts and packages/platform-persistence-typeorm/src/project-onboarding.repository.ts
- [X] T110 [US3] Enforce atomic current entitlement projection and execution-time authorization witness recomputation in packages/platform-persistence-typeorm/src/project-entitlement.repository.ts and packages/runtime-composition/src/onboarding/entitlement-service.ts
- [X] T111 [US3] Apply the shared scoped query token before aggregation to existing Work Item, queue and operational-authority repositories in packages/platform-persistence-typeorm/src/work-management.repository.ts, packages/platform-persistence-typeorm/src/queue-projection.repository.ts and packages/platform-persistence-typeorm/src/operational-authority.repository.ts
- [X] T112 [P] [US3] Implement Project-scoped search index documents, authorization-first search and cursor binding in packages/runtime-composition/src/onboarding/project-search.ts
- [X] T113 [P] [US3] Implement Project-scoped event subscription filters, inbox replay reauthorization and mismatch quarantine in packages/platform-core/src/events/event-processing.ts and packages/runtime-composition/src/onboarding/event-subscriptions.ts
- [X] T114 [US3] Apply current entitlement/role/classification checks to artifact metadata/content and evidence verify/export ports in packages/platform-core/src/artifacts/artifact-service.ts, packages/competency-qa/src/application/evidence-authorization-contribution.ts and packages/runtime-composition/src/onboarding/evidence-authorization.ts
- [X] T115 [US3] Partition caches, outbox messages, worker claims and Connector commands by Workspace/Project and reauthorize delayed work immediately before effect in packages/runtime-composition/src/onboarding/scoped-execution.ts and packages/platform-core/src/commanding/command-gateway.ts
- [X] T116 [US3] Return one safe missing/forbidden problem shape and keep private policy dimensions audit-only across onboarding endpoints in packages/platform-runtime-nest/src/http/problem-details.filter.ts and apps/api/src/extensions/onboarding/onboarding.controller.ts
- [X] T117 [US3] Render only server-authorized Projects/routes/actions and invalidate navigation after revocation in apps/web/src/routes/projects/project-catalog.tsx, apps/web/src/routes/projects/onboarding.tsx and apps/web/src/App.tsx
- [X] T118 [US3] Seed the two-principal/two-visible/one-forbidden classification matrix and implement the cross-project-deny scenario in tests/support/007-onboarding-fixture.ts, packages/runtime-composition/src/seed/qa-project-onboarding-local-seed.ts and tools/local/onboarding-scenario.mts
- [X] T119 [US3] Execute US3 policy/security/e2e/browser checks RED-to-GREEN and atomically emit reports/007-project-onboarding-evidence-security/us3.json through tools/verification/007-us3-checkpoint.mts

**Checkpoint**: `verify:007:us3` proves the same default-deny policy on every enumerated surface, immediate revocation and no cross-Project existence, aggregate or background-work leakage.

---

## Phase 6: User Story 4 — Preserve immutable signed evidence (Priority: P1)

**Goal**: Complete every new Session with a full Target Snapshot v2, immutable Evidence Manifest v2, detached EdDSA JWS signature and human attestation; support append-only corrections, Work Item evidence packages, retention and audited export.

**Independent Test**: Run `pnpm onboarding:scenario -- run evidence-revision-retention`; verify manifest hash/signature and exact pins, reject mutation, append a signed correction, verify both revisions, expire binary content while preserving metadata/checksum/provenance and report v1 evidence as `LEGACY_INTEGRITY_ONLY`.

### Tests for User Story 4 — author and observe RED first

- [X] T120 [P] [US4] Validate Target Snapshot v2 full transitive Binding/Profile/Connection/Mapping/validation/environment/data/lease/definition/policy pins and reject aliases/secrets/production in tests/contract/007/us4-target-snapshot.spec.ts
- [X] T121 [P] [US4] Validate Evidence Manifest v2 complete Work Item/Session/Plan Item/Attempt/actor/timestamp/result/finding/artifact/provenance/classification content and correction constraints in tests/contract/007/us4-evidence-manifest.spec.ts
- [X] T122 [P] [US4] Add RFC 8785/JCS canonicalization, sorted-set, number/string and content-hash golden vectors in tests/unit/007/us4-evidence-canonicalization.spec.ts
- [X] T123 [P] [US4] Add detached EdDSA/Ed25519 JWS sign/verify, tamper, wrong key, revoked key, unknown algorithm, malformed envelope and unavailable-key vectors in tests/unit/007/us4-evidence-signature.spec.ts
- [X] T124 [P] [US4] Test signer failure, stale Session CAS, same-key retry and atomic manifest+signature+Session completion behavior in tests/integration/007/us4-evidence-signing-uow.spec.ts
- [X] T125 [P] [US4] Prove database/repository immutability, exact predecessor, clerical/substantive correction rules and competing-correction serialization in tests/integration/007/us4-evidence-correction.spec.ts
- [X] T126 [P] [US4] Test Work Item evidence package creation only after exact human-signed QA Verdict and valid required Session signatures in tests/integration/007/us4-evidence-package.spec.ts
- [X] T127 [P] [US4] Test artifact availability revisions, retention decisions, provider expiry, quarantine, legal hold and metadata/checksum survival in tests/integration/007/us4-artifact-retention.spec.ts
- [X] T128 [P] [US4] Test read/export reauthorization, signature/checksum verification, maximum classification, redaction policy, audited result hash and no raw locator in tests/integration/security/007/us4-evidence-export.spec.ts
- [X] T129 [P] [US4] Prove historical v1 reads remain byte-stable, display `LEGACY_INTEGRITY_ONLY` and never count toward pilot signature criteria in tests/contract/007/us4-legacy-evidence.spec.ts
- [X] T130 [P] [US4] Race Session completion, correction, artifact expiry and export and prove deterministic immutable references with no partial signed state in tests/integration/007/us4-evidence-concurrency.spec.ts
- [X] T131 [P] [US4] Add the independent manual/automated completion, correction, expiry, verification and export journey in tests/e2e/007/us4-evidence-integrity.spec.ts
- [X] T132 [P] [US4] Add evidence timeline, signature/key status, predecessor, artifact availability and export browser coverage in tests/e2e/007/us4-evidence-browser.spec.ts

### Implementation for User Story 4

- [X] T133 [US4] Implement immutable Target Snapshot v2 construction and semantic same-scope/transitive-pin validation in packages/competency-qa/src/application/target-snapshot-builder-v2.ts and packages/competency-qa/src/domain/snapshots-v2.ts
- [X] T134 [US4] Implement complete Evidence Manifest v2 canonical payload construction, maximum classification, human attestation and correction lineage in packages/competency-qa/src/application/evidence-manifest-builder-v2.ts and packages/competency-qa/src/domain/evidence-manifest-v2.ts
- [X] T135 [P] [US4] Implement provider-neutral signer/verifier policy plus local Ed25519 detached-JWS and immutable public-key resolver adapters in packages/runtime-composition/src/security/evidence-signing.ts and packages/runtime-composition/src/security/local-security.ts
- [X] T136 [US4] Implement two-boundary signing flow that signs an exact review candidate then rechecks and atomically commits manifest, signature, Session completion, audit and outbox in packages/competency-qa/src/persistence/evidence-signing.uow.ts and packages/competency-qa/src/application/sign-evidence-manifest-v2.ts
- [X] T137 [US4] Implement append-only clerical/substantive correction service with new human attestation/signature and no prior-row mutation in packages/competency-qa/src/application/correct-evidence-manifest.ts and packages/competency-qa/src/persistence/evidence-integrity.repository.ts
- [X] T138 [US4] Implement immutable Work Item evidence-package assembly over verified manifest/signature refs and exact human QA Verdict in packages/competency-qa/src/application/assemble-evidence-package.ts and packages/competency-qa/src/persistence/evidence-integrity.repository.ts
- [X] T139 [US4] Integrate Evidence v2 completion for both manual and automated Session review paths while retaining v1 read adapters in packages/competency-qa/src/persistence/session-review.uow.ts, packages/competency-qa/src/persistence/result-evidence.uow.ts and packages/competency-qa/src/application/sign-evidence-manifest.ts
- [X] T140 [US4] Implement append-only artifact availability observations, retention/legal-hold decisions and safe expiry/quarantine workers in packages/platform-persistence-typeorm/src/artifact-retention.repository.ts, packages/runtime-composition/src/onboarding/artifact-retention-worker.ts and apps/worker/src/app.module.ts
- [X] T141 [US4] Implement verify-on-read/export, exact redaction/export policies, streaming reauthorization and immutable export audit records in packages/runtime-composition/src/onboarding/evidence-service.ts and packages/platform-persistence-typeorm/src/evidence-export.repository.ts
- [X] T142 [US4] Expose manifest/package verification, correction and audited export endpoints without secret/raw provider locators in apps/api/src/extensions/onboarding/evidence.controller.ts and apps/api/src/app.module.ts

  Verified (2026-09-06): `tests/integration/007/us4-evidence-http.spec.ts` uses real Nest HTTP, PostgreSQL 17.7/18.6 and Ed25519; checks malformed/tampered signatures, scope/classification/permission denial, strong ETag, concurrent CAS, atomic audit failure rollback and persisted idempotency across API/DB reconnection. JSON metadata export checks current published policy and fresh trusted MFA on creation/download. `us4-evidence-web.spec.ts` runs the actual React route in Chromium against this API/DB and proves one audited export after repeated download; `us4-evidence-local-identity.spec.ts` verifies signed JWT/JWKS step-up claims. Corporate host wiring, remote signer adaptation, ZIP policy and the complete onboarding smoke are not claimed. See [integration instructions](../../docs/runbooks/evidence-http.md).
- [X] T143 [US4] Add authorized evidence revision timeline, cryptographic verification, legacy status, retention state and export UI in packages/competency-qa/src/ui/evidence-integrity.tsx, apps/web/src/routes/projects/evidence.tsx and apps/web/src/App.tsx
- [X] T144 [US4] Seed local signing/retention policies and implement the evidence-revision-retention scenario in packages/runtime-composition/src/seed/qa-project-onboarding-local-seed.ts and tools/local/onboarding-scenario.mts
- [X] T145 [US4] Execute US4 contract/unit/integration/security/e2e/browser checks RED-to-GREEN and atomically emit reports/007-project-onboarding-evidence-security/us4.json through tools/verification/007-us4-checkpoint.mts

**Checkpoint**: `verify:007:us4` proves cryptographic integrity, immutable correction lineage, human Verdict separation, retention history and authorized export for every new completed Session.

---

## Phase 7: User Story 5 — Suspend a compromised Project (Priority: P1)

**Goal**: Immediately deny new external writes, Session starts and account leases for a compromised Project while preserving authorized investigation; resume only after incident disposition, fresh probes and distinct exact Owner approval.

**Independent Test**: Run `pnpm onboarding:scenario -- run emergency-suspend-resume`; suspend between intent creation and connector invocation, verify zero new effects/Sessions/leases and preserved reads, reject invalid resume attempts, then resume once and safely recalculate capability mode.

### Tests for User Story 5 — author and observe RED first

- [X] T146 [P] [US5] Add independent stage/mode/operational-state transition tables, intended-mode preservation and safe resume recalculation in tests/unit/007/us5-operational-state.spec.ts
- [X] T147 [P] [US5] Test explicit emergency suspend authorization, CAS/idempotency, incident/reason requirement, complete audit and Owner/QA Lead notification intent in tests/integration/007/us5-emergency-suspend.spec.ts
- [X] T148 [P] [US5] Suspend between command creation and first Jira/GitLab/Mattermost effect and prove one shared execution-time guard yields zero new provider writes in tests/integration/security/007/us5-effect-guard-race.spec.ts
- [X] T149 [P] [US5] Prove suspension denies manual/automated Session start and account-lease acquisition while allowing safe completion/reconciliation of already invoked exact commands in tests/integration/007/us5-session-lease-guards.spec.ts
- [X] T150 [P] [US5] Prove authorized read, audit, evidence verification and investigation remain available while mutations/exports classified as effects follow policy in tests/integration/security/007/us5-investigation-access.spec.ts
- [X] T151 [P] [US5] Reject resume without fresh probes, accepted incident disposition, step-up, current entitlement or distinct exact Owner approval and reject self/stale/expired/replayed/wrong-target approvals in tests/integration/007/us5-resume-approval.spec.ts
- [X] T152 [P] [US5] Test resume restores prior mode only when current requirements pass and otherwise deterministically downgrades to `MANUAL_ONLY` in tests/integration/007/us5-resume-mode-recalculation.spec.ts
- [X] T153 [P] [US5] Race suspend/resume with Binding publish, entitlement revoke, lease acquire, Session start and queued effect under fixed lock order in tests/integration/007/us5-operational-concurrency.spec.ts
- [X] T154 [P] [US5] Test restart with pending suspend notifications, stale probe expiry, delayed commands and projection repair without Redis business authority in tests/integration/007/us5-suspension-recovery.spec.ts
- [X] T155 [P] [US5] Add the independent suspend-between-intent-and-effect plus approved-resume API/worker journey in tests/e2e/007/us5-suspend-resume.spec.ts
- [X] T156 [P] [US5] Add browser emergency controls, incident/probe/approval explanations and preserved investigation views in tests/e2e/007/us5-suspend-resume-browser.spec.ts

### Implementation for User Story 5

- [X] T157 [US5] Implement direct fail-safe suspend UoW with Project/onboarding CAS, intended-mode preservation, incident/reason, audit and canonical operational-state event in packages/runtime-composition/src/onboarding/project-suspension-service.ts and packages/platform-persistence-typeorm/src/project-onboarding.repository.ts
- [X] T158 [US5] Implement the shared Project effect guard at intent creation and immediately before first effect/session/lease start in packages/platform-core/src/commanding/project-effect-guard.ts and packages/runtime-composition/src/onboarding/project-effect-guard.ts
- [X] T159 [US5] Apply the guard to Jira writes, GitLab launches, Mattermost writes and the generic command broker without cancelling history or read-only reconciliation in packages/runtime-composition/src/jira/qa-worker-effect-gate.ts, packages/runtime-composition/src/gitlab/automation-launch-service.ts, packages/runtime-composition/src/mattermost/worker-steps.ts and packages/platform-core/src/commanding/connector-broker.ts
- [X] T160 [US5] Apply the same guard and fixed lock order to manual/automated Session starts and account-lease acquisition in packages/competency-qa/src/application/session-start-guards.ts, packages/competency-qa/src/persistence/manual-execution.uow.ts, packages/competency-qa/src/persistence/automated-session.uow.ts and packages/competency-qa/src/persistence/test-account-lease.repository.ts
- [X] T161 [P] [US5] Create idempotent Workspace Owner/QA Lead suspension/resume NotificationIntents with web fallback and safe payloads in packages/runtime-composition/src/onboarding/operational-notifications.ts
- [X] T162 [US5] Implement exact `PROJECT_RESUME` candidate/consumer with fresh probe set, incident disposition, distinct Owner approval, step-up/current authorization and mode recomputation in packages/platform-core/src/project-onboarding/operational-actions.ts and packages/runtime-composition/src/onboarding/action-consumers.ts
- [X] T163 [US5] Expose emergency suspend and approved resume endpoints with strong ETag, idempotency and safe conflict/rejection shapes in apps/api/src/extensions/onboarding/project-operations.controller.ts and apps/api/src/app.module.ts
- [X] T164 [US5] Add operational-state banner, emergency suspend, incident disposition, probe freshness, approval and resume controls while preserving authorized evidence/audit navigation in packages/competency-qa/src/ui/project-onboarding.tsx and apps/web/src/routes/projects/onboarding.tsx
- [X] T165 [P] [US5] Recover stale operational actions, expire probes, repair onboarding projections and reauthorize pending work after restart in packages/runtime-composition/src/onboarding/recovery-worker.ts and apps/worker/src/app.module.ts
- [X] T166 [US5] Extend the local fault fixture and scenario runner with intent/effect suspension races, notification outage and valid/invalid resume cases in packages/runtime-composition/src/seed/qa-project-onboarding-local-seed.ts and tools/local/onboarding-scenario.mts
- [X] T167 [US5] Execute US5 unit/integration/security/concurrency/recovery/e2e/browser checks RED-to-GREEN and atomically emit reports/007-project-onboarding-evidence-security/us5.json through tools/verification/007-us5-checkpoint.mts

**Checkpoint**: `verify:007:us5` proves immediate fail-safe effect denial, preserved investigation, exact approved recovery and safe capability recalculation under races and restart.

---

## Phase 8: Polish, cross-cutting validation and handoff

**Purpose**: Prove all stories together, close migration/security/recovery/observability coverage, validate the documented quickstart and produce source-bound Feature 007 completion evidence for Feature 008.

- [X] T168 Add aggregate PostgreSQL 17/18 fresh/upgrade/repeat/current-minus-one/failure-recovery/bootstrap/immutability coverage and atomic reports in tests/integration/007/migration-matrix.spec.ts, tools/ci/verify-007-migrations.mts, reports/007-project-onboarding-evidence-security/migrations-postgres-17.json and reports/007-project-onboarding-evidence-security/migrations-postgres-18.json
- [X] T169 [P] Add aggregate publish/retire/rollback/rollout-lease, entitlement, account-lease, evidence-correction and suspend/effect race coverage in tests/integration/007/concurrency-matrix.spec.ts and emit reports/007-project-onboarding-evidence-security/concurrency.json through tools/verification/007-concurrency-checkpoint.mts
- [X] T170 [P] Add duplicate/out-of-order/missed events, PostgreSQL/Redis/API/worker restarts, signer/provider outages, projection repair and idempotent recovery coverage in tests/integration/007/recovery-matrix.spec.ts and emit reports/007-project-onboarding-evidence-security/recovery.json through tools/verification/007-recovery-checkpoint.mts
- [X] T171 [P] Add aggregate entitlement/classification revocation, cross-scope substitution, hidden-data side-channel, secret/log/export leakage, step-up/SoD and production egress denial coverage in tests/integration/security/007/production-and-scope-boundary.spec.ts and emit reports/007-project-onboarding-evidence-security/security.json through tools/verification/007-security-checkpoint.mts
- [X] T172 [P] Add bounded onboarding/probe/mode/lease/signature/retention metrics, low-cardinality labels, constant-query authorized reads and zero-provider/model-read fixtures in tests/support/007-observability-fixture.ts and tests/integration/007/observability-performance.spec.ts, then emit reports/007-project-onboarding-evidence-security/observability.json through tools/verification/feature-007-observability.mts
- [X] T173 Implement local:onboarding up/status/migrate/seed/down aliases and exact five-scenario orchestration over the existing contour in tools/local/onboarding-cli.mts and tools/local/onboarding-scenario.mts
- [X] T174 Enforce static `qa-jira-gitlab-mattermost-local` selection, zero production credentials/endpoints, local signer isolation and external egress denial in packages/runtime-composition/src/config/environment.ts, packages/runtime-composition/src/security/local-security.ts and infra/compose/docker-compose.local.yml
- [X] T175 Complete one independently navigable US1–US5 browser journey with forbidden Project absence, onboarding gates, exact refs, mode/state, approvals, signatures and retention in tests/e2e/007/project-onboarding-browser.spec.ts and emit reports/007-project-onboarding-evidence-security/browser.json through tools/verification/007-browser-checkpoint.mts
- [X] T176 Implement isolated child-process smoke with API/worker/web/PostgreSQL/Redis/Mock Hub restarts, deterministic effect counts, signing verification, browser run and clean shutdown in tools/smoke/feature-007.mts and tools/smoke/feature-007-browser-process.mts
- [X] T177 Execute every command and scenario in specs/007-project-onboarding-evidence-security/quickstart.md and update only implementation-status text supported by fresh evidence
- [X] T178 Implement documented command/scenario/fresh-report validation and emit reports/007-project-onboarding-evidence-security/quickstart.json in tools/verification/007-quickstart.mts
- [X] T179 Implement FR-007-001–FR-007-028 including FR-007-006A/006B, SEC-007-001–SEC-007-005 and SC-007-001–SC-007-005 traceability to exact fresh tests/reports in tools/verification/feature-007-trace.mts and reports/007-project-onboarding-evidence-security/traceability.json
- [X] T180 Aggregate all story integration suites and atomically emit reports/007-project-onboarding-evidence-security/integration.json through tools/verification/007-integration-checkpoint.mts
- [X] T181 Implement child-report/source/contract/migration/runtime digest binding and emit reports/007-project-onboarding-evidence-security/evidence.json in tools/verification/feature-007-evidence.mts
- [X] T182 Re-run Feature 001–006 compatibility, contract-registry drift, historical schema byte pins, migration immutability and production-boundary checks in tools/verification/feature-007-gate.mts
- [X] T183 Compose setup, foundation, US1–US5, migration, concurrency, security, recovery, observability, browser, smoke, quickstart, trace, typecheck, lint and build gates in tools/verification/feature-007-gate.mts and tools/ci/feature-007.mts
- [X] T184 Run the complete `ci:007` gate against a clean source digest after T182, regenerate stale child reports in dependency order and emit the immutable final result in reports/007-project-onboarding-evidence-security/final-gate.json

**Checkpoint**: `verify:007` and `ci:007` produce a fresh PASS bound to the exact source tree. Feature 008 may consume that report for corporate runtime wiring and controlled pilot rollout; it must not redesign Feature 007 contracts.

---

## Dependencies and execution order

### Phase dependencies

- **Phase 1 — Setup**: starts immediately and establishes a fail-closed entry gate.
- **Phase 2 — Foundation**: depends on Phase 1 and blocks every user story.
- **Phase 3 — US1**: depends on Foundation and delivers the recommended MVP.
- **Phase 4 — US2**: product flow builds on US1 publication services; its tests remain independently runnable from an exact seeded `MANUAL_ONLY` Project.
- **Phase 5 — US3**: depends only on Foundation; it seeds exact revisions directly and can run in parallel with US1/US2 implementation after shared authorization interfaces stabilize.
- **Phase 6 — US4**: depends only on Foundation; it seeds completed Sessions/Verdict where needed and can run in parallel with US1/US2 after Target Snapshot interfaces stabilize.
- **Phase 7 — US5**: depends only on Foundation; it seeds an exact ACTIVE Project and can run in parallel after the shared effect-guard interface stabilizes.
- **Phase 8 — Polish**: depends on every story selected for release; final Feature 007 PASS requires all five.

### User-story dependency graph

```text
Setup → Foundation → US1 → US2 ─┐
                   ├→ US3 ─────┤
                   ├→ US4 ─────┼→ Polish/final gate
                   └→ US5 ─────┘
```

### Requirement and success-criteria coverage

| Requirement group | Primary phase | Independent evidence |
|---|---|---|
| FR-007-001–005 | Foundation, US1, US3 | Registry/entitlement UoW plus cross-project-deny matrix |
| FR-007-006, 006A, 006B and 007–011 | Foundation, US1, US2 | Binding validation/acceptance/publish/history/rollback tests |
| FR-007-012–016 | US1, US3, US4 | Resource/lease, redaction and scoped evidence tests |
| FR-007-017–023 | US4 | Snapshot/manifest/JWS/correction/package/retention/export tests |
| FR-007-024–025 | US1, US2 | Manual-only and full-QA mode matrices |
| FR-007-026–028 | US5 | Effect-race, investigation and approved-resume tests |
| SEC-007-001–005 | Foundation, US3–US5, Polish | Contract negatives and aggregate security gate |
| SC-007-001–005 | US1–US5, Polish | Story reports plus final source-bound traceability gate |

### Within each phase

1. Author the listed tests and confirm the intended RED failure.
2. Complete domain models before repositories/services.
3. Complete repositories and UoWs before controllers/workers.
4. Complete runtime behavior before UI/scenario orchestration.
5. Run the story checkpoint and obtain a fresh PASS before declaring the phase complete.

### Parallel opportunities

- T001/T002/T004, T008, T010/T011 are independent setup tracks.
- T013–T024 are separate foundation test files and can be authored in parallel.
- T028–T036, T041–T044 and T048/T049 own separate domain/repository files.
- All `[P]` tests inside a user story can be authored concurrently before implementation.
- After Foundation, US3, US4 and US5 can proceed alongside the sequential US1→US2 product path using their exact seeded fixtures.
- T169–T172 are independent final validation tracks after story completion.

---

## Parallel execution examples

### User Story 1

```text
T051 + T052 + T053 + T054 + T055 + T056 + T057 + T058 + T059 + T060
After shared models: T063 + T064 + T066
```

### User Story 2

```text
T076 + T077 + T078 + T079 + T080 + T081 + T082
After requirement-set publication: T084 + T092 + T093
```

### User Story 3

```text
T097 + T098 + T099 + T100 + T101 + T102 + T103 + T104 + T105 + T106 + T107
After policy/query-token implementation: T112 + T113
```

### User Story 4

```text
T120 + T121 + T122 + T123 + T124 + T125 + T126 + T127 + T128 + T129 + T130 + T131 + T132
After manifest model: T135 can proceed beside persistence work
```

### User Story 5

```text
T146 + T147 + T148 + T149 + T150 + T151 + T152 + T153 + T154 + T155 + T156
After the common guard/action contracts: T161 + T165
```

---

## Implementation strategy

### MVP first — User Story 1

1. Complete Setup and obtain `verify:007:setup` PASS.
2. Complete Foundation and obtain `verify:007:foundation` PASS.
3. Complete US1 and run `manual-only-onboarding` independently.
4. Stop and validate `SHADOW / MANUAL_ONLY / ACTIVE`, exact audit and manual/automated Session gating.

### Incremental delivery

1. **MVP**: US1 manual-only Project onboarding.
2. **Automation increment**: US2 full-QA promotion and historical pins.
3. **Security increment**: US3 uniform cross-Project default deny.
4. **Evidence increment**: US4 signed immutable evidence and retention.
5. **Operational safety increment**: US5 emergency suspend and exact approved resume.
6. **Release gate**: Phase 8 complete source-bound validation; hand off only the final PASS to Feature 008.

### Execution notes

- `[P]` means separate files and no incomplete-task dependency, not permission to ignore its phase gate.
- Never edit a published migration or historical v1 schema; add new revisions/adapters.
- Do not place credentials, tokens, cookies, signed URLs or raw test data in fixtures, logs, reports or domain rows.
- Same idempotency key with the same semantic hash replays; the same key with a different hash conflicts.
- Authorization, capability mode, evidence verification and Project operational state remain separate decisions.
- Commit after each task or coherent task group and regenerate only reports made stale by that source change.
