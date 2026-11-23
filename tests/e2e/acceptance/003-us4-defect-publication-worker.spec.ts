import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { resolve } from "node:path";

import { type APIRequestContext, expect, test } from "@playwright/test";

const workspace = resolve(import.meta.dirname, "../../..");
const composeFile = resolve(workspace, "infra/compose/docker-compose.local.yml");
const projectName = process.env.AWP_LOCAL_PROJECT_NAME?.trim() ?? "";
const apiUrl = process.env.AWP_API_URL?.trim() || "http://127.0.0.1:3000";
const workerUrl = process.env.AWP_WORKER_URL?.trim() || "http://127.0.0.1:3010";
const mockHubUrl = process.env.AWP_MOCK_HUB_PUBLIC_URL?.trim() || "http://127.0.0.1:4010";
const connectionId = "92000000-0000-4000-8000-000000000001";

if (!/^awp-local-003-us4-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(projectName)) {
  throw new Error("AWP_LOCAL_PROJECT_NAME must be a unique awp-local-003-us4-* scope");
}

interface Session {
  readonly accessToken: string;
  readonly context: Readonly<{ workspaceId: string; projectId: string }>;
}

interface Imported {
  readonly workItemId: string;
  readonly bindingId: string;
  readonly extensionId: string;
}

interface Published {
  readonly operationId: string;
  readonly approvalId: string;
  readonly defectDraftId: string;
  readonly state: string;
}

interface DefectSnapshot {
  readonly commandState: string;
  readonly commandAttempts: number;
  readonly outboxState: string;
  readonly approvalState: string;
  readonly approvalAuthorization: string;
  readonly draftState: string;
  readonly defectLinks: number;
  readonly pinRoles: readonly string[];
  readonly effectState: string | null;
  readonly effectAttempts: number | null;
  readonly effectExternalEntityId: string | null;
  readonly subEffectKinds: readonly string[];
  readonly subEffectStates: readonly string[];
  readonly subEffectAttempts: readonly number[];
  readonly subEffectReceipts: number;
}

interface MockSnapshot {
  readonly issueId: string | null;
  readonly issues: number;
  readonly links: number;
  readonly comments: number;
  readonly createCalls: number;
  readonly linkCalls: number;
  readonly commentCalls: number;
}

function compose(db: "awp" | "awp_mock", sql: string): string {
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
      db,
      "--tuples-only",
      "--no-align",
      "--command",
      sql,
    ],
    { cwd: workspace, encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "inherit"] },
  ).trim();
}

function service(...args: readonly string[]): void {
  execFileSync(
    "docker",
    ["compose", "--project-name", projectName, "--file", composeFile, ...args],
    {
      cwd: workspace,
      encoding: "utf8",
      env: process.env,
      stdio: "inherit",
    },
  );
}

function uuid(value: string, code: string): string {
  if (!/^[0-9a-f-]{36}$/iu.test(value)) throw new Error(`${code}_INVALID`);
  return `'${value}'::uuid`;
}

function safe(value: string, code: string): string {
  if (!/^[A-Za-z0-9._:-]+$/u.test(value)) throw new Error(`${code}_INVALID`);
  return value;
}

function imported(issueId: string): Imported | undefined {
  const id = safe(issueId, "ISSUE_ID");
  const value = compose(
    "awp",
    `SELECT json_build_object('workItemId',b.work_item_id,'bindingId',b.id,'extensionId',q.extension_id)::text FROM operational_bindings b JOIN qa_request_extensions q ON q.workspace_id=b.workspace_id AND q.project_id=b.project_id AND q.work_item_id=b.work_item_id WHERE b.connection_header_id='${connectionId}' AND b.external_entity_id='${id}';`,
  );
  return value ? (JSON.parse(value) as Imported) : undefined;
}

