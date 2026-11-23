# Quickstart: QA manual walking skeleton

**Feature:** `002-qa-manual-walking-skeleton`
**Spec Kit phase:** Phase 8 — implemented runnable validation guide
**Target runtime:** Node.js 24.20.0, pnpm 11.21.0
**External systems:** только local Mock Hub, Fake IdP и S3Mock

> Важно: команды `verify:002`, `smoke:002`, `test:e2e:002`, `trace:002` и
> closed catalog QA-сценариев реализованы. `verify:002` намеренно выполняет clean
> scoped reset volumes выделенного verification project `awp-local-f002-gate`
> (рабочие volumes `awp-local` не удаляются), сначала подтверждает неизменный
> foundation regression, затем поднимает `qa-local` для browser acceptance.

## 1. Что доказывает quickstart

Полный локальный прогон должен доказать:

- подтверждённый Intake Draft создаёт ровно одну внешнюю mock QA Request, один
  Work Item, один Operational Binding и один `QaRequestExtension`;
- неподтверждённый, pending или failed create не создаёт принятый Work Item;
- confirmed request сразу виден в минимальном scoped Confirmed Backlog без
  реализации ranking, capacity, WIP или SLA;
- deterministic DoR показывает structured missing fields, а внешний `READY`
  появляется только после exact-approved transition и read-back confirmation;
- MANUAL Session фиксирует exact target/scope и после старта не допускает их
  изменения;
- отрицательный manual result невозможно review/complete без обязательного
  attachment/evidence; evidence waiver для FR-014 отсутствует;
- failed/ambiguous Observations сначала агрегируются и классифицируются в
  Findings, и только после этого подписываются Session Outcome и Evidence
  Manifest;
- signed manifest фиксирует Finding classification/disposition, но не обязан
  содержать будущий `DefectLink`; defect publication может выполняться после
  Session review по тем же immutable Observation/artifact references;
- defect создаётся только из human-classified `PRODUCT` Finding и только после
  exact approval авторизованного QA Executor/Lead;
- `DONE + FAIL` завершается одним exact-approved QA Lead external transition,
  причём Lead отличен от completion initiator;
- локальная Work Item projection получает `DONE` только из подтверждённого
  external state; отдельная canonical local state `CLOSED` не создаётся;
- Verdict не является release/no-release решением;
- model provider используется только для необязательного предложения wording
  defect draft; его отсутствие не блокирует ни один шаг;
- Workspace/Project/role/classification checks действуют на API, backlog,
  artifact, model, command, approval, worker и Connector paths;
- retry, restart, Redis loss, duplicate/out-of-order delivery и ambiguous
  external result не создают повторных issue, defect или transition effects.

Нормативные и design-источники:

- [feature specification](./spec.md);
- [implementation plan](./plan.md);
- [research decisions](./research.md);
- [data model](./data-model.md);
- [contract catalog](./contracts/README.md);
- [Конституция](../../.specify/memory/constitution.md).

При расхождении этого guide с Конституцией или feature specification действует
нормативный документ. Expected API и event shapes берутся из `contracts/`, а не
из примеров UI ниже.

## 2. Prerequisites

### 2.1. Toolchain

~~~bash
node --version
pnpm --version
docker version
docker compose version
~~~

Ожидается:

- Node.js major 24;
- pnpm `11.21.0`;
- Docker Engine 24+;
- Docker Compose 2.20+;
- свободные local ports, объявленные typed configuration feature 001.

При Node major, отличном от 24, нужно остановиться до install/bootstrap. Такой
fail-fast является prerequisite mismatch, а не application failure.

### 2.2. Feature 001 gate

Feature 002 не подменяет command, approval, artifact или Mock infrastructure
собственными обходами. Перед первым запуском:

~~~bash
pnpm install --frozen-lockfile
pnpm prerequisites
pnpm smoke:001
node tools/verification/feature-002-prerequisites.mts
~~~

Ожидаемый prerequisite report подтверждает:

- `artifacts/verification/feature-001-gate.json` существует и содержит PASS для
  всех acceptance gates feature 001;
- stable public contracts Command, Approval, Artifact, Event и Confirmation
  доступны в совместимых `1.x` versions;
- Work Item создаётся только confirmation transaction после external effect;
- exact Approval, outbox/worker recovery, artifact proxy, Mock Hub и local
  composition работают;
- `smoke:001` остаётся зелёным без QA Pack.

Любой FAIL здесь блокирует feature 002. Нельзя продолжать через QA-only
in-memory command, direct Mock call или direct Work Item insert.

### 2.3. Local-only security profile

