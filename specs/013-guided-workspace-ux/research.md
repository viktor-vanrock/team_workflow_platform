# Research

## Навигация и контекст

**Decision**: Shell в web, простой History API + popstate + internal link interception, локальная сессия в памяти; explicit route metadata и доступность по server grants.
**Rationale**: Текущая проблема — отсутствующая навигация и потеря сессии. Нет необходимости добавлять router/persistent credentials. При смене персоны рабочий subtree сразу убирается.
**Alternatives considered**: Полная перезагрузка теряет вход; localStorage токена создаёт лишнее хранение credentials; новый router увеличивает зависимости без необходимости.

## Intake и выбор запроса

**Decision**: Сохранённый snapshot отображается readonly перед отправкой. «Изменить» возвращает к форме и требует нового draft. Confirmation всегда использует существующий stable idempotency key. Status polling отменяется при unmount; timeout оставляет неопределённость и ручную проверку. Список не выбирает первую запись сам; open callback переносит точный ID.
**Rationale**: Исследователь UX выявил расхождение видимого текста и draft ID, а также stale selected ID во вложенных компонентах.
**Alternatives considered**: Простое переименование кнопок не исправляет ошибки; автоподтверждение нарушает конституцию; выбор первого запроса скрывает адресат.

## Визуальная система

**Decision**: Общий MUI theme/baseline в platform-ui, спокойный нейтральный фон, компактный header/sidebar, крупные читаемые названия и обычный регистр кнопок; без внешних шрифтов/asset dependencies.
**Rationale**: MUI уже установлен и разрешён архитектурой; source research не обнаружил текущего theme/provider.
**Alternatives considered**: Новый UI kit и визуальные assets не решают обнаруженные сценарные проблемы.

## Проверки

**Decision**: Использовать имеющийся pattern `tests/e2e/008/pilot-readiness-browser.spec.ts`: настоящий Vite + Playwright и HTTP fixtures, плюс реальный локальный pilot. Покрыть keyboard/mobile, ошибки, immutable review, delayed-response isolation.
**Rationale**: Независимое исследование test suite показало, что SSR и HTML fixtures не проверяют навигацию/состояние; root не имеет Testing Library dependency.
**Alternatives considered**: Только screenshots не проверяют адресата команды; полный контейнерный CI для каждого UI шага избыточен. Финальные required lint/typecheck/build и затронутые suites обязательны.

Все неизвестные для текущего scope разрешены исходниками и браузерным наблюдением; новых внешних технологий не выбирается.
