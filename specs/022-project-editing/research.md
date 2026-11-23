# Research

## Поля
Decision: менять name и ownerIds, показывать key/workspace/classification постоянными.
Rationale: регистрация уже сохраняет только общий deduplicated ownerIds; восстановить пять отдельных категорий нельзя. Список людей читается из активных HUMAN membership.
Alternatives: матрица пяти ролей потребовала бы новой модели; изменение ключа/классификации затрагивает внешние привязки и доступы, не входит в принятое допущение.

## Версии
Decision: отдельная immutable registry revision, новая onboarding revision с новой registryRef/ownerSetHash и пустыми gateResultRefs; сохранять stage/mode/state/incident/binding/context. Текущие gates показывать по ссылкам текущей ревизии.
Rationale: старые проверки и approval snapshots не должны считаться актуальными после изменения карточки.
Alternatives: UPDATE старой semantic_body уничтожает историю; изменение только projects.name создаёт расхождение с реестром.

## Права
Decision: project.metadata.update для system-administrator и project-registrar; отдельный insert-once local upgrade добавляет только это право живым существующим ALLOW назначениям и существующим entitlement. DENY/отзывы/сроки/ceiling сохраняются.
Rationale: PlatformAccessService.replace пересобирает все grants и может восстановить отозванный доступ; использовать его для обновления каталога нельзя.
Alternatives: полный администратор во всех workspace нарушает согласованный ограниченный доступ.

## Старые проекты
Decision: расширить allowlist текущего консервативного seed bootstrap на ALPHA-DOCS. Чтение не создаёт данные, новые registry snapshots проверены хешами; readiness не выдаётся.
Rationale: docs seed запускается после migrations и сейчас не имеет onboarding карточки.
Alternatives: отдельный редактор legacy version0 усложняет HTTP и обходится без общей истории onboarding.

Исследование подтверждено чтением кода и независимым read-only агентом project_edit_research. Неопределённостей дизайна не осталось.
