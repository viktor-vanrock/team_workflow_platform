# Tasks: Queue, triage, capacity and SLA

**Input**: Design documents from /specs/006-queue-triage-capacity-sla/

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md, Constitution 2.0.0

**Tests**: Required. The specification defines independent acceptance scenarios, and the plan/quickstart require contract, unit, migration, concurrency, security, integration, browser, restart, and evidence gates. Tests are authored before the corresponding implementation and must fail for the intended reason before implementation begins.

**Organization**: Tasks are grouped by setup, shared foundation, and the five user stories in specification order. Core migrations 0130/0135/0140 and QA migration 2070 are created once with their complete shapes in Phase 2; later phases add behavior without rewriting applied migrations.

## Format: [ID] [P?] [Story?] Description with file path

- **[P]**: Can run in parallel after phase prerequisites because it owns different files and has no dependency on an incomplete task.
- **[US1]–[US5]**: Maps US-001 through US-005 from spec.md; story labels appear only in story phases.
- Every task names the concrete file or files it owns.

---

## Phase 1: Setup and fail-closed entry gates

**Purpose**: Establish trustworthy upstream evidence, governance checks, contract-generation entrypoints, and Feature 006 command/report shells before runtime work.

- [X] T001 [P] Add missing, stale, source-drift, contract-drift, migration-drift, and Feature 002–005 compatibility vectors in tests/contract/006/prerequisite-gate.spec.ts
- [X] T002 [P] Add Constitution 2.0 authority, Jira ownership, entitlement-before-aggregation, exact-approval, model-independence, local-only contour, and no-production-action vectors in tests/contract/006/governance-gate.spec.ts
- [X] T003 Replace obsolete Core-0095/QA-2030 tail assertions with owner-range, monotonic-order, immutability, and current additive registry checks in tests/integration/002-qa-foundation-composition.spec.ts, tests/integration/migrations/002-qa-migration-order.spec.ts, and tests/integration/migrations/us2-composition.spec.ts
- [X] T004 Register the immutable Feature 006 design-contract contribution at order 600 in packages/platform-contracts/src/schema-contributions.ts
- [X] T005 Extend the OpenAPI snapshot builder with both Feature 006 documents and their schema root in tools/contracts/build-openapi-snapshots.mts
- [X] T006 Implement strict offline JSON Schema/OpenAPI/AsyncAPI/example/ref/JCS validation for Feature 006 in tools/contracts/verify-006-contracts.mts
- [X] T007 [P] Define the closed documented scenario ID catalog and reject unknown/duplicate IDs in tools/local/queue-scenario-catalog.mts
- [X] T008 Wire planned test:contract:006, test:architecture:006, test:unit:006, test:concurrency:006, test:integration:006, test:security:006, test:e2e:006, test:browser:006, verify:006:*, local:queue:*, queue:scenario, smoke:006, trace:006, and ci:006 entrypoints in package.json and tools/ci/feature-006-tests.mts
- [X] T009 [P] Implement the source/task/runtime-bound upstream evidence verifier in tools/verification/feature-006-prerequisites.mts and emit reports/006-queue-triage-capacity-sla/prerequisites.json atomically
- [X] T010 [P] Implement the constitutional authority and deployment-boundary verifier in tools/verification/feature-006-governance.mts and emit reports/006-queue-triage-capacity-sla/governance.json atomically
- [X] T011 Aggregate prerequisite, governance, contract, contour, and package checks with exact PASS/SKIPPED_GATED semantics in tools/verification/006-setup-gate.mts and reports/006-queue-triage-capacity-sla/setup-gate.json
- [X] T012 Execute the Phase 1 checks and keep the setup checkpoint failing closed until every owned report is fresh in tools/verification/006-setup-gate.mts

**Checkpoint**: verify:006:setup validates current upstream evidence and all design contracts, accepts only qa-jira-gitlab-mattermost-local, and grants no production or deployment authority.

---

## Phase 2: Shared blocking foundation

**Purpose**: Publish contracts, exact operation identities, migrations, entity/repository shells, additive Approval/QA compatibility, and static composition required by every story.

**Critical**: No user-story implementation starts until this phase is complete.

### Foundation tests — author and observe RED first

- [X] T013 [P] Validate all 16 schemas, nine declared examples, semantic calendar negative, closed unions, absolute IDs, offline refs, and RFC 8785/JCS digests in tests/contract/006/design-contracts.spec.ts
- [X] T014 [P] Validate the 11 queue OpenAPI operations, additive two-operation Approval v1/v2 response union, six AsyncAPI channels, 15 messages, exact payload pins, and operation/path uniqueness in tests/contract/006/openapi-asyncapi.spec.ts
- [X] T015 [P] Validate all queue.* operations, permissions, trusted server context, forbidden generic aliases, authorization/capability/availability separation, and contribution order 600 in tests/contract/006/capability-compatibility.spec.ts
- [X] T016 [P] Validate frozen Approval v1 compatibility, Approval v2 EXTERNAL_COMMAND/PLATFORM_ACTION branches, candidate target binding, SELF_APPROVAL_FORBIDDEN, safe authorization witnesses, and receipt lifecycle/result-family closure in tests/contract/006/approval-v2-compatibility.spec.ts
- [X] T017 [P] Validate canonical schema/content/action/evaluation hashes, non-recursive self-ref boundaries, durable ref resolution after restart, and hidden-only hash stability in tests/contract/006/canonical-hash-boundaries.spec.ts
- [X] T018 [P] Pin serialized competency-qa/qa.validation V12 bytes and verify distinct V13 identities, six corrected Feature 005 event refs, four appended event refs, exact JCS digests, and unchanged connector requirements in tests/contract/006/qa-manifest-v13.spec.ts
- [X] T019 [P] Enforce Core/QA/runtime/API/UI ownership, no Connector/model dependency in pure reducers, no BullMQ business authority, static loading, and no new service boundary in tests/architecture/006/queue-boundaries.spec.ts and tests/architecture/006/runtime-wiring.spec.ts
- [X] T020 [P] Add owner/order/collision/no-cross-owner-DDL/entity-parity checks for Core 0130/0135/0140 and QA 2070 in tests/integration/migrations/006-migration-registry.spec.ts
- [X] T021 [P] Add PostgreSQL 17/18 fresh, upgrade from Core 0120/QA 2060, repeat, current-minus-one, failed-migration recovery, append-only guard, and V12-byte-stability coverage in tests/integration/migrations/006-queue-foundation.spec.ts
- [X] T022 [P] Prove composite Workspace/Project references, tagged subject union, exact scope-membership rehashing, reverse membership indexes, immutable revision chains, and no global-ID-only fetch in tests/integration/006/scoped-foundation-persistence.spec.ts
- [X] T023 [P] Validate canonical EventEnvelope parity, new READY envelope bytes, legacy payload-only replay, per-field envelope/payload mismatch quarantine, and mutually exclusive event pairs in tests/contract/006/event-envelope-binding.spec.ts

### Foundation implementation