function bootstrapFrozenDraft(
  scope: Session["context"],
  workItemId: string,
  suffix: string,
): Readonly<{ defectDraftId: string; findingId: string; sessionId: string }> {
  const workspaceId = uuid(scope.workspaceId, "WORKSPACE_ID");
  const projectId = uuid(scope.projectId, "PROJECT_ID");
  const itemId = uuid(workItemId, "WORK_ITEM_ID");
  const token = safe(suffix, "SUFFIX");
  const planId = `us4-plan-${token}`;
  const planVersionId = `us4-plan-version-${token}`;
  const requirementId = `us4-requirement-${token}`;
  const sessionId = `us4-session-${token}`;
  const findingId = `us4-finding-${token}`;
  const classifiedId = `us4-review-classified-${token}`;
  const frozenId = `us4-review-frozen-${token}`;
  const defectDraftId = `us4-defect-draft-${token}`;
  const actor = `(SELECT jsonb_build_object('kind','HUMAN','principalId',id,'issuer',issuer,'subject',subject) FROM identities WHERE issuer='https://fake-idp:4443/oidc' AND subject='executor.alpha')`;
  const principal = `(SELECT id FROM identities WHERE issuer='https://fake-idp:4443/oidc' AND subject='executor.alpha')`;
  compose(
    "awp",
    `
    BEGIN;
    SET CONSTRAINTS ALL DEFERRED;
    INSERT INTO qa_required_session_plans(plan_id,workspace_id,project_id,work_item_id,extension_id,current_version_id,current_version,current_content_hash,resource_version,created_at,updated_at)
      SELECT '${planId}',workspace_id,project_id,work_item_id,extension_id,'${planVersionId}',1,'us4-plan-hash',1,clock_timestamp(),clock_timestamp()
        FROM qa_request_extensions WHERE workspace_id=${workspaceId} AND project_id=${projectId} AND work_item_id=${itemId};
    INSERT INTO qa_required_session_plan_versions(plan_version_id,workspace_id,project_id,work_item_id,plan_id,version,readiness_assessment_id,content_hash,content,published_at)
      VALUES('${planVersionId}',${workspaceId},${projectId},${itemId},'${planId}',1,(SELECT assessment_id FROM qa_readiness_assessments WHERE workspace_id=${workspaceId} AND project_id=${projectId} AND work_item_id=${itemId} ORDER BY assessment_version DESC LIMIT 1),'us4-plan-hash','{}'::jsonb,clock_timestamp());
    INSERT INTO qa_required_session_plan_requirements(requirement_id,workspace_id,project_id,work_item_id,plan_version_id,requirement_key,ordinal,mode,minimum_session_count,resolution,content_hash,content)
      VALUES('${requirementId}',${workspaceId},${projectId},${itemId},'${planVersionId}','manual-validation',1,'MANUAL',1,'REQUIRED','us4-requirement-hash','{}'::jsonb);
    INSERT INTO qa_test_sessions(session_id,workspace_id,project_id,work_item_id,ordinal,plan_version_id,requirement_id,requirement_key,mode,state,owner_id,required_capabilities,target_snapshot,target_hash,scope_snapshot,scope_hash,structure_revision,structure_hash,resource_version,content,created_by,created_at)
      VALUES('${sessionId}',${workspaceId},${projectId},${itemId},1,'${planVersionId}','${requirementId}','manual-validation','MANUAL','PLANNED',${principal},'[]'::jsonb,'{}'::jsonb,'us4-target-hash','{}'::jsonb,'us4-scope-hash',1,'us4-structure-hash',1,'{}'::jsonb,${actor},clock_timestamp());
    INSERT INTO qa_findings(finding_id,workspace_id,project_id,work_item_id,session_id,state,current_review_revision_id,latest_historical_review_revision_id,frozen_review_revision_id,classification,frozen_membership_set_hash,created_by,created_at,frozen_at,resource_version,content)
      VALUES('${findingId}',${workspaceId},${projectId},${itemId},'${sessionId}','FROZEN','${frozenId}','${frozenId}','${frozenId}','PRODUCT','us4-membership-hash',${actor},clock_timestamp(),clock_timestamp(),1,'{}'::jsonb);
    INSERT INTO qa_finding_review_revisions(finding_review_revision_id,workspace_id,project_id,work_item_id,session_id,finding_id,version,stage,classification,severity,summary,affected_target_hash,classification_actor,classification_reason,classification_at,active_membership_set_hash,observation_membership_ids,evidence_ref_hash,policy_ref,content_hash,content)
      VALUES('${classifiedId}',${workspaceId},${projectId},${itemId},'${sessionId}','${findingId}',1,'CLASSIFIED','PRODUCT','HIGH','US4 process defect','us4-target-hash',${actor},'Confirmed product defect',clock_timestamp(),'us4-membership-hash','["us4-membership"]'::jsonb,'us4-evidence-hash','{}'::jsonb,'us4-review-classified-hash','{}'::jsonb);
    INSERT INTO qa_finding_review_revisions(finding_review_revision_id,workspace_id,project_id,work_item_id,session_id,finding_id,version,previous_revision_id,previous_version,previous_content_hash,stage,classification,severity,summary,affected_target_hash,classification_actor,classification_reason,classification_at,disposition_decision,disposition_actor,disposition_reason,disposition_at,frozen_at,active_membership_set_hash,observation_membership_ids,evidence_ref_hash,policy_ref,content_hash,content)
      VALUES('${frozenId}',${workspaceId},${projectId},${itemId},'${sessionId}','${findingId}',2,'${classifiedId}',1,'us4-review-classified-hash','FROZEN','PRODUCT','HIGH','US4 process defect','us4-target-hash',${actor},'Confirmed product defect',clock_timestamp(),'CREATE_DEFECT',${actor},'Publish exact approved defect',clock_timestamp(),clock_timestamp(),'us4-membership-hash','["us4-membership"]'::jsonb,'us4-evidence-hash','{}'::jsonb,'us4-review-frozen-hash','{}'::jsonb);
    INSERT INTO qa_defect_drafts(defect_draft_id,workspace_id,project_id,work_item_id,session_id,finding_id,frozen_finding_review_id,version,state,payload,provenance,content_hash,resource_version,created_by,created_at,updated_at)
      VALUES('${defectDraftId}',${workspaceId},${projectId},${itemId},'${sessionId}','${findingId}','${frozenId}',1,'DRAFT',jsonb_build_object('title','US4 durable process defect','description','Prove durable approved defect publication','stepsToReproduce',jsonb_build_array('Run the acceptance path'),'expectedOutcome','No defect','actualOutcome','Defect observed','severity','HIGH','target',jsonb_build_object('contentHash','us4-target-hash'),'evidenceRefs',jsonb_build_array(jsonb_build_object('id','us4-evidence-${token}','version','1','contentHash','us4-evidence-hash'))),jsonb_build_object('source','DETERMINISTIC_TEMPLATE','templateVersion','1.0.0'),'us4-defect-draft-hash',1,${actor},clock_timestamp(),clock_timestamp());
    COMMIT;
  `,
  );
  return Object.freeze({ defectDraftId, findingId, sessionId });
}

