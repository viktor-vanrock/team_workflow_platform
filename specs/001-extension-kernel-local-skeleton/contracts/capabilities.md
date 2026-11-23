# Typed capabilities: правила Phase 1

## Capability identity

Capability имеет стабильный lowercase key и SemVer, например `sample.record@1.0.0`.
Contract владеет именами operations и их target/input/result/external-scope schemas. Connector только
объявляет, какие exact versions и operations он реализует. Pack объявляет version range и logical role.

Resolution выполняется по tuple:

```text
workspaceId + projectId + environmentScope + capabilityKey + logicalRole
```

Результат обязан быть ровно один. Zero match — `CAPABILITY_BINDING_MISSING`; больше одного —
`CAPABILITY_BINDING_AMBIGUOUS`. Fallback на первый Profile, Connector Type или похожее имя запрещён.

## Sample contract

Phase 1 использует только conformance capability:

```text
sample.record@1.0.0
  operation: record.publish
  effect: WRITE
  target: SampleRecordTarget
  input: SampleRecordPublishInput
  result: SampleRecordPublishResult
  external scope: SampleRecordExternalScope
  idempotency: required, NATIVE_KEY
  confirmation: SYNC_RECEIPT | READ_BACK
```

Dummy Pack requirement называется `primary-record-publisher` и использует opaque logical role
`PRIMARY`. Core ничего не знает о значении `PRIMARY`.

## Opaque logical-role conformance vectors

Contract suite валидирует роль только общим `LogicalRoleKey` schema и не ветвится по значению:

| Ожидается ACCEPT | Ожидается REJECT |
|---|---|
| `PRIMARY` | `QA REQUEST AUTHORITY` (space) |
| `SECONDARY` | `_INVALID_ROLE` (недопустимый первый символ) |
| `sample.record.primary` | строка длиннее 128 символов |
| `FUTURE_PACK_ROLE` |  |

Эти neutral vectors доказывают принятие неизвестных Pack-owned FR-032 names без регистрации QA Pack
и одновременно запрещают превращать logical role в Core enum либо special-case branch.

## Operation rules

- У каждой operation отдельные strict schemas; `execute(any)` запрещён.
- WRITE operation обязана объявить `idempotency.required=true` и хотя бы одну strategy:
  `NATIVE_KEY`, `NATURAL_KEY_LOOKUP` или `RECONCILIATION`.
- Connector получает Gateway-generated globally unique `effectIdempotencyKey`, а не actor/project-scoped
  client request key; один effect key неизменен на всех attempts.
- Approval policy не хранится в Connector manifest. Ее определяет Core policy по actor, action,
  target, scope и classification.
- Target содержит логический идентификатор. Pack не передаёт URL, Profile ID или secret.
- Normalized result не содержит raw provider response.
- `externalScope` является `SchemaBoundValue`: wrapper generic, но value проверяется зарегистрированной
  exact schema до публикации Profile/Binding.
- Approval-required command сохраняет durable outbox row как `HELD`. До атомарного перехода
  `HELD → READY` после exact approval delivery job не публикуется; сам Approval остаётся
  `AUTHORIZED` до worker-side live revalidation и execution claim непосредственно перед call.

## Compatibility

- новый optional response field — minor;
- новый optional operation — minor, если старые implementations остаются совместимы;
- удаление operation, изменение effect/idempotency semantics, новое required input поле или сужение enum — major;
- Connector Profile pin'ит exact capability version;
- Pack requirement задаёт range;
- binding публикуется только если intersection содержит exact Profile version.

## Required и optional requirements

Отсутствующий `REQUIRED` requirement блокирует публикацию binding. Отсутствующий `OPTIONAL` requirement
не блокирует остальные функции и возвращается через capability availability как `UNAVAILABLE` с code.
Core не интерпретирует `featureKey`, а только сохраняет его для диагностируемой деградации.
