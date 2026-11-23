# ADR-0009: Первая версия без Redis и S3

**Status:** Accepted

**Date accepted:** 2026-09-07

**Supersedes for v1:** требования Feature 001, Feature 002 и Feature 008, которые
включали Redis/BullMQ либо S3/S3Mock в обязательный runtime первой версии.

## Context

Фактические business workers уже используют PostgreSQL как авторитет для command,
outbox, lease, retry и idempotency. BullMQ package и Redis service не участвовали
в основном runtime path, но увеличивали dependency graph, конфигурацию, readiness и
операционную поверхность.

S3-compatible storage обслуживал локальные fixtures и платформенную загрузку
бинарных QA-вложений. Основной QA lifecycle — observations, results, evidence
manifest, review, signatures и verdict — не требует владения бинарными bytes.
Автоматические CI artifacts уже принадлежат GitLab и могут читаться через scoped
GitLab connector с проверками entitlement, classification, checksum, provenance и
availability.

## Decision

1. В первой версии нет Redis, BullMQ и отдельного message broker. PostgreSQL —
   единственный durable delivery authority; worker выполняет polling, claims,
   leases, retries и recovery по существующим таблицам.
2. В первой версии нет S3/S3Mock и платформенного object storage. Публичные upload
   routes для произвольных QA attachments удаляются.
3. Единственный поддерживаемый artifact mode — `GITLAB_ONLY`. GitLab хранит bytes;
   платформа хранит scoped metadata, checksum, provenance и availability.
4. Manual QA работает без бинарных вложений. Текстовые наблюдения, результаты,
   manifests, review и verdict сохраняются.
5. Старые Redis/S3 environment variables игнорируются и не активируют скрытые
   компоненты. Новые deployment templates их не содержат.
6. Исторические миграции и отчёты не переписываются: они остаются доказательством
   прежнего решения, но не определяют текущую границу продукта.

## Consequences

- Локальный и non-production контур требуют меньше сервисов, секретов, probes,
  volumes и recovery procedures.
- Worker restart и неопределённый внешний результат по-прежнему безопасны за счёт
  PostgreSQL leases, stable effect key и provider readback.
- Пользователь не может загрузить локальный binary attachment в v1.
- Истёкший GitLab artifact может стать недоступным, при этом его metadata и audit
  остаются.
- Возврат broker или object storage возможен только отдельной будущей feature с
  измеренной необходимостью и явным контрактом миграции.

## Compliance checks

- Runtime dependency graph не содержит Redis/BullMQ и S3/S3Mock implementations.
- Compose/readiness/env templates не содержат соответствующих сервисов и входов.
- Public OpenAPI не содержит attachment upload operations.
- PostgreSQL restart-recovery и GitLab-only artifact tests проходят.

## Related documents

- [Feature 010 specification](../../specs/010-remove-redis-s3/spec.md)
- [Feature 010 plan](../../specs/010-remove-redis-s3/plan.md)
- [V1 infrastructure boundary](../../specs/010-remove-redis-s3/contracts/v1-infrastructure-boundary.md)
