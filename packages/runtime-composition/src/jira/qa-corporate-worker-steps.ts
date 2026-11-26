import { createHash, randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";

import type { QaOperationalRequestCreateResult } from "@awp/competency-qa/node";
import {
  JiraEffectRepository,
  PersistentJiraRequestCreatePort,
  PersistentJiraRequestSubEffectStore,
} from "@awp/connector-jira-persistence-typeorm";
import type {
  ConnectorRuntimeContext,
  OperationalRequestCreateInput,
  OperationalWorkItemTarget,
} from "@awp/connector-sdk";
import {
  defaultClassificationCatalog,
  type ConnectorCommand,
  type CompleteOperationalObservation,
} from "@awp/platform-core";
import {
  TypeOrmCommandDeliveryStore,
  type CommandDeliveryScope,
} from "@awp/platform-persistence-typeorm";

import type { RuntimeEnvironment } from "../config/environment.ts";
import type { CorporateConnectorGrant } from "../pilot/connector-authority.ts";
import type { CorporateConnectorFactories } from "../pilot/connector-factories.ts";
import type { CorporateWorkerCommandContext } from "../pilot/worker-command-context.ts";
import { qaUs1OperationalRoute } from "../qa/operational-composition.ts";
import {
  materializeQaJiraRequestConfirmation,
  resolveAndPinQaJiraCommand,
} from "./qa-command-materializer.ts";
import type { QaJiraResolvedPins } from "./qa-command-materializer.ts";
import { createUnresolvedCorporateQaResponseChannels } from "./corporate-response-channels.ts";
import {
  createQaJiraPinnedOperationalBrokerMap,
  createQaJiraPinnedRequestCreatePort,
} from "./qa-operational-broker.ts";
import { revalidateQaJiraRequestCreateEffect } from "./qa-worker-effect-gate.ts";

const scopeOf = (command: ConnectorCommand): CommandDeliveryScope => ({
  workspaceId: command.workspaceId,
  projectId: command.projectId,
  commandId: command.id,
});
const stableUuid = (value: string) => {
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hash[12] = "4";
  hash[16] = ((Number.parseInt(hash[16]!, 16) & 3) | 8).toString(16);
  return `${hash.slice(0, 8).join("")}-${hash.slice(8, 12).join("")}-${hash.slice(12, 16).join("")}-${hash.slice(16, 20).join("")}-${hash.slice(20).join("")}`;
};

export interface CorporateJiraCreateObservationAuthority {
  read(
    command: ConnectorCommand,
    pins: QaJiraResolvedPins,
    result: QaOperationalRequestCreateResult,
  ): Promise<CompleteOperationalObservation>;
}

/** Non-local request.create only. Other Jira operations remain for their own scoped consumers. */
export function createQaJiraCorporateWorkerSteps(
  input: Readonly<{
    source: DataSource;
    environment: RuntimeEnvironment;
    grants: readonly CorporateConnectorGrant[];
    factories: CorporateConnectorFactories;
    commands: CorporateWorkerCommandContext;
    createObservation: CorporateJiraCreateObservationAuthority;
  }>,
) {
  const deployment = input.environment.deployment;
  if (
    !input.source.isInitialized ||
    input.environment.profile !== "non-local" ||
    input.environment.environmentScope !== "NON_PROD" ||
    !deployment ||
    typeof input.createObservation?.read !== "function"
  )
    throw new Error("CORPORATE_JIRA_WORKER_REQUIRED");
  const filter = {
    workspaceId: deployment.workspaceId,
    projectIds: deployment.projectIds,
    operations: ["request.create"],
  };
  const delivery = new TypeOrmCommandDeliveryStore(input.source);
  const effects = new JiraEffectRepository(input.source);
  const owner = randomUUID();
  const pending: CommandDeliveryScope[] = [];
  const bindingFor = (command: ConnectorCommand) => {
    const grants = input.grants.filter(
      ({ binding, integrationBindingRef }) =>
        binding.provider === "JIRA" &&
        binding.workspaceId === command.workspaceId &&
        binding.projectId === command.projectId &&
        integrationBindingRef.id === command.bindingRef.id &&
        integrationBindingRef.version === command.bindingRef.version &&
        binding.profileRef.id === command.profileRef.id &&
        binding.profileRef.version === command.profileRef.version,
    );
    if (grants.length !== 1) throw new Error("CORPORATE_JIRA_BINDING_REQUIRED");
    return grants[0]!;
  };
  return Object.freeze({
    recovery: Object.freeze({
      run: async () => (await delivery.recoverExpired(new Date(), 50, filter)).length,
    }),
    dispatcher: Object.freeze({
      run: async () => {
        const now = new Date();
        const claims = await delivery.claim(
          now,
          new Date(now.getTime() + 15_000),
          20,
          ["operational-work-item"],
          filter,
        );
        for (const claim of claims)
          pending.push(
            scopeOf(
              await delivery.acknowledgeEnqueued(
                claim.outbox,
                now,
                new Date(now.getTime() + 15_000),
              ),
            ),
          );
        return claims.length;
      },
    }),
    commands: Object.freeze({
      run: async () => {
        const scope = pending.shift();
        if (!scope) return 0;
        const command = await delivery.load(scope);
        if (!command) throw new Error("CORPORATE_JIRA_COMMAND_NOT_FOUND");
        try {
          await input.commands.guard.assertCommandAllowed(command);
          const grant = bindingFor(command);
          const pins = await resolveAndPinQaJiraCommand(input.source, command, input.environment);
          if (
            pins.connectionRef.id !== grant.binding.connectionRef.id ||
            pins.connectionRef.version !== grant.binding.connectionRef.version
          )
            throw new Error("CORPORATE_JIRA_CONFIGURATION_CONFLICT");
          const gate = await revalidateQaJiraRequestCreateEffect(input.source, command, pins);
          const dispatched = await delivery.markDispatched(scope, gate.evaluatedAt, 30_000, gate);
          if (!dispatched.executionLeaseExpiresAt) throw new Error("CORPORATE_JIRA_LEASE_REQUIRED");
          await effects.ensure({
            id: stableUuid(`jira-effect:${dispatched.effectIdempotencyKey}`),
            commandId: dispatched.id,
            effectId: dispatched.effectIdempotencyKey,
            connectionRef: pins.connectionRef,
            profileRef: pins.profileRef,
            operation: dispatched.capability.operation,
            targetHash: dispatched.targetHash,
            payloadHash: dispatched.payloadHash,
            marker: dispatched.effectIdempotencyKey,
            now: gate.evaluatedAt,
          });
          const claim = await effects.claim(
            dispatched.effectIdempotencyKey,
            `${owner}:${dispatched.attemptCount}`,
            new Date(),
            dispatched.executionLeaseExpiresAt,
          );
          const transport = input.factories.jiraTransport(grant.binding.ref.id);
          const broker = createQaJiraPinnedOperationalBrokerMap(pins, transport, {
            port: new PersistentJiraRequestCreatePort(
              createQaJiraPinnedRequestCreatePort(pins, transport),
              effects,
              claim,
            ),
            receipts: new PersistentJiraRequestSubEffectStore(effects, claim),
          });
          const context: ConnectorRuntimeContext = {
            scope: {
              kind: "PROJECT",
              workspaceId: command.workspaceId,
              projectId: command.projectId,
            },
            actor: {
              kind: "SERVICE",
              principalId: grant.binding.servicePrincipalId,
              serviceKey: grant.serviceIdentity.serviceKey,
            },
            correlationId: command.correlationId,
            causationId: command.causationId,
            effectIdempotencyKey: command.effectIdempotencyKey,
            profileRef: command.profileRef,
            classification: defaultClassificationCatalog.reference(command.dataClassificationKey),
            signal: new AbortController().signal,
          };
          const result = await input.commands.run(
            dispatched,
            async () =>
              await broker[qaUs1OperationalRoute].invoke(
                context,
                dispatched.target as OperationalWorkItemTarget,
                dispatched.payload as OperationalRequestCreateInput,
              ),
          );
          const observation = await input.createObservation.read(
            dispatched,
            pins,
            result as QaOperationalRequestCreateResult,
          );
          await delivery.confirmWith(
            scope,
            result,
            new Date(),
            async (manager, current) =>
              await materializeQaJiraRequestConfirmation(
                input.source,
                manager,
                current,
                result as QaOperationalRequestCreateResult,
                pins,
                observation,
                createUnresolvedCorporateQaResponseChannels(),
              ),
            {
              attemptCount: dispatched.attemptCount,
              leaseExpiresAt: dispatched.executionLeaseExpiresAt,
            },
          );
          return 1;
        } catch {
          // Never log provider errors or tokens. Durable recovery preserves marked-effect semantics.
          console.error("CORPORATE_JIRA_COMMAND_DEFERRED");
          return 0;
        }
      },
    }),
  });
}
