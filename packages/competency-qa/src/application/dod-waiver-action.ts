import {
  type QaCompletionWaiverKind,
  requestCompletionWaiver,
} from "./request-completion-waiver.ts";

export const QA_DOD_INVENTORY_WAIVER_ACTION_KIND = "qa.dod.inventory-waiver";

export function prepareDodInventoryWaiver(
  input: Readonly<{
    kind: QaCompletionWaiverKind;
    attempted: boolean;
    negative: boolean;
    zeroExecutionCancelled?: boolean;
    reason: string;
    remainingRequiredSessions: number;
  }>,
) {
  return requestCompletionWaiver(input);
}
