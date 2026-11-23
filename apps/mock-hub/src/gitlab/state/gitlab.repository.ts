import { createHash } from "node:crypto";

import type { DataSource } from "typeorm";

export type GitLabMockOperation =
  | "PROJECT_READ"
  | "MERGE_REQUEST_READ"
  | "COMMIT_READ"
  | "BRANCH_READ"
  | "CI_LINT"
  | "PIPELINE_READ"
  | "JOBS_READ"
  | "ARTIFACT_READ"
  | "PIPELINE_TRIGGER"
  | "WEBHOOK_DELIVERY";
export type GitLabMockFault =
  | "NORMAL"
  | "TIMEOUT_BEFORE_INVOCATION"
  | "TIMEOUT_AFTER_POSSIBLE_EFFECT"
  | "AUTHENTICATION_401"
  | "PERMISSION_403"
  | "RATE_LIMIT_429"
  | "SERVER_500"
  | "NETWORK_LOSS"
  | "LOOKUP_ZERO"
  | "LOOKUP_MULTIPLE"
  | "WEBHOOK_DROP"
  | "WEBHOOK_DUPLICATE"
  | "WEBHOOK_OUT_OF_ORDER";

export interface GitLabMockProject {
  readonly id: number;
  readonly pathWithNamespace: string;
  readonly defaultBranch: string;
  readonly exactRef: string;
  readonly edition: "CE" | "EE";
  readonly exactVersion: string;
  readonly exactBuild: string;
  readonly archived: boolean;
  readonly jobsEnabled: boolean;
  readonly capabilities: Readonly<Record<string, boolean>>;
}

export interface GitLabMockMergeRequest {
  readonly projectId: number;
  readonly iid: number;
  readonly state: "opened" | "merged" | "closed";
  readonly sourceRef: string;
  readonly targetRef: string;
  readonly sourceCommitSha: string;
  readonly targetCommitSha: string;
  readonly headCommitSha: string;
  readonly updatedAt: string;
}

export interface GitLabMockCommit {
  readonly projectId: number;
  readonly sha: string;
  readonly parentShas: readonly string[];
  readonly committedAt: string;
}

export interface GitLabMockFaultInput {
  readonly projectId: number;
  readonly operation: GitLabMockOperation;
  readonly fault: GitLabMockFault;
  readonly remaining: number;
}

export interface GitLabMockScenarioInput {
  readonly id: string;
  readonly discovery: Readonly<{
    numericProjectId: number;
    projectPath: string;
    exactRef: string;
    exactVersion: string;
  }>;
  readonly mergeRequest: Readonly<{ iid: number; headCommitSha: string; targetRef: string }>;
  readonly commit: Readonly<{ sha: string; parentSha: string }>;
  readonly build: Readonly<{
    pipelineId: number;
    jobId: number;
    resultJobKey: string;
    environmentName: string;
  }>;
  readonly ciLint: Readonly<{ valid: boolean; deploySurface: boolean }>;
  readonly capabilityMode: "FULL_QA" | "MANUAL_ONLY";
  readonly triggerFault?: Extract<
    GitLabMockFault,
    "NORMAL" | "TIMEOUT_BEFORE_INVOCATION" | "TIMEOUT_AFTER_POSSIBLE_EFFECT"
  >;
  readonly lookupFault?: Extract<GitLabMockFault, "NORMAL" | "LOOKUP_ZERO" | "LOOKUP_MULTIPLE">;
  readonly webhookFault?: Extract<
    GitLabMockFault,
    "NORMAL" | "WEBHOOK_DROP" | "WEBHOOK_DUPLICATE" | "WEBHOOK_OUT_OF_ORDER"
  >;
  readonly readFault?: Extract<
    GitLabMockFault,
    "NORMAL" | "AUTHENTICATION_401" | "PERMISSION_403" | "RATE_LIMIT_429" | "SERVER_500"
  >;
  readonly readFaultRemaining?: number;
  readonly attemptResults?: readonly Readonly<{
    attemptNo: number;
    launchReason: "INITIAL" | "AUTO_INFRA_RETRY" | "HUMAN_RERUN" | "LINKED_SESSION_INITIAL";
    pipelineStatus: "success" | "failed" | "canceled";
    jobStatus: "success" | "failed" | "canceled";
    outcome: "PASS" | "ASSERTION_FAILED" | "INFRA_FAILED" | "TIMEOUT" | "CANCELLED" | "INCOMPLETE";
    terminalAt: string;
    infrastructureCode?: string;
    cancellationReasonCode?: string;
    syntheticReasonCode?: "RESULT_SCHEMA_DRIFT" | "ARTIFACT_CHECKSUM_MISMATCH";
    resultSchema: "VALID" | "DRIFTED";
    artifactAvailability: "AVAILABLE" | "CHECKSUM_MISMATCH";
  }>[];
}

