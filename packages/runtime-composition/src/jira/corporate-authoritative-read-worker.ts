import { randomUUID } from "node:crypto";
import type { DataSource, EntityManager } from "typeorm";
import {
  TypeOrmJiraAuthoritativeReadOutboxRepository,
  type JiraAuthoritativeReadOutboxClaim,
} from "@awp/connector-jira-persistence-typeorm";
import type { RuntimeEnvironment } from "../config/environment.ts";

export interface CorporateJiraAuthoritativeReadHandler {
  /** Loads current published mapping, reads Jira via corporate factory and validates the observation. */
  read(claim: JiraAuthoritativeReadOutboxClaim): Promise<(manager: EntityManager) => Promise<void>>;
}

/** No webhook payload is accepted as a provider observation. */
export function createCorporateJiraAuthoritativeReadWorker(
  input: Readonly<{
    source: DataSource;
    environment: RuntimeEnvironment;
    handler: CorporateJiraAuthoritativeReadHandler;
  }>,
) {
  const deployment = input.environment.deployment;
  if (
    !input.source.isInitialized ||
    input.environment.profile !== "non-local" ||
    input.environment.environmentScope !== "NON_PROD" ||
    !deployment ||
    typeof input.handler?.read !== "function"
  )
    throw new Error("CORPORATE_JIRA_READ_AUTHORITY_REQUIRED");
  const scope = { workspaceId: deployment.workspaceId, projectIds: deployment.projectIds };
  const outbox = new TypeOrmJiraAuthoritativeReadOutboxRepository(input.source);
  const owner = randomUUID();
  return {
    recover: async () => await outbox.recoverExpired(new Date(), 50, scope),
    run: async () => {
      const now = new Date();
      const claim = await outbox.claim(now, new Date(now.getTime() + 30_000), owner, scope);
      if (!claim) return 0;
      try {
        const apply = await input.handler.read(claim);
        if (typeof apply !== "function") throw new Error("CORPORATE_JIRA_OBSERVATION_INVALID");
        await outbox.complete(claim, new Date(), apply);
        return 1;
      } catch {
        const delay = Math.min(60_000, 5000 * 2 ** Math.min(claim.attemptCount - 1, 4));
        await outbox.release(claim, new Date(Date.now() + delay), async () => undefined);
        console.error("CORPORATE_JIRA_AUTHORITATIVE_READ_DEFERRED");
        return 0;
      }
    },
  };
}
