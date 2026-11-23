# Implementation Plan: Упрощение первой версии без Redis и S3

**Branch**: `main` | **Date**: 2026-09-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-remove-redis-s3/spec.md`

## Summary

Первая версия платформы должна работать без Redis/BullMQ и без S3/S3Mock. Фоновая
обработка сохраняет уже существующую PostgreSQL-модель durable commands, outbox,
leases, retry и idempotency как единственный источник истины. Бинарные CI artifacts
остаются в GitLab и читаются через GitLab connector; платформенная загрузка
произвольных QA attachments и локальные S3 fixtures исключаются. Generic artifact
references, evidence manifests, reviews, audit и human verdict сохраняются.

Реализация удаляет неиспользуемый BullMQ package, S3 adapters и upload runtime,
сокращает конфигурацию/readiness/compose до PostgreSQL и обязательных приложений,
обновляет публичный QA API и текущие документы, а также добавляет gate, который
проверяет отсутствие удалённых runtime-компонентов и recovery фоновой работы.

## Technical Context

**Language/Version**: TypeScript 6.0.3 на Node.js 24.20.0

**Primary Dependencies**: NestJS 11.2.3, TypeORM 1.1.0, PostgreSQL driver 8.23.0,
React 19.2.8, Nx 23.1.2; BullMQ и S3 SDK/runtime implementation отсутствуют

**Storage**: PostgreSQL для durable state; GitLab для CI artifact bytes; локальное
или платформенное object storage не входит в v1

**Testing**: Vitest, Playwright, Nx targets, repository verification gates и Docker
Compose configuration checks

**Target Platform**: Linux containers для API/worker/web и локальный macOS/Linux
developer workflow

**Project Type**: TypeScript monorepo с web, API, worker, platform packages,
connectors и infrastructure-as-code

**Performance Goals**: Существующий polling interval и throughput PostgreSQL worker
не ухудшаются; idle worker не создаёт более одного poll цикла в секунду на handler;
artifact streaming остаётся ограниченным пропускной способностью GitLab

**Constraints**: Нельзя ослаблять durable delivery, idempotency, audit,
Workspace/Project isolation, checksum/provenance, human verdict и запрет production
effects; новые брокеры и хранилища не добавляются

**Scale/Scope**: Первая QA-only версия, один Work Type `qa.validation`, один pilot
deployment profile; изменение затрагивает runtime composition, local infrastructure,
QA attachment API, dependency graph, tests и актуальную документацию

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Gate | Result | Evidence |
|---|---|---|
| Scope remains QA-only v1 | PASS | No competency or Work Type is added; attachment upload is narrowed out of scope. |
| Core still owns durable event delivery and artifact references | PASS | PostgreSQL command/outbox repositories and provider-neutral artifact metadata remain in Platform Core. |
| Durable/audit state is not Redis-only | PASS | Redis is removed; PostgreSQL remains authoritative for commands, leases, inbox/outbox and audit. |
| Raw artifact policy remains compliant | PASS | Constitution VIII permits GitLab or approved object storage; v1 chooses the GitLab branch only. |
| Idempotency and external-effect recovery remain deterministic | PASS | Existing effect keys, leases, retries and owner confirmation are retained and covered by restart tests. |
| Workspace/Project security and classification remain intact | PASS | GitLab artifact access keeps the existing scoped reference and entitlement checks. |
| Local-first flow remains available | PASS | Local mocks and metadata-only manual QA flow do not require Redis, S3, VPN or production credentials. |
| Versioning/migration policy is explicit | PASS | Public upload routes are removed as a v1 pre-release contraction; historical migrations are not silently reinterpreted. |
| Constitutional amendment required | NO | The constitution allows GitLab-hosted raw artifacts and forbids relying solely on Redis; an ADR records the narrower implementation choice. |

**Post-design re-check**: PASS. The contract introduces no new authority or storage
owner. The data model retains all constitutional entities and invariants. No
constitution change or complexity exception is required.

## Project Structure

### Documentation (this feature)

```text
specs/010-remove-redis-s3/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── v1-infrastructure-boundary.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/
├── api/src/                 # QA HTTP surface after attachment-upload removal
└── worker/src/              # PostgreSQL-backed background handlers

packages/
├── platform-core/src/       # durable commands/outbox/artifact metadata
├── platform-persistence-typeorm/src/
├── connector-gitlab/src/    # sole v1 artifact byte owner/access path
└── runtime-composition/src/ # v1 dependency/configuration wiring

infra/compose/               # PostgreSQL + app containers, no Redis/S3Mock
docs/
├── adr/                     # ADR for the v1 simplification
├── architecture/
├── deployment/
└── runbooks/

tests/
├── architecture/010-*.spec.ts
├── integration/010/
└── e2e/010-*.spec.ts

tools/verification/feature-010-gate.mts
```

**Structure Decision**: Сохраняется существующий monorepo. Удаляется отдельный
`packages/platform-queue-bullmq`, а provider-neutral contracts остаются в их текущих
владельцах. Новая replacement abstraction не создаётся: runtime уже обрабатывает
durable PostgreSQL state напрямую.

## Complexity Tracking

Нарушений конституции и исключений сложности нет.
