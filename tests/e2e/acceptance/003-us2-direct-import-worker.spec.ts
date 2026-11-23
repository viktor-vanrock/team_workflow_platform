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
const webhookUrl = `${apiUrl}/api/v1/connectors/jira/connections/${connectionId}/webhooks/local-webhook-key-0000000000000001`;

if (!/^awp-local-003-us2-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(projectName)) {
  throw new Error(
    "AWP_LOCAL_PROJECT_NAME must be a unique awp-local-003-us2-* scope; use the process smoke runner",
  );
}

interface LocalSession {
  readonly accessToken: string;
  readonly context: Readonly<{ workspaceId: string; projectId: string }>;
}

interface JiraIssueResponse {
  readonly id: string;
  readonly key: string;
}
interface ReconciliationResponse {
  readonly status: string;
  readonly runId: string;
}
interface ImportSnapshot {
  readonly seedVersion: number;
  readonly state: string | null;
  readonly reasonCode: string | null;
  readonly displayKey: string | null;
  readonly workItems: number;
  readonly bindings: number;
  readonly projections: number;
  readonly qaExtensions: number;
  readonly qaInputs: number;
  readonly readinessState: string | null;
  readonly workItemState: string | null;
  readonly normalizedStatus: string | null;
  readonly workItemAcceptanceSource: string | null;
  readonly bindingAcceptanceSource: string | null;
  readonly acceptedDraftKind: string | null;
  readonly sourceDraftRows: number;
  readonly importedEvents: number;
}

