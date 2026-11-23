---
description: "Dependency-ordered implementation tasks for feature 003 Jira operational authority"
---

# Tasks: Jira operational authority

**Input**: design artifacts in `specs/003-jira-operational-authority/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`  
**Implementation status**: Locally verified; all 163 tasks are complete and the task-bound aggregate gate passes for `qa-jira-local`. Live non-prod remains optional and `SKIPPED_GATED` until the immutable C1 package is supplied, validated and explicitly selected. Production writes remain excluded.
**Tests**: mandatory. Each phase writes and observes its tests RED before implementation.  
**Organization**: Setup and Foundation are shared. US1–US4 are independently seedable P1 vertical slices.

## Format: `[ID] [P?] [Story] Description`

- `[P]` means different files and no unmet dependency permit parallel execution.
- `[US1]`…`[US4]` map directly to the four stories in `spec.md`.
- Every task names exact owned file paths.
- Tasks touching shared registries, app modules, migration composition or UI contribution files are deliberately serialized.

## Paths

- Libraries/adapters: `packages/*/src/`
- Apps: `apps/{api,worker,web,mock-hub}/src/`
- Verification: `tests/{architecture,contract,integration,e2e}/` and `tools/{contracts,verification,smoke,ci,local}/`
- Evidence: `reports/003-jira-operational-authority/`

---

## Phase 1 — Setup and fail-closed prerequisites

**Purpose**: make 001/002 readiness, C1 metadata, environment limits and both Jira package boundaries executable before feature implementation.

- [x] T001 Record exact required 001/002 report hashes, primary logical-role round-trip, operational binding/confirmation hooks, runnable API/worker and explicit non-requirement for a 002 import hook in `specs/003-jira-operational-authority/implementation-prerequisites.md`
- [x] T002 [P] Write failing fixtures for missing, stale, incompatible and passing 001/002 gates in `tests/contract/003/prerequisite-gate.spec.ts`
- [x] T003 Implement a fail-closed verifier that reports every missing prerequisite without creating substitute QA/Core code in `tools/verification/feature-003-prerequisites.mts`
- [x] T004 Wire `verify:003:prerequisites`, `test:003`, `smoke:003` and `trace:003` entrypoints in `package.json` and `tools/ci/feature-003.mts`
- [x] T005 [P] Compile the planned `JiraPilotMetadataPackage@1` and secret-lease metadata into runtime-safe TypeScript contracts in `packages/platform-contracts/src/extensions/jira-pilot-metadata.ts`
- [x] T006 [P] Add deterministic secret-free local C1 runtime config plus invalid edition/auth/build/webhook/concurrency fixtures in `config/local/jira-pilot-metadata.v1.json` and `tests/fixtures/003/jira-pilot-metadata.invalid.json`
- [x] T007 Write C1 schema, semantic cross-field, content-hash and secret-absence tests in `tests/contract/003/pilot-metadata.spec.ts`
- [x] T008 [P] Create pure protocol and separate TypeORM persistence package shells in `packages/connector-jira/package.json`, `packages/connector-jira/project.json`, `packages/connector-jira/tsconfig.json`, `packages/connector-jira-persistence-typeorm/package.json`, `packages/connector-jira-persistence-typeorm/project.json` and `packages/connector-jira-persistence-typeorm/tsconfig.json`
- [x] T009 [P] Create closed entrypoints/manifests with no deep imports in `packages/connector-jira/src/index.ts`, `packages/connector-jira/src/manifest.ts` and `packages/connector-jira-persistence-typeorm/src/index.ts`
- [x] T010 Register TypeScript paths, Nx/dependency-rule package maps, runtime package dependencies and the lockfile without adding unnecessary workspace globs in `tsconfig.base.json`, `tools/architecture/dependency-rules.mts`, `packages/runtime-composition/package.json` and `pnpm-lock.yaml`
- [x] T011 [P] Implement offline JSON Schema/OpenAPI/AsyncAPI parsing, local-ref resolution and positive/negative action-body validation in `tools/contracts/verify-003-contracts.mts`
- [x] T012 Generalize the hard-coded contract builder to merge immutable 001, 002 and 003 contributions without editing prior feature files in `tools/contracts/build-registry.mts` and `packages/platform-contracts/src/generated/schema-documents.ts`
- [x] T013 Normalize `LOCAL | NON_PROD | PREPROD | PLATFORM_PROD` with audited legacy parsing while allowing Jira effects only in LOCAL/NON_PROD in `packages/runtime-composition/src/config/environment.ts`
- [x] T014 [P] Write configuration tests proving PREPROD/PLATFORM_PROD records are disabled and have no credential/egress path in `tests/integration/security/003/production-boundary.spec.ts`
- [x] T015 Execute the setup gate; require green 001/002 for implementation and record absent live C1 as `NON_PROD_SKIPPED_GATED` in `reports/003-jira-operational-authority/setup-gate.json`

**Checkpoint**: T015 must be green before Phase 2. In the current repository it is expected to fail on unfinished 001/002; that is an intentional STOP, not work to absorb into 003.

---

## Phase 2 — Foundational authority, adapter and runtime infrastructure

**Purpose**: establish provider-neutral authority/import/projection/conflict models, ordered multi-role pins, durable target lanes, safe Jira protocol/persistence boundaries and a protocol-faithful local system.

### Tests first