- [X] T024 Generate and register Feature 006 schemas with collision/order/digest enforcement in packages/platform-contracts/src/generated/schema-documents.ts and packages/platform-contracts/src/schema-registry.ts
- [X] T025 Regenerate standalone API and Mock Hub OpenAPI snapshots with the primary queue and additive Approval 1.1 surfaces in apps/api/openapi.generated.json and apps/mock-hub/openapi.generated.json
- [X] T026 Define the closed queue operation/permission catalog and classification rules in packages/platform-core/src/work-management/queue-authorization.ts and packages/platform-runtime-nest/src/auth/authorization-contributions.ts
- [X] T027 [P] Define exact queue subject/source refs, authorization-safe read tokens, query ports, and availability/capability ports in packages/platform-core/src/work-management/queue-query-ports.ts
- [X] T028 [P] Implement immutable queue-policy/business-calendar types, MEASURE_ONLY/ENFORCED publication invariants, public neutral/facet projections, and canonical hashes in packages/platform-core/src/work-management/queue-policy.ts
- [X] T029 [P] Implement additive Approval v2 parsing, construction, hashing, exact candidate/local-state binding, and v1 read compatibility in packages/platform-core/src/approval/approval-subject-v2.ts and packages/platform-core/src/approval/approval.ts
- [X] T030 Implement same-action public QueueActionCandidate/private QueueControlAction mapping, hash verification, safe witness projection, fail-closed consumer registration, and explicit foundation queue/Approval exports in packages/platform-core/src/approval/queue-action-consumer.ts, packages/platform-core/src/approval/platform-action-executor.ts, and packages/platform-core/src/index.ts
- [X] T031 Extend Approval and PlatformAction persistence for immutable subject-v2 schema identity plus same-ID candidate/private witnesses in packages/platform-persistence-typeorm/src/approval.repository.ts and packages/platform-persistence-typeorm/src/platform-action.repository.ts
- [X] T032 Implement complete schema-only Core 0130 calendar, policy, publication-request, neutral-view, Project-facet, authorized-facet, and membership tables in packages/platform-persistence-typeorm/src/migrations/core/0130-queue-policy-calendar.ts
- [X] T033 Add Core 0130 entity parity, constraints, indexes, and append-only guards in packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts
- [X] T034 Implement scoped calendar/policy publication, neutral/facet reads, exact membership reconciliation, and hidden-only no-op revision behavior in packages/platform-persistence-typeorm/src/queue-policy.repository.ts and packages/platform-persistence-typeorm/src/authorized-scope-membership.repository.ts
- [X] T035 Implement complete schema-only Core 0135 generation, queue-entry, SLA-clock/segment/threshold, due-index, and rollout-verification tables in packages/platform-persistence-typeorm/src/migrations/core/0135-queue-projection-sla.ts
- [X] T036 Extend Core queue entity parity with 0135 constraints, indexes, tagged subject union, due scans, and append-only guards in packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts
- [X] T037 Register scoped repository shells for queue projection, SLA clocks, threshold emissions, and rollout receipts in packages/platform-persistence-typeorm/src/queue-projection.repository.ts, packages/platform-persistence-typeorm/src/sla-clock.repository.ts, and packages/platform-persistence-typeorm/src/sla-rollout-verification.repository.ts
- [X] T038 Implement complete schema-only Core 0140 control, order-scope/membership/override/invalidation, action-pair, capacity-head/projection/membership, claim/reservation, and admission-decision tables in packages/platform-persistence-typeorm/src/migrations/core/0140-queue-controls-capacity.ts
- [X] T039 Complete Core queue entity parity with 0140 partial indexes, closed states, scope checks, expiry rules, and append-only guards in packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts
- [X] T040 Register scoped repository shells for controls, order scopes/invalidations, and immutable public/private action pairs in packages/platform-persistence-typeorm/src/queue-control.repository.ts, packages/platform-persistence-typeorm/src/queue-order-invalidation.repository.ts, and packages/platform-persistence-typeorm/src/queue-action-candidate.repository.ts
- [X] T041 Register scoped repository shells for capacity heads, authorized projections/membership, claims, reservations, and decisions in packages/platform-persistence-typeorm/src/capacity-scope-projection.repository.ts and packages/platform-persistence-typeorm/src/capacity-admission.repository.ts
- [X] T042 Register Core 0130/0135/0140, all new entities/repositories, and package exports in packages/platform-persistence-typeorm/src/migrations/core/index.ts, packages/platform-persistence-typeorm/src/entities/composition.ts, and packages/platform-persistence-typeorm/src/index.ts
- [X] T043 Implement complete schema-only QA 2070 queue-fact head/revision/current-index tables without Core table reads in packages/competency-qa/src/persistence/migrations/2070-qa-queue-facts.ts
- [X] T044 Add QA 2070 entity parity plus scoped append-only queue-fact repository behavior in packages/competency-qa/src/persistence/entities.ts and packages/competency-qa/src/persistence/queue-fact.repository.ts
- [X] T045 [P] Define provider-neutral QaQueueFacts, exact source families, sorted source-set hashing, invalidation payloads, and QA contribution interfaces in packages/competency-qa/src/application/queue-facts.ts and packages/competency-qa/src/application/domain-events.ts
- [X] T046 Implement frozen additive qaCompetencyManifestV13 and qaValidationWorkTypeDefinitionV13 with exact event/digest corrections and queue UI contribution in packages/competency-qa/src/manifest-v1.3.ts
- [X] T047 Register V13 exports, schema/operation contributions, QA 2070 migration, runtime QA/GitLab selection, and local seed serialization while keeping V12 exports byte-identical in packages/competency-qa/src/index.ts, packages/competency-qa/src/node.ts, packages/competency-qa/src/persistence/contributions.ts, packages/competency-qa/src/persistence/migrations/index.ts, packages/runtime-composition/src/qa/contributions.ts, packages/runtime-composition/src/qa/composition.ts, packages/runtime-composition/src/gitlab/composition.ts, and packages/runtime-composition/src/seed/qa-jira-gitlab-local-seed.ts
- [X] T048 Implement one canonical envelope/payload binder with mismatch quarantine for every new producer and consumer, change future automated-session READY outbox writes to EventEnvelope, and retain only the bounded trusted-row legacy adapter in packages/platform-core/src/events/event-envelope.ts, packages/platform-core/src/events/event-processing.ts, packages/competency-qa/src/persistence/automated-session.uow.ts, and packages/runtime-composition/src/queue/qa-fact-projector.ts
- [X] T049 Statically compose foundation queue repository providers, operation/module shells, and entity/migration registrations without dynamic loading in packages/runtime-composition/src/queue/composition.ts, packages/runtime-composition/src/persistence/entity-composition.ts, packages/runtime-composition/src/migrations/composition.ts, packages/runtime-composition/src/index.ts, apps/api/src/app.module.ts, and apps/worker/src/app.module.ts
- [X] T050 Execute foundation suites RED-to-GREEN and atomically emit reports/006-queue-triage-capacity-sla/contracts.json, reports/006-queue-triage-capacity-sla/architecture.json, reports/006-queue-triage-capacity-sla/unit-matrices.json, and reports/006-queue-triage-capacity-sla/foundation.json through tools/verification/006-foundation-checkpoint.mts

**Checkpoint**: verify:006:foundation proves immutable contracts and migrations, additive Approval/QA compatibility, exact ownership, offline composition, and repository-level scope before story behavior exists.

---

## Phase 3: User Story 1 — Distinct work stages (Priority: P1) MVP

**Goal**: Show Candidate, Backlog, Ready, Active, and Completed as deterministic projections while Candidate/Backlog have no operational side effects and first consuming work creates exactly one WIP unit.