function defectSnapshot(commandId: string, defectDraftId: string): DefectSnapshot {
  const command = uuid(commandId, "COMMAND_ID");
  const draft = safe(defectDraftId, "DEFECT_DRAFT_ID");
  const value = compose(
    "awp",
    `SELECT json_build_object(
    'commandState',c.state,
    'commandAttempts',(c.payload#>>'{metadata,attemptCount}')::int,
    'outboxState',(SELECT state FROM command_outbox WHERE command_id=c.id),
    'approvalState',a.decision_state,
    'approvalAuthorization',a.effect_authorization_state,
    'draftState',d.state,
    'defectLinks',(SELECT count(*)::int FROM qa_defect_links WHERE defect_draft_id=d.defect_draft_id),
    'pinRoles',COALESCE((SELECT json_agg(logical_role ORDER BY sequence) FROM connector_command_configuration_pins WHERE command_id=c.id),'[]'::json),
    'effectState',(SELECT state FROM jira_effect_reconciliations WHERE command_id=c.id),
    'effectAttempts',(SELECT attempt::int FROM jira_effect_reconciliations WHERE command_id=c.id),
    'effectExternalEntityId',(SELECT external_entity_id FROM jira_effect_reconciliations WHERE command_id=c.id),
    'subEffectKinds',COALESCE((SELECT json_agg(s.kind ORDER BY s.sequence) FROM jira_effect_sub_effects s JOIN jira_effect_reconciliations e ON e.id=s.effect_id WHERE e.command_id=c.id),'[]'::json),
    'subEffectStates',COALESCE((SELECT json_agg(s.state ORDER BY s.sequence) FROM jira_effect_sub_effects s JOIN jira_effect_reconciliations e ON e.id=s.effect_id WHERE e.command_id=c.id),'[]'::json),
    'subEffectAttempts',COALESCE((SELECT json_agg(s.attempt ORDER BY s.sequence) FROM jira_effect_sub_effects s JOIN jira_effect_reconciliations e ON e.id=s.effect_id WHERE e.command_id=c.id),'[]'::json),
    'subEffectReceipts',(SELECT count(*)::int FROM jira_effect_sub_effects s JOIN jira_effect_reconciliations e ON e.id=s.effect_id WHERE e.command_id=c.id AND s.receipt_hash IS NOT NULL)
  )::text FROM connector_commands c JOIN approvals a ON a.action_id=c.id JOIN qa_defect_drafts d ON d.command_ref->>'id'=c.id::text WHERE c.id=${command} AND d.defect_draft_id='${draft}';`,
  );
  if (!value) throw new Error("DEFECT_SNAPSHOT_MISSING");
  return JSON.parse(value) as DefectSnapshot;
}

