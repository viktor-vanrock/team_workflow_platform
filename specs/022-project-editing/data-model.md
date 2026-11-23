# Data model

Project: name и current_registry_version обновляются атомарно, row_version увеличивается; key/workspace/classification/state неизменны.
ProjectRegistryRevision: version+1, новый revisionId, name, сортированный непустой ownerIds без дублей, reason, current HUMAN author, timestamp, canonical contentHash; остальные постоянные и verification поля сохраняются.
ProjectOnboardingRevision: version+1, новая registryRef, ownerSetHash, gateResultRefs=[]; прежние stage/mode/state/incident/binding/context сохраняются. Старые кандидаты/approvals требуют прежнюю точную версию и не проходят повторно.
History: registry revisions сохраняют before/after через последовательные версии, автора/время/причину; UI показывает читаемые имена и предыдущие значения.
Permission upgrade: существующие ALLOW role rows получают metadata.update и version+1; существующие живые соответствующие entitlement получают версионированный REPLACE с сохранением scope, ceiling, intervals, permissions. Отсутствующие/отозванные grants не создаются; один local marker предотвращает повтор.
Validation: name 1..256, reason 1..2000, ownerIds 1..100 UUID действующих HUMAN в том же workspace; неизвестные поля отклоняются. Обновление suspended карточки допустимо как maintenance; archived запрещено.