- [x] T016 [P] Write 1.0/1.1 compatibility tests preserving the 1.0 target/result and READY|DONE transition schema while validating additive 1.1 operations/expanded transition pins in `tests/contract/003/capability-compatibility.spec.ts`
- [x] T017 [P] Validate every 003 schema/example/event and all four OpenAPI action bodies with positive and adversarial client-precondition vectors in `tests/contract/003/design-contracts.spec.ts`
- [x] T018 [P] Enforce Core/QA/Web →/ Jira, Jira protocol →/ TypeORM/Core/QA/Nest/React, Jira persistence →/ Core/QA/Nest and static loading boundaries in `tests/architecture/003-jira-boundaries.spec.ts`
- [x] T019 [P] Write migration owner/order/collision tests for `connector:${string}` and prohibit empty reserved migrations in `tests/integration/migrations/003-migration-registry.spec.ts`
- [x] T020 [P] Write PostgreSQL fresh/upgrade/repeat/failed-recovery/entity-parity tests for Core 0090/0095 and Jira 3000–3020 in `tests/integration/migrations/003-operational-authority.spec.ts`
- [x] T021 [P] Write one-active-binding, opaque external identity, immutable ordered primary/auxiliary chain and cross-authority link-policy tests in `tests/integration/003/operational-binding-chain.spec.ts`
- [x] T022 [P] Write two-command/same-target fenced lane, lease expiry, same-effect recovery and ambiguous-lane retention tests in `tests/integration/003/target-execution-lane.spec.ts`
- [x] T023 [P] Write external-human/service subject verification, no email auto-match, import uniqueness and create/import/webhook/reconcile convergence tests in `tests/integration/003/external-identity-import.spec.ts`
- [x] T024 [P] Write monotonic projection, same-token/different-hash, freshness-without-revision and append-only conflict lifecycle tests in `tests/integration/003/projection-conflict.spec.ts`
- [x] T025 [P] Write exact raw-byte, connection/delivery identity, same-ID/different-body, retry horizon, size and crash-before-ACK webhook tests in `tests/integration/security/003/webhook-ingress.spec.ts`
- [x] T026 [P] Write bootstrap→discovery→validated Connection, immutable Profile version, preview/dry-run and Profile-local drift tests in `tests/integration/003/jira-profile-lifecycle.spec.ts`
- [x] T027 [P] Write bounded mapping AST/output/resource tests rejecting code, secret paths, unknown fields and dynamic access in `tests/contract/003/jira-mapping-language.spec.ts`
- [x] T028 [P] Write Cloud v3 and pinned DC 9/10/11 request/response/identity/rich-text/pagination vectors and reject `/latest` in `tests/contract/003/jira-dialects.spec.ts`
- [x] T029 [P] Write service-secret lease, auth-combination, rotation/revoke, redirect/SSRF, header/body redaction and production-egress tests in `tests/integration/security/003/jira-auth-egress.spec.ts`
- [x] T030 [P] Write closed `FOUND | PROVEN_ABSENT | UNKNOWN | MULTIPLE` lookup, eventual-search zero, 401/403, 429, 5xx/timeout and rate-budget tests in `tests/integration/003/jira-effect-recovery.spec.ts`
- [x] T031 [P] Write Cloud token/DC offset watermark overlap, partial-page cursor, webhook renewal/expiry and fair lane scheduling tests in `tests/integration/003/jira-reconciliation.spec.ts`
- [x] T032 [P] Write Mock Hub wire tests for metadata, issues, search/changelog, properties, links, comments, dynamic/static webhooks, rate headers and failures in `tests/contract/003/mock-hub-jira.spec.ts`

### Foundation implementation

