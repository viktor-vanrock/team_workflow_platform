# Feature Specification: GitLab automated validation

**Feature ID:** `005-gitlab-automated-validation`  
**Статус:** Draft for `/speckit.plan`  
**Приоритет:** P1  
**Зависимости:** `001`, `002`, `003`; `004` требуется только для Mattermost commands/notifications  
**Ценность:** добавить воспроизводимые automated Test Sessions через allowlisted GitLab CI без автоматического QA/release verdict.

## 1. Контекст и граница

GitLab Connector реализует capabilities:

- `source-context.read`;
- `test-executor.trigger-status`;
- `artifact.ci-read`;
- webhook/reconciliation для pipeline/job events.

Проект с validated GitLab profile/suite bindings получает capability level `FULL_QA`. Manual flow остаётся доступным при GitLab outage или для `MANUAL_ONLY` проекта.

## 2. User scenarios и независимые тесты

### US-001 — Создание automated session (P1)

Как QA Executor, я хочу выбрать зарегистрированные suite, build и non-prod environment, чтобы создать воспроизводимую automated Test Session.

**Acceptance scenarios:**

1. **Given** project имеет active `FULL_QA` binding, **when** QA подтверждает session plan, **then** создаётся `AUTOMATED` session с immutable Target/Scope snapshots.
2. **Given** suite/environment не allowlisted, **when** session запускается, **then** command отклоняется до GitLab invocation.
3. **Given** project `MANUAL_ONLY`, **when** пользователь выбирает automation, **then** UI/API объясняет unavailable capability без блокировки manual flow.

### US-002 — Идемпотентный pipeline trigger (P1)

Как QA Executor, я хочу явной командой запустить тесты ровно один раз, чтобы retry UI/worker не создавал лишние pipelines.

**Независимый тест:** повтор command с тем же `testSessionId + requestKey` возвращает существующий pipeline/attempt.

### US-003 — Технический result и human review (P1)

Как QA Executor, я хочу получить normalized result и artifacts, чтобы человек определил session outcome/verdict.

**Acceptance scenarios:**

1. **Given** pipeline вернул assertion failure, **when** result sync завершён, **then** attempt=`ASSERTION_FAILED`, session=`REVIEW_REQUIRED`, автоматический retry отсутствует.
2. **Given** allowlisted infrastructure error, **when** retry policy применяется, **then** создаётся второй immutable attempt в той же session.
3. **Given** второй attempt прошёл после предыдущего assertion failure/rerun, **when** QA review выполняется, **then** результат помечается `FLAKY_SUSPECTED`, а не чистым PASS.
4. **Given** pipeline PASS, **when** webhook получен, **then** QA verdict автоматически не подписывается.

### US-004 — GitLab outage и восстановление (P1)

Как QA Lead, я хочу видеть pending/error automated sessions и продолжать manual работу, чтобы GitLab outage не останавливал Workspace.

## 3. Normalized pipeline contract

### 3.1. Input

Profile адаптирует project-specific pipeline к logical input:

```text
workspaceId
projectId
workItemId
testSessionId
requestKey/idempotencyKey
sourceIssueKey
mergeRequest/build/commit
environmentId
suiteKey
browser? / allowed parameters
triggerActor/reference
```

Передаются только allowlisted variable names/values. Arbitrary variables, shell fragments, job names и raw secrets запрещены.

### 3.2. Technical outcome

```text
PASS
ASSERTION_FAILED
INFRA_FAILED
TIMEOUT
CANCELLED
INCOMPLETE
```

Machine-readable result содержит schema version, pipeline/job IDs, commit/build, suite, environment, duration, outcome, infrastructure code и artifact references.

### 3.3. AutomationAttempt

Каждый attempt хранит:

- number/idempotency key;
- pinned Connector Profile/Suite Binding versions;
- external pipeline/job IDs;
- technical state/outcome/error code;
- artifact references/checksums;
- timestamps;
- actor/correlation IDs.

Attempt immutable. Retry создаёт новую запись и сохраняет lineage.

## 4. Functional requirements

### 4.1. GitLab Connection/Profile

- **FR-001:** Connection использует non-human service/project identity и Vault secret reference.
- **FR-002:** pilot scopes ограничены чтением project/MR/commit/pipeline/artifacts и trigger конкретного test pipeline.
- **FR-003:** push, CI config edit, protected branch change, CI secret read и deploy/production jobs запрещены.
- **FR-004:** Profile pin’ит numeric GitLab project, allowed refs/suites/environments/variables, result schema и artifact policy.
- **FR-005:** Profile validation выполняет discovery/dry run и подтверждает отсутствие production/deploy target.

### 4.2. Suite bindings и target

