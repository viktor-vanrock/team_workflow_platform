# Research: QA manual walking skeleton

**Feature:** `002-qa-manual-walking-skeleton`  
**Spec Kit phase:** Phase 0 — Outline & Research  
**Resolved:** 2026-08-27  
**Status:** Complete; unresolved planning questions = 0

## 1. Источники и метод

Решения получены из:

- [Конституции](../../.specify/memory/constitution.md);
- [feature specification](spec.md);
- ADR-0001…ADR-0007;
- Master Specification v2;
- public design/contracts/tasks feature 001;
- read-only анализа текущей кодовой базы и параллельных reviews требований, repository paths и Spec Kit conventions.

Research не подменяет нормативные документы. При конфликте действует порядок из [plan.md](plan.md).

## R-001 — Entry gate feature 001

**Decision:** реализация 002 начинается только после полного final gate 001; незавершённые command/approval/artifact/mock/runtime primitives не копируются в QA package.

**Rationale:** текущий snapshot реализовал только T001–T056 feature 001. Work Item acceptance, exact Approval runtime, Broker/worker/recovery, artifact proxy и stateful Mock Hub ещё не готовы. QA-only обход нарушил бы Core/Pack boundary и дал ложный acceptance.

**Alternatives considered:**

- начать 002 на in-memory adapters — отклонено: не доказывает durable/idempotent/security requirements;
- перенести оставшиеся задачи 001 в 002 — отклонено: разрушает feature ownership и regression gate;
- блокировать только external effects, но делать domain — отклонено как default execution path; допустима лишь isolated pure-domain разработка после зафиксированных public contracts.

## R-002 — Product package boundary

**Decision:** создать статически собираемый `@awp/competency-qa`; QA types/rules/tables/use cases/UI остаются внутри Pack. Core расширяется только generic public ports, если такие gaps выявлены prerequisite test.

**Rationale:** Constitution IV и ADR-0001 закрепляют владение domain semantics за Pack. Такой layout повторяет доказанный pattern `competency-dummy` и позволяет 003/005 добавлять adapters/modes без Core branching.

**Alternatives considered:**

- положить QA aggregates в `platform-core` — отклонено как constitutional violation;
- отдельный microservice — отклонено: feature 001 выбрала static monorepo/common build, дополнительная distributed boundary не даёт ценности;
- runtime plugin loading — запрещено MVP constitution.

## R-003 — Operational authority capability

**Decision:** ввести vendor-neutral typed capability `operational-work-item@1.0.0` ровно с operations `request.create`, `request.transition`, `defect.create`. Terminal `request.transition(DONE)` carries a closed structured completion summary and digest so the adapter can render the provider completion comment and reconcile summary+state under one effect identity; this is not a fourth operation. Read-back likewise is a Connector confirmation/reconciliation strategy through the generic feature-001 port. В 002 capability реализуют Mock Connector/Mock Hub; 003 реализует Jira.

**Rationale:** QA Pack должен объявлять capability/logical role, но не Profile/Connection/vendor API. Typed contract позволяет доказать idempotency/confirmation/recovery сейчас и заменить implementation later.

**Alternatives considered:**

- назвать capability `jira.issue` — отклонено: vendor hardcode;
- три несвязанных capabilities — отклонено: общая authority/version/error/confirmation model полезна и не смешивает untyped payloads;
- generic `execute(any)` — запрещено Constitution IV/V и 001 contract.

## R-004 — Intake acceptance transaction

**Decision:** explicit Draft confirmation создаёт durable `request.create` command, но не Work Item. Только confirmed external receipt/read-back вызывает generic Core/persistence confirmation transaction:

`Draft LINKED + Work Item + Operational Binding + command result + audit/event`,

а зарегистрированный QA extension hook в той же transaction добавляет только `QaRequestExtension` и собственные QA rows. QA Pack не читает и не изменяет Core tables напрямую.

