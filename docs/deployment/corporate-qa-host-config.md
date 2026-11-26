# Конфигурация corporate QA API

`bootstrapCorporateQaApplication` читает JSON по `AWP_CORPORATE_QA_CONFIG_PATH` только
для `NON_PROD` и `non-local`. Текущий workspace host и локальный pilot этот файл не читают.
Файл содержит только идентификаторы и ссылки, без токенов, паролей или ключей.

Верхний уровень содержит `schemaVersion: 1`, `deploymentPolicyHash` (результат
`pilotContentHash` от разобранной `AWP_DEPLOYMENT_CONFIG`), массивы `readinessPins`,
`dodPins`, `defectPins`, `completionPins` и `stepUpPermissions`. Каждый массив pins
содержит ровно одну запись на проект deployment. Форма каждой записи определяется
соответственно типами `QaReadinessPins`, `QaDodPolicyPins`, `QaDefectPublicationPins`
и `QaCompletionPins` в `packages/runtime-composition/src/pilot/`.
Шаблон структуры: [corporate-qa.config.example.json](../../infra/deploy/corporate-qa.config.example.json).
Все `REPLACE_*` — обязательные к замене примеры; это не рабочая конфигурация стенда.

Политики и конфигурации нельзя выбирать из HTTP-запроса. Перед формированием команды
API сверяет опубликованные версии binding/profile/connection и QA context с pins,
проверяет содержание и активность проекта. Policy hash связывает файл с deployment,
но сам по себе не является подписью или подтверждением его происхождения: доставка и
изменение файла должны быть ограничены доверенным оператором.

Без подключённого resolver подтверждённого канала используется явное состояние
`MISSING`: оно не выдаёт себя за проверенный Platform Web канал. Это оставляет
соответствующее условие готовности QA незавершённым.

Этот файл пока не обеспечивает полноценный standalone host: его вызывающий код должен
предоставить корпоративную сессию, network/secret authorization, telemetry и остальные
обязательные зависимости. Значения Vault credentials в этот файл не включаются.

`startCorporateQaHost` инициализирует источник данных и корпоративную сессию из
существующей конфигурации workspace и сверяет issuer, audience, browser origin и
callback с non-local deployment. Он загружает опубликованную сетевую policy и передаёт
один `PinnedNetworkTransport` адаптерам; при необходимости внутренний CA задаётся через
путь `AWP_CORPORATE_CA_PATH`. Telemetry собирается из опубликованной policy и пользуется
pinned DNS lookup. Пути к файлам клиентского сертификата и закрытого ключа mTLS
задаются абсолютными путями `AWP_TELEMETRY_CLIENT_CERT_PATH` и
`AWP_TELEMETRY_CLIENT_KEY_PATH`; содержимое файлов не включается в конфигурацию и
не выводится в лог. Host создаёт `GitLabPilotReportStore`, который ограничивает размер,
путь, область проекта и сверяет hash скачанного артефакта. Источники разрешённых
GitLab locators читаются из отдельного файла и используются только через scoped GitLab
client и опубликованную сетевую policy. `corporate-main.ts` вызывает этот host напрямую;
при отсутствии обязательной конфигурации запуск заканчивается общей ошибкой без
вывода секретов. Манифест развёртывания этого host ещё не подготовлен.

Публичная политика проверки подписанных отчётов читается из JSON-файла по абсолютному
пути `AWP_CORPORATE_REPORT_POLICY_PATH`: верхний уровень содержит `schemaVersion: 1`
и `policies`, массив `PilotReportVerificationPolicy`. Закрытые ключи в файле запрещены.
Поле `IN-07.metadata.verificationPolicyRef` принятого input package должно содержать
`sha256:`-хеш тела политики без `policyRef`; этот же hash задаётся в `policyRef.contentHash`.
При каждой проверке перечитываются файл и актуальный опубликованный input package.
Реальная подпись и доверенные публичные ключи дополнительно проверяются verifier.

`AWP_CORPORATE_REPORT_LOCATORS_PATH` — абсолютный путь к JSON без секретов. Верхний
уровень содержит `schemaVersion: 1`, `deploymentPolicyHash` и массив `reports`.
Каждая запись содержит `workspaceId`, `projectId`, `reportRef` (id, version,
contentHash), числовые `numericProjectId` и `jobId`, `path` и `signature`
(`executorId`, `keyRef`, `subjectRef`, `value`). Пути ограничены каталогом отчётов
008; зависимые отчёты должны находиться в том же GitLab job. Это транспортные
указатели: сам файл не доказывает подлинность отчёта. Хеш, подпись, актуальная
политика и область проекта проверяются отдельно. Доступ к файлу должен ограничиваться
оператором стенда.

Миграция Core 0245 добавляет неизменяемые `pilot_command_admissions`. Корпоративный
QA API должен получить серверный источник текущего fence и записывает его контекст
в одной транзакции с командой; worker должен использовать
`createStoredPilotCommandEffectGuard` при каждой попытке. Команды без такой записи
не допускаются этим guard. Подключение источника fence к worker пока отсутствует:
одна таблица не включает отправку в Jira. Откат миграции
намеренно отказывает при наличии записей, поскольку удаление сняло бы доказательство
условий допуска ранее созданных команд.

