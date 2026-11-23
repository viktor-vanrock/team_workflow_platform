# Phase 1 contracts: QA manual walking skeleton

Этот каталог является design-time нормативным контрактным пакетом feature
`002-qa-manual-walking-skeleton`. Он определяет публичные QA Pack payloads, HTTP API,
project-scoped events и vendor-neutral capability `operational-work-item@1.0.0`.
Документы не являются реализацией контроллеров, persistence adapters или Connector-а.

## Состав

- `openapi/qa-pack-api.v1.yaml` — OpenAPI 3.1 для QA Pack routes;
- `asyncapi/qa-events.v1.yaml` — AsyncAPI 3.0 для project-scoped QA events;
- `capabilities.md` — operation matrix и conformance rules capability;
- `schemas/common/` — QA aliases к published Core refs и закрытый scoped envelope;
- `schemas/intake/` — schema подтверждаемого QA intake;
- `schemas/qa/` — QA aggregate, snapshot, evidence, Finding, Verdict и DoD contracts;
- `schemas/operational-work-item/` — typed target/input/result contracts for exactly three writes;
- `schemas/events/` — payload catalog и alias к полному Event Envelope feature 001;
- `examples/positive/` и `examples/negative/` — representative conformance vectors.

Все schema documents используют JSON Schema 2020-12, имеют immutable `$id`, закрывают
неизвестные поля через `additionalProperties:false` и используют только repository-local `$ref`.
URI dialect в `$schema` не разрешает runtime network fetch.

## Нормативные инварианты

1. Каждый durable QA aggregate, event и cross-aggregate ref несёт `workspaceId` и `projectId`.
   HTTP body не принимает authoritative scope: он задаётся route и verified token context.
2. Actor, role, entitlement и authorization basis не принимаются из mutation body. Human records
   содержат только server-derived `HumanActorRef` и, где требуется, hash сохранённого generic basis.
3. `qa.validation@1.0.0` — единственный Work Type. Request kind — taxonomy
   `feature-validation | smoke | regression | retest | investigation`; Session mode в 002 только `MANUAL`.
   Structural confirmation требует non-empty human `title`, request kind, authoritative classification,
   definition/scope pins и explicit confirmation. `request.create.summary` — ровно этот title;
   отсутствующие goal/scope/outcome не подменяются текстом и не входят в create payload.
   Stable `QaRequestExtension` указывает на exact append-only `QaRequestInputRevision`. Initial revision
   может быть DoR-неполной; HUMAN Requester/Executor до READY/Session создаёт новую revision по CAS.
   Revision повторно разрешает `PLATFORM_WEB` только для immutable original requester principal,
   сохраняет `CONFIRMED+ref | MISSING`, declaration-presence flags и атомарно invalidates stale
   assessment/waiver/pending-not-dispatched READY refs. Readiness projection детерминирована:
   input `CONFIRMED` остаётся `CONFIRMED`, input `MISSING` становится `UNCONFIRMED`.
   `requesterPrincipal`, `resolutionPolicyRef` и `evaluatedAt` должны быть byte-for-byte равны;
   confirmed branch сохраняет exact `responseChannelRef` и не имеет reason, missing branch
   сохраняет exact `missingReasonCode` и не имеет ref. DISPATCHED/in-flight READY
   блокирует revision.
   Derived `OperationalReadinessProjection` имеет closed matrix: `NOT_EVALUATED` и
   `NEEDS_INFO` остаются Core `NEW` без command/result/error; ready assessment до
   confirmation остаётся `NEW + READY_PENDING_SYNC` с command; `SYNC_ERROR` добавляет
   error и не проецирует result. Confirmed `READY` имеет command+result, не имеет
   error и сохраняет факт readiness при Core status `READY` или любом более
   позднем canonical state. Core `normalizedStatus=NEEDS_INFO` в feature 002 не используется.