**Rationale:** сохраняет external operational authority, исключает partial accepted request и делает crash-after-effect восстанавливаемым тем же effect key.

**Alternatives considered:**

- Work Item до external call — отклонено: fake canonical state при outage;
- зарезервировать Work Item ID в command — отклонено как ненужная partial identity; command ссылается на Draft;
- distributed transaction с Mock/Jira — невозможна и не требуется; effectively-once observable effect достигается idempotency/read-back.

## R-005 — Request taxonomy

**Decision:** `qa.validation@1.0.0` поддерживает wire values `feature-validation`, `smoke`, `regression`, `retest`, `investigation`. Feature 002 создаёт только MANUAL Sessions.

**Rationale:** четыре обязательных value из FR-002 сохранены; `regression` добавлен для совместимости с master taxonomy и feature 005. Mode не превращается в Work Type.

**Alternatives considered:**

- только четыре value spec — допустимо, но создало бы additive schema update уже в 005;
- отдельные Work Types — прямо запрещено feature boundary;
- реализовать AUTOMATED placeholder executor — отклонено: скрыто расширяет 005.

## R-006 — Readiness и external READY

**Decision:** QA-owned `ReadinessAssessment` и external operational status являются разными states. Feature-facing assessment может быть `NEEDS_INFO|READY|READY_WITH_WAIVER`; `NEEDS_INFO` является presentation mapping master-состояния `BLOCKED`, а waiver — отдельным проверяемым основанием. Seeded mock Project Context требует exact-approved `request.transition` и confirmed read-back before derived operational sync projection becomes `READY`.

**Rationale:** это одновременно сохраняет QA rule authority и Constitution II для external workflow. Assessment остаётся исторически валидной при transient sync outage; UI показывает `READY_PENDING_SYNC|SYNC_ERROR` отдельно.

**Alternatives considered:**

- считать assessment external status — отклонено: dual-master/local invention;
- не синхронизировать READY в 002 — отклонено: acceptance “request becomes READY” и future Jira compatibility были бы недоказаны;
- переписывать assessment при connector outage — отклонено: live availability не меняет evaluated inputs.

## R-007 — DoR health semantics

**Decision:** DoR проверяет accepted external request, `ACTIVE` Project, requester entitlement and server-derived confirmed response channel, explicit blockers/dependencies, request-kind source lineage, published mandatory Binding/Profile structural and mapping health, and Project Registry verification. Local 002 resolves the response channel from the immutable original requester principal to the verified Platform Web principal/channel allowed by the pinned QA Project Context; a later Executor revision cannot substitute its own identity, and real Mattermost is a future adapter, not a missing DoR fact. `retest` requires defect + previous Session + source build. At the US1 checkpoint the previous Session is a validated immutable same-scope `EXTERNAL_HISTORICAL` lineage ref; a native `QA_SESSION` ref becomes available only after US3 installs the completed/reviewed Session projection with signed manifest, so earlier slices have no hidden future-table FK. Registry `PROJECT_REGISTRY_NEEDS_REVIEW` is the only waivable DoR code and requires an exact distinct-Lead waiver whose scope/rule/input fingerprint and expiry are revalidated at readiness confirmation and external READY authorization; scope/entitlement/channel/content/declaration/lineage/classification/security/mapping blockers are non-waivable. Transient live reachability after assessment is an operational sync/start block, not silent re-evaluation. Session start guards verify live target access separately.

**Rationale:** reconciles FR-006 with master distinction between readiness and live execution availability.

**Alternatives considered:**

- live ping as hard DoR fact — rejected because transient outage would churn readiness history;
- trust client-supplied response identity or omit blockers/dependencies — rejected: master DoR would be unverifiable;
- ignore Project Registry/Binding mapping health — violates FR-006/master DoR;
- rely on UI warning only — insufficient deterministic guard.

## R-008 — Versioned QA Project Context and risk policy

