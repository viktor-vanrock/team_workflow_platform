import { type JsonValue, sha256 } from "@awp/platform-contracts";

export interface QaConfirmedIntake {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly draftId: string;
  readonly confirmationVersion: number;
  readonly title: string;
  readonly goal: string;
  readonly acceptanceOutcome: string;
  readonly dataClassificationKey: string;
}

export interface QaOperationalCreateIntent {
  readonly operation: "request.create";
  readonly logicalRole: "QA_REQUEST_AUTHORITY";
  readonly auxiliaryRoles: readonly ["SOURCE_CONTEXT"];
  readonly source: Readonly<{ intakeDraftId: string; confirmationVersion: number }>;
  readonly structuralContent: Readonly<Record<string, JsonValue>>;
  readonly contentHash: `sha256:${string}`;
}

export function onQaIntakeConfirmed(input: QaConfirmedIntake): QaOperationalCreateIntent {
  if (!Number.isSafeInteger(input.confirmationVersion) || input.confirmationVersion < 1)
    throw new Error("QA_CONFIRMATION_VERSION_INVALID");
  const structuralContent = Object.freeze({
    title: input.title,
    goal: input.goal,
    acceptanceOutcome: input.acceptanceOutcome,
    dataClassificationKey: input.dataClassificationKey,
  });
  return Object.freeze({
    operation: "request.create",
    logicalRole: "QA_REQUEST_AUTHORITY",
    auxiliaryRoles: Object.freeze(["SOURCE_CONTEXT"] as const),
    source: Object.freeze({
      intakeDraftId: input.draftId,
      confirmationVersion: input.confirmationVersion,
    }),
    structuralContent,
    contentHash: sha256({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      draftId: input.draftId,
      confirmationVersion: input.confirmationVersion,
      structuralContent,
    } as JsonValue),
  });
}
