# Feature Specification: Mattermost и Hermes intake

**Feature ID:** `004-mattermost-hermes-intake`

**Статус:** Planned — governance gate satisfied by Accepted ADR-0008 and Constitution 2.0.0

**Приоритет:** P1

**Зависимости:** `001`, `002`, `003`

**Ценность:** сделать Hermes в Mattermost предпочтительной единой точкой входа и уведомления, не превращая чат или LLM в source of truth.

## 1. Контекст и граница

Mattermost обязателен в пилотном integration contour, но feature-scoped и асинхронен. Он создаёт/изменяет только platform-owned Draft/Candidate через backend API. Jira остаётся operational authority, а web UI — fallback для intake, approvals и QA execution.

Hermes — одна логическая persona/coordinator. Целевой subject каждого run — закрытая ветвь `draftId | candidateId | workItemId`, всегда изолированная по `workspaceId + projectId`, с минимальными tool grants и без свободной долговременной памяти между проектами. Этот union принят ADR-0008 и закреплён Конституцией 2.0.0; ADR-0005 Decision 1 частично заменён только в части subject.

## 2. User scenarios и независимые тесты

### US-001 — Guided intake через личный диалог (P1)

Как Requester, я хочу запустить `/awp create`, пройти OIDC-выбор проекта и затем продолжить в web/личном диалоге с Hermes, чтобы пошагово создать полную QA-заявку.

**Acceptance scenarios:**

1. **Given** пользователь открыл статическую ссылку из `/awp create` и прошёл canonical OIDC login, **when** он запускает intake, **then** web-контур показывает только проекты, для которых сейчас разрешён `qa.request.create`, и создаёт отдельный project-scoped selection intent для каждого варианта.
2. **Given** draft неполон, **when** readiness skill выполняется, **then** Hermes задаёт вопросы только по отсутствующим/невалидным полям.
3. **Given** Hermes показывает immutable summary, **when** пользователь подтверждает draft version, **then** backend создаёт ровно одну Jira QA Request.
4. **Given** пользователь повторяет callback/confirmation, **when** idempotency key совпадает, **then** duplicate issue не создаётся.

### US-002 — Candidate notification (P1)

Как QA Lead/Requester, я хочу получить предложение создать QA Request при разрешённом Jira/GitLab trigger, чтобы Hermes обнаруживал потенциальную работу без автоматического засорения backlog.

**Независимый тест:** trigger создаёт `IntakeCandidate`, а не Jira issue; пользователь может `Создать`, `Отложить` или `Игнорировать`.

### US-003 — Completeness и triage proposal (P1)

Как QA Lead, я хочу получить explainable assessment сложности, риска и рекомендуемой очереди, чтобы быстрее принять человеческое решение.

**Acceptance scenarios:**

1. **Given** доступный Jira/MR context, **when** Hermes оценивает request, **then** сохраняется structured `TriageAssessment` с facts/confidence/rule+skill version.
2. **Given** source input изменён, **when** assessment читается, **then** stale recommendation помечается и не применяется автоматически.
3. **Given** модель недоступна/возвращает invalid JSON, **when** intake продолжается, **then** deterministic forms/rules остаются доступны.

### US-004 — Уведомления и деградация (P1)

Как участник QA-процесса, я хочу получать минимальные project-scoped уведомления, но продолжать работу при сбое Mattermost.

**Независимый тест:** notification сохраняется в outbox; Mattermost outage не откатывает Jira/QA state и сообщение доставляется после восстановления либо становится диагностируемой ошибкой.

## 3. Canonical intake flow

