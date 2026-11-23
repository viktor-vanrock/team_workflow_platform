import { describe, expect, it, vi } from "vitest";

import { assertNoAuthoritativeClientFields } from "../../../packages/platform-runtime-nest/src/auth/workspace-context.ts";
import { CorrelationMiddleware } from "../../../packages/platform-runtime-nest/src/http/correlation.middleware.ts";

describe("HTTP request trust boundary", () => {
  it.each([
    "actor",
    "actorId",
    "principalId",
    "roles",
    "entitlements",
    "authorizationBasis",
    "workspaceId",
    "projectId",
  ])("rejects client-supplied authoritative field %s", (field) => {
    expect(() => assertNoAuthoritativeClientFields({ [field]: "forged" })).toThrow(/forbidden/u);
  });
  it("preserves safe correlation and causation IDs", () => {
    const request = {
      headers: {
        "x-correlation-id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "x-causation-id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
    };
    const setHeader = vi.fn();
    const next = vi.fn();
    new CorrelationMiddleware().use(request, { setHeader }, next);
    expect(request).toMatchObject({
      correlationId: request.headers["x-correlation-id"],
      causationId: request.headers["x-causation-id"],
    });
    expect(setHeader).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenCalledOnce();
  });
});