4. `ManualAttempt` является append-only execution lineage. Его canonical result —
   `PASS | ASSERTION_FAILED | INFRA_FAILED | TIMEOUT | CANCELLED | INCOMPLETE`; Plan Item result и
   Session Outcome остаются отдельными человеческими состояниями.
5. `TargetSnapshot` и `ScopeSnapshot` pin'ят exact versions/hashes. Singleton immutable rows
   (`TargetSnapshot`, `ScopeSnapshot`, `ManualAttempt`, `Observation`) используют
   `ImmutableContentRef {id,contentHash}`; versioned/revision records используют
   `ImmutableRevisionRef {id,version,contentHash}`. После старта Session snapshots immutable;
   изменение создаёт linked Session, а не редактирует snapshot. `TargetSnapshot` обязательно pin'ит
   exact test-data и account-lease refs до перехода Session в `RUNNING`.
6. Подписанные content bytes Evidence Manifest/Verdict не обновляются. Correction/supersession
   создаёт новую revision с previous exact ref, reason и новым content hash/sign-off. Mutable header/
   delivery projection изменяется только через CAS и не входит в signed content hash. После
   подтверждённого `DONE` создаётся новая
   `CLERICAL_CORRECTION` manifest revision с `evaluationStatus=POST_CLOSE_NOT_EVALUATED`,
   `isAdjudicative=false` и отдельным marker; adjudicative pointer и исходные Verdict/DoD не меняются.
   Ordered `manifest.clericalAnnotations` (`CORRECTION_NOTE | ARTIFACT_DISPLAY_LABEL`) входят в новый
   `contentHash` и human signature; display-label annotation pin'ит уже существующий artifact ID.
   Marker и read/history projection обязательно pin'ят exact final-close-confirmation ID, доказавший
   внешний `DONE` до correction, а также server-derived HUMAN requester, permission key и
   `authorizationBasisHash`. Mutation body не принимает authorization basis.
   Wire принимает только correction note или display label уже pinned artifact ref; outcome,
   classification, disposition, Verdict и DoD через этот endpoint изменить нельзя.
7. Artifact ingestion проходит через scoped attach-init, authenticated same-origin content upload и
   finalize. Тело/ответ контракта хранит generic `artifactId`, checksum, media type, size,
   classification и live availability, но никогда provider locator, presigned URL, token или raw
   binary. Подписанный manifest включает отдельный immutable member snapshot с checksum и
   `availabilityAtSigning`; последующая expiry меняет только current `EvidenceArtifactLink`, не
   подписанные bytes/content hash.
   Attachment Session является собственным CAS owner: init возвращает ETag, upload принимает его и
   возвращает новый ETag, finalize принимает новый token и возвращает final ETag. Manifest correction
   использует отдельный manifest-header `resourceVersion`/ETag; Session ETag для неё недействителен.
8. Observation не создаёт defect напрямую. Только HUMAN-classified `PRODUCT` Finding допускает
   immutable defect draft candidate; остальные dispositions дают zero Connector calls. Manifest
   может зафиксировать human intent `CREATE_DEFECT` до publication; будущий `DefectLink` — отдельная запись.
   Optional Draft Assistant возвращает только wording proposal: closed `MODEL_PROPOSAL |
   DETERMINISTIC_FALLBACK` provenance, exact frozen Finding ref и `proposalId+proposalHash`.
   Human acceptance pin'ит exact proposal ref; proposal никогда не имеет approval/publication authority.
9. QA schemas не копируют exact Approval subject. Они сохраняют только generic refs
   `{approvalId,subjectHash}` и `{platformActionId,approvalRef}`. Exact payload/target/expected-state/
   Binding/Profile semantics принадлежат generic Approval Gateway feature 001.
10. Любая внешняя запись использует `CapabilityCommandIntent` feature 001. QA Pack передаёт
    requirement key, typed target/input и client idempotency key; Profile, Connection, endpoint,
    credential и Gateway effect key клиент/Pack не выбирают.
