import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { redactAuditAttributes } from "../../../packages/platform-core/src/audit/redaction.ts";
import {
  coreEntities,
  coreMigrationRegistry,
  createPlatformDataSource,
  migrationClasses,
  OneShotMigrationRunner,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { ProblemDetailsFilter } from "../../../packages/platform-runtime-nest/src/http/problem-details.filter.ts";
import {
  redactTelemetryAttributes,
  StructuredLogger,
} from "../../../packages/platform-runtime-nest/src/observability/telemetry.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/postgres.ts";

const forbidden = /bearer\s+|secretref:\/\/|s3:\/\/|raw payload|eyJ[a-z0-9_-]{12,}\./iu;
describe("secret/redaction and append-only audit hardening", () => {
  it("removes secret/token/raw payload/object locator material from audit, logs, OTel and Problem Details", () => {
    const hostile = {
      token: "Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
      payload: "raw payload",
      locator: "s3://bucket/private-object",
      commandId: "secretref://local/not-an-id",
      operation: "record.publish",
      latencyMs: 4,
    };
    expect(JSON.stringify(redactAuditAttributes(hostile))).toBe(
      '{"operation":"record.publish","latencyMs":4}',
    );
    expect(
      JSON.stringify(redactTelemetryAttributes({ ...hostile, workspaceId: "workspace" })),
    ).toBe('{"operation":"record.publish","latencyMs":4,"workspaceId":"workspace"}');

    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    new StructuredLogger().write("error", "Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature", hostile);
    const log = String(write.mock.calls[0]?.[0] ?? "");
    write.mockRestore();
    expect(log).toContain("redacted.event");
    expect(log).not.toMatch(forbidden);

    let body: unknown;
    const response = {
      status: () => response,
      type: () => response,
      json: (value: unknown) => {
        body = value;
      },
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({
          url: "/api/v1/items?token=Bearer-secret",
          correlationId: "correlation",
        }),
      }),
    };
    new ProblemDetailsFilter().catch(new Error("Bearer secretref://local/leak"), host as never);
    expect(body).toEqual({
      type: "urn:awp:problem:http-500",
      title: "Internal Server Error",
      status: 500,
      code: "HTTP_500",
      instance: "/api/v1/items",
      correlationId: "correlation",
    });
    expect(JSON.stringify(body)).not.toMatch(forbidden);
  });

  describe("database append-only enforcement", () => {
    let postgres: RunningPostgres;
    let source: ReturnType<typeof createPlatformDataSource>;
    beforeAll(async () => {
      postgres = await startPostgres();
      source = createPlatformDataSource({
        url: postgres.url,
        entities: coreEntities,
        migrations: migrationClasses(coreMigrationRegistry),
      });
      await new OneShotMigrationRunner(
        source,
        "core",
        Math.max(...coreMigrationRegistry.map(({ order }) => order)),
      ).run();
      await source.query(
        "INSERT INTO workspaces(id,key,name,state) VALUES('10000000-0000-4000-8000-000000000001','audit-scan','Audit Scan','ACTIVE')",
      );
      await source.query(
        "INSERT INTO projects(id,workspace_id,key,name,state,classification_key) VALUES('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','SCAN','Scan','ACTIVE','INTERNAL')",
      );
      await source.query(`INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES(
        '10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','2026-01-01T00:00:00Z','{"kind":"SERVICE","principalId":"worker","serviceKey":"worker"}','record.publish','SUCCEEDED','CONFIRMED','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005',NULL,'INTERNAL','{}')`);
    }, 120_000);
    afterAll(async () => {
      if (source?.isInitialized) await source.destroy();
      if (postgres) await postgres.stop();
    });
    it("rejects UPDATE and DELETE attempts at the database boundary", async () => {
      await expect(
        source.query(
          "UPDATE audit_events SET outcome='FAILED' WHERE id='10000000-0000-4000-8000-000000000003'",
        ),
      ).rejects.toThrow(/append-only/u);
      await expect(
        source.query("DELETE FROM audit_events WHERE id='10000000-0000-4000-8000-000000000003'"),
      ).rejects.toThrow(/append-only/u);
      expect(
        await source.query(
          "SELECT outcome FROM audit_events WHERE id='10000000-0000-4000-8000-000000000003'",
        ),
      ).toEqual([{ outcome: "SUCCEEDED" }]);
    });
  });
});
