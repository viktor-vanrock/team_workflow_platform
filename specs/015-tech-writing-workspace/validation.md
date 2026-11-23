# Проверка реализации 015 — техническая документация

**Дата:** 2026-09-09. **Результат приёмки:** PASS в заявленном локальном scope.

Стенд оставлен работающим: [web](http://localhost:55173), [API](http://localhost:5300). Исходники — `/Users/alexandr/.codex/worktrees/8635/PlatformWorkspace`, ветка `codex/015-tech-writing-workspace`. Исходный checkout не редактировался, push/PR не выполнялись.

## Роли и повторение

На экране входа выбрать роль и нажать **Начать работу**. Пароль не нужен, вход проходит через локальную persona/Fake IdP. После полной перезагрузки страницы роль выбирается заново; текст остаётся в PostgreSQL.

| Роль | Главная и навигация | Действия |
|---|---|---|
| Технический писатель (`writer.docs`) | Рабочий стол писателя, свои документы, черновики и замечания | Создание задания, сохранение текста, отправка и повторная отправка на ревью |
| Лид технических писателей (`lead.docs`) | Пульт лида, очередь ревью, библиотека | Чтение документа и истории, возврат с замечанием, утверждение точной редакции |

Обе роли относятся к **Техническая документация / ALPHA-DOCS**. Повторить цикл можно через **Новое задание** у писателя, затем менять роли кнопкой **Сменить роль или проект**. Подробный маршрут: [руководство](../../docs/user-guide/tech-writing.md), [quickstart](quickstart.md).

## Личная проверка в браузере

Проверка выполнена через настоящий интерфейс локального web в браузере Codex.

1. Вход писателем, проверка главной и навигации; создано новое задание **ALPHA: проверенный пример — первый запрос и ошибки**.
2. Сохранён текст; после полной перезагрузки, повторного входа и открытия документа проверено точное совпадение текста.
3. Документ передан на ревью; редактор перестал быть доступен.
4. Вход лидом: другая главная/навигация, документ в очереди; редактирования текста и создания заданий нет. Возврат блокируется без замечания.
5. Лид вернул документ с замечанием: добавить ошибки 400/401/404, действия интегратора и обозначить учебный контракт.
6. Писатель увидел замечание, дополнил текст, сохранил и повторно отправил его на ревью.
7. Лид утвердил редакцию 3; видны семь событий истории с авторами, замечанием и предыдущими текстами.
8. Вход **Исполнитель QA · ALPHA**: прежние навигация и два существующих запроса доступны.
9. После последнего пересоздания контейнеров и повторного входа утверждённый документ, текст и история сохранились. Ошибок browser console не обнаружено.

Проверенный результат: [открыть документ](http://localhost:55173/docs/documents?document=7ad1c3f7-71a7-4792-a2d3-6d811e47ebe4) после входа соответствующей ролью. ID `7ad1c3f7-71a7-4792-a2d3-6d811e47ebe4`, состояние `APPROVED`, редакция `3`, resourceVersion `7`, событий истории `7`. В библиотеке четыре документа: три исходных примера и этот результат.

Доказательства: [browser-check.json](screenshots/browser-check.json), [писатель — главная](screenshots/writer-home.png), [редактор](screenshots/writer-draft.png), [лид — главная](screenshots/lead-home.png), [ревью](screenshots/lead-review.png), [утверждение](screenshots/approved-document.png), [история после перезапуска](screenshots/approved-history.png), [прежний QA](screenshots/qa-requests-preserved.png), [пример в окончательной сборке](screenshots/approved-final.png).

## Автоматические проверки

Команды выполнены из этого worktree, Node `24.20.0`, pnpm `11.21.0` через Corepack. Для контейнерных тестов использована отдельная тестовая PostgreSQL 18, не база работающего стенда.

| Проверка | Команда / область | Результат и вывод |
|---|---|---|
| Workflow, права, хранение | `AWP_RUN_CONTAINER_TESTS=true DOCKER_HOST=unix:///Users/alexandr/.docker/run/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock ./node_modules/.bin/vitest run tests/integration/015 tests/unit/015 --maxWorkers=1` | 11/11, [вывод](verification/integration-final.txt) |
| Регрессия локальных ролей/UI | `./node_modules/.bin/vitest run tests/unit/009 tests/architecture/ui-localization.spec.ts tests/integration/security/acceptance/at-003-local-security.spec.ts --maxWorkers=1` | 58/58, [вывод](verification/regression-final.txt) |
| Типы | `NX_DAEMON=false NX_ISOLATE_PLUGINS=false corepack pnpm typecheck` | Root + 24 проекта, [вывод](verification/types-final.txt) |
| Сборка | `NX_DAEMON=false NX_ISOLATE_PLUGINS=false corepack pnpm build` | 24 проекта, [вывод](verification/build-final.txt) |
| Lint | `./node_modules/.bin/eslint . --max-warnings=0` | Exit 0, [фиксация](verification/static-checks.txt) |
| Форматирование | `./node_modules/.bin/prettier --check .` | PASS, [вывод](verification/format-check.txt) |
| Архитектура | `node tools/architecture/check-import-graph.mts` | 24 проекта, без deep imports/циклов/dynamic loading, [вывод](verification/architecture.txt) |
| HTTP работающего стенда | `node tools/smoke/feature-015.mts` | 13/13, [вывод](verification/http-final.txt) |
| Актуальный runtime | `corepack pnpm dev:pilot:up` | Успешная финальная пересборка/запуск, [состояние](verification/pilot-runtime.txt) |

Итого **69 прошедших тестов + 13 HTTP-проверок**, дополнительно ручной браузерный цикл. После финальных изменений границы HTTP повторно прошли TypeScript API и ESLint затронутых файлов. Convergence обнаружил и закрыл T019: необработанные сетевые/JSON ошибки теперь получают русский fallback, локализованные серверные ошибки сохраняются. После этого прошли TypeScript пакета и targeted ESLint; финальный Docker image пересобран из этих исходников. Проверка текстов до 100000 русских символов подтверждает приём JSON parser и последующую ожидаемую проверку версии (409); 100001 символ отклоняется сервером (400).

Серверные тесты проверяют отзыв membership, entitlement и role отдельно, classification ceiling, отзыв отдельного permission, запрет писателю утверждать, чужой scope/документ, подмену authority, пустую отправку, обязательное замечание, immutable history, audit, точность approval и его снятие после изменения, идемпотентность, конфликт другого payload с тем же ключом и конкурирующие сохранения без потери версии. HTTP-проверки дополнительно подтверждают реальные ответы 400/401/403/404/409 через guard/controller. Во время приёмки исправлены ответ 500 при подмене authority и недостаточный размер JSON parser для допустимого русского текста.

## Сохранность данных и актуальность стенда

- Использован прежний Compose project `awp-local-pilot-dev` и volume `awp-local-pilot-dev-postgres-data`. Сброс/удаление volumes не выполнялись.
- Независимый seed marker `015-tech-writing-workspace`, версия 1; повторный seed возвращает `unchanged`. Старые seed-маркеры сохранены. Идемпотентность и неизменность сохранённого текста проверены также в PostgreSQL integration tests.
- Фактические счётчики и маркеры: [database-check.json](verification/database-check.json).
- API и web работают с одним образом `sha256:c574ac3675516f9a44905d00510a384694e8d64cb5eae860d6949cc92191916f`. SHA-256 девяти ключевых файлов в контейнере совпали с текущим worktree: [runtime-check.json](verification/runtime-check.json).
- Опубликованные bytes intake schema и manifest digest сохранены согласованными. Миграция аддитивна; rollback отключает wiring, сохраняя данные и историю.

## Сопоставление с требованиями

| Требование | Реализация и проверка | Итог |
|---|---|---|
| FR-001 | Отдельные workspace/project в seed; старый QA проверен в браузере и тестах | PASS |
| FR-002 | Две persona, Fake IdP, server-side выбор допустимого workspace | PASS |
| FR-003 | Role-specific contribution, разные главные/навигация/действия; снимки обеих ролей | PASS |
| FR-004 | Сервис, цель, аудитория, учебные источники, назначенный автор в документе | PASS |
| FR-005 | PostgreSQL snapshot/revision; текст пережил reload и пересоздание контейнеров | PASS |
| FR-006 | Все переходы выполнены через UI; domain/API tests запрещают некорректные переходы | PASS |
| FR-007 | Durable Core authority в транзакции; отдельные revoke/classification/negative HTTP checks | PASS |
| FR-008 | Approval по revision/contentHash/current resourceVersion; тест снятия после правки | PASS |
| FR-009 | Scope в SQL/FK, keyed remount/AbortController/session epoch; смена ролей и отрицательные тесты | PASS |
| FR-010 | Независимый marker/advisory lock/add-only seed; повторные подготовки и сохранённый текст | PASS |
| FR-011 | Immutable history, Core audit/receipts, expected version, idempotency/concurrency tests | PASS |
| FR-012 | Три исходных состояния + проверенный утверждённый пример, руководство повторения | PASS |
| SC-001 | В двух входах различаются главная, навигация и действия | PASS |
| SC-002 | Полный ручной цикл с возвратом и reload | PASS |
| SC-003 | Scope/authority/version отказы; UI сбрасывает контекст | PASS |
| SC-004 | Повторный seed не меняет количество и пользовательский текст | PASS |
| SC-005 | Source hashes совпали, контейнеры healthy, QA доступен | PASS |

Все 13 acceptance scenarios трёх историй покрыты реализацией и перечисленными проверками. Пять групп пограничных случаев проверены тестами либо просмотром кода; прерывание запроса при смене роли и русские сообщения сетевых ошибок проверены по AbortController/epoch/error handling, отдельное искусственное обрывание сети в браузере не выполнялось.

## Границы результата

Это локальная демонстрация со статическим pack и обычным текстовым редактором. Учебные материалы ALPHA-DOCS не заявлены production API. Внешняя публикация, корпоративный вход и production deployment не входят в поставку. Запущены указанные релевантные тесты; полный набор тестов всех прежних features и корпоративные окружения не проверялись. Обязательства Jira authority и QA verdict не менялись; локальный scope оформлен [ADR-0010](../../docs/adr/0010-local-tech-writing-workspace.md).