**Independent Test**: Create an unconfirmed Candidate, a confirmed Needs Info item, a DoR-confirmed item with pending Jira transition, an authoritatively confirmed Jira READY item, a first required MANUAL Session, and a confirmed terminal item; verify exact stages, separate Jira state, source refs, SLA start, and WIP effects.

### Tests for User Story 1 — author and observe RED first

- [X] T051 [P] [US1] Add complete queue-stage@1.0.0 precedence, substate, inconsistency, Candidate/Draft suppression, and PLANNED/READY Session truth tables in tests/unit/006/queue-stage.spec.ts
- [X] T052 [P] [US1] Validate QueueEntry/source-ref closure, Candidate no-Jira/no-SLA/no-WIP shape, Work Item exact refs, and stage transition payloads in tests/contract/006/us1-queue-entry-stage.spec.ts
- [X] T053 [P] [US1] Test QA fact sorting, one semantic revision, transactional qa.queue-facts.changed emission, canonical READY rows, and legacy replay dedupe in tests/integration/006/us1-qa-queue-facts.spec.ts
- [X] T054 [P] [US1] Test inbox invalidation, exact local source reread, duplicate/out-of-order no-op, precursor suppression, append-only projection revisions, and shadow rebuild equality in tests/integration/006/us1-queue-projection.spec.ts
- [X] T055 [P] [US1] Prove local DoR/pending Jira commands do not start SLA, confirmed Jira READY starts at platform confirmedAt, and missing current DoR remains Backlog with a running clock in tests/integration/006/us1-confirmed-ready-sla-start.spec.ts
- [X] T056 [P] [US1] Prove first MANUAL RUNNING/REVIEW_REQUIRED activity creates one Work Item claim, while Candidate/Backlog/PLANNED/READY and automated RUNNING do not consume human WIP in tests/integration/006/us1-first-session-wip.spec.ts
- [X] T057 [P] [US1] Prove Project scope, inaccessible/not-found parity, no provider/model calls on GET, no second Jira authority, and no Candidate operational mutation in tests/integration/security/006/us1-stage-isolation.spec.ts
- [X] T058 [P] [US1] Add the independent API/PostgreSQL/worker journey for all six US1 quickstart scenarios in tests/e2e/006/us1-distinct-stages.spec.ts

### Implementation for User Story 1

- [X] T059 [US1] Implement and export pure queue-stage@1.0.0 derivation, precedence, stable reasons, activity origins, and Jira/queue inconsistency facets in packages/platform-core/src/work-management/queue-stage.ts and packages/platform-core/src/index.ts
- [X] T060 [US1] Project current QA input/readiness/session/automation/verdict facts into exact sorted QaQueueFacts revisions and outbox invalidations in packages/competency-qa/src/application/queue-facts.ts
- [X] T061 [US1] Consume canonical and legacy QA source events through one idempotent local projector input and preserve envelope provenance distinctions in packages/runtime-composition/src/queue/qa-fact-projector.ts
- [X] T062 [US1] Implement queue-entry head/revision CAS, suppression, current-generation reads, immutable history, input fingerprinting, and no-op semantics in packages/platform-persistence-typeorm/src/queue-projection.repository.ts
- [X] T063 [US1] Implement source invalidation consumption, an exact confirmed operational-projection query over immutable authority revisions instead of work_items.state, local fact composition, projection/stage event emission, bounded correction handling, and worker registration in packages/platform-persistence-typeorm/src/work-management.repository.ts, packages/platform-persistence-typeorm/src/operational-authority.repository.ts, packages/runtime-composition/src/queue/projection-worker.ts, packages/runtime-composition/src/queue/composition.ts, and apps/worker/src/app.module.ts
- [X] T064 [US1] Implement checkpointed runtime projection bootstrap, cursor-based shadow generation build, watermark catch-up, REBUILDING read state, validation, atomic activation, and correction-only events in packages/runtime-composition/src/queue/projection-rebuild.ts and packages/runtime-composition/src/queue/bootstrap.ts
- [X] T065 [US1] Implement and export confirmed-Jira start detection plus durable immutable initial SLA clock head/revision/transition with pinned policy/calendar/mapping/start refs in packages/platform-core/src/work-management/sla-clock.ts, packages/platform-core/src/index.ts, packages/platform-persistence-typeorm/src/sla-clock.repository.ts, and packages/runtime-composition/src/queue/projection-worker.ts
- [X] T066 [US1] Implement and export MEASURE_ONLY Work Item claim accounting plus durable idempotent base claims and admission decisions for first consuming MANUAL activity in packages/platform-core/src/work-management/capacity-admission.ts, packages/platform-core/src/index.ts, packages/platform-persistence-typeorm/src/capacity-admission.repository.ts, and packages/runtime-composition/src/queue/admission-service.ts
- [X] T067 [US1] Integrate manual Session start/resume with the shared transaction-aware admission UoW so Session, claim, decision, audit, and outbox commit atomically in packages/competency-qa/src/persistence/manual-execution.uow.ts and packages/runtime-composition/src/qa/platform-adapters.ts
- [X] T068 [US1] Compose Project-lane/item-detail projection reads, expose exact QueueEntry/control CAS tokens, and register the base queue controller in packages/runtime-composition/src/queue/portfolio-query.ts, apps/api/src/extensions/queue/queue.controller.ts, and apps/api/src/app.module.ts
- [X] T069 [US1] Add stage/freshness/Jira-separation UI, export and register the queue item route, implement all US1 scenario IDs, and atomically emit reports/006-queue-triage-capacity-sla/us1.json in packages/competency-qa/src/ui/queue-item.tsx, packages/competency-qa/src/ui.ts, apps/web/src/routes/qa/queue-workspace.tsx, apps/web/src/App.tsx, tools/local/queue-scenario.mts, and tools/verification/006-us1-checkpoint.mts

**Checkpoint**: verify:006:us1 proves all five stages independently, starts SLA only from confirmed Jira authority, and counts one Work Item when required work begins.

---

## Phase 4: User Story 2 — Project lanes and entitled portfolio (Priority: P1)

**Goal**: Return one explainable comparator for Project and portfolio views, with authorization before every aggregate and exact view-local manual order behavior.

**Independent Test**: Seed interleaved Projects A/B plus forbidden C, query Project and portfolio pages, apply Project/portfolio order moves, mutate/rebuild only C, and verify rows/counts/facets/ordinals/cursors/ETags/events reveal only the current authorized set.

### Tests for User Story 2 — author and observe RED first