Local запуск обязан использовать как минимум:

~~~text
AWP_RUNTIME_PROFILE=local
AWP_COMPOSITION=qa-local
AWP_EXTERNAL_NETWORK_MODE=deny
AWP_OBJECT_STORE_PROVIDER=s3mock
QA target environment class=NON_PRODUCTION
~~~

В local configuration не должно быть corporate Jira/GitLab/Mattermost URLs,
production credentials, real secret values или unrestricted outbound network.
TargetSnapshot хранит только opaque test-data/account-lease refs и exact
versioned integration refs.

## 3. Local topology and endpoints

Feature 002 переиспользует стек feature 001:

| Service | Роль в validation |
|---|---|
| PostgreSQL | Core и QA durable state; отдельная Mock Hub DB |
| Redis | восстанавливаемый BullMQ delivery accelerator, не authority |
| S3Mock | approved local binary evidence store за generic artifact port |
| Fake IdP | backend-verified HUMAN/SERVICE identities |
| Mock Hub | внешние mock QA Requests/defects, monotonic versions и effect ledger |
| API | scoped commands/queries, backlog и artifact proxy |
| Worker | outbox dispatch, approval/effect gates и reconciliation |
| Web | Requester/Executor/Lead walkthrough с постоянным LOCAL banner |

Default URLs наследуются от feature 001:

| Surface | Default |
|---|---|
| Web | `http://localhost:5173` |
| API | `http://localhost:3000` |
| API readiness | `http://localhost:3000/health/ready` |
| OpenAPI | `http://localhost:3000/api/docs` |
| Mock Hub | `http://localhost:4010` |
| Mock Hub readiness | `http://localhost:4010/health/ready` |
| S3Mock | `http://localhost:9090` |

Порты могут быть переопределены только через typed local configuration; manual
walkthrough не должен hard-code provider locator или обращаться к S3Mock
напрямую для evidence download.

## 4. Start, seed and target command contract

### 4.1. First run

~~~bash
pnpm local:qa:up
pnpm local:qa:status
pnpm local:qa:migrate
pnpm local:qa:seed
~~~

QA entrypoints explicitly set `AWP_COMPOSITION=qa-local`. Plain legacy
`pnpm local:*` and `pnpm smoke:001` omit the selector and therefore keep the
`foundation` composition; they must never acquire QA migrations, routes or seed.

Ожидается:

1. migrations Core, QA Pack и Mock Hub завершились до старта API/worker;
2. `competency-qa@1.0.0`, `qa.validation@1.0.0` и
   `operational-work-item@1.0.0` зарегистрированы статически;
3. QA Work Type enabled только в seeded Workspace;
4. exact Mock Connection/Profile/Binding revisions опубликованы для logical
   roles QA Request Authority и Defect Destination;
5. local seed повторяем и не создаёт accepted Work Items, completed Sessions,
   signed Verdicts или pre-consumed approvals;
6. повторный `local:qa:seed` не меняет published hashes и не создаёт duplicate
   identities, contexts, policies или bindings.

### 4.2. Stable verification entrypoints

Стабильные команды:

~~~bash
pnpm test:e2e:002
pnpm smoke:002
pnpm trace:002
pnpm verify:002
~~~

Назначение:

| Command | Проверка |
|---|---|
| `test:e2e:002` | browser PASS и DONE+FAIL paths с backend personas |
| `smoke:002` | clean/repeat/restart/model-outage/isolation flow и effect counts |
| `trace:002` | отсутствие orphan US/FR/SC/AT/tasks/tests |
| `verify:002` | aggregate contract, architecture, migration, security, integration, E2E и smoke gate |

QA scenario CLI расширяет local scenario interface feature 001:

~~~bash
pnpm local:qa:scenario -- list
pnpm local:qa:scenario -- run qa-manual-pass
pnpm local:qa:scenario -- run qa-manual-fail
pnpm local:qa:scenario -- run qa-high-risk
pnpm local:qa:scenario -- run qa-model-outage
pnpm local:qa:scenario -- run qa-cross-project-deny
pnpm local:qa:scenario -- reset
~~~

`reset` должен быть scoped local-only operation. Он не принимает workspace root,
`HOME`, glob или unresolved environment variable как destructive target.

## 5. Seeded personas and scopes

Target seed использует разные immutable principals:

