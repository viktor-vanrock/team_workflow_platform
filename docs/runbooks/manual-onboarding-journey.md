# Ручной onboarding: API, PostgreSQL и worker

Сценарий `tests/e2e/007/us1-manual-onboarding.spec.ts` запускает API и requested
probe worker в отдельных дочерних процессах с разными DataSource. Через IPC идут
только команды запуска/остановки и результаты worker; бизнес-состояние хранится
в PostgreSQL. Тест проходит на PostgreSQL 17 и 18; T059 закрыта локально.

Через HTTP выполняются регистрация нового проекта, выдача project entitlements,
публикация environment/data/pool/context, validation и QA-lead acceptance,
подтверждённая другим человеком публикация Binding и оценка L0 MANUAL_ONLY.
Worker читает durable probe request и делает четыре безопасных GET к локальному
provider. GitLab Binding и Suite отсутствуют. После этого HTTP создаёт ручную
Session, переводит её в READY и RUNNING; автоматическая Session получает 409
`AUTOMATION_REQUIRES_FULL_QA` до обращения к Suite adapter.

IAM-роли, Connection/Profile metadata, ответ локального provider и уже принятый
QA Request с readiness/required plan являются явно заданными предпосылками теста.
Это не доказательство корпоративного IAM, импорта настоящего Jira Request,
реального C1/N2 или полного Compose smoke T176.

## Изменения runtime

`QaProjectResourceRepository.appendContext` сохраняет общую scoped identity в
`qa_project_contexts`, на которую ссылается существующий FK QA Request. Содержимое
v2 остаётся в своих immutable revisions. Legacy policy revision не создаётся;
её published pointers не меняются.

`QaSessionsController` читает environment catalog опубликованного Context v2
непосредственно. Local session runtime получает реальные published Profile refs
onboarding-проекта. Старые исторические bootstrap-записи сохраняют legacy путь;
новый DRAFT/непроверенный проект через него пройти не может.

При RUNNING `session-facts.ts` проверяет текущие Core state, Binding, Profile,
Connection/Mapping, validation report, context, environment, test data и lease.
В той же транзакции сохраняется `qa_target_snapshots_v2`: точные refs/hash и
schema-bound опубликованный Context v2. Source refs включают onboarding revision
и required plan. Legacy Session DTO/hash остаётся совместимым; v2 — дополнительная
неизменяемая запись с `snapshotId=sessionId`, используемая для точной provenance.
При повторном входе в RUNNING существующий snapshot не переписывается, изменение
его зависимостей отклоняется. Ошибка аудита откатывает переход и snapshot вместе.

Автоматическая Session проверяет mode и перед обращением к adapter, и внутри
своей PostgreSQL persistence transaction с блокировкой Core header. Изменение
mode/suspension не может обойти финальную проверку перед записью.

Административный audit сохраняет точные Core onboarding refs до и после операции
в `attributes.before/after`, а `resultRef` указывает на результат операции.
Исходная ref фиксируется при первой блокировке header в транзакции. Старые
audit records не переписываются; для операций без смены Core revision refs равны.

## Что добавить в pipeline

1. Доставить обновлённые QA resource repository, manual/automated controllers,
   `session-facts.ts`, local/published session runtime, automated-session UoW и
   `durable-http.ts` с before/after audit refs
   одной сборкой. Corporate factories/controllers остаются задачей 008/T025;
   local identity adapter на стенд не переносить.
2. Для контекстов, опубликованных предыдущей сборкой, выполнить
   [qa-context-v2-identities.sql](sql/qa-context-v2-identities.sql) после миграций и
   до открытия входящих QA-запросов. Скрипт повторяемый, проверяет конфликт scope и
   не меняет immutable данные. Проверка `missing_context_identities` должна дать 0.
   Новые публикации создают identity автоматически. Schema pins: Core 230 / QA 2110.
3. Выдать участникам проверенные IAM roles и HTTP project entitlements; настроить
   реальные published Context/Binding refs, безопасные connector observers и
   account inventory по [onboarding-http.md](onboarding-http.md).
4. В CI запускать следующую проверку с Docker и Node 24:

   ```sh
   CI=true AWP_RUN_CONTAINER_TESTS=true pnpm exec vitest run \
     tests/e2e/007/us1-manual-onboarding.spec.ts --maxWorkers=1
   ```

   Проверить ноль automated Sessions/provider writes, четыре requested probes,
   атомарный audit rollback и сохранность refs после API/worker restart. Тест
   также дважды применяет upgrade SQL без создания legacy policy revision;
   новая environment head блокирует новую Session, сохраняя старый v2 snapshot.

5. Закрытая T106 включается в CI по [инструкции](project-scope-journey.md).
   T176 закрыта; перед выпуском повторить [Compose smoke](onboarding-compose-smoke.md)
   и выполнить корпоративную приёмку из
   [pilot-deployment-checklist.md](pilot-deployment-checklist.md).
   При откате приложения оставить shared identities и v2 snapshots: удалять
   provenance или переписывать историю не требуется.

## Доказательства

Регрессия: **184/184 теста в 76 файлах**, без skipped/todo; root TypeScript,
целевой ESLint и `git diff --check` прошли. Сценарий T059 содержит два запуска
с PostgreSQL 17.7 и 18.6. Дополнительный persistence-тест подтверждает запрет
automated Session при MANUAL_ONLY внутри транзакции.

[Отчёт, логи и source hashes](../../reports/project/manual-onboarding-journey.json).
Полный `ci:project`/`ci:008`, Compose smoke T176 и корпоративная приёмка в этот
результат не входят. Исторические отчёты предыдущих закрытий не изменены.