- [X] T070 [P] [US2] Add stage partition, Candidate Inbox tuple, every Work Item comparator component, unknown bucket, equal-instant basis, C collation, and stable tie-breaker matrices in tests/unit/006/queue-ordering.spec.ts
- [X] T071 [P] [US2] Validate QueuePage scope/entry equality, exact enabled counts, full-order ordinals, order-state CAS tokens, applied-override union, cursors, and strong representation ETags in tests/contract/006/us2-queue-page.spec.ts
- [X] T072 [P] [US2] Prove entitlement/classification filtering precedes joins, counts, facets, sort, cursor, export, metrics, and batch sizing for HUMAN and Workspace Owner identities in tests/integration/security/006/us2-portfolio-isolation.spec.ts
- [X] T073 [P] [US2] Prove hidden-only Project projection/policy/rebuild/order changes leave authorized generation, ETag, freshness, cursor boundaries, order-head version, queue epoch, and response timing class unchanged in tests/integration/006/us2-visible-token-stability.spec.ts
- [X] T074 [P] [US2] Test FIRST/LAST/BEFORE/AFTER, post-filter anchor resolution, hidden/missing terminal no-op, stale epoch/version conflicts, expiry, and candidate result refs in tests/integration/006/us2-order-actions.spec.ts
- [X] T075 [P] [US2] Test exact portfolio membership rows, reverse Project lookup, overlapping view-local outcomes, deterministic applied refs, Project-only invalidation revisions, and no portfolio event fan-out in tests/integration/006/us2-order-persistence.spec.ts
- [X] T076 [P] [US2] Test aging-band due instants, virtual-clock semantic revisions, startup overdue recovery, no read-triggered/per-second writes, and QueueEntry event pair cardinality in tests/integration/006/us2-temporal-ordering.spec.ts
- [X] T077 [P] [US2] Add Project/portfolio API and browser journeys with forbidden Project C interleaved and zero connector/model reads in tests/e2e/006/us2-project-portfolio.spec.ts and tests/e2e/006/queue-browser.spec.ts

### Implementation for User Story 2

- [X] T078 [US2] Implement and export queue-order@1.0.0 stage partition, Candidate Inbox and Work Item lexicographic comparators, urgencyTiming selection, explicit unknowns, and returned explanations in packages/platform-core/src/work-management/queue-ordering.ts and packages/platform-core/src/index.ts
- [X] T079 [US2] Implement authorization-first Project/portfolio queries, exact authorized-set and per-Project visible-set hashes, full-order pagination, cursor validation, and JCS response ETags in packages/runtime-composition/src/queue/portfolio-query.ts
- [X] T080 [US2] Implement order-scope head/membership creation, zero-head reads, base-set reconciliation, sequence allocation, override history, and reverse-membership updates in packages/platform-persistence-typeorm/src/queue-control.repository.ts
- [X] T081 [US2] Implement exact Project/portfolio order request handling, target authorization, post-filter anchor resolution, no-op candidate creation, CAS validation, expiry, and append-only move application in packages/runtime-composition/src/queue/order-service.ts
- [X] T082 [US2] Persist same-ID order candidate/private pairs and add QUEUE_ORDER_OVERRIDE plus ANCHOR_UNAVAILABLE_NO_OP mapping with exact consumed result-family handling in packages/platform-persistence-typeorm/src/queue-action-candidate.repository.ts and packages/platform-core/src/approval/queue-action-consumer.ts
- [X] T083 [US2] Append and publish durable Project-lane order invalidations while suppressing portfolio-only fan-out in packages/platform-persistence-typeorm/src/queue-order-invalidation.repository.ts and packages/runtime-composition/src/queue/projection-worker.ts
- [X] T084 [US2] Implement and register PostgreSQL-backed READY aging-band and ordinary order-override expiry scheduling, bounded due-row claims, semantic-only updates, durable Project invalidation on expiry, and startup/periodic overdue sweeps in packages/runtime-composition/src/queue/temporal-transition-worker.ts, packages/runtime-composition/src/queue/composition.ts, packages/platform-persistence-typeorm/src/queue-order-invalidation.repository.ts, and apps/worker/src/app.module.ts
- [X] T085 [US2] Expose and register portfolio/project lanes, item detail, cursor/ETag behavior, and both exact order-override endpoints in apps/api/src/extensions/queue/queue.controller.ts, apps/api/src/extensions/queue/queue-controls.controller.ts, and apps/api/src/app.module.ts
- [X] T086 [P] [US2] Build and register the entitlement-safe lane/portfolio UI with stage partitions, comparator explanations, visible counts, stale state, cursor recovery, and order controls in packages/competency-qa/src/ui/queue-workspace.tsx, packages/competency-qa/src/ui.ts, and apps/web/src/App.tsx
- [X] T087 [US2] Compose view-local applied-order explanations from retained scope/override history without mutating canonical QueueEntry revisions in packages/runtime-composition/src/queue/portfolio-query.ts
- [X] T088 [US2] Register all US2 quickstart scenarios, including hidden-anchor and portfolio-no-fanout cases, in tools/local/queue-scenario-catalog.mts and tools/local/queue-scenario.mts
- [X] T089 [US2] Drive contract/unit/security/integration/browser suites GREEN and emit reports/006-queue-triage-capacity-sla/us2.json through tools/verification/006-us2-checkpoint.mts

**Checkpoint**: verify:006:us2 proves both views use the same explainable order and that forbidden Projects cannot affect any returned data, token, event, or timing class.

---

## Phase 5: User Story 3 — Explainable triage recommendation (Priority: P1)

**Goal**: Produce factorized, stale-aware TriageAssessment 1.1 proposals and let a HUMAN explicitly accept selected values or order without granting Hermes accepted priority authority.

**Independent Test**: Run complete, missing-business-impact, model-outage, fact-drift, accepted-control, order-override, hidden-anchor, Approval v1/v2, and Jira-priority-separation scenarios; verify bounded factors and exact audited human decisions.

### Tests for User Story 3 — author and observe RED first

- [X] T090 [P] [US3] Validate additive TriageAssessment 1.1 shape, v1 byte stability, scalar dimension compatibility, required output-profile evidence, missingInformation closure, fact-family allowlist, and no total score in tests/contract/006/us3-triage-assessment.spec.ts
- [X] T091 [P] [US3] Add dimension/fact indexing, estimate bounds, canonical fingerprint, rule/skill version, BUSINESS_IMPACT_MISSING, accepted-value separation, and stale derivation matrices in tests/unit/006/triage-assessment.spec.ts
- [X] T092 [P] [US3] Prove deterministic fallback/manual triage during model outage and reject untrusted/model output from authorization, accepted rank, Jira priority, due, and assignment in tests/unit/006/triage-model-boundary.spec.ts
- [X] T093 [P] [US3] Test accepted planning-value before/after history, preserved service class, exact assessment refs, CAS/idempotency, source drift, FIXED_DATE due proof, and dedicated clear/EXPEDITE effects in tests/integration/006/us3-accepted-controls.spec.ts
- [X] T094 [P] [US3] Test safe public/private action equality, distinct private hash, Approval target/payload/local-state binding, hidden-state recheck, and mismatched action/effect/ref rejection in tests/integration/006/us3-platform-actions.spec.ts
- [X] T095 [P] [US3] Prove Approval v1 still reads, v2 Project/portfolio subjects authorize without record-ID leakage, decision reauthorizes all scope, self/SERVICE approval fails, and inaccessible equals missing in tests/integration/security/006/us3-approval-v2.spec.ts
- [X] T096 [P] [US3] Prove accepted service class/order never writes Jira status/priority/due/assignment and Jira changes still require the existing exact Connector command plus confirmation in tests/integration/006/us3-jira-authority.spec.ts
- [X] T097 [P] [US3] Add factorized assessment, missing-information, model-outage, override audit, and Jira-separation browser/API journeys in tests/e2e/006/us3-triage-controls.spec.ts

### Implementation for User Story 3