function compose(...args: readonly string[]): string {
  return execFileSync(
    "docker",
    ["compose", "--project-name", projectName, "--file", composeFile, ...args],
    {
      cwd: workspace,
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
}

function externalLiteral(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/u.test(value)) throw new Error(`EXTERNAL_ID_INVALID:${value}`);
  return `'${value}'`;
}

function importSnapshot(externalEntityId: string): ImportSnapshot {
  const external = externalLiteral(externalEntityId);
  const sql = `
    WITH intent AS (
      SELECT * FROM operational_import_intents
       WHERE connection_header_id='${connectionId}' AND external_entity_type='REQUEST' AND external_entity_id=${external}
    ), bound AS (
      SELECT b.* FROM operational_bindings b
       WHERE b.connection_header_id='${connectionId}' AND b.external_entity_type='REQUEST' AND b.external_entity_id=${external}
    ), work AS (
      SELECT w.* FROM work_items w JOIN bound b ON (b.workspace_id,b.project_id,b.work_item_id)=(w.workspace_id,w.project_id,w.id)
    )
    SELECT json_build_object(
      'seedVersion',(SELECT version::int FROM local_seed_markers WHERE key='003-qa-jira-local'),
      'state',(SELECT state FROM intent),
      'reasonCode',(SELECT reason_code FROM intent),
      'displayKey',(SELECT external_display_key FROM intent),
      'workItems',(SELECT count(*)::int FROM work),
      'bindings',(SELECT count(*)::int FROM bound),
      'projections',(SELECT count(*)::int FROM operational_projection_revisions p JOIN bound b ON b.id=p.binding_id),
      'qaExtensions',(SELECT count(*)::int FROM qa_request_extensions q JOIN work w ON (q.workspace_id,q.project_id,q.work_item_id)=(w.workspace_id,w.project_id,w.id)),
      'qaInputs',(SELECT count(*)::int FROM qa_request_input_revisions q JOIN work w ON (q.workspace_id,q.project_id,q.work_item_id)=(w.workspace_id,w.project_id,w.id)),
      'readinessState',(SELECT r.state FROM qa_readiness_assessments r JOIN work w ON (r.workspace_id,r.project_id,r.work_item_id)=(w.workspace_id,w.project_id,w.id) ORDER BY r.assessment_version DESC LIMIT 1),
      'workItemState',(SELECT state FROM work LIMIT 1),
      'normalizedStatus',(SELECT normalized_status FROM work LIMIT 1),
      'workItemAcceptanceSource',(SELECT acceptance_source FROM work LIMIT 1),
      'bindingAcceptanceSource',(SELECT acceptance_source FROM bound LIMIT 1),
      'acceptedDraftKind',(SELECT q.content #>> '{acceptedDraftRef,kind}' FROM qa_request_input_revisions q JOIN work w ON (q.workspace_id,q.project_id,q.work_item_id)=(w.workspace_id,w.project_id,w.id) LIMIT 1),
      'sourceDraftRows',(SELECT count(*)::int FROM work WHERE source_draft_id IS NOT NULL),
      'importedEvents',(SELECT count(*)::int FROM event_outbox e JOIN work w ON (e.workspace_id,e.project_id)=(w.workspace_id,w.project_id) WHERE e.event_type='work_item.operational.imported' AND e.envelope->>'workItemId'=w.id::text)
    )::text;
  `;
  const output = compose(
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
    "awp",
    "--tuples-only",
    "--no-align",
    "--command",
    sql,
  ).trim();
  if (!output) throw new Error("IMPORT_SNAPSHOT_MISSING");
  return JSON.parse(output) as ImportSnapshot;
}

function totalImportedWorkItems(): number {
  const output = compose(
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
    "awp",
    "--tuples-only",
    "--no-align",
    "--command",
    "SELECT count(*)::int FROM work_items WHERE acceptance_source='OPERATIONAL_IMPORT';",
  ).trim();
  return Number(output);
}

function durableMockIssueCount(externalEntityId: string): number {
  const external = externalLiteral(externalEntityId);
  const output = compose(
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
    "awp_mock",
    "--tuples-only",
    "--no-align",
    "--command",
    `SELECT count(*)::int FROM jira_mock_issues WHERE id=${external};`,
  ).trim();
  return Number(output);
}

function reconciliationState(runId: string): string | null {
  if (!/^[0-9a-f-]{36}$/iu.test(runId)) throw new Error("RECONCILIATION_RUN_ID_INVALID");
  const output = compose(
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
    "awp",
    "--tuples-only",
    "--no-align",
    "--command",
    `SELECT state FROM reconciliation_runs WHERE id='${runId}'::uuid;`,
  ).trim();
  return output || null;
}

async function session(request: APIRequestContext, personaKey: string): Promise<LocalSession> {
  const response = await request.post(`${apiUrl}/local/persona/exchange`, { data: { personaKey } });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as LocalSession;
}

async function createIssue(
  request: APIRequestContext,
  input: Readonly<{
    summary: string;
    projectId?: string;
    issueTypeId?: string;
    discriminator?: string;
    creator: string;
    acceptanceOutcome?: string;
  }>,
): Promise<JiraIssueResponse> {
  const response = await request.post(`${mockHubUrl}/rest/api/3/issue`, {
    data: {
      fields: {
        project: { id: input.projectId ?? "100" },
        issuetype: { id: input.issueTypeId ?? "10001" },
        summary: input.summary,
        description: "Imported request goal",
        customfield_10010: input.discriminator ?? "ALPHA",
        ...(input.acceptanceOutcome ? { customfield_10012: input.acceptanceOutcome } : {}),
        creator: { accountId: input.creator },
        reporter: { accountId: input.creator },
        status: { id: "1", name: "Open" },
      },
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as JiraIssueResponse;
}

async function webhook(
  request: APIRequestContext,
  issueId: string,
  deliveryId: string,
): Promise<Readonly<{ status: string }>> {
  const body = JSON.stringify({ webhookEvent: "jira:issue_created", issue: { id: issueId } });
  const response = await request.post(webhookUrl, {
    headers: {
      "content-type": "application/json",
      "x-atlassian-webhook-identifier": deliveryId,
      "x-hub-signature": `sha256=${createHmac("sha256", "local-hmac").update(body).digest("hex")}`,
    },
    data: body,
  });
  expect(response.status(), await response.text()).toBe(202);
  return (await response.json()) as Readonly<{ status: string }>;
}

test.describe("003 US2 process-level direct Jira import", () => {
  test.setTimeout(240_000);

  test("webhook and reconciliation adopt verified humans once and redact denied candidates", async ({
    request,
  }) => {
    const suffix = `${Date.now()}-${process.pid}`;
    const requester = await session(request, "requester.alpha");
    const integrationAdmin = await session(request, "integration-admin.alpha");
    const requesterAuthorization = { authorization: `Bearer ${requester.accessToken}` };
    const adminAuthorization = { authorization: `Bearer ${integrationAdmin.accessToken}` };
    const scopeUrl = `${apiUrl}/api/v1/workspaces/${requester.context.workspaceId}/projects/${requester.context.projectId}`;

    const first = await createIssue(request, {
      summary: `Verified direct import ${suffix}`,
      creator: "jira-user-requester-alpha",
    });
    expect(await webhook(request, first.id, `us2-first-${suffix}`)).toMatchObject({
      status: "ACCEPTED",
    });
    expect(await webhook(request, first.id, `us2-first-${suffix}`)).toMatchObject({
      status: "DUPLICATE",
    });

    await expect
      .poll(() => importSnapshot(first.id), { timeout: 60_000, intervals: [250, 500, 1_000] })
      .toMatchObject({
        seedVersion: 5,
        state: "ADOPTED",
        reasonCode: null,
        displayKey: first.key,
        workItems: 1,
        bindings: 1,
        projections: 1,
        qaExtensions: 1,
        qaInputs: 1,
        readinessState: "NEEDS_INFO",
        workItemState: "NEEDS_INFO",
        normalizedStatus: "NEW",
        workItemAcceptanceSource: "OPERATIONAL_IMPORT",
        bindingAcceptanceSource: "VERIFIED_IMPORT",
        acceptedDraftKind: "operational-import-intent",
        sourceDraftRows: 0,
        importedEvents: 1,
      });

    const second = await createIssue(request, {
      summary: `Reconciliation-only direct import ${suffix}`,
      creator: "jira-user-requester-alpha",
    });
    const reconciliation = await request.post(
      `${scopeUrl}/operational-authority/reconciliation/IMPORT_DISCOVERY`,
      { headers: adminAuthorization, data: {} },
    );
    expect(reconciliation.status(), await reconciliation.text()).toBe(201);
    const run = (await reconciliation.json()) as ReconciliationResponse;
    expect(run).toMatchObject({
      status: "QUEUED",
      runId: expect.stringMatching(/^[0-9a-f-]{36}$/iu),
    });
    await expect
      .poll(() => reconciliationState(run.runId), { timeout: 60_000, intervals: [250, 500, 1_000] })
      .toBe("SUCCEEDED");
    await expect
      .poll(() => importSnapshot(second.id).state, {
        timeout: 30_000,
        intervals: [250, 500, 1_000],
      })
      .toBe("ADOPTED");
    expect(importSnapshot(first.id).workItems).toBe(1);
    expect(totalImportedWorkItems()).toBe(2);
    expect(durableMockIssueCount(first.id)).toBe(1);
    expect(durableMockIssueCount(second.id)).toBe(1);

    const unverified = await createIssue(request, {
      summary: `Unverified creator must not import ${suffix}`,
      creator: "jira-user-unverified",
    });
    await webhook(request, unverified.id, `us2-unverified-${suffix}`);
    await expect
      .poll(() => importSnapshot(unverified.id), { timeout: 30_000, intervals: [250, 500, 1_000] })
      .toMatchObject({
        state: "AWAITING_CONFIRMATION",
        reasonCode: "IMPORT_CREATOR_NOT_VERIFIED",
        workItems: 0,
        bindings: 0,
        qaExtensions: 0,
      });

    const secret = `FOREIGN-CONTENT-${suffix}`;
    const foreign = await createIssue(request, {
      summary: secret,
      projectId: "200",
      issueTypeId: "10002",
      discriminator: "BETA",
      creator: "jira-user-requester-alpha",
    });
    await webhook(request, foreign.id, `us2-foreign-${suffix}`);
    await expect
      .poll(() => importSnapshot(foreign.id), { timeout: 30_000, intervals: [250, 500, 1_000] })
      .toMatchObject({
        state: "IGNORED_OUT_OF_SCOPE",
        reasonCode: "PROJECT_MISMATCH",
        displayKey: "REDACTED",
        workItems: 0,
        bindings: 0,
        projections: 0,
        qaExtensions: 0,
      });
    expect(totalImportedWorkItems()).toBe(2);
    expect(durableMockIssueCount(unverified.id)).toBe(1);
    expect(durableMockIssueCount(foreign.id)).toBe(1);

    const diagnostics = await request.get(`${scopeUrl}/operational-authority/imports`, {
      headers: requesterAuthorization,
    });
    expect(diagnostics.ok(), await diagnostics.text()).toBe(true);
    const diagnosticsText = await diagnostics.text();
    expect(diagnosticsText).not.toContain(secret);
    expect(diagnosticsText).not.toContain("Imported request goal");
  });
});
