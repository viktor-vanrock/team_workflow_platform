import { describe, expect, it, vi } from "vitest";

import type { WorkspaceContext } from "../../packages/platform-core/src/index.ts";
import {
  AuthorizeUseCaseInterceptor,
  REQUIRED_PERMISSION,
} from "../../packages/platform-runtime-nest/src/auth/authorize-use-case.interceptor.ts";
import {
  assertNoAuthoritativeClientFields,
  WorkspaceContextStore,
} from "../../packages/platform-runtime-nest/src/auth/workspace-context.ts";

const executionContext = {
  switchToHttp: () => ({
    getRequest: () => ({ params: { workspaceId: "workspace-a", projectId: "project-alpha" } }),
  }),
  getHandler: () => directApiHandler,
  getClass: () => DirectApiSurface,
} as unknown as Parameters<AuthorizeUseCaseInterceptor["intercept"]>[0];
class DirectApiSurface {}
function directApiHandler() {
  return undefined;
}
const reflector = {
  getAllAndOverride: (key: symbol) => (key === REQUIRED_PERMISSION ? "work-item.read" : undefined),
} as unknown as ConstructorParameters<typeof AuthorizeUseCaseInterceptor>[0];
const context: WorkspaceContext = {
  actor: { kind: "HUMAN", principalId: "viewer-beta", issuer: "issuer", subject: "viewer-beta" },
  scope: { kind: "PROJECT", workspaceId: "workspace-a", projectId: "project-alpha" },
  correlationId: "correlation",
  causationId: "causation",
};

describe("browser/API isolation without frontend trust", () => {
  it("denies a direct API call even when a client bypasses hidden UI", async () => {
    const frontend = { workItemLinkVisible: false };
    expect(frontend.workItemLinkVisible).toBe(false);

    const contexts = new WorkspaceContextStore();
    const authorization = {
      authorize: vi.fn(async () => ({ allowed: false, reason: "NO_ENTITLEMENT" as const })),
    };
    const handle = vi.fn(() => ({ foreignProjectSecret: true }));
    const next = { handle } as unknown as Parameters<AuthorizeUseCaseInterceptor["intercept"]>[1];
    const interceptor = new AuthorizeUseCaseInterceptor(reflector, contexts, authorization);

    await contexts.run(context, async () => {
      await expect(interceptor.intercept(executionContext, next)).rejects.toMatchObject({
        response: { reason: "NO_ENTITLEMENT" },
      });
    });
    expect(authorization.authorize).toHaveBeenCalledWith(context, "work-item.read", {
      key: "INTERNAL",
      rank: 10,
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it("allows the same route only after backend authorization", async () => {
    const contexts = new WorkspaceContextStore();
    const authorization = {
      authorize: vi.fn(async () => ({ allowed: true, reason: "ALLOW" as const })),
    };
    const handle = vi.fn(() => ({ id: "own-work-item" }));
    const next = { handle } as unknown as Parameters<AuthorizeUseCaseInterceptor["intercept"]>[1];
    const interceptor = new AuthorizeUseCaseInterceptor(reflector, contexts, authorization);

    const result = await contexts.run(
      context,
      async () => await interceptor.intercept(executionContext, next),
    );
    expect(result).toEqual({ id: "own-work-item" });
    expect(handle).toHaveBeenCalledOnce();
  });

  it("rejects client-supplied role, entitlement and scope fields", () => {
    expect(() =>
      assertNoAuthoritativeClientFields({ role: "owner", projectId: "project-alpha" }),
    ).toThrow("Client-supplied authoritative fields");
    expect(() => assertNoAuthoritativeClientFields({ entitlement: "project-alpha" })).toThrow(
      "Client-supplied authoritative fields",
    );
  });
});
