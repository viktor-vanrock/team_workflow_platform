import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { resolve } from "node:path";

import { type APIRequestContext, expect, test } from "@playwright/test";

import {
  normalizeQaJiraSourceIssueObservation,
  qaJiraSourceRefFromObservation,
} from "../../../packages/runtime-composition/src/jira/qa-source-context.ts";

const workspace = resolve(import.meta.dirname, "../../..");
const composeFile = resolve(workspace, "infra/compose/docker-compose.local.yml");
const projectName = process.env.AWP_LOCAL_PROJECT_NAME?.trim() ?? "";
const apiUrl = process.env.AWP_API_URL?.trim() || "http://127.0.0.1:3000";
const workerUrl = process.env.AWP_WORKER_URL?.trim() || "http://127.0.0.1:3010";
const mockHubUrl = process.env.AWP_MOCK_HUB_PUBLIC_URL?.trim() || "http://127.0.0.1:4010";

if (!/^awp-local-003-us1-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(projectName)) {
  throw new Error(
    "AWP_LOCAL_PROJECT_NAME must be a unique awp-local-003-us1-* scope; use the process smoke runner",
  );
}

interface LocalSession {
  readonly accessToken: string;
  readonly context: Readonly<{ workspaceId: string; projectId: string }>;
}

interface ConfirmationResponse {
  readonly commandId: string;
  readonly effectIdempotencyKey: string;
  readonly state: string;
  readonly replayed: boolean;
  readonly workItemId?: string;
}

interface DurableSnapshot {
  readonly commandState: string;
  readonly commandAttempts: number;
  readonly commandsForDraft: number;
  readonly outboxCount: number;
  readonly outboxStates: readonly string[];
  readonly draftState: string;
  readonly workItems: number;
  readonly bindings: number;
  readonly projections: number;
  readonly qaExtensions: number;
  readonly qaInputSourceRefs: readonly unknown[];
  readonly seedVersion: number | null;
  readonly commandSourceRefs: readonly unknown[];
  readonly pinCount: number;
  readonly pinPurposes: readonly string[];
  readonly pinRoles: readonly string[];
  readonly pinProfileVersions: readonly number[];
  readonly pinMappingVersions: readonly number[];
  readonly pinConnectionVersions: readonly number[];
  readonly pinConnectionVariants: number;
  readonly pinAuthorityNamespaces: number;
  readonly workItemId: string | null;
  readonly workItemAcceptanceSource: string | null;
  readonly bindingAcceptanceSource: string | null;
  readonly webhookReceipts: number;
  readonly webhookOutboxCount: number;
  readonly webhookOutboxStates: readonly string[];
  readonly bindingWebhookObserved: boolean;
  readonly jiraEffectState: string | null;
  readonly jiraEffectAttempts: number | null;
  readonly jiraEffectExternalEntityId: string | null;
  readonly jiraEffectMarker: string | null;
  readonly jiraSubEffects: number;
  readonly jiraSubEffectKinds: readonly string[];
  readonly jiraSubEffectIdentities: readonly string[];
  readonly jiraSubEffectRequired: readonly boolean[];
  readonly jiraSubEffectStates: readonly string[];
  readonly jiraSubEffectAttempts: readonly number[];
  readonly jiraSubEffectExternalIdentities: readonly (string | null)[];
  readonly jiraSubEffectReceipts: number;
}

interface JiraSearchResponse {
  readonly total: number;
  readonly issues: readonly Readonly<{ id: string; key: string; marker?: string }>[];
}

function compose(...args: readonly string[]): string {
  return execFileSync(
    "docker",
    ["compose", "--project-name", projectName, "--file", composeFile, ...args],
    { cwd: workspace, encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "inherit"] },
  );
}

function uuidLiteral(value: string, name: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new Error(`${name}_INVALID:${value}`);
  }
  return `'${value}'::uuid`;
}