**Decision:** Pack owns immutable `QaProjectContext`, `riskReviewPolicy`, `QaRequestInputRevision` and `RequiredSessionPlan` revisions with stable identity, content hash and explicit current/published pointers per Project or Work Item. Context contains closed exact target/scope/checklist policy catalogs/defaults; every RequiredSessionPlan slot ref must resolve from the pinned context rather than client invention. New request pins exact context/rule/evidence/risk refs and an initial input revision; readiness and DoD pin the exact input/required-plan revisions they evaluated. RequiredSessionPlan publish/revise is an explicit authorized HUMAN command with expected-current CAS, publication reason, audited event and immutable history; readiness never fabricates a plan as a hidden side effect. Effective review risk is `max(projectRisk, requestRisk)` from the pinned input revision.

**Rationale:** pinning prevents historical reinterpretation and provides feature-local seed configuration until onboarding feature 007.

**Alternatives considered:**

- current global policy lookup at every read — rejected: silent reinterpretation;
- embed all policy JSON in request — rejected duplication; exact ref+hash is sufficient;
- put risk levels in Core — rejected QA policy leakage.

## R-009 — Independent reviews

**Decision:** ordinary verdict requires one QA Executor signature. HIGH/CRITICAL verdict requires a primary human signature and a distinct currently authorized QA Lead co-sign. The sole Registry DoR waiver and allowed session/plan-item/required-session/Finding waivers plus `ACCEPTED_RISK` require a distinct QA Lead, reason, expiry where applicable and exact platform action. `DOD` and `EVIDENCE` waiver kinds are absent in feature 002: every pre-close DoD hard blocker and executed negative evidence obligation remains non-waivable. A `FINDING` waiver disposes only the Finding.

**Rationale:** follows FR-024/FR-028, Constitution VI/VII and master role policy. Distinct means not the candidate initiator/primary signer as defined by action subject.

**Alternatives considered:**

- QA Lead as sole high-risk signer — rejected: requirement says co-sign/independent review;
- role check only at candidate creation — rejected due TOCTOU;
- free-form approval — rejected because subject drift would be possible.

## R-010 — ManualAttempt

**Decision:** add Pack-owned `ManualAttempt` for each execution of a Plan Item. It carries attempt ID/no, actor/time, target snapshot hash and constitutional canonical attempt result. PlanItemResult remains the feature-specific human check result; Observation references exactly one ManualAttempt and carries structured expected/actual outcome. История попыток append-only: result membership is server-derived as the complete contiguous set of every finalized Attempt `1..current maximum` plus the complete current-leaf Observation set under the Plan Item/Session lock; request hashes/watermark are CAS assertions, never selection authority. A running Attempt prevents result; result commit atomically makes the Plan Item `TERMINAL`, so execution/result has one winner and no late Attempt/initial Observation can reopen it. A pre-review Observation correction may stale the result and require a superseding human decision. Every executed result has Observations, and `PASS` includes a `POSITIVE` Observation of a `PASS` Attempt. Если после `ASSERTION_FAILED` тот же Plan Item получает success, итог нельзя свести к чистому `PASS`; policy требует `FLAKY_SUSPECTED` и human disposition. На independently runnable US3 допустим только `INCONCLUSIVE`: migration `2015` не ссылается на будущие Finding tables. Migration `2025` в US4 additively replaces/extends the deferred resolver and permits flagged `PASS` only when the superseding result pins the complete exact server-derived `ASSERTION_FAILED` Attempt set, an exact same-PlanItem `NEGATIVE|AMBIGUOUS` Observation set covering every failed Attempt, and the exact current `DISPOSED` Finding-review/membership/policy basis containing those Observations. The Session review UoW then rechecks all complete sets unchanged and atomically creates/pins their `FROZEN` successor with the manifest; it never accepts an unrelated same-Session Finding, requires an impossible pre-result freeze or edits `2015`.

**Rationale:** Constitution VIII requires Attempt IDs in manifest and Constitution VII defines canonical Attempt Result, while feature spec models manual Plan Items/Observations. Explicit ManualAttempt closes this gap without importing `AutomationAttempt` from feature 005.

