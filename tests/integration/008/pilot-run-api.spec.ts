import "../../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { describe, expect, it, vi } from "vitest";

import { Module } from "../../../apps/api/node_modules/@nestjs/common/index.js";
import { NestFactory } from "../../../apps/api/node_modules/@nestjs/core/index.js";
import type { NestExpressApplication } from "../../../apps/api/node_modules/@nestjs/platform-express/index.js";
import {
  PILOT_EVIDENCE_IMPORT,
  PILOT_READINESS_QUERY,
  PILOT_RUN_SERVICE,
  PilotController,
  type PilotRunApiService,
} from "../../../apps/api/src/extensions/pilot/pilot.controller.ts";
import {
  QA_DATA_SOURCE,
  QA_HTTP_IDENTITY,
  QaSessionGuard,
} from "../../../apps/api/src/extensions/qa-api-authorization.ts";

@Module({})
class PilotRunProofModule {}
const workspaceId = "10000000-0000-4000-8000-000000000001",
  projectId = "20000000-0000-4000-8000-000000000001",
  actorId = "30000000-0000-4000-8000-000000000001";
const request = (origin: string, path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("authorization", "Bearer pilot-operator");
  headers.set("content-type", "application/json");
  headers.set("connection", "close");
  return fetch(`${origin}/api/v1/workspaces/${workspaceId}/projects/${projectId}/pilot/${path}`, {
    ...init,
    headers,
  });
};

describe("Feature 008 scoped pilot run API", () => {
  it("authorizes before lookup, validates bounded inputs and supplies server actor identity", async () => {
    const runOperation = vi.fn(async (input: Parameters<PilotRunApiService["run"]>[0]) => ({
      ...input,
      stage: "SHADOW",
    }));
    const metricsOperation = vi.fn(async (input: Parameters<PilotRunApiService["metrics"]>[0]) => ({
      ...input,
      items: [],
    }));
    const protocolOperation = vi.fn(
      async (input: Parameters<PilotRunApiService["measurementProtocol"]>[0]) => input,
    );
    const baselineOperation = vi.fn(
      async (input: Parameters<PilotRunApiService["baselineImport"]>[0]) => input,
    );
    const reviewOperation = vi.fn(
      async (input: Parameters<PilotRunApiService["review"]>[0]) => input,
    );
    const service: PilotRunApiService = {
      run: runOperation,
      metrics: metricsOperation,
      measurementProtocol: protocolOperation,
      baselineImport: baselineOperation,
      review: reviewOperation,
    };
    let app: NestExpressApplication | undefined;
    try {
      app = await NestFactory.create<NestExpressApplication>(
        {
          module: PilotRunProofModule,
          controllers: [PilotController],
          providers: [
            QaSessionGuard,
            { provide: QA_DATA_SOURCE, useValue: {} },
            { provide: PILOT_EVIDENCE_IMPORT, useValue: {} },
            { provide: PILOT_READINESS_QUERY, useValue: {} },
            { provide: PILOT_RUN_SERVICE, useValue: service },
            {
              provide: QA_HTTP_IDENTITY,
              useValue: {
                authenticate: async (context: {
                  switchToHttp(): { getRequest(): { headers: Record<string, string> } };
                }) => {
                  if (
                    context.switchToHttp().getRequest().headers.authorization !==
                    "Bearer pilot-operator"
                  )
                    throw new Error("UNAUTHENTICATED");
                  return async ({
                    scope,
                  }: {
                    scope: { kind: "PROJECT"; workspaceId: string; projectId: string };
                  }) => {
                    if (scope.workspaceId !== workspaceId || scope.projectId !== projectId)
                      throw new Error("SCOPE_DENIED");
                    return {
                      actor: {
                        kind: "HUMAN" as const,
                        principalId: actorId,
                        issuer: "urn:pilot-test",
                        subject: "pilot.operator",
                        displayName: "Pilot operator",
                      },
                      basis: {
                        kind: "PROJECT" as const,
                        membershipRef: "membership:1",
                        roleAssignmentRefs: ["role:1"],
                        entitlementRefs: ["entitlement:1"],
                      },
                      classificationCeiling: "CONFIDENTIAL" as const,
                      scope,
                    };
                  };
                },
              },
            },
          ],
        },
        { logger: false, abortOnError: false },
      );
      await app.listen(0, "127.0.0.1");
      const origin = await app.getUrl();
      const run = await request(origin, "runs/run-1");
      expect(run.status).toBe(200);
      expect(run.headers.get("cache-control")).toBe("private, no-store");
      expect(runOperation).toHaveBeenCalledTimes(1);
      expect(
        (
          await fetch(
            `${origin}/api/v1/workspaces/${workspaceId}/projects/${projectId}/pilot/runs/run-1`,
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await fetch(
            `${origin}/api/v1/workspaces/${workspaceId}/projects/20000000-0000-4000-8000-000000000002/pilot/runs/run-1`,
            { headers: { authorization: "Bearer pilot-operator", connection: "close" } },
          )
        ).status,
      ).toBe(403);
      expect(runOperation).toHaveBeenCalledTimes(1);

      const badMetrics = await request(origin, "runs/run-1/metrics?protocolHash=wrong&limit=999");
      expect(badMetrics.status).toBe(400);
      expect(metricsOperation).not.toHaveBeenCalled();
      const protocolHash = `sha256:${"a".repeat(64)}`;
      expect(
        (await request(origin, `runs/run-1/metrics?protocolHash=${protocolHash}&limit=100`)).status,
      ).toBe(200);
      expect(metricsOperation).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100, protocolHash }),
      );

      const baselineBody = {
        requestKey: "baseline-request",
        expectedVersion: 1,
        protocolHash,
        observations: [],
        spotCheckRefs: [],
      };
      expect(
        (
          await request(origin, "runs/run-1/baseline-imports", {
            method: "POST",
            body: JSON.stringify({ ...baselineBody, actorId: "client-forgery" }),
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await request(origin, "runs/run-1/baseline-imports", {
            method: "POST",
            body: JSON.stringify(baselineBody),
          })
        ).status,
      ).toBe(201);
      expect(baselineOperation).toHaveBeenCalledWith(
        expect.objectContaining({ actorId, workspaceId, projectId, runId: "run-1" }),
      );

      const reviewBody = {
        requestKey: "review-request",
        expectedVersion: 2,
        reportHash: protocolHash,
        decision: "INSUFFICIENT_DATA",
        reason: "Missing observed pilot window.",
      };
      expect(
        (
          await request(origin, "runs/run-1/reviews", {
            method: "POST",
            body: JSON.stringify(reviewBody),
          })
        ).status,
      ).toBe(201);
      expect(reviewOperation).toHaveBeenCalledWith(
        expect.objectContaining({ actorId, body: reviewBody }),
      );
    } finally {
      await app?.close();
    }
  }, 30_000);
});