function platformSnapshot(commandId: string, draftId: string): DurableSnapshot {
  const command = uuidLiteral(commandId, "COMMAND_ID");
  const draft = uuidLiteral(draftId, "DRAFT_ID");
  const sql = `
    WITH matched_work AS (
      SELECT id,workspace_id,project_id
        FROM work_items
       WHERE source_draft_id=${draft}
    ), matched_bindings AS (
      SELECT b.id,b.workspace_id,b.project_id
        FROM operational_bindings b
        JOIN matched_work w
          ON w.workspace_id=b.workspace_id AND w.project_id=b.project_id AND w.id=b.work_item_id
    )
    SELECT json_build_object(
      'commandState',(SELECT state FROM connector_commands WHERE id=${command}),
      'commandAttempts',(SELECT (payload #>> '{metadata,attemptCount}')::int FROM connector_commands WHERE id=${command}),
      'commandsForDraft',(SELECT count(*)::int FROM connector_commands c WHERE c.payload #>> '{metadata,source,intakeDraftId}'=${draft}::text),
      'outboxCount',(SELECT count(*)::int FROM command_outbox WHERE command_id=${command}),
      'outboxStates',COALESCE((SELECT json_agg(state ORDER BY id) FROM command_outbox WHERE command_id=${command}),'[]'::json),
      'draftState',(SELECT state FROM intake_drafts WHERE id=${draft}),
      'workItems',(SELECT count(*)::int FROM matched_work),
      'bindings',(SELECT count(*)::int FROM matched_bindings),
      'projections',(SELECT count(*)::int FROM operational_projection_revisions p JOIN matched_bindings b ON b.workspace_id=p.workspace_id AND b.project_id=p.project_id AND b.id=p.binding_id),
      'qaExtensions',(SELECT count(*)::int FROM qa_request_extensions q JOIN matched_work w ON w.workspace_id=q.workspace_id AND w.project_id=q.project_id AND w.id=q.work_item_id),
      'qaInputSourceRefs',COALESCE((SELECT q.content->'sourceRefs' FROM qa_request_input_revisions q JOIN matched_work w ON w.workspace_id=q.workspace_id AND w.project_id=q.project_id AND w.id=q.work_item_id LIMIT 1),'[]'::jsonb),
      'seedVersion',(SELECT version::int FROM local_seed_markers WHERE key='003-qa-jira-local'),
      'commandSourceRefs',COALESCE((SELECT payload->'value'->'sourceRefs' FROM connector_commands WHERE id=${command}),'[]'::jsonb),
      'pinCount',(SELECT count(*)::int FROM connector_command_configuration_pins WHERE command_id=${command}),
      'pinPurposes',COALESCE((SELECT json_agg(purpose ORDER BY sequence) FROM connector_command_configuration_pins WHERE command_id=${command}),'[]'::json),
      'pinRoles',COALESCE((SELECT json_agg(logical_role ORDER BY sequence) FROM connector_command_configuration_pins WHERE command_id=${command}),'[]'::json),
      'pinProfileVersions',COALESCE((SELECT json_agg((connector_profile_ref->>'version')::int ORDER BY sequence) FROM connector_command_configuration_pins WHERE command_id=${command}),'[]'::json),
      'pinMappingVersions',COALESCE((SELECT json_agg((mapping_ref->>'version')::int ORDER BY sequence) FROM connector_command_configuration_pins WHERE command_id=${command}),'[]'::json),
      'pinConnectionVersions',COALESCE((SELECT json_agg((connection_ref->>'version')::int ORDER BY sequence) FROM connector_command_configuration_pins WHERE command_id=${command}),'[]'::json),
      'pinConnectionVariants',(SELECT count(DISTINCT connection_ref::text)::int FROM connector_command_configuration_pins WHERE command_id=${command}),
      'pinAuthorityNamespaces',(SELECT count(DISTINCT authority_namespace_hash)::int FROM connector_command_configuration_pins WHERE command_id=${command}),
      'workItemId',(SELECT id::text FROM matched_work LIMIT 1),
      'workItemAcceptanceSource',(SELECT acceptance_source FROM matched_work JOIN work_items USING(id,workspace_id,project_id) LIMIT 1),
      'bindingAcceptanceSource',(SELECT acceptance_source FROM operational_bindings b JOIN matched_bindings m USING(id,workspace_id,project_id) LIMIT 1)
      ,'webhookReceipts',(SELECT count(*)::int FROM webhook_receipts WHERE connector_key='jira:92000000-0000-4000-8000-000000000001')
      ,'webhookOutboxCount',(SELECT count(*)::int FROM event_outbox WHERE event_type='jira.authoritative-read.requested.v1')
      ,'webhookOutboxStates',COALESCE((SELECT json_agg(state ORDER BY id) FROM event_outbox WHERE event_type='jira.authoritative-read.requested.v1'),'[]'::json)
      ,'bindingWebhookObserved',COALESCE((SELECT last_webhook_at IS NOT NULL FROM operational_bindings b JOIN matched_bindings m USING(id,workspace_id,project_id) LIMIT 1),false)
      ,'jiraEffectState',(SELECT state FROM jira_effect_reconciliations WHERE command_id=${command})
      ,'jiraEffectAttempts',(SELECT attempt::int FROM jira_effect_reconciliations WHERE command_id=${command})
      ,'jiraEffectExternalEntityId',(SELECT external_entity_id FROM jira_effect_reconciliations WHERE command_id=${command})
      ,'jiraEffectMarker',(SELECT marker FROM jira_effect_reconciliations WHERE command_id=${command})
      ,'jiraSubEffects',(SELECT count(*)::int FROM jira_effect_sub_effects s JOIN jira_effect_reconciliations e ON e.id=s.effect_id WHERE e.command_id=${command})
      ,'jiraSubEffectKinds',COALESCE((SELECT json_agg(s.kind ORDER BY s.sequence) FROM jira_effect_sub_effects s JOIN jira_effect_reconciliations e ON e.id=s.effect_id WHERE e.command_id=${command}),'[]'::json)
      ,'jiraSubEffectIdentities',COALESCE((SELECT json_agg(s.semantic_identity ORDER BY s.sequence) FROM jira_effect_sub_effects s JOIN jira_effect_reconciliations e ON e.id=s.effect_id WHERE e.command_id=${command}),'[]'::json)
      ,'jiraSubEffectRequired',COALESCE((SELECT json_agg(s.required ORDER BY s.sequence) FROM jira_effect_sub_effects s JOIN jira_effect_reconciliations e ON e.id=s.effect_id WHERE e.command_id=${command}),'[]'::json)
      ,'jiraSubEffectStates',COALESCE((SELECT json_agg(s.state ORDER BY s.sequence) FROM jira_effect_sub_effects s JOIN jira_effect_reconciliations e ON e.id=s.effect_id WHERE e.command_id=${command}),'[]'::json)
      ,'jiraSubEffectAttempts',COALESCE((SELECT json_agg(s.attempt ORDER BY s.sequence) FROM jira_effect_sub_effects s JOIN jira_effect_reconciliations e ON e.id=s.effect_id WHERE e.command_id=${command}),'[]'::json)
      ,'jiraSubEffectExternalIdentities',COALESCE((SELECT json_agg(s.external_identity ORDER BY s.sequence) FROM jira_effect_sub_effects s JOIN jira_effect_reconciliations e ON e.id=s.effect_id WHERE e.command_id=${command}),'[]'::json)
      ,'jiraSubEffectReceipts',(SELECT count(*)::int FROM jira_effect_sub_effects s JOIN jira_effect_reconciliations e ON e.id=s.effect_id WHERE e.command_id=${command} AND s.receipt_hash IS NOT NULL)
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
  if (!output) throw new Error("PLATFORM_SNAPSHOT_MISSING");
  return JSON.parse(output) as DurableSnapshot;
}

function mockIssueCount(effectIdempotencyKey: string): number {
  if (!/^awp:effect:[0-9a-f-]+$/iu.test(effectIdempotencyKey)) {
    throw new Error(`EFFECT_IDEMPOTENCY_KEY_INVALID:${effectIdempotencyKey}`);
  }
  const sql = `SELECT count(*)::int FROM jira_mock_issues WHERE marker='${effectIdempotencyKey}';`;
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
    sql,
  ).trim();
  return Number(output);
}

function mockLinkCount(issueId: string, sourceIssueId: string): number {
  for (const [name, value] of [
    ["ISSUE_ID", issueId],
    ["SOURCE_ISSUE_ID", sourceIssueId],
  ] as const) {
    if (!/^[A-Za-z0-9._-]+$/u.test(value)) throw new Error(`${name}_INVALID:${value}`);
  }
  const sql = `SELECT count(*)::int FROM jira_mock_links WHERE issue_id='${issueId}' AND type_id='10000' AND other_issue_id='${sourceIssueId}' AND direction='OUTWARD';`;
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
    sql,
  ).trim();
  return Number(output);
}

function mockIssueLinkCount(issueId: string): number {
  if (!/^[A-Za-z0-9._-]+$/u.test(issueId)) throw new Error(`ISSUE_ID_INVALID:${issueId}`);
  const sql = `SELECT count(*)::int FROM jira_mock_links WHERE issue_id='${issueId}';`;
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
    sql,
  ).trim();
  return Number(output);
}

function mockLinkWriteSnapshot(
  issueId: string,
  sourceIssueId: string,
): Readonly<{ total: number; matching: number }> {
  for (const [name, value] of [
    ["ISSUE_ID", issueId],
    ["SOURCE_ISSUE_ID", sourceIssueId],
  ] as const) {
    if (!/^[A-Za-z0-9._-]+$/u.test(value)) throw new Error(`${name}_INVALID:${value}`);
  }
  const sql = `SELECT json_build_object(
    'total',(SELECT count(*)::int FROM jira_mock_effect_calls WHERE operation='LINK'),
    'matching',(SELECT count(*)::int FROM jira_mock_effect_calls WHERE operation='LINK' AND request_body #>> '{type,id}'='10000' AND request_body #>> '{outwardIssue,id}'='${issueId}' AND request_body #>> '{inwardIssue,id}'='${sourceIssueId}')
  )::text;`;
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
    sql,
  ).trim();
  if (!output) throw new Error("JIRA_MOCK_LINK_WRITE_SNAPSHOT_MISSING");
  return JSON.parse(output) as Readonly<{ total: number; matching: number }>;
}

async function isReady(request: APIRequestContext, url: string): Promise<boolean> {
  try {
    return (await request.get(url, { timeout: 3_000 })).ok();
  } catch {
    return false;
  }
}

async function searchJira(
  request: APIRequestContext,
  effectIdempotencyKey: string,
): Promise<JiraSearchResponse> {
  const response = await request.get(`${mockHubUrl}/rest/api/3/search/jql`, {
    params: {
      jql: `project = "100" AND issuetype = "10001" AND customfield_10011 = "${effectIdempotencyKey}"`,
      fields: "id",
      maxResults: "2",
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as JiraSearchResponse;
}

test.describe("003 US1 process-level durable Jira confirmation", () => {
  test.setTimeout(300_000);

  test.afterEach(async ({ request }) => {
    try {
      compose("up", "--detach", "--no-deps", "mock-hub", "worker");
      await expect
        .poll(async () => await isReady(request, `${workerUrl}/health/ready`), {
          timeout: 60_000,
        })
        .toBe(true);
    } catch {
      // The dedicated runner removes the unique stack. Preserve the original test failure.
    }
  });

  test("worker stop, durable recovery and restart/replay converge to exactly one Jira-backed Work Item", async ({
    request,
  }) => {
    const suffix = `${Date.now()}-${process.pid}`;
    const idempotencyKey = `pw-003-us1-${suffix}`;

    const exchange = await request.post(`${apiUrl}/local/persona/exchange`, {
      data: { personaKey: "requester.alpha" },
    });
    expect(exchange.ok(), await exchange.text()).toBe(true);
    const session = (await exchange.json()) as LocalSession;
    const authorization = { authorization: `Bearer ${session.accessToken}` };
    const scopeUrl = `${apiUrl}/api/v1/workspaces/${session.context.workspaceId}/projects/${session.context.projectId}`;

    const sourceIssueResponse = await request.post(`${mockHubUrl}/rest/api/3/issue`, {
      data: {
        fields: {
          project: { id: "200" },
          issuetype: { id: "10002" },
          summary: `Process source issue ${suffix}`,
          customfield_10010: "ALPHA",
        },
      },
    });
    expect(sourceIssueResponse.ok(), await sourceIssueResponse.text()).toBe(true);
    const sourceObservation = normalizeQaJiraSourceIssueObservation(
      await sourceIssueResponse.json(),
    );
    const sourceRef = qaJiraSourceRefFromObservation(sourceObservation);
    const sourceIssueId = sourceObservation.externalEntityId;

    compose("stop", "worker");
    await expect
      .poll(async () => await isReady(request, `${workerUrl}/health/ready`), {
        timeout: 30_000,
      })
      .toBe(false);

    const draftResponse = await request.post(`${scopeUrl}/qa/intake`, {
      headers: authorization,
      data: {
        schemaVersion: 1,
        title: `Process durable Jira request ${suffix}`,
        requestKind: "feature-validation",
        goal: "Prove the durable qa-jira-local request.create path",
        acceptanceOutcome: "Exactly one authoritative Jira-backed Work Item is linked",
        sourceRefs: [sourceRef],
        blockers: [],
        dependencies: [],
        requestedClassificationKey: "INTERNAL",
      },
    });
    expect(draftResponse.ok(), await draftResponse.text()).toBe(true);
    const draft = (await draftResponse.json()) as Readonly<{ draftId: string; state: string }>;
    expect(draft.state).toBe("DRAFT");

    const confirmationResponse = await request.post(
      `${scopeUrl}/intake-drafts/${draft.draftId}/qa-confirmation`,
      { headers: { ...authorization, "idempotency-key": idempotencyKey }, data: {} },
    );
    expect(confirmationResponse.status(), await confirmationResponse.text()).toBe(202);
    const queued = (await confirmationResponse.json()) as ConfirmationResponse;
    expect(queued).toMatchObject({ state: "QUEUED", replayed: false });

    const beforeWorker = platformSnapshot(queued.commandId, draft.draftId);
    expect(beforeWorker).toMatchObject({
      commandState: "QUEUED",
      commandAttempts: 0,
      commandsForDraft: 1,
      outboxCount: 1,
      outboxStates: ["READY"],
      draftState: "DRAFT",
      workItems: 0,
      bindings: 0,
      projections: 0,
      qaExtensions: 0,
      qaInputSourceRefs: [],
      seedVersion: 5,
      commandSourceRefs: [sourceRef],
      pinCount: 0,
      pinPurposes: [],
      pinRoles: [],
      pinProfileVersions: [],
      pinMappingVersions: [],
      pinConnectionVersions: [],
      pinConnectionVariants: 0,
      pinAuthorityNamespaces: 0,
      workItemId: null,
      workItemAcceptanceSource: null,
      bindingAcceptanceSource: null,
      webhookReceipts: 0,
      webhookOutboxCount: 0,
      webhookOutboxStates: [],
      bindingWebhookObserved: false,
      jiraEffectState: null,
      jiraEffectAttempts: null,
      jiraEffectExternalEntityId: null,
      jiraEffectMarker: null,
      jiraSubEffects: 0,
      jiraSubEffectKinds: [],
      jiraSubEffectIdentities: [],
      jiraSubEffectRequired: [],
      jiraSubEffectStates: [],
      jiraSubEffectAttempts: [],
      jiraSubEffectExternalIdentities: [],
      jiraSubEffectReceipts: 0,
    });
    expect(mockIssueCount(queued.effectIdempotencyKey)).toBe(0);
    await expect(searchJira(request, queued.effectIdempotencyKey)).resolves.toMatchObject({
      total: 0,
      issues: [],
    });

    const timeoutAfterEffect = await request.post(`${mockHubUrl}/mock/jira/scenario`, {
      data: { scenario: "TIMEOUT_AFTER_EFFECT" },
    });
    expect(timeoutAfterEffect.ok(), await timeoutAfterEffect.text()).toBe(true);

    compose("start", "worker");
    await expect
      .poll(async () => await isReady(request, `${workerUrl}/health/ready`), {
        timeout: 60_000,
      })
      .toBe(true);
    await expect
      .poll(() => mockIssueCount(queued.effectIdempotencyKey), {
        timeout: 30_000,
        intervals: [250, 500, 1_000],
      })
      .toBe(1);
    expect(platformSnapshot(queued.commandId, draft.draftId)).toMatchObject({
      commandState: "DISPATCHED",
      commandAttempts: 1,
      outboxStates: ["ACKNOWLEDGED"],
      draftState: "DRAFT",
      workItems: 0,
      bindings: 0,
      projections: 0,
      qaExtensions: 0,
      qaInputSourceRefs: [],
      commandSourceRefs: [sourceRef],
      pinCount: 2,
      pinPurposes: ["PRIMARY", "AUXILIARY"],
      pinRoles: ["QA_REQUEST_AUTHORITY", "SOURCE_CONTEXT"],
      pinProfileVersions: [6, 1],
      pinMappingVersions: [2, 1],
      pinConnectionVersions: [2, 2],
      pinConnectionVariants: 1,
      pinAuthorityNamespaces: 1,
      jiraEffectState: "EFFECT_IN_PROGRESS",
      jiraEffectAttempts: 1,
      jiraEffectExternalEntityId: null,
      jiraEffectMarker: queued.effectIdempotencyKey,
      jiraSubEffects: 0,
      jiraSubEffectKinds: [],
      jiraSubEffectIdentities: [],
      jiraSubEffectRequired: [],
      jiraSubEffectStates: [],
      jiraSubEffectAttempts: [],
      jiraSubEffectExternalIdentities: [],
      jiraSubEffectReceipts: 0,
    });

    const firstJiraRead = await searchJira(request, queued.effectIdempotencyKey);
    expect(firstJiraRead.total).toBe(1);
    expect(firstJiraRead.issues).toHaveLength(1);
    const externalEntityId = firstJiraRead.issues[0]!.id;
    expect(mockLinkCount(externalEntityId, sourceIssueId)).toBe(0);
    expect(mockLinkWriteSnapshot(externalEntityId, sourceIssueId)).toEqual({
      total: 0,
      matching: 0,
    });

    const timeoutAfterLink = await request.post(`${mockHubUrl}/mock/jira/scenario`, {
      data: { scenario: "TIMEOUT_AFTER_EFFECT" },
    });
    expect(timeoutAfterLink.ok(), await timeoutAfterLink.text()).toBe(true);
    await expect
      .poll(() => mockLinkCount(externalEntityId, sourceIssueId), {
        timeout: 90_000,
        intervals: [500, 1_000, 2_000],
      })
      .toBe(1);
    expect(mockLinkWriteSnapshot(externalEntityId, sourceIssueId)).toEqual({
      total: 1,
      matching: 1,
    });
    await expect
      .poll(() => platformSnapshot(queued.commandId, draft.draftId), {
        timeout: 30_000,
        intervals: [250, 500, 1_000],
      })
      .toMatchObject({
        commandState: "DISPATCHED",
        commandAttempts: 2,
        outboxStates: ["ACKNOWLEDGED"],
        draftState: "DRAFT",
        workItems: 0,
        bindings: 0,
        projections: 0,
        qaExtensions: 0,
        qaInputSourceRefs: [],
        pinCount: 2,
        pinPurposes: ["PRIMARY", "AUXILIARY"],
        pinRoles: ["QA_REQUEST_AUTHORITY", "SOURCE_CONTEXT"],
        pinProfileVersions: [6, 1],
        pinMappingVersions: [2, 1],
        pinConnectionVersions: [2, 2],
        pinConnectionVariants: 1,
        pinAuthorityNamespaces: 1,
        jiraEffectState: "ISSUE_FOUND",
        jiraEffectAttempts: 2,
        jiraEffectExternalEntityId: externalEntityId,
        jiraEffectMarker: queued.effectIdempotencyKey,
        jiraSubEffects: 1,
        jiraSubEffectKinds: ["ISSUE_LINK"],
        jiraSubEffectIdentities: [`issue:${sourceIssueId}`],
        jiraSubEffectRequired: [true],
        jiraSubEffectStates: ["PENDING"],
        jiraSubEffectAttempts: [1],
        jiraSubEffectExternalIdentities: [null],
        jiraSubEffectReceipts: 0,
      });

    compose("restart", "worker", "mock-hub");
    await expect
      .poll(async () => await isReady(request, `${workerUrl}/health/ready`), {
        timeout: 60_000,
      })
      .toBe(true);
    await expect
      .poll(async () => await isReady(request, `${mockHubUrl}/health/live`), {
        timeout: 60_000,
      })
      .toBe(true);

    await expect
      .poll(() => platformSnapshot(queued.commandId, draft.draftId).commandState, {
        timeout: 120_000,
        intervals: [500, 1_000, 2_000],
      })
      .toBe("CONFIRMED");

    const confirmed = platformSnapshot(queued.commandId, draft.draftId);
    expect(confirmed).toMatchObject({
      commandState: "CONFIRMED",
      commandAttempts: 3,
      commandsForDraft: 1,
      outboxCount: 1,
      outboxStates: ["ACKNOWLEDGED"],
      draftState: "SUBMITTED",
      workItems: 1,
      bindings: 1,
      projections: 1,
      qaExtensions: 1,
      qaInputSourceRefs: [sourceRef],
      seedVersion: 5,
      workItemAcceptanceSource: "PLATFORM_DRAFT",
      bindingAcceptanceSource: "CREATE_READ_BACK",
      pinCount: 2,
      pinPurposes: ["PRIMARY", "AUXILIARY"],
      pinRoles: ["QA_REQUEST_AUTHORITY", "SOURCE_CONTEXT"],
      pinProfileVersions: [6, 1],
      pinMappingVersions: [2, 1],
      pinConnectionVersions: [2, 2],
      pinConnectionVariants: 1,
      pinAuthorityNamespaces: 1,
      jiraEffectState: "CONFIRMED",
      jiraEffectAttempts: 3,
      jiraEffectExternalEntityId: externalEntityId,
      jiraEffectMarker: queued.effectIdempotencyKey,
      jiraSubEffects: 1,
      jiraSubEffectKinds: ["ISSUE_LINK"],
      jiraSubEffectIdentities: [`issue:${sourceIssueId}`],
      jiraSubEffectRequired: [true],
      jiraSubEffectStates: ["CONFIRMED"],
      jiraSubEffectAttempts: [2],
      jiraSubEffectExternalIdentities: [expect.stringMatching(/^jira-link:sha256:[a-f0-9]{64}$/u)],
      jiraSubEffectReceipts: 1,
    });
    expect(confirmed.workItemId).toMatch(/^[0-9a-f-]{36}$/iu);
    expect(mockIssueCount(queued.effectIdempotencyKey)).toBe(1);
    expect(mockLinkCount(externalEntityId, sourceIssueId)).toBe(1);
    expect(mockIssueLinkCount(externalEntityId)).toBe(1);
    expect(mockLinkWriteSnapshot(externalEntityId, sourceIssueId)).toEqual({
      total: 1,
      matching: 1,
    });

    const unauthenticatedProjectionResponse = await request.get(
      `${scopeUrl}/operational-authority/work-items/${confirmed.workItemId!}/projection`,
    );
    expect(unauthenticatedProjectionResponse.status()).toBe(401);

    const outOfScopeProjectionResponse = await request.get(
      `${apiUrl}/api/v1/workspaces/${session.context.workspaceId}/projects/00000000-0000-4000-8000-000000000001/operational-authority/work-items/${confirmed.workItemId!}/projection`,
      { headers: authorization },
    );
    expect(outOfScopeProjectionResponse.status()).toBe(403);

    const projectionResponse = await request.get(
      `${scopeUrl}/operational-authority/work-items/${confirmed.workItemId!}/projection`,
      { headers: authorization },
    );
    expect(projectionResponse.ok(), await projectionResponse.text()).toBe(true);
    await expect(projectionResponse.json()).resolves.toMatchObject({
      external_entity_id: externalEntityId,
      current_projection_revision_id: expect.any(String),
      sync_state: "SYNCED",
      freshness_state: "CURRENT",
    });

    const webhookBody = JSON.stringify({
      webhookEvent: "jira:issue_updated",
      issue: { id: externalEntityId },
      changelog: { id: `process-${suffix}` },
    });
    const webhookHeaders = {
      "content-type": "application/json",
      "x-atlassian-webhook-identifier": `process-delivery-${suffix}`,
      "x-hub-signature": `sha256=${createHmac("sha256", "local-hmac").update(webhookBody).digest("hex")}`,
    };
    const webhookUrl = `${apiUrl}/api/v1/connectors/jira/connections/92000000-0000-4000-8000-000000000001/webhooks/local-webhook-key-0000000000000001`;
    const acceptedWebhook = await request.post(webhookUrl, {
      headers: webhookHeaders,
      data: webhookBody,
    });
    expect(acceptedWebhook.status(), await acceptedWebhook.text()).toBe(202);
    await expect(acceptedWebhook.json()).resolves.toMatchObject({ status: "ACCEPTED" });

    const duplicateWebhook = await request.post(webhookUrl, {
      headers: webhookHeaders,
      data: webhookBody,
    });
    expect(duplicateWebhook.status(), await duplicateWebhook.text()).toBe(202);
    await expect(duplicateWebhook.json()).resolves.toMatchObject({ status: "DUPLICATE" });
    await expect
      .poll(() => platformSnapshot(queued.commandId, draft.draftId), {
        timeout: 30_000,
        intervals: [250, 500, 1_000],
      })
      .toMatchObject({
        projections: 1,
        webhookReceipts: 1,
        webhookOutboxCount: 1,
        webhookOutboxStates: ["ACKNOWLEDGED"],
        bindingWebhookObserved: true,
      });

    const replayResponse = await request.post(
      `${scopeUrl}/intake-drafts/${draft.draftId}/qa-confirmation`,
      {
        headers: {
          ...authorization,
          "idempotency-key": `${idempotencyKey}-different-transport-retry`,
        },
        data: {},
      },
    );
    expect(replayResponse.ok(), await replayResponse.text()).toBe(true);
    await expect(replayResponse.json()).resolves.toMatchObject({
      commandId: queued.commandId,
      effectIdempotencyKey: queued.effectIdempotencyKey,
      state: "CONFIRMED",
      replayed: true,
      workItemId: confirmed.workItemId,
    });

    await expect
      .poll(() => platformSnapshot(queued.commandId, draft.draftId), {
        timeout: 30_000,
        intervals: [500, 1_000],
      })
      .toMatchObject({
        commandState: "CONFIRMED",
        commandAttempts: 3,
        commandsForDraft: 1,
        outboxCount: 1,
        outboxStates: ["ACKNOWLEDGED"],
        workItems: 1,
        bindings: 1,
        projections: 1,
        qaExtensions: 1,
        qaInputSourceRefs: [sourceRef],
        workItemId: confirmed.workItemId,
        workItemAcceptanceSource: "PLATFORM_DRAFT",
        bindingAcceptanceSource: "CREATE_READ_BACK",
        webhookReceipts: 1,
        webhookOutboxCount: 1,
        webhookOutboxStates: ["ACKNOWLEDGED"],
        bindingWebhookObserved: true,
        pinCount: 2,
        pinPurposes: ["PRIMARY", "AUXILIARY"],
        pinRoles: ["QA_REQUEST_AUTHORITY", "SOURCE_CONTEXT"],
        pinProfileVersions: [6, 1],
        pinMappingVersions: [2, 1],
        pinConnectionVersions: [2, 2],
        pinConnectionVariants: 1,
        pinAuthorityNamespaces: 1,
        jiraEffectState: "CONFIRMED",
        jiraEffectAttempts: 3,
        jiraEffectExternalEntityId: externalEntityId,
        jiraEffectMarker: queued.effectIdempotencyKey,
        jiraSubEffects: 1,
        jiraSubEffectKinds: ["ISSUE_LINK"],
        jiraSubEffectIdentities: [`issue:${sourceIssueId}`],
        jiraSubEffectRequired: [true],
        jiraSubEffectStates: ["CONFIRMED"],
        jiraSubEffectAttempts: [2],
        jiraSubEffectExternalIdentities: [
          expect.stringMatching(/^jira-link:sha256:[a-f0-9]{64}$/u),
        ],
        jiraSubEffectReceipts: 1,
      });
    expect(mockIssueCount(queued.effectIdempotencyKey)).toBe(1);
    expect(mockLinkCount(externalEntityId, sourceIssueId)).toBe(1);
    expect(mockIssueLinkCount(externalEntityId)).toBe(1);
    expect(mockLinkWriteSnapshot(externalEntityId, sourceIssueId)).toEqual({
      total: 1,
      matching: 1,
    });
    const replayedJiraRead = await searchJira(request, queued.effectIdempotencyKey);
    expect(replayedJiraRead.total).toBe(1);
    expect(replayedJiraRead.issues).toHaveLength(1);
    expect(replayedJiraRead.issues[0]!.id).toBe(externalEntityId);
  });
});
