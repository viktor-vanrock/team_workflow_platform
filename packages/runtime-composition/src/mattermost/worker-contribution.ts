import type { ConnectorCommand } from "@awp/platform-core";

import { defineWorkerContribution, type NamedWorkerContribution } from "../worker/contributions.ts";

export const mattermostWorkerCapabilityKeys = Object.freeze([
  "messaging.intake",
  "messaging.notify",
  "messaging.callback",
] as const);

export function createMattermostWorkerContribution(
  handle: (command: ConnectorCommand) => Promise<unknown>,
): NamedWorkerContribution {
  return defineWorkerContribution({
    key: "mattermost",
    capabilityKeys: mattermostWorkerCapabilityKeys,
    recovery: Object.freeze({ markedEffectPolicy: "LOOKUP_ONLY" }),
    handle,
  });
}