**Alternatives considered:**

- omit attempt for MANUAL — rejected as constitutional violation;
- use Observation ID as attempt ID — rejected: one attempt can produce multiple observations;
- implement generic AutomationAttempt now — rejected scope expansion.

## R-011 — Session snapshot freeze

**Decision:** target/scope/owner/capabilities/Plan Items may be edited with optimistic concurrency before start. Every edit advances one canonical Session structure revision/hash; an edit from READY atomically records an audited `READY→PLANNED(STRUCTURE_CHANGED)` reset, so a complete prepare guard must run again. Edit and start share one lock/CAS: edit-first makes start fail from PLANNED, start-first atomically pins canonical hashes and makes the edit fail. After `startedAt` domain and DB constraints reject mutation; a requested change creates a same-scope linked Session.

**Rationale:** meets FR-012, preserves reproducibility and handles edit/start races.

**Alternatives considered:**

- freeze at Session creation — too restrictive for planning;
- mutable “latest build/environment” aliases — rejected by Constitution VIII;
- update in place with audit — audit does not restore the executed exact target.

## R-012 — Reusable definition handling

**Decision:** Plan Item/ScopeSnapshot stores immutable external ref + version/commit + content hash. If source cannot promise immutability, a session-scoped definition snapshot is stored. No reusable library tables/editor are added.

The US2 increment creates planning-only `PLANNED` Plan Items. Manual result/waiver transitions and their scoped latest-result FK are installed additively with execution migration `2015` in US3, so an independently runnable planning story does not depend on a future result table.

**Rationale:** fulfills FR-013 and Constitution I without becoming a TMS.

**Alternatives considered:**

- only URL/path — mutable and unreproducible;
- copy every external definition — unnecessary duplication;
- build repository in Platform DB — explicit non-goal.

## R-013 — Evidence binary store and local limits

**Decision:** binary evidence uses generic artifact service/provider from 001 and S3Mock in local profile. PostgreSQL stores metadata/reference/checksum; QA Manifest stores scoped links. Local policy uses conservative fixture limits and allowlisted media types defined by versioned `evidencePolicy@1`; production policy remains out of scope.

**Rationale:** feature 005 GitLab artifact integration is unavailable, but Constitution VIII permits approved object storage. Provider-neutral port prevents local emulator from becoming product semantics.

**Alternatives considered:**

- binary in PostgreSQL — rejected size/security/ownership boundary;
- defer all attachments to 005 — violates FR-014/FR-016;
- raw filesystem paths — rejected access and portability risks.

## R-014 — Evidence signature semantics

**Decision:** “signed” means immutable domain attestation over `SHA-256(RFC 8785 canonical manifest content)` plus verified human identity, live authorization basis, policy version and timestamp. No PKI/legal non-repudiation claim is made.

**Rationale:** specification needs human sign-off and immutability, not certificate infrastructure. Canonical hashing already exists in 001.

**Alternatives considered:**

- mutable signer fields on manifest row — rejected, no immutable subject;
- asymmetric PKI — out of scope and lacks key-lifecycle requirements;
- audit event only — insufficient self-contained revision proof.

## R-015 — Evidence corrections and expiry

**Decision:** signed revision is append-only. Correction creates `revision n+1` with previous ID, reason, new hash and signature. Artifact availability is a mutable generic projection; expiry never changes signed content/checksum/history. После confirmed external `DONE` допускается только clerical evidence correction: US5 atomically сохраняет non-adjudicative revision и отдельный append-only `POST_CLOSE_NOT_EVALUATED` marker, оставляет adjudicative pointer/Verdict/DoD неизменными и возвращает marker history после restart. Семантическое изменение QA conclusion требует нового linked request; reopen не входит в 002.

**Rationale:** directly implements FR-017…FR-019 and separates fact from current availability.

**Alternatives considered:**