- [x] T033 Move connector effect context to a neutral SDK contract and implement 1.1 operations plus discovery/observation/webhook/reconciliation/Profile/secret/principal ports and package exports in `packages/connector-sdk/src/operational-work-item.ts`, `packages/connector-sdk/src/operational-provider-ports.ts` and `packages/connector-sdk/src/index.ts`
- [x] T034 Implement provider-neutral binding, expected projection, immutable configuration-pin set and conflict aggregates in `packages/platform-core/src/work-management/operational-authority.ts` and export them from `packages/platform-core/src/index.ts`
- [x] T035 Implement complete observations, adapter ordering, monotonic reducer and derived freshness in `packages/platform-core/src/work-management/operational-projection.ts`
- [x] T036 Implement external confirmation import intents plus verified opaque external-subject resolution without provider enums in `packages/platform-core/src/work-management/operational-import.ts` and `packages/platform-core/src/identity-access/external-principal-binding.ts`
- [x] T037 [P] Implement provider-neutral external observation, connector validation and reconciliation plan/run contracts in `packages/platform-core/src/events/external-entity-observation.ts`, `packages/platform-core/src/integration-registry/connector-validation-port.ts` and `packages/platform-core/src/work-management/operational-reconciliation.ts`
- [x] T038 Implement the durable fenced target execution lane and closed same-effect reacquisition rules in `packages/platform-core/src/commanding/target-execution-lane.ts`
- [x] T039 Implement expand-only Core 0090 for bindings, projections, conflicts, ordered configuration pins and target lanes in `packages/platform-persistence-typeorm/src/migrations/core/0090-operational-authority.ts`
- [x] T040 Implement Core 0095 for opaque external subjects, import intents and generic reconciliation cursors/runs/items in `packages/platform-persistence-typeorm/src/migrations/core/0095-external-identity-import-reconciliation.ts`
- [x] T041 Extend migration ownership, register 0090/0095 and entity parity, and export public adapters in `packages/platform-persistence-typeorm/src/migration-registry.ts`, `packages/platform-persistence-typeorm/src/migrations/core/index.ts`, `packages/platform-persistence-typeorm/src/entities/operational-authority.entities.ts`, `packages/platform-persistence-typeorm/src/entities/composition.ts` and `packages/platform-persistence-typeorm/src/index.ts`
- [x] T042 [P] Implement scoped authority/target-lane, import/external-subject and reconciliation repositories in `packages/platform-persistence-typeorm/src/operational-authority.repository.ts`, `packages/platform-persistence-typeorm/src/operational-import.repository.ts` and `packages/platform-persistence-typeorm/src/reconciliation-cursor.repository.ts`
- [x] T043 Implement atomic import, projection, conflict and target-lane units of work coupled to outbox/audit in `packages/platform-persistence-typeorm/src/operational-authority-unit-of-work.ts`
- [x] T044 Persist exact webhook bytes/blob ref and scoped delivery metadata before ACK, and enable Nest raw-body bootstrap in `packages/platform-core/src/events/webhook-ingress.ts`, `packages/platform-persistence-typeorm/src/webhook-inbox.repository.ts` and `apps/api/src/main.ts`
- [x] T045 Implement allowlisted REST transport, short-lived auth leases and fail-closed Cloud/DC dialect selection in `packages/connector-jira/src/http/jira-rest-client.ts`, `packages/connector-jira/src/auth/jira-auth.ts`, `packages/connector-jira/src/dialects/jira-cloud-v3.ts`, `packages/connector-jira/src/dialects/jira-dc-9-v2.ts`, `packages/connector-jira/src/dialects/jira-dc-10-v2.ts` and `packages/connector-jira/src/dialects/jira-dc-11-v2.ts`
- [x] T046 Implement sanitized discovery of exact build/capabilities/projects/types/fields/statuses/transitions/priorities/users/links in `packages/connector-jira/src/discovery/jira-discovery.ts`
- [x] T047 Implement closed mapping compilation plus Connection/Profile validation, preview and read-only dry-run in `packages/connector-jira/src/mapping/jira-mapping.ts` and `packages/connector-jira/src/contracts/jira-profile-validator.ts`
- [x] T048 Implement hint-only webhook normalization, Cloud/DC pagination, rate decoding and fail-closed effect lookup/reconciliation, then export the pure adapter surface in `packages/connector-jira/src/webhooks/jira-webhook-normalizer.ts`, `packages/connector-jira/src/reconciliation/jira-reconciliation.ts`, `packages/connector-jira/src/operational/jira-effect-control.ts` and `packages/connector-jira/src/index.ts`
- [x] T049 Implement Jira-owned entities/repositories and real migrations 3000, 3010 and 3020, then export the contribution in `packages/connector-jira-persistence-typeorm/src/entities.ts`, `packages/connector-jira-persistence-typeorm/src/migrations/3000-jira-discovery-profiles.ts`, `packages/connector-jira-persistence-typeorm/src/migrations/3010-jira-webhook-rate.ts`, `packages/connector-jira-persistence-typeorm/src/migrations/3020-jira-effect-reconciliation.ts`, `packages/connector-jira-persistence-typeorm/src/migrations/index.ts`, `packages/connector-jira-persistence-typeorm/src/jira-configuration.repository.ts`, `packages/connector-jira-persistence-typeorm/src/jira-effect.repository.ts`, `packages/connector-jira-persistence-typeorm/src/jira-rate.repository.ts` and `packages/connector-jira-persistence-typeorm/src/index.ts`
- [x] T050 Implement Mock Hub Jira migration/state/module/controller/scenarios/emitter and wire its DataSource/app/OpenAPI before any story test in `apps/mock-hub/src/persistence/migrations/0040-jira-state.ts`, `apps/mock-hub/src/jira/jira.module.ts`, `apps/mock-hub/src/jira/jira.repository.ts`, `apps/mock-hub/src/jira/jira.controller.ts`, `apps/mock-hub/src/jira/jira-scenarios.ts`, `apps/mock-hub/src/jira/jira-webhook-emitter.ts`, `apps/mock-hub/src/app.module.ts` and `apps/mock-hub/src/persistence/data-source.ts`
- [x] T051 Compose Core/Jira/persistence ports, migrations, entities, Profile validation, raw webhook/import handlers and reconciliation jobs in `packages/runtime-composition/src/jira/composition.ts`, `packages/runtime-composition/src/jira/profile-validation.ts`, `packages/runtime-composition/src/jira/webhook-handlers.ts`, `packages/runtime-composition/src/migrations/composition.ts`, `packages/runtime-composition/src/persistence/entity-composition.ts`, `packages/platform-runtime-nest/src/http/connector-webhooks.controller.ts` and `packages/runtime-composition/src/jira/reconciliation-jobs.ts`
- [x] T052 Wire and export selected Jira API/worker modules and dependency manifests without changing default/qa-local behavior in `apps/api/src/app.module.ts`, `apps/api/package.json`, `apps/worker/src/app.module.ts`, `apps/worker/package.json`, `packages/platform-runtime-nest/src/index.ts`, `packages/runtime-composition/src/index.ts` and `pnpm-lock.yaml`
- [x] T053 Run contracts, old Mock/qa-local regression, architecture, migrations, security and Mock Hub protocol RED→GREEN in `tools/verification/003-foundation-checkpoint.mts` and persist `reports/003-jira-operational-authority/foundation.json`

**Checkpoint**: Foundation is provider-neutral above the Connector, pure protocol code is TypeORM-free, exact pins/lanes are durable, Mock Hub and app/worker wiring are runnable, and all previous compositions still pass.

---

## Phase 3 — US1: one central QA Request after confirmed intake (P1) — MVP

**Goal**: confirmed intake creates and authoritatively confirms one Jira QA Request, one Work Item, one active binding and one projection; outage/uncertainty never fabricates Jira state.

**Independent test**: seed a confirmed Draft and published central/source Profiles, replay and crash the worker, then prove one issue/adoption; inject outage or unknown marker visibility and prove the Draft remains without a fake Work Item.

### Tests first

- [x] T054 [P] [US1] Write request.create target/payload/marker/ordered auxiliary-chain/result vectors in `tests/contract/003/us1-request-create.spec.ts`
- [x] T055 [P] [US1] Write confirmed-intake→issue→Work Item/binding/projection happy path in `tests/integration/003/us1-central-request.spec.ts`
- [x] T056 [P] [US1] Write duplicate delivery and concurrent-worker exactly-one issue/adoption tests in `tests/integration/003/us1-create-idempotency.spec.ts`
- [x] T057 [P] [US1] Write lost 201 plus temporarily zero-result eventually-consistent marker search proving `AMBIGUOUS` and no recreate in `tests/integration/003/us1-create-ambiguity.spec.ts`
- [x] T058 [P] [US1] Write crash after issue/link/comment and exact link/remote-link/comment receipt replay tests in `tests/integration/003/us1-sub-effect-recovery.spec.ts`
- [x] T059 [P] [US1] Write entitlement/Profile/authority-namespace/outage tests proving zero fake Work Item or cross-project effect in `tests/integration/security/003/us1-create-authorization.spec.ts`

