# Feature Specification: Queue, triage, capacity и SLA

**Feature ID:** `006-queue-triage-capacity-sla`  
**Статус:** Draft for `/speckit.plan`  
**Приоритет:** P2  
**Зависимости:** `002`, `003`, `004`; `005` предоставляет automation facts  
**Ценность:** дать единой функциональной QA-команде прозрачное управление запросами нескольких проектов без непрозрачного AI total order.

## 1. Контекст и граница

Один QA Workspace рассчитан на все onboarded projects, но rollout начинается с reference project. Доступ внутри Workspace остаётся project-scoped. Queue использует Jira-owned operational state, platform readiness/WIP/SLA facts и explainable Hermes recommendations.

Jira priority остаётся accepted operational value. Hermes не назначает business priority, а создаёт `TriageAssessment`; QA Lead подтверждает межпроектный порядок и overrides.

## 2. User scenarios и независимые тесты

### US-001 — Раздельные стадии работы (P1)

Как QA Lead, я хочу различать обнаруженный Candidate, подтверждённый Backlog, Ready Queue и Active WIP, чтобы неподтверждённые/неполные запросы не искажали capacity/SLA.

**Acceptance scenarios:**

1. **Given** event создал Candidate, **when** он не подтверждён, **then** Jira issue/SLA/WIP отсутствуют.
2. **Given** confirmed Jira-bound request не прошёл DoR, **when** queue открыта, **then** он виден в Backlog/Needs Info, но не Ready/WIP.
3. **Given** QA человек подтвердил DoR и запросил Jira transition, **when** webhook/read подтверждает фактический Jira status, mapped в `READY`, **then** SLA запускается согласно pinned policy; до подтверждения clock не стартует.
4. **Given** Executor начинает первую обязательную session, **when** Work Item входит Active, **then** расходуется WIP.

### US-002 — Project lanes и portfolio view (P1)

Как QA Lead, я хочу видеть локальный порядок по проектам и общий portfolio view, чтобы сравнение проектов было объяснимым.

**Независимый тест:** пользователь без Project Entitlement не видит lane/count/item другого проекта; QA Lead видит только разрешённый portfolio scope.

### US-003 — Triage recommendation (P1)

Как QA Lead, я хочу получить разложенную оценку риска/усилий/срочности, чтобы принять решение, а не доверять одному AI-score.

**Acceptance scenarios:**

1. **Given** request context, **when** Hermes формирует assessment, **then** каждый factor, confidence и facts доступны отдельно.
2. **Given** business impact отсутствует, **when** assessment выполняется, **then** Hermes не выдумывает impact и помечает missing information.
3. **Given** QA Lead меняет рекомендацию, **when** override подтверждён, **then** reason и before/after сохраняются в audit.

### US-004 — Capacity/WIP и expedite (P1)

Как QA Lead, я хочу hard Workspace WIP и мягкие project limits, чтобы один проект не монополизировал команду.

**Acceptance scenarios:**

1. **Given** Workspace WIP достигнут, **when** обычный request пытаются начать, **then** система блокирует start; продолжение возможно только по exact QA Lead override.
2. **Given** один EXPEDITE уже active, **when** второй помечают EXPEDITE, **then** требуется завершить/снять первый либо exact QA Lead override.

### US-005 — SLA transparency (P2)

Как Requester, я хочу видеть начало, pause reason и breach risk, чтобы ожидания были прозраччны.

## 3. Queue state model

```text
Candidate Inbox
→ Confirmed Backlog
→ Ready Queue
→ Active WIP
→ Completed
```

Operational Jira status и platform queue stage показываются отдельно. Queue stage выводится детерминированно из Candidate/Draft/Jira/DoR/Session facts и не становится конкурирующим Jira workflow.

## 4. Functional requirements

### 4.1. Views и isolation

- **FR-001:** queue query всегда scoped Workspace + entitled projects.
- **FR-002:** project lanes и portfolio view используют один authorization filter, применённый до aggregation.
- **FR-003:** UI показывает Jira key/status, normalized status, queue stage, sync freshness, DoR, SLA и WIP state.
- **FR-004:** stale/error projection явно маркируется.
- **FR-005:** Candidate/Backlog не расходуют Active WIP.

### 4.2. TriageAssessment