- edit manifest with audit trail — rejected by constitution;
- delete expired metadata — destroys provenance;
- copy binary into each revision — wasteful and outside provider boundary.

## R-016 — Finding aggregation and defect cardinality

**Decision:** one Observation belongs to at most one active Finding; one Finding has at most one active draft and one confirmed DefectLink; feature 002 does not merge multiple Findings into one defect. Reclassification is revisioned only before Session review/freeze and invalidates any pending Finding-disposition platform action. No wording proposal, defect candidate or defect Approval exists before freeze; canonical proposal/draft starts from the frozen revision after Session completion. Candidate replacement first terminally invalidates its current pre-dispatch head; successor lineage is legal only from exact current `FAILED|INVALIDATED`. Human `REJECTED` and confirmed `LINKED` are chain-terminal, and a confirmed link forbids every later candidate. A confirmed link is never erased.

**Rationale:** deterministic cardinality prevents duplicate/conflicting dispositions while satisfying “group manifestations before defect”.

**Alternatives considered:**

- defect per observation — explicitly rejected by ADR/spec;
- many Findings per defect — useful later but requires merge/ownership semantics absent from 002;
- permit post-freeze reclassification and delete a draft/link — rejected because it would destroy signed/audited external history.

## R-017 — Defect draft and model boundary

**Decision:** canonical draft builder is deterministic and versioned. Optional `QaDraftAssistant` can return only a schema-validated wording proposal from allowlisted, already human-classified metadata after Session completion. Human acceptance creates a new immutable candidate; explicit rejection creates an immutable rejected revision/reason and leaves the Finding without external publication. Model cannot create session-plan hints, classify or publish.

**Rationale:** SC-006 requires model-independent flow and Constitution V treats model result as proposal. Full Hermes Agent Runtime belongs to 004.

**Alternatives considered:**

- require model — violates degraded mode;
- no proposal port — valid but would not prove restricted evidence filtering/model failure scenario;
- let provider call command tool — forbidden authority escalation.

## R-018 — Exact Approval classes

**Decision:**

- initial request create: explicit Requester confirmation is authorization intent; no second Approval;
- external READY transition and defect create: `EXTERNAL_COMMAND` exact Approval;
- final external DONE transition: completion candidate prepared by QA Executor, exact-approved by a distinct currently authorized QA Lead, then consumed as `EXTERNAL_COMMAND`;
- waiver, accepted risk and high-risk co-sign: `PLATFORM_ACTION` exact Approval;
- ordinary human signatures: direct authorized append-only mutation with exact content hash and audit.

**Rationale:** matches Constitution VI, ADR-0007 and feature roles without blanket approvals.

**Alternatives considered:**

- Approval for every Plan Item write — unnecessary friction, not required;
- no Approval for mock transitions — mock must exercise same constitutional boundary as future Jira;
- one subject shape for all effects — rejected by ADR-0007.

## R-019 — Session review, manifest ordering and defect cycle

**Decision:** during `REVIEW_REQUIRED`, Observations are first aggregated into Findings and every Finding is human-classified and receives a disposition. Затем одна transaction подписывает `SessionOutcome` + Evidence Manifest и завершает Session. Manifest records the classification/disposition and exact Observation/artifact refs used at signing time; it does not require a future DefectLink. Defect draft publication may happen after Session completion, uses the signed immutable refs, and creates a separate canonical `DefectLink`. For each `CREATE_DEFECT` Finding, DoD evaluates the current publication chain: it must end `LINKED` or explicit human `REJECTED`; historical `FAILED|INVALIDATED` candidates remain audit history and are acceptable only when an exact successor reaches that terminal current outcome. Non-create dispositions have no draft/link.

**Rationale:** avoids circular dependency where defect needs a signed manifest that itself needs defect disposition.

**Alternatives considered:**

- sign manifest before Finding disposition — violates DoD/evidence completeness;
- require DefectLink in the same manifest — creates a review/publication cycle;
- mutate a signed manifest after defect publication — violates immutability.

