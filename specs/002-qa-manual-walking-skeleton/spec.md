# Feature Specification: QA manual walking skeleton

> **Superseded для текущей v1:** Redis/BullMQ delivery и S3-backed manual binary
> evidence из этой исторической feature заменены PostgreSQL delivery и
> metadata-only manual evidence по [Feature 010](../010-remove-redis-s3/spec.md) и
> [ADR-0009](../../docs/adr/0009-v1-without-redis-s3.md).

**Feature ID:** `002-qa-manual-walking-skeleton`  
**Статус:** Implementation in progress; Feature 001 prerequisite gate passed
**Приоритет:** P1  
**Зависимости:** `001-extension-kernel-local-skeleton`  
**Ценность:** дать первую пользовательскую ценность — полный ручной QA-цикл от подтверждённой заявки до подписанного verdict и defect draft.

## 1. Контекст и граница

Feature добавляет `QA Competency Pack` и единственный Work Type пилота `qa.validation`. Она работает против Mock operational connector и Mock Project Integration Binding, чтобы доменная ценность не зависела от готовности корпоративной Jira.

Manual и automated testing не являются отдельными Work Types. В этой feature реализуется `MANUAL` Test Session; `AUTOMATED` добавляется feature 005.

Платформа не становится test-case management system: reusable test definitions остаются в Git/внешнем TMS, а QA Pack хранит session-scoped plan/checklist snapshot, результаты, evidence и provenance.

## 2. User scenarios и независимые тесты

### US-001 — Создание QA validation request (P1)

Как Requester, я хочу создать и подтвердить QA-заявку для разрешённого проекта, чтобы она получила центральную mock Jira QA Request и попала в backlog.

**Независимый тест:** подтверждённый Intake Draft создаёт ровно один Work Item и одну external QA issue; неподтверждённый draft не создаёт operational work.

### US-002 — Readiness и manual session plan (P1)

Как QA Executor, я хочу увидеть missing information и создать ручную сессию с неизменяемым target/scope snapshot, чтобы проверка была воспроизводимой.

**Acceptance scenarios:**

1. **Given** обязательные поля отсутствуют, **when** выполняется readiness check, **then** request остаётся `NEEDS_INFO` и показывает конкретные missing fields.
2. **Given** confirmed request имеет missing DoR facts, **when** авторизованный Requester/QA Executor публикует новую request-input revision с expected-current CAS, **then** immutable history сохраняется, current pointer moves atomically и прежние assessment/waiver/pending READY intents становятся stale.
3. **Given** DoR выполнен, **when** QA Executor подтверждает readiness, **then** создаётся exact-approved external transition и request сначала показывает `READY_PENDING_SYNC`, а только подтверждённый Connector result/read-back переводит operational projection в `READY`; failure даёт `SYNC_ERROR`, не fake READY.
4. **Given** external/operational `READY` подтверждён и current inputs актуальны, **when** авторизованный QA Executor/Lead явно публикует initial RequiredSessionPlan с expected-current CAS, **then** создаётся immutable revision, extension pointer moves atomically, а предыдущая revision остаётся queryable.
5. **Given** session стартовала, **when** пользователь пытается изменить build/environment/scope, **then** изменение отклоняется и предлагается новая linked session.

### US-003 — Выполнение простой ручной проверки (P1)

Как QA Executor, я хочу фиксировать plan items, observations и evidence, чтобы сформировать проверяемый session outcome.

**Независимый тест:** manual session проходит `PLANNED → READY → RUNNING → REVIEW_REQUIRED → COMPLETED`, сохраняя actor/timestamps и immutable evidence revision.

### US-004 — Finding и defect draft (P1)

Как QA Executor, я хочу сгруппировать failed observations в Finding и подготовить defect draft, чтобы не создавать дефект на каждое проявление.

**Acceptance scenarios:**