| Persona | Scope и ожидаемые полномочия |
|---|---|
| `requester.alpha` | ALPHA Requester: создать/подтвердить intake, публиковать pre-READY input revision, читать свой разрешённый request/history |
| `executor.alpha` | ALPHA QA Executor: backlog, pre-READY input revision, readiness, plan/execute/review, Finding classification, ordinary defect/Verdict |
| `lead.alpha` | ALPHA QA Lead: independent high-risk/waiver review и exact final-close approval |
| `viewer.beta` | BETA-only read; не видит ALPHA entities/counts/artifacts |
| `outsider.delta` | другой Workspace; не видит existence ALPHA/BETA |
| `worker.local` | SERVICE с минимальными project-scoped grants; не HUMAN и не может подписывать/approve |

Обязательные identity assertions:

- `qa.validation@1.0.0` enabled только в intended QA Workspace; в другом Workspace тот же intake отклоняется до command creation;
- ALPHA Project Registry is `ACTIVE/CURRENT`; BETA includes an `ACTIVE/NEEDS_REVIEW` fixture requiring exact Lead DoR waiver;
- response-channel resolution always uses the immutable original requester principal and is `CONFIRMED` with a verified allowed `PLATFORM_WEB` ref or `MISSING` with a stable code; an Executor revision cannot substitute its own channel, no client body can forge it and no Mattermost runtime is required in 002;
- `executor.alpha` и `lead.alpha` имеют разные principal IDs;
- completion initiator в walkthrough — `executor.alpha`, final-close approver —
  `lead.alpha`;
- persona switcher получает backend-issued local session;
- role, entitlement, classification ceiling и authoritative scope не берутся из
  request body/header;
- Requester authorship не предоставляет queue/environment/artifact access сверх
  explicit entitlement.

## 6. Automated smoke baseline

~~~bash
pnpm smoke:002
~~~

Минимальный target report:

~~~text
feature 001 prerequisite ........ PASS
QA registration/contracts ....... PASS
migrations and seed ............. PASS
confirmed intake exactly once ... PASS
input revision/history/CAS ...... PASS
confirmed backlog visibility .... PASS
readiness and READY sync ........ PASS
master DoR/retest/mapping rules . PASS
session snapshot immutability ... PASS
manual evidence policy .......... PASS
Finding before review ........... PASS
signed evidence revision ........ PASS
defect publication exactly once . PASS
risk-reviewed verdict ........... PASS
external DONE projection ........ PASS
project isolation ............... PASS
model outage fallback ........... PASS
audit/effect trace ............... PASS
release-decision absence ........ PASS
~~~

Smoke сравнивает Mock Hub `effectCount`, а не число transport calls. Retry может
создать несколько calls, но observable effect для каждого stable effect key
должен быть ровно один.

## 7. Manual PASS walkthrough

### 7.1. Confirmed request and backlog

1. Открыть Web и проверить постоянный `LOCAL DEVELOPMENT` banner, Workspace,
   Project и текущую persona.
2. Выбрать `requester.alpha` и Project ALPHA.
3. Создать structurally valid, но DoR-incomplete `qa.validation` Draft: указать
   human title, request kind `feature-validation`, authoritative classification
   и exact Project/definition scope, но намеренно опустить goal/outcome и
   blockers/dependencies declaration. Для отдельного полного `retest` vector
   позже указать defect, source build и typed immutable previous-Session ref:
   `EXTERNAL_HISTORICAL` для US1 fixture либо same-scope `QA_SESSION` только
   после появления US3 completed/reviewed Session со signed manifest.
4. До confirmation проверить: external effect count `0`, Work Item отсутствует,
   Confirmed Backlog не содержит request.
5. Подтвердить exact Draft version. Повторить confirmation с тем же
   idempotency key и canonical payload.
6. Дождаться Mock read-back confirmation.

Ожидается:

- один sparse external QA Request effect: summary равен human title,
  classification реальна, отсутствующие description/acceptance outcome не
  fabricated;
- один Work Item, Operational Binding, `QaRequestExtension` и initial immutable
  `QaRequestInputRevision`, появившиеся одной local transaction;
- extension содержит exact current-input pointer, а revision — server-derived
  original-requester response-channel resolution `CONFIRMED|MISSING`;
- duplicate confirmation возвращает исходный command/result;
- тот же key с другим payload даёт conflict и zero new effects;
- request виден в минимальном ALPHA Confirmed Backlog;
- backlog query scoped: Requester видит только разрешённый request, Executor —
  разрешённый project backlog; ranking/WIP/SLA отсутствуют.

### 7.2. Readiness and Session planning

1. Переключиться на `executor.alpha` и прочитать current input + immutable
   history; initial revision должна быть той же, что создана confirmation hook.
