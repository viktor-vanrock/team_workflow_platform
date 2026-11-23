import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { resolve } from "node:path";

import { type APIRequestContext, expect, test } from "@playwright/test";

const workspace = resolve(import.meta.dirname, "../../..");
const composeFile = resolve(workspace, "infra/compose/docker-compose.local.yml");
const projectName = process.env.AWP_LOCAL_PROJECT_NAME?.trim() ?? "";
const apiUrl = process.env.AWP_API_URL?.trim() || "http://127.0.0.1:3000";
const mockHubUrl = process.env.AWP_MOCK_HUB_PUBLIC_URL?.trim() || "http://127.0.0.1:4010";
const connectionId = "92000000-0000-4000-8000-000000000001";
if (!/^awp-local-003-us3-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(projectName))
  throw new Error("AWP_LOCAL_PROJECT_NAME must be a unique awp-local-003-us3-* scope");
interface Session {
  readonly accessToken: string;
  readonly context: Readonly<{ workspaceId: string; projectId: string }>;
}
interface Issue {
  readonly id: string;
  readonly key: string;
}
interface Imported {
  readonly workItemId: string;
  readonly revision: number;
  readonly bindingId: string;
}
interface Prepared {
  readonly commandRef: Readonly<{ id: string; version: number }>;
  readonly approvalRef: Readonly<{ id: string; version: number }>;
  readonly commandState: string;
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
function uuid(value: string): string {
  if (!/^[0-9a-f-]{36}$/iu.test(value)) throw new Error("UUID_INVALID");
  return `'${value}'::uuid`;
}
function imported(issueId: string): Imported | undefined {
  if (!/^[A-Za-z0-9._-]+$/u.test(issueId)) throw new Error("ISSUE_ID_INVALID");
  const value = compose(
    "awp",
    `SELECT json_build_object('workItemId',b.work_item_id,'revision',p.revision,'bindingId',b.id)::text FROM operational_bindings b JOIN operational_projection_revisions p ON p.id=b.current_projection_revision_id WHERE b.connection_header_id='${connectionId}' AND b.external_entity_id='${issueId}';`,
  );
  return value ? (JSON.parse(value) as Imported) : undefined;
}
function commandSnapshot(commandId: string) {
  const value = compose(
    "awp",
    `SELECT json_build_object('state',c.state,'authorization',c.payload#>>'{metadata,effectAuthorizationStatus}','outbox',o.state,'approvalState',a.decision_state,'approvalAuthorization',a.effect_authorization_state,'laneState',l.state,'conflicts',(SELECT count(*)::int FROM operational_sync_conflicts x WHERE x.command_id=c.id),'projectionRevision',p.revision,'normalizedStatus',p.authority_snapshot->>'normalizedStatus','rawStatus',p.authority_snapshot#>>'{rawStatus,name}')::text FROM connector_commands c JOIN command_outbox o ON o.command_id=c.id JOIN approvals a ON a.action_id=c.id LEFT JOIN connector_target_execution_lanes l ON l.active_command_id=c.id JOIN operational_bindings b ON b.work_item_id=(c.target->>'workItemId')::uuid JOIN operational_projection_revisions p ON p.id=b.current_projection_revision_id WHERE c.id=${uuid(commandId)};`,
  );
  return value ? (JSON.parse(value) as Record<string, unknown>) : undefined;
}
function mockWrites(): number {
  return Number(
    compose(
      "awp_mock",
      "SELECT count(*)::int FROM jira_mock_effect_calls WHERE operation='PROPERTY';",
    ),
  );
}
function runState(runId: string): string {
  return compose("awp", `SELECT state FROM reconciliation_runs WHERE id=${uuid(runId)};`);
}
async function session(request: APIRequestContext, personaKey: string): Promise<Session> {
  const response = await request.post(`${apiUrl}/local/persona/exchange`, { data: { personaKey } });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as Session;
}
async function issue(request: APIRequestContext, suffix: string): Promise<Issue> {
  const response = await request.post(`${mockHubUrl}/rest/api/3/issue`, {
    data: {
      fields: {
        project: { id: "100" },
        issuetype: { id: "10001" },
        summary: `US3 action ${suffix}`,
        description: "Operational action fixture",
        customfield_10010: "ALPHA",
        creator: { accountId: "jira-user-requester-alpha" },
        reporter: { accountId: "jira-user-requester-alpha" },
        status: { id: "1", name: "Open" },
      },
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as Issue;
}
async function webhook(
  request: APIRequestContext,
  issueId: string,
  deliveryId: string,
): Promise<void> {
  const body = JSON.stringify({ webhookEvent: "jira:issue_created", issue: { id: issueId } });
  const response = await request.post(
    `${apiUrl}/api/v1/connectors/jira/connections/${connectionId}/webhooks/local-webhook-key-0000000000000001`,
    {
      headers: {
        "content-type": "application/json",
        "x-atlassian-webhook-identifier": deliveryId,
        "x-hub-signature": `sha256=${createHmac("sha256", "local-hmac").update(body).digest("hex")}`,
      },
      data: body,
    },
  );
  expect(response.status(), await response.text()).toBe(202);
}

test.describe("003 US3 process-level operational actions", () => {
  test.setTimeout(240_000);
  test("executes exact-approved actions and surfaces a zero-write stale conflict", async ({
    request,
  }) => {
    const suffix = `${Date.now()}-${process.pid}`;
    const executor = await session(request, "executor.alpha");
    const owner = await session(request, "owner.local");
    const integrationAdmin = await session(request, "integration-admin.alpha");
    const executorHeaders = { authorization: `Bearer ${executor.accessToken}` };
    const ownerHeaders = { authorization: `Bearer ${owner.accessToken}` };
    const integrationAdminHeaders = { authorization: `Bearer ${integrationAdmin.accessToken}` };
    const scope = `${apiUrl}/api/v1/workspaces/${executor.context.workspaceId}/projects/${executor.context.projectId}/operational-authority`;
    const jira = await issue(request, suffix);
    await webhook(request, jira.id, `us3-import-${suffix}`);
    await expect.poll(() => imported(jira.id), { timeout: 60_000 }).toBeTruthy();
    const initial = imported(jira.id)!;
    const transitionUrl = `${scope}/work-items/${initial.workItemId}/actions/request.transition`;
    const transitionBody = { transition: { toStatusKey: "DONE" } };
    const first = await request.post(transitionUrl, {
      headers: {
        ...executorHeaders,
        "if-match": `W/"${initial.revision}"`,
        "idempotency-key": `us3-transition-${suffix}`,
      },
      data: transitionBody,
    });
    expect(first.status(), await first.text()).toBe(202);
    const prepared = (await first.json()) as Prepared;
    expect(prepared).toMatchObject({
      commandState: "AWAITING_APPROVAL",
      commandRef: { version: 1 },
      approvalRef: { version: 1 },
    });
    const replay = await request.post(transitionUrl, {
      headers: {
        ...executorHeaders,
        "if-match": `W/"${initial.revision}"`,
        "idempotency-key": `us3-transition-${suffix}`,
      },
      data: transitionBody,
    });
    expect(((await replay.json()) as Prepared).commandRef.id).toBe(prepared.commandRef.id);
    expect(mockWrites()).toBe(0);
    const approved = await request.post(`${scope}/approvals/${prepared.approvalRef.id}/decision`, {
      headers: ownerHeaders,
      data: { decision: "APPROVE" },
    });
    expect(approved.ok(), await approved.text()).toBe(true);
    await expect
      .poll(() => commandSnapshot(prepared.commandRef.id), { timeout: 60_000 })
      .toMatchObject({
        state: "CONFIRMED",
        authorization: "CONSUMED",
        outbox: "ACKNOWLEDGED",
        approvalState: "APPROVED",
        approvalAuthorization: "CONSUMED",
        laneState: "RELEASED",
        conflicts: 0,
        normalizedStatus: "DONE",
        rawStatus: "Done",
      });
    expect(mockWrites()).toBe(1);

    const current = imported(jira.id)!;
    const priorityUrl = `${scope}/work-items/${current.workItemId}/actions/request.set-priority`;
    const priority = await request.post(priorityUrl, {
      headers: {
        ...executorHeaders,
        "if-match": `W/"${current.revision}"`,
        "idempotency-key": `us3-priority-${suffix}`,
      },
      data: { priority: { normalizedKey: "HIGH" } },
    });
    expect(priority.status(), await priority.text()).toBe(202);
    const stale = (await priority.json()) as Prepared;
    const beforeHuman = mockWrites();
    const human = await request.put(`${mockHubUrl}/rest/api/3/issue/${jira.id}`, {
      data: { fields: { priority: { id: "2", name: "Medium" } } },
    });
    expect(human.ok(), await human.text()).toBe(true);
    expect(mockWrites()).toBe(beforeHuman + 1);
    const staleApproval = await request.post(
      `${scope}/approvals/${stale.approvalRef.id}/decision`,
      { headers: ownerHeaders, data: { decision: "APPROVE" } },
    );
    expect(staleApproval.ok(), await staleApproval.text()).toBe(true);
    await expect
      .poll(() => commandSnapshot(stale.commandRef.id), { timeout: 60_000 })
      .toMatchObject({
        state: "CONFLICT",
        authorization: "CONSUMED",
        outbox: "DEAD",
        approvalState: "APPROVED",
        approvalAuthorization: "CONSUMED",
        laneState: "RELEASED",
        conflicts: 1,
      });
    expect(mockWrites()).toBe(beforeHuman + 1);
    const conflicts = await request.get(`${scope}/work-items/${current.workItemId}/conflicts`, {
      headers: executorHeaders,
    });
    expect(conflicts.ok(), await conflicts.text()).toBe(true);
    expect(await conflicts.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason_code: "EXPECTED_STATE_MISMATCH", state: "OPEN" }),
      ]),
    );

    const due = await request.put(`${mockHubUrl}/rest/api/3/issue/${jira.id}`, {
      data: { fields: { duedate: "2026-10-01" } },
    });
    expect(due.ok(), await due.text()).toBe(true);
    const refresh = await request.post(`${scope}/reconciliation/BOUND_REFRESH`, {
      headers: integrationAdminHeaders,
      data: {},
    });
    expect(refresh.status(), await refresh.text()).toBe(201);
    const refreshRun = (await refresh.json()) as Readonly<{ runId: string }>;
    await expect.poll(() => runState(refreshRun.runId), { timeout: 60_000 }).toBe("SUCCEEDED");
    await expect
      .poll(() => imported(jira.id)!.revision, { timeout: 30_000 })
      .toBeGreaterThan(current.revision);
  });
});
