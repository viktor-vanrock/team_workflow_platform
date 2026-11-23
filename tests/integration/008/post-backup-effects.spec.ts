import { describe, expect, it } from "vitest";

import { reconcileRecoveryEffects008 } from "../../../packages/runtime-composition/src/recovery/reconcile.ts";

describe("008 post-backup effect recovery", () => {
  it("rebuilds durable queue state, uses delayed readback and never repeats an uncertain POST", async () => {
    let reads = 0;
    const result = await reconcileRecoveryEffects008(
      [
        {
          commandId: "pending",
          provider: "JIRA",
          effectKey: "effect-pending",
          certainty: "NOT_DISPATCHED",
          outboxState: "PENDING",
        },
        {
          commandId: "uncertain",
          provider: "JIRA",
          effectKey: "effect-uncertain",
          certainty: "POSSIBLY_APPLIED",
          outboxState: "DISPATCHED",
        },
      ],
      ["effect-after-backup"],
      {
        lookup: async (effectKey) => {
          reads++;
          await Promise.resolve();
          return { effectKey, state: "MATCH", definitive: true, observedVersion: "jira-43" };
        },
      },
    );
    expect(result).toMatchObject({
      status: "BLOCKED",
      rebuiltQueue: ["pending"],
      unresolvedEffects: ["effect-after-backup"],
      providerReadCount: 1,
      providerWriteCount: 0,
      jiraAuthorityPreserved: true,
    });
    expect(reads).toBe(1);
    expect(result.providerWriteCount).toBe(0);
    expect(result.actions).toEqual(
      expect.arrayContaining([
        {
          commandId: "uncertain",
          effectKey: "effect-uncertain",
          action: "CONFIRM",
          reasonCode: "PROVIDER_EFFECT_MATCHED",
        },
        {
          commandId: null,
          effectKey: "effect-after-backup",
          action: "QUARANTINE",
          reasonCode: "POST_BACKUP_PROVIDER_EFFECT_WITHOUT_LOCAL_MARKER",
        },
      ]),
    );
  });
  it("quarantines delayed absence and retries only a definitive non-application under the original command", async () => {
    const effect = {
      commandId: "uncertain",
      provider: "GITLAB" as const,
      effectKey: "effect",
      certainty: "POSSIBLY_APPLIED" as const,
      outboxState: "DISPATCHED" as const,
    };
    const delayed = await reconcileRecoveryEffects008([effect], [], {
      lookup: async (key) => ({ effectKey: key, state: "NOT_FOUND", definitive: false }),
    });
    expect(delayed).toMatchObject({ status: "BLOCKED", rebuiltQueue: [], providerWriteCount: 0 });
    const definitive = await reconcileRecoveryEffects008([effect], [], {
      lookup: async (key) => ({ effectKey: key, state: "NOT_FOUND", definitive: true }),
    });
    expect(definitive).toMatchObject({
      status: "PASS",
      rebuiltQueue: ["uncertain"],
      providerWriteCount: 0,
    });
  });
});
