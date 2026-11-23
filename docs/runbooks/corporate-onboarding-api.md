# Корпоративный onboarding API: подключение и локальное доказательство

Версия: 2026-09-07. Это выполненная часть 008/T025. Полная сборка QA/intake/queue,
domain worker и release images остаётся в [deployment checklist](pilot-deployment-checklist.md).

## Что подключено

`apps/api/src/extensions/onboarding/corporate-onboarding.module.ts` собирает
durable registry, resources, validation, bindings, project operations, project
reads и evidence HTTP services. `PilotNonLocalApiModule.register` подключает
этот модуль через `onboarding`. Auth BFF, onboarding и Pilot используют одну
корпоративную сессию и один `CorporateQaHttpIdentity`. Одновременные `identity`
и `onboarding` отвергаются при сборке (`PILOT_NON_LOCAL_IDENTITY_AMBIGUOUS`).

Доступны опубликованные `/api/v1/workspaces/:workspaceId/projects/...`,
существующие `/v1/workspaces/:workspaceId/projects/...`, project reads и
`/v1/workspaces/:workspaceId/projects/:projectId/evidence/...`.
Auth BFF находится в `/api/v1/auth/{login,callback,session,logout}`.
Маршрутов локальных персон этот модуль не устанавливает.

## Что передать из корпоративного entry point

В `bootstrapApi(telemetry, nonLocal)` из `apps/api/src/main.ts` передать один
инициализированный `DataSource`, approved deployment startup/connector factories
и `nonLocal.api` со следующими зависимостями:

