# ADR-0001: Разделение Competency Pack, Work Type и Connector

**Статус:** Accepted  
**Дата:** 2026-08-27

## Контекст

Платформа предназначена для нескольких функциональных компетенций, но первый релиз реализует только QA. Если QA semantics попадёт в Platform Core, следующая компетенция потребует переписывания ядра. Если внешние системы войдут в QA Pack, connector нельзя будет повторно использовать другим Pack. Одновременно MVP не нуждается в runtime plugin system.

## Решение

1. **Platform Core** владеет Workspace, membership/RBAC, Project Entitlement, generic Work Item, approvals, audit, idempotency, artifact references, events и Connector Broker.
2. **Competency Pack** владеет набором Work Types и их domain semantics: schemas, readiness/completion rules, domain entities, actions, skills, artifact kinds и UI extensions.
3. **Work Type** является версионируемым контрактом конкретного вида работы внутри Pack. Manual и automated checks входят в первый QA flow и нормализуются на уровне QA session/evidence, а не Connector.
4. **Connector** является независимым infrastructure adapter. Он реализует типизированные capabilities внешней системы и не содержит QA business rules.
5. Pack объявляет connector requirements через типизированный port/capability. Project Integration Binding связывает requirement с опубликованным Connector Profile. Прямые импорты Jira/GitLab/Mattermost adapter из Pack запрещены.
6. В MVP Pack, Work Types и Connectors регистрируются статически в monorepo. Одна сборка содержит одну активную compiled version каждого Pack. Исторические Work Items/Sessions сохраняют версии definition и rules, с которыми были созданы.
7. Reusable test definitions не переносятся в Pack library: они остаются в Git или существующем TMS и version-pin-ятся; будущий TMS подключается отдельным Connector.

## Последствия

- Вторую компетенцию можно добавить, не изменяя QA Pack и внешние adapters.
- Connector contract можно тестировать независимо от domain flow.
- Добавление или обновление Pack требует общей сборки и deployment.
- Pack manifest и migrations становятся публичной внутренней границей и требуют compatibility checks.
- Generic Core сознательно не становится no-code workflow engine.

## Отклонённые альтернативы

- **QA-specific Core:** быстро в начале, но закрепляет неверные абстракции и мешает следующим компетенциям.
- **Connector внутри QA Pack:** дублирует Jira/GitLab/Mattermost интеграции между Pack и смешивает domain с infrastructure.
- **Dynamic plugins/marketplace в MVP:** добавляет загрузку непроверенного кода, dependency isolation и per-plugin lifecycle без пользы для первого релиза.
- **Полностью config-only Work Types:** не выражают сложную session/evidence/verdict логику и превращают MVP в no-code workflow builder.
- **Встроенный полный TMS:** дублирует Git/существующий TMS и расширяет пилот за пределы проверяемой гипотезы.

## Проверки соответствия

- Architecture test запрещает imports из `packages/*-adapter` в Competency Pack.
- Каждый Pack экспортирует versioned static manifest и проходит registration/duplicate-key validation при старте.
- Connector contract tests выполняются без загрузки QA Pack.
- QA Pack tests используют typed fake ports, а не SDK mocks.
- Существующий Work Item продолжает читаться после обновления Work Type definition.
- В repository отсутствует runtime package download/eval и per-Workspace dynamic code loading.

## Связанные документы

- [Конституция платформы](../../.specify/memory/constitution.md)
- [Master specification v2](../agentic-workspace-platform-master-spec-v2.md)
- [Feature 001: Extension Kernel](../../specs/001-extension-kernel-local-skeleton/spec.md)