2. Выполнить readiness assessment над exact current revision.
3. Проверить `NEEDS_INFO` и stable structured missing code/field/remediation.
4. Проверить table cases: Project not ACTIVE, missing entitlement/channel,
   omitted blockers/dependencies, incomplete RETEST lineage, `NEEDS_REVIEW`
   without exact unexpired Lead waiver and mapping blocker all prevent READY;
   только `PROJECT_REGISTRY_NEEDS_REVIEW` waivable, остальные codes rejected;
   отдельно проверить expiry/drift между assessment confirmation и external
   READY authorization.
5. Опубликовать новую `QaRequestInputRevision` с expected-current CAS, reason и
   заполненными goal/scope/outcome/build/non-prod/test-data/risk/date/checklist/
   declaration facts; проверить previous link/history и что channel повторно
   вычислен по original requester, а не `executor.alpha`.
6. Убедиться, что старая assessment/waiver/pending READY candidate стала stale;
   проверить race: revision-first blocks dispatch, dispatch-first blocks revise,
   failed dispatch permits revise, confirmed READY freezes input.
7. Повторить assessment и подтвердить blocker-free readiness; дождаться
   exact-approved mock `request.transition(READY)` и read-back.
8. Только после confirmed READY явно опубликовать initial RequiredSessionPlan под
   HUMAN Executor/Lead с exact request-input/readiness/context/rule/policy refs,
   ordered requirement keys, expected-current CAS и publication reason;
   проверить current и immutable history.
9. Создать required MANUAL Session из конкретного requirement key и Plan Items;
   purpose/capabilities/policies должны быть выведены из plan slot.
10. Проверить TargetSnapshot: exact build/commit/MR, environment ID+revision,
   test-data/account refs, checklist version/hash, exact Binding/Profile refs.
11. Проверить ScopeSnapshot: purpose, agreed scope, acceptance outcome,
   inclusions/exclusions и immutable definition ref/hash-or-snapshot.
12. Перевести Session `PLANNED → READY → RUNNING`.
13. Попробовать изменить build/environment/scope.

Ожидается:

- до confirmed external READY assessment остаётся QA-owned decision, а UI
  показывает pending sync отдельно;
- exact request-input revision, ACTIVE/CURRENT Project, entitlement,
  original-requester confirmed response channel, declared blockers/dependencies,
  request-kind lineage and mapping-health inputs входят в assessment fingerprint;
  `NEEDS_REVIEW` requires the sole exact Lead waiver;
- Ready projection появляется только после confirmed external state;
- initial plan publication недоступна до confirmed READY; затем отдельный human
  command atomically двигает extension pointer и не переписывает старую revision;
- post-start mutation отклоняется как snapshot locked;
- UI предлагает новую same-scope linked Session и не переписывает исходную.

### 7.3. PASS execution, review and completion

1. Для каждого Plan Item создать ManualAttempt `PASS` и минимум одну current-leaf structured `POSITIVE` Observation с expected/actual outcome exact этого Attempt.
2. Создать HUMAN PlanItem result revision `PASS`, передав только expected maximum/Attempt-set/Observation-set hashes; сервер под lock выводит и сохраняет полный contiguous finalized Attempt set и полный current-leaf Observation set. Negative vectors проверяют omitted earlier Attempt, stale hashes, running Attempt, zero/only-INFORMATIONAL/wrong-Attempt Observation; execution-first race входит в derived set, result-first atomically делает item `TERMINAL` и отклоняет поздний repeat/initial Observation.
   Отдельным negative vector проверить, что `NOT_RUN` принимается только при
   zero Attempts и exact approved/unexpired `PLAN_ITEM` waiver; после любой
   Attempt он отклоняется и не скрывает evidence obligation.
   Attachment не обязателен для каждого PASS, но `POSITIVE` Observation как actual-outcome source обязательна;
   reload показывает immutable Attempt/Observation/result histories.
3. Перевести Session в `REVIEW_REQUIRED`.
4. Убедиться, что failed/ambiguous Observations отсутствуют и Finding не нужен.
5. Выполнить human review под `executor.alpha`.
6. Подписать Session Outcome `PASSED` и Evidence Manifest revision 1 одной
   review transaction; дождаться `COMPLETED`.
7. Создать Verdict `PASS` с residual risk и подписать обычной QA Executor
   signature.
8. Выполнить deterministic DoD assessment.
9. Под `executor.alpha` инициировать immutable completion candidate с canonical
   summary: scope, Verdict, residual risk, evidence refs и defect dispositions.
10. Переключиться на отличного `lead.alpha`, просмотреть exact summary/target,
    external expected state/version и Binding/Profile refs, затем approve.
11. Дождаться read-back both confirmed summary digest/comment receipt и external
    `DONE`.

