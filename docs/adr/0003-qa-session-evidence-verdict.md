# ADR-0003: QA Session, Evidence, Finding и человеческий Verdict

**Статус:** Accepted  
**Дата:** 2026-08-27

## Контекст

Первый QA flow включает manual и automated checks. Pipeline status, результат отдельной попытки, завершённость session и итоговое QA-решение имеют разный смысл. Простая модель `pipeline passed → QA passed`, автоматическое создание defect из failed assertion или стирание failure успешным retry создают ложные выводы. Полный внутренний TMS не входит в продуктовый срез.

## Решение

1. QA Pack владеет session-scoped Plan/Checklist, Plan Items, Attempts, Findings, Evidence Manifest, residual risk и signed Verdict.
2. Reusable test definitions остаются в Git/существующем TMS. Session фиксирует immutable version ID/commit, path/reference и content hash; если источник не гарантирует immutability, session хранит snapshot определения.
3. Один QA Work Item может содержать несколько Test Sessions. Каждая Session является самостоятельной границей решения и имеет ровно один mode: `MANUAL` либо `AUTOMATED`; ручная и автоматическая проверки не смешиваются внутри одной Session. Retry/rerun создаёт новый Attempt и не изменяет предыдущий.
4. Session lifecycle: `PLANNED → READY → RUNNING → REVIEW_REQUIRED → COMPLETED`; альтернативные состояния `BLOCKED` и `CANCELLED` требуют причины и допустимого перехода. Lifecycle не является outcome или verdict.
5. Canonical Attempt Result использует `PASS`, `ASSERTION_FAILED`, `INFRA_FAILED`, `TIMEOUT`, `CANCELLED` или `INCOMPLETE`. Session Outcome использует `PASSED`, `FAILED`, `BLOCKED` или `INCONCLUSIVE`. Итоговый QA Verdict использует `PASS`, `FAIL`, `BLOCKED` или `INCONCLUSIVE` и подписывается только авторизованным QA-человеком.
6. Failed/ambiguous observation сначала создаёт Finding. Человек классифицирует его как `PRODUCT`, `INFRA`, `INCONCLUSIVE`, `DUPLICATE` или `ACCEPTED_RISK`, объединяет связанные manifestations и подтверждает либо отклоняет defect draft. Defect не создаётся непосредственно из attempt outcome.
7. Автоматический retry разрешён только для детерминированно классифицированной allowlisted infrastructure error. Assertion failure с последующим success сохраняет обе попытки и получает flaky-suspected/inconclusive classification; quarantine имеет owner, reason и expiry.
8. Definition of Ready требует project/requester, понятные goal/scope, source change/build, идентифицированный и разрешённый non-production target, подготовленные access/test-data metadata, impact/desired date и применимые definition/suite references. Live health окружения, account lease и доступность runner проверяются отдельными Session start guards. Hermes формирует missing list; READY и waiver подтверждает человек, waiver — QA Lead с причиной. SLA начинается с READY.
9. Definition of Done не требует PASS. Все Plan Items имеют terminal result либо явный waiver; Evidence Manifest complete; Findings классифицированы; defect drafts подтверждены или отклонены; residual risk и Verdict подписаны; Jira reconciled. Поэтому Work Item может завершиться с Verdict `FAIL`; открытый product defect не блокирует закрытие QA service request.
10. Evidence Manifest содержит Project/Work Item/Session/Plan Item/Attempt IDs, actor, timestamps, target snapshot, definition/rules versions, expected/actual outcome, result, provenance, artifact links и checksums. Manual attachment обязателен для `FAIL`, `BLOCKED` и `INCONCLUSIVE`, но не для каждого PASS. Automated evidence включает pipeline/job IDs, machine-readable report и полную attempt lineage.
11. Подписанный manifest неизменяем. Исправление создаёт новую revision с причиной и ссылкой на предыдущую. Raw artifacts остаются в GitLab/approved storage; истечение retention меняет доступность на `EXPIRED`, но не удаляет metadata/audit.
12. Verdict сообщает QA-результат и residual risk, но не является release/no-release решением.

## Последствия

- Manual и automated Sessions сводятся на уровне QA Work Item и итогового QA Verdict без потери самостоятельной session lineage.
- История retry и flaky behaviour остаётся наблюдаемой.
- FAIL не держит QA-запрос бесконечно открытым после завершения согласованного scope.
- Требуется отдельная domain model Finding и revisioned Evidence Manifest.
- Внешние definition repositories/TMS остаются operational dependency для reuse, но историческая session воспроизводима по pin/snapshot.

## Отклонённые альтернативы

- **Полный test-case repository в платформе:** превращает QA Pack в новый TMS и расширяет MVP.
- **Pipeline status как human verdict:** смешивает техническое исполнение и QA judgment.
- **Автоматический defect на каждый failure:** создаёт дубликаты и infrastructure pseudo-defects.
- **Retry переписывает failure:** скрывает flaky и искажает evidence.
- **Done только при PASS:** смешивает завершение работы с качеством продукта.
- **Редактируемый evidence после sign-off:** разрушает auditability и воспроизводимость.

## Проверки соответствия

- E2E Work Item содержит отдельные MANUAL и AUTOMATED Sessions, их human-signed Session Outcomes и один итоговый human-signed QA Verdict.
- Попытка модели или Connector выставить Verdict отклоняется policy.
- Failed assertion → Finding; до human confirmation Jira defect отсутствует.
- Fail-then-pass сохраняет обе попытки и не становится чистым PASS автоматически.
- Automated/Manual Session закрывается с соответствующим Session Outcome; Work Item закрывается с QA Verdict `FAIL` при выполненном DoD.
- Изменение внешнего test definition не изменяет snapshot/version уже созданной Session.
- Mutation подписанного manifest создаёт revision, а не update in place.
- Expired raw artifact оставляет metadata, checksum и audit chain.

## Связанные документы

- [Конституция платформы](../../.specify/memory/constitution.md)
- [Master specification v2](../agentic-workspace-platform-master-spec-v2.md)
- [Feature 002: QA manual walking skeleton](../../specs/002-qa-manual-walking-skeleton/spec.md)
- [Feature 005: GitLab automated validation](../../specs/005-gitlab-automated-validation/spec.md)
- [External integration request v2](../external-systems-integration-request-v2.md)
