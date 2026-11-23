# Data Model: UI presentation only

Новых persisted entities, migrations, HTTP payloads или переходов состояния нет.

## BlackOrderTokens

Неизменяемый набор presentation values: canvas/surface/raised/nav backgrounds, text/muted, border/control-border, metal, primary button/hover, primary foreground, focus, semantic success/warning/error/info, heading/body font stack.

## OrderDecoration

Декоративная композиция использует существующий текстовый заголовок, необязательную подпись и встроенную геометрию. Она не хранит проект, роль, work item или proposal. Декор помечается `aria-hidden`, не получает фокус и не перехватывает клики.

## Существующие сущности

LocalSession, selected WorkItem, IntakeDraft, HermesProposalView и QA verdict используются без изменения. Все данные и доступ поступают по существующим путям. Имя «Архив ордена» является оформлением рабочего пространства, не новым domain entity.
