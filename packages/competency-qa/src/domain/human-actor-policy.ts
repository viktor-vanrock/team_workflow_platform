import { type QaPermission, qaPermissionCatalog } from "../manifest.ts";
import {
  assertQaVerifiedHuman,
  type QaAuthorizationBasis,
  QaDomainError,
  type QaWorkspaceContext,
} from "./primitives.ts";

export interface LiveQaHumanAuthorization {
  readonly allowed: boolean;
  readonly roleKey?: string;
  readonly authorizationBasis?: QaAuthorizationBasis;
}

export interface LiveQaHumanAuthorizationPort {
  authorizeHuman(
    context: QaWorkspaceContext,
    permission: QaPermission,
  ): Promise<LiveQaHumanAuthorization>;
}

export interface QaHumanAttestation {
  readonly actorId: string;
  readonly permission: QaPermission;
  readonly roleKey: string;
  readonly authorizationBasis: QaAuthorizationBasis;
}

export class QaHumanActorPolicy {
  constructor(private readonly authorization: LiveQaHumanAuthorizationPort) {}

  async attest(
    input: Readonly<{
      context: QaWorkspaceContext;
      permission: string;
      claimedRole?: string;
    }>,
  ): Promise<QaHumanAttestation> {
    const actor = assertQaVerifiedHuman(input.context);
    if (!qaPermissionCatalog.includes(input.permission as QaPermission)) {
      throw new QaDomainError("QA_PERMISSION_NOT_DECLARED");
    }
    const permission = input.permission as QaPermission;
    const decision = await this.authorization.authorizeHuman(input.context, permission);
    if (
      !decision.allowed ||
      decision.roleKey === undefined ||
      decision.roleKey.length === 0 ||
      decision.authorizationBasis === undefined
    ) {
      throw new QaDomainError("QA_PERMISSION_DENIED");
    }
    return Object.freeze({
      actorId: actor.principalId,
      permission,
      roleKey: decision.roleKey,
      authorizationBasis: decision.authorizationBasis,
    });
  }
}
