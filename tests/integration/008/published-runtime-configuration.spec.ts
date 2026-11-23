import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  type ExactRevisionRef,
  pilotContentHash,
} from "../../../packages/platform-core/src/index.ts";
import {
  type RuntimeConfigurationPublication,
  RuntimeConfigurationRepository,
} from "../../../packages/platform-persistence-typeorm/src/runtime-configuration.repository.ts";
import {
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  us3Actor,
} from "../../support/002-us3-database.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

const publication = (workspaceId: string, projectId: string): RuntimeConfigurationPublication => {
  const document = { mode: "CORPORATE", setting: "approved" };
  return {
    schemaVersion: 1,
    workspaceId,
    projectIds: [projectId],
    kind: "IDENTITY_POLICY",
    ref: {
      id: randomUUID(),
      version: 1,
      contentHash: pilotContentHash(document) as ExactRevisionRef["contentHash"],
    },
    document,
    publishedBy: us3Actor.principalId,
    publishedAt: new Date(Date.now() - 1000).toISOString(),
    validUntil: new Date(Date.now() + 60_000).toISOString(),
    correlationId: randomUUID(),
  };
};
it("rejects malformed, secret-bearing and out-of-transaction publications before SQL", async () => {
  const repo = new RuntimeConfigurationRepository();
  const query = vi.fn();
  const manager = { query, queryRunner: { isTransactionActive: true } } as never;
  const value = publication(randomUUID(), randomUUID());
  for (const document of [
    { ...value.document, clientSecret: "private-canary" },
    { ...value.document, setting: "different" },
  ])
    await expect(repo.publish(manager, { ...value, document }, 0)).rejects.toThrow(
      "RUNTIME_CONFIGURATION_INVALID",
    );
  await expect(repo.publish({ query } as never, value, 0)).rejects.toThrow(
    "RUNTIME_CONFIGURATION_TRANSACTION_REQUIRED",
  );
  expect(query).not.toHaveBeenCalled();
});
describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "008 published runtime configuration",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "preserves immutable history, exact replay, CAS and terminal revocation on %s",
      async (image) => {
        const f = await startUs3DatabaseFixture({ postgresImage: image });
        const repo = new RuntimeConfigurationRepository();
        try {
          const first = publication(f.workspaceId, f.projectId);
          const put = (value: RuntimeConfigurationPublication, expected: number) =>
            f.source.transaction((manager) => repo.publish(manager, value, expected));
          await put(first, 0);
          await put(first, 0);
          const current = () =>
            f.source.transaction((manager) =>
              repo.current(
                manager,
                { workspaceId: f.workspaceId, projectId: f.projectId },
                first.ref,
                "IDENTITY_POLICY",
              ),
            );
          expect(await current()).toEqual(first);
          await expect(
            put({ ...first, validUntil: new Date(Date.now() + 120_000).toISOString() }, 0),
          ).rejects.toThrow("RUNTIME_CONFIGURATION_CONFLICT");
          await expect(
            f.source.transaction((manager) =>
              repo.current(
                manager,
                { workspaceId: f.workspaceId, projectId: randomUUID() },
                first.ref,
                "IDENTITY_POLICY",
              ),
            ),
          ).rejects.toThrow("RUNTIME_CONFIGURATION_UNAVAILABLE");
          const next = { ...first, ref: { ...first.ref, version: 2 }, correlationId: randomUUID() };
          const raced = await Promise.allSettled([
            put(next, 1),
            put({ ...next, correlationId: randomUUID() }, 1),
          ]);
          expect(raced.filter((result) => result.status === "fulfilled")).toHaveLength(1);
          await expect(current()).rejects.toThrow("RUNTIME_CONFIGURATION_UNAVAILABLE");
          await f.source.transaction((manager) =>
            repo.revoke(
              manager,
              {
                workspaceId: f.workspaceId,
                ref: next.ref,
                actorRef: us3Actor.principalId,
                correlationId: randomUUID(),
              },
              2,
            ),
          );
          await expect(
            f.source.transaction((manager) =>
              repo.current(
                manager,
                { workspaceId: f.workspaceId, projectId: f.projectId },
                next.ref,
                "IDENTITY_POLICY",
              ),
            ),
          ).rejects.toThrow("RUNTIME_CONFIGURATION_UNAVAILABLE");
          await expect(
            f.source.query(
              "UPDATE runtime_configuration_headers SET state='PUBLISHED',row_version=row_version+1 WHERE configuration_id=$1",
              [first.ref.id],
            ),
          ).rejects.toThrow("RUNTIME_CONFIGURATION_CAS_REQUIRED");
          await expect(
            f.source.query("UPDATE runtime_configuration_revisions SET semantic_body='{}'::jsonb"),
          ).rejects.toThrow();
          await expect(
            f.source.query("DELETE FROM runtime_configuration_projects"),
          ).rejects.toThrow();
          await expect(
            f.source.query("DELETE FROM runtime_configuration_headers"),
          ).rejects.toThrow();
          await f.source.destroy();
          await f.source.initialize();
          await put(
            { ...first, ref: { ...first.ref, version: 3 }, correlationId: randomUUID() },
            3,
          );
          expect(
            await f.source.query(
              "SELECT version FROM runtime_configuration_revisions ORDER BY version",
            ),
          ).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
          expect(
            await f.source.query(
              "SELECT action FROM runtime_configuration_events ORDER BY event_id",
            ),
          ).toHaveLength(4);
          const invalidScope = { ...publication(f.workspaceId, randomUUID()) };
          await expect(put(invalidScope, 0)).rejects.toThrow();
          expect(
            await f.source.query(
              "SELECT configuration_id FROM runtime_configuration_headers WHERE configuration_id=$1",
              [invalidScope.ref.id],
            ),
          ).toEqual([]);
          const unaudited = publication(f.workspaceId, f.projectId);
          await f.source.query(
            "CREATE FUNCTION reject_runtime_config_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'AUDIT_WRITE_FAILED'; END $$; CREATE TRIGGER reject_runtime_config_event BEFORE INSERT ON runtime_configuration_events FOR EACH ROW EXECUTE FUNCTION reject_runtime_config_event()",
          );
          await expect(put(unaudited, 0)).rejects.toThrow("AUDIT_WRITE_FAILED");
          expect(
            await f.source.query(
              "SELECT configuration_id FROM runtime_configuration_revisions WHERE configuration_id=$1",
              [unaudited.ref.id],
            ),
          ).toEqual([]);
          expect(
            await f.source.query(
              "SELECT configuration_id FROM runtime_configuration_headers WHERE configuration_id=$1",
              [unaudited.ref.id],
            ),
          ).toEqual([]);
        } finally {
          await stopUs3DatabaseFixture(f);
        }
      },
      120_000,
    );
  },
);
