# Локальный Compose smoke onboarding/evidence — 007/T176

Команда `pnpm smoke:007` собирает текущий runtime image и создаёт уникальный
Compose project `awp-local-007-smoke-<timestamp>-<pid>`. API, worker, web,
PostgreSQL, Mock Hub и Fake IdP работают в отдельных контейнерах.
Пять случайных портов публикуются только на `127.0.0.1`; внутренняя сеть
запрещает внешний egress. Production authority в этом сценарии отсутствует.

## Что проверяется

1. Миграции и штатный seed выполняются на новой PostgreSQL 18.6. Проверяются
   readiness и различные PID семи основных сервисов. После seed дополняются
   отсутствующие legacy onboarding heads: DRAFT/MANUAL_ONLY, без новых gates.
   Существующие heads и состояние SUSPENDED сохраняются.
2. Обычная сессия owner получает отказ при регистрации. Явный локальный step-up
   позволяет зарегистрировать новый SMOKE007 через опубликованный HTTP API.
   Неавторизованный step-up и попытка выбрать другую identity отклоняются.
3. Контролируемая fixture добавляет роли для нового project scope и исходные
   подписанные manifest/package/context. Права на evidence и suspension выдаются
   через HTTP с текущим ETag. Manifest проверяется настоящей Ed25519 подписью;
   JSON export создаёт durable receipt и audit. Чужой principal получает 404.
4. Worker останавливается. HTTP создаёт intake draft в seeded ALPHA и ставит
   Jira command в очередь: provider effects и Work Items пока равны нулю.
   Отдельно запущенный worker подтверждает команду: ровно один target Jira issue,
   один Work Item и одна command на draft. Созданный для входа source issue
   не включается в число target effects.
5. Новый SMOKE007 приостанавливается через HTTP. Все его onboarding события
   подтверждаются worker; намеренная повторная доставка сохраняет число inbox
   receipts. Это проверка транспортной обработки, не отдельной бизнес-проекции.
6. По очереди перезапускаются PostgreSQL, Mock Hub, worker, API и web.
   Проверяются новые StartedAt и readiness, неизменные счётчики и hashes,
   SUSPENDED, повторная проверка подписи и прежний metadata export,
   идемпотентный повтор confirmation/export без новых effects. CLI status читает
   фактический onboarding head и показывает SUSPENDED нового проекта.
7. Отдельный Chromium открывает настоящий web, читает SUSPENDED, проверяет
   manifest и скачивает metadata JSON после явного development step-up.
   Итог — два exports и две записи export audit: HTTP и browser.
8. Даже после ошибки выполняется scoped `compose down --volumes`; проверки
   Docker labels требуют ноль оставшихся containers, networks и volumes.

Начальные IAM/evidence данные подготовлены напрямую и отмечены в отчёте.
Полный запуск ручной Session нового проекта доказан отдельно в
[007/T059](manual-onboarding-journey.md). Jira worker smoke использует ALPHA.
Контейнерный smoke проверяет PostgreSQL 18; матрица PostgreSQL 17/18 находится
в integration и независимых HTTP journeys. Development signer/Fake IdP/Mock Hub
не заменяют корпоративные KMS, MFA или выбранные provider installations.

## Запуск и подключение к GitLab

На выделенном shell runner нужны версии Node/pnpm из `package.json`, Docker
Engine с Compose v2, Chromium и системные зависимости Playwright. Runner должен
иметь доступ к Docker socket и loopback. Нужны pinned images из
`infra/compose/docker-compose.local.yml` и pnpm cache либо доступ к registry
во время сборки. При первом запуске download/build занимает больше времени.

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm smoke:007 --plan
pnpm smoke:007
```

В `.gitlab-ci.yml`, job `verify:local`, smoke добавлен после `pnpm ci:008`.
Используется существующий `resource_group: awp-local-docker`: сборки разделяют
локальный image tag и должны выполняться последовательно на одном Docker daemon.
Падение smoke завершает job ошибкой. `pnpm ci:007` также содержит этот этап;
отдельный `test:007` выполняет unit/integration и обычные browser suites, а
`compose-live.spec.ts` запускается только дочерним runner этого smoke.

Артефакты с `when: always`:

- `reports/007-project-onboarding-evidence-security/smoke.json` — последний
  результат со стадиями, restart proof, исходными SHA-256 и cleanup;
- `reports/project/compose-smoke-007/<project>/result.json` — результат отдельной
  попытки, остающийся после следующего запуска;
- тот же каталог — build, health, SQL counts, browser и failure container logs;
- `playwright-report/` и `test-results/` — диагностика браузера.

Нельзя принимать PASS старого smoke как доказательство изменённого исходного
кода: сверить `sourceBinding.files` и текущие hashes. Изменение связанных файлов
во время smoke переводит результат в FAIL. Generated reports и локальная
история ключей исключены из Docker build context.

При принудительном уничтожении runner процесс не сможет выполнить `finally`.
Для уборки использовать точный `isolatedProjectName` своего отчёта и тот же
Compose file с `down --volumes --remove-orphans`; сначала проверить label
`com.docker.compose.project`. Не удалять общий `awp-local` и чужие volumes.

## Перенос в реальный pipeline

Локальный step-up доступен только профилю `local`. UI вызывает guarded
`POST /local/persona/step-up` с пустым body; identity берётся из проверенной
сессии. Fake IdP подписывает новый токен с `auth_time` и development MFA marker.
При смене persona снова выдаётся обычная сессия. Для corporate host подключить
`CorporateSessionService` и настоящий IdP/CSRF/step-up; локальный controller и
Fake IdP туда не регистрировать.

Для корпоративной реализации остаётся 008/T025: собрать прикладные API и worker
с текущими опубликованными configuration/authority providers, corporate storage
и signer/key history. Требования по конкретным точкам подключения и шесть
стендовых gates перечислены в [deployment checklist](pilot-deployment-checklist.md).
Проверки реальных C1/N2/P3 выполняются с данными и доступами корпоративной команды.
