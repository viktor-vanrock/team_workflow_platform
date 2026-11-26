import { randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import {
  type ActorReference,
  DenyByDefaultAuthorizationPolicy,
  type ExactRevisionRef,
  isSystemAdministratorRole,
  pilotContentHash,
  type ProjectScope,
} from "@awp/platform-core";
import {
  ProjectBindingRepository,
  TypeOrmScopedAccessRepository,
} from "@awp/platform-persistence-typeorm";

import { createSafeCapabilityProbe, type SafeCapabilityProbeInput } from "./capability-probes.ts";
import { integrationConfigurationHash } from "./configuration-hash.ts";

export type RequestedProbeTarget = Omit<
  SafeCapabilityProbeInput,
  "probeId" | "observedAt" | "validUntil" | "status" | "safeIssueCodes"
>;
export interface CapabilityProbeRequest extends ProjectScope {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly actor: Extract<ActorReference, { kind: "HUMAN" }>;
  readonly validationReportRef: ExactRevisionRef;
  readonly targets: readonly RequestedProbeTarget[];
  readonly createdAt: string;
}
interface Row {
  request_id: string;
  semantic_body: CapabilityProbeRequest;
  content_hash: string;
  claim_token: string;
}
export interface RequestedCapabilityProbeOptions {
  readonly deadlineMs: number;
  readonly validForMs: number;
  readonly deploymentScope?: Readonly<{ workspaceId: string; projectIds: readonly string[] }>;
  /** Independent current SERVICE/provider authority; the requester is reauthorized internally. */
  readonly authorize?: (target: RequestedProbeTarget, signal: AbortSignal) => Promise<boolean>;
  /** Safe capability observation only; this port must never run a provider write. */
  readonly observe?: (
    target: RequestedProbeTarget,
    signal: AbortSignal,
  ) => Promise<{
    status: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE";
    safeIssueCodes: readonly string[];
  }>;
}
const rows = <T>(raw: unknown): T[] => {
  const a = raw as unknown[];
  return (Array.isArray(a[0]) ? a[0] : a) as T[];
};
const equal = (a: unknown, b: unknown) => pilotContentHash(a) === pilotContentHash(b);
const pinned = (a: unknown, b: ExactRevisionRef) => {
  const v = a as Partial<ExactRevisionRef> | undefined;
  return (
    v?.id === b.id &&
    v.version === b.version &&
    (v.contentHash === undefined || v.contentHash === b.contentHash)
  );
};
const issueCodes = new Set([
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_PERMISSION_DENIED",
  "PROVIDER_CAPABILITY_UNSUPPORTED",
  "PROVIDER_CONFIGURATION_DRIFT",
]);

async function current(manager: EntityManager, row: Row): Promise<boolean> {
  const job = row.semantic_body;
  if (
    pilotContentHash(job) !== row.content_hash ||
    job.requestId !== row.request_id ||
    !job.targets.length ||
    job.targets.length > 32
  )
    return false;
  const scope = {
    kind: "PROJECT" as const,
    workspaceId: job.workspaceId,
    projectId: job.projectId,
  };
  const identity = (await manager.query(
    "SELECT id FROM identities WHERE id=$1 AND kind='HUMAN' FOR SHARE",
    [job.actor.principalId],
  )) as unknown[];
  const project = (await manager.query(
    "SELECT p.classification_key FROM projects p JOIN workspaces w ON w.id=p.workspace_id WHERE p.workspace_id=$1 AND p.id=$2 AND p.registration_status='ACTIVE' AND p.state IN ('ACTIVE','SUSPENDED') AND w.state='ACTIVE' FOR SHARE OF p,w",
    [job.workspaceId, job.projectId],
  )) as { classification_key: string }[];
  if (!identity.length || !project.length) return false;
  await manager.query(
    "SELECT id FROM workspace_memberships WHERE workspace_id=$1 AND principal_id=$2 ORDER BY id FOR SHARE",
    [job.workspaceId, job.actor.principalId],
  );
  await manager.query(
    "SELECT id FROM role_assignments WHERE workspace_id=$1 AND principal_id=$2 AND (project_id IS NULL OR project_id=$3) ORDER BY id FOR SHARE",
    [job.workspaceId, job.actor.principalId, job.projectId],
  );
  await manager.query(
    "SELECT id FROM project_entitlements WHERE workspace_id=$1 AND principal_id=$2 AND project_id=$3 ORDER BY id FOR SHARE",
    [job.workspaceId, job.actor.principalId, job.projectId],
  );
  const access = new TypeOrmScopedAccessRepository(manager);
  const at = new Date(),
    facts = await access.authorizationFacts(scope, job.actor.principalId, at),
    resource = await access.getProject(scope);
  const decision = resource
    ? new DenyByDefaultAuthorizationPolicy().decide({
        context: {
          scope,
          actor: job.actor,
          correlationId: job.requestId,
          causationId: job.requestId,
        },
        permission: "integration.validate",
        resourceClassification: resource.classification,
        facts,
        at,
        operationClass: "READ",
      })
    : undefined;
  if (
    !decision?.allowed ||
    !decision.basis ||
    !facts.roleAssignments.some(
      (role) =>
        isSystemAdministratorRole(role.roleKey) &&
        decision.basis!.roleAssignmentRefs.some(
          (ref) => ref.id === role.ref.id && ref.version === role.ref.version,
        ),
    )
  )
    return false;
  const first = job.targets[0]!;
  const reports = (await manager.query(
    "SELECT id,report,outcome,content_hash,subject_version FROM integration_validation_reports WHERE workspace_id=$1 AND project_id=$2 AND subject_kind='BINDING' AND subject_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1",
    [job.workspaceId, job.projectId, first.bindingRef.id],
  )) as {
    id: string;
    report: unknown;
    outcome: string;
    content_hash: string;
    subject_version: number;
  }[];
  const report = reports[0];
  if (
    !report ||
    report.id !== job.validationReportRef.id ||
    report.outcome !== "VALID" ||
    report.subject_version !== first.bindingRef.version ||
    report.content_hash !== first.bindingRef.contentHash ||
    pilotContentHash(report.report) !== job.validationReportRef.contentHash
  )
    return false;
  for (const target of job.targets) {
    if (
      target.workspaceId !== job.workspaceId ||
      target.projectId !== job.projectId ||
      !equal(target.bindingRef, first.bindingRef) ||
      !equal(target.validationReportRef, job.validationReportRef)
    )
      return false;
    const bindings = (await manager.query(
      "SELECT r.content,r.content_hash FROM project_integration_binding_revisions r WHERE r.workspace_id=$1 AND r.project_id=$2 AND r.header_id=$3 AND r.version=$4 AND r.status IN ('VALIDATED','PUBLISHED') AND r.version=(SELECT max(v.version) FROM project_integration_binding_revisions v WHERE v.workspace_id=r.workspace_id AND v.project_id=r.project_id AND v.header_id=r.header_id) FOR SHARE",
      [job.workspaceId, job.projectId, target.bindingRef.id, target.bindingRef.version],
    )) as { content: Record<string, unknown>; content_hash: string }[];
    const binding = bindings[0];
    if (
      !binding ||
      binding.content_hash !== target.bindingRef.contentHash ||
      integrationConfigurationHash("project_integration_binding", binding.content) !==
        binding.content_hash
    )
      return false;
    const entries = binding.content.entries as Record<string, unknown>[];
    if (
      !entries.some(
        (e) =>
          e.logicalRole === target.logicalRole &&
          e.capabilityKey === target.capabilityKey &&
          e.exactContractVersion === target.exactContractVersion &&
          e.environmentScope === target.environmentScope &&
          pinned(e.profileRef, target.profileRef),
      )
    )
      return false;
    const load = async (
      table: "connector_profile" | "connection" | "connector_mapping",
      ref: ExactRevisionRef,
    ) => {
      const values = (await manager.query(
        `SELECT r.content,r.content_hash FROM ${table}_headers h JOIN ${table}_revisions r ON r.workspace_id=h.workspace_id AND r.header_id=h.id AND r.version=h.current_published_version WHERE h.workspace_id=$1 AND h.id=$2 AND r.version=$3 AND r.status='PUBLISHED' FOR SHARE OF h,r`,
        [job.workspaceId, ref.id, ref.version],
      )) as { content: Record<string, unknown>; content_hash: string }[];
      const value = values[0];
      return value &&
        value.content_hash === ref.contentHash &&
        integrationConfigurationHash(table, value.content) === ref.contentHash
        ? value.content
        : undefined;
    };
    const profile = await load("connector_profile", target.profileRef),
      connection = await load("connection", target.connectionRef);
    if (
      !profile ||
      !connection ||
      !pinned(profile.connectionRef, target.connectionRef) ||
      Boolean(profile.mappingRef) !== Boolean(target.mappingRef)
    )
      return false;
    if (
      target.mappingRef &&
      (!pinned(profile.mappingRef, target.mappingRef) ||
        !(await load("connector_mapping", target.mappingRef)))
    )
      return false;
    const capabilities = (
      profile.capabilityConfigurations as {
        capabilityKey: string;
        exactContractVersion: string;
        environmentScopes: string[];
        operations: { operation: string }[];
      }[]
    ).filter(
      (capability) =>
        capability.capabilityKey === target.capabilityKey &&
        capability.exactContractVersion === target.exactContractVersion &&
        capability.environmentScopes.includes(target.environmentScope),
    );
    if (
      capabilities.length !== 1 ||
      capabilities[0]!.operations.filter((value) => value.operation === target.operation).length !==
        1
    )
      return false;
  }
  return true;
}
async function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort!: () => void;
  try {
    if (signal.aborted) throw new Error("DEADLINE");
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        abort = () => reject(new Error("DEADLINE"));
        signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
  }
}

