# Contract: First-Version Infrastructure Boundary

## Required runtime services

Первая версия требует PostgreSQL и приложений платформы. Redis, BullMQ service,
S3/S3Mock, bucket initializer и object-storage sidecar не входят в контракт.

Readiness приложения считается успешным без сетевых обращений к Redis или S3.

## Configuration contract

Поддерживаемые deployment inputs не содержат:

- Redis URL, host, port, username, password или TLS policy;
- S3 endpoint, region, bucket, access key, secret key или path-style flag;
- object-store provider switch;
- Redis/S3 health-check timeout или lifecycle configuration.

Неизвестные legacy Redis/S3 environment variables не активируют capability и не
влияют на readiness.

## Background work contract

API фиксирует durable command/outbox state в PostgreSQL до подтверждения запроса.
Worker claim-ит готовую запись с lease, исполняет эффект с неизменным idempotency/effect
key и атомарно фиксирует результат либо retry metadata. После рестарта просроченная
lease снова доступна для claim; подтверждённый внешний эффект не дублируется.

## Artifact contract

Для CI artifacts поддерживается только GitLab-backed reference. Чтение разрешается
только после проверки Workspace/Project entitlement, classification и locator
provenance. Платформа не создаёт внутреннюю копию bytes.

Если GitLab artifact больше недоступен, metadata и audit сохраняются, а availability
становится `EXPIRED`/unavailable согласно текущей domain policy.

## QA API contract

Сохраняются API для sessions, plan items, attempts/results, observations, evidence
manifest, review, signature и verdict. В публичной v1 surface отсутствуют операции:

- request/presign attachment upload;
- complete/finalize attachment upload;
- загрузить произвольный локальный файл как evidence;
- читать QA attachment из платформенного object storage.

Manifest с нулём binary attachments является валидным при выполнении остальных
readiness/review требований.

## Failure behavior

- Отсутствие Redis/S3 не является degraded state.
- Недоступность PostgreSQL блокирует durable state и readiness.
- Недоступность GitLab не блокирует manual QA flow, но делает automated artifact
  недоступным и переводит соответствующую работу в существующее ожидающее состояние.
- Ошибка внешнего эффекта сохраняет retry/audit metadata в PostgreSQL.
