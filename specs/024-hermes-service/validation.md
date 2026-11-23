# Validation: Hermes service

Дата: 2026-09-10. Node 24.20.0; зависимости из существующего pnpm lockfile.

## Выполненные проверки

| Проверка | Результат |
| --- | --- |
| Hermes unit/HTTP/provider/Mattermost/dialogue, регрессия 023, initial workspace 024 и model boundary 008 | 11 suites, 44 tests passed |
| Повтор Mattermost после общего endpoint и проверки отозванного подтверждения | 3 tests passed; входят в предыдущие 44 |
| Окончательный container entrypoint smoke | 1 test passed |
| Root TypeScript check | passed |
| ESLint затронутых TypeScript файлов | passed |
| Architecture dependency graph, включая apps/hermes | passed, 25 projects |
| Local Compose и deployment Compose с Mattermost override | config --quiet passed |
| Docker frozen-lockfile/offline install и frontend build | passed |
| git diff --check | passed |

Основной regression command:

```sh
node node_modules/vitest/vitest.mjs run tests/unit/hermes-service tests/integration/hermes-service tests/unit/023 tests/integration/023 tests/integration/024/initial-qa-workspace.spec.ts tests/unit/008/hermes-model-boundary.spec.ts --maxWorkers=1
```

Образ: `awp-workspace:hermes-024`,
`sha256:91208fdb618d62be37d4d71610b8424226a487444c1c8917abedde92a46a59fd`.
Container smoke запускает настоящий отдельный Hermes и workspace, проверяет readiness,
авторизацию и маршрут `/projects/hermes`.

## Подтверждённые границы

- HTTP bearer authentication, версия/schema/размер ответа и identity hash проверяются;
  wrong secret/readiness, невалидный JSON, лишние поля, отказ сервиса и timeout приводят
  к ожидаемому отказу либо ограниченному локальному резерву.
- Chat Completions fixture проходит реальный HTTP transport. Проверены минимальный
  контекст, отсутствие tools, store=false, 429 и недопустимый ответ. Модель не получает
  Jira credentials, пользовательские роли, историю или RAG-источники.
- Ожидание модели вынесено из DB locks. Отзыв роли при ожидающем ответе не блокируется;
  после ответа API отказывает в записи, исходная версия диалога сохраняется.
- Native form-urlencoded Mattermost вызов создаёт один QA draft. Повтор trigger
  возвращает receipt; другой текст с тем же trigger отклоняется. Общий endpoint выбирает
  channel binding; второй канал с чужой Connection, неизвестный канал, неверный секрет
  и неизвестная identity отклоняются.
- До явного confirm нет Jira-команды. Preview показывает target и поля; подделанное
  подтверждение, изменённая карточка и отозванная identity не создают команду.
  Повтор правильного confirm возвращает одну стабильную durable command identity.

## Пределы проверки

Реальные LLM, Mattermost и Jira не подключались: платных model calls и внешних сообщений
не было. HTTP fixture и временная PostgreSQL подтверждают контракт и постановку команды,
а не доступность реального провайдера или создание issue в рабочей Jira.

Для live smoke оператору нужны согласованные LLM endpoint/model/CIDR и секрет, Mattermost
slash configuration и verified HUMAN mapping, опубликованные Jira/QA bindings и durable
worker. Начальный workspace host без полного Jira runtime сохраняет QA draft и явно
сообщает, что подтверждение Jira недоступно. Инструкция: [Hermes service](../../docs/deployment/hermes-service.md).

Новых миграций нет. Сервис stateless; сохраняемые диалоги, drafts, receipts и команды
остаются в существующей PostgreSQL. Перезапуск отдельного Hermes с ранее созданной
производственной историей остаётся частью операторского live smoke.

Spec Kit requirements checklist: 16/16. Before/after implementation hooks отсутствуют.
