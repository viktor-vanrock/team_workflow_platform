# Паспорт внедрения — заполнить перед запуском

Статус: **DRAFT / запуск не согласован**. Инструкция: [комплект деплоя](../README.md).
Рабочую копию вести в корпоративном хранилище. `ЗАПОЛНИТЬ` заменить фактическими
значениями; `N/A` допустимо с причиной и owner review. Поля refs содержат ссылки,
версии и hashes документов, но не секреты. Этот Markdown runtime не читает.

## Решение и scope

| Поле                                                          | Значение  |
| ------------------------------------------------------------- | --------- |
| Change/release request, версия паспорта                       | ЗАПОЛНИТЬ |
| Цель: первый integration / ограниченный pilot / upgrade       | ЗАПОЛНИТЬ |
| Среда                                                         | NON_PROD  |
| Платформа размещения, cluster/namespace либо VM/service group | ЗАПОЛНИТЬ |
| Workspace UUID / Project UUID                                 | ЗАПОЛНИТЬ |
| Deployment UUID / version / exact ref                         | ЗАПОЛНИТЬ |
| Composition / integration либо pilot profile                  | ЗАПОЛНИТЬ |
| Maintenance window и timezone, плановый start/end             | ЗАПОЛНИТЬ |
| Cohort / QA suite / NON_PROD provider scope                   | ЗАПОЛНИТЬ |
| Минимальная выборка, observation window, stop thresholds      | ЗАПОЛНИТЬ |

## Владельцы

| Ответственность                                    | Имя / команда | Контакт / approved ref |
| -------------------------------------------------- | ------------- | ---------------------- |
| Delivery owner и оператор rollout                  | ЗАПОЛНИТЬ     | ЗАПОЛНИТЬ              |
| Разработка API/worker/web и T025                   | ЗАПОЛНИТЬ     | ЗАПОЛНИТЬ              |
| Platform/CI/registry                               | ЗАПОЛНИТЬ     | ЗАПОЛНИТЬ              |
| Project owner / Integration Jira/GitLab/Mattermost | ЗАПОЛНИТЬ     | ЗАПОЛНИТЬ              |
| IAM/IdP                                            | ЗАПОЛНИТЬ     | ЗАПОЛНИТЬ              |
| Security/Vault/signing                             | ЗАПОЛНИТЬ     | ЗАПОЛНИТЬ              |
| Network/ingress/DNS/PKI                            | ЗАПОЛНИТЬ     | ЗАПОЛНИТЬ              |
| DBA / restore operator                             | ЗАПОЛНИТЬ     | ЗАПОЛНИТЬ              |
| Artifact/telemetry/model                           | ЗАПОЛНИТЬ     | ЗАПОЛНИТЬ              |
| QA Lead / Sponsor / activation approver            | ЗАПОЛНИТЬ     | ЗАПОЛНИТЬ              |
| On-call и incident communication                   | ЗАПОЛНИТЬ     | ЗАПОЛНИТЬ              |

## Адреса, сеть, ресурсы

