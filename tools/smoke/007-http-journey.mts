import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { sha256 } from "../../packages/platform-contracts/src/canonical-hash.ts";
import { ComposeSmokeRuntime, hash, uuidSql, waitFor } from "./007-compose-runtime.mts";

type Doc = Record<string, unknown>;
type Session = {
  accessToken: string;
  persona: { principalId: string };
  context: { workspaceId: string; projectId: string };
};
export interface SmokeEvidence {
  workspaceId: string;
  projectId: string;
  workItemId: string;
  manifestId: string;
  manifestHash: string;
  packageId: string;
  packageHash: string;
}
export class OnboardingSmokeJourney {
  owner!: Session;
  admin!: Session;
  requester!: Session;
  proof!: SmokeEvidence;
  private projectId = "";
  private command!: {
    commandId: string;
    effectIdempotencyKey: string;
    draftId: string;
    scopePath: string;
    key: string;
  };
  private exportId = "";
  private redactionPolicyRef: unknown;
  private artifactHash = "";
  private before!: Doc;
  readonly runtime: ComposeSmokeRuntime;
  constructor(runtime: ComposeSmokeRuntime) {
    this.runtime = runtime;
  }
  private async request(
    origin: string,
    path: string,
    session?: Session,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const response = await fetch(origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        ...(session ? { authorization: `Bearer ${session.accessToken}` } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
    const data = (await response.json()) as Doc;
    return { status: response.status, data, headers: response.headers };
  }
  private async ok(
    path: string,
    session?: Session,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const r = await this.request(
      this.runtime.environment.AWP_API_URL!,
      path,
      session,
      body,
      headers,
    );
    assert.ok(r.status >= 200 && r.status < 300, `${path}: ${r.status} ${JSON.stringify(r.data)}`);
    return r;
  }
  private async session(personaKey: string, stepUp = false) {
    const ordinary = (await this.ok("/local/persona/exchange", undefined, { personaKey }))
      .data as unknown as Session;
    return stepUp
      ? ((await this.ok("/local/persona/step-up", ordinary, {})).data as unknown as Session)
      : ordinary;
  }
  async prepare() {
    const ordinary = await this.session("owner.local"),
      workspaceId = ordinary.context.workspaceId;
    const projectBody = {
      key: "SMOKE007",
      name: "Compose onboarding smoke",
      ownerIds: Object.fromEntries(
        ["business", "technical", "qa", "security", "escalation"].map((k) => [
          k,
          ordinary.persona.principalId,
        ]),
      ),
      criticalityKey: "STANDARD",
      dataClassificationKey: "INTERNAL",
      reason: "Isolated local smoke",
    };
    const base = `/api/v1/workspaces/${workspaceId}`;
    assert.equal(
      (
        await this.request(
          this.runtime.environment.AWP_API_URL!,
          `${base}/projects`,
          ordinary,
          projectBody,
          { "idempotency-key": randomUUID() },
        )
      ).status,
      403,
      "ordinary session must not register a project",
    );
    assert.equal(
      (
        await this.request(
          this.runtime.environment.AWP_API_URL!,
          "/local/persona/step-up",
          undefined,
          {},
        )
      ).status,
      401,
      "step-up requires a verified session",
    );
    assert.equal(
      (
        await this.request(
          this.runtime.environment.AWP_API_URL!,
          "/local/persona/step-up",
          ordinary,
          { personaKey: "integration-admin.alpha" },
        )
      ).status,
      400,
      "step-up must reject caller-selected identities",
    );
    this.owner = await this.session("owner.local", true);
    this.admin = await this.session("integration-admin.alpha");
    this.requester = await this.session("requester.alpha");
    this.artifactHash = await this.artifact();
    const registered = await this.ok(`${base}/projects`, this.owner, projectBody, {
      "idempotency-key": "smoke007-register",
    });
    this.projectId = String(registered.data.projectId);
    uuidSql(this.projectId);
    const prepared = await this.runtime.compose("controlled-evidence-input", [
      "exec",
      "-T",
      "-w",
      "/workspace",
      "-e",
      "AWP_DATABASE_URL=postgresql://awp_core_migrator:local-core-migrator-only@postgres:5432/awp",
      "-e",
      `AWP_007_SMOKE_PROJECT=${this.runtime.projectName}`,
      "api",
      "node",
      "--import",
      "tsx",
      "tools/smoke/007-runtime-fixture.mts",
      workspaceId,
      this.projectId,
    ]);
    this.proof = JSON.parse(prepared.split("\n").at(-1)!) as SmokeEvidence;
    for (const [principalId, permissions] of [
      [
        this.owner.persona.principalId,
        [
          "project.catalog.read",
          "project.onboarding.read",
          "qa.evidence.read",
          "qa.evidence.verify",
          "qa.evidence.export",
          "artifact.read",
        ],
      ],
      [
        this.admin.persona.principalId,
        ["project.catalog.read", "project.onboarding.read", "project.suspend"],
      ],
    ] as const) {
      const head = await this.ok(`${base}/projects/${this.projectId}/onboarding`, this.owner);
      await this.ok(
        `${base}/projects/${this.projectId}/entitlements`,
        this.owner,
        {
          principalId,
          operation: "GRANT",
          effect: "ALLOW",
          permissions,
          classificationCeilingKey: "INTERNAL",
          validFrom: new Date(Date.now() - 1000).toISOString(),
          reason: "Explicit smoke access",
        },
        { "idempotency-key": randomUUID(), "if-match": head.headers.get("etag")! },
      );
    }
    await this.verifyEvidence();
    this.redactionPolicyRef = (
      await this.ok(this.evidencePath("/export-options"), this.owner)
    ).data.redactionPolicyRef;
    const exported = await this.ok(
      this.evidencePath(`/packages/${this.proof.packageId}/exports`),
      this.owner,
      {
        packageVersion: 1,
        redactionPolicyRef: this.redactionPolicyRef,
        format: "JSON",
        reason: "Compose smoke export",
      },
      { "idempotency-key": "smoke007-export" },
    );
    this.exportId = String(exported.data.commandId);
    uuidSql(this.exportId);
    await this.ok(this.evidencePath(`/exports/${this.exportId}`), this.owner);
    return {
      projectId: this.projectId,
      manifestId: this.proof.manifestId,
      packageId: this.proof.packageId,
      ordinaryStepUpDenied: true,
      unauthenticatedStepUpDenied: true,
    };
  }
  private evidencePath(suffix: string) {
    return `/v1/workspaces/${this.proof.workspaceId}/projects/${this.projectId}/evidence${suffix}`;
  }
  private async artifact() {
    const response = await fetch(
      `${this.runtime.environment.AWP_API_URL}/local/walking-skeleton/artifacts/83000000-0000-4000-8000-000000000001/content`,
      {
        headers: { authorization: `Bearer ${this.owner.accessToken}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length > 0);
    return hash(bytes);
  }
  private async verifyEvidence() {
    const verification = await this.ok(
      this.evidencePath(`/manifests/${this.proof.manifestId}/verify?revision=1`),
      this.owner,
      {},
    );
    assert.equal(verification.data.integrity, "PASS");
    assert.equal(verification.data.signature, "PASS");
    const evidence = await this.ok(
      this.evidencePath(`/packages/${this.proof.packageId}`),
      this.owner,
    );
    assert.equal(evidence.data.contentHash, this.proof.packageHash);
    const denied = await this.request(
      this.runtime.environment.AWP_API_URL!,
      this.evidencePath(`/packages/${this.proof.packageId}`),
      this.requester,
    );
    assert.equal(denied.status, 404);
  }
  async queueWorkerEffect() {
    await this.runtime.compose("stop-worker-before-enqueue", ["stop", "worker"]);
    const source = await this.request(
      this.runtime.environment.AWP_MOCK_HUB_URL!,
      "/rest/api/3/issue",
      undefined,
      {
        fields: {
          project: { id: "200" },
          issuetype: { id: "10002" },
          summary: "Controlled smoke source",
          customfield_10010: "ALPHA",
        },
      },
    );
    assert.ok(source.status < 300);
    const issue = source.data,
      fields = (issue.fields ?? {}) as Doc;
    const project = String(issue.projectId ?? (fields.project as Doc).id),
      issueType = String(issue.issueTypeId ?? (fields.issuetype as Doc).id),
      updated = String(issue.updated ?? fields.updated);
    assert.ok(Number.isFinite(Date.parse(updated)));
    const contentHash = sha256({ project: { id: project }, issuetype: { id: issueType }, updated });
    const sourceRef = {
      kind: "JIRA_ISSUE",
      id: String(issue.id),
      version: `${updated}:${String(issue.changelogId ?? contentHash)}`,
      contentHash,
    };
    const { workspaceId, projectId } = this.requester.context,
      scopePath = `/api/v1/workspaces/${workspaceId}/projects/${projectId}`;
    const draft = await this.ok(`${scopePath}/qa/intake`, this.requester, {
      schemaVersion: 1,
      title: "Compose restart request",
      requestKind: "feature-validation",
      goal: "Persist a worker-owned request",
      acceptanceOutcome: "Exactly one Jira-backed Work Item",
      sourceRefs: [sourceRef],
      blockers: [],
      dependencies: [],
      requestedClassificationKey: "INTERNAL",
    });
    const draftId = String(draft.data.draftId),
      key = "smoke007-worker-effect";
    const queued = await this.ok(
      `${scopePath}/intake-drafts/${draftId}/qa-confirmation`,
      this.requester,
      {},
      { "idempotency-key": key },
    );
    assert.equal(queued.status, 202);
    assert.equal(queued.data.state, "QUEUED");
    this.command = {
      commandId: String(queued.data.commandId),
      effectIdempotencyKey: String(queued.data.effectIdempotencyKey),
      draftId,
      scopePath,
      key,
    };
    const stopped = await this.snapshot();
    assert.equal(stopped.commandState, "QUEUED");
    assert.equal(stopped.jiraIssues, 0);
    assert.equal(stopped.workItems, 0);
    await this.runtime.compose("start-worker-delivery", ["start", "worker"]);
    await this.runtime.ready("worker");
    const delivered = await waitFor(
      "WORKER_COMMAND_CONFIRMATION",
      () => this.snapshot(),
      (v) => v.commandState === "CONFIRMED",
      120000,
    );
    assert.equal(delivered.jiraIssues, 1);
    assert.equal(delivered.workItems, 1);
    assert.equal(delivered.commandsForDraft, 1);
    return { beforeWorker: stopped, afterWorker: delivered };
  }
  async suspendAndDrainEvents() {
    const base = `/v1/workspaces/${this.proof.workspaceId}/projects/${this.projectId}`;
    const head = await this.ok(`${base}/operations`, this.admin);
    await this.ok(
      `${base}/operations/suspend`,
      this.admin,
      { incidentRef: "INC-SMOKE-007", reason: "Restart containment proof" },
      { "idempotency-key": "smoke007-suspend", "if-match": `"${head.data.version}"` },
    );
    const eventState = () =>
      this.runtime.sql<{ total: number; acknowledged: number; inbox: number }>(
        "event-state",
        `SELECT json_build_object('total',count(*)::int,'acknowledged',count(*) FILTER(WHERE state='ACKNOWLEDGED')::int,'inbox',(SELECT count(*)::int FROM consumer_inbox WHERE consumer_key='project-onboarding-projection' AND message_id IN(SELECT id::text FROM event_outbox WHERE project_id=${uuidSql(this.projectId)}))) FROM event_outbox WHERE project_id=${uuidSql(this.projectId)};`,
      );
    const events = await waitFor(
      "ONBOARDING_EVENTS_ACKNOWLEDGED",
      eventState,
      (v) => v.total > 0 && v.total === v.acknowledged && v.total === v.inbox,
    );
    await this.runtime.sql(
      "redeliver-onboarding-events",
      `WITH changed AS(UPDATE event_outbox SET state='READY' WHERE project_id=${uuidSql(this.projectId)} RETURNING id) SELECT to_json(count(*)::int) FROM changed;`,
    );
    const replay = await waitFor(
      "ONBOARDING_EVENT_REPLAY",
      eventState,
      (v) => v.total === v.acknowledged && v.inbox === events.inbox,
    );
    this.before = await this.snapshot();
    assert.equal(this.before.operationalState, "SUSPENDED");
    return { events, replay, durable: this.before };
  }
  private async snapshot(): Promise<Doc> {
    const c = uuidSql(this.command.commandId),
      p = uuidSql(this.projectId),
      d = uuidSql(this.command.draftId);
    assert.match(this.command.effectIdempotencyKey, /^awp:effect:[a-f0-9-]+$/u);
    const platform = await this.runtime.sql<Doc>(
      "platform-snapshot",
      `SELECT json_build_object('commandState',(SELECT state FROM connector_commands WHERE id=${c}),'commandsForDraft',(SELECT count(*)::int FROM connector_commands WHERE payload #>> '{metadata,source,intakeDraftId}'=${d}::text),'workItems',(SELECT count(*)::int FROM work_items WHERE source_draft_id=${d}),'operationalState',(SELECT current_operational_state FROM project_onboarding_headers WHERE project_id=${p}),'manifestHash',(SELECT content_hash FROM qa_evidence_manifest_revisions_v2 WHERE manifest_id=${uuidSql(this.proof.manifestId)}),'exportCount',(SELECT count(*)::int FROM evidence_export_records WHERE project_id=${p}),'onboardingEvents',(SELECT count(*)::int FROM event_outbox WHERE project_id=${p}),'eventReceipts',(SELECT count(*)::int FROM consumer_inbox WHERE consumer_key='project-onboarding-projection' AND message_id IN(SELECT id::text FROM event_outbox WHERE project_id=${p})));`,
    );
    const jiraIssues = await this.runtime.sql<number>(
      "provider-effect-count",
      `SELECT to_json(count(*)::int) FROM jira_mock_issues WHERE marker='${this.command.effectIdempotencyKey}';`,
      "awp_mock",
    );
    return { ...platform, jiraIssues };
  }
  async afterRestart() {
    this.owner = await this.session("owner.local", true);
    this.admin = await this.session("integration-admin.alpha");
    this.requester = await this.session("requester.alpha");
    assert.equal(
      await this.artifact(),
      this.artifactHash,
      "S3 artifact bytes must survive restart",
    );
    await this.verifyEvidence();
    await this.ok(this.evidencePath(`/exports/${this.exportId}`), this.owner);
    const replay = await this.ok(
      `${this.command.scopePath}/intake-drafts/${this.command.draftId}/qa-confirmation`,
      this.requester,
      {},
      { "idempotency-key": this.command.key },
    );
    assert.equal(replay.data.commandId, this.command.commandId);
    assert.equal(replay.data.replayed, true);
    const exported = await this.ok(
      this.evidencePath(`/packages/${this.proof.packageId}/exports`),
      this.owner,
      {
        packageVersion: 1,
        redactionPolicyRef: this.redactionPolicyRef,
        format: "JSON",
        reason: "Compose smoke export",
      },
      { "idempotency-key": "smoke007-export" },
    );
    assert.equal(exported.data.commandId, this.exportId);
    const current = await this.snapshot();
    assert.deepEqual(current, this.before);
    const view = await this.ok(
      `/v1/workspaces/${this.proof.workspaceId}/projects/${this.projectId}/onboarding`,
      this.admin,
    );
    assert.equal(view.data.operationalState, "SUSPENDED");
    return {
      before: this.before,
      after: current,
      signature: "PASS",
      integrity: "PASS",
      artifactHash: this.artifactHash,
      idempotencyReplay: true,
    };
  }
}
