# Validation

Node 24 и доступный Docker требуются. Существующий local stand не сбрасывать.

1. pnpm exec vitest run tests/integration/022 --maxWorkers=1 — сохранение, история/hash, scope/MFA/owner denial, retry/conflict, upgrade preservation.
2. pnpm exec playwright test tests/e2e/022 --project=chromium --workers=1 — форма/роли/конфликт/мобильная ширина.
3. pnpm typecheck:root; eslint изменённых файлов; node tools/architecture/check-import-graph.mts; pnpm --filter @awp/web build.
4. Регрессии 020/021 и published/corporate onboarding HTTP.
5. До обновления сохранить hashes бизнес-данных и grants. node tools/local/pilot-cli.mts up. Read-only smoke: admin1 открывает editor трёх областей; admin2 своей; остальные не получают edit capability. Сравнить данные и старую историю, проверить ровно узкое добавление разрешения.
6. Положительные mutations выполняются в disposable DB, чтобы не переименовывать реальные локальные проекты ради проверки.
