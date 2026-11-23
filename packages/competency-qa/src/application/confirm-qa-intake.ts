import type { QaVersionedReference, QaWorkspaceContext } from "../domain/primitives.ts";
import type { QaProjectContext } from "../domain/qa-project-context.ts";
import type { QaOperationalRequestCreateResult } from "./operational-request-create-port.ts";
import {
  type QaConfirmedDraft,
  type QaResponseChannelResolver,
  validateConfirmedQaIntake,
  type ValidatedQaIntake,
} from "./qa-intake.ts";

export interface QaRequestCreateCommandIntent {
  readonly clientRequestKey: string;
  readonly commandType: "operational-work-item.request.create";
  readonly capability: Readonly<{
    key: "operational-work-item";
    exactContractVersion: "1.0.0";
    operation: "request.create";
    logicalRole: "QA_REQUEST_AUTHORITY";
  }>;
  readonly target: ValidatedQaIntake["target"];
  readonly payload: ValidatedQaIntake["createInput"];
  readonly expectedExternalState: Readonly<{ mode: "MUST_NOT_EXIST" }>;
  readonly bindingRef: QaVersionedReference;
  readonly profileRef: QaVersionedReference;
  readonly dataClassificationKey: string;
  readonly source: Readonly<{ intakeDraftId: string; confirmationVersion: number }>;
  readonly approvalRequired: false;
}

export interface QaCommandSubmission {
  readonly commandId: string;
  /** Gateway-derived and stable across retries; never equal to the client request key. */
  readonly effectIdempotencyKey: string;
  readonly status: string;
  readonly replayed: boolean;
  readonly confirmedResult?: QaOperationalRequestCreateResult;
}

export interface QaCommandGatewayPort {
  submit(
    context: QaWorkspaceContext,
    intent: QaRequestCreateCommandIntent,
  ): Promise<QaCommandSubmission>;
}

export interface QaIntakeConfirmationCandidate {
  readonly validated: ValidatedQaIntake;
  readonly commandIntent: QaRequestCreateCommandIntent;
  readonly command: QaCommandSubmission;
}

export async function confirmQaIntake(
  input: Readonly<{
    context: QaWorkspaceContext;
    draft: QaConfirmedDraft;
    projectContext: QaProjectContext;
    responseChannels: QaResponseChannelResolver;
    bindingRef: QaVersionedReference;
    profileRef: QaVersionedReference;
    clientRequestKey: string;
    evaluatedAt: string;
    commandGateway: QaCommandGatewayPort;
  }>,
): Promise<QaIntakeConfirmationCandidate> {
  if (input.clientRequestKey.trim().length === 0) throw new Error("QA_CLIENT_REQUEST_KEY_REQUIRED");
  const validated = await validateConfirmedQaIntake({
    context: input.context,
    draft: input.draft,
    projectContext: input.projectContext,
    responseChannels: input.responseChannels,
    bindingRef: input.bindingRef,
    evaluatedAt: input.evaluatedAt,
  });
  const commandIntent: QaRequestCreateCommandIntent = Object.freeze({
    clientRequestKey: input.clientRequestKey,
    commandType: "operational-work-item.request.create",
    capability: Object.freeze({
      key: "operational-work-item",
      exactContractVersion: "1.0.0",
      operation: "request.create",
      logicalRole: "QA_REQUEST_AUTHORITY",
    }),
    target: validated.target,
    payload: validated.createInput,
    expectedExternalState: Object.freeze({ mode: "MUST_NOT_EXIST" as const }),
    bindingRef: input.bindingRef,
    profileRef: input.profileRef,
    dataClassificationKey: validated.draft.authoritativeClassificationKey,
    source: Object.freeze({
      intakeDraftId: validated.draft.id,
      confirmationVersion: validated.draft.version,
    }),
    approvalRequired: false,
  });
  const command = await input.commandGateway.submit(input.context, commandIntent);
  if (command.effectIdempotencyKey === input.clientRequestKey)
    throw new Error("QA_EFFECT_KEY_MUST_BE_GATEWAY_DERIVED");
  return Object.freeze({ validated, commandIntent, command });
}