1. **Given** один или несколько failed checks имеют frozen human `PRODUCT` Finding revision в completed/reviewed Session, **when** QA начинает publication workflow, **then** deterministic Pack template (с необязательным wording-only model proposal) может сформировать defect draft.
2. **Given** Finding классифицирован как `INFRA`, `INCONCLUSIVE` или `DUPLICATE`, **when** session завершается, **then** Jira defect автоматически не создаётся.
3. **Given** defect draft подтверждён авторизованным QA Executor, **when** mock write завершается, **then** создаётся ровно один linked defect.

### US-005 — Завершение с отрицательным verdict (P1)

Как QA Executor, я хочу завершить выполненную QA-работу с verdict `FAIL`, чтобы открытый продуктовый дефект не удерживал QA request в WIP.

**Независимый тест:** все обязательные sessions/evidence/findings завершены; после distinct-QA-Lead exact approval внешний request получает provider-neutral completion summary/comment и подтверждённый terminal transition, Work Item получает derived `DONE`, QA verdict остаётся `FAIL`, defect связан, release decision не создаётся.

## 3. Domain model

### 3.1. QA request extension и input revisions

`QaRequestExtension` содержит:

- `workItemId`, `definitionVersion`, `projectId` и exact current `QaRequestInputRevision` ref;
- readiness assessment и rule version;
- nullable exact `RequiredSessionPlan` revision/content ref (сам plan не встраивается).

Append-only `QaRequestInputRevision` хранит structural-minimum human title, request kind и authoritative data classification, optional-until-DoR goal/agreed-validation-scope/outcome/source/build/target/test-data/risk/date facts, explicit presence state для blockers/dependencies, conditional RETEST refs и server-derived response-channel resolution (`CONFIRMED` с verified Platform Web ref либо `MISSING`). Initial revision создаётся из confirmed Draft. Все последующие rows byte-for-byte сохраняют confirmed structural identity `{Workspace, Project, Work Item, qa.validation definition, accepted Draft/external-request/Binding refs, original requester, title, requestKind, authoritative dataClassificationKey}`; клиент revision-команды вообще не может прислать замену этих полей, server копирует их из initial row, а application и DB отклоняют drift. Optional `scope` здесь означает agreed QA validation scope, а не authoritative Workspace/Project/definition scope, и остаётся DoR-semantic фактом. Пока READY command не находится в `DISPATCHED`/in-flight и operational `READY` не confirmed, авторизованный Requester/QA Executor может CAS-публиковать исправленную semantic revision с reason. Terminal failed READY attempt освобождает lock и invalidates its candidate, поэтому revision снова разрешена; confirmed READY или существующая Session замораживает input окончательно. Channel каждый раз re-resolve'ится по immutable original requester principal, а не revision actor; клиент не задаёт authoritative ref. Изменение frozen identity или дальнейшее semantic изменение после freeze требует нового linked QA request.

Она не дублирует Jira-owned status, priority, assignee и due date.

### 3.2. Test Session

```text
PLANNED → READY → RUNNING → REVIEW_REQUIRED → COMPLETED
   │         │        │            │
   └─────────┴────────┴────────────→ BLOCKED
READY ── structural edit ──→ PLANNED
BLOCKED → READY | RUNNING | REVIEW_REQUIRED | CANCELLED
Any non-terminal → CANCELLED only while execution facts are empty
```

Any pre-start structural edit to target/scope/owner/capabilities/Plan Items increments the Session structure revision/hash. If current state is `READY`, the same CAS transaction records `READY→PLANNED` with HUMAN actor, reason and old/new structure hashes and clears only the current ready-against pointer; the historical READY attestation stays auditable. A new full `PLANNED→READY` check is mandatory. Edit/start serialize: edit-first makes start fail from PLANNED, start-first locks RUNNING and rejects the edit. `BLOCKED|CANCELLED` preserve the exact predecessor stage and every reached milestone; future-stage fields are forbidden. Resume cannot skip a guard and must return to the matching reached stage (`PLANNED` block reaches `READY` only through the normal readiness guard). Cancellation after any Attempt/Observation/result is rejected; such a Session remains `BLOCKED` and must resume. Consequently an exact `SESSION` waiver can consume only a zero-execution cancelled Session and never suppress FR-014 evidence.

