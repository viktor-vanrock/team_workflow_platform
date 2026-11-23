import type { DataSource } from "typeorm";

import {
  MattermostRestClient,
  type MattermostSecretResolver,
  renderMattermostNotification,
  renderMattermostPresentation,
  ShortLivedMattermostCredentialLease,
} from "@awp/connector-mattermost";
import type { MessagingLogicalTarget } from "@awp/connector-sdk";
import type { ConnectorCommand, ProjectEffectGuardPort } from "@awp/platform-core";
import {
  type CommandDeliveryScope,
  TypeOrmCommandDeliveryStore,
} from "@awp/platform-persistence-typeorm";

import { isMattermostLocalComposition, type RuntimeEnvironment } from "../config/environment.ts";
import { TypeOrmProjectEffectGuard } from "../onboarding/project-effect-guard.ts";
import { assertPilotWorkerEffect, type PilotCommandEffectGuard } from "../pilot/effect-guard.ts";
import { classifyPilotFailure, decidePilotRetry } from "../pilot/retry-policy.ts";
import { MattermostConnectionHealthService } from "./connection-health.ts";
import { DurableMattermostNotificationLifecycle } from "./notification-worker.ts";
import { mattermostWorkerCapabilityKeys } from "./worker-contribution.ts";

export interface MattermostWorkerStep {
  run(): Promise<unknown>;
}
export interface MattermostWorkerSteps {
  readonly recovery: MattermostWorkerStep;
  readonly dispatcher: MattermostWorkerStep;
  readonly commands: MattermostWorkerStep;
}

const scopeOf = (command: ConnectorCommand): CommandDeliveryScope =>
  Object.freeze({
    workspaceId: command.workspaceId,
    projectId: command.projectId,
    commandId: command.id,
  });
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);

class MattermostWorkerRuntime {
  readonly #notifications = new DurableMattermostNotificationLifecycle();
  readonly #delivery: TypeOrmCommandDeliveryStore;
  readonly #published: CommandDeliveryScope[] = [];
  constructor(
    private readonly source: DataSource,
    private readonly environment: RuntimeEnvironment,
    private readonly secrets: MattermostSecretResolver,
    private readonly effectGuard: ProjectEffectGuardPort,
    private readonly pilotGuard?: PilotCommandEffectGuard,
  ) {
    this.#delivery = new TypeOrmCommandDeliveryStore(source);
  }

