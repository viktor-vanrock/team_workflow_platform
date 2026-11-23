# ADR-0010: вторая компетенция в локальной демонстрации

Дата: 2026-09-09. Статус: принято в рамках явной пользовательской постановки feature 015. Основание: пользователь поручил добавить локальную рабочую область техписателей и сохранить security/authority/audit; production scope не расширялся.

## Решение

Разрешить статический локальный pack технической документации рядом с QA. Уточнить разделы I/III конституции версией 2.0.1: QA-only относится к первому production/pilot релизу, а явно запрошенная local/test демонстрация может проверять другие компетенции с теми же инвариантами. Никакого автоматического допуска в production.

Редакционные задания являются pack-owned доменными сущностями. Их черновик/ревью/утверждение описывают состояние текста и не являются operational state принятого Work Item. Они не создают Jira issue, не подменяют Jira projection и не выполняют внешнюю публикацию. Утверждение — точное решение HUMAN лида по версии и хэшу документа; новая редакция снимает его актуальность. Сохраняются scope, Core RBAC, классификация, audit, idempotency, deterministic transitions и local network boundary.

## Совместимость и миграция

Добавить новые таблицы и отдельный marker seed v1; существующие QA таблицы и данные не сбрасываются. Старый seed обрабатывает только свои persona IDs, новый — новые. Existing volumes остаются. SQL использует immutable историю и locks. Нет backfill/перетолкования старых данных.

## Rollout / rollback

Rollout: собрать текущий worktree, поднять прежний Compose project, migrations/seed, проверить роли и полный цикл. Rollback: выключить local docs wiring/вернуть прежний образ, сохранив новые таблицы и данные; destructive down migrations не запускаются. Production manifests/controllers не активируют этот сценарий.

## Conformance

Проверить writer cannot approve, чужой workspace/project, отозванные права и классификацию, stale version, idempotency/concurrency, изменение утверждённого текста, два seed без дублей, UI обеих ролей, прежний QA. Результаты: `specs/015-tech-writing-workspace/validation.md`.
