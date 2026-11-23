# Feature 008: данные для корпоративной интеграции

Этот документ можно передать владельцам Jira, GitLab, Mattermost, IAM, Vault,
сети, observability, PostgreSQL, безопасности и пилота. Он перечисляет только
данные и доказательства, которых нет в репозитории. Секреты, токены, cookie,
закрытые ключи, пользовательские данные и webhook payload передавать нельзя:
в пакет входят только непрозрачные ссылки на утверждённые записи и документы.

## Что разблокирует открытые задачи

| Задача           | Что нужно получить                                                                       | Кто подтверждает                                             | Результат                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| T040, C1         | IN-01–IN-05 и технические карточки трёх провайдеров                                      | QA Lead, владельцы Jira/GitLab/Mattermost, IAM, Vault и сети | Зафиксированный `provider-capabilities.json` для точных версий и диалектов |
| T057, N2         | Утверждённый полный пакет IN-01–IN-12, sandbox scope и фактический N2 evidence bundle    | Владельцы интеграций и корпоративный CI/operator             | PASS реальных non-production провайдеров и инфраструктурных границ         |
| T084, recovery   | Расширенный IN-08, изолированная цель восстановления и результат фактического PITR drill | DBA/platform owner и operator                                | Измеренные RPO/RTO, fence старого runtime и reconciliation                 |
| T104, shadow     | PASS-отчёты integration/security/recovery и human-reviewed shadow bundle                 | QA Lead                                                      | Нулевое число внешних business writes в shadow                             |
| T105–T106, pilot | IN-10–IN-12, точная human activation, истёкшее окно, наблюдения и две human reviews      | QA Lead и sponsor                                            | Проверяемый limited-pilot report и решение continue/adjust/stop            |

Локальный контур уже проверен отдельно. Эти задачи требуют наблюдений из
утверждённой корпоративной non-production среды и не закрываются локальными
fixture или искусственным изменением времени.

## Форма запроса владельцам систем

Заполните значения без секретов и приложите ссылки на утверждённые документы.
Все идентификаторы должны относиться к одному Workspace и разрешённому набору
Projects.

### Scope и провайдеры — IN-01, IN-02

- Workspace ID и Project ID начального sandbox/pilot.
- Jira: Cloud/Data Center, точная версия, base origin, project key/ID, workflow,
  issue types и поля, REST/webhook dialect, auth strategy, service account,
  разрешения, rate limits, timeout/retry semantics, webhook integrity/freshness,
  native idempotency и способ readback/reconciliation.
- GitLab: SaaS/self-managed, точная версия, base origin, group/project ID, ref и
  SHA policy, pipeline/suite/environment, REST/webhook dialect, auth strategy,
  разрешения, rate limits, timeout/retry semantics, Standard Webhook signature,
  trigger idempotency и способ independent readback.
- Mattermost: Cloud/self-hosted, точная версия, base origin, team/channel IDs,
  REST/callback dialect, auth strategy, bot/service account, разрешения, rate
  limits, timeout/retry semantics, подписанный gateway contract и intent binding.
- Для каждого провайдера: ссылка на документацию выбранной версии, разрешения и
  санитизированные discovery/payload examples. Значения `latest`, `unknown` и
  `tbd` не принимаются.

### Identity, secrets и сеть — IN-03, IN-04, IN-05

- OIDC issuer HTTPS, API audience, access-token dialect и algorithms, JWKS или
  introspection strategy, group mapping, offboarding bound, session lifetime,
  PKCE/redirect policy и step-up `acr`/`amr`/`auth_time` policy.
- Vault namespace/mount и workload-auth method; service principals; отдельные
  opaque refs для connector read/write/webhook, test account, artifact и signing;
  exact-version/rotation overlap; signing/public-key history; break-glass process.
- Разрешённые HTTPS origins и методы, CA/trust policy, DNS/IP allowlists, egress
  policy, публичные callback routes, ingress/gateway mode, mTLS/HMAC policy и
  redirect/DNS-rebinding restrictions.

### Telemetry, artifacts и безопасность — IN-06, IN-07, IN-09

- OTLP backend origin, mTLS refs, retention/redaction policy, допустимые metric
  dimensions, alert route и именованный on-call owner.
- Artifact mode: только `GITLAB_ONLY`; retention, checksum/version readback,
  export и historical verification policy без платформенной копии bytes.
