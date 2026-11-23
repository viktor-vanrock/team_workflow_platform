# UI Copy Contract: Русский интерфейс

## Scope

Контракт применяется ко всему пользовательскому тексту web-shell, route-компонентов, QA UI и Platform UI.

## Static copy

- Заголовки, подписи, кнопки, вкладки, подсказки, empty/loading/error/success states ДОЛЖНЫ быть на русском языке.
- `aria-label`, доступные имена и title документа ДОЛЖНЫ соответствовать видимому русскому тексту.
- Окружающая фраза переводится даже тогда, когда внутри неё сохранён термин вроде `QA` или `Jira`.

## Dynamic values

- Известные enum/reason-коды форматируются через общий русский formatter.
- Неизвестный код отображается без изменения.
- Wire value, сравнение, payload, hash input и сохранённое значение не изменяются.
- Пользовательские данные, внешний контент, имена файлов, IDs, ключи, URL, версии, hashes и timestamps не переводятся.

## Preserved terms

Минимальный allowlist: `QA`, `Jira`, `GitLab`, `Mattermost`, `Hermes`, `API`, `MFA`, `OIDC`, `SLA`, `WIP`, `CI`, `ID`, `RPO`, `RTO`, `ETag`, `DoR`, `DoD`, `CAS`, `JSON`, `HTTP`, `Mock Hub`.

## Errors

- Контролируемая клиентом сводка ошибки переводится.
- Диагностический status/error code может быть добавлен без изменения.
- Необработанная внешняя ошибка не должна приниматься за безопасный локализованный текст.

## Compatibility

Контракт не изменяет API, события, storage, authorization, approvals, connector effects или audit semantics.
