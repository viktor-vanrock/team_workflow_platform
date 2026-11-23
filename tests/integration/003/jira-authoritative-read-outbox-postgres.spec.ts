import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TypeOrmJiraAuthoritativeReadOutboxRepository } from "../../../packages/connector-jira-persistence-typeorm/src/index.ts";
import { type JsonValue, sha256 } from "../../../packages/platform-contracts/src/index.ts";
import type { CompleteOperationalObservation } from "../../../packages/platform-core/src/index.ts";
import {
  createPlatformDataSource,
  TypeOrmOperationalAuthorityRepository,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/index.ts";
import {
  qaJiraLocalEntities,
  qaJiraLocalMigrations,
} from "../../../packages/runtime-composition/src/qa/composition.ts";
import {
  localSeedIds,
  runLocalSeed,
} from "../../../packages/runtime-composition/src/seed/local-seed.ts";

const bindingId = "a1000000-0000-4000-8000-000000000001";
const connectionId = "qa-jira-webhook-lease-test";
const externalEntityId = "10001";

function observation(
  input: Readonly<{
    id: string;
    token: string;
    hash: string;
    providerUpdatedAt: string;
  }>,
): CompleteOperationalObservation {
  return Object.freeze({
    observationId: input.id,
    source: "WEBHOOK_READ",
    externalEntityId,
    externalDisplayKey: "QA-1",
    externalRevisionToken: input.token,
    authorityFieldsHash: input.hash,
    providerUpdatedAt: input.providerUpdatedAt,
    observedAt: input.providerUpdatedAt,
    rawStatus: { id: "1", name: "Open" },
    normalizedStatus: "NEW",
    requester: { externalPrincipalId: "jira:user-1" },
    assignee: null,
    priority: null,
    dueDate: null,
    profileRef: { id: "profile", version: 1 },
    mappingRef: { id: "mapping", version: 1 },
    connectionRef: { id: connectionId, version: 1 },
    adapterFamily: "CLOUD",
    adapterContractVersion: "1.1.0",
  });
}

describe("Jira authoritative-read event outbox PostgreSQL leases", () => {
  let postgres: RunningPostgres;
  let source: ReturnType<typeof createPlatformDataSource>;
  let outbox: TypeOrmJiraAuthoritativeReadOutboxRepository;
  let authority: TypeOrmOperationalAuthorityRepository;

  beforeAll(async () => {
    postgres = await startPostgres();
    source = createPlatformDataSource({
      url: postgres.url,
      entities: qaJiraLocalEntities,
      migrations: qaJiraLocalMigrations,
    });
    await source.initialize();
    await source.runMigrations({ transaction: "all" });
    await runLocalSeed(source);

    const workItems = (await source.query(
      "SELECT created_by FROM work_items WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
      [localSeedIds.workspaceFunctional, localSeedIds.alpha, localSeedIds.workItem],
    )) as readonly Readonly<{ created_by: string }>[];
    await source.query(
      `INSERT INTO operational_bindings(
         id,workspace_id,project_id,work_item_id,project_integration_binding_ref,
         connector_profile_ref,connection_header_id,connection_ref,mapping_ref,
         adapter_family,adapter_contract_version,external_entity_type,
         external_entity_id,initial_external_display_key,current_external_display_key,
         acceptance_source,current_projection_revision_id,current_external_revision_token,
         sync_state,freshness_state,fresh_until,last_observed_at,last_webhook_at,
         last_reconciled_at,last_error_code,created_at,created_by,updated_at,row_version
       ) VALUES(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,'CLOUD','1.1.0','REQUEST',$10,'QA-1','QA-1',
         'CREATE_READ_BACK',NULL,NULL,'SYNCED','UNKNOWN',NULL,NULL,NULL,NULL,NULL,
         $11,$12,$11,1
       )`,
      [
        bindingId,
        localSeedIds.workspaceFunctional,
        localSeedIds.alpha,
        localSeedIds.workItem,
        JSON.stringify({ id: "binding", version: 1 }),
        JSON.stringify({ id: "profile", version: 1 }),
        connectionId,
        JSON.stringify({ id: connectionId, version: 1 }),
        JSON.stringify({ id: "mapping", version: 1 }),
        externalEntityId,
        new Date("2030-01-01T00:00:00.000Z"),
        workItems[0]!.created_by,
      ],
    );
    outbox = new TypeOrmJiraAuthoritativeReadOutboxRepository(source);
    authority = new TypeOrmOperationalAuthorityRepository(source);

    const initial = observation({
      id: "initial",
      token: "r1",
      hash: "hash-1",
      providerUpdatedAt: "2030-01-02T00:00:00.000Z",
    });
    await source.transaction("SERIALIZABLE", async (manager) => {
      await authority.reduceObservation(
        manager,
        {
          workspaceId: localSeedIds.workspaceFunctional,
          projectId: localSeedIds.alpha,
          bindingId,
        },
        initial,
        sha256(initial as unknown as JsonValue),
        "a1100000-0000-4000-8000-000000000001",
        "a1100000-0000-4000-8000-000000000002",
      );
    });
  }, 120_000);

  afterAll(async () => {
    if (source?.isInitialized) await source.destroy();
    if (postgres) await postgres.stop();
  });

  async function insertEvent(id: string, createdAt: Date): Promise<void> {
    await source.query(
      `INSERT INTO event_outbox(
         id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at
       ) VALUES($1,$2,$3,'jira.authoritative-read.requested.v1',$4,$5,'READY',$6)`,
      [
        id,
        localSeedIds.workspaceFunctional,
        localSeedIds.alpha,
        JSON.stringify({ connectionId, externalEntityId, receiptIdentity: id }),
        `sha256:${id.replaceAll("-", "")}`,
        createdAt,
      ],
    );
  }

  it("recovers a crash-expired lease and fences the stale worker", async () => {
    const eventId = "a2000000-0000-4000-8000-000000000001";
    const at = new Date("2030-02-01T00:00:00.000Z");
    await insertEvent(eventId, at);

    const first = await outbox.claim(at, new Date(at.getTime() + 10_000), "worker-a");
    expect(first).toMatchObject({
      id: eventId,
      leaseOwner: "worker-a",
      leaseToken: "1",
      attemptCount: 1,
    });
    await expect(
      outbox.claim(new Date(at.getTime() + 9_999), new Date(at.getTime() + 19_999), "worker-b"),
    ).resolves.toBeUndefined();

    expect(await outbox.recoverExpired(new Date(at.getTime() + 10_001))).toBe(1);
    expect(
      await source.query(
        "SELECT state,lease_owner,lease_token,lease_until,attempt_count FROM event_outbox WHERE id=$1",
        [eventId],
      ),
    ).toEqual([
      {
        state: "READY",
        lease_owner: null,
        lease_token: "1",
        lease_until: null,
        attempt_count: 1,
      },
    ]);

    const recovered = await outbox.claim(
      new Date(at.getTime() + 10_002),
      new Date(at.getTime() + 20_002),
      "worker-b",
    );
    expect(recovered).toMatchObject({
      id: eventId,
      leaseOwner: "worker-b",
      leaseToken: "2",
      attemptCount: 2,
    });

    let staleMutationRan = false;
    await expect(
      outbox.complete(first!, new Date(at.getTime() + 10_003), async () => {
        staleMutationRan = true;
      }),
    ).rejects.toThrow("JIRA_AUTHORITATIVE_READ_LEASE_CONFLICT");
    expect(staleMutationRan).toBe(false);
    expect(await outbox.release(first!)).toBe(false);

    await expect(
      outbox.complete(recovered!, new Date(at.getTime() + 10_004), async () => "ACK"),
    ).resolves.toBe("ACK");
    expect(
      await source.query(
        "SELECT state,lease_owner,lease_token,lease_until,attempt_count FROM event_outbox WHERE id=$1",
        [eventId],
      ),
    ).toEqual([
      {
        state: "ACKNOWLEDGED",
        lease_owner: null,
        lease_token: "2",
        lease_until: null,
        attempt_count: 2,
      },
    ]);
  });

  it("atomically retries a failed projection and acknowledges duplicate and out-of-order reads", async () => {
    const at = new Date("2030-03-01T00:00:00.000Z");
    const appliedEventId = "a2000000-0000-4000-8000-000000000002";
    await insertEvent(appliedEventId, at);
    const first = await outbox.claim(at, new Date(at.getTime() + 10_000), "worker-projection-a");
    const updated = observation({
      id: "updated",
      token: "r2",
      hash: "hash-2",
      providerUpdatedAt: "2030-01-03T00:00:00.000Z",
    });
    await expect(
      outbox.complete(first!, new Date(at.getTime() + 1_000), async (manager) => {
        await authority.reduceObservation(
          manager,
          {
            workspaceId: localSeedIds.workspaceFunctional,
            projectId: localSeedIds.alpha,
            bindingId,
          },
          updated,
          sha256(updated as unknown as JsonValue),
          "a1200000-0000-4000-8000-000000000001",
          "a1200000-0000-4000-8000-000000000002",
        );
        throw new Error("SIMULATED_PROCESS_FAILURE_BEFORE_ACK");
      }),
    ).rejects.toThrow("SIMULATED_PROCESS_FAILURE_BEFORE_ACK");
    expect(
      await source.query(
        "SELECT count(*)::int AS count FROM operational_projection_revisions WHERE binding_id=$1",
        [bindingId],
      ),
    ).toEqual([{ count: 1 }]);
    expect(await outbox.release(first!)).toBe(true);

    const retry = await outbox.claim(
      new Date(at.getTime() + 2_000),
      new Date(at.getTime() + 12_000),
      "worker-projection-b",
    );
    await expect(
      outbox.complete(
        retry!,
        new Date(at.getTime() + 3_000),
        async (manager) =>
          await authority.reduceObservation(
            manager,
            {
              workspaceId: localSeedIds.workspaceFunctional,
              projectId: localSeedIds.alpha,
              bindingId,
            },
            updated,
            sha256(updated as unknown as JsonValue),
            "a1200000-0000-4000-8000-000000000003",
            "a1200000-0000-4000-8000-000000000004",
          ),
      ),
    ).resolves.toMatchObject({ disposition: "APPLIED" });

    const duplicateEventId = "a2000000-0000-4000-8000-000000000003";
    await insertEvent(duplicateEventId, new Date(at.getTime() + 4_000));
    const duplicateClaim = await outbox.claim(
      new Date(at.getTime() + 4_000),
      new Date(at.getTime() + 14_000),
      "worker-duplicate",
    );
    const duplicate = observation({
      id: "duplicate",
      token: "r2",
      hash: "hash-2",
      providerUpdatedAt: "2030-01-03T00:00:00.000Z",
    });
    await expect(
      outbox.complete(
        duplicateClaim!,
        new Date(at.getTime() + 5_000),
        async (manager) =>
          await authority.reduceObservation(
            manager,
            {
              workspaceId: localSeedIds.workspaceFunctional,
              projectId: localSeedIds.alpha,
              bindingId,
            },
            duplicate,
            sha256(duplicate as unknown as JsonValue),
            "a1200000-0000-4000-8000-000000000005",
            "a1200000-0000-4000-8000-000000000006",
          ),
      ),
    ).resolves.toMatchObject({ disposition: "DUPLICATE" });

    const staleEventId = "a2000000-0000-4000-8000-000000000004";
    await insertEvent(staleEventId, new Date(at.getTime() + 6_000));
    const staleClaim = await outbox.claim(
      new Date(at.getTime() + 6_000),
      new Date(at.getTime() + 16_000),
      "worker-stale",
    );
    const stale = observation({
      id: "stale",
      token: "r0",
      hash: "hash-0",
      providerUpdatedAt: "2030-01-01T00:00:00.000Z",
    });
    await expect(
      outbox.complete(
        staleClaim!,
        new Date(at.getTime() + 7_000),
        async (manager) =>
          await authority.reduceObservation(
            manager,
            {
              workspaceId: localSeedIds.workspaceFunctional,
              projectId: localSeedIds.alpha,
              bindingId,
            },
            stale,
            sha256(stale as unknown as JsonValue),
            "a1200000-0000-4000-8000-000000000007",
            "a1200000-0000-4000-8000-000000000008",
          ),
      ),
    ).resolves.toMatchObject({ disposition: "STALE_IGNORED" });

    expect(
      await source.query(
        "SELECT revision,external_revision_token FROM operational_projection_revisions WHERE binding_id=$1 ORDER BY revision",
        [bindingId],
      ),
    ).toEqual([
      { revision: 1, external_revision_token: "r1" },
      { revision: 2, external_revision_token: "r2" },
    ]);
    expect(
      await source.query("SELECT id,state FROM event_outbox WHERE id=ANY($1::uuid[]) ORDER BY id", [
        [appliedEventId, duplicateEventId, staleEventId],
      ]),
    ).toEqual([
      { id: appliedEventId, state: "ACKNOWLEDGED" },
      { id: duplicateEventId, state: "ACKNOWLEDGED" },
      { id: staleEventId, state: "ACKNOWLEDGED" },
    ]);
  });
});