1. Explicit `/awp create` получает статический text-only ответ с одной first-party OIDC ссылкой; bootstrap не доверяет Mattermost actor/scope, не имеет Connection/credential и не создаёт durable state.
2. После canonical OIDC login web backend вычисляет полный текущий `qa.request.create` scope и выдаёт отдельные project-scoped `WEB PROJECT_SELECT` intents; project-scoped Mattermost callbacks отдельно проверяют объявленные authentication/replay правила.
3. Для manual intake пользователь выбирает только server-issued intent из полностью авторизованного scope; для discovery backend определяет Project из authoritative source binding/read.
4. Только после точного Project scope manual flow создаёт versioned Draft, а discovery flow — Candidate.
5. Deterministic validation и read-only enrichment получают Jira/GitLab context.
6. До acceptance Hermes предлагает missing fields и triage; SessionPlanProposal создаётся только для уже принятого Work Item.
7. Confirmation показывает project, Jira target, source refs, environment, classification и requester.
8. Backend повторно проверяет entitlement и exact binding/profile refs с fingerprints и создаёт idempotent Jira command.
9. После Jira confirmation Hermes отправляет key/link/status.

Произвольная история каналов не сканируется и не сохраняется в prompt. Полное чувствительное описание вводится в bot DM/web; project channel получает только policy-approved summary.

## 4. Functional requirements

### 4.1. Mattermost Connector/Profile

- **FR-001:** Connector предоставляет typed capabilities `messaging.intake`, `messaging.notify` и optional `messaging.callback`.
- **FR-002:** каждый Mattermost Connection/callback credential использует отдельную non-human bot/gateway identity/secret per Project и environment; публичный `/awp create` bootstrap не имеет Connection, credential или durable state.
- **FR-003:** каждый Mattermost Profile принадлежит ровно одному `workspaceId + projectId` и хранит exact team/channel IDs, callback-contract refs, templates, classification и notification policy; внешний bot/credential не переиспользуется между Project Scope.
- **FR-004:** bot не может публиковать в channel вне active project binding.
- **FR-005:** raw token/secret не доступен Hermes/Pack, API/Broker caller, durable command, log или audit; для воспроизводимости до первого durable invocation marker допускаются только project-scoped AEAD-sealed capsules с immutable key/codec/AAD commitments и bounded purge/backup retention.

### 4.2. Identity и callbacks

- **FR-006:** Mattermost user связывается с canonical OIDC principal проверенным External User Binding.
- **FR-007:** email/username similarity не создаёт binding автоматически.
- **FR-008:** статический bootstrap не выполняет authority-sensitive действие; OIDC project selection и каждый project-scoped callback заново проверяют binding, current membership, Project Entitlement, role и classification, а callback также проверяет объявленную для точного Connection схему authentication/replay.
- **FR-009:** callback является single-use и pin’ит draft/action version; одна action presentation содержит bounded ordered set отдельных intents/tokens, отличает source interaction route от новых actions, а после durable `effectInvocationStartedAt` допускает только reconciliation, не blind resend.
- **FR-010:** final approvals/high-risk verdict остаются в web UI в MVP.

### 4.3. Candidate triggers

- **FR-011:** pilot поддерживает manual `/awp create` → OIDC flow и configured Jira `Ready for QA` transition/label trigger.
- **FR-012:** GitLab MR label trigger включается после feature 005 и создаёт тот же Candidate contract.
- **FR-013:** candidate не создаёт Jira issue, SLA или WIP.
- **FR-014:** candidate decision `CREATE|SNOOZE|IGNORE` фиксируется с actor/reason/time.
- **FR-015:** automatic Candidate deduplication использует стабильную identity `workspace + project + source authority + source entity + trigger key/version`; source entity version/fingerprint не входит в identity и добавляет новое наблюдение к тому же Candidate.

### 4.4. Hermes coordinator

