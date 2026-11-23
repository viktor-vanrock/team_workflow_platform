# Реализация

- Использовать существующие project-scoped RoleAssignment и ProjectEntitlement. Workspace requester получает только project.request.create; рабочие permissions выдаются отдельными проектными назначениями. DB constraint запрещает новое общее назначение requester с доступом к данным.
- PlatformAccessService принимает requesterProjectIds, проверяет область проектов и атомарно пересобирает права. Каталог предоставляет проекты для выбора; история содержит выбранные projectIds. Старые клиенты без этого поля сохраняют текущий выбор.
- Диалог хранит principalId, workspaceId, version, messages и draft в PostgreSQL. Команды имеют неизменяемые idempotency receipts. Подтверждение и ProjectRegistrationService работают в одной транзакции, сохраняя существующий аудит и onboarding.
- Текст обрабатывается локальным сценарием Hermes без глобальной service identity и без изменения AgentRun subject union. Мутация выполняется проверенным HUMAN после подтверждения.
- Общий TypeScript wire contract используется бэком и UI. OpenAPI включает новые endpoints. UI работает при отсутствии исходных проектов, сохраняет черновик после MFA и допускает безопасный повтор неизвестного сетевого результата.
- Проверки: PostgreSQL integration, контракт OpenAPI, typecheck/lint, сборка web и браузерный сценарий на 390/1440 px.
