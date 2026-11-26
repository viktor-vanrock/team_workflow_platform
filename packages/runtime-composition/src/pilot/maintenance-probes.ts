import { randomUUID } from "node:crypto";

import type { DataSource } from "typeorm";

import {
  assessProjectCapabilityMode,
  resolveQaCapabilityRequirementSet,
} from "@awp/competency-qa/node";
import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  assertExactRevisionRef,
  type CapabilityProbeResult,
  type ExactRevisionRef,
  freezePilotValue,
  pilotContentHash,
  type ProjectScope,
} from "@awp/platform-core";
import { ProjectBindingRepository } from "@awp/platform-persistence-typeorm";

import {
  createSafeCapabilityProbe,
  type SafeCapabilityProbeInput,
} from "../onboarding/capability-probes.ts";

type Query = Pick<DataSource, "query">;
type Target = Omit<
  SafeCapabilityProbeInput,
  "probeId" | "observedAt" | "validUntil" | "status" | "safeIssueCodes"
>;
export interface CapabilityProbeMaintenanceOptions {
  readonly refreshAfterMs: number;
  readonly validForMs: number;
  readonly deadlineMs: number;
  readonly maximumProjects?: number;
  readonly deploymentScope?: Readonly<{ workspaceId: string; projectIds: readonly string[] }>;
  readonly now?: () => string;
  /** Current service authority and exact configuration, checked again after the observation. */
  readonly authorize?: ((target: Target, signal: AbortSignal) => Promise<boolean>) | undefined;
  /** A read-only provider capability check. Absence is an explicit unavailable result. */
  readonly observe?:
    | ((
        target: Target,
        signal: AbortSignal,
      ) => Promise<
        Readonly<{
          status: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE";
          safeIssueCodes: readonly string[];
        }>
      >)
    | undefined;
}
interface DueItem extends ProjectScope {
  readonly bindingRef: ExactRevisionRef;
  readonly qaProjectContextRef: ExactRevisionRef;
  readonly requirementSetRef: ExactRevisionRef;
}
interface Plan extends DueItem {
  readonly targets: readonly Target[];
}
const parse = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
const hasEntries = <T>(value: readonly T[] | undefined): value is readonly T[] =>
  Array.isArray(value);
const issues = new Set([
  "CAPABILITY_PROBE_FAILED",
  "CAPABILITY_PROBE_UNAVAILABLE",
  "CAPABILITY_PROBE_AUTHORITY_DENIED",
  "CAPABILITY_PROBE_EXECUTOR_NOT_CONFIGURED",
  "CAPABILITY_PROBE_DEADLINE",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_PERMISSION_DENIED",
  "PROVIDER_CAPABILITY_UNSUPPORTED",
  "PROVIDER_CONFIGURATION_DRIFT",
]);

/** The caller must authorize this exact Project before invoking the scoped configuration query. */
export async function currentProjectCapabilityPlans(
  source: Query,
  scope: ProjectScope,
): Promise<readonly Plan[]> {
  const records = (await source.query(
    `SELECT b.header_id AS binding_id,b.version AS binding_version,b.content_hash AS binding_hash,
    c.context_id,c.version AS context_version,c.content_hash AS context_hash,c.policy_refs->'capabilityRequirementSetRef' AS requirement_ref
    FROM project_integration_binding_headers h JOIN project_integration_binding_revisions b ON b.workspace_id=h.workspace_id AND b.project_id=h.project_id AND b.header_id=h.id AND b.version=h.current_published_version AND b.status='PUBLISHED'
    JOIN qa_project_context_headers_v2 ch ON ch.workspace_id=b.workspace_id AND ch.project_id=b.project_id
    JOIN qa_project_context_revisions_v2 c ON c.workspace_id=ch.workspace_id AND c.project_id=ch.project_id AND c.context_id=ch.context_id AND c.version=ch.current_published_version AND c.state='PUBLISHED'
    WHERE h.workspace_id=$1 AND h.project_id=$2 ORDER BY b.header_id LIMIT 21`,
    [scope.workspaceId, scope.projectId],
  )) as Record<string, unknown>[];
  if (records.length > 20) throw new Error("PILOT_HEALTH_CONFIGURATION_LIMIT");
  const plans: Plan[] = [];
  for (const record of records) {
    const requirement =
      parse<{ id?: string; version?: string | number; contentHash?: string }>(
        record.requirement_ref,
      ) ?? {};
    const item: DueItem = {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      bindingRef: {
        id: String(record.binding_id),
        version: Number(record.binding_version),
        contentHash: String(record.binding_hash) as `sha256:${string}`,
      },
      qaProjectContextRef: {
        id: String(record.context_id),
        version: Number(record.context_version),
        contentHash: String(record.context_hash) as `sha256:${string}`,
      },
      requirementSetRef: {
        id: requirement.id ?? "",
        version: Number(requirement.version),
        contentHash: requirement.contentHash as `sha256:${string}`,
      },
    };
    plans.push((await plan(source, item)) ?? { ...item, targets: [] });
  }
  return freezePilotValue(plans);
}