## R-020 — Verdict and completion

**Decision:** Verdict is append-only and may be superseded only while the external operational request remains open. DoD evaluates an exact aggregate snapshot. `DONE + FAIL` requires fully signed verdict, complete scope/evidence/dispositions, a distinct QA Lead completion approval and one exact confirmed external terminal operation. Its closed provider-neutral payload carries canonical completion summary `{scope, Verdict, residual risk, evidence refs, defect/disposition refs}` plus digest so Mock now and Jira later can render the mandatory external completion comment without changing QA Pack/capability semantics. Confirmation requires both matching summary digest and terminal state. Generic confirmation UoW then synchronizes the derived projection to `normalizedStatus=DONE`; QA code never assigns a competing Core `CLOSED` authority state. Open linked defect is not a blocker. After confirmed DONE, 002 rejects verdict mutation/reopen; R-015 permits only non-retroactive clerical evidence correction.

**Rationale:** separates QA service completion from product quality/release decision and prevents stale completion approval.

**Alternatives considered:**

- Done only for PASS — explicitly rejected;
- local close before external confirmation — violates authority;
- allow post-close edit/reopen — requires new workflow/authority rules outside 002.

## R-021 — Scope and non-disclosure

**Decision:** every QA repository method requires Workspace+Project scope; every child repeats both IDs and uses composite FK. Deny occurs before child lookup, storage/model/queue/Broker/Connector. Public cross-project denial does not reveal existence.

**Rationale:** Constitution III is a hard boundary and SC-005 explicitly requires API/artifact/command coverage.

**Alternatives considered:**

- filter only at controller — async/repository paths remain vulnerable;
- globally unique ID lookup then authorize — leaks timing/existence and can load wrong data;
- UI hiding — never a security control.

## R-022 — Migrations and append-only enforcement

**Decision:** QA Pack owns ordered range `2000…2030` after Core/Dummy composition. Signed manifest/verdict/audit-like history uses insert-only repository APIs and database update/delete rejection. Fresh/repeat/current-1/failed-recovery run on PostgreSQL 17/18.

**Rationale:** aligns module ownership and 001 migration strategy; database provides a second invariant boundary.

**Alternatives considered:**

- add QA tables to Core migrations — ownership violation;
- TypeORM synchronize — forbidden;
- app-only immutability — insufficient against adapter/maintenance defects.

## R-023 — Local composition and production barrier

**Decision:** reuse services from 001; add QA package, operational Mock operations, scoped seed and scenarios. Only LOCAL/NON_PRODUCTION targets are accepted. Mock/Fake/local routes and credentials are absent from non-local composition, while QA Pack itself is allowed in future non-local/pilot composition.

**Rationale:** preserves local-first acceptance without incorrectly banning product QA code from pilot builds.

**Alternatives considered:**

- new QA service/container — unnecessary;
- permit configurable arbitrary endpoint in local — production reachability risk;
- ban QA from all non-local builds — would conflict with roadmap/pilot.

## R-024 — Verification catalog

**Decision:** use feature-local `AT-001…AT-015` spanning contract/architecture, real PostgreSQL, Connector conformance, security zero-call assertions, crash/retry/Redis loss, artifact expiry, model outage and Playwright/smoke. Trace every FR/SC to primary and supporting executable tests.

**Rationale:** risk-based tests match 001 conventions and constitutional Principle XII; a coverage percentage would not prove authority/isolation/recovery.

**Alternatives considered:**

- one large E2E — poor fault localization and misses negative invariants;
- unit tests only — cannot prove DB/effect/security boundaries;
- test all only at final hardening — violates tests-first story checkpoints.

## R-025 — Actor matrix and minimal backlog

