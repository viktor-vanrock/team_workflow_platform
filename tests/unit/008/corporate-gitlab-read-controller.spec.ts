import "../../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { describe, expect, it, vi } from "vitest";

import {
  METHOD_METADATA,
  PATH_METADATA,
} from "../../../apps/api/node_modules/@nestjs/common/constants.js";
import { RequestMethod } from "../../../apps/api/node_modules/@nestjs/common/index.js";
import { CorporateAutomationReadController } from "../../../apps/api/src/extensions/gitlab-automation/corporate-automation-read.controller.ts";
import { QaSessionGuard } from "../../../apps/api/src/extensions/qa-api-authorization.ts";
import { TypeOrmGitLabAutomationAttemptQuery } from "../../../packages/runtime-composition/src/gitlab/automation-attempt-query.ts";

describe("corporate GitLab automation reads", () => {
  it("exposes only GET routes, without a launch or confirmation endpoint", () => {
    const prototype = CorporateAutomationReadController.prototype;
    const handlers = Object.getOwnPropertyNames(prototype).filter((name) => name !== "constructor");
    expect(handlers).toEqual([
      "list",
      "detail",
      "statusHistory",
      "result",
      "retryDecision",
      "artifacts",
    ]);
    for (const name of handlers) {
      const handler = Object.getOwnPropertyDescriptor(prototype, name)?.value as object;
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
      expect(Reflect.getMetadata(PATH_METADATA, handler)).not.toBe("launch-confirmation");
    }
  });
  it("rejects unverified requests before reading the database", async () => {
    const query = vi.fn();
    const controller = new CorporateAutomationReadController({ query } as never);
    await expect(
      controller.list({ headers: {}, method: "GET" }, "w", "p", "s", {
        setHeader: vi.fn(),
        status: vi.fn(),
      } as never),
    ).rejects.toThrow("QA_IDENTITY_REQUIRED");
    expect(query).not.toHaveBeenCalled();
  });
  it("has no launch service in the read-only query", async () => {
    const query = new TypeOrmGitLabAutomationAttemptQuery({} as never);
    await expect(
      query.launchConfirmation({ workspaceId: "w", projectId: "p" }, "s"),
    ).rejects.toThrow("GITLAB_AUTOMATION_LAUNCH_NOT_CONFIGURED");
    await expect(query.launch({} as never)).rejects.toThrow(
      "GITLAB_AUTOMATION_LAUNCH_NOT_CONFIGURED",
    );
  });
  it("rejects a verified identity without the required permission", async () => {
    const query = vi.fn();
    const request = { headers: {}, method: "GET" };
    const authorizer = vi.fn().mockRejectedValue(new Error("DENIED"));
    const guard = new QaSessionGuard({ authenticate: vi.fn().mockResolvedValue(authorizer) });
    await guard.canActivate({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => undefined,
    } as never);
    const controller = new CorporateAutomationReadController({ query } as never);
    await expect(controller.result(request, "w", "p", "s", "a")).rejects.toThrow("QA_SCOPE_DENIED");
    expect(authorizer).toHaveBeenCalledWith(
      expect.objectContaining({
        permission: "qa.automation.read",
        scope: { kind: "PROJECT", workspaceId: "w", projectId: "p" },
      }),
    );
    expect(query).not.toHaveBeenCalled();
  });
  it("returns a result only after checking the corporate project permission", async () => {
    const request = { headers: {}, method: "GET" };
    const authorizer = vi.fn().mockResolvedValue({
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
    const guard = new QaSessionGuard({ authenticate: vi.fn().mockResolvedValue(authorizer) });
    await guard.canActivate({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => undefined,
    } as never);
    const result = vi
      .spyOn(TypeOrmGitLabAutomationAttemptQuery.prototype, "result")
      .mockResolvedValueOnce({ outcome: "INCOMPLETE" } as never);
    try {
      const controller = new CorporateAutomationReadController({} as never);
      await expect(controller.result(request, "w", "p", "s", "a")).resolves.toEqual({
        outcome: "INCOMPLETE",
      });
      expect(authorizer).toHaveBeenCalledWith(
        expect.objectContaining({ permission: "qa.automation.read" }),
      );
      expect(result).toHaveBeenCalledWith({ workspaceId: "w", projectId: "p" }, "s", "a");
    } finally {
      result.mockRestore();
    }
  });
  it("passes the server-authorized classification ceiling to artifact reads", async () => {
    const request = { headers: {}, method: "GET" };
    const guard = new QaSessionGuard({
      authenticate: vi.fn().mockResolvedValue(async () => ({
        scope: { kind: "PROJECT", workspaceId: "w", projectId: "p" },
        actor: { kind: "HUMAN", principalId: "human", issuer: "issuer", subject: "subject" },
        basis: {
          kind: "PROJECT",
          membershipRef: { id: "membership", version: 1 },
          roleAssignmentRefs: [{ id: "role", version: 1 }],
          entitlementRefs: [{ id: "entitlement", version: 1 }],
        },
        classificationCeiling: "RESTRICTED",
      })),
    });
    await guard.canActivate({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => undefined,
    } as never);
    const artifacts = vi
      .spyOn(TypeOrmGitLabAutomationAttemptQuery.prototype, "sessionArtifacts")
      .mockResolvedValueOnce([]);
    try {
      await expect(
        new CorporateAutomationReadController({} as never).artifacts(request, "w", "p", "s"),
      ).resolves.toEqual([]);
      expect(artifacts).toHaveBeenCalledWith(
        { workspaceId: "w", projectId: "p" },
        "s",
        "RESTRICTED",
      );
    } finally {
      artifacts.mockRestore();
    }
  });
});