### Implementation

- [x] T060 [US1] Export a QA-owned confirmed-intake intent with deterministic provider-neutral structural content in `packages/competency-qa/src/application/on-intake-confirmed.ts` and `packages/competency-qa/src/index.ts`
- [x] T061 [US1] Derive stable create identity from confirmation version and the backend-resolved ordered primary+SOURCE_CONTEXT pin set in `packages/platform-core/src/work-management/confirm-operational-create.ts`
- [x] T062 [P] [US1] Implement deterministic Central QA Request mapping/discriminator/effect marker in `packages/connector-jira/src/operational/request-create-mapper.ts`
- [x] T063 [US1] Implement exact marker lookup and create only after `PROVEN_ABSENT` in `packages/connector-jira/src/operational/request-create.ts`
- [x] T064 [P] [US1] Implement same-authority Jira link or published deterministic remote-link strategy from trusted auxiliary context in `packages/connector-jira/src/operational/source-link.ts`
- [x] T065 [US1] Persist and reconcile ordered issue/link/comment sub-effects without replaying confirmed steps in `packages/connector-jira/src/operational/request-create-reconciliation.ts`
- [x] T066 [US1] Perform authoritative issue read-back and return a complete sanitized provider-neutral snapshot in `packages/connector-jira/src/operational/issue-observation.ts`
- [x] T067 [US1] Atomically confirm command, Draft, Work Item, binding, projection, QA hook and outbox event in `packages/platform-persistence-typeorm/src/confirmation-unit-of-work.ts` and `packages/runtime-composition/src/extensions/confirmation-hooks.ts`
- [x] T068 [US1] Register create/recovery handlers and export the provider-neutral authority API through `packages/runtime-composition/src/jira/composition.ts`, `packages/platform-runtime-nest/src/http/operational-authority.controller.ts` and `packages/platform-runtime-nest/src/index.ts`
- [x] T069 [US1] Render/export pending/error versus confirmed authority and run the create/duplicate/crash/outage checkpoint in `packages/platform-ui/src/operational-authority/operational-authority-panel.tsx`, `packages/platform-ui/src/index.ts`, `packages/competency-qa/src/ui/contribution.tsx`, `tests/e2e/003-us1-central-request.spec.ts` and `tools/verification/003-us1-checkpoint.mts`

**Checkpoint**: US1 is the local MVP and is independently complete at T069.

---

## Phase 4 — US2: import a QA Request created directly in Jira (P1)

**Goal**: adopt one supported in-scope issue created by a verified human, invoke QA completeness, and safely ignore/quarantine every foreign or unverifiable candidate.

**Independent test**: seed a direct in-scope issue with incomplete DoR and verified creator; webhook/reconciliation converge to one imported Work Item in QA `NEEDS_INFO` while an adjacent project issue leaks no content and creates nothing.

### Tests first

- [x] T070 [P] [US2] Write import-intent/routing/sanitized-diagnostic contract tests in `tests/contract/003/us2-import-intent.spec.ts`
- [x] T071 [P] [US2] Write exact JQL/project/type/discriminator scope and adjacent-issue rejection tests in `tests/integration/003/us2-import-scope.spec.ts`
- [x] T072 [P] [US2] Write verified-human, revoked/unverified subject and forbidden email-match tests in `tests/integration/security/003/us2-import-identity.spec.ts`
- [x] T073 [P] [US2] Write incomplete imported request→QA completeness→`NEEDS_INFO` without invented Jira status in `tests/integration/003/us2-import-completeness.spec.ts`
- [x] T074 [P] [US2] Write duplicate webhook/reconcile and concurrent create/import convergence tests in `tests/integration/003/us2-import-race.spec.ts`
- [x] T075 [P] [US2] Write Cloud delivery/retry and DC changelog/hash fallback, rotated secret overlap and dynamic renewal/expiry tests in `tests/integration/security/003/us2-webhook-lifecycle.spec.ts`
- [x] T076 [P] [US2] Write cross-workspace/connection/Profile denial and no-content-disclosure tests in `tests/integration/security/003/us2-import-isolation.spec.ts`

### Implementation

- [x] T077 [US2] Emit minimal candidates only from strict published import JQL and authoritative provider reads in `packages/connector-jira/src/import/import-candidate-source.ts`
- [x] T078 [US2] Enforce project/type/discriminator/Profile pins before mapping or disclosing issue content in `packages/connector-jira/src/import/import-router.ts`
- [x] T079 [US2] Normalize creator proof and resolve only live verified external-subject bindings in `packages/connector-jira/src/import/import-identity.ts`
- [x] T080 [US2] Advance durable import intents and atomically converge Work Item/binding/projection under unique external identity in `packages/platform-core/src/work-management/operational-import.ts` and `packages/platform-persistence-typeorm/src/operational-import.repository.ts`
- [x] T081 [US2] Export and invoke the QA-owned operational-import/completeness hook without Jira knowledge in `packages/competency-qa/src/application/on-operational-import.ts`, `packages/competency-qa/src/index.ts` and `packages/platform-persistence-typeorm/src/operational-authority-unit-of-work.ts`
- [x] T082 [US2] Implement dialect-specific webhook verification/renewal health and route webhook/reconciliation candidates through one import service in `packages/runtime-composition/src/jira/webhook-handlers.ts` and `packages/runtime-composition/src/jira/reconciliation-jobs.ts`
- [x] T083 [US2] Expose scoped redacted import diagnostics in `packages/platform-runtime-nest/src/http/operational-authority.controller.ts`
- [x] T084 [US2] Render imported origin/completeness and emit content-free routing/adoption audit in `packages/platform-ui/src/operational-authority/operational-authority-panel.tsx`, `packages/competency-qa/src/ui/contribution.tsx` and `packages/connector-jira/src/observability.ts`
- [x] T085 [US2] Add verified/out-of-scope/race/dynamic-webhook Mock Hub scenarios in `apps/mock-hub/src/jira/jira-scenarios.ts`
- [x] T086 [US2] Execute the independent direct-import E2E in `tests/e2e/003-us2-direct-import.spec.ts`
- [x] T087 [US2] Persist the US2 checkpoint with fixture/config/contract hashes in `tools/verification/003-us2-checkpoint.mts` and `reports/003-jira-operational-authority/us2.json`