- Release image digest `sha256:...`; scanner ID/version; vulnerability database
  ID/version/digest/publishedAt; scan/report freshness; severity policy; владельцы
  и сроки принятых рисков только для `MODERATE`/`LOW`. `CRITICAL` и `HIGH` должны
  быть закрыты.

### Recovery — IN-08

- `backupMethod: "PHYSICAL_PITR"`, approved backup destination/ref и recovery
  point, отдельный disposable `targetId`, restore owner.
- Числовые `maximumRpoSeconds >= 0` и `maximumRtoSeconds > 0`.
- Recovery и fence policy refs, `oldRuntimeFenceProofRef`, запрет egress для
  восстановленного runtime и доступ на independent provider readback.
- Требуемый drill: write after backup с потерянным локальным подтверждением,
  проверка immutable/audit/signature/artifact/public-key-history данных,
  восстановление PostgreSQL delivery state, Jira/GitLab/Mattermost reconciliation и timestamps для
  фактических RPO/RTO.

### Cohort, baseline и operation — IN-10, IN-11, IN-12

- Cohort ref, Workspace/Project/environment/suite, список human principals,
  QA Lead, sponsor, on-call, approved start/end dates и minimum sample.
- Baseline source refs, frozen definitions, timestamp mapping, inclusion/exclusion,
  sampling, denominators, manual/automated strata и human spot-check policy.
- Incident, suspension, rollback и resume runbooks; совместимый rollback
  image/configuration ref; communication owner; критерии stop/adjust/continue.

## Общий input package

Файл `config/pilot/input-package.json` имеет закрытую верхнеуровневую форму:

```json
{
  "schemaVersion": 1,
  "id": "corporate-pilot-inputs",
  "version": 1,
  "profile": "integration",
  "scope": {
    "workspaceId": "<workspace-id>",
    "projectIds": ["<project-id>"]
  },
  "entries": []
}
```

Каждая запись IN-01–IN-12 содержит:

```json
{
  "id": "IN-01",
  "version": 1,
  "workspaceId": "<тот же workspace-id>",
  "projectIds": ["<разрешённый project-id>"],
  "synthetic": false,
  "status": "ACCEPTED",
  "suppliedBy": "<principal или group ref>",
  "reviewedBy": "<reviewer principal или group ref>",
  "reviewedAt": "<ISO-8601 UTC>",
  "evidenceRef": "<immutable document/evidence ref>",
  "metadata": {},
  "contentHash": "sha256:<canonical hash записи без contentHash>"
}
```

`status` обязателен для non-local профилей и допускает только `ACCEPTED`.
`contentHash` вычисляется после окончательного заполнения записи; изменение любого
поля требует нового хеша и новой версии принятого input. Точные обязательные поля
`metadata` перечислены в
[pilot-inputs.md](../../specs/008-pilot-hardening-and-conformance/pilot-inputs.md).
После получения значений команда разработки заполнит пакет и рассчитает хеши.

Проверка C1 и полного N2 package:

```bash
pnpm verify:008:inputs -- --input config/pilot/input-package.json --stage C1
pnpm verify:008:inputs -- --input config/pilot/input-package.json --stage N2
```

## N2 evidence bundle

`reports/008-pilot-hardening-and-conformance/corporate-n2-evidence.json` создаётся
после фактического прогона в разрешённом sandbox. Каждый `evidenceHash` относится
к сохранённому, санитизированному наблюдению независимого источника.

```json
{
  "schemaVersion": 1,
  "kind": "CORPORATE_N2_CONFORMANCE",
  "sourceMode": "REAL_NON_PROD",
  "workspaceId": "<workspace-id>",
  "projectId": "<project-id>",
  "providers": [
    {
      "provider": "JIRA",
      "executed": true,
      "scopeAuthorized": true,
      "independentObservation": true,
      "evidenceHash": "sha256:<64 hex>"
    },
    {
      "provider": "GITLAB",
      "executed": true,
      "scopeAuthorized": true,
      "independentObservation": true,
      "evidenceHash": "sha256:<64 hex>"
    },
    {
      "provider": "MATTERMOST",
      "executed": true,
      "scopeAuthorized": true,
      "independentObservation": true,
      "evidenceHash": "sha256:<64 hex>"
    }
  ],
  "identity": { "executed": true, "status": "PASS", "evidenceHash": "sha256:<64 hex>" },
  "vault": { "executed": true, "status": "PASS", "evidenceHash": "sha256:<64 hex>" },
  "ingress": { "executed": true, "status": "PASS", "evidenceHash": "sha256:<64 hex>" },
  "telemetry": { "executed": true, "status": "PASS", "evidenceHash": "sha256:<64 hex>" },
  "startedAt": "<ISO-8601 UTC>",
  "finishedAt": "<ISO-8601 UTC later than startedAt>"
}
```