Ожидается:

- signed manifest восстанавливает Project/Work Item/Session/Plan Item/Attempt,
  target, checklist, actor, timestamps, expected/actual, result и checksums;
- external effects: request create `1`, READY transition `1`, defect create `0`,
  DONE transition `1`;
- external completion summary/comment содержит scope, PASS Verdict, residual
  risk, evidence refs и empty/explicit defect disposition; confirmed digest
  совпадает с approved payload;
- Work Item projection отражает confirmed external `DONE`; отдельного local
  canonical `CLOSED` нет;
- RequiredSessionPlan header заморожен той же confirmation transaction; любая
  последующая publish/revise команда отклоняется, history остаётся queryable;
- completion approval QA Lead отличен от completion initiator;
- audit связывает actor → candidate/approval → command → Connector → confirmed
  result;
- release entity/event/action отсутствует.

## 8. Manual DONE + FAIL walkthrough

Этот сценарий демонстрирует SC-003 и не означает product acceptance.

### 8.1. Failed execution and mandatory evidence

1. Запустить fresh ALPHA request через confirmed intake/readiness flow.
2. В RUNNING Session выполнить Plan Item и завершить ManualAttempt canonical
   result `ASSERTION_FAILED`.
3. Создать Observation с expected/actual outcome и попытаться atomically записать human PlanItem result `FAIL` без result-evidence membership.
4. Убедиться, что result command отклонён stable evidence-required error и не создал result revision/`TERMINAL` transition.
5. Прикрепить разрешённый screenshot/log через QA API; content проходит generic
   artifact proxy, checksum/media type/size/classification validation.
6. Atomically создать `FAIL` result с exact finalized artifact membership, затем повторить review precheck.

Ожидается:

- шаги 3–4 отклоняют именно result commit без evidence; после шага 6 result существует, а review остаётся `FINDING_REQUIRED` до US4;
- QA Lead evidence waiver не предлагается и не принимается;
- после valid attachment artifact locator не раскрывается, checksum сохраняется;
- отдельный pre-result vector выполняет failure Attempt, затем repeat PASS и только
  после этого создаёт один result over полный server-derived history; чистый PASS
  запрещён и требуется human inconclusive/flaky disposition согласно pinned QA
  policy. После result commit любой новый repeat отклоняется из `TERMINAL`.

### 8.2. Finding before review

1. В `REVIEW_REQUIRED` сгруппировать failed Observations в один Finding.
2. Под `executor.alpha` классифицировать его `PRODUCT`, указать severity,
   summary, affected target, evidence refs, classification reason и defect
   disposition.
3. Зафиксировать disposition `CREATE_DEFECT`; будущий draft/DefectLink не
   включать в подписываемый manifest.
4. Выполнить Session review: подписать Outcome `FAILED` и Evidence Manifest,
   затем получить `COMPLETED`.

Ожидается:

- Observation сама не создаёт defect;
- Finding aggregation/classification/disposition завершены до review;
- manifest фиксирует Finding classification/disposition и immutable evidence
  refs;
- external DefectLink на момент подписи manifest может отсутствовать;
- draft/model proposal до завершения review не требуется и external command не
  создаётся.

### 8.3. Defect publication after signed manifest

1. После `COMPLETED` создать deterministic defect draft candidate. При
   включённой модели запросить только wording proposal и явно принять либо
   отклонить immutable candidate revision с reason.
2. Из human-accepted immutable PRODUCT draft создать approval-required
   `defect.create` command.
3. Под авторизованным QA Executor подтвердить exact action; проверить payload
   hash, target, expected state, Binding/Profile refs, expiry и effect key.
4. Дождаться Mock effect/read-back и появления одного `DefectLink`.
5. Повторить approval callback/command delivery.

Ожидается:

- один external defect effect и один DefectLink;
- signed Session manifest не мутирует и не получает DefectLink задним числом;
- DefectLink отдельно ссылается на Finding, Session, external identity и exact
  integration refs;
- повтор возвращает исходный link;
- для `INFRA`, `INCONCLUSIVE`, `DUPLICATE`, unapproved `ACCEPTED_RISK` или
  rejected draft external defect effects равны `0`;
- если draft отвергнут человеком, reason/disposition/audit позволяют DoD без
  фиктивного external link.

### 8.4. FAIL Verdict and confirmed DONE

1. Создать Verdict `FAIL`, включающий exact completed Session и signed manifest
   revision, linked defect и residual risk.
2. Для ordinary risk подписать Verdict под `executor.alpha`. Для HIGH/CRITICAL
   дополнительно выполнить distinct `lead.alpha` co-sign scenario.
