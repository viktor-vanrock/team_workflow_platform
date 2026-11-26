# Входные данные dev worker для Vault

Шаблоны намеренно не проходят проверку: `null` и `<...>` нужно заменить
согласованными значениями. Они не содержат токенов. Храните заполненные значения
в Vault, а не в git. Путь доставки в манифесте — KV
`rndml/team-workflow-platform/workspace`, поля перечислены в
[workspace-fields.example.json](workspace-fields.example.json). Два поля с JSON
должны содержать **JSON-текст строкой**, не вложенный объект: Vault Agent пишет
содержимое в файл, а worker читает его как JSON. Обновляйте поля в существующей
KV-записи с сохранением остальных полей; токены не включайте в JSON конфигурации.

## DeploymentPolicy

[deployment-policy.example.json](deployment-policy.example.json) повторяет
[общий шаблон](../templates/deployment-policy.template.json). В Vault поле
`AWP_DEPLOYMENT_CONFIG` содержит его заполненный JSON-текст, а не путь к файлу.
Полный набор верхних полей обязателен: идентификатор и версия deployment,
workspace и список проектов, профиль, digest, `artifactMode`, `connectorBindings`,
`endpoints` и девять полей `*Ref`. Для dev нужны `integration` или `pilot`,
`non-local`, `NON_PROD`, composition из values, и `GITLAB_ONLY`. Для каждого
ref используются `id`, `version`, `contentHash`; refs берутся из согласованных
действующих публикаций AWP, а не выдумываются. Три connector binding refs —
для jira, gitlab и mattermost. Адреса endpoint и их origin предоставляют владельцы;
для non-local требуется HTTPS. Все поля и проверки:
`packages/runtime-composition/src/pilot/deployment-config.ts:15`, `:128`, `:200`;
фактические текущие публикации и область проверяются
`packages/runtime-composition/src/pilot/published-deployment-references.ts:110`.
`imageDigest` должен совпасть с полем `AWP_RUNTIME_IMAGE_DIGEST` и с реально
развёрнутым образом. Полный набор допусков и endpoint не определяется одним JSON.

## Corporate Vault config

[corporate-vault-config.example.json](corporate-vault-config.example.json) —
пример **для одного проекта**, намеренно без полных маршрутов и без валидных refs.
Для каждого проекта deployment нужны ровно три записи с `JIRA`, `GITLAB`,
`MATTERMOST`. Для каждого нужны `grant.binding`, `integrationBindingRef`,
`serviceIdentity`, `permissions` и `credentials`. Service identity, разрешения,
binding/profile/connection refs и их области подготавливают разработчик и
администратор проекта; права реально выдаются отдельно через IAM AWP, а не JSON.
GitLab `numericProjectId` — положительное число от владельца GitLab. Список
routes — только пример: его дополняют минимальными согласованными маршрутами
для всех операций. Проверки: `packages/runtime-composition/src/security/corporate-vault-config.ts:23`,
`:73`, `:145`, `:161`, `packages/runtime-composition/src/pilot/connector-factories.ts:115`.

Верхние `schemaVersion`, `deploymentPolicyHash`, `vault`, `connectors` обязательны.
Hash — `pilotContentHash` разобранного DeploymentPolicy. Все поля `vault` в
шаблоне обязательны; origin, namespace, authMount, роль и доступный файл JWT
согласует Vault/платформенная команда, временные пределы — владелец установки.
`vaultOrigin` совпадает с `allowedOrigin` endpoint `vault` в DeploymentPolicy.

Каждый `credentials` содержит `credential.authentication`, `credential.mapping`
и `approvedMappingHash = pilotContentHash(mapping)`; сам mapping содержит все
показанные поля, в том числе точные `ref` и `use`. Разработчик согласует
`secretRef` с connection, а Vault owner сообщает `mount`, `path`, `field` и
положительный номер `secretVersion`. Срок `maximumLeaseMs` — 1–60000 мс. Для
каждой цели нужны отдельные secretRef и отдельные mount/path/field; текущая
фабрика не допускает их повторного использования в одном binding. `CONNECTOR_READ`
и `CONNECTOR_WRITE` в примере — разные разрешения, а не два имени одного секрета.
Проверки формата и чтение: `packages/runtime-composition/src/security/vault-secret-resolver.ts:115`,
`:155`; сверка использования и hash: `corporate-vault-connectors.ts:52`;
назначения для целей и аутентификации: `connector-factories.ts:175`, `:210`.
Поля KV со значениями не пустые строки: Jira `JIRA_BASIC` — `username:token`,
`BEARER` — токен, Mattermost — `BEARER`, GitLab read — `GITLAB_PRIVATE_TOKEN`,
write — `GITLAB_TRIGGER_TOKEN`, webhook — `STANDARD_WEBHOOK_HMAC`. Значения
токенов добавляет владелец соответствующей системы в Vault, отдельно от этого JSON.
Права чтения Vault нужны непосредственно worker через Kubernetes auth.

## Issuer и audience

