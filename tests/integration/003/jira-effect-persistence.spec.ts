import { afterEach, describe, expect, it } from "vitest";

import {
  type JiraEffectLookup,
  JiraRequestCreateService,
  type RequestCreateObservation,
  type RequestCreatePort,
  type RequestSubEffect,
} from "../../../packages/connector-jira/src/index.ts";
import {
  type JiraEffectClaim,
  JiraEffectRepository,
  PersistentJiraRequestCreatePort,
  PersistentJiraRequestSubEffectStore,
} from "../../../packages/connector-jira-persistence-typeorm/src/index.ts";
import { createPlatformDataSource } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/index.ts";
import {
  qaJiraLocalEntities,
  qaJiraLocalMigrations,
} from "../../../packages/runtime-composition/src/qa/composition.ts";

type PlatformSource = ReturnType<typeof createPlatformDataSource>;

const sources: PlatformSource[] = [];
const postgresInstances: RunningPostgres[] = [];

afterEach(async () => {
  await Promise.all(
    sources.splice(0).map(async (source) => {
      if (source.isInitialized) await source.destroy();
    }),
  );
  await Promise.all(postgresInstances.splice(0).map(async (postgres) => await postgres.stop()));
});

class RecoverableRequestPort implements RequestCreatePort {
  issueId: string | undefined;
  creates = 0;
  subEffects = 0;
  timeoutAfterCreate = false;

  async lookup(): Promise<JiraEffectLookup> {
    return this.issueId
      ? Object.freeze({ state: "FOUND", externalEntityId: this.issueId })
      : Object.freeze({ state: "PROVEN_ABSENT" });
  }

  async create(): Promise<Readonly<{ externalEntityId: string }>> {
    this.creates += 1;
    this.issueId = "10001";
    if (this.timeoutAfterCreate) {
      this.timeoutAfterCreate = false;
      throw new Error("PROVIDER_RESPONSE_LOST");
    }
    return Object.freeze({ externalEntityId: this.issueId });
  }

  async observe(externalEntityId: string): Promise<RequestCreateObservation> {
    return Object.freeze({
      externalEntityId,
      externalDisplayKey: "QA-1",
      externalRevisionToken: "2026-08-31T00:00:00.000Z:1",
      authorityFieldsHash: "sha256:authority",
    });
  }

  async applySubEffect(_externalEntityId: string, effect: RequestSubEffect): Promise<string> {
    this.subEffects += 1;
    return `receipt:${effect.semanticIdentity}`;
  }
}

const effectId = "effect:qa-request:1";
const commandId = "a3000000-0000-4000-8000-000000000001";

async function open(databaseUrl: string, migrate: boolean): Promise<PlatformSource> {
  const source = createPlatformDataSource({
    url: databaseUrl,
    entities: qaJiraLocalEntities,
    migrations: qaJiraLocalMigrations,
  });
  sources.push(source);
  await source.initialize();
  if (migrate) await source.runMigrations({ transaction: "all" });
  return source;
}

async function ensureEffect(repository: JiraEffectRepository): Promise<void> {
  await repository.ensure({
    id: commandId,
    commandId,
    effectId,
    connectionRef: { id: "connection", version: 2 },
    profileRef: { id: "profile", version: 5 },
    operation: "request.create",
    targetHash: "sha256:target",
    payloadHash: "sha256:payload",
    marker: effectId,
    now: new Date("2026-08-31T00:00:00.000Z"),
  });
}

function service(
  provider: RequestCreatePort,
  repository: JiraEffectRepository,
  claim: JiraEffectClaim,
): JiraRequestCreateService {
  return new JiraRequestCreateService(
    new PersistentJiraRequestCreatePort(provider, repository, claim),
    new PersistentJiraRequestSubEffectStore(repository, claim),
  );
}

async function claimEffect(
  repository: JiraEffectRepository,
  owner: string,
): Promise<JiraEffectClaim> {
  const now = new Date();
  return await repository.claim(effectId, owner, now, new Date(now.getTime() + 60_000));
}