- **FR-006:** assessment хранит business impact input, urgency/SLA, risk severity, QA effort range, scope breadth, environment/data complexity, uncertainty, automation availability, confidence и explanation.
- **FR-007:** input fingerprint и rule/skill version определяют freshness; изменение facts делает recommendation stale.
- **FR-008:** recommendation и accepted Jira/workspace values хранятся отдельно.
- **FR-009:** Hermes не изменяет P0/P1, accepted due, assignment или final rank без human command/approval.
- **FR-010:** complexity не сворачивается в единственный непрозрачный scalar для authorization/priority.

### 4.3. Ordering и service classes

- **FR-011:** поддерживаются service classes `EXPEDITE`, `FIXED_DATE`, `STANDARD`.
- **FR-012:** portfolio recommendation учитывает service class, breach risk/due, risk/business impact, age и dependencies; effort используется для planning, не как business priority.
- **FR-013:** project-local order и portfolio recommendation доступны одновременно.
- **FR-014:** cross-project order/override подтверждает QA Lead с reason.
- **FR-015:** Jira priority меняется отдельной exact command’ой и остаётся Jira-owned.

### 4.4. Capacity/WIP

- **FR-016:** Workspace имеет hard WIP limit; project lanes могут иметь soft limit/reservation.
- **FR-017:** одновременно active EXPEDITE по default не более одного.
- **FR-018:** WIP override требует QA Lead approval и audit.
- **FR-019:** availability/capacity отделены от Role и CapabilityClaim.
- **FR-020:** routing использует required capabilities и current capacity, но authorization никогда не выводится из capability.

### 4.5. SLA

- **FR-021:** SLA policy pin’ится на Work Item при подтверждённом Jira status, mapped в `READY`, либо другом явно configured Jira-owned start event.
- **FR-022:** В pilot human DoR confirmation только авторизует/предлагает Jira transition; SLA clock стартует после read/webhook confirmation фактического Jira `READY`, а не от локальной рекомендации или pending command.
- **FR-023:** pause/resume вычисляются детерминированно по mapped status/reason.
- **FR-024:** Hermes может уведомлять о breach risk, но не менять due/priority.
- **FR-025:** calendar/timezone задаются Workspace; фактические targets устанавливаются после baseline.

## 5. Roles и approvals

- QA Executor подтверждает обычный DoR/start/session work в своём scope.
- QA Lead управляет WIP, portfolio order, high-risk review и waivers.
- Requester задаёт business impact/desired date, но не accepted QA priority.
- Workspace Owner управляет policy/config, но не получает project content без entitlement.
- Hermes использует одноразовые project-scoped tool grants.

## 6. Failure и consistency

- Jira outage показывает stale/pending; accepted operational values не заменяются локальными guesses.
- Mattermost outage не меняет queue/SLA и не теряет notification intent.
- Model outage сохраняет deterministic factors/manual triage.
- Concurrent overrides используют expected version; stale decision получает conflict.
- Reconciliation может пересчитать derived queue stage/SLA, сохраняя history/audit.

## 7. Metrics и baseline

- Candidate→confirmed conversion/time;
- request→READY;
- READY→first session и READY→signed verdict;
- waiting by reason/project;
- WIP/queue age/service class;
- SLA warnings/breaches/pauses;
- assessment overrides/stale rate;
- missing-information rate;
- manual system switches (pilot measurement).

## 8. Success criteria

- **SC-001:** Candidate/Backlog/Ready/Active считаются независимо и корректно.
- **SC-002:** SLA/WIP начинаются только на agreed events.
- **SC-003:** project aggregation не раскрывает запрещённые counts/items.
- **SC-004:** нет непрозрачного single AI-score или autonomous Jira priority.
- **SC-005:** каждый Lead override объясним, versioned и audited.
- **SC-006:** EXPEDITE/WIP policy проверяется при concurrent commands.
- **SC-007:** flow продолжает работать без model provider.

## 9. Pilot inputs

- `[PILOT INPUT REQUIRED]` Workspace timezone, working calendar source и owner.
- `[PILOT INPUT REQUIRED]` Baseline window/sample и владельцы flow/SLA metrics.
- `[PILOT INPUT REQUIRED]` (after baseline) Workspace WIP limit, project soft limits/reservations и EXPEDITE capacity.
- `[PILOT INPUT REQUIRED]` (after baseline) SLA targets, warning thresholds и разрешённые pause reasons/status mappings.

## 10. Out of scope

- числовые SLA/WIP targets до baseline;
- autonomous capacity allocation;
- календарь праздников beyond configured import;
- forecasting/optimization solver;
- cross-Workspace handoff;
- изменение business priority агентом.
