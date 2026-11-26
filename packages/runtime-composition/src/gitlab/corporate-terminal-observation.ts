import type { DataSource } from "typeorm";
import type { RuntimeEnvironment } from "../config/environment.ts";
import type { CorporateConnectorGrant } from "../pilot/connector-authority.ts";
import type { CorporateConnectorRequestAuthority } from "../pilot/connector-factories.ts";
import type { PipelineObservation } from "@awp/connector-sdk";
import { sha256, type JsonValue } from "@awp/platform-contracts";

type Ref = Readonly<{ id: string; version: number; contentHash: string }>;
type Candidate = Readonly<{
  workspaceId: string;
  projectId: string;
  attemptId: string;
  commandId: string;
  observationId: string;
  observationHash: string;
}>;
const same = (a: Ref, b: Ref) =>
  a.id === b.id && a.version === b.version && a.contentHash === b.contentHash;
const parse = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);

/** A fresh read has a new observedAt/hash; compare its stable provider facts to the stored head. */
export function assertCorporateGitLabObservationMatches(
  stored: Readonly<Record<string, unknown>>,
  observation: PipelineObservation,
): void {
  const { observationHash, ...body } = observation;
  const jobs = parse<unknown>(stored.external_job_ids);
  const updated =
    stored.provider_updated_at instanceof Date
      ? stored.provider_updated_at.toISOString()
      : new Date(String(stored.provider_updated_at)).toISOString();
  if (
    !observation.terminal ||
    sha256(body as unknown as JsonValue) !== observationHash ||
    observation.externalPipelineId !== String(stored.external_pipeline_id) ||
    observation.providerState !== stored.provider_status ||
    observation.providerRevisionToken !== stored.provider_revision_token ||
    observation.sourceCommitSha !== stored.source_commit_sha ||
    observation.providerUpdatedAt !== updated ||
    !Array.isArray(jobs) ||
    sha256(jobs as JsonValue) !== sha256(observation.externalJobIds as unknown as JsonValue)
  )
    throw new Error("CORPORATE_GITLAB_RESULT_OBSERVATION_CHANGED");
}

/** Resolve only a current terminal observation and recheck service authorization around the read. */
export function createCorporateGitLabTerminalObservation(
  input: Readonly<{
    source: DataSource;
    environment: RuntimeEnvironment;
    grants: readonly CorporateConnectorGrant[];
    authority: CorporateConnectorRequestAuthority;
  }>,
) {
  const scope = input.environment.deployment;
  if (
    !input.source.isInitialized ||
    input.environment.profile !== "non-local" ||
    input.environment.environmentScope !== "NON_PROD" ||
    !scope?.workspaceId ||
    !scope.projectIds.length ||
    typeof input.authority?.authorize !== "function"
  )
    throw new Error("CORPORATE_GITLAB_RESULT_AUTHORITY_REQUIRED");
  return {
    async load(candidate: Candidate, signal: AbortSignal) {
      if (
        signal.aborted ||
        candidate.workspaceId !== scope.workspaceId ||
        !scope.projectIds.includes(candidate.projectId)
      )
        throw new Error("CORPORATE_GITLAB_RESULT_SCOPE_DENIED");
      const read = async () => {
        const rows = (await input.source.query(
          `SELECT o.*,e.expected_commit_sha,e.connection_ref AS effect_connection_ref,e.profile_ref AS effect_profile_ref
           FROM qa_automation_attempts a
           JOIN gitlab_effect_reconciliations e ON e.workspace_id=a.workspace_id AND e.command_id=a.connector_command_id
           JOIN gitlab_pipeline_projection_heads h ON h.workspace_id=e.workspace_id AND h.connection_header_id=e.connection_header_id
             AND h.numeric_project_id=e.numeric_project_id AND h.external_pipeline_id=e.external_pipeline_id
           JOIN gitlab_pipeline_observations o ON o.workspace_id=h.workspace_id AND o.connection_header_id=h.connection_header_id
             AND o.numeric_project_id=h.numeric_project_id AND o.pipeline_observation_id=h.current_observation_id
           WHERE a.workspace_id=$1 AND a.project_id=$2 AND a.attempt_id=$3 AND a.connector_command_id=$4
             AND a.current_status='RUNNING' AND e.state IN ('ONE_FOUND','CONFIRMED')
             AND o.pipeline_observation_id=$5 AND o.observation_hash=$6
             AND o.provider_status IN ('SUCCESS','FAILED','CANCELED','SKIPPED','MANUAL')
             AND o.external_pipeline_id=e.external_pipeline_id AND o.marker_hash=e.marker_hash
             AND o.connection_ref=e.connection_ref AND o.profile_ref=e.profile_ref AND o.source_commit_sha=e.expected_commit_sha`,
          [
            candidate.workspaceId,
            candidate.projectId,
            candidate.attemptId,
            candidate.commandId,
            candidate.observationId,
            candidate.observationHash,
          ],
        )) as readonly Record<string, unknown>[];
        if (rows.length !== 1) throw new Error("CORPORATE_GITLAB_RESULT_OBSERVATION_STALE");
        return rows[0]!;
      };
      const first = await read();
      const connectionRef = parse<Ref>(first.effect_connection_ref),
        profileRef = parse<Ref>(first.effect_profile_ref);
      const grants = input.grants.filter(
        ({ binding }) =>
          binding.provider === "GITLAB" &&
          binding.workspaceId === candidate.workspaceId &&
          binding.projectId === candidate.projectId &&
          same(binding.connectionRef, connectionRef) &&
          same(binding.profileRef, profileRef),
      );
      if (
        grants.length !== 1 ||
        !(await input.authority.authorize(grants[0]!.binding, "CONNECTOR_READ", signal)) ||
        signal.aborted
      )
        throw new Error("CORPORATE_GITLAB_RESULT_ACCESS_DENIED");
      const current = await read();
      if (
        !(await input.authority.authorize(grants[0]!.binding, "CONNECTOR_READ", signal)) ||
        signal.aborted
      )
        throw new Error("CORPORATE_GITLAB_RESULT_ACCESS_DENIED");
      return Object.freeze({
        candidate: Object.freeze({ ...candidate }),
        observation: Object.freeze(structuredClone(current)),
        binding: grants[0]!.binding,
      });
    },
  };
}