- [X] T098 [US3] Extend the QA triage domain with optional dimensionDetails, bounded missingInformation, exact fingerprint components, rule/skill refs, and v1-compatible serialization in packages/competency-qa/src/domain/triage-assessment.ts
- [X] T099 [US3] Implement factorized assessment construction, semantic validation, staleness, business-impact UNKNOWN handling, and accepted-value separation in packages/competency-qa/src/application/triage-assessment.ts
- [X] T100 [US3] Publish qa-triage@1.1.0 input/output profiles and deterministic fallback without a scalar score in packages/competency-qa/src/skills/qa-triage.ts
- [X] T101 [US3] Compose bounded Hermes manifests, proposal-only grants, fallback execution, and source-drift invalidation in packages/runtime-composition/src/hermes/qa-proposal-skill-contribution.ts and packages/runtime-composition/src/hermes/proposal-staleness.ts
- [X] T102 [US3] Persist and query TriageAssessment 1.1 revisions alongside unchanged v1 history in packages/competency-qa/src/persistence/triage-assessment.repository.ts
- [X] T103 [US3] Implement and export closed QUEUE_CONTROL_ACCEPT effects, before/after accepted planning values, FIXED_DATE guards, service-class preservation, CAS, idempotency, and audit provenance in packages/platform-core/src/work-management/queue-control.ts and packages/platform-core/src/index.ts
- [X] T104 [US3] Implement control head/revision append, stale assessment/source rejection, expiry/supersession, and exact ref persistence in packages/platform-persistence-typeorm/src/queue-control.repository.ts
- [X] T105 [US3] Map control candidates to same-ID private witnesses, create Approval v2 when required, recheck hidden state, consume exact accepted-control effects, and emit the mutually exclusive queue.control.changed event through the canonical binder in packages/platform-core/src/approval/queue-action-consumer.ts and packages/runtime-composition/src/queue/control-service.ts
- [X] T106 [US3] Expose exact control submission plus additive v1/v2 Approval GET/decision consumption on the contract-scoped routes in apps/api/src/extensions/queue/queue-controls.controller.ts, packages/platform-runtime-nest/src/http/approvals.controller.ts, packages/platform-runtime-nest/src/index.ts, and apps/api/src/app.module.ts
- [X] T107 [US3] Add factor/evidence/missing-info/staleness and accepted-before/after UI, register all US3 scenarios, and atomically emit reports/006-queue-triage-capacity-sla/us3.json in packages/competency-qa/src/ui/queue-item.tsx, tools/local/queue-scenario.mts, and tools/verification/006-us3-checkpoint.mts

**Checkpoint**: verify:006:us3 proves Hermes remains proposal-only, missing inputs stay explicit, every accepted value is a separate exact HUMAN decision, and Jira authority is unchanged.

---

## Phase 6: User Story 4 — Capacity/WIP and EXPEDITE (Priority: P1)

**Goal**: Serialize Workspace human-capacity and EXPEDITE admission while keeping Project limits soft, reservations auditable, external facts convergent, and every discretionary override exact.

**Independent Test**: Under an ENFORCED fixture limit of one, race manual starts, automated launches, terminal conversions, WIP overrides, EXPEDITE actions, clear/expiry, external overflow, and blocked resume; verify one winner, durable denials, exact approvals, one Work Item unit, and no hidden/global witness leakage.

### Tests for User Story 4 — author and observe RED first

- [X] T108 [P] [US4] Validate calendar/policy publication semantics, MEASURE_ONLY null/empty enforcement fields, ENFORCED baseline/numeric requirements, optional complete Project entries, and open-ended calendar activation in tests/contract/006/us4-policy-publication.spec.ts
- [X] T109 [P] [US4] Validate CapacitySnapshot/CapacityAdmission schemas, configured-warning equivalence, no global-head leakage, outcome/blocker/mode rules, typed activity-to-mutation cardinality, override binding, and receipt families in tests/contract/006/us4-capacity-contracts.spec.ts
- [X] T110 [P] [US4] Add union-by-Work-Item claim/reservation, cause-set hash, covered reservation, external/blocked cause, soft warning, and no-double-count truth tables in tests/unit/006/capacity-accounting.spec.ts
- [X] T111 [P] [US4] Race last-slot MANUAL starts and AUTOMATED review reservations across Projects under SERIALIZABLE, including bounded 40001/40P01 retry and Redis loss, in tests/integration/006/us4-concurrent-admission.spec.ts
- [X] T112 [P] [US4] Test HELD/COVERED_BY_CLAIM/CONVERTED/RELEASED reservation lifecycle, atomic result-to-review claim conversion, cancellation, replay, and multiple Sessions per Work Item in tests/integration/006/us4-reservation-lifecycle.spec.ts
- [X] T113 [P] [US4] Test denial with/without overrideIntent, exact resume blockedFrom state, distinct current Lead approval, stale/expired/self/different-target rejection, and same-key replay/conflict in tests/integration/006/us4-wip-override.spec.ts
- [X] T114 [P] [US4] Race EXPEDITE singleton actions and test originating candidate binding, capacity override, clear without second approval/expiry, completion/expiry release, and capacity-first lock order in tests/integration/006/us4-expedite.spec.ts
- [X] T115 [P] [US4] Test authoritative external Jira/automation result ingestion above capacity, forced claim/debt, one over-limit event/alert, later discretionary denial, and mapped RELEASE_WIP resume behavior in tests/integration/006/us4-forced-overflow.spec.ts
- [X] T116 [P] [US4] Prove authorized capacity projections persist exact membership, rehash counts/sets, hide global state/head/basis, remain stable on hidden-only churn, and use target-only authorization witness hashes in tests/integration/security/006/us4-capacity-isolation.spec.ts
- [X] T117 [P] [US4] Prove routing intersects authorization, capability, and availability independently, returns hints only, never assigns work, and grants no access from a claim in tests/integration/security/006/us4-routing-boundary.spec.ts
- [X] T118 [P] [US4] Validate admission If-Match strong Session ETag, 200 denial/replay, 202 approval Location, consumed result refs, stale 409, scoped 404/403, and no client global-capacity tokens in tests/contract/006/us4-admission-api.spec.ts
- [X] T119 [P] [US4] Add policy-mode, reservation, last-slot, exact override, EXPEDITE, forced-overflow, block/release/resume, and capacity UI journeys in tests/e2e/006/us4-capacity-expedite.spec.ts

### Implementation for User Story 4

