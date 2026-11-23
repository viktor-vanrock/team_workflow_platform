# Quickstart: Проверка русского интерфейса

## 1. Предварительные условия

```bash
pnpm prerequisites
pnpm install --frozen-lockfile
```

Новые зависимости не требуются.

## 2. Быстрая статическая и типовая проверка

```bash
pnpm exec vitest run tests/architecture/ui-localization.spec.ts --maxWorkers=1
pnpm lint
pnpm typecheck
pnpm --filter @awp/web build
```

Ожидается: архитектурный аудит не находит обычных английских UI-фраз вне allowlist; lint, typecheck и build завершаются успешно.

## 3. UI/SSR-регрессия

```bash
pnpm exec vitest run tests/unit/005/automated-session-executor-ui.spec.ts tests/e2e/005-us4-outage-recovery.spec.ts tests/e2e/006/queue-browser.spec.ts tests/e2e/006/us3-triage-controls.spec.ts tests/e2e/006/us4-capacity-expedite.spec.ts tests/e2e/006/us5-sla-transparency.spec.ts tests/e2e/007/us1-manual-onboarding-ui.spec.ts tests/e2e/007/us2-full-qa-ui.spec.ts --maxWorkers=1
```

Ожидается: русские подписи обнаружены, доменные результаты и контрактные значения не изменились.

## 4. Browser-проверка

При доступном локальном контуре выполнить существующие Playwright-наборы:

```bash
pnpm test:e2e:001
pnpm exec playwright test tests/e2e/acceptance/005-gitlab-human-review-browser.spec.ts --project=chromium --workers=1
pnpm test:browser:006
pnpm test:browser:007
pnpm exec playwright test tests/e2e/008/pilot-readiness-browser.spec.ts tests/e2e/008/pilot-operation.spec.ts --project=chromium --workers=1
```

Проверить минимум shell, QA intake/detail, automation, queue, project onboarding/evidence и pilot screens на настольной и мобильной ширине.

## 5. Ручной аудит остаточного текста

```bash
rg -n --glob '*.tsx' --glob '*.html' 'Loading|Reload|Approve|Create|Project|Workspace|Session|Evidence|Failed|Unavailable|No ' apps/web packages/competency-qa/src/ui packages/platform-ui/src
```

Каждое совпадение должно быть либо машинным значением/внешними данными, либо элементом утверждённого allowlist; обычные пользовательские фразы недопустимы.
