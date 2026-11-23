# Модель данных

## Scope и идентичность

Workspace `local-tech-writing` / «Техническая документация», project `ALPHA-DOCS` / «Сервис ALPHA — документация». Персоны `writer.docs` и `lead.docs`; HUMAN, INTERNAL, роли `technical-writer` и `technical-writing-lead`. Права писателя: docs.read/create/edit/submit; лида: docs.read/review. Членство/entitlement не дают дополнительных QA permissions.

## Редакционное задание / документ

`id`, `workspaceId`, `projectId`, `title`, `serviceDescription`, `goal`, `audience`, `sources`, `authorId`, `body`, `state`, `revision`, `resourceVersion`, `contentHash`, `approval` (revision/hash/actor/time либо null), `feedback`, `updatedAt`. Composite FK к проекту; автор должен быть в том же scope при создании (автор определяется сервером).

| Команда | До | После | Право / предусловие |
|---|---|---|---|
| create | отсутствует | DRAFT, v1 | docs.create; автор = текущий HUMAN |
| save | DRAFT, CHANGES_REQUESTED, APPROVED | DRAFT либо CHANGES_REQUESTED | docs.edit + assigned author; изменение текста увеличивает revision, снимает approval |
| submit | DRAFT, CHANGES_REQUESTED | IN_REVIEW | docs.submit + author; непустой сохранённый body |
| return | IN_REVIEW | CHANGES_REQUESTED | docs.review + HUMAN lead; обязательное замечание |
| approve | IN_REVIEW | APPROVED | docs.review + HUMAN lead; точная expected resourceVersion |

Во время IN_REVIEW редактирование запрещено; лид возвращает документ. Все команды увеличивают resourceVersion; no-op save допустим без изменения revision. Неподходящий state/expected version — 409, неверное тело — 400, нарушение доступа — 403.

## История и receipt

Append-only запись содержит scope/document, action, actor, authorization basis, revision/resourceVersion, body/hash, feedback, timestamp. Receipt (idempotencyKey, requestHash, response snapshot) хранится в существующей Core-таблице client_request_idempotency, атомарно с pack history. Уникальность команды в scope + actor + key; изменённый payload с тем же ключом — 409. Историческое approval остаётся в истории, но не действует для нового текста. Аудит Core создаётся атомарно с изменением.