async function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort!: () => void;
  try {
    if (signal.aborted) throw new Error("CAPABILITY_PROBE_DEADLINE");
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        abort = () => reject(new Error("CAPABILITY_PROBE_DEADLINE"));
        signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
  }
}

async function due(
  source: Query,
  now: string,
  refreshAfterMs: number,
  maximumProjects: number,
  scope?: Readonly<{ workspaceId: string; projectIds: readonly string[] }>,
): Promise<readonly DueItem[]> {
  const rows = (await source.query(
    `
SELECT b.workspace_id,b.project_id,b.header_id AS binding_id,b.version AS binding_version,b.content_hash AS binding_hash,
       c.context_id,c.version AS context_version,c.content_hash AS context_hash,c.policy_refs->'capabilityRequirementSetRef' AS requirement_ref
FROM project_integration_binding_headers bh
JOIN project_integration_binding_revisions b ON b.workspace_id=bh.workspace_id AND b.project_id=bh.project_id AND b.header_id=bh.id AND b.version=bh.current_published_version AND b.status='PUBLISHED'
JOIN projects p ON p.workspace_id=b.workspace_id AND p.id=b.project_id AND p.state IN ('ACTIVE','SUSPENDED')
JOIN workspaces w ON w.id=p.workspace_id AND w.state='ACTIVE'
JOIN qa_project_context_headers_v2 ch ON ch.workspace_id=b.workspace_id AND ch.project_id=b.project_id
JOIN qa_project_context_revisions_v2 c ON c.workspace_id=ch.workspace_id AND c.project_id=ch.project_id AND c.context_id=ch.context_id AND c.version=ch.current_published_version AND c.state='PUBLISHED'
LEFT JOIN LATERAL (SELECT evaluated_at FROM capability_mode_assessments a WHERE a.workspace_id=b.workspace_id AND a.project_id=b.project_id
  AND a.binding_ref=jsonb_build_object('id',b.header_id::text,'version',b.version,'contentHash',b.content_hash)
  AND a.qa_project_context_ref=jsonb_build_object('id',c.context_id::text,'version',c.version,'contentHash',c.content_hash)
  ORDER BY evaluated_at DESC LIMIT 1) recent ON true
WHERE (recent.evaluated_at IS NULL OR recent.evaluated_at<=$1::timestamptz-($2::bigint*interval '1 millisecond'))
  AND ($4::uuid IS NULL OR (b.workspace_id=$4 AND b.project_id=ANY($5::uuid[])))
ORDER BY recent.evaluated_at NULLS FIRST,b.workspace_id,b.project_id,b.header_id LIMIT $3`,
    [
      now,
      refreshAfterMs,
      maximumProjects,
      scope?.workspaceId ?? null,
      scope ? [...scope.projectIds] : null,
    ],
  )) as readonly Record<string, unknown>[];
  return rows.map((row) => {
    const requirement = parse<{ id: string; version: string | number; contentHash: string }>(
      row.requirement_ref,
    );
    return {
      workspaceId: String(row.workspace_id),
      projectId: String(row.project_id),
      bindingRef: {
        id: String(row.binding_id),
        version: Number(row.binding_version),
        contentHash: String(row.binding_hash) as `sha256:${string}`,
      },
      qaProjectContextRef: {
        id: String(row.context_id),
        version: Number(row.context_version),
        contentHash: String(row.context_hash) as `sha256:${string}`,
      },
      requirementSetRef: {
        id: requirement?.id ?? "",
        version: Number(requirement?.version),
        contentHash: requirement?.contentHash as `sha256:${string}`,
      },
    };
  });
}

