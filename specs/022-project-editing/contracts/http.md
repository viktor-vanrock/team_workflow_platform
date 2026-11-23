# HTTP / UI contract

Base: /v1/workspaces/:workspaceId/projects/:projectId и published alias /api/v1/...

GET /metadata: требует project.metadata.update. Ответ: project {id,workspaceId,key,name,dataClassificationKey,ownerIds,version}, ownerOptions [{id,displayName}], history [{version,name,ownerIds,owners,actorName,createdAt,reason}], resultRef. История ограничена последними 50 версиями с явным historyLimit/historyHasMore. ETag соответствует registry version.

PUT /metadata: требует то же право и MFA <=5 минут; If-Match с registry version, Idempotency-Key. Тело строго {name,ownerIds,reason}. 200 {status:APPLIED,version,resultRef}. 400 invalid input, 403 current authority/MFA/owner denied, 404 unavailable, 409 version/idempotency conflict. Auth проверяется до replay; успешный повтор не создаёт новую историю. Прежняя версия в request fingerprint предотвращает повтор с изменённым ожиданием.

UI /projects/:id/edit: данные постоянных полей, редактируемое название, именованные checkbox ответственных, причина, подтверждение входа, сохранение; история ниже. Ошибка/конфликт сохраняет черновик, явная загрузка актуальных данных. Каталог и onboarding показывают ссылку по текущему project capability. Успех обновляет session/catalog. Хлебные крошки ведут в каталог и карточку.