```bash
AWP_008_N2_EVIDENCE_BUNDLE=reports/008-pilot-hardening-and-conformance/corporate-n2-evidence.json \
  pnpm verify:008:integration -- --input config/pilot/input-package.json
```

N2 должен включать auth failure, 429/5xx, timeout до и после dispatch, worker
restart, duplicate/out-of-order events, forged/stale ingress, schema drift,
revoked scope, expired approval и configuration drift. Число внешних эффектов
снимается напрямую из провайдеров, а не из ответа handler.

## Release security bundle

Security command получает digest независимо от bundle и не принимает `--input`:

```bash
AWP_008_RELEASE_IMAGE_DIGEST=sha256:<64-hex-image-digest> \
AWP_008_RELEASE_SCAN_BUNDLE=reports/008-pilot-hardening-and-conformance/release-security.json \
  pnpm verify:008:security
```

Bundle имеет точную форму:

```json
{
  "schemaVersion": "release-security@1.0.0",
  "scanner": { "id": "<scanner-id>", "version": "<exact-version>" },
  "database": {
    "id": "<database-id>",
    "version": "<exact-version>",
    "digest": "sha256:<64 hex>",
    "publishedAt": "<ISO-8601 UTC>"
  },
  "policy": {
    "id": "<policy-id>",
    "version": "<exact-version>",
    "digest": "sha256:<64 hex>",
    "reportMaximumAgeMs": 86400000,
    "databaseMaximumAgeMs": 86400000,
    "acceptedRiskSeverities": ["MODERATE", "LOW"],
    "acceptedFindings": []
  },
  "report": {
    "schemaVersion": "security-scan@1.0.0",
    "kind": "IMAGE",
    "contour": "CORPORATE",
    "coverage": "FULL",
    "artifact": { "kind": "OCI_IMAGE", "digest": "sha256:<тот же image digest>" },
    "scanner": { "id": "<тот же scanner-id>", "version": "<та же exact-version>" },
    "database": {
      "id": "<тот же database-id>",
      "version": "<та же exact-version>",
      "digest": "sha256:<тот же database digest>",
      "publishedAt": "<то же время>"
    },
    "policy": {
      "id": "<тот же policy-id>",
      "version": "<та же exact-version>",
      "digest": "sha256:<тот же policy digest>"
    },
    "scannedAt": "<ISO-8601 UTC>",
    "findings": []
  }
}
```

Каждый finding содержит `id`, `component`, `installedVersion`, `severity` и
`status`; для принятого риска также нужны совпадающие `owner` и `expiresAt`.
Report обязан быть свежим corporate `FULL` image scan для точного digest и точных
scanner/database/policy revisions. Итог проверяется в
`security.json.corporateRelease`: требуются `status: "PASS"` и
`releaseEligible: true`.

## Recovery, shadow и observed pilot

Сначала IN-08 проверяется командой:

```bash
pnpm verify:008:recovery -- --input config/pilot/input-package.json
```

Даже полный IN-08 оставляет gate в `BLOCKED_INPUT`, пока корпоративный operator
не выполнит фактический drill и не сохранит PASS recovery report. Для shadow
корпоративный executor передаёт ссылки `{path, sha256}` на свежие non-local PASS
reports `integration`, `security` и `recovery` с тем же scope и fingerprints.

Shadow bundle содержит закрытый набор полей:

```json
{
  "schemaVersion": 1,
  "kind": "CORPORATE_SHADOW",
  "workspaceId": "<workspace-id>",
  "projectId": "<project-id>",
  "deploymentRef": "<immutable deployment ref>",
  "cohortRef": "<approved cohort ref>",
  "comparisonProtocolRef": "<approved protocol ref>",
  "prerequisites": {
    "integration": { "path": "<report path>", "sha256": "sha256:<64 hex>" },
    "security": { "path": "<report path>", "sha256": "sha256:<64 hex>" },
    "recovery": { "path": "<report path>", "sha256": "sha256:<64 hex>" }
  },
  "observationCount": 1,
  "differenceReportHash": "sha256:<64 hex>",
  "independentProviderWriteCount": 0,
  "providerObservationHash": "sha256:<64 hex>",
  "review": {
    "kind": "HUMAN",
    "role": "QA_LEAD",
    "principalId": "<principal>",
    "reviewedAt": "<ISO-8601 UTC>",
    "differenceReportHash": "sha256:<тот же hash>"
  },
  "startedAt": "<ISO-8601 UTC>",
  "finishedAt": "<ISO-8601 UTC later than startedAt>"
}
```