3. Выполнить deterministic DoD; open linked product defect не должен быть
   blocker.
4. Под `executor.alpha` инициировать completion с canonical scope/Verdict/
   residual-risk/evidence/defect summary.
5. Под отличного от completion initiator `lead.alpha` exact-approve full summary
   + terminal payload.
6. Дождаться подтверждения summary comment/digest и external `DONE`, затем
   обновления derived projection.

Ожидается:

- Verdict остаётся `FAIL`;
- external mock QA Request и local projection показывают `DONE`;
- external completion comment содержит scope, `FAIL`, residual risk, signed
  evidence и linked defect; digest равен approved candidate;
- linked product defect остаётся open;
- effects: QA Request create `1`, READY transition `1`, defect create `1`, DONE
  transition `1`;
- incomplete evidence, unclassified Finding, unresolved draft, unsigned Verdict,
  stale aggregate, self-approved close или revoked Lead оставляют effect count
  DONE равным `0`;
- ни один шаг не создаёт release/no-release decision.

## 9. High-risk and approval checks

~~~bash
pnpm local:qa:scenario -- run qa-high-risk
pnpm exec vitest run tests/integration/security/acceptance/002-at-010-verdict-risk-review.spec.ts
pnpm exec vitest run tests/integration/002-completion-recovery.spec.ts
~~~

Обязательные assertions:

- ordinary Verdict принимает QA Executor signature;
- HIGH/CRITICAL Verdict не final без distinct current QA Lead co-sign;
- forged HUMAN/role, SERVICE/AGENT signer, self co-sign, expired Approval и
  revoked entitlement отклоняются;
- sole Registry DoR, Session/Plan Item/Required Session/Finding waiver и `ACCEPTED_RISK` используют exact platform action; `DOD|EVIDENCE` kinds rejected, Finding waiver не отменяет attachment evidence;
- final close использует `EXTERNAL_COMMAND` Approval;
- final-close approver — QA Lead, отличный от immutable completion initiator;
- drift Verdict/manifest/target/payload/external version/Binding/Profile или
  authorization оставляет historical decision, но effect authorization
  становится invalidated и Connector call не выполняется;
- correction-first под shared extension lock переводит любой predispatch
  `CANDIDATE|AWAITING_APPROVAL|AUTHORIZED` в `INVALIDATED` до commit
  adjudicative mutation и оставляет DONE effect count `0`;
- dispatch-first атомарно ставит `DISPATCHED` guard/pointer и блокирует любую
  adjudicative mutation до terminal result;
- terminal `FAILED` сохраняет dispatch provenance и освобождает lock для новой
  mutation/candidate, а `CONFIRMED` фиксирует Core `DONE` и навсегда запрещает
  adjudicative mutation.

## 10. Model degraded mode

Model применяется только к wording proposal defect draft. Readiness, Session
plan/execution, Finding classification, evidence, Outcome, Verdict, DoD и
completion не вызывают model provider.

~~~bash
pnpm local:qa:scenario -- run qa-model-outage
pnpm exec vitest run tests/e2e/acceptance/002-at-013-model-degraded-mode.spec.ts
~~~

Проверить отдельно:

| Scenario | Expected result |
|---|---|
| provider unset | deterministic defect template; полный flow продолжается |
| timeout/provider error | deterministic fallback с explicit provenance |
| invalid schema | proposal rejected; canonical candidate не меняется |
| restricted classification | `MODEL_INPUT_DENIED`, provider call count `0` |
| prompt-like external text | остаётся untrusted data, tool grants не меняются |

`qa-model-outage` должен пройти полный DONE+FAIL flow, а не только unit test
template builder.

## 11. Isolation and non-disclosure

~~~bash
pnpm local:qa:scenario -- run qa-cross-project-deny
pnpm exec vitest run tests/integration/security/acceptance/002-at-012-cross-project-isolation.spec.ts
~~~

### Same Workspace, different Project

- `viewer.beta` не видит ALPHA confirmed backlog count/items;
- подмена project/work-item/session/finding/artifact/approval/profile ID не даёт
  доступ;
- denied action останавливается до child lookup, storage stream, model call,
  queue enqueue, Broker или Mock Hub;
- cross-project reference не переносит entitlement.

### Different Workspace

- `outsider.delta` не получает existence, counts, timestamps, metadata или
  provider locators ALPHA/BETA;
- deep link возвращает policy-safe deny/not-found shape;
- tampered async envelope отклоняется до domain mutation/external effect.

### Classification