11. `operational-work-item` не содержит Jira field names, transition IDs, JQL или provider response.
    Capability имеет ровно три write-операции: `request.create`, `request.transition`,
    `defect.create`. Read-back/reconciliation — generic confirmation strategy feature 001, не
    operation capability и не значение operation enum.
    Canonical status строго переиспользует Core 001 `NormalizedStatus`; provider tokens сохраняются
    только как sanitized `rawExternalState` и проходят declared raw→normalized mapping.
    `request.transition(DONE)` дополнительно несёт закрытый provider-neutral `completionSummary`
    (scope snapshots/summary, Verdict+exact ref, residual risk, exact evidence manifest refs и
    defect disposition/draft/link refs), покрытый `completionSummaryHash`. `CREATE_DEFECT` имеет
    closed publication outcome `LINKED` (ровно один draft+link) или `REJECTED` (exact draft/rejection,
    zero links); non-create dispositions запрещают draft/link, а `DUPLICATE` требует exact existing
    defect ref и human reason. Connector materializes
    его в том же idempotent external effect и подтверждает sanitized summary receipt; это не
    четвёртая operation.
12. Event transport использует полный project-scoped Event Envelope feature 001. Payload schema ref,
    producer/version, correlation/causation, actor и classification обязательны.
13. `DONE + FAIL` является допустимым завершением QA service request. Ни schema, API, operation,
    event, Finding disposition, Verdict, ни DoD не представляют release/no-release decision.
14. Completion и DoD pin'ят exact immutable Required Session Plan ref
    `{id,revision,contentHash}`. Финальный `DONE` exact-approves отличный от инициатора, заново
    авторизованный QA Lead; инициировать final close может только текущий HUMAN Executor, а QA Lead
    не может вызвать initiation route. Candidate сохраняет server-derived `initiatorRole=EXECUTOR`,
    permission key и authorization-basis hash. Закрытие наступает только после generic confirmation, которая выводит
    derived `normalizedStatus=DONE`.
    Request Extension валиден в US1 без plan pointer; US2 публикует первую immutable revision и
    устанавливает optional latest pointer, который при наличии всегда имеет эту exact форму.
    Initial plan publication требует exact confirmed generic `request.transition(READY)` proof для
    того же assessment/input revision; history/current GET возвращают ETag, header resourceVersion и frozenAt.
15. FR-014 безусловен: для `FAIL`, `BLOCKED`, `INCONCLUSIVE` требуется attachment/evidence.
    Evidence waiver отсутствует во всех API, schemas, events и examples. Manifest сохраняет все
    attempts и observations; каждый executed negative attempt обязан иметь собственный finalized,
    accessible, same-scope/same-owner evidence link даже если последующий retry прошёл. Флаг
    `FLAKY_SUSPECTED` не снимает это требование.
    Approved/unexpired `PLAN_ITEM` waiver означает честный `NOT_RUN` с exact waiver ref и нулём
    Attempts (`maximumAttemptNo=0`); executed result всегда имеет полный непустой exact Attempt set
    и полный непустой current-leaf Observation set. Service, а не caller, выводит оба набора:
    command несёт только expected set hashes/counts/max для CAS, durable result/event/manifest —
    `ALL_FINALIZED_CONTIGUOUS` Attempt refs и `ALL_CURRENT_LEAVES` Observation refs.
    Clean `PASS` требует хотя бы один exact `POSITIVE` Observation на exact `PASS` Attempt
    с structured expected/actual outcomes.