В текущем workspace они лежат в JSON `WORKSPACE_CONFIG` в полях `tokens.issuer`
и `tokens.audience`: пример `infra/deploy/workspace.config.example.json:2`,
реальный файл поступает из Vault через `envs/workspace-advosd-dev.yaml`.
Для worker использовать те же значения **если команда IAM подтверждает общий
realm и audience**: в манифесте это отдельные поля Vault `AWP_IDENTITY_ISSUER`
и `AWP_IDENTITY_AUDIENCE`, не чтение этих полей автоматически из workspace JSON.
Реальные значения в репозитории не видны. Issuer должен точно совпасть с URL
endpoint `identity` в DeploymentPolicy; audience обязателен, но не сравнивается
здесь с workspace: `packages/runtime-composition/src/pilot/deployment-config.ts:250`.

## Digest образа

CI `build_workspace` собирает образ Kaniko из `infra/deploy/workspace.Dockerfile`
(`.gitlab-ci.yml:70`), а `get_version` пишет tag из commit и pipeline IID
(`.gitlab-ci.yml:44`). В имеющемся проектном job не видно файла digest или способа
его передачи worker: внешняя `.kaniko` реализация находится в отдельном CI-шаблоне.
Владелец CI должен выяснить реальный tag/registry и получить **manifest digest
именно опубликованного образа**, например `crane digest <repository>:<tag>` при
наличии `crane` и доступа к registry, либо через digest artifact Kaniko, если
внешний шаблон его создаёт. Сверить с фактическим `imageID` pod в целевом
кластере, учитывая возможную разницу index/manifest для multi-arch. Не брать
commit SHA или hash Dockerfile за digest. Записать подтверждённый
`sha256:<64 lowercase hex>` в `AWP_RUNTIME_IMAGE_DIGEST` и `imageDigest` policy;
доставку при каждом новом релизе и совпадение нужно автоматизировать и проверить.
Проверки: `packages/runtime-composition/src/pilot/deployment-config.ts:143`,
`packages/runtime-composition/src/pilot/corporate-startup-composition.ts:19`.

## Публикации AWP и fence

Это подготовка команды приложения, а не наполнения Vault девопсом. Для запуска
worker нужны девять актуальных публикаций policy/input package и три provider
`CONNECTOR_BINDING` в `runtime_configuration_headers`/`runtime_configuration_revisions`,
с полным совпадением проектного scope, текущей версией, сроком и content hash;
список читается `published-deployment-references.ts:26`, проверяется `:110`.
Разработчик с владельцами Security, IAM, Jira, GitLab, Mattermost и QA готовит
документы и C1; уполномоченный администратор AWP должен публиковать их с аудитом,
проверкой полномочий и CAS. `RuntimeConfigurationRepository.publish` — внутренняя
низкоуровневая функция, которая прямо требует внешней авторизации
(`packages/platform-persistence-typeorm/src/runtime-configuration.repository.ts:131`);
не является готовой CLI/API публикации. В найденных `tools/deploy` и onboarding
маршрутах готового корпоративного bootstrap, публикующего весь набор, нет.
Шаблоны и локальный Jira seed не создают корпоративные policy и не подтверждают C1.
Для надёжной первичной публикации потребуется отдельная заметная разработка
авторизованного bootstrap/административного API; здесь её не выполняем.

Integration/onboarding API создаёт и согласует проектные integration revisions;
это не автоматическая публикация перечисленных runtime policy. После подготовки
проектных данных, gate evidence и работающей корпоративной API-сборки
уполномоченный оператор создаёт `pilot/fence-candidates`, второй человек
согласует через `operations/approvals`, оператор выполняет `pilot/fence-publications`
(`apps/api/src/extensions/pilot/pilot.controller.ts:138`, `:151`, `:184`;
`docs/deployment/corporate-qa-host-config.md:72`). Fence требует живую регистрацию
конкретного экземпляра worker и gate/approval данные. Изменение экземпляра требует
актуализации fence; для provider writes без него доступ закрыт. Текущий
`start:workspace` запускает первоначальный workspace host, а не корпоративный QA
host с этими маршрутами (`apps/api/src/workspace-main.ts:23`); готовый корпоративный
API нужно отдельно подключить и развернуть. Bootstrap workspace в текущем deploy
не выполняет эти публикации. Предыдущие разделы описывают данные, не утверждают,
что публикация или стенд уже готовы.

## Заявка DevOps

В `rndml/team-workflow-platform/workspace` добавьте подготовленные командой поля
`AWP_DEPLOYMENT_CONFIG`, `CORPORATE_VAULT_CONFIG`, `AWP_IDENTITY_ISSUER`,
`AWP_IDENTITY_AUDIENCE`, `AWP_RUNTIME_IMAGE_DIGEST`; сохраните уже имеющиеся
`DATABASE_URL` и `WORKSPACE_CONFIG`. Согласуйте с владельцами и разместите токены
Jira, Mattermost и GitLab в отдельных KV v2 путях; сообщите нам пути, имена полей
и номера версий без передачи значений в git. Разрешите service account `vault`
в namespace `d-rndml-infra` входить в Vault и читать назначенные пути. Откройте
worker исходящий DNS и TCP к PostgreSQL, Vault, Keycloak, Jira, GitLab, telemetry
и `mm.sberdevices.ru:443`; реальные адреса и порты уточните у владельцев.
Сообщите, нужен ли корпоративный CA, и при необходимости предоставьте CA-файл.
Помогите получить и передавать digest опубликованного образа для каждого релиза.