**Checkpoint**: US2 is independently testable from a pre-existing external issue and does not depend on executing US1.

---

## Phase 5 — US3: authoritative sync, reconciliation and exact approved commands (P1)

**Goal**: project human Jira changes monotonically and execute only typed, exactly approved transition/assignment/priority/due actions against the server-derived expected projection.

**Independent test**: seed a binding, lose/reorder webhooks and recover by reconciliation; approve each action, mutate Jira before dispatch, and prove stale commands create visible conflict with zero overwrite.

### Tests first

- [x] T088 [P] [US3] Prove webhook payload values are only hints and cannot directly mutate projection in `tests/integration/003/us3-webhook-projection.spec.ts`
- [x] T089 [P] [US3] Write duplicate/out-of-order/equal-time/changelog-gap/same-token-different-hash tests in `tests/integration/003/us3-projection-ordering.spec.ts`
- [x] T090 [P] [US3] Write Cloud token/DC offset overlap, invalid-token restart, key rename, partial run, known-ID refresh and 429 tests in `tests/integration/003/us3-reconciliation.spec.ts`
- [x] T091 [P] [US3] Write current/stale/unknown timing and Profile-local mapping-drift tests in `tests/integration/003/us3-freshness-drift.spec.ts`
- [x] T092 [P] [US3] Write If-Match/server-derived expected-state and closed body tests for all four action routes in `tests/contract/003/us3-operational-actions.spec.ts`
- [x] T093 [P] [US3] Write exact one-time approval, live RBAC/entitlement/policy, expiry/revoke and separation-of-duties matrix in `tests/integration/security/003/us3-command-approvals.spec.ts`
- [x] T094 [P] [US3] Write known-stale pre-read mismatch tests proving terminal conflict and zero Jira write in `tests/integration/003/us3-stale-command.spec.ts`
- [x] T095 [P] [US3] Write human TOCTOU/post-read mismatch and arbitrary Jira 409 tests with explicit conflict/ambiguity outcomes in `tests/integration/003/us3-post-write-conflict.spec.ts`
- [x] T096 [P] [US3] Write two workers/two approvals/same issue, lane fencing and ambiguity-blocks-next-command tests in `tests/integration/003/us3-command-concurrency.spec.ts`
- [x] T097 [P] [US3] Write Profile-pinned 1.0 versus 1.1 transition, verified assign/unassign, mapped priority and due/clear conformance in `tests/contract/003/us3-jira-command-conformance.spec.ts`
- [x] T098 [P] [US3] Write 401/403 stop, 429 budget, 5xx/timeout reconcile-before-retry and drift error tests in `tests/integration/003/us3-command-errors.spec.ts`
- [x] T099 [P] [US3] Write assignment external-subject resolution and client/provider-ID smuggling rejection tests in `tests/integration/security/003/us3-assignment-identity.spec.ts`

### Implementation

- [x] T100 [US3] Read complete authority fields and derive dialect-aware updated/changelog/hash revision tokens in `packages/connector-jira/src/operational/issue-observation.ts`
- [x] T101 [US3] Apply observations monotonically and update the current pointer/event atomically in `packages/platform-core/src/work-management/operational-projection.ts`
- [x] T102 [US3] Consume one verified inbox marker, schedule authoritative reread and never promote webhook body values in `packages/runtime-composition/src/jira/webhook-handlers.ts`
- [x] T103 [P] [US3] Implement Cloud enhanced-JQL token paging and known-ID reconciliation in `packages/connector-jira/src/reconciliation/jira-cloud-search.ts`
- [x] T104 [P] [US3] Implement DC offset paging and pinned-build capability checks in `packages/connector-jira/src/reconciliation/jira-dc-search.ts`
- [x] T105 [US3] Schedule import/bound-refresh/full-drift lanes with leases, budgets and safe cursor commits in `packages/runtime-composition/src/jira/reconciliation-jobs.ts`
- [x] T106 [US3] Quarantine only the affected Profile and derive freshness without appending fake observations in `packages/runtime-composition/src/jira/profile-validation.ts` and `packages/platform-core/src/work-management/operational-projection.ts`
- [x] T107 [US3] Resolve If-Match to the current server projection and persist exact expected state plus ordered chain set in `packages/platform-core/src/work-management/operational-authority.ts`
- [x] T108 [US3] Export QA-owned provider-neutral transition/assignment/priority/due intents in `packages/competency-qa/src/application/operational-action-intents.ts` and `packages/competency-qa/src/index.ts`
- [x] T109 [US3] Create exact one-time Approval subjects over command, expected state and full primary/auxiliary pins in `packages/platform-core/src/approval/external-command-approval.ts`
- [x] T110 [US3] Claim the fenced target lane, resolve trusted external subject and fresh-compare expected state before any call in `packages/connector-jira/src/operational/jira-command-guard.ts`
- [x] T111 [P] [US3] Implement currently available Profile-mapped transition selection in `packages/connector-jira/src/operational/request-transition.ts`
- [x] T112 [P] [US3] Implement trusted provider-subject assignment/unassign in `packages/connector-jira/src/operational/request-assign.ts`
- [x] T113 [P] [US3] Implement closed priority and due-date/clear minimum patches in `packages/connector-jira/src/operational/request-set-priority.ts` and `packages/connector-jira/src/operational/request-set-due-date.ts`
- [x] T114 [US3] Perform mandatory post-read and classify confirmed/conflict/ambiguous without echoing requested values in `packages/connector-jira/src/operational/jira-command-confirmation.ts`
- [x] T115 [US3] Atomically terminalize command/approval/lane, append conflict and apply newest observation in `packages/platform-persistence-typeorm/src/operational-authority.repository.ts`
- [x] T116 [US3] Expose action/reconciliation APIs and provider-neutral projection/conflict UI/audit in `packages/platform-runtime-nest/src/http/operational-authority.controller.ts`, `packages/platform-ui/src/operational-authority/operational-authority-panel.tsx`, `packages/platform-ui/src/operational-authority/operational-conflict-panel.tsx`, `packages/competency-qa/src/ui/contribution.tsx` and `packages/connector-jira/src/observability.ts`
- [x] T117 [US3] Run the independent sync/four-action/stale-conflict checkpoint in `tests/e2e/003-us3-sync-conflict.spec.ts` and `tools/verification/003-us3-checkpoint.mts`