```bash
pnpm verify:008:shadow -- --input reports/008-pilot-hardening-and-conformance/corporate-shadow.json
```

После точной human activation и завершения реального окна limited-pilot report
должен содержать `schemaVersion: 1`, kind
`OBSERVED_CORPORATE_LIMITED_PILOT`, sourceMode `CORPORATE_OBSERVATION`, scope,
runId, `sampleSize >= minimumSample >= 1`, уже наступивший `windowEndAt`, непустые
`sourceEvidenceHashes`, independently counted `externalEffects` с `duplicates: 0`,
метрики с ненулевыми denominators, operator load, limitations и residual risks.

Ровно семь guardrails должны иметь `state: "PASS"` и
`independentlyObserved: true`:

- `CROSS_SCOPE_DISCLOSURES`;
- `UNAUTHORIZED_EXTERNAL_WRITES`;
- `DUPLICATE_EXTERNAL_EFFECTS`;
- `AUDITED_CORRELATED_WRITE_COVERAGE`;
- `VERDICT_EVIDENCE_CHAIN_COVERAGE`;
- `AGENT_WITHOUT_HUMAN_ACTIONS`;
- `SECRET_CANARY_OCCURRENCES`.

Нужны ровно две различные human reviews: `QA_LEAD` и `SPONSOR`, каждая с
`principalId` и `authorizationRef`.

Минимальная форма отчёта:

```json
{
  "schemaVersion": 1,
  "kind": "OBSERVED_CORPORATE_LIMITED_PILOT",
  "sourceMode": "CORPORATE_OBSERVATION",
  "workspaceId": "<workspace-id>",
  "projectId": "<project-id>",
  "runId": "<pilot-run-id>",
  "sampleSize": 1,
  "minimumSample": 1,
  "windowEndAt": "<already elapsed ISO-8601 UTC>",
  "sourceEvidenceHashes": ["sha256:<64 hex>"],
  "guardrails": [
    { "key": "CROSS_SCOPE_DISCLOSURES", "state": "PASS", "independentlyObserved": true },
    { "key": "UNAUTHORIZED_EXTERNAL_WRITES", "state": "PASS", "independentlyObserved": true },
    { "key": "DUPLICATE_EXTERNAL_EFFECTS", "state": "PASS", "independentlyObserved": true },
    { "key": "AUDITED_CORRELATED_WRITE_COVERAGE", "state": "PASS", "independentlyObserved": true },
    { "key": "VERDICT_EVIDENCE_CHAIN_COVERAGE", "state": "PASS", "independentlyObserved": true },
    { "key": "AGENT_WITHOUT_HUMAN_ACTIONS", "state": "PASS", "independentlyObserved": true },
    { "key": "SECRET_CANARY_OCCURRENCES", "state": "PASS", "independentlyObserved": true }
  ],
  "externalEffects": { "source": "INDEPENDENT", "writes": 0, "duplicates": 0 },
  "metrics": [{ "key": "<approved metric>", "value": 0, "denominator": 1 }],
  "reviews": [
    {
      "kind": "HUMAN",
      "role": "QA_LEAD",
      "principalId": "<principal>",
      "authorizationRef": "<approval ref>"
    },
    {
      "kind": "HUMAN",
      "role": "SPONSOR",
      "principalId": "<principal>",
      "authorizationRef": "<approval ref>"
    }
  ],
  "operatorLoadMinutes": 0,
  "limitations": [],
  "residualRisks": []
}
```

```bash
pnpm verify:008:review -- --input reports/008-pilot-hardening-and-conformance/limited-pilot.json
```

## Критерий готовности перед запуском

Пакет можно передавать в корпоративный прогон, когда C1 и N2 input validation
дают PASS, ссылки и scope совпадают, нет inline secrets или fixture refs, версии
провайдеров зафиксированы, sandbox письменно разрешён, named owners указаны, а
recovery target действительно disposable. Изменение входа, source, contracts,
migrations, lockfile, configuration, suite, image или scanner database требует
повторного зависимого gate.
