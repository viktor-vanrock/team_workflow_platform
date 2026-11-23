import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TypeOrmJiraAuthoritativeReadOutboxRepository } from "../../../packages/connector-jira-persistence-typeorm/src/index.ts";
import { sha256 } from "../../../packages/platform-contracts/src/index.ts";
import {
  createPlatformDataSource,
  TypeOrmOperationalAuthorityRepository,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/index.ts";
import { loadEnvironment } from "../../../packages/runtime-composition/src/config/environment.ts";
import { JiraBoundRefreshScheduler } from "../../../packages/runtime-composition/src/jira/bound-refresh-scheduler.ts";
import { QaJiraOperationalActionService } from "../../../packages/runtime-composition/src/jira/qa-action-service.ts";
import { createQaJiraLocalWorkerSteps } from "../../../packages/runtime-composition/src/jira/qa-worker-steps.ts";
import {
  qaJiraLocalEntities,
  qaJiraLocalMigrations,
} from "../../../packages/runtime-composition/src/qa/composition.ts";
import { PostgresQueueProjectionWorker } from "../../../packages/runtime-composition/src/queue/projection-worker.ts";
import { localSeedIds } from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import {
  qaJiraLocalSeedRefs,
  runQaJiraLocalSeed,
} from "../../../packages/runtime-composition/src/seed/qa-jira-local-seed.ts";

const workspaceId = localSeedIds.workspaceFunctional;
const projectId = localSeedIds.alpha;
const bindingId = randomUUID();
const endpoint = "http://mock-hub:4010";
const environment = loadEnvironment({
  AWP_ENVIRONMENT: "LOCAL",
  AWP_COMPOSITION: "qa-jira-local",
  AWP_EXTERNAL_NETWORK_MODE: "deny",
  AWP_MOCK_HUB_URL: endpoint,
});
const initialTime = "2026-09-01T10:00:00.000Z";
function issue(statusId = "1", updated = initialTime, changelogId = "1") {
  return {
    id: "10001",
    key: "QAC-1",
    updated,
    changelogId,
    fields: {
      status: { id: statusId, name: statusId === "1" ? "Open" : "Done" },
      assignee: null as { accountId: string } | null,
      priority: null as { id: string; name: string } | null,
      duedate: null as string | null,
    },
  };
}

describe("Jira status synchronization through the durable worker", () => {
  let postgres: RunningPostgres;
  let source: ReturnType<typeof createPlatformDataSource>;
  let actions: QaJiraOperationalActionService;
  let scheduler: JiraBoundRefreshScheduler;
  let worker: ReturnType<typeof createQaJiraLocalWorkerSteps>;
  let current = issue();
  let failure = false;
  let reads = 0;

  const binding = async () =>
    (
      await source.query<readonly Record<string, unknown>[]>(
        "SELECT b.*,p.authority_snapshot FROM operational_bindings b LEFT JOIN operational_projection_revisions p ON p.id=b.current_projection_revision_id WHERE b.id=$1",
        [bindingId],
      )
    )[0]!;
  const state = async () =>
    (
      await source.query<readonly Record<string, unknown>[]>(
        "SELECT w.normalized_status,b.sync_state,b.last_error_code,b.last_observed_at,b.last_reconciled_at,b.fresh_until,p.revision,p.authority_snapshot FROM operational_bindings b JOIN work_items w ON w.id=b.work_item_id JOIN operational_projection_revisions p ON p.id=b.current_projection_revision_id WHERE b.id=$1",
        [bindingId],
      )
    )[0]!;
  const enqueue = async () => {
    const id = randomUUID();
    const envelope = {
      connectionId: qaJiraLocalSeedRefs.connection.id,
      externalEntityId: current.id,
      receiptIdentity: id,
    };
    await source.query(
      "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,'jira.authoritative-read.requested.v1',$4,$5,'READY',clock_timestamp())",
      [id, workspaceId, projectId, envelope, sha256(envelope)],
    );
    return id;
  };

  beforeAll(async () => {
    postgres = await startPostgres();
    source = createPlatformDataSource({
      url: postgres.url,
      entities: qaJiraLocalEntities,
      migrations: qaJiraLocalMigrations,
    });
    await source.initialize();
    await source.runMigrations({ transaction: "all" });
    await runQaJiraLocalSeed(source, environment);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        expect(init?.method).toBe("GET");
        reads += 1;
        return failure ? new Response("unavailable", { status: 503 }) : Response.json(current);
      }),
    );
    actions = new QaJiraOperationalActionService(source, environment);
    scheduler = new JiraBoundRefreshScheduler(source, endpoint);
    await source.query(
      `INSERT INTO operational_bindings(
      id,workspace_id,project_id,work_item_id,project_integration_binding_ref,connector_profile_ref,
      connection_header_id,connection_ref,mapping_ref,adapter_family,adapter_contract_version,
      external_entity_type,external_entity_id,initial_external_display_key,current_external_display_key,
      acceptance_source,sync_state,freshness_state,created_at,created_by,updated_at)
      SELECT $1,workspace_id,project_id,id,$2,$3,$4,$5,$6,'jira-cloud-v3','1.0.0','REQUEST','10001','QAC-1','QAC-1',
      'VERIFIED_IMPORT','SYNCED','UNKNOWN',clock_timestamp(),created_by,clock_timestamp()
      FROM work_items WHERE id=$7`,
      [
        bindingId,
        qaJiraLocalSeedRefs.binding,
        qaJiraLocalSeedRefs.profile,
        qaJiraLocalSeedRefs.connection.id,
        qaJiraLocalSeedRefs.connection,
        qaJiraLocalSeedRefs.mapping,
        localSeedIds.workItem,
      ],
    );
    await source.query("UPDATE work_items SET operational_binding_id=$1 WHERE id=$2", [
      bindingId,
      localSeedIds.workItem,
    ]);
  }, 120_000);

  beforeEach(async () => {
    current = issue();
    failure = false;
    reads = 0;
    await source.query(
      "DELETE FROM event_outbox WHERE event_type='jira.authoritative-read.requested.v1'",
    );
    await source.query(
      "UPDATE operational_bindings SET current_projection_revision_id=NULL,last_observed_at=NULL,fresh_until=NULL,last_reconciled_at=NULL WHERE id=$1",
      [bindingId],
    );
    await source.query("DELETE FROM operational_projection_revisions WHERE binding_id=$1", [
      bindingId,
    ]);
    const row = await binding();
    row.authority_snapshot = { requester: { externalPrincipalId: "jira:requester" } };
    const initial = await actions.observeBinding(row, "IMPORT_READ", randomUUID());
    await source.transaction(async (manager) =>
      actions.applyBindingObservation(manager, row, initial),
    );
    worker = createQaJiraLocalWorkerSteps(source, environment);
    await source.query(
      "DELETE FROM event_outbox WHERE event_type IN ('work_item.operational.projection-updated','work_item.operational.reconciliation-completed')",
    );
    reads = 0;
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (source?.isInitialized) await source.destroy();
    if (postgres) await postgres.stop();
  });

  it("applies a webhook status to both the projection and work item, including other Jira fields", async () => {
    current = {
      ...issue("2", "2026-09-01T10:01:00.000Z", "2"),
      fields: {
        status: { id: "2", name: "Done" },
        assignee: { accountId: "jira:executor" },
        priority: { id: "1", name: "High" },
        duedate: "2026-10-01",
      },
    };
    await enqueue();
    expect(await worker.commands.run()).toBe(1);
    expect(await state()).toMatchObject({
      normalized_status: "DONE",
      sync_state: "SYNCED",
      authority_snapshot: {
        rawStatus: { id: "2", name: "Done" },
        normalizedStatus: "DONE",
        assignee: { externalPrincipalId: "jira:executor" },
        priority: { normalizedKey: "HIGH" },
        dueDate: "2026-10-01",
      },
    });
    expect(reads).toBe(1);
    const consume = vi.fn(async () => ({ status: "PROCESSED" as const }));
    const queue = new PostgresQueueProjectionWorker(source, { consume });
    await queue.run();
    expect(consume).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "work_item.operational.projection-updated",
        entityId: localSeedIds.workItem,
        scope: { workspaceId, projectId },
      }),
    );
  });

  it("recovers a missed webhook after restart and does not enqueue duplicate polls", async () => {
    await source.query(
      "UPDATE operational_bindings SET last_observed_at=clock_timestamp()-interval '61 seconds' WHERE id=$1",
      [bindingId],
    );
    current = issue("2", "2026-09-01T10:01:00.000Z", "2");
    const counts = await Promise.all([scheduler.run(), scheduler.run()]);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(await scheduler.run()).toBe(0);
    const restarted = createQaJiraLocalWorkerSteps(source, environment);
    expect(await restarted.commands.run()).toBe(1);
    expect(await state()).toMatchObject({
      normalized_status: "DONE",
      authority_snapshot: { source: "RECONCILIATION_READ" },
    });
    expect((await state()).last_reconciled_at).not.toBeNull();
    expect(await scheduler.run()).toBe(0);
  });

  it("renews freshness on unchanged reads without adding a revision", async () => {
    const before = await state();
    await source.query(
      "UPDATE operational_bindings SET last_observed_at=clock_timestamp()-interval '180 seconds',fresh_until=clock_timestamp()-interval '60 seconds' WHERE id=$1",
      [bindingId],
    );
    const authority = new TypeOrmOperationalAuthorityRepository(source);
    expect(
      (
        await authority.confirmedProjectionForWorkItem(
          { workspaceId, projectId },
          localSeedIds.workItem,
        )
      )?.freshness,
    ).toBe("STALE");
    await enqueue();
    await worker.commands.run();
    const after = await state();
    expect(after.revision).toBe(before.revision);
    expect(new Date(String(after.fresh_until)).getTime()).toBeGreaterThan(Date.now());
    expect(after.sync_state).toBe("SYNCED");
    expect(
      (
        await authority.confirmedProjectionForWorkItem(
          { workspaceId, projectId },
          localSeedIds.workItem,
        )
      )?.freshness,
    ).toBe("CURRENT");
  });

  it("never rolls back the work item or renews freshness from an older observation", async () => {
    current = issue("2", "2026-09-01T10:01:00.000Z", "2");
    await enqueue();
    await worker.commands.run();
    const confirmed = await state();
    current = issue();
    await enqueue();
    await worker.commands.run();
    expect(await state()).toEqual(confirmed);
    current = issue("1", "2026-09-01T10:01:00.000Z", "1");
    await enqueue();
    await worker.commands.run();
    expect(await state()).toEqual(confirmed);
  });

  it("shows unknown mappings and retries without inventing a new status", async () => {
    current = issue("999", "2026-09-01T10:01:00.000Z", "2");
    const id = await enqueue();
    await worker.commands.run();
    expect(await state()).toMatchObject({
      normalized_status: "NEW",
      sync_state: "MAPPING_REQUIRED",
      last_error_code: "JIRA_STATUS_MAPPING_REQUIRED",
    });
    expect(await worker.commands.run()).toBe(0);
    expect(reads).toBe(1);
    current = issue("2", "2026-09-01T10:02:00.000Z", "3");
    await source.query(
      "UPDATE event_outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [id],
    );
    await worker.commands.run();
    expect(await state()).toMatchObject({
      normalized_status: "DONE",
      sync_state: "SYNCED",
      last_error_code: null,
    });
  });

  it("keeps failed reads durable and lets another delivery proceed during backoff", async () => {
    failure = true;
    const failedId = await enqueue();
    await worker.commands.run();
    expect(await state()).toMatchObject({ normalized_status: "NEW", sync_state: "ERROR" });
    failure = false;
    current = issue("2", "2026-09-01T10:01:00.000Z", "2");
    await enqueue();
    await worker.commands.run();
    expect((await state()).normalized_status).toBe("DONE");
    const [pending] = await source.query(
      "SELECT state,attempt_count FROM event_outbox WHERE id=$1",
      [failedId],
    );
    expect(pending).toMatchObject({ state: "READY", attempt_count: 1 });
    const outbox = new TypeOrmJiraAuthoritativeReadOutboxRepository(source);
    expect(
      await outbox.claim(new Date(), new Date(Date.now() + 30_000), "other-worker"),
    ).toBeUndefined();
  });
});
