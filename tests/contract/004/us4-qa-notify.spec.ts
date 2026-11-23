import { describe, expect, it } from "vitest";

import { deterministicQaNotificationIntent } from "../../../packages/competency-qa/src/index.ts";
import { qaNotifySkillContribution } from "../../../packages/runtime-composition/src/index.ts";

const input = () => ({
  notificationIntentId: "notification-1",
  workspaceId: "w",
  projectId: "p",
  subjectRef: "WORK_ITEM:wi",
  sourceEventRef: "event:1",
  sourceEventFingerprint: "sha256:event",
  target: { kind: "PROJECT_CHANNEL" as const, purpose: "QA_COORDINATION" as const },
  deliveryKind: "MESSAGE" as const,
  templateRef: "qa.delivery-health@1",
  variables: { status: "READY" },
  classification: "INTERNAL" as const,
  policyAllowed: true,
  agentRunId: "run",
  expiresAt: new Date("2026-09-03"),
  now: new Date("2026-09-01"),
});
describe("qa-notify@1.0.0", () => {
  it("creates a NotificationIntent proposal only with one closed action", () => {
    expect(qaNotifySkillContribution).toMatchObject({
      fallback: "DENY",
      definitions: [
        {
          key: "qa-notify",
          actionAllowlist: [
            { action: "notification.intent.create", effectClass: "NOTIFICATION_INTENT" },
          ],
        },
      ],
    });
    expect(deterministicQaNotificationIntent(input())).toMatchObject({
      schemaVersion: "notification-intent@1.0.0",
      state: "PENDING",
      delivery: { kind: "MESSAGE", capabilityKey: "messaging.notify@1.0.0" },
      fallback: "DENY",
    });
  });
  it("denies instead of falling back when policy fails", () =>
    expect(() => deterministicQaNotificationIntent({ ...input(), policyAllowed: false })).toThrow(
      "QA_NOTIFY_POLICY_DENIED",
    ));
});
