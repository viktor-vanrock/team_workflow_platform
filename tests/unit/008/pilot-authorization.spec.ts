import { expect, it, vi } from "vitest";

import {
  AuthorizedProjectQueryToken,
  defaultClassificationCatalog,
  type WorkspaceContext,
} from "../../../packages/platform-core/src/index.ts";
import {
  AuthorizationContributionRegistry,
  ResourceClassificationResolver,
} from "../../../packages/platform-runtime-nest/src/auth/authorization-contributions.ts";
import { assertPilotReportScope } from "../../../packages/platform-runtime-nest/src/auth/pilot-authorization.ts";

it("denies a multi-project report before invoking any query when one project is unauthorized", () => {
  const token = AuthorizedProjectQueryToken.issue({
    workspaceId: "w1",
    principalId: "person",
    permission: "pilot.report.read",
    issuedAt: new Date(),
    projects: [
      {
        projectId: "p1",
        classificationCeilingRank: 20,
        operationalState: "ACTIVE",
        entitlementRef: { id: "e1", version: 1 },
      },
    ],
  });
  const query = vi.fn();
  expect(() => {
    assertPilotReportScope(token, "w1", ["p1", "p2"]);
    query();
  }).toThrow("PROJECT_RESOURCE_NOT_AVAILABLE");
  expect(query).not.toHaveBeenCalled();
  expect(() => assertPilotReportScope(token, "w2", ["p1"])).toThrow(
    "PROJECT_RESOURCE_NOT_AVAILABLE",
  );
  expect(() => assertPilotReportScope(token, "w1", ["p1"])).not.toThrow();
});

it("registers confidential pilot classification and deny-only project/human contributions", async () => {
  const registry = new AuthorizationContributionRegistry();
  const context: WorkspaceContext = {
    actor: { kind: "SERVICE", principalId: "s1", serviceKey: "reporter" },
    scope: { kind: "PROJECT", workspaceId: "w1", projectId: "p1" },
    correlationId: "c",
    causationId: "c",
  };
  const request = {
    context,
    operation: "PilotController.replayDecision",
    permission: "pilot.replay.decide",
    resourceClassification: defaultClassificationCatalog.reference("CONFIDENTIAL"),
  };
  expect((await registry.authorize(request)).allowed).toBe(false);
  expect(
    (
      await registry.authorize({
        ...request,
        permission: "pilot.report.read",
        operation: "PilotController.metrics",
      })
    ).allowed,
  ).toBe(true);
  expect(
    (
      await registry.authorize({
        ...request,
        permission: "pilot.report.read",
        operation: "Unknown.bypass",
      })
    ).allowed,
  ).toBe(false);
  expect(
    await new ResourceClassificationResolver().resolve({
      permission: "pilot.report.read",
      operation: "PilotController.metrics",
    }),
  ).toEqual({ key: "CONFIDENTIAL", rank: 30 });
});
