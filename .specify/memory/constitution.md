<!--
Sync Impact Report
- Version change: 3.0.0 → 3.1.0 (MINOR: one-time local first-login administration).
- Modified principle: III. Workspace и Project Entitlement (explicit local bootstrap).
- Added/removed sections: none. No template or command changes.
- Follow-up TODOs: none.
- Governance basis: ADR-0016, explicit user decision for one local global administrator on first login on 2026-09-10.
-->
# Конституция Agentic Workspace Platform

**Версия:** 3.1.0
**Статус:** Ratified
**Дата ратификации:** 2026-08-27
**Последняя поправка:** 2026-09-10

Термины **ДОЛЖЕН**, **НЕЛЬЗЯ** и **ЗАПРЕЩЕНО** являются нормативными. Эта конституция имеет приоритет над feature-specification, планом и задачами реализации.

## I. Область продукта и первый релиз

- Платформа является общей Jira-centric платформой обработки запросов для функциональных команд.
- Первый релиз содержит только QA Competency Pack и один Work Type `qa.validation`. Один QA Work Item может иметь несколько Test Sessions; каждая Session имеет ровно один mode (`MANUAL` или `AUTOMATED`), поэтому ручные и автоматические проверки выполняются отдельными Sessions.
- По явному запросу пользователя локальная/test-демонстрация МОЖЕТ содержать дополнительные статические Competency Packs при сохранении всех security, authority, audit и versioning инвариантов. Это не расширяет production/pilot scope первого релиза (ADR-0010).
- Pilot начинается с одного reference web/API-проекта, одного QA Workspace, одного Jira workflow, одного non-production environment, одного стабильного smoke suite и одного QA Lead. После прохождения gates остальные пилотные проекты подключаются последовательно тем же onboarding package.
- Reusable test definitions остаются в Git или существующем TMS. QA Pack хранит session-scoped plan/checklist и неизменяемую ссылку, версию, hash либо snapshot определения; собственная библиотека reusable test cases в первый релиз не входит.

## II. Операционная власть Jira

- Jira является первым и каноническим источником operational state принятого Work Item: workflow/status, assignee, priority, due date и Jira links/comments.
- Domain Core, Competency Pack и Hermes НЕЛЬЗЯ вызывать Jira SDK/API напрямую. Все операции идут через типизированный port и независимый Jira Connector.
- Локальная projection является только read model. Запись Jira-owned поля ДОЛЖНА использовать expected version/value, durable outbox, idempotency key, audit и подтверждение фактического состояния чтением или webhook.
- Candidate из Mattermost, ручного ввода, Jira или GitLab не становится принятым запросом без явного подтверждения пользователя и Jira binding.

## III. Workspace и Project Entitlement

- Каждый Workspace, включая QA и локальные демонстрационные компетенции, является внешней hard security boundary и обслуживает несколько проектов.
- Доступ вычисляется как пересечение `Workspace membership ∩ Project Entitlement ∩ Role permission ∩ Data Classification`; default — deny.
- Work Item, session, plan item, attempt, Finding, evidence, artifact reference, Agent Run, approval и integration command ДОЛЖНЫ иметь `workspaceId` и `projectId`.
- Ссылка между проектами, Jira link, membership в Workspace или скрытие элемента в UI не предоставляют project access.
- Hermes не получает человеческую роль: каждый Agent Run получает минимальные project-scoped tool grants.
- Роль уровня платформы `access-administrator` МОЖЕТ управлять каталогом людей, членствами и назначениями ролей во всех Workspace через отдельную плоскость управления. Её назначение НЕ ДОЛЖНО добавлять права чтения или изменения бизнес-данных проектов; `Workspace membership ∩ Project Entitlement ∩ Role permission ∩ Data Classification` продолжает применяться к ним без исключений.
- Глобальные назначения и их проверка ДОЛЖНЫ быть отделены от workspace/project `RoleAssignment` и `ResourceScope`. По явному решению владельца продукта первый проверенный корпоративный HUMAN login новой платформы ДОЛЖЕН однократно получить `access-administrator`. Выбор и назначение фиксируются атомарно на уровне БД и не открываются заново при отзыве, повторном входе или рестарте. Существующее корпоративное назначение закрывает bootstrap при обновлении. Клиентские поля не могут выбрать администратора; группы Keycloak не требуются для управляемых платформой ролей. Каждый административный запрос требует проверенной корпоративной identity и действующего глобального назначения.
- Первый проверенный корпоративный вход МОЖЕТ создать identity и запись ожидающего пользователя без членства, роли или Project Entitlement. Назначение и отзыв рабочих ролей ДОЛЖНЫ быть атомарными, версионируемыми и аудируемыми; существующие сессии повторно проверяют текущие права.
- В локальной сборке по явному запросу пользователя первый успешный HUMAN login настроенного локального issuer ДОЛЖЕН однократно получить единственное глобальное назначение `access-administrator`. Выбор и назначение атомарны и неизменяемы после отзыва или рестарта; seed не выбирает получателя. Прежнее фиксированное локальное назначение архивируется миграцией 230. Локальный и корпоративный выбор независимы; локальное назначение не авторизует корпоративную админку (ADR-0016).


