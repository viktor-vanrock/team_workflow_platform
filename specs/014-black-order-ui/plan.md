# Implementation Plan: «Чёрный орден» в UI

**Branch**: `codex/014-black-order-ui` | **Date**: 2026-09-09 | **Spec**: [spec.md](spec.md)
**Input**: `specs/014-black-order-ui/spec.md`

## Summary

Внедрить выбранный исходный «Чёрный орден» через единственную общую MUI-тему. Добавить переиспользуемые архивные декоративные компоненты для входа, shell, главной и Hermes; заменить все обнаруженные светлые исключения семантическими токенами. Сохранить UI и бизнес-сценарии feature 013. Референс закреплён в `design-reference.png`.

## Technical Context

**Language/Version**: TypeScript 6.0.3, React 19.2.8, Node 24.20.0.
**Primary Dependencies**: существующие MUI 9.3.1, Emotion 11, Vite 8.2.2; новых библиотек нет.
**Storage**: не требуется; серверные схемы и данные не меняются.
**Testing**: существующие Playwright сценарии 013, новый браузерный visual/accessibility smoke 014, Vitest localization/architecture, TypeScript, ESLint, Prettier, production build.
**Target Platform**: браузер, desktop и мобильные экраны от 360px.
**Project Type**: существующее React-приложение в TypeScript monorepo.
**Performance Goals**: CSS и простая декоративная геометрия; без новых runtime dependencies, удалённых fonts и фоновой анимации.
**Constraints**: сохранить незакоммиченные изменения 013, native select, разрешения, фокус и подписи действий; local-first.
**Scale/Scope**: общая тема для всех web routes; точечные изменения shell/home, QA intake, findings, Hermes и трёх pilot backgrounds.

## Constitution Check

| Инвариант                                                                       | До исследования | После дизайна                                                      |
| ------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------ |
| I/IV: platform-ui отвечает за общие компоненты, QA Pack за свой UI              | PASS            | PASS — новые визуальные компоненты в platform-ui, без deep imports |
| II/III/VI/VII: Jira authority, scope, approvals, Hermes proposal, human verdict | PASS            | PASS — команды, API и доменные состояния не меняются               |
| V/IX: детерминизм, idempotency и аудит                                          | PASS            | PASS — оформление не добавляет команды или эффекты                 |
| X: локальный сценарий не зависит от внешней сети                                | PASS            | PASS — системные шрифты и встроенный декор                         |
| XI/XII: совместимость и conformance                                             | PASS            | PASS — без миграций, существующие browser journeys обязательны     |

## Project Structure

### Documentation

`specs/014-black-order-ui/`: spec, plan, research, data-model, design, design-reference.png, quickstart, contracts/ui.md, checklists/requirements.md, tasks и validation.

### Source Code

- `packages/platform-ui/src/black-order.ts`: общие токены цвета и типографики.
- `packages/platform-ui/src/order-decoration.tsx`: герб, арки и заголовочная композиция.
- `packages/platform-ui/src/workspace-theme.tsx`: dark palette, MUI overrides, native baseline и reduced motion.
- `packages/platform-ui/src/index.ts`: публичные экспорты.
- `apps/web/src/workspace/local-workspace.tsx`, `workspace-home.tsx`: вход, shell, контекст, hero.
- `packages/competency-qa/src/ui/{intake,findings-defects,hermes-proposals}.tsx`: согласование поверхностей, оформление помощника.
- `apps/web/src/routes/pilot/{pilot-run,readiness,recovery}.tsx`: theme-owned backgrounds.
- `tests/e2e/014/black-order-browser.spec.ts`: проверка настоящего Vite UI с HTTP fixtures; контраст, native select, narrow layout, внешние ресурсы.
- `tests/browser-test-files.ts`: регистрация нового browser suite.

**Structure Decision**: единственный ThemeProvider уже охватывает все routes. Новая тема не дублирует провайдер, роутер или shell; расширения используют публичный platform-ui.

## Execution Strategy

Спецификация → исследование и UI-контракт → tasks → центральная тема → shell и QA → браузерные сценарии и документация. Исследование светлых исключений выполнено отдельным read-only агентом по инструкции speckit-plan; реализация последовательная.