| Компонент                   | Endpoint / ресурс                                  | Доступ: source → destination:port; CA/policy ref     | Ресурсы / владелец                 |
| --------------------------- | -------------------------------------------------- | ---------------------------------------------------- | ---------------------------------- |
| Browser + BFF               | ЗАПОЛНИТЬ HTTPS origin                             | ЗАПОЛНИТЬ                                            | ЗАПОЛНИТЬ                          |
| API / worker health         | ЗАПОЛНИТЬ service/ports                            | ЗАПОЛНИТЬ внутренний доступ                          | ЗАПОЛНИТЬ replicas/CPU/RAM/grace   |
| PostgreSQL                  | ЗАПОЛНИТЬ host/database/version, без пароля        | ЗАПОЛНИТЬ TLS/role refs                              | ЗАПОЛНИТЬ HA/CPU/RAM/disk/capacity |
| IdP                         | ЗАПОЛНИТЬ issuer/JWKS/audience/client ID           | ЗАПОЛНИТЬ                                            | ЗАПОЛНИТЬ                          |
| Vault / signer              | ЗАПОЛНИТЬ endpoint/namespace/key policy ref        | ЗАПОЛНИТЬ workload identity/purpose refs             | ЗАПОЛНИТЬ rotation/owner           |
| Jira                        | ЗАПОЛНИТЬ endpoint/edition/version/project         | ЗАПОЛНИТЬ profile/connection/binding                 | ЗАПОЛНИТЬ rate/timeouts            |
| GitLab                      | ЗАПОЛНИТЬ endpoint/edition/version/project/ref/SHA | ЗАПОЛНИТЬ profile/connection/binding                 | ЗАПОЛНИТЬ suite/runner             |
| Mattermost                  | ЗАПОЛНИТЬ endpoint/edition/version/team/channel    | ЗАПОЛНИТЬ profile/connection/binding                 | ЗАПОЛНИТЬ                          |
| Webhook receivers / gateway | ЗАПОЛНИТЬ URL/mode/dialect                         | ЗАПОЛНИТЬ methods/body limits/mTLS/HMAC refs         | ЗАПОЛНИТЬ                          |
| GitLab artifact             | ЗАПОЛНИТЬ project/ref/job и API origin             | ЗАПОЛНИТЬ scoped read credential policy, не материал | ЗАПОЛНИТЬ retention/export         |
| Model/Hermes                | ЗАПОЛНИТЬ endpoint/model/version либо reason N/A   | ЗАПОЛНИТЬ policy/data restrictions                   | ЗАПОЛНИТЬ limits/timeout/fallback  |
| Collector / backend         | ЗАПОЛНИТЬ endpoints                                | ЗАПОЛНИТЬ workload/exporter cert/CA refs             | ЗАПОЛНИТЬ retention/alert          |
| Registry / runners          | ЗАПОЛНИТЬ registry и runner IDs/tags               | ЗАПОЛНИТЬ push/pull/deploy roles                     | ЗАПОЛНИТЬ CPU/RAM/disk/lock        |

OIDC callback: **ЗАПОЛНИТЬ browser origin** + `/api/v1/auth/callback`.
Session TTL / idle TTL / step-up policy / offboarding SLA / encryption-key
delivery и rotation: **ЗАПОЛНИТЬ**. Рабочие membership/role/project assignments: **ЗАПОЛНИТЬ**.
Получатель первого корпоративного входа, время и доказательство однократного
назначения администратора: **ЗАПОЛНИТЬ**. Режим provisioning: `true`; группы
Keycloak не назначают права. Для отдельного legacy-режима `false` указать
обоснование, заранее зарегистрированные identity и проверенные group mappings.
См. [контракт корпоративного доступа](../corporate-access.md).

## Неизменяемый состав релиза

| Объект                                                                | Значение / evidence ref                                                                                      |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Repository commit SHA и локальный gate для этой ревизии               | ЗАПОЛНИТЬ                                                                                                    |
| Общий backend image `registry/repository@sha256:…`                    | ЗАПОЛНИТЬ                                                                                                    |
| API и worker entrypoint команды в этом image                          | ЗАПОЛНИТЬ                                                                                                    |
| Web image `registry/repository@sha256:…`                              | ЗАПОЛНИТЬ                                                                                                    |
| Web build composition/origin и browser journey report                 | ЗАПОЛНИТЬ                                                                                                    |
| SBOM и FULL scans каждого image; scanner/DB versions/freshness        | ЗАПОЛНИТЬ                                                                                                    |
| Input package id/version/contentHash/profile                          | ЗАПОЛНИТЬ                                                                                                    |
| Девять policy refs и три connector refs                               | ЗАПОЛНИТЬ ссылку на заполненный DeploymentPolicy                                                             |
| DeploymentPolicy canonical hash / current publication refs            | ЗАПОЛНИТЬ                                                                                                    |
| Runtime env delivery, secret store refs, network/cert policy versions | ЗАПОЛНИТЬ                                                                                                    |
| Deployment manifests / migration job / wrapper revision               | ЗАПОЛНИТЬ                                                                                                    |
| Current schema → target schema                                        | ЗАПОЛНИТЬ; target из registry: Core 235 / Dummy 1000 / Tech Writing 1100 / QA 2110 / Jira 3050 / GitLab 4020 |
| Bootstrap IAM/config publications, author/approver                    | ЗАПОЛНИТЬ                                                                                                    |

