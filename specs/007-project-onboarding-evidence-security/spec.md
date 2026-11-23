# Feature Specification: Project Onboarding, Evidence & Security

**Feature ID:** `007-project-onboarding-evidence-security`  
**Статус:** Draft for `/speckit.plan`  
**Приоритет:** P1  
**Зависимости:** `001`–`006`  
**Основные пользователи:** Integration Administrator, Workspace Owner, QA Lead, QA Executor, Auditor

## Purpose

Подключить корпоративный проект к центральному QA Workspace безопасным и воспроизводимым способом. Feature использует минимальный `ProjectIntegrationBinding` contract из 001 и добавляет управляемый onboarding, validation/publish/retire lifecycle, каталог проектов, права доступа, окружения и тестовые данные, а также неизменяемую цепочку доказательств.

## Scope

Входит в первую итерацию:

- регистрация проекта и выдача `ProjectEntitlement`;
- capability mode `MANUAL_ONLY` или `FULL_QA` и независимый operational state `ACTIVE` или `SUSPENDED`;
- версионируемый `ProjectIntegrationBinding`;
- каталог окружений без хранения секретов;
- ссылки на наборы тестовых данных и аренду тестовых учётных записей;
- подпись, целостность, сроки хранения и ревизии evidence;
- аварийная приостановка проекта и отзыв доступа;
- аудит административных изменений.

Не входит: создание продуктовых проектов, управление корпоративным IAM, хранение секретов, полноценный CMDB и управление релизами.

`qaCapabilityMode` описывает доступную функциональность и равен `MANUAL_ONLY|FULL_QA`. `projectOperationalState` описывает разрешение выполнять новые действия и равен `ACTIVE|SUSPENDED`. При suspension сохраняется предыдущий capability mode; resume восстанавливает его только после повторной проверки capabilities, иначе mode безопасно пересчитывается.

## User Scenarios & Testing

### Scenario 1 — Onboard a manual-only project (P1)

Администратор регистрирует продуктовый проект, связывает его с центральным Jira QA Request Profile и отдельными source/defect profiles продуктового Jira-проекта, назначает разрешённые окружения и владельцев. GitLab-проект пока не подключён, поэтому система активирует `MANUAL_ONLY`.

**Independent test**: пройти onboarding без GitLab и создать ручную QA Session; попытка автоматической сессии должна быть отклонена с понятной причиной.

**Acceptance scenarios**:

1. При валидной Jira-привязке и отсутствии GitLab-привязки проект получает `MANUAL_ONLY`.
2. Ручная сессия разрешена, автоматическая — запрещена до активации подтверждённого suite binding.
3. Каждый административный шаг имеет actor, timestamp, before/after и correlation ID в аудите.

### Scenario 2 — Promote a project to full QA (P1)

Администратор добавляет GitLab binding и подтверждает доступный pipeline contract и тестовый набор. После успешной проверки соединения проект получает `FULL_QA`.

**Independent test**: подключить тестовый GitLab endpoint, пройти conformance check и запустить одну автоматическую сессию.

**Acceptance scenarios**:

1. Режим меняется только после успешной валидации обязательных capabilities.
2. Новая сессия фиксирует точную опубликованную версию binding.
3. Старые сессии сохраняют ссылку на прежнюю версию и остаются воспроизводимыми.

### Scenario 3 — Enforce project-scoped access (P1)

Пользователь состоит в QA Workspace, но имеет entitlement только к части проектов. Он видит и изменяет данные лишь разрешённых проектов с учётом роли и классификации данных.

**Independent test**: проверить матрицу двух пользователей, двух проектов, двух ролей и двух уровней классификации.

**Acceptance scenarios**:

1. Доступ предоставляется только при одновременном выполнении `WorkspaceMembership AND ProjectEntitlement AND RolePermission AND DataClassification`.
2. Поиск, очередь, прямой URL, API и экспорт применяют одну и ту же политику.
3. Отказ не раскрывает существование или содержимое чужого объекта сверх безопасного сообщения.

### Scenario 4 — Preserve immutable evidence (P1)

QA Executor завершает сессию. Evidence package подписывается и получает checksum. Исправление описания создаёт новую ревизию, а не изменяет исходный объект.

**Independent test**: попытаться изменить завершённый evidence object, затем создать корректирующую ревизию и проверить обе цепочки.

**Acceptance scenarios**:

1. Содержимое завершённой ревизии неизменяемо.
2. Новая ревизия явно ссылается на предыдущую и объясняет причину коррекции.
3. После истечения хранения бинарного артефакта остаются metadata, checksum, происхождение и факт истечения.

### Scenario 5 — Suspend a compromised project binding (P1)

Администратор переводит проект в `SUSPENDED` из-за компрометации интеграции. Новые внешние действия блокируются; существующие данные и аудит доступны уполномоченным пользователям.

**Independent test**: приостановить проект с активной заявкой и убедиться, что новые записи наружу запрещены, а чтение и расследование сохранены.

**Acceptance scenarios**:

1. Integration Administrator может немедленно выполнить explicit emergency suspend; действие аудируется и уведомляет Workspace Owner/QA Lead.
2. Resume не выполняется по команде инициатора suspension: нужны успешные probes, закрытая/принятая incident disposition и exact approval Workspace Owner.

## Onboarding Gate

Проект может перейти в рабочий режим только после фиксации:

1. стабильного `projectId`, владельца и уровня классификации;
2. Jira logical roles: центрального `QA_REQUEST_AUTHORITY`, project-specific `SOURCE_CONTEXT` и `DEFECT_DESTINATION`, включая разрешённые projects, issue types, fields и links;
3. Mattermost channel/team binding для pilot profile; web UI остаётся fallback при временной недоступности Mattermost, но не заменяет обязательный pilot connector type;
4. перечня окружений и их владельцев;
5. ссылок на правила тестовых данных и механизм аренды тестовых аккаунтов;
6. ProjectEntitlement для стартовой группы;
7. capability probe для каждого включённого connector binding;
8. политики хранения evidence и места хранения артефактов;
9. ответственных за эксплуатацию, безопасность и эскалацию;
10. успешного smoke/conformance test.

## Domain Contract

```text
ProjectIntegrationBinding
  bindingId
  workspaceId
  projectId
  version
  state: DRAFT | VALIDATED | PUBLISHED | RETIRED
  dataClassificationKey
  entries[]:
    capabilityKey
    exactContractVersion
    logicalRole
    environmentScope
    classificationCeilingKey
    profileRef { id, version }
    externalScope { schemaRef, value }
  configurationRefs[] (schema-bound)
  resourceRefs[] (schema-bound)
  schemaVersion
  contentHash
  resourceVersion
  validationReportId? (forbidden in DRAFT; exact successful report in later states; excluded from contentHash)
  createdAt, validatedAt?, publishedAt?, retiredAt?
```

QA environment/suite/test-data/evidence semantics живут в QA Pack Project Context и связываются через generic schema-bound refs, а не становятся Core columns. Credentials и токены не входят в binding: exact Profile pin’ит exact Connection с opaque secret reference. Ротация значения за неизменным secret ref не создаёт новую configuration revision; изменение самого secret ref требует новой Connection и транзитивной Profile/Binding revision.

## Functional Requirements

### Project Registry & Entitlements

- **FR-007-001**: Система MUST иметь стабильный внутренний `projectId`, не зависящий от ключей Jira/GitLab/MM.
- **FR-007-002**: Один QA Workspace MAY обслуживать много продуктовых проектов через отдельные entitlements.
- **FR-007-003**: Авторизация MUST вычисляться как пересечение membership, entitlement, role permission и data classification.
- **FR-007-004**: Изменения entitlement MUST быть атомарными, аудируемыми и отзываться без миграции бизнес-данных.
- **FR-007-005**: Политика доступа MUST одинаково применяться к UI, API, поиску, очередям, событиям и экспортам.

### Versioned Bindings

- **FR-007-006**: Project binding MUST быть версионируемым и иметь не более одной текущей `PUBLISHED` версии на проект.
- **FR-007-006A**: Binding MUST поддерживать несколько profiles одного Connector Type через разные `logicalRole`, в частности центральный `QA_REQUEST_AUTHORITY` и project-specific `DEFECT_DESTINATION`.
- **FR-007-006B**: Переход из DRAFT MUST атомарно pin’ить exact successful immutable Validation Report с matching Workspace/Project, subject version и content hash; failed report оставляет DRAFT без `validationReportId`, а provenance ref не входит в semantic content hash.
- **FR-007-007**: Work Item и Test Session MUST фиксировать версию binding, использованную при создании/запуске.
- **FR-007-008**: Изменение endpoint, mapping, pipeline contract или capability set MUST создавать новую версию.
- **FR-007-009**: Ротация credentials MUST выполняться через secret reference без переписывания исторических версий.
- **FR-007-010**: Публикация или retirement версии MUST требовать conformance check, QA Lead functional acceptance, optimistic version check и exact one-time approval Workspace Owner, отличного от инициатора Integration Administrator.
- **FR-007-011**: Откат MUST означать публикацию новой версии, эквивалентной выбранной старой конфигурации; историю изменять нельзя.

### Environments, Test Data & Accounts

- **FR-007-012**: Окружение MUST иметь стабильный ID, тип, владельца, классификацию, статус и ревизию конфигурации.
- **FR-007-013**: `TargetSnapshot` MUST хранить environment ID и revision, но не секретные параметры подключения.
- **FR-007-014**: Тестовые данные MUST указываться непрозрачной ссылкой на версию набора или процедуру подготовки.
- **FR-007-015**: Тестовые аккаунты MUST выдаваться как ограниченная по времени аренда с владельцем, областью и audit trail.
- **FR-007-016**: Логи и evidence MUST проходить редактирование/маскирование по политике до публикации пользователю.

### Evidence Integrity