- INTERNAL principal не читает RESTRICTED evidence даже в разрешённом Project;
- artifact metadata и content авторизуются отдельно непосредственно перед
  resolve/stream;
- restricted evidence не передаётся model provider;
- public response/log/audit/OTel не раскрывает raw evidence, secrets, object
  locator или чужой project identity.

## 12. Recovery and idempotency

### 12.1. Automated recovery suite

~~~bash
pnpm exec vitest run tests/integration/acceptance/002-at-015-resilience.spec.ts
pnpm smoke:002
~~~

Suite покрывает:

- timeout before external effect;
- crash after request effect before Work Item confirmation;
- crash after READY transition effect before local confirmation/input freeze;
- crash after defect effect before DefectLink commit;
- crash after completion comment or DONE sub-effect before combined projection
  confirmation;
- correction-first versus completion-dispatch-first serialization under the
  shared extension lock;
- terminal completion `FAILED` lock release and confirmed `DONE` freeze;
- worker restart и stale lease;
- полную потерю Redis с восстановлением из PostgreSQL;
- 401/403 terminal security classification;
- bounded retry для 429/5xx/timeout;
- duplicate/out-of-order event/result;
- schema drift quarantine;
- same idempotency key with different canonical hash conflict.

### 12.2. Expected recovery invariants

| Failure point | Expected durable result |
|---|---|
| create request pending/error | Draft и command сохранены; Work Item отсутствует |
| request effect succeeded, confirmation lost | read-back тем же effect key; одна request и один Work Item |
| READY effect succeeded, confirmation lost | до recovery projection остаётся `READY_PENDING_SYNC`; restart read-back тем же effect key подтверждает ровно один READY effect, переводит projection в `READY` и только тогда замораживает input |
| defect effect succeeded, link commit lost | один external defect; reconciliation создаёт один DefectLink |
| adjudicative correction wins before dispatch | predispatch candidate становится `INVALIDATED` в той же UoW; correction commits; Connector call count остаётся `0` |
| completion dispatch wins before correction | extension guard=`DISPATCHED`, pointer pins that candidate; correction и все adjudicative commands отклонены до downstream work |
| dispatched completion becomes terminal `FAILED` | dispatch provenance остаётся immutable, guard/pointer освобождён и новая mutation/candidate снова допустима |
| completion is `CONFIRMED` | matching summary+terminal state create one confirmation; Core projection=`DONE`, guard=`DONE_FROZEN`, all adjudicative mutation remains denied |
| completion comment or DONE sub-effect succeeded, combined confirmation lost | local projection не выдумывает DONE; same-effect read-back verifies approved summary digest plus terminal state and creates one confirmation |
| Redis lost | PostgreSQL outbox повторно публикует job; business state не теряется |
| duplicate delivery | duplicate ignored/audited; effect count не растёт |
| out-of-order version | stale result не откатывает projection |
| schema drift | no coercion/fake success; quarantined sanitized receipt |

После recovery audit должен восстанавливать исходного human initiator,
correlation/causation IDs, policy/profile versions, requested effect, retries и
confirmed result.

## 13. Evidence integrity and expiry

~~~bash
pnpm exec vitest run tests/contract/acceptance/002-at-006-evidence-manifest.spec.ts
pnpm exec vitest run tests/integration/002-evidence-integrity.spec.ts
pnpm exec vitest run tests/integration/002-evidence-storage-persistence.spec.ts
pnpm exec vitest run tests/integration/002-verdict-supersession.spec.ts
~~~

Ожидается:

- signed manifest update/delete отклоняется;
- correction создаёт revision `n+1` с reason, previous revision link, новым
  content hash и human signature;
- correction не используется для простого добавления позднего DefectLink;
- clerical correction после confirmed `DONE` помечается
  `POST_CLOSE_NOT_EVALUATED`, atomically сохраняет отдельный append-only marker,
  reload/history возвращают marker + latest/adjudicative revisions, а Verdict/DoD
  не меняются задним числом; semantic change требует нового linked QA request;
- checksum/media type/size mismatch не допускает artifact в manifest;
- S3Mock restart сохраняет разрешённый object/version/checksum;
- после expiry binary недоступен и status равен `EXPIRED`, но signed manifest,
  metadata/checksum и audit не меняются;
- resolve/download повторно проверяет current Workspace, Project, role и
  classification и не возвращает provider locator.

## 14. Focused verification catalog

Перед aggregate gate можно запускать focused suites:

~~~bash
pnpm test:contract
pnpm test:architecture
pnpm test:integration
pnpm test:e2e:002
pnpm trace:002
~~~

Минимальные focused expectations:

