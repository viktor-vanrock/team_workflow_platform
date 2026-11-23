import { describe, expect, it } from "vitest";

import { designContractContributions } from "../../../packages/platform-contracts/src/schema-contributions.ts";
import {
  evaluateQueueAccessAxes,
  queueOperationCatalog,
} from "../../../packages/platform-core/src/work-management/queue-authorization.ts";
import { queueAuthorizationContributions } from "../../../packages/platform-runtime-nest/src/auth/authorization-contributions.ts";

const expectedOperations = Object.freeze([
  "queue.project-lane.read",
  "queue.entry.read",
  "queue.portfolio.read",
  "queue.policy.read",
  "queue.calendar.read",
  "queue.capacity.read",
  "queue.admission.read",
  "queue.sla.read",
  "queue.calendar.publish",
  "queue.policy.publish",
  "queue.service-class.set",
  "queue.order.move",
  "queue.wip-override.request",
  "queue.control.approve",
  "queue.control.reject",
  "queue.control.consume",
  "queue.manual-session.start",
  "queue.manual-session.resume",
  "queue.automated-session.launch",
  "queue.project.invalidate",
  "queue.project.rebuild",
  "queue.sla.reconcile",
  "queue.capacity.reconcile",
] as const);

describe("Feature 006 capability and authorization compatibility", () => {
  it("declares the closed queue.* operation vocabulary with exact permissions and trusted context", () => {
    expect(queueOperationCatalog.map(({ operation }) => operation).sort()).toEqual(
      [...expectedOperations].sort(),
    );
    expect(new Set(queueOperationCatalog.map(({ operation }) => operation)).size).toBe(
      expectedOperations.length,
    );
    expect(
      queueOperationCatalog.every(
        ({ permission, trustedContext }) => permission.length > 0 && trustedContext.length > 0,
      ),
    ).toBe(true);

    const serialized = JSON.stringify(queueOperationCatalog);
    for (const forbidden of [
      "queue.write",
      "queue.patch",
      "queue.admin",
      "provider.execute",
      "projectIdsFromClient",
    ]) {
      expect(serialized).not.toContain(`"${forbidden}"`);
    }
  });

  it("keeps authorization, capability and availability as independent fail-closed axes", () => {
    expect(evaluateQueueAccessAxes({ authorized: true, capable: true, available: true })).toEqual({
      allowed: true,
      reason: "ALLOWED",
    });
    expect(evaluateQueueAccessAxes({ authorized: false, capable: true, available: true })).toEqual({
      allowed: false,
      reason: "NOT_AUTHORIZED",
    });
    expect(evaluateQueueAccessAxes({ authorized: true, capable: false, available: true })).toEqual({
      allowed: false,
      reason: "CAPABILITY_UNAVAILABLE",
    });
    expect(evaluateQueueAccessAxes({ authorized: true, capable: true, available: false })).toEqual({
      allowed: false,
      reason: "ACTOR_UNAVAILABLE",
    });
  });

  it("publishes matching runtime authorization contributions without granting authority from capability", () => {
    expect(queueAuthorizationContributions.map(({ operation }) => operation).sort()).toEqual(
      [...expectedOperations].sort(),
    );
    for (const contribution of queueAuthorizationContributions) {
      const contract = queueOperationCatalog.find(
        ({ operation }) => operation === contribution.operation,
      );
      expect(contribution.permission).toBe(contract?.permission);
      expect(contribution.requiresAuthorization).toBe(true);
      expect(contribution.capabilityGrantsPermission).toBe(false);
      expect(contribution.availabilityGrantsPermission).toBe(false);
    }
  });

  it("keeps the contract contribution immutable at order 600", () => {
    const contribution = designContractContributions.find(
      ({ key }) => key === "006-queue-triage-capacity-sla",
    );
    expect(contribution).toMatchObject({
      order: 600,
      openapiDocuments: expect.arrayContaining([
        "specs/006-queue-triage-capacity-sla/contracts/openapi/queue-triage-capacity-sla-api.v1.yaml",
        "specs/006-queue-triage-capacity-sla/contracts/openapi/core-approval-api.v1.1.yaml",
      ]),
    });
    expect(Object.isFrozen(designContractContributions)).toBe(true);
  });
});
