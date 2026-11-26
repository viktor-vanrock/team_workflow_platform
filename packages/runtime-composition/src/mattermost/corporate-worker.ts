import type { DataSource } from "typeorm";

import { renderMattermostNotification } from "@awp/connector-mattermost";
import type { MessagingLogicalTarget } from "@awp/connector-sdk";
import type { ConnectorCommand } from "@awp/platform-core";
import {
  type CommandDeliveryScope,
  type CommandEffectGateEvidence,
  TypeOrmCommandDeliveryStore,
} from "@awp/platform-persistence-typeorm";

import type { RuntimeEnvironment } from "../config/environment.ts";
import { integrationConfigurationHash } from "../onboarding/configuration-hash.ts";
import type { CorporateConnectorGrant } from "../pilot/connector-authority.ts";
import type { CorporateConnectorFactories } from "../pilot/connector-factories.ts";
import type { CorporateWorkerCommandContext } from "../pilot/worker-command-context.ts";
import { resolveCorporateMattermostChannel } from "./corporate-channel.ts";
import { DurableMattermostNotificationLifecycle } from "./notification-worker.ts";

export interface CorporateMattermostCommandAuthority {
  /** Rechecks the initiating actor's current rights and the exact command before dispatch. */
  revalidate(command: ConnectorCommand): Promise<CommandEffectGateEvidence>;
}
export interface CorporateMattermostTemplateAuthority {
  /** Verifies exact published template, variables schema and render commitment for the command. */
  verify(command: ConnectorCommand, profile: Readonly<Record<string, unknown>>): Promise<boolean>;
}
const commandScope = (command: ConnectorCommand): CommandDeliveryScope => ({
  workspaceId: command.workspaceId,
  projectId: command.projectId,
  commandId: command.id,
});

