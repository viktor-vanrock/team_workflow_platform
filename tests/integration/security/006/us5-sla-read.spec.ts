import { describe, expect, it, vi } from "vitest";

import { QueueController } from "../../../../apps/api/src/extensions/queue/queue.controller.ts";
import { QueuePoliciesController } from "../../../../apps/api/src/extensions/queue/queue-policies.controller.ts";
import { createLocalQueueHttpAuthority } from "../../../../apps/api/src/local/local-queue-http-authority.ts";
import {
  applySlaClockTransitionToSegments,
  createInitialSlaClock,
  defaultClassificationCatalog,
  projectQueuePolicyFacet,
  projectQueuePolicyNeutralView,
} from "../../../../packages/platform-core/src/index.ts";
import {
  businessCalendarFixture,
  policyIds,
  queuePolicyFixture,
} from "../../../helpers/006/policy-fixture.ts";
import { digest } from "../../../helpers/006/triage-fixture.ts";

const id = (suffix: string): string => `70000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

function fixture() {
  const calendar = businessCalendarFixture();
  const policy = projectQueuePolicyFacet(
    queuePolicyFixture("ENFORCED", calendar),
    policyIds.projectA,
    { id: id("1"), version: 1 },
  );
  const transition = createInitialSlaClock({
    workspaceId: policyIds.workspace,
    projectId: policyIds.projectA,
    workItemId: id("2"),
    slaClockId: id("3"),
    goal: "READY_TO_FIRST_QA_START",
    policyFacetRef: policy.policyFacetRef,
    calendarRef: policy.calendarRef,
    mappingRef: {
      ...policy.statusMappingRef,
      sourceVersion: Number(policy.statusMappingRef.sourceVersion),
    },
    algorithmRef: {
      key: "sla-business-time",
      version: "1.0.0",
      semanticHash: digest("sla-business-time@1"),
    },
    startSourceRef: {
      sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION",
      sourceId: id("4"),
      sourceVersion: 1,
      semanticHash: digest("jira-ready"),
      observedAt: "2026-09-07T04:59:00.000Z",
      confirmedAt: "2026-09-07T05:00:00.000Z",
    },
  });
  const segment = applySlaClockTransitionToSegments({
    transition,
    calendar,
    nextSegmentId: id("5"),
  }).opened!;
  return { calendar, policy, transition, segment };
}

function dataSource(workItemExists = true) {
  const value = fixture();
  const provider = vi.fn();
  const model = vi.fn();
  const principalId = id("20");
  const grant = {
    workspace_id: policyIds.workspace,
    project_id: policyIds.projectA,
    principal_id: principalId,
    effect: "ALLOW",
    permissions: ["queue.sla.read"],
    valid_from: "2026-08-01T00:00:00.000Z",
    row_version: 1,
  };
  const classification = defaultClassificationCatalog.reference("INTERNAL");
  const query = vi.fn(async (sql: string, params: readonly unknown[]) => {
    if (sql.startsWith("SELECT id FROM identities WHERE issuer=")) return [{ id: principalId }];
    if (sql.startsWith("SELECT id,issuer,subject FROM identities"))
      return [{ id: principalId, issuer: "urn:test:local-idp", subject: "lead.alpha" }];
    if (sql.startsWith("SELECT id FROM workspaces")) return [{ id: policyIds.workspace }];
    if (sql.includes("FROM projects p JOIN classification_catalog"))
      return [
        {
          id: policyIds.projectA,
          workspace_id: policyIds.workspace,
          key: "ALPHA",
          state: "ACTIVE",
          classification_key: classification.key,
          rank: classification.rank,
        },
      ];
    if (sql.includes("FROM workspace_memberships WHERE"))
      return [{ ...grant, id: id("21"), state: "ACTIVE" }];
    if (sql.includes("FROM role_assignments WHERE"))
      return [{ ...grant, id: id("22"), role_key: "qa-lead" }];
    if (sql.includes("FROM project_entitlements e"))
      return [
        {
          ...grant,
          id: id("23"),
          classification_ceiling_key: classification.key,
          rank: classification.rank,
        },
      ];
    if (sql.startsWith("SELECT id FROM work_items"))
      return workItemExists && params[2] === value.transition.workItemId
        ? [{ id: value.transition.workItemId }]
        : [];
    if (sql.includes("FROM project_queue_policy_facet_heads")) return [{ safe_body: value.policy }];
    if (sql.includes("FROM sla_clock_heads head") && sql.includes("head.goal=$4")) {
      return params[3] === value.transition.goal ? [{ public_transition: value.transition }] : [];
    }
    if (sql.includes("FROM project_queue_policy_facet_revisions") && !sql.includes("heads"))
      return [{ safe_body: value.policy }];
    if (sql.includes("FROM workspace_business_calendar_revisions"))
      return [
        {
          calendar_key: value.calendar.calendarKey,
          calendar_id: value.calendar.calendarId,
          workspace_id: value.calendar.workspaceId,
          revision_number: value.calendar.revision,
          time_zone: value.calendar.timeZone,
          valid_from: value.calendar.validFrom,
          valid_through: value.calendar.validThrough,
          weekly_intervals: value.calendar.weeklyIntervals,
          date_overrides: value.calendar.dateOverrides,
          dst_algorithm_ref: value.calendar.dstAlgorithmRef,
          dst_rules: value.calendar.dstRules,
          source_kind: value.calendar.sourceKind,
          source_ref: value.calendar.sourceRef,
          source_hash: value.calendar.sourceHash,
          owner_principal_id: value.calendar.ownerPrincipalId,
          effective_from: value.calendar.effectiveFrom,
          published_at: value.calendar.publishedAt,
          published_by: value.calendar.publishedByPrincipalId,
          semantic_hash: value.calendar.semanticHash,
        },
      ];
    if (sql.includes("FROM sla_clock_segments segment"))
      return [
        {
          segment_id: value.segment.segmentRef.sourceId,
          revision_number: value.segment.segmentRef.sourceVersion,
          semantic_hash: value.segment.segmentRef.semanticHash,
          sla_clock_id: value.segment.slaClockId,
          clock_cycle: value.segment.clockCycle,
          ordinal: value.segment.ordinal,
          state: value.segment.state,
          started_at: value.segment.startedAt,
          ended_at: null,
          business_seconds: 0,
          start_transition: value.transition,
          end_transition: null,
        },
      ];
    if (sql.includes("SELECT binding.freshness_state")) return [{ freshness_state: "CURRENT" }];
    return [];
  });
  const transaction = vi.fn(
    async (_isolation: string, work: (manager: { query: typeof query }) => Promise<unknown>) =>
      await work({ query }),
  );
  return { source: { query, transaction } as never, query, transaction, provider, model, value };
}

describe("US5 SLA GET security and read behavior", () => {
  it("uses one server-only asOf, a strong ETag and no provider/model path", async () => {
    vi.stubEnv("AWP_ENVIRONMENT", "LOCAL");
    vi.stubEnv("AWP_RUNTIME_PROFILE", "test");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T10:00:00.000Z"));
    try {
      const test = dataSource();
      const controller = new QueueController(
        test.source,
        createLocalQueueHttpAuthority(test.source),
      );
      const headers = new Map<string, string>();
      const result = await controller.sla(
        { localPersonaKey: "lead.alpha" } as never,
        policyIds.workspace,
        policyIds.projectA,
        test.value.transition.workItemId,
        { setHeader: (name: string, header: string) => headers.set(name, header) },
      );
      expect(result).toHaveLength(2);
      expect(new Set(result.map(({ asOf }) => asOf))).toEqual(
        new Set(["2026-09-07T10:00:00.000Z"]),
      );
      expect(result[0]).toMatchObject({
        clockRevisionRef: test.value.transition.clockRevisionRef,
        clockState: "RUNNING",
      });
      expect(headers.get("ETag")).toMatch(/^"sha256:[a-f0-9]{64}"$/u);
      expect(test.transaction).toHaveBeenCalledWith("REPEATABLE READ", expect.any(Function));
      expect(test.provider).not.toHaveBeenCalled();
      expect(test.model).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });

  it("returns the same 404 shape for forbidden scope and an absent Work Item", async () => {
    vi.stubEnv("AWP_ENVIRONMENT", "LOCAL");
    vi.stubEnv("AWP_RUNTIME_PROFILE", "test");
    try {
      const absent = dataSource(false);
      const absentController = new QueueController(
        absent.source,
        createLocalQueueHttpAuthority(absent.source),
      );
      const response = { setHeader: vi.fn() };
      const absentError = await absentController
        .sla(
          { localPersonaKey: "lead.alpha" } as never,
          policyIds.workspace,
          policyIds.projectA,
          id("99"),
          response,
        )
        .catch((error: unknown) => error);

      const forbidden = dataSource(true);
      const forbiddenController = new QueueController(
        forbidden.source,
        createLocalQueueHttpAuthority(forbidden.source),
      );
      const forbiddenError = await forbiddenController
        .sla(
          { localPersonaKey: "worker.local" } as never,
          policyIds.workspace,
          policyIds.projectA,
          id("99"),
          response,
        )
        .catch((error: unknown) => error);
      expect((absentError as { getStatus(): number }).getStatus()).toBe(404);
      expect((forbiddenError as { getStatus(): number }).getStatus()).toBe(404);
      expect((absentError as Error).message).toBe((forbiddenError as Error).message);
      expect(absent.query).toHaveBeenCalledWith(
        expect.stringContaining("SELECT id FROM work_items"),
        [policyIds.workspace, policyIds.projectA, id("99")],
      );
      expect(forbidden.query).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("exposes registered Workspace policy and exact calendar reads without Project allocations", async () => {
    vi.stubEnv("AWP_ENVIRONMENT", "LOCAL");
    vi.stubEnv("AWP_RUNTIME_PROFILE", "test");
    try {
      const value = fixture();
      const view = projectQueuePolicyNeutralView(queuePolicyFixture("ENFORCED", value.calendar), {
        id: id("40"),
        version: 1,
      });
      const query = vi.fn(async (sql: string) => {
        if (sql.includes("JOIN workspace_memberships m")) return [{ id: id("20") }];
        if (sql.includes("FROM workspace_queue_policy_view_heads")) return [{ safe_body: view }];
        if (sql.includes("SELECT calendar_id,revision_number,semantic_hash"))
          return [
            {
              calendar_id: value.calendar.calendarId,
              revision_number: value.calendar.revision,
              semantic_hash: value.calendar.semanticHash,
            },
          ];
        if (sql.includes("FROM workspace_business_calendar_revisions"))
          return [
            {
              calendar_key: value.calendar.calendarKey,
              calendar_id: value.calendar.calendarId,
              workspace_id: value.calendar.workspaceId,
              revision_number: value.calendar.revision,
              time_zone: value.calendar.timeZone,
              valid_from: value.calendar.validFrom,
              valid_through: value.calendar.validThrough,
              weekly_intervals: value.calendar.weeklyIntervals,
              date_overrides: value.calendar.dateOverrides,
              dst_algorithm_ref: value.calendar.dstAlgorithmRef,
              dst_rules: value.calendar.dstRules,
              source_kind: value.calendar.sourceKind,
              source_ref: value.calendar.sourceRef,
              source_hash: value.calendar.sourceHash,
              owner_principal_id: value.calendar.ownerPrincipalId,
              effective_from: value.calendar.effectiveFrom,
              published_at: value.calendar.publishedAt,
              published_by: value.calendar.publishedByPrincipalId,
              semantic_hash: value.calendar.semanticHash,
            },
          ];
        return [];
      });
      const controller = new QueuePoliciesController(
        { query } as never,
        createLocalQueueHttpAuthority({ query } as never),
      );
      const headers = new Map<string, string>();
      const response = { setHeader: (name: string, header: string) => headers.set(name, header) };
      const policy = await controller.policy(
        { localPersonaKey: "lead.alpha" } as never,
        policyIds.workspace,
        response,
      );
      expect(policy).toMatchObject({
        schemaVersion: "queue-policy-view@1.0.0",
        workspaceId: policyIds.workspace,
      });
      expect(policy).not.toHaveProperty("projectEntries");
      expect(headers.get("ETag")).toBe(`"${view.policyViewRef.semanticHash}"`);
      const calendar = await controller.calendar(
        { localPersonaKey: "lead.alpha" } as never,
        policyIds.workspace,
        id("41"),
        response,
      );
      expect(calendar).toEqual(value.calendar);
      expect(headers.get("ETag")).toBe(`"${value.calendar.semanticHash}"`);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
