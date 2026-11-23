import { describe, expect, it } from "vitest";

import { type JsonValue, sha256 } from "../../../packages/platform-contracts/src/index.ts";
import {
  type ConnectorCommand,
  InMemoryDurableCommandStore,
} from "../../../packages/platform-core/src/index.ts";
import {
  assessDeadLetterReplay,
  deadLetterCommandHash,
} from "../../../packages/runtime-composition/src/pilot/dead-letter-policy.ts";

const failed = (): ConnectorCommand => {
  const value = InMemoryDurableCommandStore.readyFixture().command();
  return {
    ...value,
    targetHash: sha256(value.target as JsonValue),
    payloadHash: sha256(value.payload as JsonValue),
    status: "FAILED",
    outboxStatus: "DEAD",
    terminalResult: { outcome: "FAILED", code: "JIRA_NETWORK_ERROR" },
  };
};
describe("008 dead-letter replay policy", () => {
  it("permits only an uninvoked original transport failure within its original age budget", () => {
    const command = failed();
    expect(
      assessDeadLetterReplay(command, {
        originalHash: deadLetterCommandHash(command),
        now: command.createdAt.getTime() + 1000,
        expiresAt: command.createdAt.getTime() + 60000,
        replayCount: 0,
        maximumReplays: 2,
      }),
    ).toBe("ELIGIBLE");
    expect(
      assessDeadLetterReplay(command, {
        originalHash: deadLetterCommandHash(command),
        now: command.createdAt.getTime() + 60000,
        expiresAt: command.createdAt.getTime() + 60000,
        replayCount: 0,
        maximumReplays: 2,
      }),
    ).toBe("EXPIRED");
  });
  it("never retries a possibly applied write or resets an invalidated authorization", () => {
    for (const change of [
      { effectInvocationStartedAt: new Date() },
      { effectAuthorizationStatus: "INVALIDATED" as const },
      { status: "CONFLICT" as const },
      { terminalResult: { outcome: "FAILED" as const, code: "BUSINESS_ASSERTION" } },
    ]) {
      const command = { ...failed(), ...change };
      expect(
        assessDeadLetterReplay(command, {
          originalHash: deadLetterCommandHash(command),
          now: 1,
          expiresAt: 60000,
          replayCount: 0,
          maximumReplays: 2,
        }),
      ).not.toBe("ELIGIBLE");
    }
  });
  it("detects changed intent even when an attacker updates its payload hash", () => {
    const command = failed(),
      originalHash = deadLetterCommandHash(command);
    const payload = { message: "changed" };
    for (const altered of [
      { ...command, payload },
      { ...command, payload, payloadHash: sha256(payload) },
      { ...command, effectIdempotencyKey: "new-effect" },
      { ...command, profileRef: { ...command.profileRef, version: 2 } },
    ]) {
      expect(
        assessDeadLetterReplay(altered, {
          originalHash,
          now: 1,
          expiresAt: 60000,
          replayCount: 0,
          maximumReplays: 2,
        }),
      ).toBe("COMMAND_CHANGED");
    }
  });
  it("keeps the same semantic identity across delivery generations and bounds replay count", () => {
    const command = failed();
    const hash = deadLetterCommandHash(command);
    expect(
      deadLetterCommandHash({ ...command, rowVersion: 20, attemptCount: 3, updatedAt: new Date() }),
    ).toBe(hash);
    expect(
      assessDeadLetterReplay(command, {
        originalHash: hash,
        now: 1,
        expiresAt: 60000,
        replayCount: 2,
        maximumReplays: 2,
      }),
    ).toBe("REPLAY_BUDGET_EXHAUSTED");
  });
});