- **FR-016:** v1 skills покрывают intake assistance, отдельные Draft intake-readiness и Work Item readiness, отдельные triage и session-plan proposals, notification, result review preparation, defect draft и DoD check; один Agent Run имеет ровно один versioned output schema.
- **FR-017:** Hermes формирует schema-validated actions, а Tool Gateway решает исполнение.
- **FR-018:** Hermes не меняет accepted priority/due/assignee, не подписывает verdict и не принимает release decision.
- **FR-019:** TriageAssessment разделяет business impact, urgency/SLA, risk, effort range, scope breadth, environment/data complexity, uncertainty и automation availability.
- **FR-020:** recommendation содержит explanation, confidence, input fingerprint и expires/stale state.
- **FR-021:** никакой общий agent memory не предоставляет cross-project data.

### 4.5. Notification/outage

- **FR-022:** Mattermost send выполняется через outbox и не является частью transaction Jira/QA state.
- **FR-023:** при outage web/Jira/manual QA flow продолжается.
- **FR-024:** notification payload проходит template/classification/redaction policy.
- **FR-025:** retry bounded/idempotent; один NotificationIntent создаёт ровно один `notify` или `callback.present` command, ambiguous write после invocation marker не повторяется, permanent failure виден в integration health.

## 5. Security и prompt boundaries

- External Jira/MR/chat content считается untrusted.
- Prompt injection не расширяет tool grants и не изменяет system/policy context.
- Model provider получает только разрешённую classification и минимальный context.
- Attachments не передаются модели до scan/classification/redaction.
- Secrets/cookies/tokens исключаются до prompt construction.
- Structured output проверяется JSON Schema и business policy.

## 6. Deterministic fallback

При недоступной модели остаются:

- `/awp create` как статическая OIDC-ссылка и deterministic web form; после Project selection разрешён project-scoped DM/dialog;
- required field validation;
- project/profile selection;
- Jira create/status/read;
- explicit allowlisted commands;
- notifications templates;
- web fallback.

## 7. Skill evaluations

Обязательные deterministic scenarios:

- valid/invalid/partial intake;
- stale Jira/MR context;
- prompt injection в description/comment;
- invalid JSON/tool request;
- low confidence/contradictory evidence;
- timeout/rate limit/unavailable model;
- attempt выбрать чужой project/profile;
- повтор callback/confirmation.

Eval gate проверяет correctness structured output и отсутствие forbidden action, а не литературное качество текста.

## 8. Success criteria

- **SC-001:** guided Mattermost intake создаёт одну Jira QA Request.
- **SC-002:** пользователь видит только entitled projects.
- **SC-003:** candidate никогда автоматически не становится operational work.
- **SC-004:** model outage не блокирует intake/manual flow.
- **SC-005:** Mattermost outage не изменяет Jira/QA state и не теряет notification intent.
- **SC-006:** 100% Hermes actions/runs имеют skill/input/policy versions и audit.
- **SC-007:** prompt-injection evals не приводят к tool permission escalation.

## 9. Pilot inputs

- `[PILOT INPUT REQUIRED]` Mattermost base URL/team/bot/channel IDs.
- `[PILOT INPUT REQUIRED]` Corporate OIDC↔Mattermost binding source.
- `[PILOT INPUT REQUIRED]` Fixed first-party OIDC bootstrap continuation и доказательство его статичности.
- `[PILOT INPUT REQUIRED]` Project-scoped callback authentication mechanism или явное `DISABLED`.
- `[PILOT INPUT REQUIRED]` Distinct project/environment presentation-token key version с purpose/fingerprint/decrypt horizon, если callbacks включены.
- `[PILOT INPUT REQUIRED]` Immutable capsule-retention policy/evidence с max lifetime, sweep/purge SLA, WAL/backup bounds и key-disable SLA.
- `[PILOT INPUT REQUIRED]` Allowed intake and notification channels.
- `[PILOT INPUT REQUIRED]` Notification classification/templates.
- `[PILOT INPUT REQUIRED]` Model provider decision for non-prod, если включается.

## 10. Out of scope

- чтение произвольной истории каналов;
- Mattermost как source of truth;
- final QA verdict/critical approvals в Mattermost;
- autonomous Jira priority/change/release decisions;
- production actions;
- shared free-form cross-project memory.
