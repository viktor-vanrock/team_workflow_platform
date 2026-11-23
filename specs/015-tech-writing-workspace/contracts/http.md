# HTTP и UI контракт v1

Локальный base: `/workspaces/:workspaceId/projects/:projectId/documentation`. Bearer Fake IdP обязателен. Workspace/project — UUID. Request authority fields запрещены; actor/grants берутся сервером. Только local runtime регистрирует controller.

| Метод / путь | Тело | Результат |
|---|---|---|
| GET / | — | scoped список (писатель — свои, лид — все), до 100 |
| GET /:id | — | документ, автор, история и разрешённые действия |
| POST / | title, goal, audience | новая задача для сервиса, автор = текущая persona |
| POST /:id/save | body | сохранённый текст |
| POST /:id/submit | пустой объект | точная сохранённая версия на ревью |
| POST /:id/return | feedback | возврат с замечанием |
| POST /:id/approve | пустой объект | human approval текущей версии |

Для всех POST заголовок `Idempotency-Key`; для действий существующего документа `If-Match: "resourceVersion"`. Request body не принимает actorId, workspaceId, projectId, state, approval. Успех — snapshot с актуальной версией; 400 invalid input, 401 no token, 403 authority/scope denied, 404 недоступный документ внутри разрешённого scope, 409 stale state/version/key conflict. Размер текста <= 100000 символов; возврат <= 4000.

## UI

Писатель: Главная → Мои документы → редактор/сохранение/отправка; заметные возвраты. Лид: Главная → Очередь ревью → просмотр/замечание/возврат/утверждение; Библиотека документов. Общая краткая помощь описывает цикл. Разрешённые действия сервер возвращает для текущего документа; UI дополняет их блокировкой несохранённого текста, pending и состояния формы. Abort/epoch + remount очищают старый контекст. Текст отображается как plain text, без исполнения HTML.