**Decision:** Requester creates/confirms intake and can read only entitled requests; QA Executor assesses readiness, plans/executes Sessions, classifies Findings, accepts/rejects defect drafts and signs an ordinary Verdict; a distinct QA Lead approves terminal completion and all policy-listed independent actions; service identities, Requester and Hermes cannot perform human-only mutations. US-001 includes a minimal project-scoped confirmed-request backlog list/detail query and UI, without ranking, SLA or cross-project ordering.

**Rationale:** this removes ambiguity at each terminal mutation and makes the user-visible value in US-001 independently demonstrable without entering the future queue-management scope.

**Alternatives considered:**

- let the same Executor approve final close — rejected because final-close authority belongs to QA Lead and would not be independent;
- build a prioritized Ready Queue — rejected as feature 006 scope;
- expose only IDs from create response — insufficient for the specified backlog scenario.

## R-026 — Static composition without generic leakage

**Decision:** QA exports Pack-owned manifest, permissions, schemas, UI contribution and extension hooks. Generic runtimes consume typed contributions; no generic controller/catalog contains QA branches. API/worker use typed `AWP_COMPOSITION=foundation|qa-local`: omitted/default `foundation` preserves every 001 command, while only explicit `qa-local` selects QA factories and is legal solely with `AWP_RUNTIME_PROFILE=local|test`, denied external network and Mock Hub. Web imports the compile-time QA UI contribution directly, and Mock Hub owns its own operational module. Separate `local:qa:*` commands pass the selector through Compose, migrate and seed; legacy `local:*`/`smoke:001` omit it and remain foundation-only. A future non-local QA composition needs a new explicit selector and may contain QA Pack, but never Mock/Fake/local routes or credentials.

**Rationale:** preserves compile-time dependency rules, protects 001 regression and prevents product semantics leaking into Core/runtime modules.

**Alternatives considered:**

- append QA to 001 default arrays — rejected because `smoke:001` must prove a Core-only composition;
- overload `AWP_RUNTIME_PROFILE=local` as the Pack selector — rejected because both 001 foundation and 002 QA are local security profiles and would become indistinguishable;
- make Web import Node runtime-composition — violates browser/runtime dependency rules;
- add QA conditionals to generic controllers — violates extension ownership.

## R-027 — Additive generalization of feature 001 ports

**Decision:** after the hard 001 primitive gate, feature 002 generalizes four existing public mechanisms without QA semantics: create-specific confirmation becomes a typed multi-effect hook/UoW; Binding-specific `PLATFORM_ACTION` execution becomes a registered handler/CAS port; scoped Binding-health/Operational-projection reads become explicit public query ports over existing Core repositories; fixed permission/artifact authorization catalogs consume typed contributions. Existing 001 handlers and scoped repositories remain registered adapters and their behavior/regression contract is unchanged.

**Rationale:** current/planned 001 artifacts provide the durable primitives but not every product-Pack extension surface needed by the first real Pack. An additive generic registry preserves Core ownership and avoids both QA→Core repository access and `if qa` branches.

**Alternatives considered:**

- implement Pack-owned confirmation/action/artifact infrastructure — rejected as duplication and boundary violation;
- add QA branches to existing concrete executors/controllers — rejected by Constitution IV;
- block 002 until a separate infrastructure feature — unnecessary when the change is backward-compatible genericization already scoped by T002 compatibility tests.

## R-028 — Structurally confirmable request vs DoR-complete input