function effectKey(commandId: string): string {
  const value = compose(
    "awp",
    `SELECT effect_idempotency_key FROM connector_commands WHERE id=${uuid(commandId, "COMMAND_ID")};`,
  );
  return safe(value, "EFFECT_KEY");
}

function mockSnapshot(marker: string): MockSnapshot {
  const key = safe(marker, "EFFECT_KEY");
  const value = compose(
    "awp_mock",
    `WITH defect AS (SELECT id FROM jira_mock_issues WHERE marker='${key}') SELECT json_build_object(
    'issueId',(SELECT id FROM defect),'issues',(SELECT count(*)::int FROM defect),
    'links',(SELECT count(*)::int FROM jira_mock_links WHERE issue_id=(SELECT id FROM defect)),
    'comments',(SELECT count(*)::int FROM jira_mock_comments WHERE issue_id=(SELECT id FROM defect)),
    'createCalls',(SELECT count(*)::int FROM jira_mock_effect_calls WHERE operation='CREATE' AND request_body#>>'{fields,customfield_10011}'='${key}'),
    'linkCalls',(SELECT count(*)::int FROM jira_mock_effect_calls WHERE operation='LINK' AND request_body#>>'{outwardIssue,id}'=(SELECT id FROM defect)),
    'commentCalls',(SELECT count(*)::int FROM jira_mock_effect_calls WHERE operation='COMMENT' AND request_body->>'id'=(SELECT id FROM defect))
  )::text;`,
  );
  if (!value) throw new Error("MOCK_SNAPSHOT_MISSING");
  return JSON.parse(value) as MockSnapshot;
}

async function ready(request: APIRequestContext, url: string): Promise<boolean> {
  try {
    return (await request.get(url, { timeout: 3_000 })).ok();
  } catch {
    return false;
  }
}

async function session(request: APIRequestContext, personaKey: string): Promise<Session> {
  const response = await request.post(`${apiUrl}/local/persona/exchange`, { data: { personaKey } });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as Session;
}

async function setScenario(
  request: APIRequestContext,
  scenario: "TIMEOUT_AFTER_EFFECT",
): Promise<void> {
  const response = await request.post(`${mockHubUrl}/mock/jira/scenario`, { data: { scenario } });
  expect(response.ok(), await response.text()).toBe(true);
}