## IV. Competency Pack, Work Type и Connector

- Competency Pack содержит один или несколько Work Types и владеет их domain semantics, schemas, readiness/completion rules, domain entities, actions, skills и UI extensions.
- Platform Core владеет Workspace/RBAC, generic Work Item, approvals, audit, idempotency, artifact references, event delivery и connector brokerage.
- Connector является независимым infrastructure adapter. Pack только объявляет требуемую типизированную capability; Project Integration Binding связывает её с опубликованным Connector Profile.
- В MVP Pack и Connector регистрируются статически в monorepo и поставляются общей сборкой. Dynamic loading, marketplace и per-Workspace runtime versions запрещены.

## V. Детерминированное ядро

- RBAC, Project Entitlement, mapping, state transition validation, idempotency, inbox/outbox, retry classification, SLA, connector invocation, approval enforcement, evidence integrity и reconciliation не зависят от LLM.
- Результат модели всегда schema-validated и рассматривается как proposal. Model outage не блокирует ручной или детерминированный flow.
- Внешний текст из Jira, GitLab, Mattermost и artifacts считается untrusted input и не расширяет tool grants.

## VI. Hermes и точные approvals

- Hermes является одним логическим координатором, но не глобальным security principal,
  владельцем очереди или источником бизнес-приоритета. Каждый Agent Run ДОЛЖЕН быть
  изолирован по неизменяемым `workspaceId`, `projectId` и ровно одной ветви закрытого
  exact-subject union: `DRAFT { draftId, revision, contentHash }`,
  `CANDIDATE { candidateId, sourceObservationVersion, contentHash }` либо
  `WORK_ITEM { workItemId, resourceVersion, contentHash }`. Stored subject snapshot и
  каждый tool target ДОЛЖНЫ совпадать с этим Workspace/Project scope; свободная
  межпроектная память ЗАПРЕЩЕНА.
- Tool grants каждого Agent Run ДОЛЖНЫ быть минимальными и вычисляться как пересечение
  SERVICE-авторизации Hermes, allowlist версии SkillDefinition, текущей авторизации
  инициирующего HUMAN, exact subject/configuration scope и Data Classification.
- Agent Run с subject `DRAFT` или `CANDIDATE` ДОЛЖЕН оставаться pre-acceptance proposal.
  Ему НЕЛЬЗЯ прямо либо через Tool Grant создавать Work Item, Jira issue, SLA/WIP state,
  ApprovalDecision, verdict, принятое значение priority либо queue order.
- Изменение версии либо `contentHash` subject ДОЛЖНО аннулировать pending
  recommendations/actions. Изменённый snapshot НЕЛЬЗЯ переинтерпретировать внутри
  существующего immutable Agent Run; дальнейшая обработка требует нового Agent Run с
  новым input fingerprint.
