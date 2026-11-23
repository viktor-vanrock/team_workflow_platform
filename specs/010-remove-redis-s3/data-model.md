# Data Model: v1 без Redis и S3

Эта feature не добавляет сущностей и не меняет смысл исторических QA records. Она
сокращает runtime providers вокруг существующей модели.

## Retained entities

### Durable Work Record

Существующие command/outbox records остаются единственным источником истины для
фоновой обработки.

Обязательные поля и инварианты:

- `workspaceId`, `projectId` и target identity;
- lifecycle state (`PENDING`, leased/in-flight, terminal или retryable state);
- lease owner и lease expiry для безопасного recovery;
- `idempotencyKey`, correlation/causation IDs и effect key;
- attempt count, next-attempt time и classified failure;
- requested effect и фактически подтверждённый external result;
- audit timestamps и actor/initiator.

Переход после падения worker выполняется через истечение/возврат lease и повторное
claim из PostgreSQL. Повтор использует прежний effect key и не создаёт новый внешний
эффект.

### Artifact Reference

Платформа хранит metadata внешнего GitLab artifact, а не его bytes.

Обязательные поля и инварианты:

- owner `workspaceId` и `projectId`;
- GitLab integration/profile и immutable external locator;
- checksum, size/content type при наличии;
- classification и authorization metadata;
- commit/pipeline/job provenance;
- availability state, включая `EXPIRED`;
- created/observed timestamps и audit trail.

`ArtifactReference` не означает, что платформа владеет bucket или копией объекта.

### Evidence Manifest

Manifest остаётся неизменяемой revision и может не иметь binary attachments.

Минимальное допустимое содержимое:

- Work Item, Session, Plan Item и Attempt identities;
- target snapshot и definition/rules versions;
- actor, timestamps, expected/actual outcome и result;
- observations и provenance;
- ноль или больше разрешённых GitLab artifact references;
- signature/review metadata и связь с предыдущей revision при исправлении.

### First-Version Deployment Profile

Логическая конфигурация, а не новая таблица:

- обязательны PostgreSQL, API, worker, web и необходимые connector mocks/services;
- Redis endpoint/credentials/service отсутствуют;
- S3 endpoint/bucket/credentials/service отсутствуют;
- artifact byte provider фиксирован как GitLab;
- readiness не содержит Redis/S3 dependencies.

## Removed runtime concepts

- BullMQ job envelope и Redis queue connection;
- S3 bucket/object locator как поддерживаемый v1 provider;
- presigned/manual QA upload lifecycle;
- S3 fixture object и S3 fallback for GitLab artifacts;
- Redis/S3 readiness dependency records.

## Compatibility and migration

- Новая миграция данных не требуется: производственных S3 bytes нет.
- Ранее применённые schema migrations не переписываются и не переинтерпретируются.
- Неиспользуемые historical upload rows, если они существуют в developer database,
  не обслуживаются v1 API и могут быть удалены только отдельной явной cleanup task.
- GitLab artifact references и evidence manifests сохраняют текущие identities и
  hashes, поэтому rebuild/audit остаются воспроизводимыми.
