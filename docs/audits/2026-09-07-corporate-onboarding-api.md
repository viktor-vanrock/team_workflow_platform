# Локальный этап 008/T025: корпоративный onboarding API

Подключён `CorporateOnboardingModule` к `PilotNonLocalApiModule`: corporate BFF,
registry/resources/validation/bindings/project operations/reads/evidence services.
У модуля явные session, account inventory и evidence crypto dependencies.

Исправлены найденные при соединении компонентов ошибки:

- повторная корпоративная авторизация отклоняла допустимый target principalId;
- GET/HEAD interaction требовала CSRF как изменяющий запрос;
- повторная проверка прав внутри транзакции могла вернуть роли, исключённые IdP;
- corporate authorization не учитывала актуальную остановку в onboarding head;
- blanket suspension запрещала внутренние recovery/evidence операции;
- remote signer не возвращал обязательный `schemaVersion` envelope;
- evidence application передавала request callbacks/operation fields в scope
  криптографической фабрики, что ломало сборку реального корпоративного signer.

Проверено 218 уникальных тестов в 45 файлах, без оставшихся failed/skipped/todo.
Это объединение финальных результатов regression suite и точечного повторного
запуска трёх evidence/onboarding suites после последних исправлений. Первоначальные
неудачные запуски сохранены; результат не выдается за единый полный CI run.
Пройдены root TypeScript, ESLint изменённых файлов, import graph (24 проекта),
проверка реестра (204 схемы, 19 YAML documents) и `git diff --check`.

Новые сквозные сценарии используют PostgreSQL 17.7/18.6, настоящий Nest host,
OIDC Authorization Code/PKCE, durable cookie sessions и `CorporateEvidenceSigner`
с независимым Vault HTTP fixture. Проверены registration/replay, grants другому
человеку, запреты IdP/CSRF/actor substitution, step-up/rotation, suspension,
incident disposition, signed/tampered evidence, экспорт без дубля, restart,
offline verification при signer outage и membership revocation.
IAM, исходный Work Item и manifest — контролируемые входы теста, а не результат
корпоративного QA/worker процесса.

Машинный отчёт, исходные результаты и SHA-256 привязки:
[`reports/project/corporate-onboarding-api.json`](../../reports/project/corporate-onboarding-api.json).
Точные точки подключения и настройка IAM/Vault/inventory:
[инструкция внедрения](../runbooks/corporate-onboarding-api.md).

В основном реестре остаётся 1342/1349 закрытых задач: 008/T025 локально и
T040/T057/T084/T104/T105/T106 для корпоративной приёмки. Выполненный API-этап
отмечен в deployment checklist; сама T025 не закрыта. Общие QA/intake/queue
factories, реальный domain worker, corporate entry point/release images и
provider effect journey остаются обязательствами. Полные ci:project/ci:008,
Compose smoke и корпоративные C1/N2/P3 в этом запуске не выполнялись.
