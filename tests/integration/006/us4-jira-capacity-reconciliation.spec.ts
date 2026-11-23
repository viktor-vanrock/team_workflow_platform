import { describe, expect, it, vi } from "vitest";

import { observeJiraIssue } from "../../../packages/connector-jira/src/index.ts";
import { sha256 } from "../../../packages/platform-contracts/src/index.ts";
import {
  PostgresAuthoritativeJiraCapacityReconciler,
  PostgresQueueCapacityReconciliationBootstrap,
} from "../../../packages/runtime-composition/src/index.ts";

const ids = Object.freeze({
  workspace: "00000000-0000-4000-8000-000000000801",
  project: "00000000-0000-4000-8000-000000000802",
  workItem: "00000000-0000-4000-8000-000000000803",
  policy: "00000000-0000-4000-8000-000000000804",
  mapping: "00000000-0000-4000-8000-000000000805",
  projection: "00000000-0000-4000-8000-000000000806",
  facet: "00000000-0000-4000-8000-000000000807",
  capacityProjection: "00000000-0000-4000-8000-000000000808",
  correlation: "00000000-0000-4000-8000-000000000809",
  causation: "00000000-0000-4000-8000-000000000810",
});
const at = "2026-09-03T12:00:00.000Z";

function fixture(
  input: Readonly<{
    normalizedStatus: "IN_PROGRESS" | "BLOCKED" | "DONE";
    blockReasonCode?: string;
    initialClaim?: boolean;
    capacityCount?: number;
    capacityLimit?: number;
  }>,
) {
  const hash = (value: string) => sha256(value);
  const policyRef = { sourceId: ids.policy, sourceVersion: 1, semanticHash: hash("policy") };
  const operationalRef = {
    sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION",
    sourceId: ids.projection,
    sourceVersion: 3,
    semanticHash: hash(`operational:${input.normalizedStatus}:${input.blockReasonCode ?? "none"}`),
    observedAt: at,
    confirmedAt: at,
  };
  const claims: Record<string, unknown>[] = input.initialClaim
    ? [
        {
          claim_id: "00000000-0000-4000-8000-000000000811",
          revision_number: 1,
          previous_revision_id: null,
          workspace_id: ids.workspace,
          project_id: ids.project,
          work_item_id: ids.workItem,
          session_ids: [],
          state: "ACTIVE",
          source_ref: operationalRef,
          cause_set: ["EXTERNAL_ACTIVE"],
          cause_set_hash: hash("cause"),
          acquired_at: "2026-09-03T10:00:00.000Z",
          released_at: null,
          semantic_hash: hash("claim:r1"),
        },
      ]
    : [];
  const decisions = new Map<string, Record<string, unknown>>();
  const eventTypes: string[] = [];
  const statements: string[] = [];
  const manager = {
    query: vi.fn(async (sql: string, parameters: readonly unknown[] = []) => {
      const normalized = sql.replace(/\s+/gu, " ").trim();
      statements.push(normalized);
      if (normalized.startsWith("SELECT * FROM workspace_capacity_heads"))
        return [
          {
            state: "ENFORCED",
            resource_version: 4,
            human_occupied_count: input.capacityCount ?? (input.initialClaim ? 1 : 0),
            review_reserved_count: 0,
            human_committed_count: input.capacityCount ?? (input.initialClaim ? 1 : 0),
            forced_external_count: 0,
            active_expedite_count: 0,
            claim_set_hash: hash("claims:before"),
            reservation_set_hash: sha256([]),
            expedite_set_hash: sha256([]),
            policy_ref: policyRef,
          },
        ];
      if (normalized.startsWith("SELECT mode,workspace_human_wip_limit"))
        return [
          {
            mode: "ENFORCED",
            workspace_human_wip_limit: input.capacityLimit ?? 1,
            active_expedite_limit: 1,
            status_mapping_ref: {
              sourceId: ids.mapping,
              sourceVersion: 1,
              semanticHash: hash("mapping"),
            },
            external_active_consumes_wip: ["IN_PROGRESS", "REVIEW", "BLOCKED"],
            block_reason_rules: [
              {
                normalizedStatus: "BLOCKED",
                reasonCode: "WAITING_EXTERNAL",
                wipEffect: "RELEASE_WIP",
                slaEffect: "PAUSE",
              },
            ],
          },
        ];
      if (
        normalized.includes("FROM work_items w") &&
        normalized.includes("operational_projection_revisions")
      )
        return [
          {
            work_item_id: ids.workItem,
            work_type_key: "QA_REQUEST",
            definition_version: "1",
            workspace_id: ids.workspace,
            project_id: ids.project,
            freshness_state: "CURRENT",
            projection_id: ids.projection,
            revision: 3,
            authority_fields_hash: operationalRef.semanticHash,
            external_revision_token: "jira:r3",
            observed_at: at,
            applied_at: at,
            configuration_refs: { mappingRef: { id: ids.mapping, version: 1 } },
            authority_snapshot: {
              observationId: "jira-observation-3",
              source: "RECONCILIATION_READ",
              externalEntityId: "10003",
              externalDisplayKey: "QA-3",
              externalRevisionToken: "jira:r3",
              authorityFieldsHash: operationalRef.semanticHash,
              providerUpdatedAt: at,
              observedAt: at,
              rawStatus: { id: "status", name: input.normalizedStatus },
              normalizedStatus: input.normalizedStatus,
              ...(input.blockReasonCode
                ? {
                    blockReason: {
                      rawId: "block-1",
                      rawName: "Waiting external",
                      normalizedReasonCode: input.blockReasonCode,
                    },
                  }
                : {}),
              requester: { externalPrincipalId: "jira-user" },
              profileRef: { id: "profile", version: 1 },
              mappingRef: { id: ids.mapping, version: 1 },
              connectionRef: { id: "connection", version: 1 },
              adapterFamily: "jira-cloud-v3",
              adapterContractVersion: "1.0.0",
            },
          },
        ];
      if (normalized.startsWith("SELECT revision.policy_facet_ref"))
        return [
          {
            policy_facet_ref: { id: ids.facet, version: 1, semanticHash: hash("facet") },
            qa_facet: { factsRef: { semanticHash: hash("qa") } },
            operational_facet: { projectionRef: operationalRef },
            source_set_hash: hash("queue-source"),
          },
        ];
      if (normalized.startsWith("SELECT revision.safe_body"))
        return [
          {
            safe_body: {
              authorizedProjectionRef: {
                id: ids.capacityProjection,
                version: 2,
                semanticHash: hash("safe-capacity"),
              },
            },
          },
        ];
      if (normalized.startsWith("SELECT decision_id,request_hash"))
        return decisions.get(String(parameters[2])) ? [decisions.get(String(parameters[2]))] : [];
      if (normalized.startsWith("SELECT * FROM work_item_human_wip_claims"))
        return claims.slice(-1);
      if (normalized.startsWith("SELECT * FROM review_capacity_reservations")) return [];
      if (normalized.startsWith("SELECT semantic_hash FROM work_item_human_wip_claims")) return [];
      if (normalized.startsWith("SELECT claim_id,revision_number FROM work_item_human_wip_claims"))
        return claims
          .slice(-1)
          .map((row) => ({ claim_id: row.claim_id, revision_number: row.revision_number }));
      if (normalized.startsWith("INSERT INTO work_item_human_wip_claims")) {
        claims.push({
          claim_id: parameters[0],
          workspace_id: parameters[1],
          project_id: parameters[2],
          work_item_id: parameters[3],
          revision_number: parameters[4],
          previous_revision_id: parameters[5],
          session_ids: JSON.parse(String(parameters[6])),
          state: parameters[7],
          source_ref: JSON.parse(String(parameters[8])),
          cause_set: JSON.parse(String(parameters[9])),
          cause_set_hash: parameters[10],
          acquired_at: parameters[11],
          released_at: parameters[12],
          semantic_hash: parameters[13],
        });
        return [];
      }
      if (normalized.includes("current_claims WHERE state='ACTIVE'"))
        return claims.at(-1)?.state === "ACTIVE" ? [claims.at(-1)] : [];
      if (normalized.includes("current_reservations ORDER BY")) return [];
      if (normalized.includes("revision.service_class='EXPEDITE'")) return [];
      if (normalized.startsWith("UPDATE workspace_capacity_heads"))
        return [{ resource_version: 5 }];
      if (normalized.startsWith("INSERT INTO capacity_admission_decisions")) {
        decisions.set(String(parameters[4]), {
          decision_id: parameters[0],
          request_hash: parameters[5],
          outcome: parameters[6],
          semantic_hash: parameters[14],
        });
        return [];
      }
      if (normalized.startsWith("INSERT INTO event_outbox")) {
        eventTypes.push(
          normalized.includes("'capacity.occupancy.changed'")
            ? "capacity.occupancy.changed"
            : String(parameters[3]),
        );
        return [];
      }
      return [];
    }),
  };
  return { manager, claims, decisions, eventTypes, statements };
}