16. `RequiredSessionPlan` публикуется/пересматривается только отдельной HUMAN command с CAS по current
    revision. Каждый slot имеет стабильные `requirementKey+ordinal`, `minimumSessionCount`, capabilities,
    exact target/scope/checklist policy refs и `REQUIRED|WAIVED` resolution; Session pin'ит exact slot.
    Exact `QaProjectContext` содержит closed target/scope/checklist allowlists и defaults;
    each default ref должен быть byte-equal member своего allowlist. Plan pin'ит canonical
    set hash, а publication отклоняет slot ref вне pinned context. Checklist defaults —
    subset `allowedChecklistPolicyRefs`, а не неявный catalog.
    До первой публикации существует стабильный empty header (`currentRevisionRef=null`, `revisions=[]`)
    с `resourceVersion`/ETag; INITIAL использует его `If-Match`, а 201 возвращает новый header version/ETag.
    Каждая опубликованная revision сохраняет хотя бы один `REQUIRED` slot. Prior completed Session
    переносится только через exact `carriedForwardFromRequirementRef` при byte-equal stable key,
    ordinal и content hash; изменённый slot требует новую Session, а `WAIVED` slot carry-forward запрещает.
    Initial publication требует current Core `READY`; later pre-freeze revisions сохраняют исторический
    READY proof, но допускают current `READY|PLANNED|IN_PROGRESS|REVIEW|BLOCKED`, никогда `DONE`.
17. Reload/history UI использует scoped `qa/detail` projection и специализированные current/history
    routes. Projection сохраняет readiness/waiver/plan, sessions/reviews/execution, evidence,
    Findings/defects, Verdict/signatures/DoD/completion histories, а не только latest values.
    Story contributions заполняют свои section arrays независимо; до подключения owning contribution
    array может быть пустым, но final composition регистрирует каждый section ровно один раз и не создаёт
    второй authority/read-model owner.
18. Mutations публикуют full-envelope event families, включая
    `qa.request.input-revised`, `qa.required-session-plan.published`, `qa.test-session.state-changed`,
    `qa.test-session.reviewed` и `qa.plan-item.result-recorded`; event transport не заменяет audit.
19. Feature 002 не имеет DOD waiver. Единственный waivable DoR blocker —
    `PROJECT_REGISTRY_NEEDS_REVIEW` через exact same-scope, unexpired, distinct-QA-Lead action.
    Все content/declaration/scope/classification/security/entitlement/channel/RETEST/Binding/Profile
    blockers non-waivable. Skip semantics ограничены `PLAN_ITEM | SESSION | REQUIRED_SESSION`;
    Finding waiver остаётся отдельным disposition action и никогда не отменяет evidence.
20. `QaRequestExtension` — единый CAS owner для всех adjudicative mutations и содержит
    server-derived `adjudicativeAggregateHash` плюс closed `completionDispatchGuard`.
    Candidate pin'ит этот hash в immutable close content. Dispatch в одной транзакции заново
    проверяет extension resourceVersion/hash, переводит Candidate и guard в `DISPATCHED`, сохраняет
    exact command/effect и только затем пишет outbox. Пока guard `DISPATCHED`, input/readiness/waiver/
    plan/execution/review/evidence adjudication/Finding/defect/Verdict/DoD/новый Candidate mutation
    отклоняется как `COMPLETION_IN_FLIGHT`. Любая adjudicative correction-first меняет aggregate hash
    и invalidates `CANDIDATE|AWAITING_APPROVAL|AUTHORIZED` с нулём Connector calls; dispatch-first
    блокирует correction. Из `DISPATCHED` допустимы только `CONFIRMED|FAILED`. `FAILED`
    сохраняет command/effect provenance и освобождает guard обратно в `OPEN`; confirmed external
    `DONE` переводит его в `DONE_FROZEN`. `INVALIDATED` остаётся строго pre-dispatch. Post-DONE
    clerical correction не adjudicative, не меняет Verdict/DoD/adjudicative pointer и проходит по
    отдельному append-only contract.
    HUMAN `REJECTED` является только исходом exact generic Approval из `AWAITING_APPROVAL`;
    `CANDIDATE` не имеет discard/reject route и при pre-approval drift становится `INVALIDATED`.