**Decision:** explicit confirmation accepts a closed, trusted-scope, secret-free request with structural minimum `{human title, request kind, authoritative data classification, scope/definition pin}` even when semantic DoR fields are missing. Typed external create uses title as summary and the real classification; optional description/acceptance outcome remain absent rather than fabricated. The confirmation hook atomically creates one stable `QaRequestExtension` and initial append-only `QaRequestInputRevision`; missing values/presence flags remain deterministic DoR blockers. Revision 1 freezes the full structural identity `{Workspace, Project, Work Item, definition, accepted Draft/external request/Binding, original requester, title, request kind, authoritative classification}` because 002 deliberately has no `request.update` operation and QA cannot rewrite Core/external security facts. While no READY command is dispatched/in-flight and operational READY is not confirmed, a live-entitled HUMAN Requester or QA Executor may publish revision `n+1` with expected-current CAS and reason, but its public body contains only DoR-semantic facts; the server carries the frozen tuple and application+DB reject drift. Server derives the response-channel resolution from the immutable original requester principal (`CONFIRMED` ref or `MISSING` blocker); readiness deterministically maps these to `CONFIRMED` and `UNCONFIRMED` respectively while preserving exact requester/policy/evaluation provenance and the ref/reason branch. Revision and READY dispatch serialize on one aggregate lock, so revision-first stales the command and dispatch-first blocks revision. Initial RequiredSessionPlan publication requires confirmed READY. Structural change at any time or semantic change after READY/Session requires a new linked QA request.

**Rationale:** US2 must be able to observe `NEEDS_INFO`, supply the missing fact and reassess without mutating history or requiring an impossible pre-confirmation DoR whose own rule requires an accepted external request.

**Alternatives considered:**

- require full DoR before confirmation — rejected because confirmed external request is itself a DoR input and the documented `NEEDS_INFO → revise → reassess` flow becomes unreachable;
- mutate `QaRequestExtension` facts in place — rejected because prior readiness/waiver fingerprints could not be reconstructed reliably;
- add Connector `request.update` — rejected because QA facts are Pack-owned and `operational-work-item@1.0.0` deliberately exposes exactly three effect operations.

## 2. Resolved ambiguity register

| Ambiguity | Resolution |
|---|---|
| Attempt IDs for MANUAL evidence | Explicit `ManualAttempt` entity and lineage (R-010) |
| Readiness versus external READY | Separate QA assessment and exact-confirmed operational transition (R-006) |
| Missing facts after confirmation | Append-only pre-READY `QaRequestInputRevision` + CAS/current/history; DoR pins exact revision (R-028) |
| BLOCKED/CANCELLED and DoD | BLOCKED is predecessor-tagged/resumable; an exact `SESSION` waiver excludes only a zero-execution cancelled Session but never satisfies its slot, while only a `REQUIRED_SESSION` waiver in a new plan version removes that slot and may not remove the last REQUIRED slot |
| Risk source | Maximum of pinned project and request risk |
| High-risk initiator | Primary verdict signer/candidate initiator; co-signer must be a different QA Lead |
| Binary evidence before GitLab | Generic artifact port + S3Mock local approved store |
| Negative-result evidence | Для каждого human `FAIL|BLOCKED|INCONCLUSIVE` и executed Attempt `ASSERTION_FAILED|INFRA_FAILED|TIMEOUT|INCOMPLETE` attachment обязателен без waiver и остаётся обязательным после позднего PASS; each negative Attempt also requires a same-PlanItem exact-Attempt `NEGATIVE|AMBIGUOUS` Observation, and each negative human result pins one from its considered set, so Finding cannot be bypassed; Observation does not invent an extra attachment rule outside FR-014 |
| Post-start target changes | New linked Session |
| Post-DONE change | Verdict/DoD mutation rejected; clerical manifest revision allowed as `POST_CLOSE_NOT_EVALUATED`, semantic change requires new linked request |
| Finding/defect cardinality | One active Finding per Observation, one draft/link per Finding in 002 |
| Session reviewer separation | Same authorized Executor may review ordinary Session; only policy-listed high-risk/waiver actions require distinct Lead |
| Terminal completion authority | Executor prepares candidate; distinct QA Lead exact-approves; Connector confirmation derives `normalizedStatus=DONE` |
| `regression` taxonomy | Included as request kind, still MANUAL in 002 |

## 3. Research gate

- No unresolved planning questions.
- No constitutional exception requested.
- All decisions have an executable validation path in [plan.md](plan.md) and [tasks.md](tasks.md).
- Phase 1 design may proceed to [data-model.md](data-model.md), `contracts/` and [quickstart.md](quickstart.md).
