import { type JiraNormalizedWebhook, normalizeJiraWebhook } from "@awp/connector-jira";
import type { InMemoryExactWebhookInbox } from "@awp/platform-core";

import type {
  AuthoritativeJiraCandidateFact,
  JiraCandidateDiscovery,
} from "./candidate-discovery.ts";

export interface JiraAuthoritativeReadJob {
  readonly connectionId: string;
  readonly externalEntityId: string;
  readonly receiptIdentity: string;
  readonly source: "WEBHOOK_READ";
}
export function jiraAuthoritativeReadInvalidation(
  input: Readonly<{ connectionId: string; deliveryId: string; bodyHash: string; event: unknown }>,
): Readonly<{ normalized: JiraNormalizedWebhook; job: JiraAuthoritativeReadJob }> {
  const normalized = normalizeJiraWebhook({
    connectionId: input.connectionId,
    deliveryId: input.deliveryId,
    canonicalBodyHash: input.bodyHash,
    event: input.event,
  });
  return Object.freeze({
    normalized,
    job: Object.freeze({
      connectionId: input.connectionId,
      externalEntityId: normalized.externalEntityId,
      receiptIdentity: normalized.deliveryIdentity,
      source: "WEBHOOK_READ",
    }),
  });
}
export class JiraWebhookHandler {
  constructor(private readonly inbox: InMemoryExactWebhookInbox) {}
  async accept(
    input: Readonly<{
      connectionId: string;
      deliveryId: string;
      rawBytes: Uint8Array;
      bodyHash: string;
      contentType: string;
      receivedAt: Date;
      event: unknown;
    }>,
  ): Promise<
    Readonly<{
      status: "ACCEPTED" | "DUPLICATE";
      normalized: JiraNormalizedWebhook;
      job: JiraAuthoritativeReadJob;
    }>
  > {
    const persisted = await this.inbox.persist(input);
    const normalized = normalizeJiraWebhook({
      connectionId: input.connectionId,
      deliveryId: input.deliveryId,
      canonicalBodyHash: input.bodyHash,
      event: input.event,
    });
    return Object.freeze({
      status: persisted.status,
      normalized,
      job: Object.freeze({
        connectionId: input.connectionId,
        externalEntityId: normalized.externalEntityId,
        receiptIdentity: normalized.deliveryIdentity,
        source: "WEBHOOK_READ",
      }),
    });
  }
}

export class JiraWebhookLifecycle {
  constructor(
    private readonly config: Readonly<{
      activeKeyVersion: string;
      overlapKeyVersions: readonly string[];
      expiresAt: Date;
    }>,
  ) {}
  verify(
    input: Readonly<{
      family: "CLOUD" | "DC";
      deliveryId?: string;
      bodyHash: string;
      changelogId?: string;
      verifiedKeyVersion: string;
      now: Date;
    }>,
  ) {
    if (input.now >= this.config.expiresAt) throw new Error("WEBHOOK_REGISTRATION_EXPIRED");
    if (
      input.verifiedKeyVersion !== this.config.activeKeyVersion &&
      !this.config.overlapKeyVersions.includes(input.verifiedKeyVersion)
    )
      throw new Error("WEBHOOK_SECRET_VERSION_REJECTED");
    const identity =
      input.family === "CLOUD"
        ? input.deliveryId
        : input.changelogId
          ? `${input.changelogId}:${input.bodyHash}`
          : input.bodyHash;
    if (!identity) throw new Error("WEBHOOK_DELIVERY_ID_REQUIRED");
    return Object.freeze({
      identity,
      health: "CURRENT" as const,
      keyVersion: input.verifiedKeyVersion,
    });
  }
}
export class JiraCandidateWebhookHandler {
  constructor(
    private readonly read: (
      job: JiraAuthoritativeReadJob,
    ) => Promise<AuthoritativeJiraCandidateFact>,
    private readonly discovery: JiraCandidateDiscovery,
  ) {}
  async handle(job: JiraAuthoritativeReadJob) {
    return await this.discovery.discover(await this.read(job));
  }
}
