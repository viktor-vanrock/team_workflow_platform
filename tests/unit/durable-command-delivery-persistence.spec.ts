import type { DataSource, EntityManager } from "typeorm";
import { describe, expect, it, vi } from "vitest";

import { InMemoryDurableCommandStore } from "../../packages/platform-core/src/index.ts";
import {
  TypeOrmCommandOutboxRepository,
  TypeOrmCommandRepository,
} from "../../packages/platform-persistence-typeorm/src/index.ts";

type Query = EntityManager["query"];

describe("durable command delivery persistence contracts", () => {
  it("round-trips effect gate, invocation and execution lease metadata", async () => {
    const aggregate = InMemoryDurableCommandStore.readyFixture();
    aggregate.markEnqueued(new Date("2026-01-01T00:00:01.000Z"));
    aggregate.markDispatched(new Date("2026-01-01T00:00:02.000Z"), 60_000);
    const command = aggregate.command();
    let inserted: readonly unknown[] | undefined;

    const query = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
      if (sql.startsWith("INSERT INTO connector_commands")) {
        inserted = parameters;
        return [];
      }
      if (sql.startsWith("SELECT * FROM connector_commands")) {
        if (!inserted) throw new Error("COMMAND_NOT_INSERTED");
        return [commandRow(inserted)];
      }
      throw new Error(`UNEXPECTED_SQL:${sql}`);
    }) as unknown as Query;
    const source = { manager: { query } } as unknown as DataSource;
    const repository = new TypeOrmCommandRepository(source);

    await repository.insert(command);
    const loaded = await repository.get(command.workspaceId, command.projectId, command.id);

    expect(loaded).toMatchObject({
      status: "DISPATCHED",
      outboxStatus: "ACKNOWLEDGED",
      effectInvocationStartedAt: new Date("2026-01-01T00:00:02.000Z"),
      effectGateDecision: "ALLOWED",
      effectGateEvaluatedAt: new Date("2026-01-01T00:00:02.000Z"),
      effectAuthorizationBasis: command.initialAuthorizationBasis,
      effectAuthorizationBasisHash: command.initialAuthorizationBasisHash,
      executionLeaseExpiresAt: new Date("2026-01-01T00:01:02.000Z"),
      attemptCount: 1,
      capability: { logicalRole: command.capability.logicalRole },
    });
  });

  it("claims READY and expired LEASED/ENQUEUED generations with SKIP LOCKED", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const leaseUntil = new Date("2026-01-01T00:01:00.001Z");
    const selected = outboxRow({ state: "ENQUEUED", attempts: 2 });
    const leased = outboxRow({
      state: "LEASED",
      attempts: 3,
      leaseUntil,
    });
    const statements: string[] = [];
    const query = vi.fn(async (sql: string) => {
      statements.push(sql);
      if (sql.includes("FOR UPDATE OF o SKIP LOCKED")) return [selected];
      if (sql.startsWith("UPDATE command_outbox SET state='LEASED'")) {
        // TypeORM/PostgreSQL may expose UPDATE ... RETURNING as [row, count].
        return [leased, 1];
      }
      throw new Error(`UNEXPECTED_SQL:${sql}`);
    }) as unknown as Query;
    const manager = { query } as Pick<EntityManager, "query">;
    const source = {
      manager,
      transaction: async (
        _isolation: string,
        work: (value: Pick<EntityManager, "query">) => Promise<unknown>,
      ) => await work(manager),
    } as unknown as DataSource;

    const claims = await new TypeOrmCommandOutboxRepository(source).claim(now, leaseUntil, 7);

    expect(claims).toEqual([
      expect.objectContaining({
        state: "LEASED",
        leaseUntil,
        attempts: 3,
      }),
    ]);
    expect(statements[0]).toContain("state='READY'");
    expect(statements[0]).toContain("state='LEASED'");
    expect(statements[0]).toContain("state='ENQUEUED'");
    expect(statements[0]).toContain("next_republish_at<=$1");
    expect(statements[0]).toContain("FOR UPDATE OF o SKIP LOCKED");
    expect(statements[0]).toContain("c.workspace_id=o.workspace_id AND c.project_id=o.project_id");
  });

  it("limits a scoped claim to approved workspace, projects and operations", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const query = vi.fn(async () => []);
    const source = { manager: { query } } as unknown as DataSource;
    const repository = new TypeOrmCommandOutboxRepository(source);
    await repository.claimInTransaction(
      { query } as unknown as EntityManager,
      now,
      new Date(now.getTime() + 1000),
      7,
      ["operational-work-item"],
      { workspaceId: "workspace", projectIds: ["project"], operations: ["request.create"] },
    );
    expect(query).toHaveBeenCalledWith(expect.stringContaining("o.workspace_id=$4"), [
      now,
      7,
      ["operational-work-item"],
      "workspace",
      ["project"],
      ["request.create"],
    ]);
    await expect(
      repository.claimInTransaction(
        { query } as unknown as EntityManager,
        now,
        new Date(now.getTime() + 1000),
        7,
        ["operational-work-item"],
        { workspaceId: "workspace", projectIds: [], operations: ["request.create"] },
      ),
    ).rejects.toThrow("COMMAND_OUTBOX_SCOPE_FILTER_INVALID");
  });
});

function commandRow(parameters: readonly unknown[]): Record<string, unknown> {
  return {
    id: parameters[0],
    workspace_id: parameters[1],
    project_id: parameters[2],
    actor: parameters[3],
    capability_key: parameters[4],
    capability_version: parameters[5],
    operation: parameters[6],
    target: parameters[7],
    payload: parameters[8],
    binding_ref: parameters[9],
    profile_ref: parameters[10],
    effect_idempotency_key: parameters[11],
    state: parameters[12],
    result: parameters[13],
    correlation_id: parameters[14],
    causation_id: parameters[15],
    row_version: parameters[16],
    created_at: parameters[17],
  };
}

function outboxRow(
  input: Readonly<{
    state: string;
    attempts: number;
    leaseUntil?: Date;
  }>,
): Record<string, unknown> {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    command_id: "00000000-0000-4000-8000-000000000002",
    workspace_id: "00000000-0000-4000-8000-000000000003",
    project_id: "00000000-0000-4000-8000-000000000004",
    state: input.state,
    available_at: new Date("2026-01-01T00:00:00.000Z"),
    lease_until: input.leaseUntil ?? null,
    next_republish_at: input.state === "ENQUEUED" ? new Date("2025-12-31T23:59:00.000Z") : null,
    attempts: input.attempts,
    envelope_hash: "sha256:envelope",
    created_at: new Date("2026-01-01T00:00:00.000Z"),
  };
}
