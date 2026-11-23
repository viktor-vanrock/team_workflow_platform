# Что заполнить и кто предоставляет данные

[Комплект деплоя](README.md) · [Паспорт](templates/deployment-passport.md)

## Рабочие копии

В корне репозитория создайте рабочие копии. `.pipeline-inputs/` уже исключён из
Git и Docker context. Это место подготовки, а не долговременное хранилище.
Утверждённые документы передайте в версионируемое корпоративное хранилище.

```sh
mkdir -p .pipeline-inputs
cp -n docs/deployment/templates/input-package.template.json .pipeline-inputs/inputs.json
cp -n docs/deployment/templates/deployment-policy.template.json .pipeline-inputs/deployment.json
cp -n docs/deployment/templates/deployment-passport.md .pipeline-inputs/deployment-passport.md
```

`cp -n` сохраняет ранее заполненную копию. Не помещайте в пакет пароли, токены,
private keys, session cookies или исходные пользовательские данные. Для секретов
нужны opaque refs, purpose, версия и политика доступа; материал доставляется
отдельно. Данные в `metadata.*Ref` — строки-ссылки на утверждённые документы;
поля `*Ref` внутри DeploymentPolicy — объекты `{id, version, contentHash}`.

## Содержание IN-01…IN-12

Шаблон содержит точные имена обязательных полей текущего
[валидатора](../../packages/platform-core/src/pilot/input-package.ts).
`null` и пустые массивы означают «предоставить значение».

| ID / владелец                | Что предоставить                                                                                                               | Где используется                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| IN-01 · Project owner        | Workspace/Project UUID, Jira workflow/fields, GitLab suite/ref, NON_PROD environment, Mattermost channels                      | `workspaceRef`, `projectRefs`, `workflowRef`, `suiteRef`, `environmentRef`, `channelRefs`; scoped registry и QA context           |
| IN-02 · Integration owner    | Для JIRA/GITLAB/MATTERMOST: edition, точная версия, API/webhook dialect, auth strategy, документация и permissions             | Три записи `providers`; выбранные connector profile/connection/binding и T040                                                     |
| IN-03 · IAM owner            | HTTPS issuer, audience, token dialect; group mapping, session/step-up policy; client ID, auth method, JWKS, logout/offboarding | Metadata refs; typed OIDC/session bindings. Callback строго `{browserOrigin}/api/v1/auth/callback`                                |
| IN-04 · Security/Vault owner | Workload auth, resolver policy, purpose-scoped secret refs, signing, rotation и break-glass                                    | `authMethod`, `resolverPolicyRef`, `secretRefs`, `signingPolicyRef`, `rotationPolicyRef`, `breakGlassRef`; lease/signing adapters |
| IN-05 · Network owner        | Origins, DNS/CIDR pins, CA trust, методы/пути, proxy/ingress routes                                                            | `origins`, `trustPolicyRef`, `egressPolicyRef`, `callbackRoutes`, `ingressPolicyRef`; pinned transport и ingress                  |
| IN-06 · Operations owner     | Collector/backend, mTLS, redaction/retention, alert route и on-call                                                            | `telemetryPolicyRef`, `retentionPolicyRef`, `alertRouteRef`, `onCallOwner`                                                        |
| IN-07 · Artifact owner       | Только `GITLAB_ONLY`; retention, version/checksum readback, offline verification, export                                       | `artifactMode`, `retentionPolicyRef`, `verificationPolicyRef`, `exportPolicyRef`; GitLab artifact и evidence policies             |
| IN-08 · DBA/Recovery owner   | Физический backup/PITR, отдельная restore target, RPO/RTO, fence и владелец                                                    | Поля шаблона и расширение ниже; T084                                                                                              |
| IN-09 · Security owner       | Scanner/version, vulnerability DB version/digest/date, freshness, severity policy, finding owner                               | `scanPolicyRef`, `scannerRef`, `freshnessPolicyRef`, `findingOwner`; отдельные FULL scans точных image digests                    |
| IN-10 · Sponsor              | Cohort и human principals, QA Lead, окно и минимальная выборка                                                                 | `cohortRef`, `humanRefs`, `sponsorRef`, `qaLeadRef`, `windowPolicyRef`; activation и наблюдение                                   |
| IN-11 · QA Lead              | Источники baseline, определения метрик/знаменателей, включение/исключение, sampling и spot checks                              | `baselineMethod`, `sourceRefs`, `measurementProtocolRef`, `spotCheckPolicyRef`                                                    |
| IN-12 · Operations owner     | Incident/rollback/resume порядок, stop conditions и on-call                                                                    | `incidentRunbookRef`, `rollbackRunbookRef`, `resumePolicyRef`, `onCallOwner`                                                      |

В IN-08 для текущего corporate recovery gate нужны также `targetId`, числовые
`maximumRpoSeconds >= 0`, `maximumRtoSeconds > 0`, `oldRuntimeFenceProofRef` и
`backupMethod: "PHYSICAL_PITR"`. Общий input validator допускает `LOGICAL`, но
этого недостаточно для T084. Ссылку на доказательство fence вносят после реального
действия, не заменяют обещанием. См. [recovery inputs](../runbooks/pilot-integration-intake.md).