- [X] T120 [US4] Implement Workspace-scoped calendar/policy publication CAS/idempotency/audit UoW, semantic validators, baseline gates, and safe view/facet projection updates in packages/runtime-composition/src/queue/policy-publication-service.ts and packages/platform-persistence-typeorm/src/queue-policy.repository.ts
- [X] T121 [US4] Implement capacity accounting, MEASURE_ONLY/ENFORCED decisions, soft warnings, hard/EXPEDITE blockers, activity/effect mapping, exact override intent, and non-discretionary outcomes in packages/platform-core/src/work-management/capacity-admission.ts
- [X] T122 [US4] Implement Workspace capacity-head locking, cause-set recomputation, union counts, claim/reservation histories, idempotent decisions, and bounded serialization retries in packages/platform-persistence-typeorm/src/capacity-admission.repository.ts
- [X] T123 [US4] Materialize durable Project/authorized-portfolio capacity projections after filtering, persist exact membership, and append only when safe public bytes change in packages/platform-persistence-typeorm/src/capacity-scope-projection.repository.ts
- [X] T124 [US4] Compose and register one SERIALIZABLE admission transaction that reauthorizes, locks capacity/control/Session in order, rechecks exact facts, consumes an override, and atomically writes mutation/audit plus capacity.admission.decided and capacity.occupancy.changed outbox events through the canonical binder in packages/runtime-composition/src/queue/admission-service.ts and packages/runtime-composition/src/queue/composition.ts
- [X] T125 [US4] Route MANUAL start/resume through admission, preserve exact blockedFrom state, require strong predecessor ETag, and remove legacy check-then-write paths in packages/competency-qa/src/persistence/manual-execution.uow.ts and apps/api/src/extensions/qa-sessions.controller.ts
- [X] T126 [US4] Acquire or cover one review reservation before publishing an AUTOMATED launch effect, upgrade its admission ETag to strong form, and make denial issue zero provider calls in apps/api/src/extensions/gitlab-automation/qa-automation-attempts.controller.ts, packages/runtime-composition/src/gitlab/automation-launch-service.ts, and packages/competency-qa/src/persistence/automation-execution.repository.ts
- [X] T127 [US4] Atomically convert/release reservations, merge Work Item claims, and emit semantic capacity.occupancy.changed events during authoritative automation result ingestion without delaying evidence in packages/runtime-composition/src/gitlab/result-sync.ts and packages/competency-qa/src/persistence/result-evidence.uow.ts
- [X] T128 [US4] Checkpoint current-state capacity reconciliation, gate ENFORCED activation until projection and capacity validations both pass, reconcile confirmed Jira active/block/terminal facts into claims and RELEASE_WIP behavior, and emit one capacity.over-limit-detected event for unavoidable overflow without rejecting operational authority in packages/platform-persistence-typeorm/src/operational-authority.repository.ts, packages/runtime-composition/src/jira/reconciliation-jobs.ts, packages/runtime-composition/src/queue/bootstrap.ts, and packages/runtime-composition/src/queue/admission-service.ts
- [X] T129 [US4] Create/consume WIP_ADMISSION_OVERRIDE, SERVICE_CLASS_EXPEDITE, EXPEDITE_CAPACITY_OVERRIDE, and CLEAR_EXPEDITE candidates with exact candidate/private/Approval bindings in packages/platform-core/src/approval/queue-action-consumer.ts and packages/runtime-composition/src/queue/control-service.ts
- [X] T130 [US4] Implement EXPEDITE set/clear/expiry under capacity-first locks, dedicated effects, review times, stale invalidation, and singleton-set updates in packages/platform-persistence-typeorm/src/queue-control.repository.ts and packages/runtime-composition/src/queue/temporal-transition-worker.ts
- [X] T131 [US4] Expose authorized capacity reads and exact admission/control response unions without global witnesses in apps/api/src/extensions/queue/queue.controller.ts and apps/api/src/extensions/queue/queue-controls.controller.ts
- [X] T132 [P] [US4] Implement authorization-first routing hints and bounded capacity/denial/overflow telemetry plus Lead NotificationIntent creation in packages/runtime-composition/src/queue/observability.ts and packages/runtime-composition/src/queue/capacity-notifications.ts
- [X] T133 [US4] Add occupancy/reservation/soft-warning/hard-denial/override UI, register all US4 scenarios, and atomically emit reports/006-queue-triage-capacity-sla/us4.json in packages/competency-qa/src/ui/queue-item.tsx, tools/local/queue-scenario.mts, and tools/verification/006-us4-checkpoint.mts

**Checkpoint**: verify:006:us4 proves exactly serialized discretionary capacity, exact Lead overrides, authoritative overflow convergence, and no cross-Project/global-state disclosure.

---

## Phase 7: User Story 5 — Transparent revision-pinned SLA (Priority: P2)

**Goal**: Show Requesters the authoritative SLA start, mapped pauses, working-time progress, breach risk, and immutable provenance without changing Jira due/priority or depending on page reads.

**Independent Test**: Use a virtual clock and pinned calendar/policy to prove confirmed start, rollout verification, DST/calendar vectors, pause/resume, MEASURE_ONLY versus ENFORCED, threshold notification dedupe/outage, due-worker restart recovery, read-time evaluation hashes, and immutable reopen cycles.

### Tests for User Story 5 — author and observe RED first

- [X] T134 [P] [US5] Add IANA/UTC, weekly interval, closure, working override, midnight 24:00 end, leap-day, DST gap/overlap, adjacent interval, duplicate date, finite coverage, and semantic-hash golden vectors in tests/unit/006/business-calendar.spec.ts
- [X] T135 [P] [US5] Add START/PAUSE/RESUME/STOP/reopen truth tables, exact goal-specific sources, unknown-pause RUNNING behavior, cumulative business time, lineage, and pinned-history matrices in tests/unit/006/sla-clock.spec.ts
- [X] T136 [P] [US5] Prove no rollout backdating, one verification receipt per Work Item/goal/policy epoch, authoritative DUPLICATE read acceptance, mismatch/outage gating, and unchanged Jira projection history in tests/integration/006/us5-rollout-verification.spec.ts
- [X] T137 [P] [US5] Validate SLA response exact goal set/shared asOf/path scope, POLICY_NOT_PUBLISHED defaults, transition-field equality, source-family closure, target derivation, stable clock ref, and changing evaluation hash in tests/contract/006/us5-sla-contracts.spec.ts
- [X] T138 [P] [US5] Test append-only segments, one open segment, stop/reopen cycles, goal-specific stop facts, source monotonicity, policy/calendar pinning, and no historical reinterpretation in tests/integration/006/us5-sla-persistence.spec.ts
- [X] T139 [P] [US5] Test MEASURE_ONLY NOT_CONFIGURED and ENFORCED ON_TRACK/AT_RISK/BREACHED/COMPLETED derivation from exact targets and ordered warning thresholds in tests/integration/006/us5-policy-modes.spec.ts
- [X] T140 [P] [US5] Test one threshold emission/NotificationIntent, immutable creationHash, delivery-state independence, Mattermost outage, deleted BullMQ hint, PostgreSQL overdue sweep, and no page-triggered writes in tests/integration/006/us5-temporal-notifications.spec.ts
- [X] T141 [P] [US5] Prove Jira/model/Mattermost/GitLab outages preserve authority, visible freshness, manual flow, clock state, and pending notification intent without automatic pause or Jira writes in tests/integration/006/us5-degradation.spec.ts
- [X] T142 [P] [US5] Validate the SLA GET endpoint, server-only asOf, exact ETag/ref behavior, forbidden/not-found parity, and zero provider/model calls in tests/integration/security/006/us5-sla-read.spec.ts
- [X] T143 [P] [US5] Add confirmed-start, calendar, pause/risk, notification-outage, restart, and reopen API/browser journeys in tests/e2e/006/us5-sla-transparency.spec.ts

### Implementation for User Story 5