- Без дополнительного approval Hermes МОЖЕТ читать разрешённый контекст, проверять полноту, готовить рекомендации и план, собирать evidence, формировать Finding/defect draft и ставить уведомления в outbox.
- Стабильный allowlisted smoke suite в non-production МОЖЕТ быть запущен только явной командой авторизованного пользователя; второй approval для этой команды не нужен.
- Создание Jira defect из draft, Jira transition, assignment, изменение priority или due date требуют точного одноразового approval.
- Approval ДОЛЖЕН фиксировать actor/approver, роль и authorization basis approver, единственную идентичность действия `actionKind + actionId`, target, payload hash, action-specific expected state (external version/state для Connector effect либо candidate resource version/content hash и aggregate current-state snapshot для platform mutation), exact binding/profile refs, scope, expiry и idempotency key. Для Connector effect payload hash покрывает полный typed payload; для platform mutation без произвольного payload он равен semantic content hash immutable candidate. Connector effect и platform mutation используют разные закрытые ветви subject; consumption относится только к уже зафиксированному действию и не может подменить его вторым action ref. Изменение payload, target, expected state, версии, права либо истечение срока аннулирует approval.
- Priority и complexity от Hermes хранятся отдельно от принятого значения, содержат объяснение, confidence и использованные факты и устаревают при изменении входов. Межпроектный порядок утверждает QA Lead.

## VII. Human verdict и завершение QA

- Technical attempt outcome, plan-item/session lifecycle и QA verdict являются разными моделями состояния.
- Test Session использует lifecycle `PLANNED → READY → RUNNING → REVIEW_REQUIRED → COMPLETED` с альтернативными `BLOCKED` и `CANCELLED`. Canonical Attempt Result: `PASS`, `ASSERTION_FAILED`, `INFRA_FAILED`, `TIMEOUT`, `CANCELLED`, `INCOMPLETE`; Session Outcome: `PASSED`, `FAILED`, `BLOCKED`, `INCONCLUSIVE`; human QA Verdict: `PASS`, `FAIL`, `BLOCKED`, `INCONCLUSIVE`.
- Только авторизованный человек подписывает итоговый QA verdict и residual risk. Hermes не принимает verdict и release/no-release решение.
- Failed observation сначала становится Finding; defect создаётся только после человеческой классификации и подтверждения draft.
- Retry не стирает предыдущую попытку. Assertion failure с последующим success классифицируется как flaky-suspected/inconclusive согласно QA policy, а не переписывается в чистый PASS.
- Work Item МОЖЕТ завершиться с verdict `FAIL`: это означает завершённую QA-работу с отрицательным результатом продукта, а не product acceptance.
- Открытый product defect не блокирует закрытие QA service request после выполнения DoD; release decision остаётся вне платформы.

## VIII. Evidence и target snapshot

- Подписанный evidence manifest неизменяем. Исправление создаёт новую revision с причиной и ссылкой на предыдущую.
- Manifest ДОЛЖЕН содержать идентификаторы Project/Work Item/Session/Plan Item/Attempt, actor, timestamps, expected/actual outcome, result, provenance, artifact hashes и версии definition/rules.
- Каждый attempt ДОЛЖЕН быть привязан к immutable target snapshot: build/commit/digest, environment ID и revision, suite/checklist version/hash, test-data/account lease reference и версии integration bindings/profiles.
- Raw artifacts остаются в GitLab или approved object storage. Удалённый по retention artifact помечается `EXPIRED`; metadata и audit trail сохраняются.

## IX. Надёжность и аудит

- Webhook ingestion, queue consumers, Agent Runs и внешние writes ДОЛЖНЫ быть идемпотентны. Retry не создаёт повторного issue, comment, pipeline, defect или transition.
- Каждое автоматическое либо внешнее write action ДОЛЖНО иметь initiator, correlation ID, causation ID, idempotency key, policy/skill/profile versions, requested effect, external result и audit event.
- Audit и durable workflow state НЕЛЬЗЯ хранить только в Redis, agent memory или внешнем message channel.

## X. Интеграции и local-first

- Jira, GitLab и Mattermost обязательны в pilot deployment, но не образуют общую синхронную транзакцию.
- При недоступной Jira сохраняется Candidate/Draft, но не создаётся фиктивный принятый Work Item. При недоступном GitLab manual flow продолжается, automated item ожидает. При недоступном Mattermost основной Jira/QA flow продолжается, сообщения остаются в outbox.
- Каждый Connector ДОЛЖЕН иметь stateful local/test mock, contract tests и сценарии timeout, 401/403, 429/5xx, duplicate/out-of-order event и schema drift там, где применимо.
- Локальный критический flow не требует корпоративного VPN, production credentials или реальных внешних систем.

## XI. Версионирование и совместимость

