# UI contract: «Чёрный орден»

1. `WorkspaceTheme` сохраняет children API и единственный root-provider. Dark mode действует также для pilot routes и native select.
2. Tokens и декоративные компоненты экспортируются из `@awp/platform-ui`; web и competency-qa не делают deep imports.
3. `Основная навигация`, `Роль и проект`, `Начать работу`, `Сменить роль или проект`, `Название`, `Проверить запрос`, `Отправить запрос`, `Выбранный запрос` и существующие tabs сохраняют свои роли/подписи.
4. Form focus и main/review focus transitions сохраняются. Декоративная геометрия не входит в accessibility tree.
5. Бордовый акцент — filled action; links/outlined text — светлый металл; status colors — отдельные semantic tokens плюс существующие подписи.
6. `QaHermesProposals` сохраняет props `items`, состояния, hashes и explanation; оформление не добавляет статические предложения и не выполняет действия.
7. UI имеет читаемые loading/empty/error/denied/success/disabled states. Нативный select сохраняет клавиатуру и native selection.
8. Все design assets локальны, системные fonts имеют кириллический fallback; API/БД/rights/approvals не меняются.