21. Fail→pass может быть записан как `result=PASS + FLAKY_SUSPECTED` только с exact
    `flakyDispositionBasis` на текущий `DISPOSED` Finding review: Finding ID, immutable review
    ref/hash, полный exact failed-Attempt subset/hash, покрывающие NEGATIVE/AMBIGUOUS
    Observation refs/hash, active-membership-set hash и pinned policy ref. Result и public command pin'ят один и
    тот же basis; будущий `FROZEN` ref там запрещён. Session review UoW заново проверяет неизменность
    basis и атомарно создаёт append-only `FROZEN` successor, сохраняет disposed→frozen confirmation
    в SessionReview и подписывает manifest. Closed flag matrix допускает `FLAKY_SUSPECTED`
    только для `PASS|INCONCLUSIVE`: `INCONCLUSIVE` не зависит от будущего freeze и запрещает
    `flakyDispositionBasis`, а `FAIL|BLOCKED|NOT_RUN` запрещают сам flag.
22. Finding review — достижимая append-only цепочка. Version 1 всегда `CLASSIFIED` без predecessor;
    `DISPOSED` — exact successor текущего `CLASSIFIED`, `FROZEN` — exact successor текущего
    `DISPOSED`, а reclassification создаёт новый `CLASSIFIED` successor. Все successors сохраняют
    тот же scope/Finding/review aggregate ID, увеличивают version ровно на один и pin'ят exact
    immutable predecessor ref/hash; Session review rechecks current `DISPOSED` before freeze и один
    `qa.test-session.reviewed` event несёт полный ordered/unique `frozenFindingReviewRefs` set
    (явно empty для clean US3), без partial per-Finding freeze events.
23. Observation↔Finding grouping хранится append-only membership rows, а не доверенным client
    массивом. Assign/release — отдельные closed HUMAN commands с `If-Match`, exact current
    membership-set hash и server-derived actor/scope; release однонаправлен, требует reason,
    reassign создаёт новую row. GET возвращает полную history, current set hash и ETag. Один
    Observation имеет максимум один active membership, cross-Session/cross-scope assignment и
    любые mutations после `FROZEN` отклоняются. Session/Attempt/Observation/Finding mutations
    возвращают следующий ETag, поэтому read→command CAS chain исполним без скрытого token source.
24. `QaRequestInputRevision` version 1 freezes structural identity: Workspace/Project/Work Item,
    definition, accepted Draft, external Request, operational Binding, original Requester, title,
    request kind и classification. Later `RevisionCommand.input` — closed DoR-semantic body without
    these fields. Server copies the tuple from revision 1, re-resolves the channel from the original
    Requester (не revision actor), and both application and insert-time DB comparison reject drift.
25. Session structural inputs имеют monotonic `structureRevision` и `structureHash`.
    `readyAgainstStructureHash` равен null в `PLANNED` и exact current hash начиная с
    `READY`. Любая pre-start structural edit из `READY` одним aggregate CAS возвращает
    Session в `PLANNED`, очищает ready-against, пишет `STRUCTURE_CHANGED` provenance и
    возвращает новый ETag; start требует exact hash equality.
26. Verdict lifecycle закрыт как `DRAFT | PARTIALLY_SIGNED | SIGNED | SUPERSEDED`.
    Upstream drift не создаёт `INVALIDATED`: historical Verdict остаётся `SIGNED`, current
    selector отклоняет stale exact ref/hash, а только explicit HUMAN revision атомарно помечает
    старую signed revision как `SUPERSEDED`.
27. DefectDraft wording replacement сначала переводит current pre-dispatch
    `DRAFT|READY_FOR_APPROVAL|AWAITING_APPROVAL|AUTHORIZED` в `INVALIDATED`, сохраняя exact
    predecessor-owned projection. `REJECTED` from `READY_FOR_APPROVAL` сохраняет
    `acceptedBy/acceptedAt`; `REJECTED` и `LINKED` не имеют successor candidate.