**Checkpoint**: US3 works from a seeded binding. Only authoritative reads change projection; every write is exact-approved and terminally confirmed/conflicted/ambiguous.

---

## Phase 6 — US4: one approved defect in the owning Jira project (P1)

**Goal**: publish an already approved PRODUCT defect draft through a separate Defect Profile, creating one defect and exact request/evidence links with recoverable sub-effects.

**Independent test**: seed a final 002 defect draft and request binding, replay/crash publication and prove one defect/DefectLink; reject or misroute and prove zero Jira calls.

### Tests first

- [x] T118 [P] [US4] Write unchanged 1.0 target/defect payload, marker, ordered auxiliary-chain, required-field and link result vectors in `tests/contract/003/us4-defect-create.spec.ts`
- [x] T119 [P] [US4] Write approval replay/concurrency/revoke-before-effect tests in `tests/integration/security/003/us4-defect-approval.spec.ts`
- [x] T120 [P] [US4] Write lost response/eventual-zero search, partial link/comment and restart recovery tests in `tests/integration/003/us4-defect-recovery.spec.ts`
- [x] T121 [P] [US4] Separate exact effect replay from heuristic duplicate candidates in `tests/integration/003/us4-defect-duplicate-policy.spec.ts`
- [x] T122 [P] [US4] Write wrong destination/authority namespace/Profile, rejected draft and evidence-classification zero-call tests in `tests/integration/security/003/us4-defect-routing.spec.ts`

### Implementation

- [x] T123 [US4] Export immutable QA-owned approved defect intent with exact Finding/session/build/evidence refs in `packages/competency-qa/src/application/publish-defect-draft.ts` and `packages/competency-qa/src/index.ts`
- [x] T124 [US4] Resolve the primary DEFECT_DESTINATION plus auxiliary QA_REQUEST_AUTHORITY chain and deterministic allowed-field mapping in `packages/runtime-composition/src/jira/composition.ts` and `packages/connector-jira/src/operational/defect-create-mapper.ts`
- [x] T125 [US4] Implement exact marker lookup and create/read only after proven absence in `packages/connector-jira/src/operational/defect-create.ts`
- [x] T126 [P] [US4] Return heuristic duplicate candidates for human decision only in `packages/connector-jira/src/operational/defect-duplicate-search.ts`
- [x] T127 [US4] Create exact request/session/build/evidence link/reference sub-effects under published authority strategy in `packages/connector-jira/src/operational/defect-links.ts`
- [x] T128 [US4] Reconcile partial sub-effects and perform final authoritative defect read-back in `packages/connector-jira/src/operational/defect-create-reconciliation.ts`
- [x] T129 [US4] Confirm and export one QA DefectLink through the generic hook/UoW in `packages/competency-qa/src/application/on-defect-confirmed.ts`, `packages/competency-qa/src/index.ts` and `packages/runtime-composition/src/extensions/confirmation-hooks.ts`
- [x] T130 [US4] Expose publication state/UI/audit without raw provider content in `packages/platform-runtime-nest/src/http/operational-authority.controller.ts`, `packages/platform-ui/src/operational-authority/operational-authority-panel.tsx` and `packages/connector-jira/src/observability.ts`
- [x] T131 [US4] Execute the independent approved/replay/crash/wrong-destination E2E in `tests/e2e/003-us4-approved-defect.spec.ts`
- [x] T132 [US4] Persist the US4 checkpoint with exact approval/effect/sub-effect/DefectLink trace in `tools/verification/003-us4-checkpoint.mts` and `reports/003-jira-operational-authority/us4.json`

**Checkpoint**: US4 is independently seedable from final 002 artifacts and yields exactly one confirmed defect/link or a visible no-blind-retry terminal outcome.

---

## Phase 7 — Cross-cutting hardening, executable quickstart and release evidence

