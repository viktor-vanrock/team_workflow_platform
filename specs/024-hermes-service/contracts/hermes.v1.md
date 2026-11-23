# Internal Hermes HTTP contract v1
- GET /health/live: 200 {service:hermes,version:1,status:UP}.
- GET /health/ready: 200 или 503, ready/service/version/mode; никаких секретов. Готовность проверяет конфигурацию и срок network policy; не оплачиваемый вызов модели.
- POST /v1/project-dialogue: Authorization Bearer internal secret, application/json; request из data-model.md. Response 200 versioned proposal, requestHash, mode. No persistence/effects.
- 401 неверный token, 400 неверный body/schema, 413 более 16KiB, 404 неизвестный route; error содержит только фиксированный code.
- Model errors -> deterministic fallback с фиксированным reasonCode. Upstream redirects запрещены. JSON response ≤32KiB. Transport deadline ≤3s, model ≤2s.
- API принимает ответ только с тем же hash и допустимой карточкой, state/reply пересчитывает локально; любая ошибка -> локальный fallback. Auth/version/replay проверяются до и после network ожидания.
- Внешняя модель: POST exact endpoint с model/messages/response_format=json_object, tools отсутствуют. Content — JSON draft. Модель не выбирает endpoint или credentials.

## Project context / Mattermost v1
POST /v1/project-context использует тот же service token. Envelope: schemaVersion=1,
requestKey, operation=ask|test, message, context={workspaceId,projectId,version,key,name,
purpose,stage,capability,qa?:{version,environments,checklists}}. Unknown поля запрещены.
Response: version, hash полного входа, mode, answer, optional allowlisted QA proposal.
Поиска и документов нет. Только API выбирает project/context и сохраняет draft.

POST /api/v1/hermes/mattermost — native form-urlencoded slash, /hermes, выбор binding
по точным team/channel ID. Вариант /:bindingKey дополнительно ограничивает endpoint.
Проверяются configured token/team/channel и verified external HUMAN mapping. ask/test
используют trigger_id для durable receipt. test пишет одну revision MATTERMOST_DIALOG.
preview <draftId> проверяет qa.request.confirm, авторство, published QA/Jira configuration;
ответ содержит Jira project/type и exact request/create fields. Ticket подписан slash
secret с отдельным binding domain, связан с identity/каналом/версией binding/снимком и истекает через 10 минут.
confirm <ticket> выполняет ту же проверку и атомарно ставит CommandGateway request.create
в существующий durable outbox. Изменения требуют нового preview. Сервис LLM не выдаёт
confirmation tickets и не получает connector credentials. Ответ всегда ephemeral;
raw response_url игнорируется, отдельной внешней отправки нет. Отсутствие Jira runtime
не мешает сохранению draft, но не выдаёт фиктивного accepted Work Item.
