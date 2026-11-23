import { describe, expect, it, vi } from "vitest";

import { sha256 } from "../../../packages/platform-contracts/src/index.ts";
import {
  PostgresQueueEnforcedActivationGate,
  QueuePolicyPublicationService,
} from "../../../packages/runtime-composition/src/index.ts";
import {
  businessCalendarFixture,
  policyIds,
  queuePolicyFixture,
} from "../../helpers/006/policy-fixture.ts";

describe("US4 atomic policy publication", () => {
  it("publishes calendar/policy with idempotency, CAS, audit, and safe Project facets in one transaction", async () => {
    const configurations = new Map<string, Readonly<Record<string, unknown>>>();
    const statements: string[] = [];
    const manager = {
      query: vi.fn(async (sql: string, parameters: readonly unknown[] = []) => {
        statements.push(sql.replace(/\s+/gu, " ").trim());
        if (
          sql.includes(
            "SELECT request_hash,outcome,published_revision_ref FROM workspace_queue_configuration_requests",
          )
        )
          return configurations.get(String(parameters[2]))
            ? [configurations.get(String(parameters[2]))]
            : [];
        if (sql.includes("SELECT calendar_revision_id FROM workspace_business_calendar_revisions"))
          return [{ calendar_revision_id: "00000000-0000-4000-8000-000000000621" }];
        if (
          sql.includes(
            "SELECT current_revision_id,resource_version FROM workspace_business_calendar_heads",
          )
        )
          return [];
        if (
          sql.includes(
            "SELECT current_revision_id,resource_version FROM workspace_queue_policy_heads",
          )
        )
          return [];
        if (sql.includes("SELECT id FROM projects"))
          return [{ id: policyIds.projectA }, { id: policyIds.projectB }];
        if (sql.includes("SELECT current_revision_id FROM workspace_queue_policy_view_heads"))
          return [{ current_revision_id: null }];
        if (sql.includes("SELECT current_revision_id FROM project_queue_policy_facet_heads"))
          return [{ current_revision_id: null }];
        if (
          sql.includes(
            "SELECT revision_number,semantic_hash FROM workspace_queue_policy_view_revisions",
          )
        )
          return [];
        if (
          sql.includes(
            "SELECT revision_number,semantic_hash FROM project_queue_policy_facet_revisions",
          )
        )
          return [];
        if (sql.includes("UPDATE workspace_queue_configuration_requests SET outcome='PUBLISHED'")) {
          configurations.set(String(parameters[2]), {
            request_hash: parameters[4 - 1],
            outcome: "PUBLISHED",
            published_revision_ref: parameters[4],
          });
          // request_hash is captured from the preceding INSERT below; overwrite from the remembered pending value.
          const pending = configurations.get(`${String(parameters[2])}:pending`)!;
          configurations.set(String(parameters[2]), {
            request_hash: pending.request_hash,
            outcome: "PUBLISHED",
            published_revision_ref: parameters[4],
          });
          return [{ outcome: "PUBLISHED" }];
        }
        if (sql.includes("INSERT INTO workspace_queue_configuration_requests")) {
          configurations.set(`${String(parameters[2])}:pending`, { request_hash: parameters[4] });
        }
        return [];
      }),
    };
    const source = {
      transaction: vi.fn(
        async (_level: string, work: (value: typeof manager) => Promise<unknown>) =>
          await work(manager),
      ),
    };
    const basis = {
      kind: "WORKSPACE" as const,
      policyVersion: "1",
      membershipRef: { id: "membership", version: 1 },
      roleAssignmentRefs: [],
      entitlementRefs: [],
      skillContext: "NOT_APPLICABLE" as const,
    };
    const service = new QueuePolicyPublicationService(source as never, {
      authorize: vi.fn().mockResolvedValue({ basis, classificationKey: "INTERNAL" }),
    });
    const context = {
      workspaceId: policyIds.workspace,
      expectedHeaderVersion: 0,
      actor: {
        kind: "HUMAN" as const,
        principalId: policyIds.principal,
        issuer: "local",
        subject: "lead",
      },
      correlationId: "00000000-0000-4000-8000-000000000622",
      causationId: "00000000-0000-4000-8000-000000000623",
    };
    const calendar = businessCalendarFixture();
    const calendarInput = {
      ...context,
      requestKey: "calendar-publication-0001",
      calendar,
      calendarRevisionId: "00000000-0000-4000-8000-000000000621",
    };
    await expect(service.publishCalendar(calendarInput)).resolves.toMatchObject({
      state: "PUBLISHED",
      operation: "PUBLISH_CALENDAR",
      replayed: false,
    });
    const afterCalendar = statements.length;
    await expect(service.publishCalendar(calendarInput)).resolves.toMatchObject({ replayed: true });
    expect(statements.length).toBe(afterCalendar + 1);

    const policy = queuePolicyFixture("MEASURE_ONLY", calendar);
    const policyInput = {
      ...context,
      requestKey: "policy-publication-00001",
      policy,
      calendar,
      policyRevisionId: "00000000-0000-4000-8000-000000000624",
    };
    await expect(service.publishPolicy(policyInput)).resolves.toMatchObject({
      state: "PUBLISHED",
      operation: "PUBLISH_POLICY",
      replayed: false,
    });
    expect(
      statements.filter((sql) => sql.includes("INSERT INTO project_queue_policy_facet_heads")),
    ).toHaveLength(2);
    expect(
      statements.filter((sql) => sql.includes("INSERT INTO project_queue_policy_facet_revisions")),
    ).toHaveLength(2);
    expect(statements.some((sql) => sql.includes("INSERT INTO workspace_capacity_heads"))).toBe(
      true,
    );
    expect(statements.some((sql) => sql.includes("INSERT INTO audit_events"))).toBe(true);
    const afterPolicy = statements.length;
    await expect(service.publishPolicy(policyInput)).resolves.toMatchObject({ replayed: true });
    expect(statements.length).toBe(afterPolicy + 1);
  });

  it("fails closed when ENFORCED activation evidence is not current", async () => {
    const manager = {
      query: vi.fn(async (sql: string) => (sql.includes("SELECT request_hash") ? [] : [])),
    };
    const source = {
      transaction: vi.fn(
        async (_level: string, work: (value: typeof manager) => Promise<unknown>) =>
          await work(manager),
      ),
    };
    const basis = {
      kind: "WORKSPACE" as const,
      policyVersion: "1",
      membershipRef: { id: "membership", version: 1 },
      roleAssignmentRefs: [],
      entitlementRefs: [],
      skillContext: "NOT_APPLICABLE" as const,
    };
    const service = new QueuePolicyPublicationService(source as never, {
      authorize: vi.fn().mockResolvedValue({ basis, classificationKey: "INTERNAL" }),
      validateEnforcedActivation: vi.fn().mockResolvedValue(false),
    });
    const calendar = businessCalendarFixture();
    await expect(
      service.publishPolicy({
        workspaceId: policyIds.workspace,
        requestKey: "enforced-publication-001",
        expectedHeaderVersion: 0,
        actor: {
          kind: "HUMAN",
          principalId: policyIds.principal,
          issuer: "local",
          subject: "lead",
        },
        correlationId: "00000000-0000-4000-8000-000000000625",
        causationId: "00000000-0000-4000-8000-000000000626",
        policy: queuePolicyFixture("ENFORCED", calendar),
        calendar,
        policyRevisionId: "00000000-0000-4000-8000-000000000627",
      }),
    ).rejects.toThrow("QUEUE_POLICY_ENFORCED_ACTIVATION_GATE_FAILED");
  });

  it("requires an active queue generation, exact capacity hashes, current Project projections, and reconciled authority", async () => {
    const calendar = businessCalendarFixture();
    const policy = queuePolicyFixture("ENFORCED", calendar);
    let operationalStatus: "READY" | "IN_PROGRESS" = "READY";
    const emptyHash = sha256([]);
    const manager = {
      query: vi.fn(async (sql: string) => {
        const normalized = sql.replace(/\s+/gu, " ").trim();
        if (normalized.startsWith("SELECT generation_id,activated_at"))
          return [
            { generation_id: "generation-1", activated_at: policy.publishedAt, has_pending: false },
          ];
        if (normalized.startsWith("SELECT * FROM workspace_capacity_heads"))
          return [
            {
              state: "MEASURE_ONLY",
              resource_version: 7,
              human_occupied_count: 0,
              review_reserved_count: 0,
              human_committed_count: 0,
              forced_external_count: 0,
              active_expedite_count: 0,
              claim_set_hash: emptyHash,
              reservation_set_hash: emptyHash,
              expedite_set_hash: emptyHash,
            },
          ];
        if (normalized.includes("current_claims WHERE state='ACTIVE'")) return [];
        if (normalized.includes("current_reservations ORDER BY")) return [];
        if (normalized.includes("revision.service_class='EXPEDITE'")) return [];
        if (normalized.startsWith("SELECT count(*) FILTER")) return [{ stale_count: 0 }];
        if (normalized.startsWith("SELECT work_item.id AS work_item_id"))
          return [
            {
              work_item_id: policyIds.projectA,
              project_id: policyIds.projectA,
              freshness_state: "CURRENT",
              claim_state: null,
              configuration_refs: {
                mappingRef: {
                  id: policy.statusMappingRef.sourceId,
                  version: policy.statusMappingRef.sourceVersion,
                },
              },
              authority_snapshot: { normalizedStatus: operationalStatus },
            },
          ];
        return [];
      }),
    };
    const gate = new PostgresQueueEnforcedActivationGate({} as never);
    await expect(
      gate.validate({ workspaceId: policyIds.workspace, policy, manager: manager as never }),
    ).resolves.toBe(true);
    operationalStatus = "IN_PROGRESS";
    await expect(
      gate.validate({ workspaceId: policyIds.workspace, policy, manager: manager as never }),
    ).resolves.toBe(false);
    expect(
      manager.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE workspace_capacity_heads")),
    ).toBe(false);
  });
});