export interface GitLabMockPipelineTriggerInput {
  readonly projectId: number;
  readonly ref: string;
  readonly pipelineName: string;
  readonly inputs: Readonly<Record<string, string | number | boolean>>;
}

function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(value)
    ? value.filter(
        (row): row is Readonly<Record<string, unknown>> =>
          row !== null && typeof row === "object" && !Array.isArray(row),
      )
    : [];
}

function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function contentHash(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function errorForFault(fault: GitLabMockFault): Error | undefined {
  return ["NORMAL", "LOOKUP_ZERO", "LOOKUP_MULTIPLE"].includes(fault)
    ? undefined
    : new Error(`GITLAB_MOCK_${fault}`);
}

function pipelineRecord(row: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id: Number(row.pipeline_id),
    name: String(row.pipeline_name ?? `pipeline:${String(row.pipeline_id)}`),
    ref: String(row.ref),
    sha: String(row.commit_sha),
    status: String(row.status),
    source: String(row.source),
    marker_hash:
      row.marker_hash === null || row.marker_hash === undefined ? null : String(row.marker_hash),
    variables: Object.freeze(json<Readonly<Record<string, unknown>>[]>(row.variables)),
    created_at: new Date(String(row.created_at)).toISOString(),
    updated_at: new Date(String(row.updated_at)).toISOString(),
    ...(row.finished_at === null || row.finished_at === undefined
      ? {}
      : { finished_at: new Date(String(row.finished_at)).toISOString() }),
  });
}

export class TypeOrmGitLabRepository {
  constructor(private readonly source: DataSource) {}

  async project(projectId: number): Promise<GitLabMockProject> {
    await this.#before(projectId, "PROJECT_READ", "GET", String(projectId));
    const row = await this.#scopedProject(projectId);
    return Object.freeze({
      id: Number(row.project_id),
      pathWithNamespace: String(row.path_with_namespace),
      defaultBranch: String(row.default_branch),
      exactRef: String(row.exact_ref),
      edition: String(row.edition) as "CE" | "EE",
      exactVersion: String(row.exact_version),
      exactBuild: String(row.exact_build),
      archived: Boolean(row.archived),
      jobsEnabled: Boolean(row.jobs_enabled),
      capabilities: Object.freeze(json<Record<string, boolean>>(row.capabilities)),
    });
  }

  async mergeRequest(projectId: number, iid: number): Promise<GitLabMockMergeRequest> {
    await this.#before(projectId, "MERGE_REQUEST_READ", "GET", `${projectId}:${iid}`);
    await this.#scopedProject(projectId);
    const row = records(
      await this.source.query(
        "SELECT * FROM mock_gitlab_merge_requests WHERE project_id=$1 AND iid=$2",
        [projectId, iid],
      ),
    )[0];
    if (!row) throw new Error("GITLAB_MOCK_MERGE_REQUEST_NOT_FOUND");
    return Object.freeze({
      projectId: Number(row.project_id),
      iid: Number(row.iid),
      state: String(row.state) as GitLabMockMergeRequest["state"],
      sourceRef: String(row.source_ref),
      targetRef: String(row.target_ref),
      sourceCommitSha: String(row.source_commit_sha),
      targetCommitSha: String(row.target_commit_sha),
      headCommitSha: String(row.head_commit_sha),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    });
  }

  async commit(projectId: number, sha: string): Promise<GitLabMockCommit> {
    await this.#before(projectId, "COMMIT_READ", "GET", `${projectId}:${sha}`);
    await this.#scopedProject(projectId);
    const row = records(
      await this.source.query(
        "SELECT * FROM mock_gitlab_commits WHERE project_id=$1 AND commit_sha=$2",
        [projectId, sha],
      ),
    )[0];
    if (!row) throw new Error("GITLAB_MOCK_COMMIT_NOT_FOUND");
    return Object.freeze({
      projectId: Number(row.project_id),
      sha: String(row.commit_sha),
      parentShas: Object.freeze(json<string[]>(row.parent_commit_shas)),
      committedAt: new Date(String(row.committed_at)).toISOString(),
    });
  }

  async branch(
    projectId: number,
    ref: string,
  ): Promise<Readonly<{ name: string; protected: false; commit: GitLabMockCommit }>> {
    await this.#before(projectId, "BRANCH_READ", "GET", `${projectId}:${ref}`);
    const project = await this.#scopedProject(projectId);
    if (String(project.exact_ref) !== ref) throw new Error("GITLAB_MOCK_REF_SCOPE_FORBIDDEN");
    const row = records(
      await this.source.query(
        "SELECT * FROM mock_gitlab_commits WHERE project_id=$1 ORDER BY committed_at DESC LIMIT 1",
        [projectId],
      ),
    )[0];
    if (!row) throw new Error("GITLAB_MOCK_COMMIT_NOT_FOUND");
    return Object.freeze({
      name: ref,
      protected: false,
      commit: Object.freeze({
        projectId,
        sha: String(row.commit_sha),
        parentShas: Object.freeze(json<string[]>(row.parent_commit_shas)),
        committedAt: new Date(String(row.committed_at)).toISOString(),
      }),
    });
  }