  async dispatch(): Promise<number> {
    const now = new Date();
    const claims = await this.#delivery.claim(
      now,
      new Date(now.getTime() + 15_000),
      20,
      mattermostWorkerCapabilityKeys,
    );
    for (const claim of claims) {
      const command = await this.#delivery.acknowledgeEnqueued(
        claim.outbox,
        now,
        new Date(now.getTime() + 15_000),
      );
      this.#published.push(scopeOf(command));
    }
    return claims.length;
  }

  async work(): Promise<number> {
    const scope = this.#published.shift();
    if (!scope) return 0;
    const queued = await this.#delivery.load(scope);
    if (
      !queued ||
      !mattermostWorkerCapabilityKeys.includes(
        queued.capability.key as (typeof mattermostWorkerCapabilityKeys)[number],
      )
    )
      throw new Error("MATTERMOST_WORKER_CAPABILITY_REJECTED");
    let invocationMarked = false;
    try {
      const denied = await this.#notifications.denial(this.source.manager, queued, new Date());
      if (denied) {
        await this.#delivery.failUndispatched(scope, denied, new Date(), async (manager, current) =>
          this.#notifications.discard(manager, current, denied),
        );
        return 1;
      }
      const resolved = await this.resolve(queued);
      const presentation = this.render(queued);
      await this.effectGuard.assertEffectsAllowed({
        workspaceId: queued.workspaceId,
        projectId: queued.projectId,
      });
      await assertPilotWorkerEffect(
        queued,
        this.pilotGuard,
        this.environment.profile === "non-local" || this.environment.deployment !== undefined,
      );
      const invokedAt = new Date();
      const dispatched = await this.#delivery.markDispatched(
        scope,
        invokedAt,
        30_000,
        {
          evaluatedAt: invokedAt,
          authorizationBasis: queued.initialAuthorizationBasis,
          authorizationBasisHash: queued.initialAuthorizationBasisHash,
        },
        async (manager, current) => this.#notifications.mark(manager, current, new Date()),
      );
      invocationMarked = true;
      let response: unknown;
      await assertPilotWorkerEffect(
        dispatched,
        this.pilotGuard,
        this.environment.profile === "non-local" || this.environment.deployment !== undefined,
      );
      try {
        response = await resolved.client.post("/api/v4/posts", {
          channel_id: resolved.channelId,
          message: presentation.message,
          props: { effectKey: dispatched.effectIdempotencyKey },
        });
      } catch (error) {
        await new MattermostConnectionHealthService(this.source).record({
          workspaceId: dispatched.workspaceId,
          connectionId: resolved.connectionId,
          code: error instanceof Error ? error.message : "MATTERMOST_DELIVERY_FAILED",
          checkedAt: new Date(),
        });
        throw error;
      }
      await this.#delivery.confirmWith(
        scope,
        Object.freeze({
          providerRef: safePostRef(response),
          renderBytes: presentation.bytes.byteLength,
        }),
        new Date(),
        async (manager, current) =>
          this.#notifications.settle(manager, current, "DELIVERED", "DELIVERED"),
        {
          attemptCount: dispatched.attemptCount,
          leaseExpiresAt: dispatched.executionLeaseExpiresAt!,
        },
      );
      await new MattermostConnectionHealthService(this.source).record({
        workspaceId: dispatched.workspaceId,
        connectionId: resolved.connectionId,
        code: "OK",
        checkedAt: new Date(),
      });
      return 1;
    } catch (error) {
      // The invocation marker and LOOKUP_REQUIRED intent commit in the same transaction.
      if (!invocationMarked) {
        const denied = await this.#notifications.denial(this.source.manager, queued, new Date());
        if (denied)
          await this.#delivery.failUndispatched(
            scope,
            denied,
            new Date(),
            async (manager, current) => this.#notifications.discard(manager, current, denied),
          );
      }
      console.error(
        invocationMarked
          ? "MATTERMOST_COMMAND_LOOKUP_REQUIRED"
          : "MATTERMOST_COMMAND_PRE_MARKER_DEFERRED",
        scope.commandId,
        error instanceof Error ? error.message : "UNKNOWN",
      );
      return 0;
    }
  }

  async recover(): Promise<number> {
    const now = new Date();
    await this.#delivery.recoverExpired(now, 50);
    const rows = (await this.source.query(
      `SELECT c.workspace_id,c.project_id,c.id
         FROM connector_commands c
        WHERE c.state='DISPATCHED' AND c.capability_key=ANY($1::text[])
          AND NULLIF(c.payload #>> '{metadata,executionLeaseExpiresAt}','')::timestamptz<=$2
        ORDER BY c.id LIMIT 50`,
      [[...mattermostWorkerCapabilityKeys], now],
    )) as readonly Readonly<{ workspace_id: string; project_id: string; id: string }>[];
    let resolvedCount = 0;
    for (const row of rows) {
      const scope = Object.freeze({
        workspaceId: row.workspace_id,
        projectId: row.project_id,
        commandId: row.id,
      });
      const command = await this.#delivery.load(scope);
      if (!command?.effectInvocationStartedAt) continue;
      if (command.recoveryPolicy === "NONE_AMBIGUOUS") {
        await this.#delivery.fail(
          scope,
          "MATTERMOST_DELIVERY_AMBIGUOUS_LOOKUP_UNSUPPORTED",
          now,
          async (manager, current) =>
            this.#notifications.settle(manager, current, "AMBIGUOUS", "LOOKUP_UNSUPPORTED"),
        );
        resolvedCount += 1;
        continue;
      }
      let claimed: ConnectorCommand | undefined;
      try {
        claimed = await this.#delivery.claimConfirmation(scope, now, 30_000);
        if (!claimed) continue;
        const fence = {
          attemptCount: claimed.attemptCount,
          leaseExpiresAt: claimed.executionLeaseExpiresAt!,
        };
        const { client, channelId } = await this.resolve(claimed);
        const result = json<Readonly<{ posts?: Readonly<Record<string, unknown>> }>>(
          await client.get(
            `/api/v4/posts?effect_key=${encodeURIComponent(command.effectIdempotencyKey)}`,
          ),
        );
        const posts = Object.values(result.posts ?? {});
        const post = posts[0] as
          | {
              channelId?: string;
              channel_id?: string;
              effectKey?: string;
              props?: { effectKey?: string };
            }
          | undefined;
        const exact =
          post &&
          (post.channelId ?? post.channel_id) === channelId &&
          (post.props?.effectKey ?? post.effectKey) === command.effectIdempotencyKey;
        if (posts.length === 1 && exact) {
          await this.#delivery.confirmWith(
            scope,
            Object.freeze({ providerRef: safePostRef(post), reconciled: true }),
            new Date(),
            async (manager, current) =>
              this.#notifications.settle(manager, current, "DELIVERED", "RECONCILED_ONE_MATCH"),
            fence,
          );
        } else {
          const code =
            posts.length === 0
              ? "MATTERMOST_DELIVERY_AMBIGUOUS_ZERO_MATCHES"
              : posts.length > 1
                ? "MATTERMOST_DELIVERY_AMBIGUOUS_MULTIPLE_MATCHES"
                : "MATTERMOST_DELIVERY_LOOKUP_SCOPE_CONFLICT";
          await this.#delivery.fail(
            scope,
            code,
            new Date(),
            async (manager, current) =>
              this.#notifications.settle(manager, current, "AMBIGUOUS", code),
            fence,
          );
        }
        resolvedCount += 1;
      } catch (error) {
        if (claimed) {
          const decision = decidePilotRetry({
            operation: "READ",
            certainty: "NOT_DISPATCHED",
            failure: classifyPilotFailure(error),
            attempt: claimed.attemptCount - 1,
            firstAttemptAt: claimed.effectInvocationStartedAt!.toISOString(),
            now: new Date().toISOString(),
            policy: {
              maximumAttempts: 4,
              minimumBackoffMs: 1000,
              maximumBackoffMs: 30_000,
              maximumElapsedMs: 300_000,
            },
          });
          // The durable 30-second read lease is at least every allowed backoff;
          // retries keep the same command and marker, including after process restart.
          if (decision.action !== "RETRY_ORIGINAL")
            await this.#delivery.fail(
              scope,
              decision.reasonCode,
              new Date(),
              async (manager, current) =>
                this.#notifications.settle(manager, current, "AMBIGUOUS", decision.reasonCode),
              {
                attemptCount: claimed.attemptCount,
                leaseExpiresAt: claimed.executionLeaseExpiresAt!,
              },
            );
        }
        console.error(
          "MATTERMOST_RECONCILIATION_DEFERRED",
          command.id,
          error instanceof Error ? error.message : "UNKNOWN",
        );
      }
    }
    return resolvedCount;
  }

  private render(command: ConnectorCommand) {
    const payload = command.payload as Readonly<Record<string, unknown>>;
    const target = command.target as MessagingLogicalTarget;
    if (command.capability.key === "messaging.notify") {
      return renderMattermostNotification({
        target,
        template: String(payload.template ?? "DELIVERY_HEALTH") as
          "QA_REQUEST_CONFIRMED" | "CANDIDATE_DISCOVERED" | "DELIVERY_HEALTH",
        variables: json(payload.variables ?? {}),
      });
    }
    return renderMattermostPresentation({
      target,
      title: String(payload.title ?? "AWP QA"),
      body: String(payload.body ?? "Action available"),
      actions: Array.isArray(payload.actions)
        ? (payload.actions as readonly Readonly<{ id: string; label: string }>[])
        : [],
    });
  }

  private async resolve(command: ConnectorCommand) {
    const profiles = (await this.source.query(
      "SELECT content FROM connector_profile_revisions WHERE workspace_id=$1 AND header_id=$2 AND version=$3 AND status='PUBLISHED'",
      [command.workspaceId, command.profileRef.id, command.profileRef.version],
    )) as readonly { content: unknown }[];
    const profile = json<Readonly<Record<string, unknown>>>(profiles[0]?.content);
    const connectionRef = json<Readonly<{ id: string; version: number }>>(profile.connectionRef);
    const connections = (await this.source.query(
      "SELECT content FROM connection_revisions WHERE workspace_id=$1 AND header_id=$2 AND version=$3 AND status='PUBLISHED'",
      [command.workspaceId, connectionRef.id, connectionRef.version],
    )) as readonly { content: unknown }[];
    const connection = json<Readonly<Record<string, unknown>>>(connections[0]?.content);
    const baseUrl = String(connection.endpoint ?? "");
    const secretRef = String(connection.botCredentialSecretRef ?? "");
    const channelIds = profile.channelIds as readonly string[] | undefined;
    if (!baseUrl || !secretRef || !channelIds?.[0])
      throw new Error("MATTERMOST_WORKER_CONFIGURATION_INVALID");
    return Object.freeze({
      connectionId: connectionRef.id,
      channelId: channelIds[0],
      client: new MattermostRestClient({
        baseUrl,
        environmentClass: this.environment.environmentScope === "LOCAL" ? "LOCAL" : "DEVELOPMENT",
        allowedHosts: Object.freeze([new URL(baseUrl).hostname]),
        credential: new ShortLivedMattermostCredentialLease(secretRef, this.secrets),
      }),
    });
  }
}

