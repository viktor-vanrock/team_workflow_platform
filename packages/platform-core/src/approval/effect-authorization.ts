import {
  type Approval,
  type ApprovalInvalidationReason,
  validateApprovalSnapshot,
} from "./approval.ts";

const claims = new WeakSet<object>();
export async function consumeEffectAuthorization(
  approval: Approval,
  live: Readonly<{
    subjectHash: string;
    approverAuthorized: boolean;
    now: Date;
    invalidationReason?: ApprovalInvalidationReason;
  }>,
): Promise<Approval> {
  if (claims.has(approval)) throw new Error("EFFECT_AUTHORIZATION_ALREADY_CLAIMED");
  claims.add(approval);
  if (approval.decisionStatus !== "APPROVED" || approval.effectAuthorizationStatus !== "AUTHORIZED")
    throw new Error("EFFECT_NOT_AUTHORIZED");
  const reason =
    live.now >= approval.expiresAt
      ? "EXPIRED"
      : !live.approverAuthorized
        ? "APPROVER_AUTH_REVOKED"
        : live.subjectHash !== approval.subjectHash
          ? (live.invalidationReason ?? "SUBJECT_CHANGED")
          : undefined;
  if (reason) {
    const invalidated: Approval = {
      ...approval,
      effectAuthorizationStatus: "INVALIDATED",
      invalidationReason: reason,
      invalidatedAt: live.now,
      resourceVersion: approval.resourceVersion + 1,
    };
    validateApprovalSnapshot(invalidated);
    return invalidated;
  }
  const consumed: Approval = {
    ...approval,
    effectAuthorizationStatus: "CONSUMED",
    consumedAt: live.now,
    resourceVersion: approval.resourceVersion + 1,
  };
  validateApprovalSnapshot(consumed);
  return consumed;
}
export interface ApprovalCasPort {
  getForEffect(approvalId: string): Promise<Approval | undefined>;
  saveEffectState(value: Approval, expectedVersion: number): Promise<void>;
}
export class EffectAuthorizationService {
  constructor(private readonly approvals: ApprovalCasPort) {}
  async consume(
    approvalId: string,
    live: Parameters<typeof consumeEffectAuthorization>[1],
  ): Promise<Approval> {
    const current = await this.approvals.getForEffect(approvalId);
    if (!current) throw new Error("APPROVAL_NOT_FOUND");
    const next = await consumeEffectAuthorization(current, live);
    await this.approvals.saveEffectState(next, current.resourceVersion);
    return next;
  }
}
