import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { DataSource } from "typeorm";

import type { QaAuthorizationBasis, QaHumanActor } from "@awp/competency-qa/node";
import { freezePilotValue, type ResourceScope } from "@awp/platform-core";
import { assertNoAuthoritativeClientFields } from "@awp/platform-runtime-nest";

type ProjectScope = Extract<ResourceScope, { kind: "PROJECT" }>;
export type QaClassificationKey = "PUBLIC" | "INTERNAL" | "RESTRICTED" | "CONFIDENTIAL";

export const QA_DATA_SOURCE = Symbol("QA_DATA_SOURCE");
export const QA_HTTP_IDENTITY = Symbol("QA_HTTP_IDENTITY");
export interface QaSessionRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
  readonly method?: string;
}
export interface QaApiAuthorization {
  readonly actor: QaHumanActor;
  readonly basis: QaAuthorizationBasis;
  readonly classificationCeiling: QaClassificationKey;
  readonly scope: ProjectScope;
  /** Supplied by the verified identity adapter, never by request body fields. */
  readonly authentication?: Readonly<{ contextRef: string; verifiedAt: string; stepUpAt?: string }>;
}
export interface QaAuthorizationInput {
  readonly scope: ProjectScope;
  readonly permission: string;
  readonly operationClass: "READ" | "MUTATE";
}
export type QaRequestAuthorizer = (input: QaAuthorizationInput) => Promise<QaApiAuthorization>;
export interface QaInteractionSession {
  readonly principalId: string;
  readonly binding: string;
  readonly authentication?: QaApiAuthorization["authentication"];
}
export interface QaHttpIdentity {
  /** Only a server-composed identity adapter may produce this capability. */
  authenticate(context: ExecutionContext): Promise<QaRequestAuthorizer>;
  interaction?(context: ExecutionContext): Promise<QaInteractionSession>;
}
const verifiedRequests = new WeakMap<QaSessionRequest, QaRequestAuthorizer>();
const verifiedInteractions = new WeakMap<object, () => Promise<QaInteractionSession>>();

export function requireQaVerifiedRequest(request: object): void {
  if (!verifiedRequests.has(request as QaSessionRequest))
    throw new ForbiddenException("QA_IDENTITY_REQUIRED");
}

@Injectable()
export class QaSessionGuard implements CanActivate {
  constructor(@Inject(QA_HTTP_IDENTITY) private readonly identities: QaHttpIdentity) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<QaSessionRequest>();
    verifiedRequests.delete(request);
    verifiedInteractions.delete(request);
    try {
      assertNoAuthoritativeClientFields(request.body, context.getHandler?.());
      const authorize = await this.identities.authenticate(context);
      if (typeof authorize !== "function") throw new Error();
      verifiedRequests.set(request, authorize);
      if (this.identities.interaction)
        verifiedInteractions.set(request, () => this.identities.interaction!(context));
      return true;
    } catch {
      throw new UnauthorizedException("QA_IDENTITY_REQUIRED");
    }
  }
}

export async function qaInteractionSession(request: object): Promise<QaInteractionSession> {
  try {
    const resolve = verifiedInteractions.get(request);
    if (!resolve) throw new Error();
    const session = await resolve();
    if (!session.principalId || !/^sha256:[a-f0-9]{64}$/u.test(session.binding)) throw new Error();
    return freezePilotValue({
      principalId: session.principalId,
      binding: session.binding,
      ...(session.authentication ? { authentication: { ...session.authentication } } : {}),
    });
  } catch {
    throw new ForbiddenException("QA_INTERACTION_SESSION_REQUIRED");
  }
}

/** Never derives authority from a property, header, body, or local persona name. */
export async function authorizeQaApi(
  _source: DataSource,
  request: QaSessionRequest,
  workspaceId: string,
  projectId: string,
  permission: string,
): Promise<QaApiAuthorization> {
  const authorize = verifiedRequests.get(request);
  if (!authorize) throw new ForbiddenException("QA_IDENTITY_REQUIRED");
  try {
    const scope = { kind: "PROJECT" as const, workspaceId, projectId };
    const result = await authorize({
      scope,
      permission,
      operationClass: ["GET", "HEAD"].includes(request.method ?? "") ? "READ" : "MUTATE",
    });
    if (
      result.scope.kind !== "PROJECT" ||
      result.scope.workspaceId !== workspaceId ||
      result.scope.projectId !== projectId ||
      result.actor.kind !== "HUMAN" ||
      !result.actor.principalId ||
      !result.actor.issuer ||
      !result.actor.subject ||
      result.basis.kind !== "PROJECT" ||
      !result.basis.membershipRef ||
      !result.basis.roleAssignmentRefs.length ||
      !result.basis.entitlementRefs.length
    )
      throw new Error();
    return freezePilotValue(structuredClone(result));
  } catch {
    throw new ForbiddenException("QA_SCOPE_DENIED");
  }
}
