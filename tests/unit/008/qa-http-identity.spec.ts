import "../../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { describe, expect, it } from "vitest";

import {
  authorizeQaApi,
  QaSessionGuard,
  type QaSessionRequest,
} from "../../../apps/api/src/extensions/qa-api-authorization.ts";
import {
  QaHermesProposalResourcesController,
  QaHermesProposalsController,
} from "../../../apps/api/src/extensions/qa-hermes-proposals.controller.ts";

describe("008 QA HTTP authority boundary", () => {
  it("does not accept a request property as verified identity", async () => {
    const source = {
      query: () => {
        throw new Error("UNAUTHORIZED_QUERY");
      },
    } as never;
    await expect(
      authorizeQaApi(
        source,
        { headers: {}, localPersonaKey: "admin.platform" } as QaSessionRequest,
        "w",
        "p",
        "work-item.read",
      ),
    ).rejects.toThrow("QA_IDENTITY_REQUIRED");
  });
  it("binds authorization to one authenticated request and rechecks each operation", async () => {
    let calls = 0;
    let denied = false;
    const guard = new QaSessionGuard({
      authenticate: async () => async (input) => {
        calls++;
        if (denied) throw new Error("REVOKED_CANARY");
        return {
          actor: { kind: "HUMAN", principalId: "human", issuer: "issuer", subject: "subject" },
          basis: {
            kind: "PROJECT",
            policyVersion: "current",
            membershipRef: { id: "m", version: 1 },
            roleAssignmentRefs: [{ id: "r", version: 1 }],
            entitlementRefs: [{ id: "e", version: 1 }],
            skillContext: "NOT_APPLICABLE",
          },
          classificationCeiling: "INTERNAL",
          scope: input.scope,
        };
      },
    });
    const request = { headers: {}, method: "POST" };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as never;
    expect(await guard.canActivate(context)).toBe(true);
    expect(await authorizeQaApi({} as never, request, "w", "p", "qa.request.create")).toMatchObject(
      { actor: { principalId: "human" } },
    );
    await expect(
      authorizeQaApi({} as never, { ...request }, "w", "p", "qa.request.create"),
    ).rejects.toThrow("QA_IDENTITY_REQUIRED");
    denied = true;
    await expect(
      authorizeQaApi({} as never, request, "w", "p", "qa.request.create"),
    ).rejects.toThrow("QA_SCOPE_DENIED");
    expect(calls).toBe(2);
  });
  it("checks all Hermes query routes before reading proposal data", async () => {
    let queries = 0;
    const source = {
      query: async () => {
        queries++;
        return [];
      },
    } as never;
    const request = { headers: {}, method: "GET" };
    const lists = new QaHermesProposalsController(source);
    const resources = new QaHermesProposalResourcesController(source);
    for (const run of [
      () => lists.triage(request, "w", "p", "WORK_ITEM", "id"),
      () => lists.plans(request, "w", "p", "id"),
      () => resources.assessment(request, "w", "p", "id"),
      () => resources.proposal(request, "w", "p", "id"),
    ]) {
      await expect(run()).rejects.toThrow("QA_IDENTITY_REQUIRED");
    }
    expect(queries).toBe(0);
  });
});