async function plan(source: Query, item: DueItem): Promise<Plan | undefined> {
  const requirementSet = resolveQaCapabilityRequirementSet(item.requirementSetRef);
  if (!requirementSet) return undefined;
  [item.bindingRef, item.qaProjectContextRef, item.requirementSetRef].forEach(
    assertExactRevisionRef,
  );
  const rows = (await source.query(
    `
SELECT b.content,vr.id AS validation_id,vr.report
FROM project_integration_binding_revisions b
JOIN project_integration_binding_headers bh ON bh.workspace_id=b.workspace_id AND bh.project_id=b.project_id AND bh.id=b.header_id AND bh.current_published_version=b.version
JOIN qa_project_context_headers_v2 ch ON ch.workspace_id=b.workspace_id AND ch.project_id=b.project_id AND ch.context_id=$6 AND ch.current_published_version=$7
JOIN qa_project_context_revisions_v2 c ON c.workspace_id=ch.workspace_id AND c.project_id=ch.project_id AND c.context_id=ch.context_id AND c.version=ch.current_published_version AND c.content_hash=$8 AND c.state='PUBLISHED'
LEFT JOIN LATERAL (SELECT id,report FROM integration_validation_reports WHERE workspace_id=b.workspace_id AND project_id=b.project_id AND subject_kind='BINDING' AND subject_id=b.header_id AND subject_version=b.version AND content_hash=b.content_hash AND outcome='VALID' ORDER BY created_at DESC,id DESC LIMIT 1) vr ON true
WHERE b.workspace_id=$1 AND b.project_id=$2 AND b.header_id=$3 AND b.version=$4 AND b.content_hash=$5 AND b.status='PUBLISHED'`,
    [
      item.workspaceId,
      item.projectId,
      item.bindingRef.id,
      item.bindingRef.version,
      item.bindingRef.contentHash,
      item.qaProjectContextRef.id,
      item.qaProjectContextRef.version,
      item.qaProjectContextRef.contentHash,
    ],
  )) as readonly Record<string, unknown>[];
  if (rows.length !== 1) return undefined;
  const row = rows[0]!;
  const content = parse<{
    entries?: readonly {
      logicalRole: string;
      capabilityKey: string;
      exactContractVersion: string;
      environmentScope: Target["environmentScope"];
      profileRef: { id: string; version: number; contentHash?: string };
    }[];
  }>(row.content);
  const targets: Target[] = [];
  if (!row.validation_id || !hasEntries(content.entries)) return { ...item, targets };
  const validationReportRef = {
    id: String(row.validation_id),
    version: 1,
    contentHash: sha256(parse<JsonValue>(row.report)),
  };
  for (const requirement of requirementSet.requirements) {
    const entries = content.entries.filter(
      (entry) =>
        entry.logicalRole === requirement.logicalRole &&
        entry.capabilityKey === requirement.capabilityKey &&
        entry.exactContractVersion === requirement.exactContractVersion,
    );
    if (entries.length !== 1) continue;
    const entry = entries[0]!;
    if (!["LOCAL", "NON_PROD", "PREPROD"].includes(entry.environmentScope)) continue;
    const configurations = (await source.query(
      `
SELECT p.content,p.content_hash,c.header_id AS connection_id,c.version AS connection_version,c.content_hash AS connection_hash
FROM connector_profile_revisions p
JOIN connector_profile_headers ph ON ph.workspace_id=p.workspace_id AND ph.id=p.header_id AND ph.current_published_version=p.version
JOIN connection_revisions c ON c.workspace_id=p.workspace_id AND c.header_id=(p.content->'connectionRef'->>'id')::uuid AND c.version=(p.content->'connectionRef'->>'version')::integer AND c.status='PUBLISHED'
JOIN connection_headers ch ON ch.workspace_id=c.workspace_id AND ch.id=c.header_id AND ch.current_published_version=c.version
WHERE p.workspace_id=$1 AND p.header_id=$2 AND p.version=$3 AND p.status='PUBLISHED'`,
      [item.workspaceId, entry.profileRef.id, entry.profileRef.version],
    )) as readonly Record<string, unknown>[];
    if (configurations.length !== 1) continue;
    const configuration = configurations[0]!;
    if (entry.profileRef.contentHash && entry.profileRef.contentHash !== configuration.content_hash)
      continue;
    const profile = parse<{
      mappingRef?: { id: string; version: number; contentHash?: string };
      capabilityConfigurations?: readonly {
        capabilityKey: string;
        exactContractVersion: string;
        environmentScopes: readonly string[];
        operations: readonly { operation: string }[];
      }[];
    }>(configuration.content);
    let mappingRef: ExactRevisionRef | undefined;
    if (profile.mappingRef) {
      const mappings = (await source.query(
        "SELECT m.content_hash FROM connector_mapping_revisions m JOIN connector_mapping_headers h ON h.workspace_id=m.workspace_id AND h.id=m.header_id AND h.current_published_version=m.version WHERE m.workspace_id=$1 AND m.header_id=$2 AND m.version=$3 AND m.status='PUBLISHED'",
        [item.workspaceId, profile.mappingRef.id, profile.mappingRef.version],
      )) as readonly { content_hash: `sha256:${string}` }[];
      if (
        mappings.length !== 1 ||
        (profile.mappingRef.contentHash &&
          profile.mappingRef.contentHash !== mappings[0]!.content_hash)
      )
        continue;
      mappingRef = {
        id: profile.mappingRef.id,
        version: profile.mappingRef.version,
        contentHash: mappings[0]!.content_hash,
      };
    }
    const capabilities =
      profile.capabilityConfigurations?.filter(
        (value) =>
          value.capabilityKey === requirement.capabilityKey &&
          value.exactContractVersion === requirement.exactContractVersion &&
          value.environmentScopes.includes(entry.environmentScope),
      ) ?? [];
    if (capabilities.length !== 1) continue;
    for (const operation of requirement.operations) {
      if (!capabilities[0]!.operations.some((value) => value.operation === operation)) continue;
      targets.push(
        freezePilotValue({
          workspaceId: item.workspaceId,
          projectId: item.projectId,
          bindingRef: item.bindingRef,
          profileRef: {
            id: entry.profileRef.id,
            version: entry.profileRef.version,
            contentHash: String(configuration.content_hash) as `sha256:${string}`,
          },
          connectionRef: {
            id: String(configuration.connection_id),
            version: Number(configuration.connection_version),
            contentHash: String(configuration.connection_hash) as `sha256:${string}`,
          },
          ...(mappingRef ? { mappingRef } : {}),
          validationReportRef,
          logicalRole: requirement.logicalRole,
          capabilityKey: requirement.capabilityKey,
          exactContractVersion: requirement.exactContractVersion,
          operation,
          environmentScope: entry.environmentScope,
        }),
      );
    }
  }
  return { ...item, targets };
}

