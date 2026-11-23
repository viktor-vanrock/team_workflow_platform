import { isSystemAdministratorRole } from "../access/role-key.ts";

export interface BindingPublicationApprover {
  readonly approverId: string;
  readonly approverRole: string;
  readonly permissions: readonly string[];
}
export function assertBindingPublicationDecision(
  initiatorId: string,
  approver: BindingPublicationApprover,
): void {
  if (initiatorId === approver.approverId) throw new Error("SELF_APPROVAL_FORBIDDEN");
  if (
    !isSystemAdministratorRole(approver.approverRole) ||
    !approver.permissions.includes("project.admin")
  )
    throw new Error("BINDING_PUBLICATION_APPROVER_UNAUTHORIZED");
}