/** Sends only scoped project-channel notifications with server-pinned configuration. */
export function createCorporateMattermostWorkerSteps(
  input: Readonly<{
    source: DataSource;
    environment: RuntimeEnvironment;
    grants: readonly CorporateConnectorGrant[];
    factories: CorporateConnectorFactories;
    commands: CorporateWorkerCommandContext;
    authority: CorporateMattermostCommandAuthority;
    templates: CorporateMattermostTemplateAuthority;
  }>,
) {
  const deployment = input.environment.deployment;
  if (
    !input.source.isInitialized ||
    input.environment.profile !== "non-local" ||
    input.environment.environmentScope !== "NON_PROD" ||
    !deployment ||
    typeof input.authority?.revalidate !== "function" ||
    typeof input.templates?.verify !== "function"
  )
    throw new Error("CORPORATE_MATTERMOST_WORKER_REQUIRED");
  const filter = {
    workspaceId: deployment.workspaceId,
    projectIds: deployment.projectIds,
    operations: ["notification.send"],
  };
  const delivery = new TypeOrmCommandDeliveryStore(input.source);
  const lifecycle = new DurableMattermostNotificationLifecycle();
  const pending: CommandDeliveryScope[] = [];
  async function resolve(command: ConnectorCommand) {
    const grants = input.grants.filter(
      ({ binding, integrationBindingRef }) =>
        binding.provider === "MATTERMOST" &&
        binding.workspaceId === command.workspaceId &&
        binding.projectId === command.projectId &&
        integrationBindingRef.id === command.bindingRef.id &&
        integrationBindingRef.version === command.bindingRef.version &&
        binding.profileRef.id === command.profileRef.id &&
        binding.profileRef.version === command.profileRef.version,
    );
    if (grants.length !== 1) throw new Error("CORPORATE_MATTERMOST_BINDING_REQUIRED");
    const grant = grants[0]!;
    const rows = (await input.source.query(
      `SELECT r.content,r.content_hash FROM connector_profile_headers h
      JOIN connector_profile_revisions r ON (r.workspace_id,r.header_id,r.version)=(h.workspace_id,h.id,h.current_published_version)
      WHERE h.workspace_id=$1 AND h.id=$2 AND r.version=$3 AND r.status='PUBLISHED'`,
      [command.workspaceId, grant.binding.profileRef.id, grant.binding.profileRef.version],
    )) as readonly { content: Record<string, unknown>; content_hash: string }[];
    if (
      rows.length !== 1 ||
      rows[0]!.content_hash !== grant.binding.profileRef.contentHash ||
      integrationConfigurationHash("connector_profile", rows[0]!.content) !==
        grant.binding.profileRef.contentHash
    )
      throw new Error("CORPORATE_MATTERMOST_PROFILE_STALE");
    const content = rows[0]!.content;
    const profileEnvelope = (
      content.profileConfiguration && typeof content.profileConfiguration === "object"
        ? content.profileConfiguration
        : content
    ) as Record<string, unknown>;
    const profile = (
      profileEnvelope.value && typeof profileEnvelope.value === "object"
        ? profileEnvelope.value
        : profileEnvelope
    ) as Record<string, unknown>;
    if (
      profile.reconciliationMode !== "NONE_AMBIGUOUS" ||
      command.recoveryPolicy !== "NONE_AMBIGUOUS"
    )
      throw new Error("MATTERMOST_CORPORATE_RECONCILIATION_NOT_IMPLEMENTED");
    if (!(await input.templates.verify(command, profile)))
      throw new Error("MATTERMOST_CORPORATE_TEMPLATE_EVIDENCE_REQUIRED");
    const channelId = resolveCorporateMattermostChannel({
      workspaceId: command.workspaceId,
      projectId: command.projectId,
      target: command.target as MessagingLogicalTarget,
      classificationKey: command.dataClassificationKey,
      profile,
    });
    return {
      channelId,
      client: input.factories.mattermost(grant.binding.ref.id, "CONNECTOR_WRITE"),
    };
  }
  return {
    dispatcher: {
      async run() {
        const now = new Date();
        const claims = await delivery.claim(
          now,
          new Date(now.getTime() + 15_000),
          20,
          ["messaging.notify"],
          filter,
        );
        for (const claim of claims)
          pending.push(
            commandScope(
              await delivery.acknowledgeEnqueued(
                claim.outbox,
                now,
                new Date(now.getTime() + 15_000),
              ),
            ),
          );
        return claims.length;
      },
    },
    commands: {
      async run() {
        const scope = pending.shift();
        if (!scope) return 0;
        const command = await delivery.load(scope);
        if (!command) throw new Error("CORPORATE_MATTERMOST_COMMAND_NOT_FOUND");
        try {
          if (
            command.capability.key !== "messaging.notify" ||
            command.capability.operation !== "notification.send" ||
            command.capability.exactContractVersion !== "1.0.0"
          )
            throw new Error("CORPORATE_MATTERMOST_COMMAND_INVALID");
          const denied = await lifecycle.denial(input.source.manager, command, new Date());
          if (denied) {
            await delivery.failUndispatched(
              scope,
              denied,
              new Date(),
              async (manager, current) => await lifecycle.discard(manager, current, denied),
            );
            return 1;
          }
          await input.commands.guard.assertCommandAllowed(command);
          const gate = await input.authority.revalidate(command);
          const { client, channelId } = await resolve(command);
          const payload = command.payload as Record<string, unknown>;
          const rendered = renderMattermostNotification({
            target: command.target as MessagingLogicalTarget,
            template: String(payload.template ?? "DELIVERY_HEALTH") as
              "QA_REQUEST_CONFIRMED" | "CANDIDATE_DISCOVERED" | "DELIVERY_HEALTH",
            variables: (payload.variables ?? {}) as Record<string, unknown>,
          });
          const now = new Date();
          const dispatched = await delivery.markDispatched(
            scope,
            now,
            30_000,
            gate,
            async (manager, current) => await lifecycle.mark(manager, current, now),
          );
          const response = await input.commands.run(dispatched, async () => {
            await input.authority.revalidate(dispatched);
            return await client.post("/api/v4/posts", {
              channel_id: channelId,
              message: rendered.message,
              props: { effectKey: dispatched.effectIdempotencyKey },
            });
          });
          const postId = (response as { id?: unknown } | null)?.id;
          if (
            typeof postId !== "string" ||
            !/^[A-Za-z0-9_-]{1,128}$/u.test(postId) ||
            !dispatched.executionLeaseExpiresAt
          )
            throw new Error("MATTERMOST_PROVIDER_POST_ID_REQUIRED");
          await delivery.confirmWith(
            scope,
            {
              providerRef: { kind: "MESSAGE", opaqueId: postId },
              renderBytes: rendered.bytes.byteLength,
            },
            new Date(),
            async (manager, current) =>
              await lifecycle.settle(manager, current, "DELIVERED", "DELIVERED"),
            {
              attemptCount: dispatched.attemptCount,
              leaseExpiresAt: dispatched.executionLeaseExpiresAt,
            },
          );
          return 1;
        } catch {
          // After dispatch the outcome is uncertain; recovery never sends a second POST.
          console.error("CORPORATE_MATTERMOST_COMMAND_DEFERRED");
          return 0;
        }
      },
    },
    recovery: {
      async run() {
        const now = new Date();
        await delivery.recoverExpired(now, 50, filter);
        const rows = (await input.source.query(
          `SELECT c.workspace_id,c.project_id,c.id FROM connector_commands c
        WHERE c.workspace_id=$1 AND c.project_id=ANY($2::uuid[]) AND c.state='DISPATCHED'
          AND c.capability_key='messaging.notify' AND c.operation='notification.send'
          AND NULLIF(c.payload #>> '{metadata,executionLeaseExpiresAt}','')::timestamptz<=$3
        ORDER BY c.id LIMIT 50`,
          [filter.workspaceId, filter.projectIds, now],
        )) as readonly { workspace_id: string; project_id: string; id: string }[];
        let count = 0;
        for (const row of rows) {
          const scope = {
            workspaceId: row.workspace_id,
            projectId: row.project_id,
            commandId: row.id,
          };
          const current = await delivery.load(scope);
          if (!current?.effectInvocationStartedAt) continue;
          if (current.recoveryPolicy === "NONE_AMBIGUOUS") {
            await delivery.fail(
              scope,
              "MATTERMOST_DELIVERY_AMBIGUOUS_LOOKUP_UNSUPPORTED",
              now,
              async (manager, command) =>
                await lifecycle.settle(manager, command, "AMBIGUOUS", "LOOKUP_UNSUPPORTED"),
            );
            count++;
            continue;
          }
          // Lookup-required commands remain pending until an evidence-backed lookup is configured.
        }
        return count;
      },
    },
  };
}