- Pack manifest, Work Type definition, intake schema, domain rules, public API, event payload, Connector contract и Connector Profile имеют явную версию.
- Published definitions/profiles неизменяемы; изменение создаёт новую версию. История сохраняет фактически использованные версии.
- Новые версии ДОЛЖНЫ быть backward-compatible либо иметь явную migration/compatibility policy, rehearsal и rollback. Pending approval аннулируется при изменении связанного payload, target или profile version.
- Database migrations используют expand/contract для несовместимых изменений; silent reinterpretation исторических sessions/evidence запрещена.

## XII. Production boundary и контроль соответствия

- Первый релиз не выполняет production actions, production test runs, deployment operations или release/no-release decisions. Запрет обеспечивается credentials, Connector Policy, CI allowlist и network policy, а не только UI.
- Feature не готова, если не определены authority, Workspace/Project scope, typed ports, approval class, idempotency/audit, target snapshot, version behavior, local mock и критические conformance tests.
- Изменение конституционного инварианта требует нового ADR, анализа миграции и повышения версии этой конституции.

## Governance

- Поправка начинается с ADR, который формулирует новый или изменяемый инвариант, совместимость, последствия, migration impact, rollout/rollback и проверки соответствия. Принятие поправки требует явного human review владельцев Platform Core и затронутых доменных/безопасностных областей.
- Версия следует Semantic Versioning: **MAJOR** — несовместимое ослабление, удаление либо переопределение действующего инварианта; **MINOR** — новый или усиленный обратно совместимый инвариант; **PATCH** — редакционное уточнение без изменения обязательств.
- Feature specification, plan, contracts и ADR обязаны пройти повторную проверку на соответствие новой версии. Исключение из инварианта нельзя оформить молчаливой правкой нижестоящего документа.
- Для каждой принятой версии сохраняется запись об изменении и миграции. До начала реализации допустим migration impact `N/A (pre-implementation)`, но он всё равно должен быть зафиксирован в ADR.

### История поправок

| Версия | Дата | Изменение | Migration impact |
|---|---|---|---|
| 3.1.0 | 2026-09-10 | Один глобальный администратор локальной сборки выбирается при первом успешном входе; явное решение пользователя, ADR-0016. | Core 230: архив прежнего LOCAL_BOOTSTRAP, неизменяемый локальный выбор, уникальное назначение LOCAL_FIRST_LOGIN. Рабочие данные и корпоративные назначения сохраняются. |
| 3.0.0 | 2026-09-10 | Первый проверенный корпоративный вход однократно назначает администратора, роли управляются в приложении без групп Keycloak; явное решение пользователя, ADR-0015. | Core 225: новый источник и неизменяемая запись выбора; существующие корпоративные назначения сохраняются, отзыв не открывает bootstrap. Host обновляет provisioning и ревизию policy. |
| 2.1.0 | 2026-09-09 | Добавлена отдельная глобальная роль управления доступами по явному решению пользователя, ADR-0013; бизнес-границы Workspace сохранены. | Аддитивные таблицы каталога и глобальных назначений, версии рабочих доступов и аудит; без удаления данных и автоматических бизнес-грантов. |
| 2.0.1 | 2026-09-09 | Уточнён local/test scope дополнительных компетенций без расширения production; ADR-0010 по явной постановке пользователя. | Аддитивные таблицы/seed, прежние данные не меняются. |
| 2.0.0 | 2026-09-01 | Subject Agent Run переопределён с обязательного Work Item на закрытый exact union `DRAFT \| CANDIDATE \| WORK_ITEM`; закреплены exactly-one/same-scope, границы pre-acceptance, пересечение grant и invalidation при drift; принят ADR-0008. | N/A — поправка принята до реализации; существующие Work Item Agent Runs сохраняются без reinterpretation. Если storage существует к rollout, применяется expand-first/backfill/validation из ADR-0008. |
| 1.1.1 | 2026-08-27 | Редакционно закрыта неоднозначность `payloadHash`: typed payload для Connector effect и semantic candidate content hash для platform mutation без отдельного payload; ADR-0007. | N/A — уточнение pre-implementation контракта, данные отсутствуют. |
| 1.1.0 | 2026-08-27 | Exact Approval получил единственную action identity и раздельные action-specific snapshots для Connector effect и platform mutation; принят ADR-0007. | N/A — пакет находится до реализации и runtime/storage migration не требуется. |
| 1.0.0 | 2026-08-27 | Первичная ратификация QA-first платформенных инвариантов. | N/A — исходная версия. |
