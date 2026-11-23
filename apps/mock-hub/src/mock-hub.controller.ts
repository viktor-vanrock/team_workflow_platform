import { createHash } from "node:crypto";

import { Body, Controller, Get, Inject, Post } from "@nestjs/common";

import { operationalOpenApiPaths } from "./operational/operational.controller.ts";
import type {
  MockScenarioState,
  MockStateRepository,
} from "./persistence/mock-state.repository.ts";
import { MockScenarioError } from "./scenario-error.ts";

export { MockScenarioError } from "./scenario-error.ts";

export interface MockPublishRequest {
  readonly effectIdempotencyKey: string;
  readonly correlationId: string;
  readonly target: Readonly<{ id: string }>;
  readonly payload: unknown;
  readonly expectedExternalState: Readonly<{ mode: "MUST_NOT_EXIST" | "MAY_EXIST" | "MUST_EXIST" }>;
}

export interface MockPublishResult {
  readonly externalRecordId: string;
  readonly status: "PUBLISHED";
  readonly receipt: string;
}

export const mockHubOpenApiDocument = Object.freeze({
  openapi: "3.1.0",
  info: { title: "AWP Mock Hub", version: "1.0.0" },
  paths: {
    "/mock/publish": {
      post: {
        operationId: "mockPublishSampleRecord",
        responses: { "200": { description: "Idempotent effect receipt" } },
      },
    },
    "/mock/reset": {
      post: { operationId: "resetMockHub", responses: { "200": { description: "State reset" } } },
    },
    "/mock/seed": {
      post: {
        operationId: "seedMockHub",
        responses: { "200": { description: "Deterministic state seeded" } },
      },
    },
    "/mock/scenario": {
      post: {
        operationId: "setMockHubScenario",
        responses: { "200": { description: "Scenario selected" } },
      },
    },
    "/mock/health": {
      get: {
        operationId: "getMockHubHealth",
        responses: { "200": { description: "Mock Hub health" } },
      },
    },
    ...operationalOpenApiPaths,
  },
});

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
    .join(",")}}`;
}
function canonicalRequestHash(request: MockPublishRequest): string {
  const stable = stableJson(request);
  return `sha256:${createHash("sha256").update(stable).digest("hex")}`;
}

export class MockHubService {
  constructor(private readonly repository: MockStateRepository) {}
  async reset(): Promise<void> {
    await this.repository.reset();
  }
  async seed(seed: number): Promise<void> {
    await this.repository.seed(seed);
  }
  async setScenario(scenario: MockScenarioState): Promise<void> {
    await this.repository.setScenario(scenario);
  }

  async publish(request: MockPublishRequest): Promise<MockPublishResult> {
    const requestHash = canonicalRequestHash(request);
    await this.repository.recordCall({
      effectIdempotencyKey: request.effectIdempotencyKey,
      requestHash,
    });
    const scenario = await this.repository.consumeScenario();
    const failure = {
      TIMEOUT: ["TIMEOUT", true],
      AUTHENTICATION_FAILED: ["CONNECTOR_UNAUTHORIZED", false],
      AUTHORIZATION_DENIED: ["CONNECTOR_FORBIDDEN", false],
      RATE_LIMITED: ["RATE_LIMITED", true],
      SERVER_ERROR: ["SERVER_ERROR", true],
      SCHEMA_DRIFT: ["SCHEMA_DRIFT", false],
    } as const;
    if (scenario in failure) {
      const [code, retryable] = failure[scenario as keyof typeof failure];
      throw new MockScenarioError(code, `Injected Mock Hub scenario: ${scenario}`, retryable);
    }
    const externalRecordId = request.target.id;
    const result: MockPublishResult = Object.freeze({
      externalRecordId,
      status: "PUBLISHED",
      receipt: `mock:${request.effectIdempotencyKey}`,
    });
    const effect = await this.repository.applyEffect({
      effectIdempotencyKey: request.effectIdempotencyKey,
      requestHash,
      externalRecordId,
      result,
    });
    if (scenario === "DUPLICATE_EVENT") {
      const eventId = `event:${request.effectIdempotencyKey}`;
      await this.repository.appendEvents([
        { eventId, scenario, externalRecordId },
        { eventId, scenario, externalRecordId },
      ]);
    } else if (scenario === "OUT_OF_ORDER_EVENT") {
      await this.repository.appendEvents([
        { eventId: `event:${request.effectIdempotencyKey}:2`, scenario, externalRecordId },
        { eventId: `event:${request.effectIdempotencyKey}:1`, scenario, externalRecordId },
      ]);
    } else {
      await this.repository.appendEvents([
        {
          eventId: `event:${request.effectIdempotencyKey}:1`,
          scenario: "NORMAL",
          externalRecordId,
        },
      ]);
    }
    return structuredClone(effect.result) as MockPublishResult;
  }
}

@Controller("mock")
export class MockHubController {
  constructor(@Inject(MockHubService) private readonly service: MockHubService) {}
  @Post("publish") publish(@Body() request: MockPublishRequest): Promise<MockPublishResult> {
    return this.service.publish(request);
  }
  @Post("reset") async reset(): Promise<{ ok: true }> {
    await this.service.reset();
    return { ok: true };
  }
  @Post("seed") async seed(@Body() input: { seed: number }): Promise<{ ok: true }> {
    await this.service.seed(input.seed);
    return { ok: true };
  }
  @Post("scenario") async scenario(
    @Body() input: Readonly<{ scenario: MockScenarioState }>,
  ): Promise<{ ok: true }> {
    await this.service.setScenario(input.scenario);
    return { ok: true };
  }
  @Get("health") health(): { status: "ok" } {
    return { status: "ok" };
  }
}
