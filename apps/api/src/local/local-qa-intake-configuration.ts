import type { DataSource } from "typeorm";

import { qaAggregateSnapshotHash } from "@awp/competency-qa/node";
import {
  deriveQaJiraRequestCreateCommandIdentity,
  loadEnvironment,
  localPersonaIds,
  qaLocalFixtureCatalog,
  qaLocalSeedIds,
  resolveLocalQaProjectConfiguration,
  resolveQaJiraRequestCreateConfiguration,
} from "@awp/runtime-composition";

import type { QaIntakeConfiguration } from "../extensions/qa-intake-configuration.ts";

export function createLocalQaIntakeConfiguration(
  source: DataSource,
  mode: "INLINE_LOCAL" | "DURABLE_WORKER",
): QaIntakeConfiguration {
  if (!["local", "test"].includes(process.env.AWP_RUNTIME_PROFILE ?? ""))
    throw new Error("LOCAL_QA_CONFIGURATION_FORBIDDEN");
  const environment = loadEnvironment();
  return {
    load: async (scope) => {
      const resolved =
        mode === "DURABLE_WORKER"
          ? await resolveLocalQaProjectConfiguration(source, scope)
          : undefined;
      const bindingRef = resolved?.bindingRef ?? { id: qaLocalSeedIds.alphaBinding, version: 2 };
      const profileRef = resolved?.profileRef ?? { id: qaLocalSeedIds.profile, version: 2 };
      return {
        bindingRef,
        profileRef,
        projectContextId: resolved?.projectContextId ?? qaLocalSeedIds.context,
        ...(resolved &&
        "authorityScopeKey" in resolved &&
        typeof resolved.authorityScopeKey === "string"
          ? { authorityScopeKey: resolved.authorityScopeKey }
          : {}),
        ...(mode === "INLINE_LOCAL"
          ? {
              inlineService: {
                kind: "SERVICE" as const,
                principalId: localPersonaIds["worker.local"],
                serviceKey: "worker.local",
              },
            }
          : {}),
        commandIdentity: async (input) =>
          deriveQaJiraRequestCreateCommandIdentity({
            ...input,
            pins: (
              await resolveQaJiraRequestCreateConfiguration(source, {
                ...scope,
                bindingRef,
                profileRef,
                environment,
              })
            ).pinSet,
          }),
        responseChannels: {
          resolve: async ({ requester, evaluatedAt }) => {
            const fixture =
              qaLocalFixtureCatalog.responseChannels[
                requester.subject as keyof typeof qaLocalFixtureCatalog.responseChannels
              ];
            const policy = {
              key: "qa.response-channel-resolution",
              version: "1.0.0",
              contentHash: qaAggregateSnapshotHash({
                key: "qa.response-channel-resolution",
                version: "1.0.0",
              }),
            };
            return fixture?.state === "CONFIRMED"
              ? {
                  state: "CONFIRMED",
                  requesterPrincipal: requester,
                  resolutionPolicyRef: policy,
                  responseChannelRef: {
                    channelKind: "PLATFORM_WEB",
                    channelId: fixture.channelId,
                    version: fixture.version,
                    contentHash: qaAggregateSnapshotHash(fixture),
                  },
                  evaluatedAt,
                }
              : {
                  state: "MISSING",
                  requesterPrincipal: requester,
                  resolutionPolicyRef: policy,
                  evaluatedAt,
                  missingReasonCode: "REQUESTER_RESPONSE_CHANNEL_MISSING",
                };
          },
        },
      };
    },
  };
}