## Schema catalog

| Группа | Schemas |
|---|---|
| Common | `qa-common`, `scoped-envelope` |
| Intake/context | `qa-intake`, `qa-request-extension`, `qa-request-input-revision`, `qa-request-input-history`, `qa-project-context`, `risk-review-policy` |
| Readiness | `readiness-assessment`, `qa-waiver`, `required-session-plan`, `required-session-plan-history` |
| Execution | `target-snapshot`, `scope-snapshot`, `test-session`, `session-review`, `plan-item`, `manual-attempt`, `observation`, `plan-item-result-revision` |
| Evidence | `evidence-attachment-session`, `evidence-artifact-link`, `evidence-manifest-member`, `evidence-manifest`, `evidence-manifest-revision`, `evidence-manifest-history` |
| Findings | `finding`, `finding-observation-membership`, `finding-review-revision`, `defect-draft-proposal`, `defect-draft`, `defect-link` |
| Completion/read model | `qa-verdict`, `verdict-signature`, `dod-assessment`, `completion-candidate`, `final-close-confirmation`, `post-close-correction-marker`, `qa-backlog-item`, `qa-work-item-detail` |
| Connector | `operational-scope`, `operational-target`, `request-create`, `request-transition`, `completion-summary`, `defect-create`, `operational-result` |
| Events | `qa-events`, `qa-event-envelope` |

## Versioning

- Pack, Work Type, rule/policy refs и capability: strict SemVer;
- aggregate/event payload: positive integer major `schemaVersion`/`payloadVersion`;
- immutable resource revision: positive integer plus RFC 8785/SHA-256 `contentHash`;
- exact Binding/Profile refs: `{id,version}`; historical command pins never follow `latest`;
- additive optional field may be minor-compatible; removal/rename/narrowing/new required field,
  changed signature input or relaxed invariant requires new major schema and migration/replay policy.

## Approval boundary

Mutation responses may expose `approvalRef` or `platformActionRef`, but no QA endpoint accepts an
approval decision, approver identity, subject hash input or replacement exact subject. Decisions use
the generic approval API from feature 001. `defect.create`, operational transitions, waivers,
`ACCEPTED_RISK` and risk co-sign follow policy documented in `capabilities.md` and `plan.md`.
Evidence itself is never waivable: FR-014 remains unconditional.

## Example validation

`examples/manifest.json` maps each fixture to its schema and expected validity.
`examples/semantic-invariants.json` дополнительно задаёт cross-document checks, которые JSON Schema
не выражает: byte-preserving clerical diff against the exact previous manifest и equality полного
completion-summary projection с exact-approved transition input. Negative examples are
deliberately invalid and must fail for the stated reason:

- client-supplied authoritative scope in intake;
- `AUTOMATED` Session in feature 002;
- Plan Item result used as a ManualAttempt result;
- provider locator embedded in evidence;
- Jira-specific field in a vendor-neutral operation;
- event envelope without `projectId`;
- forbidden `EVIDENCE` waiver;
- forbidden fourth `read-back` operation;
- mutable embedded Required Session Plan instead of its exact immutable revision ref;
- negative Plan Item result without attachment/evidence;
- fail→pass/`FLAKY_SUSPECTED` lineage whose first negative attempt lacks its own evidence;
- TargetSnapshot without exact test-data input;
- provider `BACKLOG` used as canonical normalized status instead of raw state.
- hash-only `DONE` summary and terminal summary incorrectly supplied to a `READY` transition.
- client-supplied response-channel authority and input revision after READY dispatch;
- forbidden `DOD` waiver and any DoR waiver code except `PROJECT_REGISTRY_NEEDS_REVIEW`.

Runtime/CI validation must load the shared offline registry, resolve every local `$ref`, validate all
positive fixtures, assert all negative fixtures fail, compare the QA event alias with the published
Core envelope, and run the same operation suite for Mock plus a second implementation.
