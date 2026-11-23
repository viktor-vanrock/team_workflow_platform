import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { resolve } from "node:path";

import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

const workspace = resolve(import.meta.dirname, "../../..");
const composeFile = resolve(workspace, "infra/compose/docker-compose.local.yml");
const projectName = process.env.AWP_LOCAL_PROJECT_NAME?.trim() ?? "";
const apiUrl = process.env.AWP_API_URL?.trim() || "http://127.0.0.1:3000";
const mockHubUrl = process.env.AWP_MOCK_HUB_PUBLIC_URL?.trim() || "http://127.0.0.1:4010";
const connectionId = "92000000-0000-4000-8000-000000000001";

if (!/^awp-local-003-browser-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(projectName)) {
  throw new Error("AWP_LOCAL_PROJECT_NAME must be a unique awp-local-003-browser-* scope");
}

interface Session {
  readonly accessToken: string;
  readonly context: Readonly<{ workspaceId: string; projectId: string }>;
}

interface Imported {
  readonly workItemId: string;
  readonly bindingId: string;
}

function sql(database: "awp" | "awp_mock", statement: string): string {
  return execFileSync(
    "docker",
    [
      "compose",
      "--project-name",
      projectName,
      "--file",
      composeFile,
      "exec",
      "-T",
      "postgres",
      "psql",
      "-X",
      "--set",
      "ON_ERROR_STOP=1",
      "--username",
      "awp_bootstrap",
      "--dbname",
      database,
      "--tuples-only",
      "--no-align",
      "--command",
      statement,
    ],
    { cwd: workspace, encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "inherit"] },
  ).trim();
}

function uuid(value: string, code: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value))
    throw new Error(`${code}_INVALID`);
  return `'${value}'::uuid`;
}

function safe(value: string, code: string): string {
  if (!/^[A-Za-z0-9._:-]+$/u.test(value)) throw new Error(`${code}_INVALID`);
  return value;
}

function imported(issueId: string): Imported | undefined {
  const id = safe(issueId, "ISSUE_ID");
  const value = sql(
    "awp",
    `SELECT json_build_object('workItemId',work_item_id,'bindingId',id)::text FROM operational_bindings WHERE connection_header_id='${connectionId}' AND external_entity_id='${id}';`,
  );
  return value ? (JSON.parse(value) as Imported) : undefined;
}

async function exchange(request: APIRequestContext, personaKey: string): Promise<Session> {
  const response = await request.post(`${apiUrl}/local/persona/exchange`, { data: { personaKey } });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as Session;
}

async function switchPersona(page: Page, personaKey: string, label: RegExp): Promise<void> {
  if (await page.getByRole("button", { name: "Сменить роль", exact: true }).count())
    await page.reload();
  await page.getByLabel("Участник и роль").selectOption(personaKey);
  await page.getByRole("button", { name: "Начать работу", exact: true }).click();
  await expect(
    page
      .locator("header")
      .getByText(new RegExp(label.source.replace("Выполнен вход: ", ""), label.flags)),
  ).toBeVisible();
}