test.describe("003 US4 process-level approved defect publication", () => {
  test.setTimeout(300_000);

  test("recovers create and link sub-effects and atomically confirms one QA DefectLink", async ({
    request,
  }) => {
    const suffix = `${Date.now()}-${process.pid}`;
    const executor = await session(request, "executor.alpha");
    const lead = await session(request, "lead.alpha");
    const executorHeaders = { authorization: `Bearer ${executor.accessToken}` };
    const leadHeaders = { authorization: `Bearer ${lead.accessToken}` };
    const source = await request.post(`${mockHubUrl}/rest/api/3/issue`, {
      data: {
        fields: {
          project: { id: "100" },
          issuetype: { id: "10001" },
          summary: `US4 source ${suffix}`,
          description: "Imported QA request authority",
          customfield_10010: "ALPHA",
          creator: { accountId: "jira-user-requester-alpha" },
          reporter: { accountId: "jira-user-requester-alpha" },
          status: { id: "1", name: "Open" },
        },
      },
    });
    expect(source.ok(), await source.text()).toBe(true);
    const sourceIssue = (await source.json()) as Readonly<{ id: string }>;
    const webhookBody = JSON.stringify({
      webhookEvent: "jira:issue_created",
      issue: { id: sourceIssue.id },
    });
    const webhook = await request.post(
      `${apiUrl}/api/v1/connectors/jira/connections/${connectionId}/webhooks/local-webhook-key-0000000000000001`,
      {
        headers: {
          "content-type": "application/json",
          "x-atlassian-webhook-identifier": `us4-import-${suffix}`,
          "x-hub-signature": `sha256=${createHmac("sha256", "local-hmac").update(webhookBody).digest("hex")}`,
        },
        data: webhookBody,
      },
    );
    expect(webhook.status(), await webhook.text()).toBe(202);
    await expect.poll(() => imported(sourceIssue.id), { timeout: 60_000 }).toBeTruthy();
    const authority = imported(sourceIssue.id)!;
    const fixture = bootstrapFrozenDraft(executor.context, authority.workItemId, suffix);
    const scope = `${apiUrl}/api/v1/workspaces/${executor.context.workspaceId}/projects/${executor.context.projectId}/work-items/${authority.workItemId}/qa`;

    const publication = await request.post(
      `${scope}/defect-drafts/${fixture.defectDraftId}/publication`,
      {
        headers: { ...executorHeaders, "if-match": 'W/"1"' },
        data: { expectedResourceVersion: 1 },
      },
    );
    expect(publication.status(), await publication.text()).toBe(202);
    const published = (await publication.json()) as Published;
    expect(published).toMatchObject({
      defectDraftId: fixture.defectDraftId,
      state: "AWAITING_APPROVAL",
    });
    expect(defectSnapshot(published.operationId, fixture.defectDraftId)).toMatchObject({
      commandState: "AWAITING_APPROVAL",
      commandAttempts: 0,
      outboxState: "HELD",
      approvalState: "PENDING",
      draftState: "AWAITING_APPROVAL",
      defectLinks: 0,
    });

    await setScenario(request, "TIMEOUT_AFTER_EFFECT");
    const approval = await request.post(
      `${scope}/defect-approvals/${published.approvalId}/approve`,
      { headers: leadHeaders, data: {} },
    );
    expect(approval.ok(), await approval.text()).toBe(true);
    await expect(approval.json()).resolves.toMatchObject({
      commandId: published.operationId,
      state: "QUEUED",
    });
    const marker = effectKey(published.operationId);
    await expect.poll(() => mockSnapshot(marker).issues, { timeout: 30_000 }).toBe(1);
    await expect
      .poll(() => defectSnapshot(published.operationId, fixture.defectDraftId), { timeout: 30_000 })
      .toMatchObject({
        commandState: "DISPATCHED",
        commandAttempts: 1,
        outboxState: "ACKNOWLEDGED",
        approvalState: "APPROVED",
        approvalAuthorization: "CONSUMED",
        draftState: "DISPATCHED",
        defectLinks: 0,
        effectState: "EFFECT_IN_PROGRESS",
        effectAttempts: 1,
        effectExternalEntityId: null,
      });
    expect(mockSnapshot(marker)).toMatchObject({
      issues: 1,
      links: 0,
      comments: 0,
      createCalls: 1,
    });

    await setScenario(request, "TIMEOUT_AFTER_EFFECT");
    await expect
      .poll(() => mockSnapshot(marker).links, { timeout: 90_000, intervals: [500, 1_000, 2_000] })
      .toBe(1);
    await expect
      .poll(() => defectSnapshot(published.operationId, fixture.defectDraftId), { timeout: 30_000 })
      .toMatchObject({
        commandState: "DISPATCHED",
        commandAttempts: 2,
        draftState: "DISPATCHED",
        defectLinks: 0,
        effectState: "ISSUE_FOUND",
        effectAttempts: 2,
        subEffectKinds: ["ISSUE_LINK", "COMMENT", "COMMENT"],
        subEffectStates: ["PENDING", "PENDING", "PENDING"],
        subEffectAttempts: [1, 0, 0],
        subEffectReceipts: 0,
      });

    service("restart", "worker");
    await expect
      .poll(() => ready(request, `${workerUrl}/health/ready`), { timeout: 60_000 })
      .toBe(true);
    await expect
      .poll(() => defectSnapshot(published.operationId, fixture.defectDraftId).commandState, {
        timeout: 120_000,
        intervals: [500, 1_000, 2_000],
      })
      .toBe("CONFIRMED");
    expect(defectSnapshot(published.operationId, fixture.defectDraftId)).toMatchObject({
      commandState: "CONFIRMED",
      commandAttempts: 3,
      outboxState: "ACKNOWLEDGED",
      approvalState: "APPROVED",
      approvalAuthorization: "CONSUMED",
      draftState: "LINKED",
      defectLinks: 1,
      pinRoles: ["DEFECT_DESTINATION", "QA_REQUEST_AUTHORITY"],
      effectState: "CONFIRMED",
      effectAttempts: 3,
      subEffectKinds: ["ISSUE_LINK", "COMMENT", "COMMENT"],
      subEffectStates: ["CONFIRMED", "CONFIRMED", "CONFIRMED"],
      subEffectAttempts: [2, 1, 1],
      subEffectReceipts: 3,
    });
    expect(mockSnapshot(marker)).toMatchObject({
      issues: 1,
      links: 1,
      comments: 2,
      createCalls: 1,
      linkCalls: 1,
      commentCalls: 2,
    });

    const links = await request.get(`${scope}/defect-links`, { headers: executorHeaders });
    expect(links.ok(), await links.text()).toBe(true);
    await expect(links.json()).resolves.toEqual([
      expect.objectContaining({
        findingId: fixture.findingId,
        defectDraftId: fixture.defectDraftId,
        normalizedStatus: "NEW",
        externalEntityId: mockSnapshot(marker).issueId,
      }),
    ]);
  });
});
