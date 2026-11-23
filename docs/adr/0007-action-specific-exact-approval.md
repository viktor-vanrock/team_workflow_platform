# ADR-0007: Action-specific exact Approval для Connector effect и platform mutation

**Статус:** Accepted  
**Дата:** 2026-08-27  
**Constitution amendment:** 1.0.0 → 1.1.0; editorial clarification → 1.1.1

## Контекст

Один общий Approval subject, ограниченный `payloadHash` и произвольным expected state, оставляет две опасные неоднозначности. Во-первых, внешний Connector effect сверяется с состоянием внешнего объекта, тогда как публикация локальной конфигурации должна атомарно сверяться с candidate row и aggregate header. Во-вторых, отдельная ссылка `consumedBy` могла бы расходиться с действием, которое видел approver, и фактически переносить согласие на другой command/action.

## Решение

1. Approval subject является закрытым union с ветвями `EXTERNAL_COMMAND` и `PLATFORM_ACTION`.
2. Каждая ветвь содержит ровно одну immutable identity `actionKind + actionId`. Состояние `CONSUMED` добавляет только `consumedAt`; второй изменяемой ссылки на действие нет.
3. `EXTERNAL_COMMAND` pin’ит command ID, typed target, `payloadHash = SHA-256(JCS(payload SchemaBoundValue))`, exact Binding/Profile/Connection chain и ожидаемую external version/state. Worker непосредственно перед первым Connector invocation повторно проверяет live authorization, expiry, fingerprints и expected external state. CAS-consumption связывается с claim попытки исполнения именно этого command.
4. `PLATFORM_ACTION` pin’ит platform action ID, candidate resource ID/version/content hash и aggregate header snapshot: header resource version и current published version. У этой ветви нет произвольного payload: `payloadHash` равен exact semantic `contentHash` candidate revision, а typed target отдельно хэшируется целиком. Решение `APPROVE` в одной PostgreSQL transaction повторно проверяет authorization и snapshot, CAS-consumes Approval, применяет mutation и завершает platform action.
5. Drift target/payload/configuration/expected state, отзыв полномочия или expiry сохраняет историческое human decision, но переводит effect authorization в `INVALIDATED`; effect не выполняется.
6. Approver всегда является human actor с проверенным membership, entitlement и role assignment. Transport callback сам по себе не является авторизацией.

## Последствия

- Один и тот же approval primitive безопасно обслуживает внешние и чисто платформенные действия без ложной универсальности expected state.
- Audit однозначно связывает показанный человеку subject, решение, consumption и effect.
- Platform publication не зависит от очереди и не имеет окна между approval consumption и локальной mutation.
- Connector recovery после неоднозначного сбоя разрешён только для того же command и effect idempotency key.
- Контракты и persistence содержат discriminated constraints и action-specific foreign keys.

## Migration impact

`N/A (pre-implementation)`: ADR принят до создания runtime schema и production data. Миграция данных не требуется. Если реализация начнётся с более ранней моделью, переход потребует expand/contract: добавить `action_kind/action_id` и action-specific snapshots, backfill только доказуемых pending subjects, аннулировать неоднозначные approvals, затем удалить `consumedBy`-подобные поля.

## Rollout и rollback

- Rollout: сначала JSON Schema/OpenAPI и conformance vectors, затем DB constraints и transaction tests, после этого worker/platform action handlers.
- До production rollback выполняется откатом к предыдущему контрактному commit и пересозданием local fixtures. После появления durable approvals откат, вновь допускающий неоднозначную identity, запрещён; вместо него выпускается новая совместимая версия контракта и все несовместимые pending approvals инвалидируются.

## Проверки соответствия

- `EXTERNAL_COMMAND` без `actionId` либо с platform expected state не проходит schema validation.
- `PLATFORM_ACTION` без candidate и aggregate snapshots либо с external expected state не проходит schema validation.
- Non-human approver и неизвестный discriminator отклоняются.
- Изменение одного байта payload/target/snapshot/config ref меняет subject hash и инвалидирует approval.
- Competing publication оставляет decision `APPROVED`, но не публикует stale candidate и фиксирует authorization `INVALIDATED`.
- Duplicate decision/callback возвращает ранее записанный результат и не выполняет второй effect.

## Связанные документы

- [Конституция платформы](../../.specify/memory/constitution.md)
- [ADR-0005: Hermes и exact Approval](0005-hermes-coordinator-approval.md)
- [ADR-0006: Project Integration Binding](0006-project-integration-binding-versioning.md)
- [Feature 001 plan](../../specs/001-extension-kernel-local-skeleton/plan.md)
- [Approval contract](../../specs/001-extension-kernel-local-skeleton/contracts/schemas/commands/approval-subject.v1.schema.json)
