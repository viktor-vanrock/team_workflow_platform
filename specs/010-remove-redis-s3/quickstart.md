# Quickstart: Проверка v1 без Redis и S3

## 1. Dependency and static gate

```bash
pnpm install --frozen-lockfile
pnpm verify:010
```

Gate должен подтвердить отсутствие BullMQ/Redis и S3/S3Mock runtime packages,
deployment inputs, compose services и публичных attachment-upload routes.

## 2. Compile and test

```bash
pnpm typecheck
pnpm test:010
```

Обязательные сценарии: metadata-only manual QA, GitLab-backed artifact read и
PostgreSQL worker restart recovery без повторного external effect.

## 3. Inspect local service graph

```bash
docker compose -f infra/compose/docker-compose.local.yml config --services
```

В списке не должно быть `redis`, `s3mock` или `s3mock-init`.

## 4. Run local environment

```bash
pnpm local:up
pnpm local:status
```

API, worker и web должны стать ready без Redis/S3 environment variables. Для
остановки:

```bash
pnpm local:down
```

## 5. Evidence of completion

Сохранить результаты `verify:010`, `typecheck`, `test:010` и Compose service list в
обычный feature evidence report. Локальные S3 object fixtures не создаются.

## 6. Фактическая проверка 2026-09-07

- Contract registry: 204 immutable schema documents и 19 YAML contracts собраны.
- OpenAPI snapshots: API и Mock Hub snapshots пересобраны без attachment-upload routes.
- Architecture graph: PASS, 23 проекта, без deep imports, cycles или dynamic loading.
- TypeScript: root compile и Nx typecheck всех 23 проектов — PASS.
- ESLint: полный репозиторий и повторная проверка затронутых regression fixtures — PASS.
- Feature 010: 6 test files / 11 tests — PASS; static gate — PASS.
- Full Vitest regression: 581 test files / 1941 tests — PASS; 40 files / 226 tests skipped by their declared conditions.
- Docker Compose inventory: 11 сервисов; `redis`, `s3mock` и `s3mock-init` отсутствуют.

На машине проверки установлен Node.js 22.23.2, а репозиторий фиксирует Node.js
24.20.0. Поэтому эквивалентные команды запускались напрямую через зафиксированные
локальные CLI (`node tools/...`, `node node_modules/vitest/...`, TypeScript и Nx),
без изменения lockfile во время проверки. В CI `pnpm install --frozen-lockfile`
должен выполняться на требуемом Node.js 24.20.0.
