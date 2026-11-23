import "../../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { describe, expect, it, vi } from "vitest";

import { createOperationalAuthorityHttpApi } from "../../../apps/api/src/extensions/operational-authority-http-api.ts";
import {
  type QaAuthorizationInput,
  QaSessionGuard,
} from "../../../apps/api/src/extensions/qa-api-authorization.ts";

describe("008 operational HTTP authority", () => {
  it("rejects all read/effect paths before invoking a handler for an unverified request", async () => {
    const handler = vi.fn();
    const source = { query: vi.fn() };
    const api = createOperationalAuthorityHttpApi(source as never, {
      projection: handler,
      conflicts: handler,
      importDiagnostics: handler,
      reconciliation: handler,
      prepareAction: handler,
      decideApproval: handler,
    });
    const scope = {
      workspaceId: "w",
      projectId: "p",
      request: { localPersonaKey: "executor.alpha" },
    };
    for (const call of [
      () => api.projection({ ...scope, workItemId: "work" }),
      () => api.conflicts({ ...scope, workItemId: "work" }),
      () => api.importDiagnostics(scope),
      () => api.reconciliation(scope, "BOUND_REFRESH"),
      () =>
        api.prepareAction({
          ...scope,
          workItemId: "work",
          operation: "request.assign",
          payload: {},
          ifMatch: "v1",
          idempotencyKey: "key",
        }),
      () => api.decideApproval({ ...scope, approvalId: "a", decision: "APPROVE" }),
    ])
      await expect(call()).rejects.toThrow("QA_IDENTITY_REQUIRED");
    expect(handler).not.toHaveBeenCalled();
    expect(source.query).not.toHaveBeenCalled();
  });
  it("requires both command and integration authority and forwards only canonical identity", async () => {
    const handler = vi.fn(async () => ({ status: "QUEUED" }));
    let integrationAllowed = false;
    const api = createOperationalAuthorityHttpApi({} as never, {
      projection: handler,
      conflicts: handler,
      importDiagnostics: handler,
      reconciliation: handler,
      prepareAction: handler,
      decideApproval: handler,
    });
    const request = { headers: {}, method: "POST", localPersonaKey: "forged" };
    const authorize = vi.fn(async (input: QaAuthorizationInput) => {
      if (input.permission === "integration.use" && !integrationAllowed) throw new Error("DENIED");
      return {
        actor: {
          kind: "HUMAN" as const,
          principalId: "canonical",
          issuer: "idp",
          subject: "subject",
        },
        scope: input.scope,
        classificationCeiling: "INTERNAL" as const,
        basis: {
          kind: "PROJECT" as const,
          policyVersion: "v1",
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
    const input = {
      workspaceId: "w",
      projectId: "p",
      request,
      workItemId: "work",
      operation: "request.assign",
      payload: {},
      ifMatch: "v1",
      idempotencyKey: "key",
    };
    await expect(api.prepareAction(input)).rejects.toThrow("QA_SCOPE_DENIED");
    expect(handler).not.toHaveBeenCalled();
    integrationAllowed = true;
    expect(await api.prepareAction(input)).toEqual({ status: "QUEUED" });
    const forwarded = handler.mock.calls[0] as unknown as [
      {
        authorizations: { actor: { principalId: string } }[];
        request?: unknown;
        actorSubject?: unknown;
      },
    ];
    expect(forwarded[0].request).toBeUndefined();
    expect(forwarded[0].actorSubject).toBeUndefined();
    expect(forwarded[0].authorizations.map((value) => value.actor.principalId)).toEqual([
      "canonical",
      "canonical",
    ]);
  });
});
