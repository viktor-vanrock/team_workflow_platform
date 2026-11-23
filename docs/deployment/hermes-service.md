# Hermes: сервис, LLM и Mattermost

[Первая установка](initial-qa-workspace.md) · [Mattermost intake](../runbooks/mattermost-hermes-intake.md)

Hermes поставляется отдельным процессом `@awp/hermes` в общем reviewed образе workspace.
В первой версии он помогает создавать проекты и QA-запросы, отвечает по явной карточке
проекта и поддерживает подтверждение создания Jira в Mattermost. **RAG, embeddings,
поиск по документам и общая память переписки в первой версии отсутствуют.**

Hermes не получает PostgreSQL, Jira, Mattermost или пользовательские credentials.
API проверяет права, передаёт ограниченный snapshot и сохраняет результат. LLM выдаёт
только предложение; отдельный Jira Connector выполняет подтверждённую команду через
существующую durable-очередь. Полный pilot/Jira runtime нужен для исполнения в Jira;
первая установка сохраняет проекты и QA-черновики и без него.

## Первый запуск

В каталоге `$AWP_QA_SECRETS_DIR` создайте `hermes-token`: случайный секрет минимум 32
печатных символа. Один и тот же файл читают workspace и Hermes. UID 1000 должен иметь
доступ к файлам; секреты не включайте в image или git. Пример генерации без вывода:

```sh
node --input-type=module -e 'import {randomBytes} from "node:crypto"; import {writeFileSync} from "node:fs"; writeFileSync(process.env.AWP_QA_SECRETS_DIR + "/hermes-token", randomBytes(32).toString("base64url") + "\n", {flag:"wx",mode:0o400})'
mkdir -p "$AWP_QA_SECRETS_DIR/hermes"
```

Для начальной проверки положите в `hermes/config.json`:

```json
{ "mode": "deterministic" }
```