- **FR-006:** suite binding имеет owner, version, project, pipeline/ref/job contract, allowed target types и verification status.
- **FR-007:** session pin’ит exact suite binding ref/hash, Project Integration Binding ref и фактически использованные Profile refs `{id, version}`.
- **FR-008:** TargetSnapshot содержит build/commit/MR, environment revision, test-data/account lease refs.
- **FR-009:** изменение target после start создаёт новую linked session.

### 4.3. Trigger/status/artifacts

- **FR-010:** trigger проходит RBAC, Project Entitlement, tool grant, allowlists, exact command confirmation и idempotency.
- **FR-011:** explicit authorized user launch allowlisted non-prod smoke не требует второго approval.
- **FR-012:** large regression/event-driven autonomous launch требует QA Lead approval и находится вне first enablement.
- **FR-013:** pipeline/job webhooks проходят signature/replay/scope/dedupe checks.
- **FR-014:** polling/reconciliation восстанавливает status при потерянном webhook.
- **FR-015:** artifact metadata содержит provenance/checksum/classification/retention; raw content не отправляется модели автоматически.

### 4.4. Retry/flaky

- **FR-016:** только allowlisted deterministic infrastructure code допускает один automatic retry.
- **FR-017:** assertion failure, unknown failure и policy error автоматически не ретраятся.
- **FR-018:** original attempt никогда не перезаписывается.
- **FR-019:** fail→pass lineage получает отдельный flag `FLAKY_SUSPECTED` до human disposition; flag не является Attempt Result, Session Outcome или QA Verdict.
- **FR-020:** quarantine требует owner/reason/expiry и не скрывает исходные failures.

### 4.5. Human review

- **FR-021:** terminal pipeline переводит session в `REVIEW_REQUIRED`.
- **FR-022:** Hermes может подготовить result review packet и Finding drafts.
- **FR-023:** QA Executor проверяет canonical Attempt Results, классифицирует возникшие Findings общей taxonomy `PRODUCT|INFRA|INCONCLUSIVE|DUPLICATE|ACCEPTED_RISK`, отдельно разрешает flag `FLAKY_SUSPECTED` и подписывает Session Outcome; отдельный неформализованный automation classification enum не создаётся.
- **FR-024:** high/critical/waiver следует risk-based reviewer policy.
- **FR-025:** TestSession completion не закрывает Jira Work Item автоматически.

## 5. Security и degradation

- Product production targets блокируются service identity, GitLab policy, network policy и platform allowlist одновременно.
- GitLab Profile/Project Binding — defense in depth; backend authorization проверяется до adapter call.
- Artifact access следует Project Entitlement/classification, даже если raw GitLab URL технически существует.
- GitLab outage переводит automated session в pending/error; manual sessions и Jira workflow продолжаются.
- 401/403 останавливают retry; 429/5xx используют bounded backoff.
- Unknown result schema переводит attempt в `INCOMPLETE`/manual review, не PASS.

## 6. Observability

Metrics:

- triggers/results по project/suite/outcome;
- duplicate prevention;
- queue/wait/run duration;
- infra retry и flaky suspected rates;
- webhook/reconciliation lag;
- artifact publication/access errors;
- policy denials и forbidden production attempts.

## 7. Success criteria

- **SC-001:** allowlisted pipeline запускается ровно один раз.
- **SC-002:** result/artifacts связываются с правильными Work Item/Session/Attempt.
- **SC-003:** один infra retry создаёт второй attempt; assertion failure не ретраится.
- **SC-004:** PASS не становится QA verdict без человека.
- **SC-005:** GitLab outage не блокирует manual flow.
- **SC-006:** cross-project webhook/artifact/trigger отклоняется.
- **SC-007:** production/deploy pipeline невозможно запустить через pilot identity/profile.

## 8. Pilot inputs

- `[PILOT INPUT REQUIRED]` GitLab base URL/auth/project ID.
- `[PILOT INPUT REQUIRED]` Pilot MR/source context contract.
- `[PILOT INPUT REQUIRED]` Runner/network/container readiness.
- `[PILOT INPUT REQUIRED]` Pipeline trigger endpoint/ref.
- `[PILOT INPUT REQUIRED]` Suite/environment/variable allowlists.
- `[PILOT INPUT REQUIRED]` Versioned machine-readable result schema.
- `[PILOT INPUT REQUIRED]` Artifact types/retention/access.
- `[PILOT INPUT REQUIRED]` Infra error codes и cancellation semantics.

## 9. Out of scope

- генерация/изменение тестового кода;
- CI configuration edits;
- autonomous event-driven regression;
- production/deployment jobs;
- automatic QA/release verdict;
- long-term S3 copy, если GitLab retention достаточен.
