# Проверка первого корпоративного администратора

Дата: 2026-09-10. Основание: явный запрос пользователя, ADR-0015, конституция 3.0.0. Runtime: Node 24.20.0, pnpm 11.21.0. Реальный корпоративный Keycloak и развёрнутая пользовательская БД не использовались; проверки выполнялись на временных PostgreSQL-контейнерах и независимом локальном OIDC fixture.

## Результаты

- `vitest run tests/integration/019 tests/integration/security/008/corporate-identity.spec.ts tests/integration/security/008/corporate-sessions.spec.ts tests/unit/016/corporate-team.spec.ts --maxWorkers=1`: 39 тестов пройдено. Покрыты конкурентные входы через разные соединения, однократность, рестарт, отзыв, upgrade с действующим/отозванным корпоративным администратором, откат неудачного назначения, SERVICE/чужой issuer, local bootstrap и HTTP вход без групп.
- После добавления проверок ACTIVE в каталоге, DENY и отзыва membership повторно пройдены все 6 тестов `tests/integration/019/corporate-access.spec.ts`.
- `AWP_RUN_CONTAINER_TESTS=true vitest run tests/integration/security/008/corporate-auth-http.spec.ts tests/integration/security/008/corporate-onboarding-http.spec.ts tests/integration/migrations/us2-composition.spec.ts --maxWorkers=1`: 5 тестов пройдено. Legacy fixtures явно отключают provisioning. Устаревшее ожидание состава local migrations обновлено с учётом уже существующего pack:tech-writing 1100.
- `playwright test tests/e2e/019/access-browser.spec.ts --project=chromium --workers=1 --reporter=line`: 5 сценариев пройдено, включая корпоративную админку первого пользователя и ожидание/запрет админки для последующего. Browser fixtures моделируют ответы API; фактическая OIDC/DB авторизация проверена интеграционными тестами выше.
- Корневой `tsc --noEmit --project tsconfig.json`, ESLint изменённых TypeScript-файлов, `pnpm architecture` и `git diff --check`: успешно.
- `VITE_AWP_AUTH_MODE=corporate vite build --config apps/web/vite.config.ts --outDir /private/tmp/awp-corporate-first-admin-build`: успешно. Существующее предупреждение о смешанном static/dynamic import project-dialogue не блокирует сборку.

Всего проверено 44 различных Vitest-теста и 5 браузерных сценариев. Полный набор всех тестов репозитория не запускался. Изменения Jira, уже находившиеся в рабочем дереве, не относятся к этой задаче. Деплой на реальный корпоративный сервер не выполнялся.

## Применение

Core migration 225 → обновление host provisioning/policy → сборка API/web (web: `VITE_AWP_AUTH_MODE=corporate`) → первый корпоративный вход → `/admin/users`. Старый объект настроек групп заменить на `accessProvisioning: true` или убрать этот параметр. Существующие корпоративные администраторы сохраняются, новая установка выбирает первого. Полная инструкция: [корпоративный доступ](../../docs/deployment/corporate-access.md).