| Area | Expected proof |
|---|---|
| contracts | closed schemas/examples/digests, OpenAPI 3.1 и scoped event envelopes |
| architecture | no Core→QA, QA→Connector/vendor, Jira hardcode, runtime loading или AUTOMATED implementation |
| migrations | PostgreSQL 17/18 fresh/repeat/current-1/failed recovery; append-only constraints |
| intake | unconfirmed zero effect; confirmed/repeated exactly one |
| readiness | structured missing fields; exact READY sync; no model dependency |
| session | legal lifecycle, immutable started snapshots, attempt lineage |
| review | Findings classified/disposed before signed Outcome/Manifest |
| evidence | FR-014 mandatory negative-result evidence, immutable revision/expiry/access |
| defect | PRODUCT + human exact approval only; one effect/link |
| verdict | ordinary/high-risk signer matrix and exact snapshot |
| completion | distinct QA Lead approval and confirmed external DONE projection |
| security | zero downstream calls on scope/classification/role denial |
| degraded | full flow with model unset/invalid/timeout |
| resilience | crash/retry/Redis loss/duplicate/out-of-order/schema drift |

## 15. Final acceptance gate

~~~bash
pnpm verify:002
pnpm smoke:002
pnpm test:e2e:002
pnpm trace:002
pnpm smoke:001
~~~

Feature 002 считается доказанной только если:

- prerequisite feature 001 по-прежнему зелёный;
- все `US-001…US-005`, `FR-001…FR-028`, `SC-001…SC-006` и acceptance tests
  имеют executable evidence без orphan;
- PASS и DONE+FAIL browser flows проходят на clean environment;
- Confirmed Backlog доступен только в разрешённом scope и не реализует complex
  queue behavior;
- negative-result Session невозможно complete без evidence;
- Finding classification/disposition предшествует review;
- manifest остаётся immutable при последующей defect publication;
- ordinary defect создаётся ровно один раз после QA Executor exact approval;
- final close exact-approve выполняет QA Lead, отличный от completion initiator;
- external `DONE` подтверждён read-back/event и только затем отражён projection;
- open linked defect не блокирует `DONE + FAIL`;
- model outage/restricted input не блокирует full flow и не вызывает
  unauthorized provider calls;
- cross-project/cross-workspace denial не раскрывает existence и даёт zero
  downstream calls;
- production target/credential/network path отсутствует;
- release/no-release entity, API, event или action отсутствует;
- machine-readable result сохранён в
  `artifacts/verification/feature-002-gate.json`.

## 16. Troubleshooting contract

| Symptom | Expected diagnosis |
|---|---|
| prerequisite gate failed | завершить feature 001; не создавать QA-only обход |
| confirmed Draft остаётся pending | проверить command/outbox/worker/Mock Hub; Work Item пока отсутствует |
| readiness READY, projection pending | проверить exact transition Approval/read-back; assessment не переписывать |
| Session start rejected | показать конкретный target/scope/start-guard code без secret |
| FAIL review rejected | приложить обязательное evidence; waiver не поддерживается |
| Finding blocks review | завершить human classification и disposition до sign-off |
| defect draft exists, link absent | проверить Approval/command/reconciliation; signed manifest не мутировать |
| DoD blocked | показать exact Session/evidence/Finding/draft/Verdict/waiver blocker |
| final close denied | проверить distinct QA Lead, live entitlement, expected external state и subject drift |
| external DONE, projection pending | выполнить read-back/reconciliation; не выставлять local DONE вручную |
| model unavailable | использовать deterministic defect wording; остальные steps неизменны |
| evidence expired | показать `EXPIRED`, metadata/checksum и audit; не возвращать locator |
| cross-project request denied | policy-safe response без counts/existence/downstream call |

Logs и Problem Details могут содержать correlation ID, stable reason code,
resource kind и sanitized version refs. Они не содержат tokens, raw credential,
raw evidence, model prompt, provider locator или чужие scoped identifiers.

## 17. End local session

Обычная остановка сохраняет durable local volumes:

~~~bash
pnpm local:qa:down
~~~

Полная очистка удаляет только containers/volumes Compose project `awp-local` и
требует exact confirmation flag:

~~~bash
pnpm local:qa:reset -- --yes
~~~

Повторный `local:qa:up`, `local:qa:seed` и `smoke:002` должен быть идемпотентным без
reset.

Полный local reset выполняется только при осознанной необходимости:

~~~bash
pnpm local:qa:reset
~~~

Reset обязан показать exact local compose project и target volumes, потребовать
явное подтверждение и удалить только local test state. Он не является частью
обычного acceptance rerun.