При программной сборке API использует `PublishedPilotFence` вместе с реальным
deployment startup и проверяет fence перед записью и повтором команды.
Поскольку fence закреплён за экземпляром worker, API дополнительно проверяет его
действующую регистрацию с теми же deployment и digest, а не подставляет ID API.
`PublishedPilotFence` читает текущие записи `FENCE` и `COHORT` и проверяет их хеши;
их формат описан в [контракте fence](../../specs/008-pilot-hardening-and-conformance/contracts/published-pilot-fence-v1.md).
Он требует завершённое действие с точным кандидатом и использованное согласование
другого человека; записи, созданные без этого подтверждения, не допускают отправку.
В корпоративной QA-сборке подготовлены маршруты `pilot/fence-candidates` и
`pilot/fence-publications`. Второй администратор согласует кандидат через существующий
маршрут `operations/approvals`. Публикация повторно проверяет P3 и точную версию input
package: `IN-10.metadata.cohortRef` должен быть равен хешу cohort без `gateRefs` и
`contentHash` (функция `pilotCohortScopeHash`), `humanRefs` — его
участникам, а `sponsorRef` и `qaLeadRef` — соответствующим владельцам. Нужны актуальная
роль с `project.onboarding.activate`, MFA и `pilot.readiness.read`. У существующих
назначений permissions могут быть сохранены снимком и потребовать перевыдачи.
Для первого pilot cohort может закрепить ревизию `SHADOW`: после перехода в
`PILOT_ACTIVE` эта ссылка принимается только для непосредственного перехода с
проверенным отдельным согласованием. Иное изменение onboarding закрывает старый fence.
Изменение результата gate требует нового кандидата публикации: полный cohort вместе
с gate refs входит в хеш кандидата, хотя согласованный состав IN-10 остаётся прежним.
При допуске QA-сессии runtime связывает проверенного действующего человека с текущим
контекстом fence на сервере и запускает ту же проверку границ pilot.

Для account pool host использует существующий `FileAccountInventory` и путь
`AWP_QA_ACCOUNT_INVENTORY_FILE`. Его записи содержат только opaque account refs;
при отсутствии или несоответствии inventory операция выдаёт отказ.

## Полномочия агента

`AWP_CORPORATE_AGENT_CONFIG_PATH` задаёт абсолютный путь к JSON без секретов:
`schemaVersion: 1`, `deploymentPolicyHash` и `projects`. Для каждого проекта deployment
нужна запись с `workspaceId`, `projectId`, `servicePrincipalId`, `serviceIdentity`
(`issuer`, `subject`, `serviceKey`) и `actions`. Каждое действие содержит `action`,
`humanPermission`, `servicePermission`. Эти сопоставления должен утвердить владелец
стенда; hash связывает файл с deployment, но не подтверждает его происхождение.
API пересекает сопоставление с действиями skill и текущими Core permissions обоих
principal; файл сам по себе права не выдаёт. Неизвестные действия не разрешаются.

## Vault и интеграции

`AWP_CORPORATE_VAULT_CONFIG_PATH` указывает на отдельный JSON без значений секретов.
Его верхний уровень: `schemaVersion: 1`, `deploymentPolicyHash`, `vault`, `connectors`.
В `vault` задаются `vaultOrigin`, `namespace`, `authMount`, `role`,
`serviceAccountTokenFile`, `deadlineMs`, `maximumResponseBytes`. Реальный JWT читается
из указанного Kubernetes service-account файла, передаётся Vault только по опубликованной
network policy и не сохраняется в конфигурации приложения.

Для каждого проекта deployment нужны ровно три записи `connectors`: `JIRA`, `GITLAB`,
`MATTERMOST`. Каждая содержит `grant` формы `CorporateConnectorGrant` и `credentials`.
Элемент credentials содержит `credential` (`authentication` и `mapping` формы
`VaultSecretMapping`) и `approvedMappingHash`, равный `pilotContentHash(mapping)`.
В mapping указываются только `secretRef`, `mount`, `path`, `field`, `secretVersion`,
`maximumLeaseMs` и точные refs/purpose в `use`; значения provider tokens сюда не входят.

Сам файл config связывается с deployment hash; его изменение должно быть ограничено
доверенным оператором. Хеш в файле обнаруживает случайное расхождение mapping, но не
является самостоятельным доказательством утверждения mapping. Для каждой операции
проверяются текущая публикация policy и
права service principal, прежде чем resolver запросит конкретную версию Vault KV.
Истёкшая или отозванная policy закрывает последующие обращения. API не получает
разрешение выполнять provider write напрямую: для этого требуется отдельный worker
с проверкой durable command и effect fence.

`AWP_RUNTIME_IMAGE_DIGEST` передаёт обнаруженный и подтверждённый инфраструктурой digest
текущего образа; он обязан совпадать с deployment policy. Само совпадение строк не
доказывает, что платформа сообщила правильный digest: источник этого значения должен
быть подтверждён при развёртывании.

## Подпись evidence

`AWP_CORPORATE_SIGNING_CONFIG_PATH` указывает на отдельный JSON с `schemaVersion: 1`,
`deploymentPolicyHash`, абсолютным `publicKeyHistoryDirectory` и массивом `projects`.
В каждой записи содержатся `grant` (`CorporateSigningGrant`), `redactionPolicyRef`,
`exportPolicyRef` и `trustedPublicKeys`. Для каждого проекта задаётся отдельный grant;
актуальный signing policy ref обязан совпадать с deployment. Файл содержит только refs,
описание SERVICE identity и путь к public-key archive — закрытых ключей и токенов в нём нет.

Архив публичных ключей должен быть заранее подготовлен и сохранён вне эфемерного pod.
Подпись выполняется через Vault Transit; конфигурация и текущие SERVICE grants
проверяются повторно, а проверка старых подписей использует локальную публичную историю.
Доступ к записи signer config, архива и выдача SERVICE роли должны быть ограничены.
На каждой подписи проверяется текущая опубликованная `SIGNING_POLICY`. Файл конфигурации
сам по себе не доказывает, что отдельный ключ и grant утверждены содержимым этой policy:
их должен согласовать и защитить владелец стенда.