/** Real due discovery and immutable observations. This worker never activates a project or changes its mode. */
export function createCapabilityProbeMaintenanceWorker(
  source: DataSource,
  options: CapabilityProbeMaintenanceOptions,
) {
  options = Object.freeze({ ...options });
  const maximumProjects = options.maximumProjects ?? 25;
  const clock = options.now ?? (() => new Date().toISOString());
  if (
    !Number.isSafeInteger(options.refreshAfterMs) ||
    options.refreshAfterMs < 1000 ||
    options.refreshAfterMs > 300_000 ||
    !Number.isSafeInteger(options.validForMs) ||
    options.validForMs < options.refreshAfterMs + options.deadlineMs ||
    options.validForMs > 600_000 ||
    !Number.isSafeInteger(options.deadlineMs) ||
    options.deadlineMs < 10 ||
    options.deadlineMs > 30_000 ||
    !Number.isSafeInteger(maximumProjects) ||
    maximumProjects < 1 ||
    maximumProjects > 100 ||
    (options.deploymentScope !== undefined &&
      (!options.deploymentScope.workspaceId || !options.deploymentScope.projectIds.length))
  )
    throw new Error("CAPABILITY_PROBE_POLICY_INVALID");
  return Object.freeze({
    async run() {
      const started = clock();
      if (!Number.isFinite(Date.parse(started)))
        throw new Error("CAPABILITY_PROBE_TIMESTAMP_INVALID");
      let checked = 0;
      let count = 0;
      let stale = 0;
      let blocked = 0;
      for (const item of await due(
        source,
        started,
        options.refreshAfterMs,
        maximumProjects,
        options.deploymentScope,
      )) {
        const initial = await plan(source, item);
        if (!initial) {
          blocked++;
          continue;
        }
        const observations: CapabilityProbeResult[] = [];
        for (const target of initial.targets) {
          const signal = AbortSignal.timeout(options.deadlineMs);
          let result: {
            status: CapabilityProbeResult["status"];
            safeIssueCodes: readonly string[];
          } = {
            status: "UNAVAILABLE",
            safeIssueCodes: ["CAPABILITY_PROBE_EXECUTOR_NOT_CONFIGURED"],
          };
          if (options.observe) {
            try {
              if (!options.authorize || !(await bounded(options.authorize(target, signal), signal)))
                result = {
                  status: "UNAVAILABLE",
                  safeIssueCodes: ["CAPABILITY_PROBE_AUTHORITY_DENIED"],
                };
              else {
                result = await bounded(options.observe(target, signal), signal);
                if (
                  !["AVAILABLE", "DEGRADED", "UNAVAILABLE"].includes(result.status) ||
                  result.safeIssueCodes.length > 10 ||
                  result.safeIssueCodes.some((code) => !issues.has(code)) ||
                  (result.status === "AVAILABLE" && result.safeIssueCodes.length)
                )
                  throw new Error();
                if (!(await bounded(options.authorize(target, signal), signal)))
                  result = {
                    status: "UNAVAILABLE",
                    safeIssueCodes: ["CAPABILITY_PROBE_AUTHORITY_DENIED"],
                  };
              }
            } catch {
              result = {
                status: "UNAVAILABLE",
                safeIssueCodes: [
                  signal.aborted ? "CAPABILITY_PROBE_DEADLINE" : "CAPABILITY_PROBE_FAILED",
                ],
              };
            }
          }
          const observedAt = clock();
          observations.push(
            createSafeCapabilityProbe({
              ...target,
              ...result,
              probeId: randomUUID(),
              observedAt,
              validUntil: new Date(Date.parse(observedAt) + options.validForMs).toISOString(),
            }),
          );
        }
        const requirementSet = resolveQaCapabilityRequirementSet(item.requirementSetRef);
        if (!requirementSet) {
          blocked++;
          continue;
        }
        const requirements = requirementSet.requirements.flatMap((requirement) =>
          requirement.operations.map((operation) => ({
            ...requirement,
            requirementKey: `${requirement.requirementKey}:${operation}`,
          })),
        );
        const projected = observations.map((observation) => {
          const requirement = requirements.find(
            (value) =>
              value.logicalRole === observation.logicalRole &&
              value.capabilityKey === observation.capabilityKey &&
              value.requirementKey.endsWith(`:${observation.operation}`),
          )!;
          return {
            ref: { id: observation.probeId, version: 1, contentHash: observation.contentHash },
            requirementKey: requirement.requirementKey,
            requirement: requirement.mode,
            status: observation.status,
            validUntil: observation.validUntil,
          };
        });
        const assessment = assessProjectCapabilityMode({
          assessmentId: randomUUID(),
          workspaceId: item.workspaceId,
          projectId: item.projectId,
          bindingRef: item.bindingRef,
          contextRef: item.qaProjectContextRef,
          requirementSetRef: item.requirementSetRef,
          requirementSet: { requirements },
          probes: projected,
          now: clock(),
        });
        const saved = await source.transaction("SERIALIZABLE", async (manager) => {
          const current = await plan(manager, item);
          if (!current || pilotContentHash(current) !== pilotContentHash(initial)) return false;
          const repository = new ProjectBindingRepository(manager);
          for (const observation of observations)
            await repository.appendCapabilityProbe(observation);
          await repository.appendModeAssessment(assessment);
          return true;
        });
        if (saved) {
          checked++;
          count += observations.length;
        } else stale++;
      }
      return Object.freeze({ checked, probes: count, stale, blocked });
    },
  });
}
