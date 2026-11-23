import assert from "node:assert/strict";

import { describe, expect, it, vi } from "vitest";

import {
  computeCapacityAccounting,
  projectSafeQueueAuthorizationWitness,
} from "../../../../packages/platform-core/src/index.ts";
import { CapacityScopeProjectionRepository } from "../../../../packages/platform-persistence-typeorm/src/index.ts";
import { policyIds } from "../../../helpers/006/policy-fixture.ts";
import { digest } from "../../../helpers/006/triage-fixture.ts";
import { fixtureJson } from "../../../support/fixture-value.ts";

describe("US4 capacity projection isolation", () => {
  it("persists exact membership and does not advance public bytes on hidden-only churn", async () => {
    const projectionId = "00000000-0000-4000-8000-000000000631";
    let head = {
      capacity_projection_id: projectionId,
      authorized_project_set_hash: "",
      current_revision_id: null as string | null,
      resource_version: 0,
    };
    const membership: string[] = [];
    let stored: Readonly<Record<string, unknown>> | undefined;
    const manager = {
      query: vi.fn(async (sql: string, parameters: readonly unknown[] = []) => {
        if (sql.includes("INSERT INTO capacity_scope_projection_heads")) {
          head.authorized_project_set_hash = String(parameters[4]);
          return [];
        }
        if (sql.includes("SELECT * FROM capacity_scope_projection_heads")) return [head];
        if (sql.includes("SELECT project_id FROM capacity_scope_projection_projects"))
          return membership.map((project_id) => ({ project_id }));
        if (sql.includes("INSERT INTO capacity_scope_projection_projects")) {
          membership.push(String(parameters[2]));
          return [];
        }
        if (sql.includes("SELECT safe_body,semantic_hash FROM capacity_scope_projection_revisions"))
          return stored ? [stored] : [];
        if (sql.includes("INSERT INTO capacity_scope_projection_revisions")) {
          stored = { safe_body: JSON.parse(String(parameters[12])), semantic_hash: parameters[13] };
          return [];
        }
        if (sql.includes("UPDATE capacity_scope_projection_heads SET current_revision_id")) {
          head = {
            ...head,
            current_revision_id: String(parameters[2]),
            resource_version: head.resource_version + 1,
          };
          return [{ resource_version: head.resource_version }];
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
    const repository = new CapacityScopeProjectionRepository(source as never);
    const accounting = computeCapacityAccounting({
      claims: [
        {
          projectId: policyIds.projectA,
          workItemId: "one",
          state: "ACTIVE",
          causes: ["MANUAL_RUNNING"],
        },
      ],
      reservations: [],
      expedites: [],
      authorizedProjectIds: [policyIds.projectA],
      policyMode: "MEASURE_ONLY",
    });
    const base = {
      workspaceId: policyIds.workspace,
      scope: {
        kind: "PROJECT" as const,
        workspaceId: policyIds.workspace,
        projectId: policyIds.projectA,
      },
      projectIds: [policyIds.projectA],
      capacityProjectionId: projectionId,
      policyFacetRef: {
        id: "00000000-0000-4000-8000-000000000632",
        version: 1,
        semanticHash: digest("policy"),
      },
      policyMode: "MEASURE_ONLY" as const,
      accounting,
      freshness: "CURRENT" as const,
    };
    const first = await repository.materializeAuthorizedProjection({
      ...base,
      capacityProjectionRevisionId: "00000000-0000-4000-8000-000000000633",
      sourceCapacityVersion: 1,
      asOf: "2026-09-03T09:00:00.000Z",
      reconciledAt: "2026-09-03T09:00:00.000Z",
    });
    expect(first.outcome).toBe("APPENDED");
    const second = await repository.materializeAuthorizedProjection({
      ...base,
      capacityProjectionRevisionId: "00000000-0000-4000-8000-000000000634",
      sourceCapacityVersion: 2,
      asOf: "2026-09-03T09:05:00.000Z",
      reconciledAt: "2026-09-03T09:05:00.000Z",
    });
    expect(second).toMatchObject({
      outcome: "NO_OP_UNCHANGED",
      snapshot: { authorizedProjectionRef: first.snapshot.authorizedProjectionRef },
    });
    expect(membership).toEqual([policyIds.projectA]);
    expect(JSON.stringify(first.snapshot)).not.toMatch(
      /capacityHead|authorizationBasis|humanCommittedSet|hidden/u,
    );
    expect(
      manager.query.mock.calls.filter(([sql]) =>
        sql.includes("INSERT INTO capacity_scope_projection_revisions"),
      ),
    ).toHaveLength(1);
  });

  it("hashes only target-Project authorization facts for a Project read", () => {
    const scope = {
      kind: "PROJECT" as const,
      workspaceId: policyIds.workspace,
      projectId: policyIds.projectA,
    };
    const first = projectSafeQueueAuthorizationWitness(
      scope,
      {
        workspaceId: policyIds.workspace,
        projectId: policyIds.projectA,
        requiredPermission: "queue.capacity.read",
        classificationDecision: "ALLOW",
        entitlementRefs: [{ id: "hidden-a" }],
      },
      "2026-09-03T09:00:00.000Z",
    );
    const changedHidden = projectSafeQueueAuthorizationWitness(
      scope,
      {
        workspaceId: policyIds.workspace,
        projectId: policyIds.projectA,
        requiredPermission: "queue.capacity.read",
        classificationDecision: "ALLOW",
        entitlementRefs: [{ id: "hidden-b" }],
      },
      "2026-09-03T09:01:00.000Z",
    );
    assert(changedHidden.scopeKind === "PROJECT");
    expect(first).toMatchObject({
      scopeKind: "PROJECT",
      projectAuthorizationFacetHash: changedHidden.projectAuthorizationFacetHash,
    });
    expect(JSON.stringify(first)).not.toMatch(/entitlementRefs|membershipRef|roleAssignmentRefs/u);
  });

  it("keeps Project and authorized-portfolio identities distinct even for the same set hash", async () => {
    const safeBody = {
      schemaVersion: "capacity-snapshot@1.0.0",
      workspaceId: policyIds.workspace,
      scope: { kind: "AUTHORIZED_PORTFOLIO", workspaceId: policyIds.workspace },
      authorizedProjectSetHash: digest([policyIds.projectA]),
      policyFacetRef: { id: "policy", version: 1, semanticHash: digest("policy") },
      policyMode: "MEASURE_ONLY",
      authorizedProjectionRef: { id: "portfolio", version: 1, semanticHash: digest("placeholder") },
      humanOccupiedCount: 0,
      reviewReservedCount: 0,
      humanCommittedCount: 0,
      forcedExternalCount: 0,
      activeExpediteCount: 0,
      claimSetHash: digest([]),
      reservationSetHash: digest([]),
      expediteSetHash: digest([]),
      limits: { state: "NOT_CONFIGURED" },
      reservationStateCounts: { held: 0, converted: 0, released: 0, coveredByClaim: 0 },
      projectFacets: [
        {
          projectId: policyIds.projectA,
          humanOccupiedCount: 0,
          reviewReservedCount: 0,
          humanCommittedCount: 0,
          forcedExternalCount: 0,
          activeExpediteCount: 0,
          policy: { state: "NOT_CONFIGURED" },
          warningState: "NOT_CONFIGURED",
        },
      ],
      freshness: "CURRENT",
      asOf: "2026-09-03T09:00:00.000Z",
      reconciledAt: "2026-09-03T09:00:00.000Z",
    } as const;
    const body = { ...safeBody } as Record<string, unknown>;
    delete body.authorizedProjectionRef;
    const stored = {
      ...safeBody,
      authorizedProjectionRef: {
        id: "portfolio",
        version: 1,
        semanticHash: digest(fixtureJson(body)),
      },
    };
    const source = {
      query: vi.fn(async (sql: string) => {
        expect(sql).toContain("scope_kind='AUTHORIZED_PORTFOLIO'");
        return [
          {
            safe_body: stored,
            semantic_hash: stored.authorizedProjectionRef.semanticHash,
            revision_number: 1,
          },
        ];
      }),
    };
    const repository = new CapacityScopeProjectionRepository(source as never);
    const found = await repository.currentAuthorizedProjection(
      {
        kind: "AUTHORIZED_PORTFOLIO",
        workspaceId: policyIds.workspace,
        authorizedProjectSetHash: digest([policyIds.projectA]),
      },
      [policyIds.projectA],
    );
    expect(found?.safe_body).toMatchObject({ scope: { kind: "AUTHORIZED_PORTFOLIO" } });
    expect(source.query).toHaveBeenCalledTimes(1);
  });
});
