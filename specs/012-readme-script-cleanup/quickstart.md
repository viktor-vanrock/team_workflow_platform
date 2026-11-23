# Проверка feature 012

Использовать Node 24.20.0, pnpm 11.21.0 и установленные зависимости. Команды из корня.

1. Проверить сокращение scripts относительно исходного package.json и таблицу альтернатив.
2. Проверить существование локальных ссылок README, покрытие всех ключей `.env.example`,
   разрешение pnpm scripts в README и исполняемых потребителях.
3. Проверить инструменты и декларацию локального контура:

   ```sh
   pnpm prerequisites
   pnpm dev:pilot -- up --plan
   docker compose -f infra/compose/docker-compose.local.yml config --quiet
   ```

4. Проверить действующие command/scenario catalogs и документацию:

   ```sh
   node tools/verification/feature-008-command-catalog.mts --check
   pnpm format:check
   pnpm lint
   pnpm typecheck
   ```

5. При доступном окружении полный запуск проверяется по README: `pnpm dev:pilot:up`,
   `pnpm dev:pilot:status`, health endpoints, вход под `Заказчик · ALPHA`,
   `pnpm dev:pilot -- logs`, `pnpm dev:pilot:down`. Существующие чужие контейнеры не останавливать.

Ожидается отсутствие новых сломанных ссылок/команд и изменений поведения runtime.
Фактически выполненные проверки и ограничения записываются в `validation.md`.
