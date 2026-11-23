export interface RecoveryEffect008 {
  readonly commandId: string;
  readonly provider: "JIRA" | "GITLAB" | "MATTERMOST";
  readonly effectKey: string;
  readonly certainty: "NOT_DISPATCHED" | "POSSIBLY_APPLIED" | "CONFIRMED_APPLIED";
  readonly outboxState: "PENDING" | "DISPATCHED" | "CONFIRMED";
}
export interface ProviderEffectObservation008 {
  readonly effectKey: string;
  readonly state: "MATCH" | "NOT_FOUND" | "DIVERGENT" | "MULTIPLE";
  readonly definitive: boolean;
  readonly observedVersion?: string;
}
export interface ReadOnlyRecoveryProvider008 {
  lookup(effectKey: string): Promise<ProviderEffectObservation008>;
}
export interface RecoveryReconciliation008 {
  readonly status: "PASS" | "BLOCKED";
  readonly actions: readonly {
    readonly commandId: string | null;
    readonly effectKey: string;
    readonly action: "REBUILD_QUEUE" | "CONFIRM" | "RETRY_ORIGINAL" | "QUARANTINE";
    readonly reasonCode: string;
  }[];
  readonly rebuiltQueue: readonly string[];
  readonly unresolvedEffects: readonly string[];
  readonly providerReadCount: number;
  readonly providerWriteCount: 0;
  readonly jiraAuthorityPreserved: true;
}
export async function reconcileRecoveryEffects008(
  effects: readonly RecoveryEffect008[],
  providerOnlyEffectKeys: readonly string[],
  provider: ReadOnlyRecoveryProvider008,
): Promise<RecoveryReconciliation008> {
  if (
    new Set(effects.map((value) => value.commandId)).size !== effects.length ||
    new Set(effects.map((value) => value.effectKey)).size !== effects.length ||
    new Set(providerOnlyEffectKeys).size !== providerOnlyEffectKeys.length
  )
    throw new Error("RECOVERY_EFFECT_INPUT_INVALID");
  const actions: RecoveryReconciliation008["actions"][number][] = [],
    queue: string[] = [],
    unresolved: string[] = [];
  let reads = 0;
  for (const effect of effects) {
    if (effect.certainty === "NOT_DISPATCHED") {
      actions.push({
        commandId: effect.commandId,
        effectKey: effect.effectKey,
        action: "REBUILD_QUEUE",
        reasonCode: "DURABLE_INTENT_NOT_DISPATCHED",
      });
      queue.push(effect.commandId);
      continue;
    }
    if (effect.certainty === "CONFIRMED_APPLIED") {
      actions.push({
        commandId: effect.commandId,
        effectKey: effect.effectKey,
        action: "CONFIRM",
        reasonCode: "DURABLE_RESULT_CONFIRMED",
      });
      continue;
    }
    const observation = await provider.lookup(effect.effectKey);
    reads++;
    if (observation.effectKey !== effect.effectKey)
      throw new Error("RECOVERY_PROVIDER_SCOPE_MISMATCH");
    if (observation.state === "MATCH") {
      actions.push({
        commandId: effect.commandId,
        effectKey: effect.effectKey,
        action: "CONFIRM",
        reasonCode: "PROVIDER_EFFECT_MATCHED",
      });
      continue;
    }
    if (observation.state === "NOT_FOUND" && observation.definitive) {
      actions.push({
        commandId: effect.commandId,
        effectKey: effect.effectKey,
        action: "RETRY_ORIGINAL",
        reasonCode: "PROVIDER_NON_APPLICATION_PROVEN",
      });
      queue.push(effect.commandId);
      continue;
    }
    actions.push({
      commandId: effect.commandId,
      effectKey: effect.effectKey,
      action: "QUARANTINE",
      reasonCode:
        observation.state === "DIVERGENT" ? "PROVIDER_DIVERGENCE" : "PROVIDER_EFFECT_UNRESOLVED",
    });
    unresolved.push(effect.effectKey);
  }
  for (const effectKey of providerOnlyEffectKeys) {
    actions.push({
      commandId: null,
      effectKey,
      action: "QUARANTINE",
      reasonCode: "POST_BACKUP_PROVIDER_EFFECT_WITHOUT_LOCAL_MARKER",
    });
    unresolved.push(effectKey);
  }
  return Object.freeze({
    status: unresolved.length ? "BLOCKED" : "PASS",
    actions: Object.freeze(actions),
    rebuiltQueue: Object.freeze(queue),
    unresolvedEffects: Object.freeze(unresolved),
    providerReadCount: reads,
    providerWriteCount: 0 as const,
    jiraAuthorityPreserved: true as const,
  });
}
