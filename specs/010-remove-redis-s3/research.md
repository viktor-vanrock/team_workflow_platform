# Research: Упрощение первой версии без Redis и S3

## Decision 1: PostgreSQL остаётся единственным durable delivery mechanism

**Decision**: Удалить Redis/BullMQ из dependency graph и local deployment. Worker
продолжает забирать durable commands/outbox records из PostgreSQL с lease, retry,
idempotency/effect key и recovery после рестарта.

**Rationale**: Текущий production runtime уже исполняет business workers через
PostgreSQL polling. BullMQ package не подключён к runtime Queue/Worker и создаёт
ложную инфраструктурную обязанность без дополнительной гарантии доставки.

**Alternatives considered**:

- Оставить Redis как optional accelerator — отклонено: появляются два режима
  доставки и необходимость доказывать их эквивалентность.
- Перенести authority в BullMQ — отклонено: это усложняет exactly-once effects,
  recovery и противоречит цели первой версии.
- Добавить in-process queue — отклонено: процессная память не является durable
  authority и не переживает рестарт.

## Decision 2: GitLab является единственным владельцем artifact bytes в v1

**Decision**: Удалить S3/S3Mock runtime implementations, bucket initialization,
credentials, local fixtures и fallback routing. CI artifact bytes остаются в GitLab;
платформа хранит только scoped metadata, checksum, provenance и availability.

**Rationale**: GitLab уже является authoritative CI provider. Копия в S3 увеличивает
стоимость, секреты, retention/lifecycle surface и риск рассинхронизации, не добавляя
ценности обязательному QA flow первой версии.

**Alternatives considered**:

- Оставить S3Mock только локально — отклонено: локальный контракт перестаёт
  соответствовать целевому v1 profile и продолжает тянуть S3 code path.
- Хранить bytes в PostgreSQL — отклонено: раздувает основную БД и смешивает durable
  workflow state с bulk artifact storage.
- Использовать локальную файловую систему — отклонено: не переносится между
  экземплярами и создаёт ещё один неподдерживаемый storage mode.

## Decision 3: Manual binary QA attachments исключаются из публичной v1 surface

**Decision**: Удалить attachment upload/complete/read endpoints и runtime provider.
Текстовые observations, attempt results, evidence manifests, review и verdict
сохраняются. Автоматический flow может ссылаться на разрешённые GitLab artifacts.

**Rationale**: Без платформенного byte store upload API не может дать честную
durability/retention гарантию. Metadata-only QA flow покрывает основную ценность v1.

**Alternatives considered**:

- Принимать вложение и временно проксировать его — отклонено: создаёт неявную
  retention и failure semantics.
- Оставить endpoints за feature flag — отклонено: публичный контракт и dormant
  secrets остаются частью поставки.

## Decision 4: Generic artifact metadata сохраняется

**Decision**: Сохранить `ArtifactReference`, manifest membership, checksum,
classification, scope и provider-neutral read boundary, поскольку они нужны GitLab
artifacts. Удаляются только S3-specific adapters и routing branches.

**Rationale**: Artifact metadata является обязанностью Platform Core по конституции
и нужна для audit даже после expiry удалённого GitLab artifact.

**Alternatives considered**:

- Заменить все generic references GitLab-specific entity — отклонено: это переносит
  infrastructure detail в core model и усложняет возможное будущее расширение.
- Удалить artifact references полностью — отклонено: теряются provenance, checksum,
  classification и audit.

## Decision 5: Историческую схему не переписываем молча

**Decision**: Не выполнять destructive migration для непроизводственных upload
records в рамках этой задачи. Runtime/API и новые bootstrap paths перестают создавать
такие данные; исторические migration/spec artifacts остаются историей и получают
явную supersession note там, где описывают текущий v1.

**Rationale**: Конституция требует явной compatibility policy и запрещает silent
reinterpretation. Производственных S3 bytes нет, поэтому data migration не нужна,
а удаление таблиц не помогает достижению runtime цели.

**Alternatives considered**:

- Удалить старые миграции — отклонено: ломает воспроизводимость ранее применённых
  schema histories.
- Сразу drop upload tables — отклонено: необратимо и не требуется для отключения
  runtime capability.

## Decision 6: Отсутствие сервисов проверяется как продуктовый инвариант

**Decision**: Добавить feature-010 gate: static dependency/configuration scan,
Compose service inventory, API contract assertions, metadata-only manual flow,
GitLab artifact access и PostgreSQL restart-recovery tests.

**Rationale**: Одна успешная локальная загрузка не доказывает, что скрытый Redis/S3
path не остался в production graph или документации.

**Alternatives considered**:

- Полагаться только на typecheck — отклонено: typecheck не проверяет Compose,
  secrets, readiness и обещания документации.
- Проверять только отсутствие процессов — отклонено: dormant dependencies и API
  surface всё равно создают будущую эксплуатационную обязанность.