- [X] T144 [US5] Implement business-calendar@1.0.0 validation and deterministic instant arithmetic for open-ended IANA calendars, overrides, midnight, leap days, and explicit DST rules in packages/platform-core/src/work-management/sla-clock.ts
- [X] T145 [US5] Implement immutable SLA goal clocks, transition/segment/reopen lineage, confirmed mapped pause/resume, exact goal stop facts, cumulative business time, and next-transition calculation in packages/platform-core/src/work-management/sla-clock.ts
- [X] T146 [US5] Implement clock/segment/threshold append, same-scope refs, monotonic source checks, due-row claims, immutable history, and cycle-safe current heads in packages/platform-persistence-typeorm/src/sla-clock.repository.ts
- [X] T147 [US5] Implement gated authoritative Jira rollout reads and immutable same-epoch verification receipts, including reducer DUPLICATE handling, in packages/platform-persistence-typeorm/src/sla-rollout-verification.repository.ts and packages/runtime-composition/src/queue/sla-rollout-verifier.ts
- [X] T148 [US5] Feed confirmed operational changes, first consuming Session starts, and signed Verdict stops into the clock service without provider/model authority in packages/runtime-composition/src/queue/projection-worker.ts and packages/runtime-composition/src/qa/confirmation-hooks.ts
- [X] T149 [US5] Evaluate server-time SLA snapshots from exact transition and pinned policy/calendar refs, derive remaining/target/risk fields, exact goal sets, evaluation hashes, and strong ETags in packages/runtime-composition/src/queue/portfolio-query.ts
- [X] T150 [US5] Extend the durable temporal worker for SLA warning/breach deadlines, READY aging boundaries, bounded claims, semantic-only revisions, and startup/periodic recovery in packages/runtime-composition/src/queue/temporal-transition-worker.ts
- [X] T151 [US5] Create each threshold emission and fixed REQUEST_STATUS NotificationIntent once, preserve immutable creationHash, and decouple Hermes wording/Mattermost delivery in packages/runtime-composition/src/queue/sla-notifications.ts
- [X] T152 [US5] Emit immutable sla.clock.* and sla.warning/breached payloads with exact envelope binding, schema pins, cardinality, and no dynamic read DTO in packages/runtime-composition/src/queue/projection-worker.ts
- [X] T153 [US5] Expose and register authorized SLA/policy/calendar reads with shared server asOf and exact response shapes in apps/api/src/extensions/queue/queue.controller.ts, apps/api/src/extensions/queue/queue-policies.controller.ts, and apps/api/src/app.module.ts
- [X] T154 [US5] Add SLA start/pause/risk/policy-mode/provenance UI, register all US5 scenarios, and atomically emit reports/006-queue-triage-capacity-sla/us5.json in packages/competency-qa/src/ui/queue-item.tsx, tools/local/queue-scenario.mts, and tools/verification/006-us5-checkpoint.mts

**Checkpoint**: verify:006:us5 proves clocks start only from confirmed Jira authority, remain pinned and reconstructible, advance from durable time, and expose transparent risk without mutating Jira.

---

## Phase 8: Polish, cross-cutting validation, and handoff

**Purpose**: Close migration, security, recovery, observability, local-contour, browser, traceability, and aggregate evidence without widening product or production scope.

- [X] T155 Add the aggregate PostgreSQL 17/18 fresh/upgrade/repeat/current-minus-one/failure-recovery plus runtime bootstrap/REBUILDING/reconciliation/ENFORCED-activation matrix in tests/integration/006-migration-matrix.spec.ts and atomically emit reports/006-queue-triage-capacity-sla/migrations-postgres-17.json and reports/006-queue-triage-capacity-sla/migrations-postgres-18.json through tools/ci/verify-006-migrations.mts
- [X] T156 [P] Prove the full admission/reservation/override/order-move race matrix plus duplicate/out-of-order/missed invalidations, gap repair, shadow cutover, incremental/rebuild hash equality, Redis/worker restart, and no duplicate external effect in tests/integration/006/concurrency-matrix.spec.ts and tests/integration/006/rebuild-recovery.spec.ts, then emit reports/006-queue-triage-capacity-sla/concurrency.json and reports/006-queue-triage-capacity-sla/rebuild.json through tools/verification/006-concurrency-checkpoint.mts and tools/verification/006-rebuild-checkpoint.mts
- [X] T157 [P] Add aggregate membership/entitlement/role/classification revocation, cross-scope substitution, hidden-count/timing/cursor/log/metric leakage, action-witness redaction, and production egress denial in tests/integration/security/006/production-and-scope-boundary.spec.ts and atomically emit reports/006-queue-triage-capacity-sla/security.json through tools/verification/006-security-checkpoint.mts
- [X] T158 [P] Add bounded queue/capacity/SLA/rebuild metrics, low-cardinality labels, correlation/audit refs, a self-contained observability load fixture, constant query-count, and zero-provider-read evidence in tests/support/006-observability-fixture.ts and tests/integration/006/observability-performance.spec.ts, then emit reports/006-queue-triage-capacity-sla/observability.json through tools/verification/feature-006-observability.mts
- [X] T159 Implement deterministic multi-Project A/B/forbidden-C, calendar/policy, Session/Attempt, fault, and virtual-clock fixtures in packages/runtime-composition/src/seed/qa-jira-gitlab-mattermost-queue-local-seed.ts and tests/support/006-queue-fixture.ts
- [X] T160 Implement local:queue up/status/migrate/seed/down/reset and queue:scenario orchestration for the exact isolated contour, with safe target resolution and persisted fault state, in tools/local/queue-cli.mts and tools/local/queue-scenario.mts and atomically emit reports/006-queue-triage-capacity-sla/setup-contour.json through tools/verification/006-setup-contour.mts
- [X] T161 Enforce qa-jira-gitlab-mattermost-local static selection, zero production credentials/endpoints, external egress denial, and no new queue mock/database owner in packages/runtime-composition/src/config/environment.ts, packages/runtime-composition/src/security/local-security.ts, and infra/compose/docker-compose.local.yml
- [X] T162 Complete the independently navigable US1–US5 browser journey with forbidden Project absence, explainable stage/order/triage/capacity/SLA, and exact override provenance in tests/e2e/006/queue-browser.spec.ts and atomically emit reports/006-queue-triage-capacity-sla/browser.json through tools/verification/006-browser-checkpoint.mts
- [X] T163 Implement isolated child-process smoke with API/worker/web/PostgreSQL/Redis/Mock Hub restarts, durable-state inspection, browser execution, clean shutdown, and reports/006-queue-triage-capacity-sla/smoke.json in tools/smoke/feature-006.mts and tools/smoke/feature-006-browser-process.mts
- [X] T164 Verify every implemented command and scenario in specs/006-queue-triage-capacity-sla/quickstart.md and update only implementation-status text that is already evidenced before the final clean-source-digest regeneration
- [X] T165 Implement documented command/scenario/fresh-report validation and emit reports/006-queue-triage-capacity-sla/quickstart.json in tools/verification/006-quickstart.mts
- [X] T166 Implement FR-001–FR-025 and SC-001–SC-007 traceability to exact fresh evidence in tools/verification/feature-006-trace.mts and reports/006-queue-triage-capacity-sla/traceability.json
- [X] T167 Aggregate all story integration suites and atomically emit reports/006-queue-triage-capacity-sla/integration.json through tools/verification/006-integration-checkpoint.mts
- [X] T168 Implement child-report/source/contract/migration/runtime digest binding in tools/verification/feature-006-evidence.mts, atomically emit reports/006-queue-triage-capacity-sla/evidence.json, and compose setup, foundation, US1–US5, migration, concurrency, security, rebuild, browser, smoke, trace, typecheck, lint, and build gates in tools/verification/feature-006-gate.mts and tools/ci/feature-006.mts
- [X] T169 Re-run Feature 002–005 compatibility, contract-registry drift, V12 byte pins, migration immutability, and production-boundary checks immediately before final gate execution in tools/verification/feature-006-gate.mts
- [X] T170 Run the complete ci:006 gate against a clean source digest only after T169 passes, regenerate every child report made stale by T164 in dependency order, and emit the immutable final result in reports/006-queue-triage-capacity-sla/final-gate.json