  async lint(
    projectId: number,
    ref: string,
  ): Promise<
    Readonly<{
      valid: true;
      errors: readonly string[];
      warnings: readonly string[];
      jobs: readonly Readonly<Record<string, unknown>>[];
    }>
  > {
    await this.#before(projectId, "CI_LINT", "POST", `${projectId}:${ref}`);
    const project = await this.#scopedProject(projectId);
    if (String(project.exact_ref) !== ref) throw new Error("GITLAB_MOCK_REF_SCOPE_FORBIDDEN");
    return Object.freeze({
      valid: true,
      errors: Object.freeze([]),
      warnings: Object.freeze([]),
      jobs: Object.freeze(json<Readonly<Record<string, unknown>>[]>(project.lint_jobs)),
    });
  }

  async pipelines(
    projectId: number,
    ref?: string,
    window?: Readonly<{ start?: string; end?: string }>,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    const fault = await this.#before(
      projectId,
      "PIPELINE_READ",
      "GET",
      `${projectId}:${ref ?? "all"}:${window?.start ?? ""}:${window?.end ?? ""}`,
    );
    await this.#scopedProject(projectId);
    if (fault === "LOOKUP_ZERO") return Object.freeze([]);
    const rows = records(
      await this.source.query(
        "SELECT * FROM mock_gitlab_pipelines WHERE project_id=$1 AND ($2::text IS NULL OR ref=$2) AND ($3::timestamptz IS NULL OR created_at>=$3) AND ($4::timestamptz IS NULL OR created_at<=$4) ORDER BY created_at DESC,pipeline_id DESC",
        [projectId, ref ?? null, window?.start ?? null, window?.end ?? null],
      ),
    );
    const mapped = rows.map(pipelineRecord);
    if (fault === "LOOKUP_MULTIPLE" && mapped[0])
      mapped.push(Object.freeze({ ...mapped[0], id: Number(mapped[0].id) + 100_000 }));
    return Object.freeze(mapped);
  }

  async pipeline(
    projectId: number,
    pipelineId: number,
  ): Promise<Readonly<Record<string, unknown>>> {
    await this.#before(projectId, "PIPELINE_READ", "GET", `${projectId}:${pipelineId}`);
    await this.#scopedProject(projectId);
    const row = records(
      await this.source.query(
        "SELECT * FROM mock_gitlab_pipelines WHERE project_id=$1 AND pipeline_id=$2",
        [projectId, pipelineId],
      ),
    )[0];
    if (!row) throw new Error("GITLAB_MOCK_PIPELINE_NOT_FOUND");
    return pipelineRecord(row);
  }

  async triggerPipeline(
    input: GitLabMockPipelineTriggerInput,
  ): Promise<Readonly<Record<string, unknown>>> {
    await this.#scopedProject(input.projectId);
    if (!input.ref || !input.pipelineName || input.pipelineName.length > 255)
      throw new Error("GITLAB_MOCK_TRIGGER_INPUT_INVALID");
    const marker = input.inputs.AWP_REQUEST_MARKER;
    const commitSha = input.inputs.AWP_COMMIT_SHA;
    if (
      typeof marker !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(marker) ||
      typeof commitSha !== "string" ||
      !/^[a-f0-9]{40}$/u.test(commitSha)
    ) {
      throw new Error("GITLAB_MOCK_TRIGGER_COMMITMENT_INVALID");
    }
    const fault = await this.#consumeFault(input.projectId, "PIPELINE_TRIGGER");
    if (
      fault === "TIMEOUT_BEFORE_INVOCATION" ||
      (fault !== "NORMAL" && fault !== "TIMEOUT_AFTER_POSSIBLE_EFFECT")
    ) {
      await this.#audit(
        input.projectId,
        "PIPELINE_TRIGGER",
        "POST",
        `${input.projectId}:${input.ref}:${input.pipelineName}:${marker}`,
        fault,
        marker,
      );
      throw new Error(`GITLAB_MOCK_${fault}`);
    }
    const created = await this.source.transaction(async (manager) => {
      await manager.query(
        "SELECT project_id FROM mock_gitlab_projects WHERE project_id=$1 FOR UPDATE",
        [input.projectId],
      );
      const ids = records(
        await manager.query(
          "SELECT COALESCE(max(pipeline_id),100)+1 AS next_id FROM mock_gitlab_pipelines WHERE project_id=$1",
          [input.projectId],
        ),
      );
      const pipelineId = Number(ids[0]?.next_id);
      const variables = Object.entries(input.inputs).map(([key, value]) =>
        Object.freeze({ key, value }),
      );
      const rows = records(
        await manager.query(
          `
INSERT INTO mock_gitlab_pipelines(project_id,pipeline_id,source,ref,commit_sha,status,pipeline_name,marker_hash,variables,created_at,updated_at,finished_at)
VALUES($1,$2,'trigger',$3,$4,'pending',$5,$6,$7::jsonb,'2026-09-01T08:00:05.000Z','2026-09-01T08:00:05.000Z',NULL)
RETURNING *`,
          [
            input.projectId,
            pipelineId,
            input.ref,
            commitSha,
            input.pipelineName,
            marker,
            JSON.stringify(variables),
          ],
        ),
      );
      return pipelineRecord(rows[0]!);
    });
    await this.#audit(
      input.projectId,
      "PIPELINE_TRIGGER",
      "POST",
      `${input.projectId}:${input.ref}:${input.pipelineName}:${marker}`,
      fault === "NORMAL" ? "SUCCESS" : fault,
      marker,
      String(created.id),
    );
    if (fault === "TIMEOUT_AFTER_POSSIBLE_EFFECT")
      throw new Error("GITLAB_MOCK_TIMEOUT_AFTER_POSSIBLE_EFFECT");
    return created;
  }

  async jobs(
    projectId: number,
    pipelineId: number,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    await this.#before(projectId, "JOBS_READ", "GET", `${projectId}:${pipelineId}`);
    await this.#scopedProject(projectId);
    return Object.freeze(
      records(
        await this.source.query(
          "SELECT * FROM mock_gitlab_jobs WHERE project_id=$1 AND pipeline_id=$2 ORDER BY job_id",
          [projectId, pipelineId],
        ),
      ).map((row) => Object.freeze({ ...row })),
    );
  }

  async artifact(
    projectId: number,
    jobId: number,
    artifactPath: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    await this.#before(
      projectId,
      "ARTIFACT_READ",
      "GET",
      `${projectId}:${jobId}:${contentHash(artifactPath)}`,
    );
    await this.#scopedProject(projectId);
    const row = records(
      await this.source.query(
        "SELECT * FROM mock_gitlab_artifacts WHERE project_id=$1 AND job_id=$2 AND artifact_path=$3",
        [projectId, jobId, artifactPath],
      ),
    )[0];
    if (!row) throw new Error("GITLAB_MOCK_ARTIFACT_NOT_FOUND");
    return Object.freeze({ ...row });
  }

  async setFault(input: GitLabMockFaultInput): Promise<void> {
    if (!Number.isSafeInteger(input.remaining) || input.remaining < 0 || input.remaining > 100)
      throw new Error("GITLAB_MOCK_FAULT_REMAINING_INVALID");
    await this.#scopedProject(input.projectId);
    await this.source.query(
      `
INSERT INTO mock_gitlab_faults(project_id,operation,fault,remaining)
VALUES($1,$2,$3,$4)
ON CONFLICT(project_id,operation) DO UPDATE
SET fault=EXCLUDED.fault,remaining=EXCLUDED.remaining,revision=mock_gitlab_faults.revision+1,updated_at=clock_timestamp()`,
      [
        input.projectId,
        input.operation,
        input.fault,
        input.fault === "NORMAL" ? 0 : input.remaining,
      ],
    );
  }

  async consumeWebhookDeliveryFault(
    projectId: number,
    requestIdentity: string,
  ): Promise<
    Extract<
      GitLabMockFault,
      "NORMAL" | "WEBHOOK_DROP" | "WEBHOOK_DUPLICATE" | "WEBHOOK_OUT_OF_ORDER"
    >
  > {
    await this.#scopedProject(projectId);
    const fault = await this.#consumeFault(projectId, "WEBHOOK_DELIVERY");
    await this.#audit(
      projectId,
      "WEBHOOK_DELIVERY",
      "POST",
      requestIdentity,
      fault === "NORMAL" ? "SUCCESS" : fault,
    );
    if (!["NORMAL", "WEBHOOK_DROP", "WEBHOOK_DUPLICATE", "WEBHOOK_OUT_OF_ORDER"].includes(fault))
      throw new Error(`GITLAB_MOCK_${fault}`);
    return fault as Extract<
      GitLabMockFault,
      "NORMAL" | "WEBHOOK_DROP" | "WEBHOOK_DUPLICATE" | "WEBHOOK_OUT_OF_ORDER"
    >;
  }

  async applyScenario(input: GitLabMockScenarioInput): Promise<void> {
    if (input.discovery.numericProjectId !== 5001)
      throw new Error("GITLAB_MOCK_SCENARIO_SCOPE_FORBIDDEN");
    await this.#scopedProject(input.discovery.numericProjectId);
    const capabilities =
      input.capabilityMode === "FULL_QA"
        ? {
            pipelineRead: true,
            pipelineTrigger: true,
            artifactRead: true,
            standardWebhookHmacSha256: true,
          }
        : {
            pipelineRead: false,
            pipelineTrigger: false,
            artifactRead: false,
            standardWebhookHmacSha256: true,
          };
    const lintJobs = input.ciLint.valid
      ? [
          {
            name: input.build.resultJobKey,
            stage: input.ciLint.deploySurface ? "deploy" : "test",
            environment: { name: input.build.environmentName },
            when: "always",
            allow_failure: false,
          },
        ]
      : [
          {
            name: input.build.resultJobKey,
            stage: "deploy",
            environment: { name: input.build.environmentName },
            when: "manual",
            allow_failure: false,
          },
        ];
    await this.source.transaction(async (manager) => {
      await manager.query(
        `
UPDATE mock_gitlab_projects
SET path_with_namespace=$1,exact_ref=$2,exact_version=$3,
    capabilities=$4::jsonb || jsonb_build_object($5::text,true),lint_jobs=$6::jsonb,updated_at=clock_timestamp()
WHERE project_id=$7`,
        [
          input.discovery.projectPath,
          input.discovery.exactRef,
          input.discovery.exactVersion,
          JSON.stringify(capabilities),
          `scenario:${input.id}`,
          JSON.stringify(lintJobs),
          input.discovery.numericProjectId,
        ],
      );
      await manager.query(
        `
INSERT INTO mock_gitlab_commits(project_id,commit_sha,parent_commit_shas,committed_at)
VALUES($1,$2,$3::jsonb,'2026-09-01T07:20:00.000Z')
ON CONFLICT(project_id,commit_sha) DO UPDATE SET parent_commit_shas=EXCLUDED.parent_commit_shas,committed_at=EXCLUDED.committed_at`,
        [
          input.discovery.numericProjectId,
          input.commit.sha,
          JSON.stringify([input.commit.parentSha]),
        ],
      );
      await manager.query(
        `
UPDATE mock_gitlab_merge_requests
SET target_ref=$1,source_commit_sha=$2,head_commit_sha=$2,updated_at='2026-09-01T07:25:00.000Z'
WHERE project_id=$3 AND iid=$4`,
        [
          input.mergeRequest.targetRef,
          input.mergeRequest.headCommitSha,
          input.discovery.numericProjectId,
          input.mergeRequest.iid,
        ],
      );
      await manager.query("DELETE FROM mock_gitlab_call_audit WHERE project_id=$1", [
        input.discovery.numericProjectId,
      ]);
      await manager.query("DELETE FROM mock_gitlab_artifacts WHERE project_id=$1", [
        input.discovery.numericProjectId,
      ]);
      await manager.query("DELETE FROM mock_gitlab_machine_results WHERE project_id=$1", [
        input.discovery.numericProjectId,
      ]);
      await manager.query("DELETE FROM mock_gitlab_jobs WHERE project_id=$1", [
        input.discovery.numericProjectId,
      ]);
      await manager.query("DELETE FROM mock_gitlab_pipelines WHERE project_id=$1", [
        input.discovery.numericProjectId,
      ]);
      await manager.query("DELETE FROM mock_gitlab_webhook_deliveries WHERE project_id=$1", [
        input.discovery.numericProjectId,
      ]);
      const resultFixtures: NonNullable<GitLabMockScenarioInput["attemptResults"]> =
        input.attemptResults ?? [
          Object.freeze({
            attemptNo: 1,
            launchReason: "INITIAL" as const,
            pipelineStatus: "success" as const,
            jobStatus: "success" as const,
            outcome: "PASS" as const,
            terminalAt: "2026-09-01T07:34:00.000Z",
            resultSchema: "VALID" as const,
            artifactAvailability: "AVAILABLE" as const,
          }),
        ];
      for (const [index, fixture] of resultFixtures.entries()) {
        const pipelineId = input.build.pipelineId + index;
        const jobId = input.build.jobId + index;
        const terminalAt = new Date(fixture.terminalAt);
        if (Number.isNaN(terminalAt.getTime()))
          throw new Error("GITLAB_MOCK_SCENARIO_TERMINAL_AT_INVALID");
        const createdAt = new Date(terminalAt.getTime() - 180_000).toISOString();
        const startedAt = new Date(terminalAt.getTime() - 120_000).toISOString();
        const requestMarkerHash = contentHash("mock-result-request-marker");
        const resultBody = {
          schemaVersion:
            fixture.resultSchema === "VALID"
              ? "gitlab-pipeline-result@1.0.0"
              : "gitlab-pipeline-result@2.0.0",
          requestMarkerHash,
          pipelineId,
          jobId,
          commitSha: input.commit.sha,
          buildRef: "build:qa-api:2026.09.01.1",
          suiteKey: "smoke",
          environmentRef: "environment:test:qa-1@17",
          startedAt,
          finishedAt: terminalAt.toISOString(),
          durationMs: 120_000,
          outcome: fixture.outcome,
          ...(fixture.infrastructureCode === undefined
            ? {}
            : { infrastructureCode: fixture.infrastructureCode }),
          ...(fixture.cancellationReasonCode === undefined
            ? {}
            : { cancellationReasonCode: fixture.cancellationReasonCode }),
          summary:
            fixture.outcome === "PASS"
              ? { total: 1, passed: 1, failed: 0, skipped: 0 }
              : { total: 1, passed: 0, failed: 1, skipped: 0 },
          artifacts: [],
        };
        const encoded = new TextEncoder().encode(JSON.stringify(resultBody));
        const actualChecksum = contentHash(encoded);
        const storedChecksum =
          fixture.artifactAvailability === "CHECKSUM_MISMATCH"
            ? contentHash("intentional-checksum-mismatch")
            : actualChecksum;
        await manager.query(
          `
INSERT INTO mock_gitlab_pipelines(
  project_id,pipeline_id,source,ref,commit_sha,status,pipeline_name,marker_hash,variables,created_at,updated_at,finished_at
) VALUES($1,$2,'trigger',$3,$4,$5,NULL,NULL,'[]'::jsonb,$6,$7,$7)`,
          [
            input.discovery.numericProjectId,
            pipelineId,
            input.discovery.exactRef,
            input.commit.sha,
            fixture.pipelineStatus,
            createdAt,
            terminalAt.toISOString(),
          ],
        );
        await manager.query(
          `
INSERT INTO mock_gitlab_jobs(
  project_id,pipeline_id,job_id,name,stage,status,environment_name,created_at,started_at,finished_at
) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            input.discovery.numericProjectId,
            pipelineId,
            jobId,
            input.build.resultJobKey,
            input.ciLint.deploySurface ? "deploy" : "test",
            fixture.jobStatus,
            input.build.environmentName,
            createdAt,
            startedAt,
            terminalAt.toISOString(),
          ],
        );
        await manager.query(
          `
INSERT INTO mock_gitlab_machine_results(
  project_id,pipeline_id,job_id,schema_id,schema_version,schema_digest,result_body,result_hash,created_at
) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
          [
            input.discovery.numericProjectId,
            pipelineId,
            jobId,
            fixture.resultSchema === "VALID"
              ? "urn:awp:schemas:005:gitlab-pipeline-result:v1"
              : "urn:awp:schemas:005:gitlab-pipeline-result:v2",
            fixture.resultSchema === "VALID" ? 1 : 2,
            contentHash(fixture.resultSchema === "VALID" ? "schema:v1" : "schema:v2"),
            JSON.stringify(resultBody),
            actualChecksum,
            terminalAt.toISOString(),
          ],
        );
        await manager.query(
          `
INSERT INTO mock_gitlab_artifacts(
  project_id,pipeline_id,job_id,artifact_path,file_name,media_type,content_bytes,byte_size,checksum,classification,expires_at,created_at
) VALUES($1,$2,$3,'awp/results/result.json','result.json','application/json',$4,$5,$6,'INTERNAL',$7,$8)`,
          [
            input.discovery.numericProjectId,
            pipelineId,
            jobId,
            Buffer.from(encoded),
            encoded.byteLength,
            storedChecksum,
            new Date(terminalAt.getTime() + 7 * 86_400_000).toISOString(),
            terminalAt.toISOString(),
          ],
        );
      }
      await manager.query("DELETE FROM mock_gitlab_faults WHERE project_id=$1", [
        input.discovery.numericProjectId,
      ]);
      if (input.triggerFault && input.triggerFault !== "NORMAL")
        await manager.query(
          "INSERT INTO mock_gitlab_faults(project_id,operation,fault,remaining) VALUES($1,'PIPELINE_TRIGGER',$2,1)",
          [input.discovery.numericProjectId, input.triggerFault],
        );
      if (input.lookupFault && input.lookupFault !== "NORMAL")
        await manager.query(
          "INSERT INTO mock_gitlab_faults(project_id,operation,fault,remaining) VALUES($1,'PIPELINE_READ',$2,1)",
          [input.discovery.numericProjectId, input.lookupFault],
        );
      if (input.webhookFault && input.webhookFault !== "NORMAL")
        await manager.query(
          "INSERT INTO mock_gitlab_faults(project_id,operation,fault,remaining) VALUES($1,'WEBHOOK_DELIVERY',$2,1)",
          [input.discovery.numericProjectId, input.webhookFault],
        );
      if (input.readFault && input.readFault !== "NORMAL")
        await manager.query(
          "INSERT INTO mock_gitlab_faults(project_id,operation,fault,remaining) VALUES($1,'PIPELINE_READ',$2,$3)",
          [input.discovery.numericProjectId, input.readFault, input.readFaultRemaining ?? 1],
        );
    });
  }

  async snapshot(projectId: number): Promise<Readonly<Record<string, unknown>>> {
    await this.#scopedProject(projectId);
    const results = await Promise.all([
      this.source.query("SELECT * FROM mock_gitlab_projects WHERE project_id=$1", [projectId]),
      this.source.query(
        "SELECT * FROM mock_gitlab_merge_requests WHERE project_id=$1 ORDER BY iid",
        [projectId],
      ),
      this.source.query(
        "SELECT * FROM mock_gitlab_commits WHERE project_id=$1 ORDER BY committed_at",
        [projectId],
      ),
      this.source.query(
        "SELECT * FROM mock_gitlab_pipelines WHERE project_id=$1 ORDER BY pipeline_id",
        [projectId],
      ),
      this.source.query("SELECT * FROM mock_gitlab_jobs WHERE project_id=$1 ORDER BY job_id", [
        projectId,
      ]),
      this.source.query(
        "SELECT * FROM mock_gitlab_machine_results WHERE project_id=$1 ORDER BY pipeline_id,job_id",
        [projectId],
      ),
      this.source.query(
        "SELECT project_id,pipeline_id,job_id,artifact_path,file_name,media_type,byte_size,checksum,classification,expires_at,created_at FROM mock_gitlab_artifacts WHERE project_id=$1 ORDER BY pipeline_id,job_id,artifact_path",
        [projectId],
      ),
      this.source.query("SELECT * FROM mock_gitlab_faults WHERE project_id=$1 ORDER BY operation", [
        projectId,
      ]),
      this.source.query(
        "SELECT * FROM mock_gitlab_call_audit WHERE project_id=$1 ORDER BY sequence",
        [projectId],
      ),
      this.source.query(
        "SELECT delivery_id,project_id,event_kind,body_hash,key_version_ref,delivery_timestamp,delivery_attempt,state,created_at,updated_at FROM mock_gitlab_webhook_deliveries WHERE project_id=$1 ORDER BY created_at,delivery_id",
        [projectId],
      ),
    ]);
    return Object.freeze({
      project: records(results[0])[0],
      mergeRequests: records(results[1]),
      commits: records(results[2]),
      pipelines: records(results[3]),
      jobs: records(results[4]),
      machineResults: records(results[5]),
      artifacts: records(results[6]),
      faults: records(results[7]),
      calls: records(results[8]),
      webhookDeliveries: records(results[9]),
    });
  }

  async #scopedProject(projectId: number): Promise<Readonly<Record<string, unknown>>> {
    if (!Number.isSafeInteger(projectId) || projectId < 1)
      throw new Error("GITLAB_MOCK_PROJECT_ID_INVALID");
    const row = records(
      await this.source.query("SELECT * FROM mock_gitlab_projects WHERE project_id=$1", [
        projectId,
      ]),
    )[0];
    if (!row || row.allowed_control_scope !== true)
      throw new Error("GITLAB_MOCK_PROJECT_SCOPE_FORBIDDEN");
    return row;
  }

  async #consumeFault(projectId: number, operation: GitLabMockOperation): Promise<GitLabMockFault> {
    const rows = records(
      await this.source.query(
        `
WITH current AS (
  SELECT project_id,operation,fault,remaining FROM mock_gitlab_faults
  WHERE project_id=$1 AND operation=$2 FOR UPDATE
), consumed AS (
  UPDATE mock_gitlab_faults target
  SET remaining=GREATEST(current.remaining-1,0),
      fault=CASE WHEN current.remaining<=1 THEN 'NORMAL' ELSE current.fault END,
      revision=target.revision+1,updated_at=clock_timestamp()
  FROM current WHERE target.project_id=current.project_id AND target.operation=current.operation AND current.remaining>0
  RETURNING current.fault
)
SELECT fault FROM consumed`,
        [projectId, operation],
      ),
    );
    return String(rows[0]?.fault ?? "NORMAL") as GitLabMockFault;
  }

  async #audit(
    projectId: number,
    operation: GitLabMockOperation,
    method: string,
    requestIdentity: string,
    outcome: string,
    marker?: string,
    pipelineId?: string,
  ): Promise<void> {
    await this.source.query(
      "INSERT INTO mock_gitlab_call_audit(project_id,operation,method,request_hash,effect_marker_hash,external_pipeline_id,outcome) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        projectId,
        operation,
        method,
        contentHash(requestIdentity),
        marker ?? null,
        pipelineId ?? null,
        outcome,
      ],
    );
  }

  async #before(
    projectId: number,
    operation: GitLabMockOperation,
    method: string,
    requestIdentity: string,
  ): Promise<GitLabMockFault> {
    const fault = await this.#consumeFault(projectId, operation);
    const error = errorForFault(fault);
    await this.#audit(
      projectId,
      operation,
      method,
      requestIdentity,
      fault === "NORMAL" ? "SUCCESS" : fault,
    );
    if (error) throw error;
    return fault;
  }
}

const headSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const parentSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

export async function seedGitLabRepository(source: DataSource): Promise<void> {
  await source.transaction(async (manager) => {
    await manager.query(`
INSERT INTO mock_gitlab_projects(project_id,path_with_namespace,default_branch,exact_ref,edition,exact_version,exact_build,capabilities,lint_jobs,allowed_control_scope)
VALUES(5001,'local/qa-smoke','qa/smoke','refs/heads/qa/smoke','EE','18.1.0-mock.1','mock-build-1',
       '{"pipelineRead":true,"pipelineTrigger":true,"artifactRead":true,"standardWebhookHmacSha256":true}'::jsonb,
       '[{"name":"awp:result","stage":"test","environment":{"name":"qa-1"},"when":"always","allow_failure":false}]'::jsonb,true),
      (5002,'local/out-of-scope','main','refs/heads/main','EE','18.1.0-mock.1','mock-build-1','{}'::jsonb,'[]'::jsonb,false)
ON CONFLICT(project_id) DO NOTHING`);
    await manager.query(
      `
INSERT INTO mock_gitlab_commits(project_id,commit_sha,parent_commit_shas,committed_at)
VALUES(5001,$1,$3::jsonb,'2026-09-01T07:00:00.000Z'),(5001,$2,'[]'::jsonb,'2026-08-31T07:00:00.000Z')
ON CONFLICT DO NOTHING`,
      [headSha, parentSha, JSON.stringify([parentSha])],
    );
    await manager.query(
      `
INSERT INTO mock_gitlab_merge_requests(project_id,iid,state,source_ref,target_ref,source_commit_sha,target_commit_sha,head_commit_sha,updated_at)
VALUES(5001,17,'opened','refs/heads/qa/smoke','refs/heads/main',$1,$2,$1,'2026-09-01T07:15:00.000Z')
ON CONFLICT DO NOTHING`,
      [headSha, parentSha],
    );
    await manager.query(
      `
INSERT INTO mock_gitlab_pipelines(project_id,pipeline_id,source,ref,commit_sha,status,variables,created_at,updated_at,finished_at)
VALUES(5001,101,'trigger','refs/heads/qa/smoke',$1,'success','[]'::jsonb,'2026-09-01T07:30:00.000Z','2026-09-01T07:35:00.000Z','2026-09-01T07:35:00.000Z')
ON CONFLICT DO NOTHING`,
      [headSha],
    );
    await manager.query(`
INSERT INTO mock_gitlab_jobs(project_id,pipeline_id,job_id,name,stage,status,environment_name,created_at,started_at,finished_at)
VALUES(5001,101,1001,'awp:result','test','success','qa-1','2026-09-01T07:30:00.000Z','2026-09-01T07:31:00.000Z','2026-09-01T07:34:00.000Z')
ON CONFLICT DO NOTHING`);
    const resultBody = JSON.stringify({
      schemaVersion: "gitlab-pipeline-result@1.0.0",
      requestMarkerHash: contentHash("mock-result-request-marker"),
      pipelineId: 101,
      jobId: 1001,
      commitSha: headSha,
      buildRef: "build:qa-api:2026.09.01.1",
      suiteKey: "smoke",
      environmentRef: "environment:test:qa-1@17",
      startedAt: "2026-09-01T07:31:00.000Z",
      finishedAt: "2026-09-01T07:34:00.000Z",
      durationMs: 180_000,
      outcome: "PASS",
      summary: { total: 1, passed: 1, failed: 0, skipped: 0 },
      artifacts: [],
    });
    const artifactBytes = new TextEncoder().encode(resultBody);
    await manager.query(
      `
INSERT INTO mock_gitlab_machine_results(project_id,pipeline_id,job_id,schema_id,schema_version,schema_digest,result_body,result_hash,created_at)
VALUES(5001,101,1001,'urn:awp:schemas:005:gitlab-pipeline-result:v1',1,$1,$2::jsonb,$3,'2026-09-01T07:34:00.000Z')
ON CONFLICT DO NOTHING`,
      [contentHash("schema:v1"), resultBody, contentHash(artifactBytes)],
    );
    await manager.query(
      `
INSERT INTO mock_gitlab_artifacts(project_id,pipeline_id,job_id,artifact_path,file_name,media_type,content_bytes,byte_size,checksum,classification,expires_at,created_at)
VALUES(5001,101,1001,'awp/results/result.json','result.json','application/json',$1,$2,$3,'INTERNAL','2026-09-08T07:34:00.000Z','2026-09-01T07:34:00.000Z')
ON CONFLICT DO NOTHING`,
      [Buffer.from(artifactBytes), artifactBytes.byteLength, contentHash(artifactBytes)],
    );
  });
}
