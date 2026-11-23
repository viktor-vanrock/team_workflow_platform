# Binding lifecycle и pilot activation: подключение к pipeline

007/T091 реализована в `apps/api/src/extensions/onboarding/bindings.application.ts`,
`binding-facts.ts`, `bindings.controller.ts` и `onboarding.controller.ts`.
`QaJiraMattermostLocalApiModule` регистрирует обязательный provider
`BINDING_HTTP_APPLICATION` с `DurableBindingHttpApplication`. Публичные команды
защищены `QaSessionGuard`; глобальный WorkspaceContext или тело запроса не заменяют
проверенную identity и текущие права Core.

## Маршруты и порядок вызовов

Префикс: `/v1/workspaces/:workspaceId/projects/:projectId`.
Все POST ниже требуют `Idempotency-Key` и сильный `If-Match: "N"`, где N —
текущая **версия onboarding**, полученная через `GET operations`.
Версия целевого binding находится отдельно в `bindingRef`.

| POST                           | Тело                                                         | Назначение                                                         |
| ------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------ |
| `binding-candidates`           | `operation: publish/retire/rollback`, `bindingRef`, `reason` | Сохранить точного кандидата и его предусловия                      |
| `operations/approvals`         | `candidateRef`                                               | Отдельный workspace owner утверждает кандидата                     |
| `bindings/:bindingId/publish`  | `candidateRef`, `approvalRef`                                | Потребить approval и опубликовать проверенную версию               |
| `bindings/:bindingId/retire`   | `candidateRef`, `approvalRef`                                | Вывести текущую версию из эксплуатации                             |
| `bindings/:bindingId/rollback` | `candidateRef`, `approvalRef`                                | Создать новую DRAFT-версию из PUBLISHED/RETIRED истории            |
| `onboarding/pilot-candidates`  | `reason`                                                     | Подготовить активацию текущего SHADOW onboarding                   |
| `onboarding/activate-pilot`    | `candidateRef`, `approvalRef`                                | Потребить approval, захватить workspace lease и активировать пилот |

Exact ref: `{id, version, contentHash}`. Использовать refs из ответов сервера.
Инициатор — integration administrator; право `integration.publish` для binding
или `project.onboarding.activate` для пилота. Approver — другой workspace owner
с тем же текущим project permission. Обоим нужен проверенный MFA не старше пяти
минут; срок candidate также пять минут. Клиентские `approved`, `stepUp`, actor
или authorization basis не принимаются.

Повтор одинакового ключа и тела возвращает сохранённый receipt после рестарта.
Другое тело с тем же ключом, устаревшая версия или изменившиеся предусловия дают 409. Некорректные заголовки/тело — 400, отсутствие прав/MFA — 403. Внешний текст
ошибки БД не возвращается клиенту. Успех — HTTP 202 с `COMPLETED` либо
`PENDING_APPROVAL`; ответы не кэшируются.

## Что проверяет транзакция

Перед подготовкой и исполнением читаются опубликованные profile/connection/mapping
heads, точные версии и content hashes. Поддержаны формат Core revision, сохраняемый
`TypeOrmIntegrationConfigurationRepository`, и опубликованные runtime documents.
Для Core hash считается по семантическим полям; служебные даты и revision metadata
не включаются в него. Versioned refs без hash разрешаются сервером в exact refs
и фиксируются в candidate.

Публикация требует последнего `VALID` Core `ValidationReport` для целевой версии,
последней immutable functional acceptance от текущего QA lead и текущего QA context.
Validation report проверяется по полям `id`, scope, `subjectKind`, `subjectRef`,
`contentHash`, `status`, `issues`, `createdAt`; acceptance ссылается на hash его
JSON-представления, где дата сериализована как ISO string. Более новый отрицательный
результат исключает использование старого положительного результата.

При публикации прежняя используемая версия переводится в RETIRED, в том числе
при смене binding header. Onboarding получает новую ревизию VALIDATING/MANUAL_ONLY;
прежние gate refs очищаются. Retirement убирает published head. Историческое
содержимое сохраняется. Rollback создаёт новый номер DRAFT без старого validation
report и не меняет текущую опубликованную конфигурацию: далее нужны новая validation,
acceptance, candidate и approval для публикации. Ремонт binding разрешён при
SUSPENDED; он не возобновляет внешние эффекты проекта.

Для pilot activation нужны SHADOW/ACTIVE, актуальная registry revision со статусом
CURRENT и тем же owner set, опубликованный binding/context, validation/acceptance
и последние C1/N2/P3 со статусом PASS и непросроченным `valid_until`.
Gate `subjectRefs` должны включать exact refs текущих onboarding, registry, binding
и QA context; semantic body/hash и столбцы scope/outcome/time должны совпадать.
Новый FAIL после approval блокирует исполнение. Workspace lease другого проекта
блокирует активацию до истечения срока или разрешённого release.

Изменения binding/onboarding, approval consumption, action receipt, lease, audit и
event outbox входят в одну транзакцию. Ошибка audit откатывает все последствия.

## Локальное доказательство

```sh
CI=true AWP_RUN_CONTAINER_TESTS=true pnpm exec vitest run \
  tests/integration/007/us2-binding-http.spec.ts \
  tests/integration/007/us5-project-operations-http.spec.ts --maxWorkers=1
```

Тесты используют настоящий Nest HTTP и PostgreSQL 17.7/18.6: отказ без identity,
MFA/ETag, запрет самоутверждения и подмены вида действия, повтор после рестарта,
конкурирующая публикация, отозванный profile, rollback audit/approval/lease,
новый FAIL gate, занятая lease, замена header, Core-format rollback/republish и resume.
Identity, validation observations и C1/N2/P3 записи в fixture контролируемые.
Это проверка потребления фактов; реальное корпоративное conformance ею не подтверждено.

## Что подключить в реальном pipeline

1. Применить актуальный migration registry (Core 230 / QA 2110). Дополнительной миграции
   для T091 нет; таблицы actions/approvals/binding/onboarding/outbox уже существуют.
2. В corporate API module зарегистрировать `OnboardingController`,
   `BINDING_HTTP_APPLICATION`, `PROJECT_OPERATIONS_HTTP_APPLICATION`, DataSource
   и корпоративную identity. Отсутствие обязательного provider должно останавливать
   запуск. Не переносить локальные persona credentials или fixture gates.
3. Подключить реализованные registration/validation/acceptance/resource endpoints
   T071. Lifecycle adapter потребляет их сохранённые результаты; независимый
   manual onboarding journey T059 закрыт на PostgreSQL 17/18. См.
   [состав поставки, upgrade SQL и CI](manual-onboarding-journey.md).
4. Conformance jobs сохраняют реальные immutable C1/N2/P3 с перечисленными
   exact subjects и сроками. Не копировать PASS из локальной fixture. Владелец
   проекта утверждает конкретный candidate через корпоративный MFA/BFF/CSRF.
5. Подключить consumers `PROJECT_BINDING_CHANGED` и `PROJECT_ONBOARDING_CHANGED`
   к worker outbox. Проверить current effect fences и reconciliation. Отдельные
   worker/process journeys T155/T176 закрыты локально; [smoke и CI](onboarding-compose-smoke.md).
   Corporate composition 008/T025 остаётся открытой.

Общий [deployment checklist](pilot-deployment-checklist.md) содержит инфраструктурные
параметры и шесть задач приёмки реального стенда.
