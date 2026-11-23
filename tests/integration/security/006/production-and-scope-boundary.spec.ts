import { describe, expect, it, vi } from "vitest";

import { exactQueueActionHttpReceipt } from "../../../../apps/api/src/extensions/queue/queue-http-receipts.ts";
import { loadEnvironment } from "../../../../packages/runtime-composition/src/config/environment.ts";
import { ProjectQueueQueryService } from "../../../../packages/runtime-composition/src/queue/portfolio-query.ts";
import {
  assertConnectionEndpointAllowed,
  assertEffectEndpointAllowed,
  assertQueueLocalProductionBoundary,
  localContainerEgressPolicy,
} from "../../../../packages/runtime-composition/src/security/local-security.ts";

const digest = (digit: string): string => `sha256:${digit.repeat(64)}`;

describe("Feature 006 production and scope boundary", () => {
  it("reauthorizes before projection, aggregation, metrics or provider access after membership/role/classification revocation", async () => {
    const projection = { read: vi.fn(), list: vi.fn() };
    const provider = { read: vi.fn() };
    const metrics = { observe: vi.fn() };
    const service = new ProjectQueueQueryService({
      authorize: vi.fn().mockResolvedValue(false),
      authorizedProjects: vi.fn().mockResolvedValue([]),
      projection,
      provider,
      metrics,
    });

    const error = await service
      .item({
        workspaceId: "workspace-a",
        projectId: "project-c-forbidden",
        workItemId: "hidden",
        principalId: "revoked",
      })
      .catch((caught: unknown) => caught);
    expect((error as Error).message).toBe("QUEUE_ITEM_NOT_FOUND");
    expect(projection.read).not.toHaveBeenCalled();
    expect(projection.list).not.toHaveBeenCalled();
    expect(provider.read).not.toHaveBeenCalled();
    expect(metrics.observe).not.toHaveBeenCalled();
    expect(JSON.stringify(error)).not.toMatch(
      /project-c-forbidden|hidden|membership|role|classification/u,
    );
  });

  it("keeps public action receipts closed and redacts replay, authorization and global-capacity witnesses", () => {
    const receipt = exactQueueActionHttpReceipt({
      actionId: "action-1",
      actionKind: "SERVICE_CLASS_EXPEDITE",
      state: "CONSUMED",
      resourceVersion: 2,
      publicIntentHash: digest("a"),
      approvalRequired: false,
      resultRef: {
        sourceType: "CAPACITY_ADMISSION_DECISION",
        sourceId: "decision-1",
        sourceVersion: 1,
        semanticHash: digest("b"),
      },
      requestedAt: "2026-09-03T08:00:00.000Z",
      replayed: true,
      authorizationBasis: { membershipRef: "secret" },
      capacityHead: { hiddenProjectCount: 3 },
    } as never);
    expect(Object.keys(receipt).sort()).toEqual(
      [
        "actionId",
        "actionKind",
        "approvalRequired",
        "publicIntentHash",
        "requestedAt",
        "resourceVersion",
        "resultRef",
        "schemaVersion",
        "state",
      ].sort(),
    );
    expect(JSON.stringify(receipt)).not.toMatch(
      /replay|authorization|membership|capacityHead|hidden/u,
    );
  });

  it("denies production endpoints in the local contour and local endpoints in production before persistence or effects", () => {
    const persist = vi.fn();
    const invoke = vi.fn();
    expect(() =>
      assertConnectionEndpointAllowed("local", "https://api.github.com", persist),
    ).toThrow("LOCAL_CONNECTION_ENDPOINT_FORBIDDEN");
    expect(() => assertEffectEndpointAllowed("local", "https://jira.example.com", invoke)).toThrow(
      "LOCAL_EFFECT_ENDPOINT_FORBIDDEN",
    );
    expect(() =>
      assertConnectionEndpointAllowed("non-local", "http://localhost:5432", persist),
    ).toThrow("NON_LOCAL_CONNECTION_ENDPOINT_FORBIDDEN");
    expect(() => assertEffectEndpointAllowed("non-local", "http://mock-hub:4010", invoke)).toThrow(
      "NON_LOCAL_EFFECT_ENDPOINT_FORBIDDEN",
    );
    expect(persist).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();

    expect(localContainerEgressPolicy.canReach("api", "mock-hub")).toBe(true);
    expect(localContainerEgressPolicy.canReach("worker", "postgres")).toBe(true);
    expect(localContainerEgressPolicy.canReach("api", "api.github.com")).toBe(false);
    expect(localContainerEgressPolicy.canReach("worker", "jira.example.com")).toBe(false);
  });

  it("pins the queue CLI contour and rejects production credentials/endpoints before adapter resolution", () => {
    const exact = loadEnvironment({
      AWP_ENVIRONMENT: "LOCAL",
      AWP_RUNTIME_PROFILE: "local",
      AWP_COMPOSITION: "qa-jira-gitlab-mattermost-local",
      AWP_EXTERNAL_NETWORK_MODE: "deny",
      AWP_MOCK_HUB_URL: "http://mock-hub:4010",
      AWP_QUEUE_STATIC_CONTOUR: "true",
    } as NodeJS.ProcessEnv);
    expect(exact).toMatchObject({
      composition: "qa-jira-gitlab-mattermost-local",
      environmentScope: "LOCAL",
      externalNetworkMode: "deny",
    });
    expect(() =>
      loadEnvironment({
        AWP_ENVIRONMENT: "LOCAL",
        AWP_RUNTIME_PROFILE: "local",
        AWP_COMPOSITION: "qa-jira-gitlab-local",
        AWP_EXTERNAL_NETWORK_MODE: "deny",
        AWP_MOCK_HUB_URL: "http://mock-hub:4010",
        AWP_QUEUE_STATIC_CONTOUR: "true",
      } as NodeJS.ProcessEnv),
    ).toThrow("QUEUE_LOCAL_STATIC_CONTOUR_REQUIRED");
    expect(() =>
      assertQueueLocalProductionBoundary({ AWP_GITLAB_PRODUCTION_TOKEN: "secret" }),
    ).toThrow("QUEUE_LOCAL_PRODUCTION_AUTHORITY_FORBIDDEN");
    expect(() =>
      assertQueueLocalProductionBoundary({ AWP_GITLAB_BASE_URL: "https://gitlab.com" }),
    ).toThrow("QUEUE_LOCAL_EXTERNAL_ENDPOINT_FORBIDDEN");
    expect(() =>
      assertQueueLocalProductionBoundary({
        AWP_GITLAB_BASE_URL: "http://mock-hub:4010",
        AWP_DATABASE_URL: "postgresql://postgres:5432/awp",
      }),
    ).not.toThrow();
  });
});
