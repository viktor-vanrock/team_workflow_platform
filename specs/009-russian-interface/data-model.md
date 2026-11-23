# Data Model: Русский интерфейс

**Feature**: `009-russian-interface`
**Date**: 2026-09-07
**Status**: Phase 1 design

Функция не вводит и не изменяет сохраняемые сущности. Все преобразования выполняются только при отображении.

## PresentationLabel

```text
sourceValue: string       # неизменное контрактное значение
displayValue: string      # русская подпись
preserveCode: boolean     # показать ли sourceValue рядом для аудита
```

Правила:

1. `sourceValue` никогда не изменяется и продолжает использоваться в API, сравнениях и действиях.
2. Известное значение получает единообразный `displayValue`.
3. Неизвестное значение возвращается как `displayValue` без исключения.
4. Пользовательские, внешние и идентифицирующие значения не проходят через переводчик.

## UiMessage

```text
kind: info | success | warning | error
localizedSummary: string
technicalDetail?: string
```

`localizedSummary` принадлежит клиенту и переводится. `technicalDetail` может содержать HTTP status, error/reason code или исходную диагностическую причину и не искажается.

## PreservedTerm

Allowlist содержит устойчивые термины и имена продуктов. Он используется только для контроля исходников и не становится runtime-источником данных.

```text
term: string
rationale: acronym | product | protocol | audit-token
```

## State Transitions

Новых переходов состояния нет. Локализация является чистой проекцией `sourceValue → displayValue` и не может инициировать доменную операцию.
