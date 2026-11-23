import {
  JiraRequestCreateService,
  type RequestCreateExecution,
  type RequestCreatePort,
  type RequestCreateResult,
} from "./request-create.ts";
import type { RequestSubEffectStore } from "./request-create-reconciliation.ts";

export class JiraDefectCreateService {
  readonly #service: JiraRequestCreateService;
  constructor(port: RequestCreatePort, receipts?: RequestSubEffectStore) {
    this.#service = new JiraRequestCreateService(port, receipts);
  }
  execute(input: RequestCreateExecution): Promise<RequestCreateResult> {
    return this.#service.execute(input);
  }
}
export function assertDefectRouting(
  input: Readonly<{
    approved: boolean;
    profileStatus: "VALID" | "DRIFTED" | "INVALID";
    expectedProjectId: string;
    targetProjectId: string;
    classificationAllowed: boolean;
    expectedAuthorityNamespace: string;
    actualAuthorityNamespace: string;
  }>,
): void {
  if (!input.approved) throw new Error("DEFECT_APPROVAL_REQUIRED");
  if (input.profileStatus !== "VALID") throw new Error("DEFECT_PROFILE_UNAVAILABLE");
  if (input.expectedProjectId !== input.targetProjectId)
    throw new Error("DEFECT_DESTINATION_MISMATCH");
  if (!input.classificationAllowed) throw new Error("DEFECT_EVIDENCE_CLASSIFICATION_FORBIDDEN");
  if (input.expectedAuthorityNamespace !== input.actualAuthorityNamespace)
    throw new Error("DEFECT_AUTHORITY_NAMESPACE_MISMATCH");
}
