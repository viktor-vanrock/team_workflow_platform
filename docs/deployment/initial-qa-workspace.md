# Первая установка: одна область QA для приёма проектов

[Комплект деплоя](README.md) · [Корпоративный вход](corporate-access.md)

Этот способ запуска создаёт на **пустой выделенной PostgreSQL** одну активную
рабочую область `qa` с названием **QA** и типом работ `qa.validation`.
Проектов, демонстрационных людей, локальных персон и подключений к провайдерам нет.
Первый проверенный вход через корпоративный Keycloak выдаёт одному человеку
`access-administrator` платформы и `system-administrator` области QA.
Он может назначать участников, создавать проекты, просматривать каталог и менять карточки.

API, корпоративный web и BFF сессий поставляются одним образом из
[workspace.Dockerfile](../../infra/deploy/workspace.Dockerfile).
Точка входа — [workspace-main.ts](../../apps/api/src/workspace-main.ts).
Для первого запуска нужны PostgreSQL, Keycloak, HTTPS reverse proxy и отдельный Hermes.
[Подготовьте Hermes](hermes-service.md): LLM, локальный резерв и опциональный Mattermost.
Для исполнения принятых QA-запросов в Jira дополнительно нужен provider-enabled runtime/worker.

Результат регистрации проекта — `DRAFT / MANUAL_ONLY`: это сохранённая карточка
с ответственными, классификацией, историей и правами общей команды. Запуск QA-проверок,
подключение провайдеров, публикация bindings и переход в FULL_QA относятся к следующему
этапу. Полный корпоративный QA runtime по [008/T025](README.md#что-остаётся-до-допуска)
остаётся отдельной работой; готовность этого приложения не означает готовность полного пилота.

## 1. PostgreSQL и учётные данные

DBA создаёт пустую базу `awp_qa` на PostgreSQL 18.6 и применяет в ней
[postgres-roles.sql](../../infra/deploy/postgres-roles.sql).
`awp_qa_migrator` владеет создаваемыми таблицами и выполняет миграции;
`awp_qa_runtime` получает DML и доступ к последовательностям через default privileges.
Runtime не должен быть владельцем схемы/таблиц или superuser.
Пароли задайте через корпоративную доставку секретов: в SQL-шаблоне паролей нет.

Подготовьте отдельный каталог, например `/opt/awp/qa-secrets`, вне репозитория:

| Файл                    | Содержимое                                                                   |
| ----------------------- | ---------------------------------------------------------------------------- |
| `database-migrator.url` | `postgresql://awp_qa_migrator:<URL-encoded password>@<TLS-host>:5432/awp_qa` |
| `database-runtime.url`  | Такой же адрес БД с отдельным пользователем `awp_qa_runtime`                 |
| `database-ca.pem`       | Доверенная цепочка CA PostgreSQL                                             |
| `oidc-client-secret`    | Секрет confidential OIDC client                                              |
| `oidc-ca.pem`           | Доверенная цепочка CA Keycloak                                               |
| `session-keys.json`     | JSON с именованными AES-256 ключами сессий, см. ниже                         |
| `hermes-token`          | Общий secret внутреннего соединения API—Hermes (32+ символа)                 |
| `hermes/config.json`    | Настройки Hermes по [инструкции](hermes-service.md)                          |
| `workspace.json`        | Заполненная конфигурация из следующего раздела                               |

DSN не принимает query/hash: параметры TLS задаются отдельно. Compose использует
`verify-full`: цепочка и имя TLS-сервера должны проходить проверку. Для общедоверенных
сертификатов используйте подходящий системный CA bundle или собственный override без
переменной и mount для CA; проверку сертификата сохраняйте.
Контейнер работает с UID/GID `1000:1000`. Secret delivery должен дать этому UID чтение
нужных файлов, ограничив доступ к каталогу остальным пользователям.

Создание нового ключа сессии в уже защищённом каталоге, без вывода ключа в терминал:

```sh
export AWP_QA_SECRETS_DIR=/opt/awp/qa-secrets
node --input-type=module -e 'import {randomBytes} from "node:crypto"; import {writeFileSync} from "node:fs"; writeFileSync(process.env.AWP_QA_SECRETS_DIR + "/session-keys.json", JSON.stringify({"qa-session-1":randomBytes(32).toString("base64")}) + "\n", {flag:"wx",mode:0o400})'
```

Не перегенерируйте ключ при каждом старте. Для ротации добавьте новый ID, измените
`encryptionKeyId` в конфигурации и сохраните старый ключ как минимум на максимальный
срок живой сессии/незавершённого входа. Все API-реплики используют один набор ключей.
В конфигурации разрешено до восьми ключей по 32 байта.

## 2. Keycloak и конфигурация приложения

Создайте confidential client с Authorization Code / PKCE S256, точным callback
`https://<application-host>/api/v1/auth/callback` и разрешённым web origin приложения.
Приложение использует browser redirect на authorization endpoint, POST на token endpoint
и GET на JWKS endpoint. Пути Keycloak сверяйте с
[официальным описанием OIDC endpoints](https://www.keycloak.org/securing-apps/oidc-layers).

Требования **верификатора этого проекта**:

- Access token содержит `iss`, `sub`, `aud=awp-api` (либо выбранную audience),
  `client_id=awp-browser` (либо выбранный client ID), `jti`, `iat`, `exp`.
  Один `azp` не заменяет `client_id`. IAM настраивает соответствующие audience/claim mappers.
- JWT header `alg` должен входить в `tokens.algorithms`. Пример использует `RS256`
  и vendor discriminator `header.typ=JWT`, `payload.typ=Bearer`; сопоставьте их
  с фактически выдаваемым access token вашего realm. ID token не принимается как access token.
- ID token проверяется по issuer, подписи, audience клиента и nonce. Callback должен
  возвращать `iss`, совпадающий с настроенным issuer.
- Для изменения проектов и прав нужно свежее дополнительное подтверждение входа.
  Настройте реальный MFA flow, `acr`, `amr` и `auth_time` в ID token; значения должны
  совпадать с `session.stepUp`. Фиксированный claim не является доказательством MFA.
  Настройку уровней и AMR mapper описывает
  [Keycloak Server Administration Guide](https://www.keycloak.org/docs/latest/server_admin/#_step-up-flow).
- Шаблон ограничивает время жизни access token и сессии десятью минутами,
  step-up — пятью минутами. Продление происходит новым входом, refresh token в этом host не используется.
  Настройте синхронизацию времени API, БД и Keycloak.

Скопируйте [workspace.config.example.json](../../infra/deploy/workspace.config.example.json)
в `$AWP_QA_SECRETS_DIR/workspace.json`. Замените все placeholders, домены, realm,
client/audience и MFA claims. `network.endpoints.addressRanges` содержит только
одобренные CIDR адресов Keycloak, включая все реально используемые DNS-ответы.
`network.validUntil` — согласованный срок действия сетевой policy в UTC. Истёкшая
policy блокирует новые исходящие обращения; предусмотрите её своевременное обновление.
Приложение не выполняет автоматический discovery или доверие к произвольному URL из токена.

В `session.returnPaths` обязательны `/access`, `/admin/users`, `/projects`, `/projects/new`.
Редактор возвращается из step-up через `/projects` и восстанавливает точный путь из
временного черновика браузера. `session.namespace` должен быть стабильным и уникальным
для этой установки. После изменения policy увеличивайте её `version`.

Из корня проекта, с Node 24.20.0 и pnpm 11.21.0:

```sh
pnpm deploy:workspace:configure "$AWP_QA_SECRETS_DIR/workspace.json"
```

Команда отвергает незаполненный шаблон, проверяет сетевую policy и пересчитывает
content hashes конфигурации. Это не проверка реального OIDC входа; её выполняют после запуска.
Секреты в конфигурацию и web env не добавляются. Корпоративный host отклоняет `LOCAL_FIXTURE`.

## 3. Образ, bootstrap и запуск

Из корня репозитория:

```sh
export AWP_QA_SECRETS_DIR=/opt/awp/qa-secrets
export AWP_WORKSPACE_IMAGE=awp-workspace:reviewed
docker compose -f infra/deploy/compose.workspace.yml build workspace
docker compose -f infra/deploy/compose.workspace.yml run --rm bootstrap
docker compose -f infra/deploy/compose.workspace.yml up -d --no-build workspace hermes
docker compose -f infra/deploy/compose.workspace.yml ps
curl --fail http://127.0.0.1:3000/health/ready
```

В CI публикуйте проверенный образ и задавайте `AWP_WORKSPACE_IMAGE` с его immutable
digest. На целевом хосте вместо build используйте pull этого образа.
Bootstrap, workspace и Hermes должны использовать одну ревизию. Bootstrap запускается отдельно и завершается;
приложение получает только runtime DSN и отказывается стартовать без миграций/области.

Bootstrap применяет полный registry в транзакции миграций и отдельной транзакцией
создаёт QA, регистрацию pack/work type и неизменяемую квитанцию установки.
Два параллельных запуска сериализованы. Повтор с той же квитанцией сохраняет ID,
проекты и права. Чужая непустая установка без квитанции отклоняется: этот шаг не
преобразует локальный стенд в корпоративный и не создаёт администратора задним числом.
Миграции могут уже примениться до такого отказа; восстановление — повтор корректного
шага или проверенный backup/forward migration, без удаления квитанций.

Проверяемый registry: Core **235**, Dummy **1000**, Tech Writing **1100**, QA **2110**,
Jira **3050**, GitLab **4020**. Миграции расширений создают схему, а не запускают провайдеры.
`/health/live` проверяет живой процесс; `/health/ready` — версии схем и активную QA
с включённым типом работ. Ready также проверяет доступность Hermes; не доказывает доступность Keycloak/LLM или право на запуск QA.

## 4. HTTPS и первый вход

Контейнер слушает loopback хоста на порту `3000` (переопределяется
`AWP_WORKSPACE_PORT`). Настройте корпоративный ingress/reverse proxy на общий HTTPS
origin для web и `/api`. Пример для nginx на том же хосте:
[nginx.workspace.conf.example](../../infra/deploy/nginx.workspace.conf.example).
Он сохраняет нужные заголовки и исключает query string из access log, чтобы callback
коды не попадали в журнал. Укажите действующие сертификаты и фактический hostname.
Другой контейнер proxy требует общей Docker-сети и соответствующего upstream.

1. Пока ссылка ещё не передана команде, выбранный администратор открывает `/access`
   и входит через Keycloak. Нельзя выполнять smoke с чужой учётной записью раньше него.
2. После входа видны область **QA**, **«Открыть проекты»**, **«Новый проект»** и
   **«Управлять пользователями и ролями»**. Изначально каталог проектов пуст.
3. Коллеги входят со своими учётными записями и появляются в ожидании. Администратор
   назначает membership, роли и уровень допуска в `/admin/users`.
   Для ведения проектов достаточно `project-registrar`; при назначении общей QA-команды
   выдаются права и на уже существующие проекты согласно роли и классификации.
4. На `/projects/new` укажите ключ, название, пять ответственных, критичность,
   классификацию и причину. В начале один администратор может быть выбран во всех пяти
   позициях. Нажмите **«Подтвердить вход»**, завершите MFA и **«Создать проект»**.
   Черновик и Idempotency-Key сохраняются в этой вкладке на десять минут.
5. Проверьте проект в каталоге и сохраните изменение названия/ответственных через
   редактирование. Карточка сохраняет историю и отвергает устаревшую версию.

Перезапуск и повторный вход не создают второй workspace и не восстанавливают отозванную
роль первого администратора. Глобальная и workspace-роли назначаются в одной транзакции
проверенного входа вместе с audit: при ошибке запись откатывается полностью.

## Проверки и обновление

Перед обновлением сохраните backup БД, ключи и предыдущий image digest. Остановите
приём запросов, выполните bootstrap из нового образа и запустите тот же образ API.
Сохраните прежние секреты и DSN. `down` без удаления БД не сбрасывает установку.
Миграция 235 имеет только forward rollback; предыдущий бинарник с другим schema pin
не считайте совместимым без отдельной проверки.

В репозитории проверяются миграции без superuser, API с DML-ролью, rollback первого
входа, отсутствие демоданных, права коллег, CSRF/step-up, повторы создания,
редактирование и отзыв прав. Browser suite проверяет corporate navigation и
сохранение черновиков при redirect. Команды:

```sh
pnpm exec vitest run tests/integration/024/initial-qa-workspace.spec.ts --maxWorkers=1
pnpm exec playwright test tests/e2e/024/initial-qa-workspace-browser.spec.ts --project=chromium --workers=1
AWP_TEST_WORKSPACE_IMAGE=awp-workspace:reviewed pnpm exec vitest run tests/integration/024/container-entrypoint.spec.ts --maxWorkers=1
```

Container smoke использует собственную временную PostgreSQL и проверяет entry point,
SPA routes, readiness и повтор bootstrap. Без `AWP_TEST_WORKSPACE_IMAGE` этот тест
явно пропускается. Он не подключается к корпоративным системам. Фактический вход/MFA,
TLS, DNS и первый проект проверяются оператором по шагам выше на целевом стенде.
