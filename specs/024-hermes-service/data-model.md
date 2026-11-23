# Data model
Persistence не меняется. project_registration_dialogues: private workspaceId/principalId, id, version, state, draft, messages, projectId. project_dialogue_commands: dialogueId/requestKey, requestHash, response; текущие receipts остаются authoritative.

HermesRequest v1: schemaVersion=1, workspaceId/principalId/dialogueId/requestKey UUID, expectedVersion positive integer, draft {key, name?, purpose?}, message (1..2000).
HermesResponse v1: schemaVersion=1, requestHash=sha256 запроса, draft, state COLLECTING|READY, reply, mode DETERMINISTIC|MODEL|DETERMINISTIC_FALLBACK. Никаких полей actor/grants/projectId или external effects.
Draft key: [A-Z][A-Z0-9_-]{1,31}; name 1..256, purpose 1..2000. Unknown properties запрещены. READY iff есть name и purpose. CREATED выдаёт только API после human confirm.
Network model config: mode deterministic|openai-compatible, endpoint/model/tokenFile/network policy/optional CA file. Secret values не хранятся в JSON или logs. Запрос/ответ не кешируется в Hermes.

Mattermost bindings задают workspace/project/connection, provider namespace, team/channel,
version/expiry и путь к slash secret. Общая команда одной team может использовать один
секрет для разных project bindings. Подтверждения имеют отдельный domain каждого binding.
External HUMAN binding и project authorization перечитываются на каждой операции.

ProjectContext v1 содержит только карточку проекта и количества опубликованных QA refs.
QA proposal содержит title/requestKind/goal/scope/acceptanceOutcome/businessImpact;
классификацию выбирает API. Существующие intake_drafts/intake_draft_revisions сохраняют
MATTERMOST_DIALOG source. client_request_idempotency хранит scoped trigger receipts.

Confirmation ticket: draftId/principalId/identityVersion/snapshotHash/expiresAt и HMAC.
Snapshot связывает draft revision/hash, точные create fields/target, policy и profile hashes,
binding refs и стабильную command identity. Токен не является permission grant.
Confirm создаёт существующую durable connector command; повтор возвращает тот же commandId.
Новых таблиц, индекса документов или embeddings нет.