`TestSession` содержит:

- `workItemId`, ordinal, mode=`MANUAL`, purpose;
- exact `RequiredSessionPlan` revision and requirement key; slot purpose/capabilities/policies are server-derived;
- optional parent session для retest/rerun lineage;
- immutable `TargetSnapshot`;
- immutable `ScopeSnapshot`;
- owner и required capabilities;
- plan items и observations;
- session outcome;
- evidence revisions;
- finding/defect links;
- actor/timestamps/correlation/version.

### 3.3. Results и verdict

- Manual plan item result: `PASS`, `FAIL`, `BLOCKED`, `NOT_RUN`, `INCONCLUSIVE`; `NOT_RUN` означает zero Attempts и требует exact approved, unexpired `PLAN_ITEM` waiver, тогда как любой executed result pin'ит непустое множество Attempts.
- Session outcome: `PASSED`, `FAILED`, `BLOCKED`, `INCONCLUSIVE`.
- QA verdict: `PASS`, `FAIL`, `BLOCKED`, `INCONCLUSIVE`.

Session outcome и QA verdict устанавливаются человеком. Hermes не подписывает verdict.

### 3.4. Finding

Finding агрегирует observations и имеет classification:

- `PRODUCT`;
- `INFRA`;
- `INCONCLUSIVE`;
- `DUPLICATE`;
- `ACCEPTED_RISK`.

Finding хранит severity, summary, affected target, evidence links, classification actor/reason и defect disposition.

## 4. Functional requirements

### 4.1. Work Type и intake

- **FR-001:** QA Pack предоставляет versioned Work Type `qa.validation`.
- **FR-002:** request kind поддерживает минимум `feature-validation`, `smoke`, `retest`, `investigation` как taxonomy, а не отдельные Work Types.
- **FR-003:** Intake Draft требует explicit confirmation и structural minimum `{title, requestKind, authoritative dataClassificationKey, scope/definition pin}` до external issue creation; DoR-semantic facts могут оставаться отсутствующими без их fabrication.
- **FR-004:** повтор confirmation не создаёт duplicate Work Item/issue.
- **FR-005:** каждый request привязан к одному Workspace и одному Project Entitlement scope.

### 4.2. Definition of Ready

- **FR-006:** Confirmed request может иметь structurally valid, но DoR-incomplete initial input; пока READY command не находится в `DISPATCHED`/in-flight и operational READY не confirmed, Requester/QA Executor исправляет его только новой immutable `QaRequestInputRevision` с expected-current CAS/reason. Каждая later revision обязана сохранить initial confirmed structural identity `{Workspace, Project, Work Item, definition, accepted Draft/external request/Binding, original requester, title, requestKind, authoritative classification}`; revision body содержит только DoR-semantic replacement fields, server переносит frozen identity, application и DB отклоняют её изменение. Terminal failed READY attempt освобождает этот lock; confirmed READY или Session замораживает input. Channel re-resolve использует immutable original requester principal. DoR pin'ит exact current revision и проверяет confirmed external QA request, ACTIVE Project, requester entitlement и server-confirmed response channel; persisted resolution `CONFIRMED` остаётся readiness input `CONFIRMED`, а `MISSING` детерминированно отображается в `UNCONFIRMED` с теми же requester/policy/evaluation provenance и stable reason. Также проверяются goal/agreed validation scope/outcome, explicit blockers/dependencies, применимые source/build refs и `retest` defect+previous-Session lineage; non-prod target, test data/access, impact/risk/date, checklist refs, classification; Project Registry `CURRENT` либо exact QA Lead DoR waiver для `NEEDS_REVIEW`; mandatory Binding/Profile mapping validation без blocking errors. Новая input revision invalidates assessments/waivers/pending, ещё не dispatched READY intents over старого fingerprint.
- **FR-007:** readiness engine выдаёт structured missing fields.
- **FR-008:** `READY` подтверждает QA Executor или QA Lead.
- **FR-009:** В feature 002 DoR waiver allowlist содержит только `PROJECT_REGISTRY_NEEDS_REVIEW`; inactive/scope/entitlement/channel/content/declaration/lineage/classification/security/mapping blockers не waivable. Allowed waiver требует exact scope/rule/input fingerprint, distinct QA Lead, причины, expiry и audit; он обязан быть unexpired при readiness confirmation и при авторизации внешнего READY effect.

