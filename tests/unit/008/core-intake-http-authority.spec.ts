import "../../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { describe, expect, it, vi } from "vitest";

import { createCoreIntakeHttpApis } from "../../../apps/api/src/extensions/core-intake-http-api.ts";
import { QaSessionGuard } from "../../../apps/api/src/extensions/qa-api-authorization.ts";

describe("008 generic intake HTTP authorization", () => {
  it("denies every query and command before accessing data or a runtime without a verified request", async () => {
    const query = vi.fn();
    const transaction = vi.fn();
    const resolve = vi.fn();
    const api = createCoreIntakeHttpApis({ query, transaction } as never, { resolve });
    const scope = {
      workspaceId: "w",
      projectId: "p",
      request: { headers: {}, localPersonaKey: "admin.platform" },
    };
    const calls = [
      () => api.drafts.list({ ...scope, draftId: "d" }),
      () => api.drafts.revise({ ...scope, draftId: "d", body: {} }),
      () => api.drafts.validate({ ...scope, draftId: "d", body: {} }),
      () => api.candidates.list(scope),
      () => api.candidates.get({ ...scope, candidateId: "c" }),
      () => api.candidates.decide({ ...scope, candidateId: "c", body: {} }),
      () => api.agents.get({ ...scope, runId: "r" }),
      () => api.agents.start({ ...scope, body: {} }),
      () => api.notifications.get({ ...scope, notificationIntentId: "n" }),
    ];
    for (const call of calls) await expect(call()).rejects.toThrow("QA_IDENTITY_REQUIRED");
    expect(query).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("rechecks scoped permissions for each call and does not reuse a previous allow after revocation", async () => {
    const query = vi.fn(async () => []);
    const resolve = vi.fn();
    const api = createCoreIntakeHttpApis({ query } as never, { resolve });
    const request = { headers: {}, method: "GET" };
    let revoked = false;
    const authorize = vi.fn(async (input) => {
      if (revoked || input.scope.projectId !== "p") throw new Error("PRIVATE_DENIAL");
      return {
        actor: {
          kind: "HUMAN" as const,
          principalId: "human",
          issuer: "issuer",
          subject: "subject",
        },
        scope: input.scope,
        classificationCeiling: "INTERNAL" as const,
        basis: {
          kind: "PROJECT" as const,
          policyVersion: "current",
          membershipRef: { id: "m", version: 1 },
          roleAssignmentRefs: [{ id: "r", version: 1 }],
          entitlementRefs: [{ id: "e", version: 1 }],
          skillContext: "NOT_APPLICABLE" as const,
        },
      };
    });
    await new QaSessionGuard({ authenticate: async () => authorize }).canActivate({
      switchToHttp: () => ({ getRequest: () => request }),
    } as never);
    expect(
      await api.drafts.list({ workspaceId: "w", projectId: "p", draftId: "d", request }),
    ).toEqual({ items: [] });
    expect(authorize).toHaveBeenLastCalledWith({
      scope: { kind: "PROJECT", workspaceId: "w", projectId: "p" },
      permission: "work-item.read",
      operationClass: "READ",
    });
    await expect(
      api.drafts.list({ workspaceId: "w", projectId: "other", draftId: "d", request }),
    ).rejects.toThrow("QA_SCOPE_DENIED");
    revoked = true;
    await expect(
      api.drafts.list({ workspaceId: "w", projectId: "p", draftId: "d", request }),
    ).rejects.toThrow("QA_SCOPE_DENIED");
    expect(query).toHaveBeenCalledTimes(1);
  });
});
