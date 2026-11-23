import type {
  ActorReference,
  Clock,
  IdGenerator,
  ResourceScope,
  WorkspaceContext,
} from "@awp/platform-core";

export class DeterministicClock implements Clock {
  constructor(private current = new Date("2026-01-01T00:00:00.000Z")) {}
  now(): Date {
    return new Date(this.current);
  }
  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

export class DeterministicIdGenerator implements IdGenerator {
  #sequence = 0;
  constructor(private readonly namespace = "00000000-0000-4000-8000") {}
  next(): string {
    this.#sequence += 1;
    return `${this.namespace}-${this.#sequence.toString().padStart(12, "0")}`;
  }
}

export function humanActor(
  overrides: Partial<Extract<ActorReference, { kind: "HUMAN" }>> = {},
): Extract<ActorReference, { kind: "HUMAN" }> {
  return Object.freeze({
    kind: "HUMAN",
    principalId: "00000000-0000-4000-8000-000000000001",
    issuer: "https://issuer.test",
    subject: "requester",
    ...overrides,
  });
}

export function projectScope(
  overrides: Partial<Extract<ResourceScope, { kind: "PROJECT" }>> = {},
): Extract<ResourceScope, { kind: "PROJECT" }> {
  return Object.freeze({
    kind: "PROJECT",
    workspaceId: "00000000-0000-4000-8000-000000000010",
    projectId: "00000000-0000-4000-8000-000000000020",
    ...overrides,
  });
}

export function workspaceContext(overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return Object.freeze({
    actor: humanActor(),
    scope: projectScope(),
    correlationId: "00000000-0000-4000-8000-000000000030",
    causationId: "00000000-0000-4000-8000-000000000031",
    ...overrides,
  });
}

export * from "./connectors/alternate-sample-record.connector.ts";
export * from "./connectors/conformance-kit.ts";
export * from "./durable-delivery.ts";
export * from "./postgres.ts";
export * from "./scenarios/model-harness.ts";
export * from "./scenarios/policy-harness.ts";