export function createRequestedCapabilityProbeWorker(
  source: DataSource,
  options: RequestedCapabilityProbeOptions,
) {
  if (
    !Number.isSafeInteger(options.deadlineMs) ||
    options.deadlineMs < 10 ||
    options.deadlineMs > 5000 ||
    !Number.isSafeInteger(options.validForMs) ||
    options.validForMs < options.deadlineMs ||
    options.validForMs > 600_000 ||
    (options.deploymentScope !== undefined &&
      (!options.deploymentScope.workspaceId || !options.deploymentScope.projectIds.length))
  )
    throw new Error("PROBE_POLICY_INVALID");
  const isCurrent = (row: Row) =>
    source.transaction(async (manager) => {
      await manager.query(
        "SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$1,true)",
        [`${options.deadlineMs}ms`],
      );
      return current(manager, row);
    });
  return {
    async run() {
      let completed = 0,
        rejected = 0,
        probes = 0;
      const token = randomUUID();
      const claimed = rows<Row>(
        await source.query(
          `WITH due AS (SELECT request_id FROM capability_probe_requests WHERE (state='QUEUED' OR (state='RUNNING' AND lease_until<clock_timestamp()))
          AND ($2::uuid IS NULL OR (workspace_id=$2 AND project_id=ANY($3::uuid[]))) ORDER BY created_at,request_id FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE capability_probe_requests r SET state='RUNNING',claim_token=$1,lease_until=clock_timestamp()+interval '5 minutes' FROM due WHERE r.request_id=due.request_id RETURNING r.*`,
          [
            token,
            options.deploymentScope?.workspaceId ?? null,
            options.deploymentScope ? [...options.deploymentScope.projectIds] : null,
          ],
        ),
      );
      for (const row of claimed) {
        const observations: ReturnType<typeof createSafeCapabilityProbe>[] = [];
        let valid = await isCurrent(row);
        for (const target of row.semantic_body.targets) {
          if (!valid) break;
          const signal = AbortSignal.timeout(options.deadlineMs);
          let result: Pick<SafeCapabilityProbeInput, "status" | "safeIssueCodes"> = {
            status: "UNAVAILABLE",
            safeIssueCodes: ["CAPABILITY_PROBE_EXECUTOR_NOT_CONFIGURED"],
          };
          try {
            if (options.observe && options.authorize) {
              valid = await bounded(isCurrent(row), signal);
              if (!valid) break;
              if (!(await bounded(options.authorize(target, signal), signal)))
                result = {
                  status: "UNAVAILABLE",
                  safeIssueCodes: ["CAPABILITY_PROBE_AUTHORITY_DENIED"],
                };
              else {
                result = await bounded(options.observe(target, signal), signal);
                if (
                  !["AVAILABLE", "DEGRADED", "UNAVAILABLE"].includes(result.status) ||
                  result.safeIssueCodes.length > 10 ||
                  result.safeIssueCodes.some((code) => !issueCodes.has(code)) ||
                  (result.status === "AVAILABLE" && result.safeIssueCodes.length)
                )
                  throw new Error("INVALID_OBSERVATION");
                if (!(await bounded(options.authorize(target, signal), signal)))
                  result = {
                    status: "UNAVAILABLE",
                    safeIssueCodes: ["CAPABILITY_PROBE_AUTHORITY_DENIED"],
                  };
              }
            }
          } catch {
            result = {
              status: "UNAVAILABLE",
              safeIssueCodes: [
                signal.aborted ? "CAPABILITY_PROBE_DEADLINE" : "CAPABILITY_PROBE_FAILED",
              ],
            };
          }
          const at = new Date();
          observations.push(
            createSafeCapabilityProbe({
              ...target,
              ...result,
              probeId: randomUUID(),
              observedAt: at.toISOString(),
              validUntil: new Date(at.getTime() + options.validForMs).toISOString(),
            }),
          );
        }
        await source.transaction("SERIALIZABLE", async (manager) => {
          await manager.query(
            "SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$1,true)",
            [`${options.deadlineMs}ms`],
          );
          const held = (await manager.query(
            "SELECT request_id FROM capability_probe_requests WHERE request_id=$1 AND state='RUNNING' AND claim_token=$2 AND lease_until>clock_timestamp() FOR UPDATE",
            [row.request_id, token],
          )) as unknown[];
          if (!held.length) return;
          valid =
            valid &&
            observations.length === row.semantic_body.targets.length &&
            (await current(manager, row));
          const refs: ExactRevisionRef[] = [];
          if (valid)
            for (const observation of observations) {
              await new ProjectBindingRepository(manager).appendCapabilityProbe(observation);
              refs.push({
                id: observation.probeId,
                version: 1,
                contentHash: observation.contentHash,
              });
            }
          await manager.query(
            "UPDATE capability_probe_requests SET state=$3,claim_token=NULL,lease_until=NULL,result_refs=$4,safe_issue_code=$5,completed_at=clock_timestamp() WHERE request_id=$1 AND claim_token=$2",
            [
              row.request_id,
              token,
              valid ? "COMPLETED" : "REJECTED",
              JSON.stringify(refs),
              valid ? null : "CAPABILITY_PROBE_REQUEST_STALE",
            ],
          );
          if (valid) {
            completed++;
            probes += refs.length;
          } else rejected++;
        });
      }
      return { completed, rejected, probes };
    },
  };
}
