# Feature Specification: Jira operational authority

**Feature ID:** `003-jira-operational-authority`  
**Статус:** Реализовано и локально подтверждено — task-bound aggregate gate проходит полностью; live non-prod validation остаётся опциональной со статусом `SKIPPED_GATED` до предоставления C1-пакета. Production writes remain excluded.
**Приоритет:** P1  
**Зависимости:** `001`, `002`  
**Ценность:** подключить центральный QA-процесс к реальной non-prod Jira без создания второго task tracker и без слепых/повторных записей.

Локальная готовность означает проверенную composition `qa-jira-local` с реальным Jira HTTP adapter против stateful Mock Hub, PostgreSQL/Redis, API, worker, web, process-level US1–US4, browser journey и привязанным к текущему runtime evidence. Она не означает, что live corporate non-prod Jira была подключена или что production Jira разрешена.

## 1. Контекст и граница

Jira — единственная реализация capability `operational-work-item` в MVP. Core остаётся vendor-neutral: Work Item связан с Jira через `OperationalAuthorityBinding`, а Jira-specific fields находятся в Connector/Profile слоях.

Для пилота используется один центральный Jira project функциональной QA-команды и issue type `QA Request` (фактические key/name — `[PILOT INPUT REQUIRED]`). QA Request связывается с source development issue/MR. Defects создаются в owning product Jira project через отдельный versioned Defect Profile.

## 2. User scenarios и независимые тесты

### US-001 — Создание центральной QA Request (P1)

Как Requester, я хочу после подтверждения intake получить одну QA Request в центральном Jira project, чтобы Jira владела operational lifecycle.

**Acceptance scenarios:**

1. **Given** confirmed Intake Draft и active Project Binding, **when** create command выполняется, **then** Jira создаёт одну issue и платформа подтверждает её read/webhook.
2. **Given** тот же submit доставлен повторно, **when** worker повторяет command, **then** duplicate issue не создаётся.
3. **Given** Jira недоступна, **when** draft подтверждён, **then** draft сохраняется, command получает pending/error, но Work Item не получает фиктивное Jira-состояние.

### US-002 — Импорт QA Request, созданной напрямую в Jira (P1)

Как пользователь Jira, я хочу создать корректную QA Request напрямую, чтобы Hermes/platform подхватили её без обязательного Mattermost intake.

**Независимый тест:** issue из published JQL scope/issue type импортируется один раз; completeness выполняется после import; посторонняя issue игнорируется без утечки данных.

### US-003 — Синхронизация и конфликты (P1)

Как QA Executor, я хочу видеть фактический Jira status/assignee/priority/due date и безопасно выполнять разрешённые transitions.

**Acceptance scenarios:**

1. **Given** Jira issue изменена человеком, **when** webhook/reconciliation выполняется, **then** projection отражает Jira value и source freshness.
2. **Given** platform command основана на устаревшей version, **when** Jira уже изменена, **then** command становится `CONFLICT`, перечитывает issue и не делает blind overwrite.
3. **Given** webhook duplicate/out-of-order, **when** он обработан, **then** projection не откатывается и side effects не повторяются.

### US-004 — Подтверждённый defect (P1)

Как QA Executor, я хочу опубликовать approved defect draft в owning product project, чтобы сохранить связь с QA Request, session, build и evidence.

**Независимый тест:** отдельный Defect Profile создаёт один defect с разрешёнными полями/link type; повтор approval не создаёт duplicate.

## 3. Source-of-truth matrix

| Данные | Канонический владелец | Platform storage |
|---|---|---|
| QA Request status/assignee/priority/due/workflow | Jira | Projection + freshness |
| Requester после issue creation | Jira + verified canonical principal reference | Identity binding |
| QA Test Sessions/Findings/Verdict | QA Pack | Canonical |
| Source issue/MR links | Jira/GitLab | Binding/reference |
| Jira comments/links | Jira | Reference/index |
| Profile/mappings/policies | Platform | Canonical, versioned |
| Audit/idempotency/approvals | Platform | Canonical |

## 4. Functional requirements

### 4.1. Connection и service identity

- **FR-001:** environment vocabulary различает `LOCAL | NON_PROD | PREPROD | PLATFORM_PROD`; в MVP Jira effect-capable Connections/Profiles разрешены только для `LOCAL | NON_PROD`, а PREPROD/PLATFORM_PROD metadata records, если существуют, остаются disabled и не получают credential/network effect path.
- **FR-002:** credential хранится в Vault/secret manager; database содержит только secret reference.
- **FR-003:** runtime identity не имеет global admin, delete issue, workflow/config management или user management permissions.
- **FR-004:** human initiator сохраняется в audit и canonical requester field; user impersonation/personal PAT запрещены в MVP.
- **FR-005:** Connector поддерживает discovery projects/issue types/fields/statuses/transitions/users/links в разрешённом scope.

### 4.2. Profiles и mappings

- **FR-006:** Central QA Request Profile задаёт target project/issue type, create/import JQL, field/status/priority/identity mappings, comments/links/transitions и reconciliation.
- **FR-007:** Jira Defect Profile задаётся отдельно на project и содержит required fields, duplicate/search policy, link type и write approval policy.
- **FR-008:** Profile проходит discovery, validation, preview и dry run до publish.
- **FR-009:** published Profile immutable; новая конфигурация создаёт version.
- **FR-010:** Work Item pin’ит exact primary Project Binding/Profile refs `{id, version}`, использованные при creation/import; каждая command дополнительно pin’ит immutable ordered primary+auxiliary chain set, необходимый для source/defect links, и effect-time повторно валидирует весь set.
- **FR-011:** mapping expression language ограничен allowlist и не исполняет произвольный code.
- **FR-012:** mapping drift блокирует только затронутый Profile/project feature.