**Checkpoint**: verify:006 and ci:006 produce fresh PASS evidence for the exact source tree while production, deployment, autonomous priority, and live-provider authority remain denied.

---

## Dependencies and execution order

### Phase dependencies

- **Phase 1 — Setup**: No dependencies; establishes fail-closed inputs and command shells.
- **Phase 2 — Foundation**: Depends on Phase 1 and blocks every user story.
- **Phase 3 — US1**: Depends on Foundation; provides the base QA facts, projection, initial SLA, and Work Item claim path.
- **Phase 4 — US2**: Depends on US1 queue projections; may run in parallel with US5 after US1.
- **Phase 5 — US3**: Depends on US1 and US2 authorized reads/order scope for its complete order-override acceptance path.
- **Phase 6 — US4**: Depends on US1 claim/session integration and US3 exact Approval/control infrastructure.
- **Phase 7 — US5**: Depends on US1 initial clock path; may run in parallel with US2 and early US3 work.
- **Phase 8 — Polish**: Depends on every story included in the intended release.

### User story dependency graph

US1 → US2 → US3 → US4

US1 → US5

US2 and US5 can proceed concurrently. US3 triage-only tasks T090–T102 can begin after Foundation/US1, but its accepted order-control checkpoint depends on US2. US4 policy/accounting tests T108–T112 can begin after Foundation, but its full override checkpoint depends on US3.

### Requirement and success-criteria coverage

| Story | Functional requirements | Success criteria | Primary task range |
|---|---|---|---|
| US1 | FR-003–FR-005, FR-021–FR-023 | SC-001, SC-002 | T051–T069 |
| US2 | FR-001–FR-004, FR-012–FR-014 | SC-003, SC-005 | T070–T089 |
| US3 | FR-006–FR-010, FR-012, FR-014, FR-015 | SC-004, SC-005, SC-007 | T090–T107 |
| US4 | FR-011, FR-014, FR-016–FR-020 | SC-005, SC-006 | T108–T133 |
| US5 | FR-003, FR-004, FR-021–FR-025 | SC-002 | T134–T154 |

Every FR-001–FR-025 and SC-001–SC-007 appears in at least one independently checked story. T166 then binds the complete set to fresh executable evidence.

### Within each phase

- Author the phase tests and confirm the intended RED reason before implementation.
- Implement immutable domain/schema behavior before repositories and transaction services.
- Implement repository invariants before API, worker, or UI wiring.
- Implement endpoints and workers before scenarios/checkpoints.
- Complete the phase checkpoint before treating its story as independently usable.

### Parallel opportunities

- Setup T001/T002/T007/T009/T010 can run concurrently.
- Foundation tests T013–T023 can run concurrently; domain tasks T027–T029 and owner-isolated migration tasks T032/T035/T038/T043 can run concurrently after their tests exist.
- US1 tests T051–T058 can run concurrently.
- US2 tests T070–T077 and UI task T086 are file-isolated; US2 and US5 may be staffed concurrently after US1.
- US3 tests T090–T097 can run concurrently; domain/skill work T098–T102 can proceed before the control consumer.
- US4 tests T108–T119 can run concurrently; policy, accounting, reservation, and routing work can be split by owned files.
- US5 tests T134–T143 can run concurrently; calendar/clock, rollout, notification, API, and UI work own separate files after shared semantics settle.
- Polish recovery, security, and observability tasks T156–T158 can run concurrently before documentation stabilization at T164 and final aggregation.

---

## Parallel examples

### User Story 1

- Task T051: queue-stage pure truth table in tests/unit/006/queue-stage.spec.ts
- Task T053: QA queue-fact persistence/event integration in tests/integration/006/us1-qa-queue-facts.spec.ts
- Task T057: authorization and no-side-effect security boundary in tests/integration/security/006/us1-stage-isolation.spec.ts

### User Story 2

- Task T070: comparator matrix in tests/unit/006/queue-ordering.spec.ts
- Task T072: pre-aggregation isolation in tests/integration/security/006/us2-portfolio-isolation.spec.ts
- Task T075: order membership/invalidation persistence in tests/integration/006/us2-order-persistence.spec.ts

### User Story 3

- Task T090: additive assessment contract in tests/contract/006/us3-triage-assessment.spec.ts
- Task T092: model/authority boundary in tests/unit/006/triage-model-boundary.spec.ts
- Task T095: Approval v1/v2 security compatibility in tests/integration/security/006/us3-approval-v2.spec.ts

### User Story 4

- Task T110: capacity accounting matrix in tests/unit/006/capacity-accounting.spec.ts
- Task T114: EXPEDITE concurrency in tests/integration/006/us4-expedite.spec.ts
- Task T117: routing boundary in tests/integration/security/006/us4-routing-boundary.spec.ts

### User Story 5

- Task T134: business-calendar golden vectors in tests/unit/006/business-calendar.spec.ts
- Task T136: rollout verification in tests/integration/006/us5-rollout-verification.spec.ts
- Task T140: threshold/restart recovery in tests/integration/006/us5-temporal-notifications.spec.ts

---

## Implementation strategy

### MVP first — User Story 1

1. Complete Setup and Foundation.
2. Complete US1 through T069.
3. Stop and run verify:006:us1 against the local contour.
4. Demonstrate deterministic stages, confirmed-Jira SLA start, and one-Work-Item WIP without enabling numeric enforcement.

### Incremental delivery

1. Setup + Foundation establish immutable contracts, migrations, and exact authority.
2. US1 adds the independently useful stage/projection spine.
3. US2 adds entitlement-safe Project/portfolio views and human order.
4. US3 adds explainable triage and explicit accepted values.
5. US4 enables serialized capacity/EXPEDITE enforcement after baseline evidence.
6. US5 completes transparent business-time SLA and notifications.
7. Polish binds all evidence; it does not grant production/deployment authority.

### Parallel team strategy

After US1, one stream can implement US2/US3 view and control work, another US5 clocks/calendar, and a third prepare US4 policy/accounting tests. Merge only through the story checkpoints and rerun hidden-scope, migration, and compatibility gates after shared-file changes.

---

## Notes

- No production WIP/SLA number is hard-coded; tests use explicitly labelled fixture values.
- Jira status/priority/due/assignment remain provider-owned confirmed facts.
- Triage/model output remains proposal-only and never supplies authorization or accepted total order.
- Every public read/ref/hash is scoped so hidden-only changes cannot alter another caller's observable bytes.
- Every mutation is idempotent, CAS-bound, reauthorized, audited, and uses the documented lock order.
- Applied migrations and published Feature 001–005 contracts/manifests are never rewritten.
- Commit after each task or coherent task group; never hand-edit generated evidence to make a gate pass.