Этот режим явно виден в readiness. Для LLM замените файл по
[hermes.config.example.json](../../infra/deploy/hermes.config.example.json).
Укажите согласованные endpoint, model, CIDR всех DNS-ответов, срок и версию сетевой
policy, отдельный `model-token` и при необходимости `model-ca.pem`. CA-поле можно убрать
для публично доверенного сертификата. В контейнере все эти файлы доступны только Hermes
под `/run/hermes`; API их не получает. Исправьте примерные значения и hash policy.
Ошибочная выбранная конфигурация блокирует запуск, отсутствующая модель во время работы
даёт локальный резерв. Production-adapter требует HTTPS и не следует redirect.
Поддерживается JSON Chat Completions: model, messages, response_format=json_object,
max_completion_tokens, store=false. Совместимость проверьте на выбранном шлюзе по
[описанию протокола](https://developers.openai.com/api/reference/resources/chat).

```sh
docker compose -f infra/deploy/compose.workspace.yml build workspace
docker compose -f infra/deploy/compose.workspace.yml run --rm bootstrap
docker compose -f infra/deploy/compose.workspace.yml up -d --no-build workspace hermes
docker compose -f infra/deploy/compose.workspace.yml ps
docker compose -f infra/deploy/compose.workspace.yml exec hermes node -e "fetch('http://127.0.0.1:3020/health/ready').then(async r=>{console.log(await r.json());process.exit(r.ok?0:1)})"
```

Hermes не публикует порт хоста. API обращается к `http://hermes:3020` с отдельным
секретом и ограничением 3 секунды; модель ограничена 2 секундами. HTTP-разрешение
внутреннего клиента ограничено hostname `hermes` и loopback; другие адреса требуют HTTPS.
Workspace readiness учитывает Hermes. При его отказе API остаётся живым, а сообщение
обрабатывается локально. Liveness остаётся отдельной проверкой. Не прекращайте доступ
ко всем ручным операциям только из-за отказа вспомогательной зависимости.

В локальном Compose Hermes включён автоматически; используется явно локальный секрет и
локальный алгоритм. Внутренняя сеть не выпускает запросы в интернет. Для реальной LLM
используйте deployment compose с согласованной сетевой policy.

## Роль в Mattermost

Настройте slash-команду `/hermes` в нужной Mattermost team.
Request URL: `https://<workspace-host>/api/v1/hermes/mattermost`;
метод POST; ответ JSON. Настройте имя ответа Hermes. Используется штатный секрет
команды Mattermost, не пользовательский access token. [Настройка custom commands](https://developers.mattermost.com/integrate/slash-commands/custom/).

Команда жёстко привязана к team/channel/project; один канал не может обозначать два
проекта. `/hermes` из неподключённого канала отклоняется. Проект выбирается по точным
team/channel ID, а не тексту или имени канала. Для нескольких проектов одной team добавьте
отдельные bindings с общим секретом slash-команды и project-scoped Connection.
Можно дополнительно ограничить endpoint одним binding: `/mattermost/<binding-key>`.
`/awp create` продолжает открывать OIDC continuation.

В API mount передаётся каталог `hermes-mattermost` с `config.json` по
[примеру](../../infra/deploy/hermes-mattermost.config.example.json) и отдельными
slash-token файлами. Подключите override:

```sh
docker compose -f infra/deploy/compose.workspace.yml -f infra/deploy/compose.hermes-mattermost.yml up -d --no-build workspace hermes
```

Дополнительно необходимы:

- Опубликованная Mattermost Connection, относящаяся к этому проекту.
- Проверенная `external_principal_bindings`: workspace + connection + provider namespace +
  неизменяемый Mattermost user ID → HUMAN платформы. Статус VERIFIED, evidence и verified_at;
  сопоставление по username/email и самозаявленный principal не допускаются.
- Текущие Workspace membership, Project Entitlement и права `work-item.read`,
  `qa.request.create` / `qa.request.confirm` по операции. Сервис не получает эти человеческие роли.
- INTERNAL/PUBLIC контекст. Более закрытые проекты в первой версии не передаются модели.
- HTTPS reverse proxy, отсутствие логирования тела slash-запроса, ограничение доступа к
  секрету команды. Ротация секрета аннулирует ранее выданные подтверждения.

## Команды

- `/hermes ask <вопрос>` — личный ответ по карточке проекта, исходной причине регистрации,
  стадии/режиму QA и количествам опубликованных окружений/чек-листов. Другие документы
  не подгружаются; при нехватке фактов Hermes должен сообщить об этом.
- `/hermes test <описание проверки>` — сохраняет QA Intake Draft выбранного канала,
  показывает номер/недостающие сведения. Тип по умолчанию — feature-validation, модель
  может предложить другой известный тип. Классификацию определяет API, не модель.
- `/hermes preview <draft-id>` — проверяет авторство и право подтверждать, показывает
  конкретные Jira project/issue type, поля и выдаёт одноразовую команду на 10 минут.
- `/hermes confirm <выданное подтверждение>` — повторяет проверки, сверяет карточку,
  project/identity/configuration snapshots и ставит одну команду request.create в outbox.
  Возвращает ID и фактическое состояние команды; создание Jira ещё может выполняться worker.

Без настроенных Jira profile, QA policy, response channel resolver и durable worker
preview сообщает о недоступности. Черновик сохраняется. Это не фиктивный принятый Work Item.
Первая workspace-сборка не регистрирует полный Jira runtime: для исполнения используйте
provider-enabled host с `QA_INTAKE_CONFIGURATION` и действующими bindings.

Ответ всегда `ephemeral` автору, включая подтверждение. Произвольный `response_url`
игнорируется; Hermes не отправляет отдельный POST и не публикует в общий канал. Успешный
повтор slash trigger возвращает receipt; изменённый текст с тем же trigger отклоняется.
Повтор confirm не создаёт дубль. Новая карточка/настройка/identity или истёкшее время
требуют нового preview. Существующие signed dialog/post-action contracts не меняются.

## Проверка и восстановление

Запустите `pnpm exec vitest run tests/unit/hermes-service tests/integration/hermes-service --maxWorkers=1`.
Проверка образа: `AWP_TEST_WORKSPACE_IMAGE=awp-workspace:hermes-024 pnpm exec vitest run tests/integration/024/container-entrypoint.spec.ts --maxWorkers=1`.

Перезапускайте `hermes` отдельно: он stateless. Истории, QA-черновики, receipts,
аудит и команды остаются в PostgreSQL. Не удаляйте БД или ключи при обычном рестарте.
В логах сохраняются только безопасные startup/failure коды; модели/источники проверяются
по schema и request hash. Реальные LLM, Mattermost и Jira проходят отдельный smoke после
предоставления согласованных endpoint/credentials. Локальный тест не доказывает их доступность.
