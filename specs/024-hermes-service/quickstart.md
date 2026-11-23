# Quickstart validation
1. Установить зависимости согласно README (Node 24.20.0/pnpm 11.21.0).
2. Подготовить secret соединения и конфигурацию Hermes по docs/deployment/hermes-service.md; deterministic работает без провайдера, openai-compatible требует утверждённые endpoint/model/CIDR и secret file.
3. Собрать образ и поднять workspace + hermes по docs/deployment/initial-qa-workspace.md. Проверить compose ps и /health/ready.
4. Авторизованным заказчиком открыть /projects/hermes, создать проект, повторить confirm с тем же ключом. Ровно один projectId; права других заказчиков не меняются.
5. Остановить hermes: API ready сообщает недоступность, сообщения имеют локальный fallback, ручная регистрация работает. Перезапустить: история сохранена.
6. Запустить pnpm exec vitest run tests/unit/hermes-service tests/integration/hermes-service tests/integration/023 tests/integration/024 --maxWorkers=1, pnpm typecheck:root, lint затронутых файлов, pnpm architecture. Container test требует AWP_TEST_WORKSPACE_IMAGE.
7. Реальный provider smoke выполняется после предоставления approved конфигурации; не отправлять рабочие данные в тестовую модель.
8. Для Mattermost подключить project/channel binding и verified HUMAN mapping по runbook. Выполнить /hermes ask, затем /hermes test в связанном канале; проверить QA draft правильного проекта, личный ответ и отсутствие Jira-команды до подтверждения.
9. В provider-enabled host выполнить /hermes preview <draft-id>, проверить конкретные поля и Jira project/type, затем выданный /hermes confirm. Повтор должен вернуть ту же command identity. Подмена канала/автора, изменение карточки и отозванные права должны отклоняться. Worker выполняет внешний эффект; первоначальный workspace без Jira runtime сообщает о недоступности подтверждения.