### 4.3. Manual execution

- **FR-010:** один Work Item поддерживает несколько sessions.
- **FR-011:** session имеет ровно один mode.
- **FR-012:** target/scope после старта immutable; изменение создаёт новую session.
- **FR-013:** Initial RequiredSessionPlan можно публиковать только после confirmed operational READY; later revision сохраняет exact historical READY proof и разрешена только при current operational `READY|PLANNED|IN_PROGRESS|REVIEW|BLOCKED`, тогда как terminal `CANCELLED|DONE` её запрещает. Каждый slot использует только exact target/scope/checklist policy refs из allowlisted catalog pinned QA Project Context, а каждая MANUAL Session pin’ит exact published plan revision/requirement key. Одноразовый checklist хранится внутри session, external definition фиксируется immutable version/hash или snapshot, client-selected unknown policy ref отклоняется.
- **FR-014:** attachment/evidence обязателен для каждой выполненной отрицательной Attempt/result lineage (`ASSERTION_FAILED`, `INFRA_FAILED`, `TIMEOUT`, `INCOMPLETE` и human `FAIL|BLOCKED|INCONCLUSIVE`) независимо от более позднего PASS. Для любого executed human result сервер под lock выводит полный contiguous set всех finalized Attempts Plan Item (`1..current maximum`) и полный exact set их current-leaf Observations; client передаёт только expected hashes/watermark для CAS и не может исключить failed Attempt или Observation. Running Attempt запрещает result; successful result commit atomically переводит Plan Item в `TERMINAL` и запрещает новую Attempt/initial Observation, поэтому в race execution-first расширяет derived sets, а result-first отклоняет позднюю execution mutation. Допустимая до Session review Observation correction делает прежний result non-current до новой revision. Каждый executed result имеет непустой Observation set; `PASS` содержит минимум одну `POSITIVE` Observation exact `PASS` Attempt как structured source expected/actual outcome. Кроме attachment, каждая negative Attempt имеет минимум одну same-PlanItem Observation exact этого Attempt с kind `NEGATIVE|AMBIGUOUS`, а каждый negative human result pin'ит минимум одну такую Observation. Zero/stale/wrong-Attempt/only-INFORMATIONAL substitution оставляет review в stable `FINDING_REQUIRED`; для чистого `PASS` attachment не обязателен.
- **FR-015:** перевод в `COMPLETED` разрешён только после human review.

### 4.4. Evidence

- **FR-016:** evidence manifest содержит project/work item/session/check IDs, actor/timestamps, target snapshot, definition version/hash, expected/actual outcome, result, provenance и artifact checksums.
- **FR-017:** подписанный manifest immutable.
- **FR-018:** исправление создаёт новую revision с reason и previous revision link.
- **FR-019:** истёкший artifact отображается `EXPIRED`, metadata/checksum сохраняются.
- **FR-020:** access к evidence проверяет Workspace, Project, role и classification.

### 4.5. Findings, defects и Done