function safePostRef(value: unknown): Readonly<{ kind: "MESSAGE"; opaqueId: string }> {
  const record =
    value && typeof value === "object" ? (value as Readonly<Record<string, unknown>>) : {};
  const id = record.id;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(id))
    throw new Error("MATTERMOST_PROVIDER_POST_ID_REQUIRED");
  return Object.freeze({ kind: "MESSAGE", opaqueId: id });
}

export function createMattermostWorkerSteps(
  source: DataSource,
  environment: RuntimeEnvironment,
  secrets?: MattermostSecretResolver,
  effectGuard: ProjectEffectGuardPort = new TypeOrmProjectEffectGuard(source),
  pilotGuard?: PilotCommandEffectGuard,
): MattermostWorkerSteps {
  if (
    !isMattermostLocalComposition(environment.composition) &&
    environment.composition !== "qa-jira-mattermost-nonprod"
  )
    throw new Error("MATTERMOST_WORKER_COMPOSITION_REQUIRED");
  const resolver =
    secrets ??
    Object.freeze({
      resolve: async (ref: string) => {
        if (
          environment.environmentScope !== "LOCAL" ||
          ref !== "secret-ref:local/mattermost/project-alpha/bot-token"
        )
          throw new Error("MATTERMOST_WORKER_SECRET_DENIED");
        return "local-mock-token";
      },
    });
  const runtime = new MattermostWorkerRuntime(
    source,
    environment,
    resolver,
    effectGuard,
    pilotGuard,
  );
  return Object.freeze({
    recovery: Object.freeze({ run: async () => await runtime.recover() }),
    dispatcher: Object.freeze({ run: async () => await runtime.dispatch() }),
    commands: Object.freeze({ run: async () => await runtime.work() }),
  });
}