- **FR-007-017**: Каждая завершённая сессия MUST сформировать подписанный evidence manifest.
- **FR-007-018**: Session manifest MUST включать Project/Work Item/Session/Plan Item/Attempt IDs, actor/runner и timestamps, полный TargetSnapshot, definition/rules versions, expected/actual outcome, canonical result, `sessionOutcome`, artifact references/checksums и provenance; итоговый QA evidence package MUST отдельно ссылаться на human-signed `qaVerdict` уровня Work Item.
- **FR-007-019**: Завершённая ревизия evidence MUST быть immutable.
- **FR-007-020**: Исправление MUST создавать новую ревизию с ссылкой на предшественника, причиной, автором и временем.
- **FR-007-021**: Удаление/истечение бинарного артефакта MUST сохранять metadata, checksum, retention decision и статус доступности.
- **FR-007-022**: Система MUST проверять подпись и checksum при чтении или экспорте evidence.
- **FR-007-023**: Evidence MUST наследовать максимальную классификацию из проекта, окружения и обнаруженных данных.

### Capability Modes & Suspension

- **FR-007-024**: Активный проект без GitLab suite binding MUST иметь `qaCapabilityMode=MANUAL_ONLY`.
- **FR-007-025**: `qaCapabilityMode=FULL_QA` MUST требовать валидную Jira operational-authority binding и GitLab test-execution binding с подтверждённым suite contract. Mattermost является отдельной обязательной capability пилотного deployment, но его outage не понижает QA mode и включает web fallback.
- **FR-007-026**: `projectOperationalState=SUSPENDED` MUST запрещать новые внешние write operations, запуск новых сессий и выдачу новых account leases независимо от сохранённого capability mode.
- **FR-007-027**: Suspension MUST сохранять уполномоченное чтение, аудит, расследование и безопасное завершение локальных транзакций.
- **FR-007-028**: Возобновление MUST требовать повторных capability probes, incident disposition и exact one-time approval Workspace Owner, отличного от инициатора suspension/configuration change; прежний capability mode восстанавливается только если его requirements по-прежнему выполнены, иначе пересчитывается в безопасный mode.

## Administrative Authorization

- Integration Administrator создаёт/изменяет draft, запускает validation и может выполнить немедленный explicit emergency suspend; роль не получает project content автоматически.
- QA Lead фиксирует functional acceptance mappings, environments, suites и evidence policy в разрешённом Project Scope.
- Workspace Owner с явным `project.admin` entitlement выдаёт exact approval на publish, retire и resume и не может одобрить собственную инициативу.
- Emergency suspend не ждёт второго approval, потому что только уменьшает capability; он требует reason, incident reference, audit и немедленное уведомление.
- Auditor читает configuration/audit evidence в разрешённом scope и не инициирует effects.

## Security & Privacy Requirements

- **SEC-007-001**: Платформа MUST NOT хранить секреты в ProjectBinding, Work Item, session snapshot, logs или evidence.
- **SEC-007-002**: Все secret references MUST разрешаться только в connector runtime с least privilege.
- **SEC-007-003**: Publish/retire/resume MUST применять separation of duties и step-up authentication согласно корпоративной политике; emergency suspend является fail-safe explicit command с audit, но без второго approval.
- **SEC-007-004**: Экспорт evidence MUST быть ограничен entitlement и классификацией и полностью аудироваться.
- **SEC-007-005**: Cross-project cache keys, search indexes и event partitions MUST включать workspace/project scope.

## Observability Requirements

- capability status и последнее успешное probe time по connector/project;
- число активных/retired/suspended binding versions;
- отказы авторизации по policy dimension без раскрытия чувствительных идентификаторов;
- нарушения checksum/signature validation;
- просроченные evidence artifacts и account leases;
- все метрики и логи размечаются workspace/project, но не содержат секретов или чувствительного payload.

## Success Criteria

- **SC-007-001**: 100% pilot projects имеют владельца, классификацию, активную binding version и завершённый onboarding gate.
- **SC-007-002**: В тестовой матрице нет cross-project раскрытия через UI, API, поиск, очередь или экспорт.
- **SC-007-003**: 100% завершённых pilot sessions имеют проверяемый подписанный evidence manifest.
- **SC-007-004**: Историческая сессия воспроизводимо показывает точную binding version и TargetSnapshot после смены конфигурации.
- **SC-007-005**: При `SUSPENDED` ни одна новая внешняя запись не выполняется, а расследовательский доступ сохраняется.

## Pilot Inputs Required

- `[PILOT INPUT REQUIRED]` Перечень пилотных проектов, владельцев и уровней классификации.
- `[PILOT INPUT REQUIRED]` Jira/GitLab/Mattermost identifiers и разрешённые mappings.
- `[PILOT INPUT REQUIRED]` Корпоративные правила retention, legal hold и экспорта.
- `[PILOT INPUT REQUIRED]` Источник секретов и формат opaque secret references.
- `[PILOT INPUT REQUIRED]` Каталог окружений, правила тестовых данных и аренды аккаунтов.
- `[PILOT INPUT REQUIRED]` Владельцы security incident и процедура suspension/resume.

## Out of Scope

- автоматическое создание инфраструктуры окружений;
- хранение паролей и токенов;
- универсальный каталог всех корпоративных активов;
- межорганизационный federation;
- управление релизным допуском продукта.