- **FR-021:** failed observation не создаёт defect напрямую.
- **FR-022:** defect draft создаётся только из human-classified Finding.
- **FR-023:** publication defect draft требует exact approval и idempotency.
- **FR-024:** обычный defect может подтвердить QA Executor; high-risk waiver требует отличного от инициатора QA Lead.
- **FR-025:** DoD сначала может выдать только pre-close `READY_TO_CLOSE` при terminal/waived plan items, completed/reviewed sessions, полном evidence, classified Findings, defect disposition, residual risk и signed verdict; финальный `SATISFIED` создаётся лишь после подтверждённой внешней completion summary/comment со scope, Verdict, residual risk и evidence/defect links как части typed terminal transition.
- **FR-026:** открытый defect не блокирует `DONE + FAIL`.
- **FR-027:** QA Pack не принимает release/no-release решение.
- **FR-028:** Versioned `riskReviewPolicy` MUST требовать независимый QA Lead co-sign для HIGH/CRITICAL project or request risk, sole allowlisted DoR waiver, Session/Plan Item/Required Session/Finding waiver и `ACCEPTED_RISK`; обычный verdict в остальных случаях подписывает QA Executor. `PLAN_ITEM` разрешает только zero-Attempt `NOT_RUN`; `SESSION` исключает только cancelled Session с пустыми Attempt/Observation/result sets, но не удовлетворяет requirement; только `REQUIRED_SESSION` в новой plan revision снимает сам requirement, причём нельзя waive последний `REQUIRED` slot. Feature 002 не имеет `DOD`/`EVIDENCE` waiver kind: все pre-close DoD blockers и FR-014 obligations non-waivable.

## 5. TargetSnapshot

Минимальный snapshot:

- `projectId`;
- build/commit/MR reference;
- `environmentId + revision`;
- test data reference;
- account lease reference;
- checklist version/hash;
- exact Project Integration Binding ref `{id, version}` и все фактически использованные Profile refs.

Passwords, tokens, cookies и raw credentials не хранятся в QA domain или agent context.

## 6. Roles и approvals

- Requester создаёт/подтверждает intake и может публиковать pre-READY missing-info input revision в разрешённом project scope.
- QA Executor планирует/выполняет manual session, классифицирует Findings и подписывает обычный verdict.
- QA Lead независимо подтверждает verdict при HIGH/CRITICAL classification, waivers, `ACCEPTED_RISK` и policy overrides согласно pinned `riskReviewPolicy`.
- Hermes runtime не реализуется в 002; любой будущий coordinator/model caller ограничен proposal-only assessments/draft wording и project-scoped grants, без human mutation/approval.

Approval привязан к единственной identity `actionKind + actionId`, payload hash, target, action-specific expected state, exact binding/profile refs, initiator, human approver и его role/authorization basis, Workspace/Project scope, expiry и idempotency key и является одноразовым. Consumption не может добавить второй action ref.

## 7. Security и failure scenarios

- Попытка доступа без Project Entitlement возвращает deny без раскрытия существования entity.
- Сбой Mock operational connector сохраняет command pending/error и не создаёт local fake canonical state.
- Повтор webhook/command не создаёт duplicate issue/defect.
- Сбой модели не блокирует readiness, manual session и verdict.
- Evidence с запрещённой classification не передаётся model provider.

## 8. Success criteria

- **SC-001:** один confirmed request создаёт одну mock Jira QA Request.
- **SC-002:** manual request проходит полный flow до signed verdict.
- **SC-003:** `DONE + FAIL` демонстрируется с linked defect и подтверждённой provider-neutral completion summary/comment.
- **SC-004:** signed evidence восстанавливает target, checklist, actor и result.
- **SC-005:** cross-project isolation покрыта API/artifact/command tests.
- **SC-006:** весь flow работает при недоступной модели.

## 9. Out of scope

- automated Test Session/GitLab;
- Mattermost intake;
- reusable test-case repository;
- production target;
- automatic defect publication;
- release decision;
- complex queue/capacity/SLA.
