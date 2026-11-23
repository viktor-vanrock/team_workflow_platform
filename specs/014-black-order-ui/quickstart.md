# Quickstart validation: «Чёрный орден»

Используйте Node 24.20.0 и pnpm 11.21.0 из README. Установленные зависимости уже присутствуют в workspace.

## Автоматические проверки

```bash
pnpm exec playwright test tests/e2e/013/workspace-browser.spec.ts tests/e2e/014/black-order-browser.spec.ts --project=chromium --workers=1
pnpm typecheck
pnpm architecture
pnpm exec vitest run tests/architecture/ui-localization.spec.ts tests/unit/009 --maxWorkers=1
pnpm lint
pnpm format:check
pnpm exec nx run web:build
```

Browser suites запускают Vite с HTTP fixtures, не требуют Docker, VPN или корпоративных credentials. Набор 014 проверяет выбранную тему, контраст основных ролей текста/контролов, native select, узкий экран и отсутствие удалённых ресурсов оформления.

## Проверка в локальном pilot

```bash
pnpm dev:pilot:up
```

Откройте `http://localhost:55173`: войдите как заказчик ALPHA, перейдите в новый запрос, заполните название, проверьте резюме и отправьте. Проверьте выбранный запрос, очередь и дополнительные предложения Hermes. Смените роль для каталога/настроек проекта. Ожидается тема «Архив ордена», сохранные labels/permissions и понятные состояния.

Воспроизводимый итог, снимки и ограничения записываются в [validation.md](validation.md). API и сохранённые данные не мигрируют.
