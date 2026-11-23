# ADR-0004: Один функциональный Workspace и Project Entitlement

**Статус:** Accepted  
**Дата:** 2026-08-27

## Контекст

Одна функциональная QA-команда должна обслуживать несколько проектов из общего Workspace. Один Workspace на проект раздробил бы очередь и управление командой, но flat membership раскрыл бы каждому участнику все Jira issues, repositories, environments и artifacts. Workspace boundary сама по себе не выражает project-specific доступ.

## Решение

1. Существует один функциональный QA Workspace как внешняя hard security boundary. Reference pilot подключает один проект; остальные проекты подключаются последовательно через project onboarding.
2. Внутри Workspace каждый проект имеет `Project Scope`. Доступ к ресурсу вычисляется как `Workspace membership ∩ Project Entitlement ∩ Role permission ∩ Data Classification`; отсутствие любого элемента означает deny.
3. Project Entitlement является явным grant, а не UI filter. Work Item, Session, Plan Item, Attempt, Finding, Evidence, Artifact Reference, Agent Run, Approval, async job и integration command содержат `workspaceId` и `projectId`.
4. Минимальные человеческие роли: `Workspace Owner`, `QA Lead`, `QA Executor`, `Requester`, `Project Viewer`, `Auditor`. Integration Administrator не получает content access автоматически. Hermes является service principal с derived tool grants, а не участником человеческой RBAC-иерархии.
5. Requester может создать/подтвердить запрос, отвечать на уточнения и видеть свой запрос в пределах policy, но не получает project queue, environment или artifact access только из-за авторства.
6. QA Executor может подписать обычный Verdict в разрешённом Project Scope. QA Lead подтверждает DoR/evidence policy waiver и межпроектный queue override. Auditor имеет read-only доступ к явно разрешённому scope.
7. Cross-project link и Jira visibility не передают entitlement. Artifact download повторно проверяет Project Entitlement и provider-side access; short-lived URL не является самостоятельным правом.
8. Все async consumers и scheduled jobs восстанавливают scope из durable payload и повторно авторизуются перед read/write. Frontend hiding не считается security control.

## Последствия

- Команда получает единый Workspace и portfolio view без flat cross-project disclosure.
- Любая domain/integration таблица и событие должны сохранять project scope.
- Onboarding и offboarding проекта/пользователя требуют явных entitlement operations и audit.
- Возможна дополнительная сложность query filtering и тестовых fixtures, но она появляется до подключения конфиденциальных проектов.
- Shared Jira/GitLab service identity допустима только если её внешний scope не шире утверждённого Project Integration Binding; logical filtering не компенсирует избыточный credential scope.

## Отклонённые альтернативы

- **Workspace на каждый проект:** ломает модель единой функциональной команды и межпроектное планирование.
- **Flat access всем Workspace members:** делает hard boundary фиктивной для проектов.
- **Только JQL/UI filters:** не защищают repository queries, artifacts, jobs и Connector calls.
- **Entitlement из Jira visibility:** Jira permission не покрывает GitLab, storage, environment и platform-owned evidence.
- **Глобальный admin автоматически читает всё:** нарушает separation of duties.

## Проверки соответствия

- E2E с двумя синтетическими Project Scope доказывает deny для Work Item, Session, Evidence, Artifact и Agent Run чужого проекта.
- Изменённый `projectId` в URL/body не обходит repository authorization.
- Cross-project Jira link не предоставляет доступ к target resource.
- Background job с отсутствующим либо отозванным entitlement завершается policy denial без внешнего effect.
- Requester видит собственный разрешённый запрос, но не project queue и закрытые artifacts.
- Hermes Run не может использовать Connector Profile другого Project Scope.
- Каждый entitlement grant/revoke и policy denial фиксируется в audit.

## Связанные документы

- [Конституция платформы](../../.specify/memory/constitution.md)
- [Master specification v2](../agentic-workspace-platform-master-spec-v2.md)
- [Feature 007: Project onboarding, evidence and security](../../specs/007-project-onboarding-evidence-security/spec.md)
