# План реализации: техническая документация

**Feature**: `015-tech-writing-workspace` | **Дата**: 2026-09-09 | [Спецификация](spec.md)

## Резюме

Статический локальный Competency Pack `tech-writing`, две persona, собственные редакционные задания и документ с историей ревизий. Аддитивный versioned seed добавляет workspace и отдельный проект ALPHA-DOCS. Общий shell выбирает UI contribution по контексту и разрешениям.

## Технический контекст

- TypeScript 6, Node 24.20.0, pnpm 11.21.0, NestJS, React/Vite, TypeORM/PostgreSQL — версии репозитория.
- Хранение: отдельные pack-owned таблицы заданий/истории и существующие Core receipts. Миграция expand-only в local registry.
- Тесты: Vitest (переходы, права, конкуренция/идемпотентность с PostgreSQL), браузерная проверка обеих ролей, QA regression; typecheck, ESLint, build.
- Платформа: существующий Docker Compose `awp-local-pilot-dev`; актуальные исходники этого worktree.
- Ограничения: только local runtime, без внешних Jira effects/публикации/LLM; текст до 100000 символов, 3 исходных демо-задания плюс возможность создать повторный пример.
- Производительность: локальная очередь ограничена 100 заданиями; формы используют блокировку повторной отправки и контроль версии.

## Проверка конституции

До исследования: разрешённая пользователем локальная вторая компетенция требует явного ADR-0010 и редакционного уточнения 2.0.1; production scope прежний. После проектирования: PASS при реализации перечисленных gates.

| Инвариант | Решение |
|---|---|
| QA-first production | Новый pack активен только локально; ADR-0010 |
| Jira operational authority | Документ — pack-owned редакционная сущность; нет создания принятого Work Item или изменения Jira projection |
| Membership ∩ entitlement ∩ role ∩ classification | Проверка durable Core authority при каждом запросе; запись в той же транзакции под locks |
| Границы pack/Core | Семантика и UI в pack, auth/HTTP wiring в app, seed/composition в runtime |
| Точное human approval | Решение по resourceVersion + revision + contentHash; изменение текста снимает approval |
| Надёжность и аудит | Транзакция document+immutable history+receipt+Core audit; idempotency key, expected version |
| Версии и rollback | Новые таблицы, seed marker, старые записи не перезаписываются; rollback выключает wiring без удаления данных |
| Local-first | Fake IdP, существующая БД/Compose, нет корпоративных секретов и remote publishing |

## Структура проекта

- `packages/competency-tech-writing/src/`: domain.ts, manifest.ts, migration.ts, UI browser entry.
- `packages/competency-ui-sdk/src/index.ts`: additive статический workspace contract.
- `packages/runtime-composition/src/seed/tech-writing-local-seed.ts`: независимый marker версии 1.
- `packages/runtime-composition/src/security/local-security.ts`: persona/permission declarations.
- `apps/api/src/local/tech-writing.controller.ts`: local-only authenticated HTTP, scoped transaction.
- `apps/web/src/workspace/`: registry/navigation/context dispatch.
- `tests/integration/015/`, `tests/unit/015/`: релевантные сценарии.
- `docs/adr/0010-local-tech-writing-workspace.md`, `docs/user-guide/tech-writing.md`.
- Этот каталог: research, data-model, contracts, quickstart, tasks, validation.

## Этапы

1. Исследовать контракты и согласовать scope/артефакты.
2. Создать pack, миграцию, add-only seed и безопасный вход.
3. Реализовать транзакционный редакционный процесс с серверными правами.
4. Встроить реальные разные рабочие экраны, редактор/ревью и повторяемый пример.
5. Проверить код, PostgreSQL, браузер и соответствие артефактам; оставить работающий актуальный стенд.

## Учёт сложности

Новая компетенция необходима для сравнения ролей. Добавление QA-статусов вместо pack отклонено: смешивает редакционное состояние с QA/Jira authority. Новые сервисы, брокеры и внешнее publishing не требуются.
