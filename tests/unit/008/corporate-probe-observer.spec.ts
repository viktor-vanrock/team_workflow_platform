import { describe, expect, it, vi } from "vitest";
import { createCorporateProbeObserver } from "../../../packages/runtime-composition/src/pilot/corporate-probe-observer.ts";
import { integrationConfigurationHash } from "../../../packages/runtime-composition/src/onboarding/configuration-hash.ts";

describe("corporate provider probes", () => {
  it("checks the real configured Jira project but never treats read connectivity as proof of writes", async () => {
    const profile = { project: { id: "100" } },
      connection = { endpoint: "https://jira.example" };
    const profileRef = {
      id: "profile",
      version: 1,
      contentHash: integrationConfigurationHash("connector_profile", profile),
    };
    const connectionRef = {
      id: "connection",
      version: 1,
      contentHash: integrationConfigurationHash("connection", connection),
    };
    const bindingRef = { id: "binding", version: 1, contentHash: `sha256:${"a".repeat(64)}` };
    const query = vi.fn(async (sql: string) =>
      sql.includes("connector_profile_headers")
        ? [{ content: profile, content_hash: profileRef.contentHash }]
        : [{ content: connection, content_hash: connectionRef.contentHash }],
    );
    const request = vi.fn(async (_input: unknown) => ({ json: async () => ({ id: "100" }) }));
    const observe = createCorporateProbeObserver({
      source: { isInitialized: true, query },
      environment: {
        profile: "non-local",
        environmentScope: "NON_PROD",
        deployment: { workspaceId: "workspace", projectIds: ["project"] },
      },
      grants: [
        {
          binding: {
            provider: "JIRA",
            workspaceId: "workspace",
            projectId: "project",
            ref: { id: "grant" },
            profileRef,
            connectionRef,
          },
          integrationBindingRef: bindingRef,
        },
      ],
      factories: { jira: () => ({ request }) },
    } as never);
    const target = {
      workspaceId: "workspace",
      projectId: "project",
      environmentScope: "NON_PROD",
      bindingRef,
      profileRef,
      connectionRef,
      operation: "request.create",
    };
    expect(await observe(target as never, new AbortController().signal)).toEqual({
      status: "DEGRADED",
      safeIssueCodes: ["PROVIDER_CAPABILITY_UNSUPPORTED"],
    });
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      method: "GET",
      path: "/rest/api/3/project/100",
    });
  });
  it("rejects out-of-scope requests without a provider call", async () => {
    const jira = vi.fn();
    const observe = createCorporateProbeObserver({
      source: { isInitialized: true },
      environment: {
        profile: "non-local",
        environmentScope: "NON_PROD",
        deployment: { workspaceId: "workspace", projectIds: ["project"] },
      },
      grants: [],
      factories: { jira },
    } as never);
    await expect(
      observe(
        { workspaceId: "workspace", projectId: "other", environmentScope: "NON_PROD" } as never,
        new AbortController().signal,
      ),
    ).rejects.toThrow("CORPORATE_PROBE_SCOPE_DENIED");
    expect(jira).not.toHaveBeenCalled();
  });
  it("rejects changed published configuration before contacting the provider", async () => {
    const profile = { project: { id: "100" } };
    const profileRef = {
      id: "profile",
      version: 1,
      contentHash: integrationConfigurationHash("connector_profile", profile),
    };
    const connectionRef = { id: "connection", version: 1, contentHash: "connection-hash" };
    const bindingRef = { id: "binding", version: 1, contentHash: "binding-hash" };
    const jira = vi.fn();
    const observe = createCorporateProbeObserver({
      source: {
        isInitialized: true,
        query: async () => [
          { content: { project: { id: "101" } }, content_hash: profileRef.contentHash },
        ],
      },
      environment: {
        profile: "non-local",
        environmentScope: "NON_PROD",
        deployment: { workspaceId: "workspace", projectIds: ["project"] },
      },
      grants: [
        {
          binding: {
            provider: "JIRA",
            workspaceId: "workspace",
            projectId: "project",
            ref: { id: "grant" },
            profileRef,
            connectionRef,
          },
          integrationBindingRef: bindingRef,
        },
      ],
      factories: { jira },
    } as never);
    await expect(
      observe(
        {
          workspaceId: "workspace",
          projectId: "project",
          environmentScope: "NON_PROD",
          bindingRef,
          profileRef,
          connectionRef,
        } as never,
        new AbortController().signal,
      ),
    ).rejects.toThrow("CORPORATE_PROBE_CONFIGURATION_STALE");
    expect(jira).not.toHaveBeenCalled();
  });
});