- [x] T133 [P] Re-run full import graph, package export and no-runtime-loading gates including both Jira packages in `tests/architecture/003-jira-boundaries.spec.ts` and `tools/architecture/check-import-graph.mts`
- [x] T134 [P] Add generated API snapshot and runtime route/schema drift checks in `apps/api/openapi.generated.json` and `tests/contract/003/openapi-runtime-drift.spec.ts`
- [x] T135 [P] Add AsyncAPI topic/envelope/payload compatibility tests for import/projection/conflict/drift/reconciliation/rejected-webhook events in `tests/contract/003/asyncapi-events.spec.ts`
- [x] T136 [P] Add multi-feature offline registry parity, positive/negative examples and 1.0 regression in `tests/contract/003/schema-registry-parity.spec.ts`
- [x] T137 [P] Run PostgreSQL 17/18 fresh/upgrade/repeat/failed-recovery/lock timing for all 003 migrations in `tools/ci/verify-003-migrations.mts`
- [x] T138 [P] Add cross-workspace/project/connection/Profile isolation and enumeration-resistance coverage in `tests/integration/security/003/isolation-hardening.spec.ts`
- [x] T139 [P] Add webhook forgery/replay, redirect/SSRF, secret/raw-payload/PII redaction and log scanning in `tests/integration/security/003/connector-hardening.spec.ts`
- [x] T140 [P] Inject 401/403/429/5xx/timeout/schema drift/unknown lookup across every operation in `tests/integration/003/jira-error-matrix.spec.ts`
- [x] T141 [P] Add concurrent create/import/command/reconciliation and crash-restart chaos coverage in `tests/integration/003/jira-chaos-recovery.spec.ts`
- [x] T142 [P] Add rate saturation, fair scheduling, webhook renewal and freshness-SLO coverage in `tests/integration/003/jira-rate-freshness.spec.ts`
- [x] T143 [P] Prove end-to-end human→approval/command→all config pins→Jira calls→read confirmation audit reconstruction in `tests/integration/security/003/audit-lineage.spec.ts`
- [x] T144 Implement deterministic local Jira CLI/scenario controls and one-command smoke in `tools/local/jira-cli.mts`, `tools/local/jira-scenario.mts` and `tools/smoke/feature-003.mts`
- [x] T145 Add the full Requester→central request→direct import→Executor sync/action→approved defect browser journey in `tests/e2e/003-jira-operational-authority.spec.ts`
- [x] T146 Automate every local quickstart command/invariant and fail on orphaned documentation steps in `tools/verification/003-quickstart.mts`
- [x] T147 Validate supplied C1, exact adapter/build, TLS/network allowlist, permissions, webhook/rate and concurrency evidence in `tools/verification/feature-003-nonprod-metadata.mts`
- [x] T148 Implement opt-in selected-family live non-prod conformance with sanitized `PASS | FAIL | SKIPPED_GATED` evidence and no production target support in `tools/verification/feature-003-nonprod.mts`
- [x] T149 Document auth rotation, dynamic webhook renewal, drift, ambiguity, backlog/freshness and safe disablement in `docs/runbooks/jira-operational-authority.md`
- [x] T150 Build FR/SC/source-of-truth/contract/task/evidence trace and fail on missing links in `tools/verification/feature-003-trace.mts` and `reports/003-jira-operational-authority/traceability.json`
- [x] T151 Aggregate typecheck/lint/unit/contract/integration/security/E2E/non-prod status and post-design constitution decision in `tools/verification/feature-003-gate.mts`, `reports/003-jira-operational-authority/final-gate.json` and `specs/003-jira-operational-authority/release-readiness.md`

---

## Dependencies and execution order

### Phase dependencies

- Phase 1 has no code dependency. T002 is RED before T003. T015 joins T001–T014 and final 001/002 outputs.
- Phase 2 depends on a green T015. T016–T032 are written/observed RED before T033. T053 joins all Foundation work and blocks every story.
- US1, US2, US3 and US4 each depend on T053 and are independently seedable. Shared wiring tasks are serialized as listed below.
- Phase 7 begins after the checkpoints in the chosen release scope; T145/T150/T151 require all four story checkpoints.
- Phase 8 depends on T151. T152–T160 close the process-level convergence gaps, T161/T162 establish the exact CI/evidence contract, and T163 synchronizes the handoff prose before the final aggregate rerun.

### Critical chains

- Prerequisites: T001 → T002 → T003 → T004 → T015.
- Contracts/boundaries: T016–T019 → T033–T041 → T051–T053.
- Core authority: T020–T024 → T034–T043 → T053.
- Jira protocol: T025–T032 → T044–T052 → T053.
- US1: T054–T059 RED → T060–T068 → T069.
- US2: T070–T076 RED → T077–T086 → T087.
- US3: T088–T099 RED → T100–T116 → T117.
- US4: T118–T122 RED → T123–T131 → T132.
- Release: T069 + T087 + T117 + T132 → T145 → T150 → T151.
- Convergence/handoff: T151 → T152–T160 → T161 → T162 → T163 → final task-bound aggregate gate.

### Shared-file serialization

- `packages/runtime-composition/src/jira/composition.ts`: T051 → T068 → T124.
- `packages/runtime-composition/src/jira/reconciliation-jobs.ts`: T051 → T082 → T105.
- `packages/platform-core/src/work-management/operational-projection.ts`: T035 → T101/T106.
- `packages/platform-persistence-typeorm/src/operational-authority.repository.ts`: T042 → T115.
- `packages/platform-runtime-nest/src/http/operational-authority.controller.ts`: T068 → T083 → T116 → T130.
- `packages/competency-qa/src/ui/contribution.tsx`: T069 → T084 → T116.
- `packages/connector-jira/src/observability.ts`: T084 → T116 → T130.
- Root/app manifests and lockfile: T010 → T052.

### Story independence

- US1 seeds a confirmed Intake Draft.
- US2 seeds a direct external issue and never runs US1.
- US3 seeds a bound Work Item/projection and never runs US1/US2.
- US4 seeds a final 002 approved defect draft plus request binding and never runs earlier 003 stories.
- Integrated rollout order remains US1 → US2 → US3 → US4.

## Parallel examples

`@text
Foundation RED:
T016 capability compatibility || T017 design contracts || T018 boundaries
T021 chain pins               || T022 target lane      || T023 identity/import
T024 projection/conflict      || T025 webhook          || T026 profiles
T027 mapping                  || T028 dialects         || T029 auth
T030 effect recovery          || T031 reconciliation  || T032 Mock Hub

After T053:
Team A T054–T069 (US1)
Team B T070–T087 (US2)
Team C T088–T117 (US3)
Team D T118–T132 (US4)

US3 handlers after T110:
T111 transition || T112 assignment || T113 priority/due
`@

## Independent acceptance

| Slice | Seed | Required proof |
|---|---|---|
| Foundation | local C1 + Mock Hub | closed contracts, clean boundaries, migrations, raw webhook, Cloud/DC normalization, old composition regression |
| US1 | confirmed Draft | one issue/Work Item/binding, stable replay/recovery, outage/unknown lookup without fake state |
| US2 | direct in-scope issue | verified-human one-time import, QA `NEEDS_INFO`, safe foreign ignore, race convergence |
| US3 | bound Work Item | monotonic projection, lost-event recovery, four exact approvals, stale zero-write conflict and fenced serialization |
| US4 | approved PRODUCT defect draft | one defect/DefectLink, exact replay, partial-effect recovery, rejected/wrong scope zero calls |
| Release | all checkpoints + optional live C1 | audit chain, error/security matrix, freshness target, deterministic local smoke, sanitized live status |

