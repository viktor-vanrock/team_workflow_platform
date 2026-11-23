import { isSystemAdministratorRole } from "../access/role-key.ts";
import {
  consumeProjectActionApproval,
  type ProjectActionApproval,
  type ProjectActionCandidate,
} from "../project-onboarding/operational-actions.ts";

export { BindingPublicationService as BindingPublicationExecutor } from "./binding-publication-action.ts";

export function executeProjectBindingPublication<T extends ProjectActionApproval>(
  candidate: ProjectActionCandidate,
  approval: T,
  live: Readonly<{ now: string; approverCurrentlyAuthorized: boolean }>,
): T & Readonly<{ consumedAt: string }> {
  if (candidate.kind !== "BINDING_PUBLISH") throw new Error("BINDING_PUBLICATION_ACTION_REQUIRED");
  if (!live.approverCurrentlyAuthorized || !isSystemAdministratorRole(approval.approver.roleKey)) {
    throw new Error("BINDING_PUBLICATION_OWNER_AUTHORIZATION_REQUIRED");
  }
  return consumeProjectActionApproval(candidate, approval, live.now);
}
