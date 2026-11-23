# Продолжение локального аудита: Compose smoke 007/T176

> Исторический отчёт контура до ADR-0009. Он не определяет текущие зависимости v1;
> актуальная версия запускается без Redis и S3.

Дата: 2026-09-07. T176 закрыта после полного PASS на свежем изолированном Compose.
Проверялся текущий рабочий каталог с ранее существовавшими изменениями. Коммиты,
публикация и корпоративный deploy не выполнялись.

| Обнаружено                                                                                                 | Исправление и доказательство                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Старый smoke делегировал 006 и in-memory сценарий, browser перехватывал HTML                               | Новый smoke использует реальные API/worker/web/DB, отдельный Chromium, SQL счётчики, семь рестартов и обязательную scoped очистку                                          |
| Обычная локальная сессия не могла выполнить действия, требующие step-up                                    | Явный local-only step-up подписывает новый токен; ordinary registration 403, unauthenticated step-up 401, подмена persona в body 400; новая подпись проверяется через JWKS |
| Fresh seed выполнялся после миграций, у ALPHA отсутствовал onboarding head; worker оставлял command QUEUED | Штатный CLI seed дополняет отсутствующие legacy heads, сохраняет DRAFT/MANUAL_ONLY и existing SUSPENDED; PostgreSQL 17/18 и реальный worker подтверждают исправление       |
| Worker пропускал PROJECT_OPERATIONAL_STATE_CHANGED: 3 ACK на 4 события                                     | Добавлено событие в выборку; все 4 ACK, повторная доставка сохраняет 4 receipts                                                                                            |
| Ошибка sink оставляла event в памяти как duplicate, и повтор мог быть подтверждён без записи               | В applied-set event попадает только после успешного sink; отдельный тест сначала воспроизвёл потерю retry, затем прошёл                                                    |
| CLI status печатал константы DRAFT/ACTIVE и фиктивные IDs                                                  | Читает реальные onboarding heads; smoke подтверждает SUSPENDED нового SMOKE007                                                                                             |
| Generated reports попадали в Docker build context                                                          | Reports и вложенные локальные key-history directories исключены из image context                                                                                           |

Итоговый smoke: `awp-local-007-smoke-mtq9uwie-43429`,
`2026-09-06T20:36:16.796Z` — `2026-09-06T20:37:48.231Z` (7 сентября локально).
Все **9 этапов PASS**. Перезапущены PostgreSQL, Redis, Mock Hub, worker, API,
web и S3Mock. Сохранились подпись, manifest hash, S3 bytes, SUSPENDED и единственные
Jira target issue/Work Item/command. Replay не добавил effects. Chromium скачал
metadata JSON; HTTP и browser создали ровно два exports и два audit events.
После cleanup осталось **0 containers, 0 networks, 0 volumes** проекта smoke.
25 исходных hashes native smoke совпадают с завершившейся сборкой.

Регрессия: **215/215 тестов, 91 файл**, 0 failures/skipped/todo. Включены все
Vitest suites 007, выбранные миграции, Fake IdP, runner boundaries, corporate
identity HTTP и API/worker entry-point regression. PostgreSQL 17.7/18.6,
root TypeScript, targeted ESLint и git diff whitespace check прошли.
Полные `ci:project`, `ci:007` и `ci:008` в этом продолжении не запускались;
их старые отчёты сохраняют историческое значение.

[Closure report и привязки к файлам](../../reports/project/onboarding-compose-smoke.json),
[native smoke](../../reports/007-project-onboarding-evidence-security/smoke.json),
[regression assertions](../../reports/project/onboarding-compose-smoke/regression-vitest.json),
[инструкция для CI, bootstrap, IdP/signer и очистки](../runbooks/onboarding-compose-smoke.md).
Неуспешные промежуточные попытки и диагностика сохранены в
`reports/project/compose-smoke-007/`; они не засчитываются как PASS.

Исходные IAM, подписанный manifest/package и Jira source issue — контролируемые
локальные предпосылки. Smoke не заменяет корпоративную сборку, настоящий MFA/KMS
или provider conformance. Ручной Session journey нового проекта доказан отдельно
T059; Jira worker smoke использует seeded ALPHA.

Закрыты **1342/1349** задач, в том числе **184/184** в 007. Осталось **7**:
локальная **008/T025** (полная прикладная corporate API/worker composition) и
**6 корпоративных**: T040, T057, T084, T104, T105, T106. Требования к монтажу и
внешним данным описаны в [deployment checklist](../runbooks/pilot-deployment-checklist.md).