async function createDirectImport(
  request: APIRequestContext,
  suffix: string,
): Promise<Readonly<{ id: string; key: string; title: string }>> {
  const title = `Browser direct import ${suffix}`;
  const created = await request.post(`${mockHubUrl}/rest/api/3/issue`, {
    data: {
      fields: {
        project: { id: "100" },
        issuetype: { id: "10001" },
        summary: title,
        description: "Chromium operational-authority journey",
        customfield_10010: "ALPHA",
        creator: { accountId: "jira-user-requester-alpha" },
        reporter: { accountId: "jira-user-requester-alpha" },
        status: { id: "1", name: "Open" },
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const issue = (await created.json()) as Readonly<{ id: string; key: string }>;
  const body = JSON.stringify({ webhookEvent: "jira:issue_created", issue: { id: issue.id } });
  const webhook = await request.post(
    `${apiUrl}/api/v1/connectors/jira/connections/${connectionId}/webhooks/local-webhook-key-0000000000000001`,
    {
      headers: {
        "content-type": "application/json",
        "x-atlassian-webhook-identifier": `browser-import-${suffix}`,
        "x-hub-signature": `sha256=${createHmac("sha256", "local-hmac").update(body).digest("hex")}`,
      },
      data: body,
    },
  );
  expect(webhook.status(), await webhook.text()).toBe(202);
  return Object.freeze({ ...issue, title });
}

function bootstrapFrozenDefect(
  scope: Session["context"],
  workItemId: string,
  suffix: string,
): string {
  const workspaceId = uuid(scope.workspaceId, "WORKSPACE_ID");
  const projectId = uuid(scope.projectId, "PROJECT_ID");
  const itemId = uuid(workItemId, "WORK_ITEM_ID");
  const token = safe(suffix, "SUFFIX");
  const planId = `browser-plan-${token}`;
  const planVersionId = `browser-plan-version-${token}`;
  const requirementId = `browser-requirement-${token}`;
  const sessionId = `browser-session-${token}`;
  const findingId = `browser-finding-${token}`;
  const classifiedId = `browser-review-classified-${token}`;
  const frozenId = `browser-review-frozen-${token}`;
  const defectDraftId = `browser-defect-draft-${token}`;
  const actor = `(SELECT jsonb_build_object('kind','HUMAN','principalId',id,'issuer',issuer,'subject',subject) FROM identities WHERE issuer='https://fake-idp:4443/oidc' AND subject='executor.alpha')`;
  const principal = `(SELECT id FROM identities WHERE issuer='https://fake-idp:4443/oidc' AND subject='executor.alpha')`;
  sql(
    "awp",
    `
    BEGIN;
    SET CONSTRAINTS ALL DEFERRED;
    INSERT INTO qa_required_session_plans(plan_id,workspace_id,project_id,work_item_id,extension_id,current_version_id,current_version,current_content_hash,resource_version,created_at,updated_at)
      SELECT '${planId}',workspace_id,project_id,work_item_id,extension_id,'${planVersionId}',1,'browser-plan-hash',1,clock_timestamp(),clock_timestamp() FROM qa_request_extensions WHERE workspace_id=${workspaceId} AND project_id=${projectId} AND work_item_id=${itemId};
    INSERT INTO qa_required_session_plan_versions(plan_version_id,workspace_id,project_id,work_item_id,plan_id,version,readiness_assessment_id,content_hash,content,published_at)
      VALUES('${planVersionId}',${workspaceId},${projectId},${itemId},'${planId}',1,(SELECT assessment_id FROM qa_readiness_assessments WHERE workspace_id=${workspaceId} AND project_id=${projectId} AND work_item_id=${itemId} ORDER BY assessment_version DESC LIMIT 1),'browser-plan-hash','{}'::jsonb,clock_timestamp());
    INSERT INTO qa_required_session_plan_requirements(requirement_id,workspace_id,project_id,work_item_id,plan_version_id,requirement_key,ordinal,mode,minimum_session_count,resolution,content_hash,content)
      VALUES('${requirementId}',${workspaceId},${projectId},${itemId},'${planVersionId}','manual-browser',1,'MANUAL',1,'REQUIRED','browser-requirement-hash','{}'::jsonb);
    INSERT INTO qa_test_sessions(session_id,workspace_id,project_id,work_item_id,ordinal,plan_version_id,requirement_id,requirement_key,mode,state,owner_id,required_capabilities,target_snapshot,target_hash,scope_snapshot,scope_hash,structure_revision,structure_hash,resource_version,content,created_by,created_at)
      VALUES('${sessionId}',${workspaceId},${projectId},${itemId},1,'${planVersionId}','${requirementId}','manual-browser','MANUAL','PLANNED',${principal},'[]'::jsonb,'{}'::jsonb,'browser-target-hash','{}'::jsonb,'browser-scope-hash',1,'browser-structure-hash',1,'{}'::jsonb,${actor},clock_timestamp());
    INSERT INTO qa_findings(finding_id,workspace_id,project_id,work_item_id,session_id,state,current_review_revision_id,latest_historical_review_revision_id,frozen_review_revision_id,classification,frozen_membership_set_hash,created_by,created_at,frozen_at,resource_version,content)
      VALUES('${findingId}',${workspaceId},${projectId},${itemId},'${sessionId}','FROZEN','${frozenId}','${frozenId}','${frozenId}','PRODUCT','browser-membership-hash',${actor},clock_timestamp(),clock_timestamp(),1,'{}'::jsonb);
    INSERT INTO qa_finding_review_revisions(finding_review_revision_id,workspace_id,project_id,work_item_id,session_id,finding_id,version,stage,classification,severity,summary,affected_target_hash,classification_actor,classification_reason,classification_at,active_membership_set_hash,observation_membership_ids,evidence_ref_hash,policy_ref,content_hash,content)
      VALUES('${classifiedId}',${workspaceId},${projectId},${itemId},'${sessionId}','${findingId}',1,'CLASSIFIED','PRODUCT','HIGH','Browser journey defect','browser-target-hash',${actor},'Confirmed product defect',clock_timestamp(),'browser-membership-hash','["browser-membership"]'::jsonb,'browser-evidence-hash','{}'::jsonb,'browser-review-classified-hash','{}'::jsonb);
    INSERT INTO qa_finding_review_revisions(finding_review_revision_id,workspace_id,project_id,work_item_id,session_id,finding_id,version,previous_revision_id,previous_version,previous_content_hash,stage,classification,severity,summary,affected_target_hash,classification_actor,classification_reason,classification_at,disposition_decision,disposition_actor,disposition_reason,disposition_at,frozen_at,active_membership_set_hash,observation_membership_ids,evidence_ref_hash,policy_ref,content_hash,content)
      VALUES('${frozenId}',${workspaceId},${projectId},${itemId},'${sessionId}','${findingId}',2,'${classifiedId}',1,'browser-review-classified-hash','FROZEN','PRODUCT','HIGH','Browser journey defect','browser-target-hash',${actor},'Confirmed product defect',clock_timestamp(),'CREATE_DEFECT',${actor},'Publish exact browser defect',clock_timestamp(),clock_timestamp(),'browser-membership-hash','["browser-membership"]'::jsonb,'browser-evidence-hash','{}'::jsonb,'browser-review-frozen-hash','{}'::jsonb);
    INSERT INTO qa_defect_drafts(defect_draft_id,workspace_id,project_id,work_item_id,session_id,finding_id,frozen_finding_review_id,version,state,payload,provenance,content_hash,resource_version,created_by,created_at,updated_at)
      VALUES('${defectDraftId}',${workspaceId},${projectId},${itemId},'${sessionId}','${findingId}','${frozenId}',1,'DRAFT',jsonb_build_object('title','US4 browser defect','description','Approved Chromium defect publication','stepsToReproduce',jsonb_build_array('Run browser journey'),'expectedOutcome','No defect','actualOutcome','Defect observed','severity','HIGH','target',jsonb_build_object('contentHash','browser-target-hash'),'evidenceRefs',jsonb_build_array(jsonb_build_object('id','browser-evidence-${token}','version','1','contentHash','browser-evidence-hash'))),jsonb_build_object('source','DETERMINISTIC_TEMPLATE','templateVersion','1.0.0'),'browser-defect-draft-hash',1,${actor},clock_timestamp(),clock_timestamp());
    COMMIT;
  `,
  );
  return defectDraftId;
}

test.describe("003 real Chromium operational-authority journey", () => {
  test.setTimeout(300_000);

  test("Requester create → direct import → Executor action → approved defect", async ({
    page,
    request,
  }) => {
    const suffix = `${Date.now()}-${process.pid}`;
    const executor = await exchange(request, "executor.alpha");

    await page.goto("/");
    await expect(page.getByText("Локальный стенд · учебные данные")).toBeVisible();
    await switchPersona(page, "requester.alpha", /Выполнен вход: Заказчик · ALPHA/u);
    await page
      .getByRole("navigation")
      .getByRole("link", { name: "Новый запрос", exact: true })
      .click();
    await page.getByLabel("Название", { exact: true }).fill(`Browser central request ${suffix}`);
    await page
      .getByLabel("Цель (необязательно)")
      .fill("Проверить устойчивый обработчик Jira из Chromium");
    await page.getByText("Дополнительные сведения", { exact: true }).click();
    await page.getByLabel("Блокирующих факторов нет").check();
    await page.getByLabel("Зависимостей нет").check();
    await page.getByRole("button", { name: "Проверить запрос" }).click();
    await page.getByRole("button", { name: "Отправить запрос", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Запрос создан", exact: true })).toBeVisible({
      timeout: 90_000,
    });
    await page.getByRole("button", { name: "Открыть запрос", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: `Browser central request ${suffix}`, exact: true }),
    ).toBeVisible();

    const issue = await createDirectImport(request, suffix);
    await expect.poll(() => imported(issue.id), { timeout: 60_000 }).toBeTruthy();
    const authority = imported(issue.id)!;

    await switchPersona(page, "executor.alpha", /Выполнен вход: Исполнитель QA · QA 1/u);
    await page.getByRole("button", { name: "Обновить сведения" }).click();
    await expect(page.getByLabel("Выбранный запрос")).toContainText(issue.title);
    await page.getByLabel("Выбранный запрос").selectOption(authority.workItemId);
    await page.getByRole("tab", { name: "Статус в Jira", exact: true }).click();
    const operational = page.getByTestId("operational-authority-workspace");
    await expect(
      operational.getByRole("heading", { name: "Операционный источник истины" }),
    ).toBeVisible();
    await expect(operational.getByText("Проверенный импорт")).toBeVisible();
    await expect(operational.getByText(issue.key)).toBeVisible();
    await operational.getByRole("button", { name: "Обновить данные на экране" }).click();
    await expect(operational.getByText(/Последняя проверка Jira:/u)).toBeVisible();

    const preparation = page.waitForResponse((response) =>
      response.url().endsWith("/actions/request.transition"),
    );
    await operational.getByRole("button", { name: "Перевести в состояние «Выполнено»" }).click();
    const prepared = (await (await preparation).json()) as { approvalRef: { id: string } };
    await expect(operational.getByText(/Действие .* · Ожидает согласования/u)).toBeVisible();
    const owner = await exchange(request, "owner.local");
    const decision = await request.post(
      `${apiUrl}/api/v1/workspaces/${executor.context.workspaceId}/projects/${executor.context.projectId}/operational-authority/approvals/${prepared.approvalRef.id}/decision`,
      { headers: { authorization: `Bearer ${owner.accessToken}` }, data: { decision: "APPROVE" } },
    );
    expect(decision.ok(), await decision.text()).toBe(true);
    expect(await decision.json()).toMatchObject({ decision: "APPROVE" });
    await expect
      .poll(
        async () => {
          return await operational.getByText(/Статус запроса: Выполнено/u).count();
        },
        { timeout: 90_000, intervals: [500, 1_000, 2_000] },
      )
      .toBeGreaterThan(0);

    bootstrapFrozenDefect(executor.context, authority.workItemId, suffix);
    await page.getByRole("tab", { name: "Замечания", exact: true }).click();
    await page.getByRole("button", { name: "Обновить точное состояние" }).click();
    await expect(page.getByText("US4 browser defect · Черновик")).toBeVisible();
    await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
    await expect(page.getByText("US4 browser defect · Ожидает согласования")).toBeVisible();
    await switchPersona(page, "lead.alpha", /Выполнен вход: Руководитель QA · ALPHA/u);
    await page.getByRole("tab", { name: "Замечания", exact: true }).click();
    await page.getByRole("button", { name: "Согласовать как другой руководитель" }).click();
    await expect
      .poll(
        async () => {
          await page.getByRole("button", { name: "Обновить точное состояние" }).click();
          return await page.getByText(/QAC-\d+ · \d+/u).count();
        },
        { timeout: 120_000, intervals: [500, 1_000, 2_000] },
      )
      .toBeGreaterThan(0);

    const durable = JSON.parse(
      sql(
        "awp",
        `SELECT json_build_object('requestCreates',(SELECT count(*)::int FROM work_items WHERE acceptance_source='PLATFORM_DRAFT' AND title='Browser central request ${safe(suffix, "SUFFIX")}'),'imports',(SELECT count(*)::int FROM operational_bindings WHERE work_item_id=${uuid(authority.workItemId, "WORK_ITEM_ID")} AND acceptance_source='VERIFIED_IMPORT'),'actions',(SELECT count(*)::int FROM connector_commands WHERE operation='request.transition' AND state='CONFIRMED' AND target->>'workItemId'='${safe(authority.workItemId, "WORK_ITEM_ID")}'),'defectLinks',(SELECT count(*)::int FROM qa_defect_links WHERE work_item_id=${uuid(authority.workItemId, "WORK_ITEM_ID")}))::text;`,
      ),
    ) as Readonly<Record<string, number>>;
    expect(durable).toMatchObject({ requestCreates: 1, imports: 1, actions: 1, defectLinks: 1 });
    expect(
      Number(sql("awp_mock", "SELECT count(*)::int FROM jira_mock_issues;")),
    ).toBeGreaterThanOrEqual(3);
  });
});
