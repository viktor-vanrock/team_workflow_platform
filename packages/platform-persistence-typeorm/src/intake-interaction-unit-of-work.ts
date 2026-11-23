import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

export interface IntakeInteractionAtomicMutation {
  readonly provenance: unknown;
  readonly domain: unknown;
  readonly interactionResult?: unknown;
  readonly event: unknown;
  readonly command?: unknown;
}
export class InMemoryIntakeInteractionUnitOfWork {
  readonly commits: IntakeInteractionAtomicMutation[] = [];
  async commit(value: IntakeInteractionAtomicMutation): Promise<void> {
    if (!value.provenance || !value.domain || !value.event)
      throw new Error("INTAKE_INTERACTION_ATOMIC_SET_INCOMPLETE");
    this.commits.push(structuredClone(value));
  }
}

export interface DurableProjectOption {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workspaceLabel: string;
  readonly projectLabel: string;
  readonly configurationHash: string;
}
const hash = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const parse = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
export class TypeOrmIntakeInteractionUnitOfWork {
  constructor(private readonly source: DataSource) {}
  async issueProjectOptions(
    input: Readonly<{
      principalId: string;
      oidcSessionId: string;
      continuationVersion: number;
      options: readonly DurableProjectOption[];
      expiresAt: Date;
    }>,
  ) {
    const sessionHash = hash(input.oidcSessionId);
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      await manager.query(
        "UPDATE interaction_intents SET state='INVALIDATED' WHERE actor_principal_id=$1 AND state='PENDING' AND action->>'kind'='PROJECT_SELECT' AND transport->>'oidcSessionHash'=$2 AND (transport->>'continuationVersion')::integer=$3",
        [input.principalId, sessionHash, input.continuationVersion],
      );
      const items = [] as Array<
        Readonly<{
          intentId: string;
          intentToken: string;
          workspaceLabel: string;
          projectLabel: string;
          expiresAt: string;
        }>
      >;
      for (const option of input.options.slice(0, 100)) {
        const intentId = `project-option:${randomUUID()}`;
        const intentToken = randomBytes(32).toString("base64url");
        await manager.query(
          "INSERT INTO interaction_intents(id,workspace_id,project_id,actor_principal_id,action,subject,transport,nonce_hash,token_handling,state,result_ref,result_hash,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING',NULL,NULL,$10,clock_timestamp())",
          [
            intentId,
            option.workspaceId,
            option.projectId,
            input.principalId,
            JSON.stringify({ kind: "PROJECT_SELECT", parameters: { option } }),
            JSON.stringify({
              kind: "PROJECT_SELECTION",
              id: option.projectId,
              version: 1,
              contentHash: option.configurationHash,
            }),
            JSON.stringify({
              kind: "WEB",
              oidcSessionHash: sessionHash,
              continuationVersion: input.continuationVersion,
            }),
            hash(intentToken),
            JSON.stringify({ kind: "RETURN_ONCE" }),
            input.expiresAt,
          ],
        );
        items.push(
          Object.freeze({
            intentId,
            intentToken,
            workspaceLabel: option.workspaceLabel,
            projectLabel: option.projectLabel,
            expiresAt: input.expiresAt.toISOString(),
          }),
        );
      }
      return Object.freeze({ items: Object.freeze(items) });
    });
  }
  async consumeProjectSelection<T>(
    input: Readonly<{
      principalId: string;
      oidcSessionId: string;
      intentId: string;
      intentToken: string;
      requestKey: string;
      reauthorize(manager: EntityManager, option: DurableProjectOption): Promise<boolean>;
      createDraft(
        manager: EntityManager,
        option: DurableProjectOption,
      ): Promise<Readonly<{ id: string; resultRef: string; draft: T }>>;
    }>,
  ) {
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const rows = (await manager.query(
        "SELECT * FROM interaction_intents WHERE id=$1 FOR UPDATE",
        [input.intentId],
      )) as readonly Readonly<Record<string, unknown>>[];
      const row = rows[0];
      if (
        !row ||
        String(row.actor_principal_id) !== input.principalId ||
        parse<Record<string, unknown>>(row.transport).oidcSessionHash !==
          hash(input.oidcSessionId) ||
        String(row.nonce_hash) !== hash(input.intentToken)
      )
        throw new Error("PROJECT_SELECTION_INTENT_DENIED");
      const handling = parse<Record<string, unknown>>(row.token_handling);
      const requestKeyHash = hash(input.requestKey);
      const action = parse<{ parameters: { option: DurableProjectOption } }>(row.action);
      const option = action.parameters.option;
      if (!(await input.reauthorize(manager, option)))
        throw new Error("PROJECT_SELECTION_REAUTHORIZATION_DENIED");
      if (row.state === "CONSUMED") {
        if (handling.requestKeyHash !== requestKeyHash || !row.result_ref)
          throw new Error("PROJECT_SELECTION_REPLAY_CONFLICT");
        return Object.freeze({ draftRef: String(row.result_ref), replayed: true, option });
      }
      if (row.state !== "PENDING" || new Date(String(row.expires_at)) <= new Date())
        throw new Error("PROJECT_SELECTION_INTENT_NOT_PENDING");
      const created = await input.createDraft(manager, option);
      const resultHash = hash(
        JSON.stringify({ resultRef: created.resultRef, draftId: created.id }),
      );
      await manager.query(
        "UPDATE interaction_intents SET state='CONSUMED',result_ref=$2,result_hash=$3,token_handling=$4 WHERE id=$1 AND state='PENDING'",
        [
          input.intentId,
          created.resultRef,
          resultHash,
          JSON.stringify({ ...handling, requestKeyHash }),
        ],
      );
      return Object.freeze({
        draftRef: created.resultRef,
        draftId: created.id,
        draft: created.draft,
        replayed: false,
        option,
      });
    });
  }
  async commitCandidateDecision<TCandidate, TDraft = never>(
    input: Readonly<{
      mutate(manager: EntityManager, draft: TDraft | undefined): Promise<TCandidate>;
      createDraft?(manager: EntityManager): Promise<TDraft>;
      appendEvent(
        manager: EntityManager,
        candidate: TCandidate,
        draft: TDraft | undefined,
      ): Promise<void>;
    }>,
  ) {
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const draft = input.createDraft ? await input.createDraft(manager) : undefined;
      const candidate = await input.mutate(manager, draft);
      await input.appendEvent(manager, candidate, draft);
      return Object.freeze({ candidate, draft });
    });
  }
}