## Как оформить принятую версию

1. В шапке задать `id`, положительную `version`, `profile: "integration"` для
   первого стенда; `scope.workspaceId` и `scope.projectIds` — реальные UUID из
   registry. Для первого внедрения используйте один проект.
2. Каждой записи задать тот же Workspace и полный список Projects этого пакета.
   Указать её версию, `suppliedBy`, фактического `reviewedBy`, `reviewedAt` в ISO UTC
   и `evidenceRef` на review. `synthetic` остаётся `false`.
3. После review заполненных значений установить `status: "ACCEPTED"`.
   Не переводить `DRAFT` массово только ради зелёного валидатора.
4. Вычислить `contentHash` каждой записи по всему объекту **без собственного
   `contentHash`** через `canonicalInputHash008`. Hash имеет вид `sha256:` + 64 hex.
   Обычный hash байтов красиво отформатированного JSON не подходит.
5. Провалидировать и опубликовать пакет. При изменении metadata/review/scope
   выпустить новые версии затронутых документов, пересчитать hashes и проверить
   зависимые допуски. Старая версия должна сохраняться.

Пример расчёта после review, из корня репозитория. Команда обновляет **только hashes**,
отказывается обрабатывать непринятые записи и не подтверждает личность reviewer:

```sh
pnpm exec tsx --tsconfig tsconfig.base.json -e '
import { readFileSync, writeFileSync } from "node:fs";
import { canonicalInputHash008, validateInputPackage008 } from "./packages/platform-core/src/pilot/input-package.ts";
const path = ".pipeline-inputs/inputs.json";
const input = JSON.parse(readFileSync(path, "utf8"));
if (!Array.isArray(input.entries) || input.entries.some((entry: any) => entry.status !== "ACCEPTED")) {
  throw new Error("Complete the owner review before hashing");
}
for (const entry of input.entries) {
  const body = { ...entry };
  delete body.contentHash;
  entry.contentHash = canonicalInputHash008(body);
}
const checked = validateInputPackage008(input, "N2");
if (checked.status !== "PASS") throw new Error(JSON.stringify(checked.reasonCodes));
writeFileSync(path, JSON.stringify(input, null, 2) + "\n");
console.log("Input package contentHash:", canonicalInputHash008(input));
'
pnpm verify:008:inputs -- --input .pipeline-inputs/inputs.json --stage N2
```

C1 требует IN-01…IN-05, но проверяет **все переданные записи**. Для промежуточного
C1 создайте отдельную копию пакета с первыми пятью принятыми записями; незаполненные
IN-06…IN-12 из полного шаблона иначе дадут FAIL. Для runtime startup и N2/P3 нужны
все 12. Проверка metadata с `--stage N2` не означает, что N2 conformance выполнен.

## Что прописать в DeploymentPolicy

Заполните [шаблон](templates/deployment-policy.template.json) после публикации refs.
`deploymentId`, `workspaceId`, `projectIds` должны быть UUID; `version` — положительная.
Значения profile/composition/scope и identity issuer должны совпадать с runtime env.

- `imageDigest` — один фактический OCI digest общего backend image для API и worker.
  Текущий startup проверяет его и полное совпадение policy между процессами.
- Девять policy refs: input package, identity, resolver, signing, telemetry,
  network, artifact, model, recovery. Плюс три отдельных connector refs.
  Это разные опубликованные документы, не одна общая ссылка, повторённая 12 раз.
- Connector ref указывает на публикацию с project-specific profile/connection/
  integration binding. На каждый Project нужны JIRA, GITLAB и MATTERMOST.
- `endpoints` содержит `browser`, `callback`, `identity`, `jira`, `gitlab`,
  `mattermost` и фактически используемые outbound цели. В шаблоне даны также
  `vault`, `telemetry`, `model`, `artifact`; удалите неиспользуемые цели после
  согласования выбранного режима. Каждый purpose уникален.
- `url` — HTTPS адрес без credentials/fragment; `allowedOrigin` — точный
  `https://host[:port]` без пути и завершающего `/`. У issuer URL может быть путь.
  Browser URL равен origin, callback строго `/api/v1/auth/callback` на этом origin.

Hash whole input package из команды выше используется в `inputPackageRef` при
публикации именно этого документа. Для остальных refs используйте результаты
владельца публикации и соответствующие domain hash helpers, не hash файла.
`parseDeploymentPolicy` проверяет форму; startup дополнительно читает текущие
публикации/сроки/права в PostgreSQL. Сам JSON не заменяет этот шаг.

Перевод `integration` → `pilot` требует согласованных новых publications,
соответствующего profile у пакета и актуальных доказательств. Нельзя просто
переключить env у одного процесса. Истёкшие или относящиеся к другой версии
отчёты не переносятся как действующий PASS.
