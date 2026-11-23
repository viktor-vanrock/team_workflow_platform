# Контракт команд разработчика

Основной запуск: `prerequisites`, `dev:pilot`, `dev:pilot:up`, `dev:pilot:status`,
`dev:pilot:down`. Диагностика и прочие операции pilot доступны через аргументы `dev:pilot`.

Качество: `format`, `format:check`, `lint`, `lint:fix`, `typecheck`, `build`, `test`,
`architecture`, `contracts:build`, `contracts:openapi`, `ci:project` сохраняются.
CI entrypoints и обязательные aliases feature catalogs сохраняются.

Удалённый alias имеет точный эквивалент `node tools/...`, `pnpm exec nx ...` либо
`pnpm exec vitest/playwright ...`; дополнительные аргументы передаются после команды.
Исторические feature specifications остаются историческими; README указывает таблицу замены.
Обычные runbooks используют существующие команды.

Env-пример не загружается Node автоматически. Pilot `up --plan` не запускает контейнеры.
`down` сохраняет volumes. Документация не выдаёт destructive reset за штатную остановку.
