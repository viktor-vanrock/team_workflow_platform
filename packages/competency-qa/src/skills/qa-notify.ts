import { type JsonValue, sha256 } from "@awp/platform-contracts";

export type QaNotifyTarget =
  | Readonly<{ kind: "PROJECT_CHANNEL"; purpose: "INTAKE" | "REQUEST_STATUS" | "QA_COORDINATION" }>
  | Readonly<{ kind: "PRINCIPAL_DM"; principalId: string }>
  | Readonly<{ kind: "INTERACTION_RESPONSE"; sourceInteractionIntentId: string }>;

export function deterministicQaNotificationIntent(
  input: Readonly<{
    notificationIntentId: string;
    workspaceId: string;
    projectId: string;
    subjectRef: string;
    sourceEventRef: string;
    sourceEventFingerprint: string;
    target: QaNotifyTarget;
    deliveryKind: "MESSAGE" | "INTERACTION_PRESENTATION";
    templateRef: string;
    variables: Readonly<Record<string, JsonValue>>;
    classification: "PUBLIC" | "INTERNAL";
    policyAllowed: boolean;
    agentRunId: string;
    expiresAt: Date;
    now: Date;
  }>,
) {
  if (!input.policyAllowed) throw new Error("QA_NOTIFY_POLICY_DENIED");
  if (
    input.deliveryKind === "INTERACTION_PRESENTATION" &&
    input.target.kind === "INTERACTION_RESPONSE"
  )
    throw new Error("QA_NOTIFY_PRESENTATION_TARGET_INVALID");
  const variablesHash = sha256(input.variables as JsonValue);
  const deduplicationKey = sha256({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    sourceEventFingerprint: input.sourceEventFingerprint,
    target: input.target,
  } as unknown as JsonValue);
  return Object.freeze({
    schemaVersion: "notification-intent@1.0.0",
    notificationIntentId: input.notificationIntentId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    sourceEventRef: input.sourceEventRef,
    subjectRef: input.subjectRef,
    target: structuredClone(input.target),
    delivery: Object.freeze({
      kind: input.deliveryKind,
      capabilityKey:
        input.deliveryKind === "MESSAGE" ? "messaging.notify@1.0.0" : "messaging.callback@1.0.0",
    }),
    template: Object.freeze({
      templateRef: input.templateRef,
      variables: structuredClone(input.variables),
      variablesHash,
    }),
    classification: input.classification,
    policyDecisionHash: sha256({ allowed: true, classification: input.classification }),
    deduplicationKey,
    effectKey: sha256(`notification:${deduplicationKey}`),
    actionProvenanceRef: `agent-run:${input.agentRunId}:notification-intent`,
    state: "PENDING",
    expiresAt: input.expiresAt.toISOString(),
    rowVersion: 1,
    createdAt: input.now.toISOString(),
    fallback: "DENY",
  });
}