describe("Jira TypeORM effect runtime wiring", () => {
  it("recovers timeout-after-effect and persistent sub-effect receipts across a runtime restart", async () => {
    const postgres = await startPostgres();
    postgresInstances.push(postgres);
    let source = await open(postgres.url, true);
    let effects = new JiraEffectRepository(source);
    await ensureEffect(effects);
    const firstClaim = await claimEffect(effects, "worker:first");

    const provider = new RecoverableRequestPort();
    provider.timeoutAfterCreate = true;
    const subEffect = Object.freeze({
      kind: "REMOTE_LINK" as const,
      semanticIdentity: "source-context:alpha:DEV-1",
      payload: Object.freeze({ url: "https://platform.invalid/work-items/1" }),
      required: true,
    });
    await expect(
      service(provider, effects, firstClaim).execute({
        effectMarker: effectId,
        fields: { summary: "Persistent request" },
        subEffects: [subEffect],
      }),
    ).rejects.toThrow("PROVIDER_RESPONSE_LOST");
    expect(provider.creates).toBe(1);
    expect((await effects.byEffectId(effectId))?.state).toBe("EFFECT_IN_PROGRESS");

    await source.query(
      "UPDATE jira_effect_reconciliations SET lease_until=clock_timestamp()-interval '1 second' WHERE effect_id=$1",
      [effectId],
    );

    await source.destroy();
    sources.splice(sources.indexOf(source), 1);
    source = await open(postgres.url, false);
    effects = new JiraEffectRepository(source);
    const recoveryClaim = await claimEffect(effects, "worker:recovery");

    await expect(
      service(provider, effects, recoveryClaim).execute({
        effectMarker: effectId,
        fields: { summary: "Persistent request" },
        subEffects: [subEffect],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "CONFIRMED",
        externalEntityId: "10001",
        created: false,
        subEffectReceipts: ["receipt:source-context:alpha:DEV-1"],
      }),
    );
    expect(provider.creates).toBe(1);
    expect(provider.subEffects).toBe(1);
    expect(
      await source.query(
        "SELECT state,attempt,external_entity_id FROM jira_effect_reconciliations WHERE effect_id=$1",
        [effectId],
      ),
    ).toEqual([{ state: "CONFIRMED", attempt: 2, external_entity_id: "10001" }]);
    expect(
      await source.query(
        "SELECT sequence,kind,semantic_identity,state,attempt,external_identity,receipt_hash FROM jira_effect_sub_effects",
      ),
    ).toEqual([
      {
        sequence: 0,
        kind: "REMOTE_LINK",
        semantic_identity: "source-context:alpha:DEV-1",
        state: "CONFIRMED",
        attempt: 1,
        external_identity: "receipt:source-context:alpha:DEV-1",
        receipt_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      },
    ]);

    const replayClaim = await claimEffect(effects, "worker:replay");
    const restarted = service(provider, effects, replayClaim);
    await expect(
      restarted.execute({
        effectMarker: effectId,
        fields: { summary: "Persistent request" },
        subEffects: [subEffect],
      }),
    ).resolves.toEqual(expect.objectContaining({ status: "CONFIRMED", created: false }));
    expect(provider.creates).toBe(1);
    expect(provider.subEffects).toBe(1);

    provider.issueId = undefined;
    const conflictClaim = await claimEffect(effects, "worker:conflict");
    await expect(
      service(provider, effects, conflictClaim).execute({
        effectMarker: effectId,
        fields: { summary: "Persistent request" },
        subEffects: [subEffect],
      }),
    ).rejects.toThrow("JIRA_EFFECT_EXTERNAL_OBSERVATION_CONFLICT");
    expect(provider.creates).toBe(1);
  }, 120_000);

  it("rejects identity and ordered sub-effect plan drift for an existing effect", async () => {
    const postgres = await startPostgres();
    postgresInstances.push(postgres);
    const source = await open(postgres.url, true);
    const effects = new JiraEffectRepository(source);
    await ensureEffect(effects);
    await expect(
      effects.ensure({
        id: commandId,
        commandId,
        effectId,
        connectionRef: { id: "connection", version: 2 },
        profileRef: { id: "profile", version: 5 },
        operation: "request.create",
        targetHash: "sha256:target",
        payloadHash: "sha256:different",
        marker: effectId,
        now: new Date(),
      }),
    ).rejects.toThrow("JIRA_EFFECT_IDENTITY_CONFLICT");

    const claim = await claimEffect(effects, "worker:plan");
    const store = new PersistentJiraRequestSubEffectStore(effects, claim);
    await store.prepare(effectId, [
      {
        kind: "COMMENT",
        semanticIdentity: "comment:1",
        payload: { body: "first" },
      },
    ]);
    await expect(
      store.prepare(effectId, [
        {
          kind: "COMMENT",
          semanticIdentity: "comment:1",
          payload: { body: "changed" },
        },
      ]),
    ).rejects.toThrow("JIRA_SUB_EFFECT_PLAN_CONFLICT");
  }, 120_000);

  it("fences stale parent and sub-effect mutations after lease takeover", async () => {
    const postgres = await startPostgres();
    postgresInstances.push(postgres);
    const source = await open(postgres.url, true);
    const effects = new JiraEffectRepository(source);
    await ensureEffect(effects);

    const at = new Date("2030-01-01T00:00:00.000Z");
    const first = await effects.claim(
      effectId,
      "worker:first",
      at,
      new Date(at.getTime() + 10_000),
    );
    expect(first).toMatchObject({ owner: "worker:first", token: "1" });
    await expect(
      effects.claim(
        effectId,
        "worker:concurrent",
        new Date(at.getTime() + 9_999),
        new Date(at.getTime() + 20_000),
      ),
    ).rejects.toThrow("JIRA_EFFECT_LEASE_CONFLICT");

    await effects.beginLookup(first, new Date(at.getTime() + 1_000));
    await effects.prepareSubEffects(
      first,
      [
        {
          sequence: 0,
          kind: "ISSUE_LINK",
          semanticIdentity: "link:source:1",
          semanticHash: "sha256:link-source-1",
          required: true,
        },
      ],
      new Date(at.getTime() + 2_000),
    );
    await effects.beginSubEffect(first, "link:source:1", new Date(at.getTime() + 3_000));

    const recovery = await effects.claim(
      effectId,
      "worker:recovery",
      new Date(at.getTime() + 10_001),
      new Date(at.getTime() + 30_000),
    );
    expect(recovery).toMatchObject({ owner: "worker:recovery", token: "2" });

    await expect(
      effects.recordLookup(
        first,
        {
          state: "FOUND",
          externalEntityId: "stale-issue",
          matchCount: 1,
          queryHash: "sha256:stale-query",
        },
        new Date(at.getTime() + 11_000),
      ),
    ).rejects.toThrow("JIRA_EFFECT_FENCE_REJECTED");
    await expect(
      effects.confirmSubEffect(
        first,
        "link:source:1",
        "receipt:stale",
        new Date(at.getTime() + 11_000),
      ),
    ).rejects.toThrow("JIRA_EFFECT_FENCE_REJECTED");

    await effects.beginLookup(recovery, new Date(at.getTime() + 12_000));
    await effects.recordLookup(
      recovery,
      {
        state: "FOUND",
        externalEntityId: "10001",
        matchCount: 1,
        queryHash: "sha256:recovery-query",
      },
      new Date(at.getTime() + 13_000),
    );
    await effects.beginSubEffect(recovery, "link:source:1", new Date(at.getTime() + 14_000));
    await effects.confirmSubEffect(
      recovery,
      "link:source:1",
      "receipt:recovery",
      new Date(at.getTime() + 15_000),
    );

    expect(
      await source.query(
        "SELECT lease_owner,lease_token,attempt,external_entity_id FROM jira_effect_reconciliations WHERE effect_id=$1",
        [effectId],
      ),
    ).toEqual([
      {
        lease_owner: "worker:recovery",
        lease_token: "2",
        attempt: 2,
        external_entity_id: "10001",
      },
    ]);
    expect(
      await source.query(
        "SELECT state,attempt,external_identity FROM jira_effect_sub_effects WHERE semantic_identity='link:source:1'",
      ),
    ).toEqual([
      {
        state: "CONFIRMED",
        attempt: 2,
        external_identity: "receipt:recovery",
      },
    ]);
  }, 120_000);
});