### 4.3. Operational binding

`OperationalAuthorityBinding` хранит:

- `workItemId`, exact Connector Profile ref и Project Integration Binding ref;
- external entity type/id/display key/version;
- raw and normalized status;
- sync state/freshness/last synced time;
- project/source references.

- **FR-013:** у Work Item ровно один active operational authority binding.
- **FR-014:** Jira-owned field меняется только external command’ой и считается изменённым после read/webhook confirmation.
- **FR-015:** UI одновременно показывает Jira key/status и normalized status/sync state.

### 4.4. Intake/create/import

- **FR-016:** confirmation version + target binding входят в create idempotency key.
- **FR-017:** Jira QA Request создаётся отдельно и связывается с source development issue, когда source указан.
- **FR-018:** direct-created issue импортируется только из strict JQL scope и supported issue type.
- **FR-019:** imported issue без DoR запускает completeness и остаётся `NEEDS_INFO`, но не отклоняется silently.
- **FR-020:** повтор create/import/webhook не создаёт duplicate Work Item/binding.

### 4.5. Webhooks и reconciliation

- **FR-021:** raw webhook проходит signature/secret, delivery identity/retry, bounded dedupe/replay horizon и connection scope validation согласно обнаруженным гарантиям dialect; один лишь старый provider timestamp не является причиной отклонить легитимный retry.
- **FR-022:** Inbox unique key использует connection + event ID либо устойчивый payload hash.
- **FR-023:** out-of-order update сравнивается по external version/updated timestamp.
- **FR-024:** scheduled reconciliation восстанавливает projection, выявляет mapping drift и не меняет Jira.
- **FR-025:** polling/JQL cursor и rate budget конфигурируются per Profile.

### 4.6. Commands/conflicts

- **FR-026:** transition/assign/priority/due commands проверяют RBAC, Project Entitlement, policy, current Profile и expected version.
- **FR-027:** Любые Jira transition, assignment/reassignment, priority и due-date writes, а также defect publication требуют exact one-time Approval согласно constitution; high-risk/cross-project effects дополнительно применяют separation-of-duties policy.
- **FR-028:** conflict прекращает write, перечитывает Jira и требует нового explicit decision.
- **FR-029:** Connector error taxonomy минимум различает auth/permission/conflict/rate-limit/transient/validation/not-found.

## 5. Pilot normalized workflow

```text
NEW → NEEDS_INFO → READY → PLANNED → IN_PROGRESS → REVIEW → DONE
                  ↘ BLOCKED
Any non-terminal → CANCELLED (по policy)
```

Фактические Jira status names/IDs задаются Profile. `Verdict` хранится отдельно; `DONE + FAIL` допустим и не означает product acceptance.

## 6. Security и failure scenarios

- JQL/Profile scope — defense in depth, но не замена backend Project Entitlement.
- Connector проверяет внешнюю entity на соответствие pinned project/profile до projection update.
- Webhook другого project/connection отклоняется.
- 401/403 останавливают automatic retries и создают security/integration alert.
- 429/5xx используют bounded backoff; external write остаётся идемпотентным.
- Jira outage не блокирует сохранение Draft/manual platform data, но Work Item не считается operationally accepted без Jira binding.

## 7. Observability

Обязательные metrics/log fields:

- connection/profile/project/correlation IDs;
- request latency и result category;
- webhook/reconciliation lag;
- duplicate/out-of-order count;
- mapping/conflict/auth/rate-limit errors;
- command retry и final confirmation;
- projection freshness.

## 8. Success criteria

- **SC-001:** create/import создают один Work Item и binding.
- **SC-002:** webhook duplicate/out-of-order не создаёт duplicate/rollback.
- **SC-003:** stale write приводит к visible conflict.
- **SC-004:** direct Jira change отражается в projection в целевом freshness window.
- **SC-005:** defect publication создаёт один linked defect в разрешённом project.
- **SC-006:** service identity least-privilege подтверждена test evidence.
- **SC-007:** audit восстанавливает human → command → Jira call → confirmed result.

## 9. Pilot inputs

These values are deployment inputs carried by immutable `JiraPilotMetadataPackage@1`, not unresolved design choices. Their absence keeps live non-prod validation in `SKIPPED_GATED`; deterministic local fixtures remain usable.

- `[PILOT INPUT REQUIRED]` Jira edition/base URL/auth strategy.
- `[PILOT INPUT REQUIRED]` Central QA project key и QA Request issue type.
- `[PILOT INPUT REQUIRED]` Source project/JQL/read scopes.
- `[PILOT INPUT REQUIRED]` Field/status/priority/identity mappings.
- `[PILOT INPUT REQUIRED]` Defect project/profile/link type.
- `[PILOT INPUT REQUIRED]` Webhook guarantees и reconciliation rate budget.
- `[PILOT INPUT REQUIRED]` Service identity owner/rotation path.

## 10. Out of scope

- изменение Jira workflow/field configuration из платформы;
- delete issues;
- production writes;
- arbitrary tracker support;
- delegated user impersonation;
- autonomous priority/release decisions.
