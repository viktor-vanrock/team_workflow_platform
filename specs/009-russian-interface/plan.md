# Implementation Plan: Русский интерфейс

**Branch**: `009-russian-interface` | **Repository branch**: `main` | **Date**: 2026-09-07 | **Spec**: [spec.md](spec.md)

**Baseline**: `5ed7c8f`

**Constitution**: `2.0.0`

## Summary

Перевести весь пользовательский текст web-приложения и подключённых UI-пакетов на русский язык, сохранив общепринятые термины и неизменность контрактных данных. Статические фразы переводятся на границе представления, а серверные enum/reason-коды получают единый русский форматтер с безопасным возвратом исходного значения. Существующие UI-, SSR- и browser-тесты обновляются, а архитектурный аудит предотвращает повторное появление обычного английского текста.

## Technical Context

**Language/Version**: TypeScript 6.0.3, strict ESM/ES2024/NodeNext; Node.js 24.20.x

**Primary Dependencies**: React 19.2.x, MUI 9.3.x, Vite 8.2.x; существующие workspace-пакеты без новой runtime-зависимости

**Storage**: N/A — контрактные и сохранённые значения не изменяются

**Testing**: Vitest 4.1.x, React SSR/testing-library, Playwright 1.62.x, статический архитектурный аудит исходников

**Target Platform**: существующее web-приложение для браузеров на мобильной и настольной ширине

**Project Type**: TypeScript monorepo; React shell + QA Competency Pack UI + Platform UI

**Performance Goals**: форматирование одной подписи выполняется синхронно за постоянное время и не добавляет сетевых запросов или заметной задержки отображения

**Constraints**: не менять API/domain enum-коды, хешируемые payload, пользовательские и внешние данные; сохранить `QA`, `Jira`, `GitLab`, `Mattermost`, `Hermes`, `API`, `MFA`, `OIDC`, `SLA`, `WIP`, `CI`, `ID`, `RPO`, `RTO`, `ETag`, `DoR`, `DoD`; технические коды допускается показывать рядом с русской подписью, если это важно для аудита

**Scale/Scope**: `apps/web/index.html`, 17 route/shell файлов, 21 QA UI-компонент, 3 Platform UI-компонента, 1 набор пользовательских DoR-remediation и затронутые UI/browser-тесты

## Constitution Check

### Pre-design gate

| Principle | Result | Obligation |
|---|---|---|
| I. Product scope | PASS | Меняется только представление существующего QA-first продукта. |
| II. Jira authority | PASS | Отображаемые подписи не изменяют Jira-owned значения или операции. |
| III. Workspace/Project boundary | PASS | Авторизация, scope и классификация не затрагиваются. |
| IV. Pack/Core/Connector ownership | PASS | Общий форматтер живёт в UI-слое; доменные и connector-контракты остаются прежними. |
| V. Deterministic core | PASS | Локализация детерминирована и не зависит от модели. |
| VI. Hermes/exact approvals | PASS | Тексты не меняют action identity, payload hash или approval consumption. |
| VII. Human verdict | PASS | Подписи действий переводятся, authority человека сохраняется. |
| VIII. Evidence/target snapshot | PASS | Evidence, хеши, имена файлов и идентификаторы не переводятся. |
| IX. Reliability/audit | PASS | Audit-коды и correlation/idempotency values остаются неизменными. |
| X. Integrations/local-first | PASS | Новые внешние сервисы и сетевые зависимости не добавляются. |
| XI. Versioning/compatibility | PASS | Публичные схемы и enum-значения не меняются. |
| XII. Production boundary | PASS | Перевод не расширяет доступные действия или среды. |

**Gate result**: PASS. Исключения и complexity waiver не требуются.

### Post-design gate

PASS. Контракт [ui-copy.md](contracts/ui-copy.md) закрепляет преобразование только на UI-границе, безопасный fallback исходного значения и запрет на изменение данных. Модель хранения не вводится.

## Project Structure

### Documentation (this feature)

```text
specs/009-russian-interface/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── ui-copy.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/web/
├── index.html
└── src/
    ├── App.tsx
    └── routes/{pilot,projects,qa}/

packages/platform-ui/src/
├── index.ts
├── localization/ru.ts
├── integration-health/
└── operational-authority/

packages/competency-qa/src/
├── rules/dor-rules.v1.ts
└── ui/

tests/
├── architecture/ui-localization.spec.ts
├── unit/005/
├── integration/007/
└── e2e/{001,005,006,007,008,acceptance}/
```

**Structure Decision**: использовать существующие UI-пакеты и добавить единственный общий русский presentation-formatter в `@awp/platform-ui`. Статические фразы остаются рядом с компонентами; переиспользуемые машинные состояния форматируются централизованно. Полноценная runtime-i18n-система и переключатель языка не вводятся, поскольку текущая функция устанавливает один русский интерфейс.

## Implementation Approach

1. Добавить `formatRuUiValue` и связанные helpers для известных статусов, причин, типов, дат и счётчиков с возвратом исходного значения для неизвестных кодов.
2. Установить `lang="ru"` и русский title, затем перевести shell и routes в `apps/web`.
3. Перевести общие Platform UI-компоненты и все QA UI-компоненты, используя formatter для кодов, но не для внешних/пользовательских данных.
4. Перевести DoR remediation, поскольку эти строки непосредственно показываются пользователю; не менять error-коды и хешируемые доменные payload.
5. Обновить точные текстовые ожидания в существующих SSR/Playwright-тестах и добавить архитектурный аудит с явным allowlist терминов.
6. Выполнить typecheck, lint, web build, целевые Vitest-наборы и доступные browser-тесты.

## Complexity Tracking

Конституционных нарушений нет; раздел не применяется.