describe("US4 confirmed Jira capacity reconciliation", () => {
  it("includes the mapped Jira-owned block reason in the authoritative hash", () => {
    const issue = {
      id: "10003",
      key: "QA-3",
      updated: at,
      fields: {
        status: { id: "blocked", name: "Blocked" },
        blockReason: { id: "external", name: "Waiting external" },
        requester: { accountId: "jira-user" },
      },
    };
    const observed = observeJiraIssue(issue, {
      status: { blocked: "BLOCKED" },
      blockReason: { external: "WAITING_EXTERNAL" },
    });
    const changed = observeJiraIssue(
      {
        ...issue,
        fields: { ...issue.fields, blockReason: { id: "dependency", name: "Waiting dependency" } },
      },
      { status: { blocked: "BLOCKED" }, blockReason: { dependency: "WAITING_DEPENDENCY" } },
    );
    expect(observed.blockReason).toEqual({
      rawId: "external",
      rawName: "Waiting external",
      normalizedReasonCode: "WAITING_EXTERNAL",
    });
    expect(observed.authorityFieldsHash).not.toBe(changed.authorityFieldsHash);
  });

  it("accepts unavoidable activity above the limit and emits the over-limit signal once", async () => {
    const database = fixture({
      normalizedStatus: "IN_PROGRESS",
      capacityCount: 1,
      capacityLimit: 1,
    });
    const reconciler = new PostgresAuthoritativeJiraCapacityReconciler({} as never);
    const request = {
      workspaceId: ids.workspace,
      projectId: ids.project,
      workItemId: ids.workItem,
      decidedAt: at,
      correlationId: ids.correlation,
      causationId: ids.causation,
    };
    await expect(
      reconciler.reconcileInTransaction(database.manager as never, request),
    ).resolves.toMatchObject({
      state: "RECONCILED",
      outcome: "NON_DISCRETIONARY_OVERFLOW",
      mutation: "UPSERT_FORCED_CLAIM",
      replayed: false,
    });
    await expect(
      reconciler.reconcileInTransaction(database.manager as never, request),
    ).resolves.toMatchObject({ replayed: true });
    expect(database.claims.at(-1)).toMatchObject({
      state: "ACTIVE",
      cause_set: ["FORCED_EXTERNAL"],
    });
    expect(
      database.eventTypes.filter((event) => event === "capacity.over-limit-detected"),
    ).toHaveLength(1);
    expect(
      database.eventTypes.filter((event) => event === "capacity.occupancy.changed"),
    ).toHaveLength(1);
  });

  it("releases only a confirmed Jira-owned block reason mapped to RELEASE_WIP", async () => {
    const confirmed = fixture({
      normalizedStatus: "BLOCKED",
      blockReasonCode: "WAITING_EXTERNAL",
      initialClaim: true,
      capacityLimit: 3,
    });
    const reconciler = new PostgresAuthoritativeJiraCapacityReconciler({} as never);
    await expect(
      reconciler.reconcileInTransaction(confirmed.manager as never, {
        workspaceId: ids.workspace,
        projectId: ids.project,
        workItemId: ids.workItem,
        decidedAt: at,
        correlationId: ids.correlation,
        causationId: ids.causation,
      }),
    ).resolves.toMatchObject({
      state: "RECONCILED",
      outcome: "NON_DISCRETIONARY_APPLIED",
      mutation: "RELEASE_CLAIM_BLOCK",
    });
    expect(confirmed.claims.at(-1)?.state).toBe("RELEASED_BLOCK");

    const unknown = fixture({
      normalizedStatus: "BLOCKED",
      blockReasonCode: "UNMAPPED",
      initialClaim: true,
      capacityLimit: 3,
    });
    await expect(
      reconciler.reconcileInTransaction(unknown.manager as never, {
        workspaceId: ids.workspace,
        projectId: ids.project,
        workItemId: ids.workItem,
        decidedAt: at,
        correlationId: ids.correlation,
        causationId: ids.causation,
      }),
    ).resolves.toMatchObject({
      state: "RECONCILED",
      outcome: "NO_CHANGE",
      mutation: "NO_CHANGE",
    });
    expect(unknown.claims).toHaveLength(1);
  });

  it("releases an active claim on confirmed terminal authority", async () => {
    const database = fixture({ normalizedStatus: "DONE", initialClaim: true, capacityLimit: 3 });
    const reconciler = new PostgresAuthoritativeJiraCapacityReconciler({} as never);
    await expect(
      reconciler.reconcileInTransaction(database.manager as never, {
        workspaceId: ids.workspace,
        projectId: ids.project,
        workItemId: ids.workItem,
        decidedAt: at,
        correlationId: ids.correlation,
        causationId: ids.causation,
      }),
    ).resolves.toMatchObject({ mutation: "RELEASE_CLAIM_TERMINAL" });
    expect(database.claims.at(-1)?.state).toBe("RELEASED_TERMINAL");
    expect(database.eventTypes).toContain("capacity.occupancy.changed");
  });

  it("persists and validates a resumable current-state checkpoint", async () => {
    const emptyHash = sha256([]);
    let checkpoint: Record<string, unknown> | undefined;
    const manager = {
      query: vi.fn(async (sql: string, parameters: readonly unknown[] = []) => {
        const normalized = sql.replace(/\s+/gu, " ").trim();
        if (normalized.startsWith("SELECT * FROM workspace_capacity_heads"))
          return [
            {
              state: "MEASURE_ONLY",
              resource_version: 2,
              human_occupied_count: 0,
              review_reserved_count: 0,
              human_committed_count: 0,
              forced_external_count: 0,
              active_expedite_count: 0,
              claim_set_hash: emptyHash,
              reservation_set_hash: emptyHash,
              expedite_set_hash: emptyHash,
              policy_ref: {
                sourceId: ids.policy,
                sourceVersion: 1,
                semanticHash: sha256("policy"),
              },
            },
          ];
        if (normalized.startsWith("SELECT generation_id FROM queue_projection_generations"))
          return [{ generation_id: "00000000-0000-4000-8000-000000000812" }];
        if (normalized.startsWith("SELECT * FROM workspace_capacity_reconciliation_checkpoints"))
          return checkpoint ? [checkpoint] : [];
        if (normalized.startsWith("INSERT INTO workspace_capacity_reconciliation_checkpoints")) {
          checkpoint = {
            checkpoint_id: parameters[0],
            workspace_id: parameters[1],
            policy_ref: JSON.parse(String(parameters[2])),
            projection_generation_id: parameters[3],
            state: "RUNNING",
            cursor_work_item_id: null,
            subject_count: 0,
            reconciled_count: 0,
            skipped_count: 0,
          };
          return [];
        }
        if (normalized.startsWith("SELECT id AS work_item_id"))
          return [{ work_item_id: ids.workItem, project_id: ids.project }];
        if (normalized.includes("current_claims WHERE state='ACTIVE'")) return [];
        if (normalized.includes("current_reservations ORDER BY")) return [];
        if (normalized.includes("revision.service_class='EXPEDITE'")) return [];
        if (
          normalized.startsWith("UPDATE workspace_capacity_reconciliation_checkpoints SET state=$3")
        ) {
          checkpoint = {
            ...checkpoint,
            state: parameters[2],
            cursor_work_item_id: parameters[3],
            subject_count: parameters[4],
            reconciled_count: parameters[5],
            skipped_count: parameters[6],
            failure_code: parameters[7],
          };
          return [];
        }
        return [];
      }),
    };
    const source = {
      transaction: vi.fn(
        async (_isolation: string, work: (value: typeof manager) => Promise<unknown>) =>
          await work(manager),
      ),
    };
    const reconcile = vi
      .fn()
      .mockResolvedValue({ state: "SKIPPED", reasonCode: "STATUS_NOT_CAPACITY_RELEVANT" });
    const bootstrap = new PostgresQueueCapacityReconciliationBootstrap(source as never, {
      reconcile,
    });
    await expect(
      bootstrap.runPage({ workspaceId: ids.workspace, pageSize: 2, at }),
    ).resolves.toMatchObject({
      state: "PASSED",
      processedCount: 1,
      reconciledCount: 0,
      skippedCount: 1,
    });
    expect(checkpoint).toMatchObject({ state: "PASSED", cursor_work_item_id: ids.workItem });
    expect(reconcile).toHaveBeenCalledOnce();
  });
});