| Поле                               | Источник и требования                                                                                                                                                                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onboarding.sessions`              | `createCorporateSessionBindings(...)` из `packages/runtime-composition/src/security/corporate-session-bindings.ts`; тот же DataSource, mode `CORPORATE`, утверждённые issuer/audience/JWKS/client/callback, группы, session policy, encryption key provider, pinned network и workload credentials |
| `onboarding.accountInventory`      | `AccountInventoryPort.slots(scope, pool)`; разрешённый inventory для exact scoped pool/resolver. Возвращает opaque account refs, а не пароли. Отсутствие inventory останавливает сборку модуля; неизвестный pool должен завершаться отказом                                                        |
| `onboarding.evidenceCrypto(scope)` | Для каждого проекта вернуть `signManifest`, `verify`, exact `redactionPolicyRef` и `exportPolicyRef`. Для подписи использовать `CorporateEvidenceSigner` с Vault client и текущей SERVICE authority; для проверки — неизменяемую публичную историю ключей                                          |
| `evidenceImport`, `readinessQuery` | Существующие обязательные Pilot services с текущими scoped authority/published refs. Их production assembly остаётся ответственностью полного host                                                                                                                                                 |
| `pilotRuns`                        | Явный Pilot run service, если host предоставляет эти операции                                                                                                                                                                                                                                      |

Пример формы уже поддержанного аргумента (имена `approved...` обозначают
зависимости корпоративной сборки, которые необходимо реализовать/настроить):

```ts
await bootstrapApi(approvedTelemetry, {
  source,
  composition: { startup: approvedStartup, connectorFactories: approvedConnectors },
  api: {
    onboarding: {
      sessions: corporateSessionBindings.sessions,
      accountInventory: approvedAccountInventory,
      evidenceCrypto: resolveApprovedEvidenceCrypto,
    },
    evidenceImport: approvedEvidenceImport,
    readinessQuery: approvedReadinessQuery,
    pilotRuns: approvedPilotRuns,
  },
});
```

`createCorporateSessionBindings` устанавливает
`TypeOrmCorporateScopedAccessRepository`: он учитывает текущий
`project_onboarding_headers.current_operational_state` вместе с registry state.
Корпоративный host должен применять общие миграции onboarding перед запуском.
Для старого проекта без onboarding head сохраняется существующее registry state;
его onboarding endpoints всё равно требуют существующий aggregate.

Публичные ключи хранить вне эфемерного контейнера, с изоляцией по проекту и
неизменяемыми версиями. `verify` должна работать при недоступном Vault.
`signManifest` возвращает полный envelope по
`urn:awp:schemas:007:evidence-signature-envelope:v1`, включая `schemaVersion: 1`
и пересчитанный `contentHash`; `CorporateEvidenceSigner` теперь делает это сам.
Evidence application передаёт фабрике только `{workspaceId, projectId}`:
request callbacks и параметры конкретной операции не попадают в конфигурацию
signer и не меняют каталог публичных ключей.
Export/redaction refs должны совпадать с текущим published QA context.
Поддерживаемый экспорт — JSON с opaque refs; ZIP отклоняется существующим API.

## IAM и браузерный сценарий

1. Настроить HTTPS browser origin/callback и OIDC Authorization Code + PKCE.
   BFF хранит encrypted session в PostgreSQL, cookie — HttpOnly/SameSite/Secure.
2. Создать действующее workspace membership и Core roles/permissions.
   IdP mapping должен разрешать точные workspace/project IDs и фактические
   `role_key`. Группы сужают права Core и не создают entitlement.
3. Для регистрации нужны `workspace-owner`, `project.register` и отдельный
   успешный step-up через `POST /api/v1/auth/login` с `stepUp: true`.
   Обычный login с MFA claims сам по себе не считается этим подтверждением.
4. POST-запросы отправлять с cookie, разрешённым `Origin`, актуальным
   `X-CSRF-Token`, idempotency key и strong If-Match, где он требуется контрактом.
   GET/HEAD используют cookie без требования CSRF; cross-site запросы запрещены.
5. После регистрации включить выданный project UUID в новую утверждённую версию
   group policy, изменить её exact ref вместе с session policy и выполнить новый
   login. Регистрация не расширяет allowlist автоматически. До подключения
   нового UUID чтение проекта возвращает безопасный 404.
6. При выдаче entitlement `principalId` обозначает получателя. Actor берётся
   только из сессии. Исключение разрешено лишь обработчикам, отмеченным серверным
   `TargetPrincipalCommand`; `actorId`, roles и authorization basis в теле
   запроса остаются запрещены. Транзакционная проверка не возвращает роли,
   исключённые IdP mapping.

Отдельный step-up требуется также для grant/revoke, suspend/resume,
integration publish/retire, pilot activation и evidence export. Для suspended
проекта разрешены только текущие HUMAN maintenance permissions
`project.suspend`, `project.resume`, `qa.evidence.verify`, `qa.evidence.export`
в классе внутренних MUTATE. Все EFFECT, SERVICE maintenance и остальные
изменения запрещены. Resume по-прежнему требует актуальные incident/probe facts,
точный candidate и отдельного approver; разрешение HTTP не заменяет эти проверки.

## Проверка локально и в CI

```sh
AWP_RUN_CONTAINER_TESTS=true pnpm exec vitest run \
  tests/integration/security/008/corporate-onboarding-http.spec.ts \
  tests/integration/008/corporate-signing.spec.ts \
  tests/unit/007/us3-authorization-policy.spec.ts --maxWorkers=2
```

Сценарий запускает именно `PilotNonLocalApiModule`, PostgreSQL 17.7/18.6,
независимые HTTP OIDC и Vault fixtures. Приложение проходит настоящий
callback/PKCE/session flow. Регистрация, выдача прав другому человеку,
остановка, incident disposition и export идут через HTTP и durable services.
Исходные IAM/work-type/Work Item/manifest records — контролируемые входные
данные теста; remote signer действительно вызывает HTTP Vault fixture.

Проверяются CSRF, step-up/rotation, запрещённые IdP roles, явное подключение
нового project ID, подмена actor, signed/tampered evidence, запрет обычных
изменений при suspension, повторный экспорт без дубля, cookie/экспорт после
рестарта, offline verification при outage signer и немедленный отзыв membership.
Результат и исходные логи: `reports/project/corporate-onboarding-api.json`.

Тест уже входит в `identity-security-boundaries` команды
`verify:008:foundation` по пути `tests/integration/security/008`; отдельный
GitLab job для обнаружения теста не требуется. Lint новых providers добавлен
в тот же checkpoint. Полный `ci:project`/`ci:008`, Compose smoke и реальная
корпоративная приёмка этим точечным прогоном не подменяются.

Следующий этап T025: подключить остальные QA/intake/queue providers и десять
domain worker contributions, затем доказать HTTP → command → worker → один
provider effect после restart и запустить release images без исходного workspace.
