# UI and API Contract

- GET /local/personas: no auditor; no project suffix in displayed human role labels; two executor people have qa-executor permissions.
- POST /local/persona/exchange: {personaKey} unchanged; selects default authorized project and returns projects.
- POST /local/persona/projects/:projectId: authenticated, empty JSON body; derive identity from token, validate current persisted rights, return same subject with selected project context and authorized permissions. Unknown/foreign/revoked selections denied. The path identifies the requested resource; authoritative client fields remain forbidden in request bodies.
- POST /local/persona/step-up: existing empty body; optional selected project header preserves selection after authority check.
- Project registration: create all valid team starter entitlements in existing transaction and hash/reference complete set. Replay returns stored result with no duplicate grants.
- Browser: label «Участник и роль» for login; label «Рабочий проект» for authenticated selector; changing project resets request/query/mounted route state. Failed selection retains old context and reports a useful error.
- Breadcrumbs: '/', selected project page, current section; anchors support keyboard and modifier clicks.