## Requirement trace

| Requirement group | Primary tasks |
|---|---|
| FR-001…FR-005 | T005–T007, T013–T015, T026, T028–T029, T045–T047, T147–T149 |
| FR-006…FR-012 | T016–T017, T026–T027, T033, T046–T049, T091, T106 |
| FR-013…FR-015 | T021–T024, T034–T043, T068–T069, T100–T101, T116 |
| FR-016…FR-020 | T023, T054–T087 |
| FR-021…FR-025 | T025, T030–T032, T044, T048–T052, T075, T082, T088–T106 |
| FR-026…FR-029 | T022, T029–T030, T092–T117, T118–T132, T140 |
| SC-001 | T056, T074, T069, T087 |
| SC-002 | T088–T090, T101–T105, T117 |
| SC-003 | T093–T096, T109–T115, T117 |
| SC-004 | T090–T091, T103–T106, T142 |
| SC-005 | T118–T132 |
| SC-006 | T014, T029, T059, T072, T093, T119, T122, T138–T139, T147–T148 |
| SC-007 | T084, T116, T130, T143, T150–T151 |

## MVP and incremental delivery

1. Stop immediately if T015 is red.
2. Complete Foundation through T053.
3. Complete US1 through T069 and demo it as the local MVP.
4. Add US2, then observation/reconciliation before enabling US3 write handlers.
5. Add US4 only against final 002 approval/confirmation hooks.
6. Complete hardening and optional live non-prod; production writes remain excluded.

## Task summary

- Setup/prerequisites: 15.
- Foundational: 38.
- US1: 16.
- US2: 18.
- US3: 30.
- US4: 15.
- Cross-cutting/release: 19.
- Convergence: 12.
- **Total: 163 tasks.**

## Notes

- Exact marker replay and heuristic duplicate candidates are different mechanisms.
- `UNKNOWN` marker visibility never permits another create.
- Webhooks schedule authoritative reads; they are never projection truth.
- Freshness expiry is derived and appends no projection revision.
- Old commands/approvals never resume after conflict/ambiguity; a new human decision creates new identities.
- Profile upgrades never retarget pending effects or history.
- Multi-step links/comments/properties have durable individual receipts.
- Pure `connector-jira` stays TypeORM-free; Jira rows live in its separate persistence contribution.
- Do not add temporary QA entities/hooks to bypass unfinished 002.

---

## Phase 8: Convergence

**Purpose**: replace in-process acceptance facades with the specified runnable `qa-jira-local` composition, durable effect path and process-level evidence before Feature 003 is declared complete.

- [x] T152 CRITICAL Wire `qa-jira-local` API/worker composition to the real `@awp/connector-jira` HTTP adapter, Jira TypeORM repositories and persistent Mock Hub Jira repository instead of `connector-mock`/in-memory runtime substitutions per US1/AC3, plan §9 and Constitution X (contradicts)
- [x] T153 CRITICAL Replace the `qa-jira-local` no-op dispatcher/recovery/command loops with durable command/outbox claims, Jira effect execution, authoritative read-back and restart recovery in `apps/worker/src/app.module.ts` and `packages/runtime-composition/src/jira/` per FR-020, SC-001 and Constitution IX (missing)
- [x] T154 CRITICAL Connect raw Jira webhook ingress to signature/replay/scope validation plus the durable TypeORM inbox before ACK, and schedule authoritative reads rather than applying payload truth in `apps/api/src/app.module.ts` and Jira runtime composition per FR-021…FR-024 and Constitution IX (contradicts)
- [x] T155 CRITICAL Complete one process-level US1 vertical slice from confirmed intake through durable command/outbox, non-noop worker, Jira HTTP Mock Hub effect, authoritative read-back and atomic Draft/Work Item/binding/projection confirmation per US1/AC1…AC4 and SC-001 (partial)
- [x] T156 Complete process-level US2 direct-import wiring for verified-human routing, durable webhook/reconciliation convergence, completeness and cross-scope denial per US2, FR-018…FR-020 and SC-001 (partial)
- [x] T157 Replace stub operational action/reconciliation APIs and complete process-level US3 projection, freshness, exact approval, target-lane execution and visible conflict wiring per US3, FR-023…FR-029 and SC-002…SC-004 (partial)
- [x] T158 Complete process-level US4 approved defect publication, sub-effect recovery, authoritative confirmation and QA DefectLink hook wiring per US4, FR-027…FR-029 and SC-005 (partial)
- [x] T159 Add a real Playwright Chromium journey against launched Web/API/worker/PostgreSQL/Mock Hub for Requester create, direct import, Executor sync/action and approved defect, and include it in `playwright.config.ts` and the final gate per plan §3/§10.4 and T145 intent (missing)
- [x] T160 Make `smoke:003` and the quickstart verifier start/use `qa-jira-local`, execute documented commands/scenarios, inspect durable PostgreSQL and Mock Hub effects, and fail on unexecuted invariants per T144/T146 intent and SC-001…SC-007 (contradicts)
- [x] T161 Enforce exact Node.js 24.20.0 prerequisites inside the aggregate gate, make `ci:003` execute the full gate in a repository CI workflow, and align partial `test:003`/`ci:003` command names with their actual coverage per plan §3 and T151 intent
- [x] T162 Regenerate current task-bound evidence only after all process-level gates pass, ensure report hashes/statuses cannot remain green after task/runtime drift, and make authoritative Feature 003 reports handoff-safe per SC-007 and T150/T151 intent (partial)
- [x] T163 Update `spec.md`, `plan.md`, `tasks.md` status prose and root `README.md` to distinguish verified local implementation, optional live non-prod `SKIPPED_GATED`, and excluded production writes after the convergence gate passes per release-readiness policy (partial)