## Backup и откат

| Поле                                                             | Значение                                    |
| ---------------------------------------------------------------- | ------------------------------------------- |
| Backup method / destination / schedule / retention               | ЗАПОЛНИТЬ PHYSICAL_PITR для corporate drill |
| Recovery point / backup ID / проверка пригодности                | ЗАПОЛНИТЬ                                   |
| Отдельная restore target / network isolation                     | ЗАПОЛНИТЬ                                   |
| Допустимые maximumRpoSeconds / maximumRtoSeconds                 | ЗАПОЛНИТЬ числа                             |
| Как остановить новые команды и fenced все старые runtime         | ЗАПОЛНИТЬ проверяемую operator procedure    |
| Old-runtime fence proof ref                                      | ЗАПОЛНИТЬ после действия                    |
| Совместимый rollback backend/web/config/schema target            | ЗАПОЛНИТЬ                                   |
| Provider readback и разбор ambiguous effects                     | ЗАПОЛНИТЬ owner/procedure                   |
| Restore/reconciliation/signatures/queue drill evidence           | ЗАПОЛНИТЬ                                   |
| Фактические RPO/RTO, start/end, целостность audit/artifacts/keys | ЗАПОЛНИТЬ после drill                       |
| Resume prerequisites и отдельный approver                        | ЗАПОЛНИТЬ                                   |

## Приёмка и решение

Для каждого этапа указать **NOT_RUN / BLOCKED / FAIL / PASS**, actual time,
executor/reviewer, scope и immutable evidence ref. Пустая строка не означает PASS.

| Этап                                                        | Статус  | Evidence ref / время / reviewer |
| ----------------------------------------------------------- | ------- | ------------------------------- |
| T025: полный app/images + HTTP/worker/restart/browser proof | NOT_RUN | ЗАПОЛНИТЬ                       |
| C1 / T040: metadata и выбранные установленные adapters      | NOT_RUN | ЗАПОЛНИТЬ                       |
| Все 12 metadata entries / current publications              | NOT_RUN | ЗАПОЛНИТЬ                       |
| Backup/preflight/migrations/initial publications            | NOT_RUN | ЗАПОЛНИТЬ                       |
| API/worker readiness и реальный business journey            | NOT_RUN | ЗАПОЛНИТЬ                       |
| N2 / T057: providers/IAM/Vault/network/ingress/telemetry    | NOT_RUN | ЗАПОЛНИТЬ                       |
| Security каждого image, releaseEligible                     | NOT_RUN | ЗАПОЛНИТЬ                       |
| Recovery / T084                                             | NOT_RUN | ЗАПОЛНИТЬ                       |
| Shadow / T104: ноль business writes и human review          | NOT_RUN | ЗАПОЛНИТЬ                       |
| Точное human activation и переход к pilot                   | NOT_RUN | ЗАПОЛНИТЬ                       |
| T105: фактическое окно/выборка/guardrails                   | NOT_RUN | ЗАПОЛНИТЬ                       |
| T106: observed review / stop-adjust-continue                | NOT_RUN | ЗАПОЛНИТЬ                       |
| On-call/alerts/backup schedule/access handover              | NOT_RUN | ЗАПОЛНИТЬ                       |

Решение для конкретного этапа: **HOLD до заполнения и review**.
Кто принял, когда, что разрешено, до какого срока, refs релиза и evidence:
**ЗАПОЛНИТЬ**. Следующая дата review / открытые условия / владелец: **ЗАПОЛНИТЬ**.
