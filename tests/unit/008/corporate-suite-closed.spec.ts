import "../../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { describe, expect, it, vi } from "vitest";

import { CorporateSuiteClosedController } from "../../../apps/api/src/extensions/gitlab-automation/corporate-suite-closed.controller.ts";
import { QaSessionGuard } from "../../../apps/api/src/extensions/qa-api-authorization.ts";

describe("corporate Suite remains closed", () => {
  it("requires verified project access and returns the explicit reason without issuing commands", async () => {
    const query = vi.fn();
    const request = { headers: {}, method: "GET" };
    const authorize = vi.fn().mockResolvedValue({
      scope: { kind: "PROJECT", workspaceId: "w", projectId: "p" },
      actor: { kind: "HUMAN", principalId: "human", issuer: "issuer", subject: "subject" },
      basis: {
        kind: "PROJECT",
        membershipRef: { id: "membership", version: 1 },
        roleAssignmentRefs: [{ id: "role", version: 1 }],
        entitlementRefs: [{ id: "entitlement", version: 1 }],
      },
      classificationCeiling: "INTERNAL",
    });
    const guard = new QaSessionGuard({ authenticate: vi.fn().mockResolvedValue(authorize) });
    await guard.canActivate({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => undefined,
    } as never);
    const controller = new CorporateSuiteClosedController({ query } as never);
    for (const action of [
      controller.availability.bind(controller),
      controller.validate.bind(controller),
      controller.publish.bind(controller),
    ]) {
      await expect(action(request, "w", "p")).rejects.toThrow(
        "Недоступно: нет подтверждений runner, network и no-deploy",
      );
    }
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ permission: "qa.automation.read" }),
    );
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ permission: "qa.automation.suite.manage" }),
    );
    expect(query).not.toHaveBeenCalled();
  });
  it("denies an unauthenticated request before reporting status", async () => {
    const controller = new CorporateSuiteClosedController({} as never);
    await expect(controller.availability({ headers: {}, method: "GET" }, "w", "p")).rejects.toThrow(
      "QA_IDENTITY_REQUIRED",
    );
  });
});
