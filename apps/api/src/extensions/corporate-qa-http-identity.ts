import type { ExecutionContext } from "@nestjs/common";

import {
  defaultClassificationCatalog,
  pilotContentHash,
  type ScopedAccessRepositoryPort,
} from "@awp/platform-core";
import type { CorporateSessionService } from "@awp/platform-runtime-nest";

import type {
  QaHttpIdentity,
  QaRequestAuthorizer,
  QaSessionRequest,
} from "./qa-api-authorization.ts";

/** Existing Core entitlements define the classification ceiling; groups cannot raise it. */
export class CorporateQaHttpIdentity implements QaHttpIdentity {
  private readonly stepUp: ReadonlySet<string>;
  constructor(
    private readonly sessions: CorporateSessionService,
    private readonly access: ScopedAccessRepositoryPort,
    stepUpPermissions: readonly string[],
  ) {
    this.stepUp = new Set(stepUpPermissions);
  }
  async interaction(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<QaSessionRequest>();
    const interaction = await this.sessions.interactionSession(request);
    const session = await this.sessions.session(request);
    if (interaction.principalId !== session.principalId) throw new Error("QA_IDENTITY_REQUIRED");
    return {
      ...interaction,
      authentication: {
        contextRef: pilotContentHash({
          principalId: session.principalId,
          csrfToken: session.csrfToken,
          expiresAt: session.expiresAt,
        }),
        verifiedAt: new Date().toISOString(),
        ...(session.stepUpAt ? { stepUpAt: session.stepUpAt } : {}),
      },
    };
  }
  async authenticate(context: ExecutionContext): Promise<QaRequestAuthorizer> {
    const request = context.switchToHttp().getRequest<QaSessionRequest>();
    const handler = context.getHandler();
    await this.sessions.session(request);
    return async (input) => {
      const query = { ...input, requireStepUp: this.stepUp.has(input.permission) };
      const authorized = await this.sessions.authorize(request, query, handler);
      if (
        authorized.actor.kind !== "HUMAN" ||
        !authorized.authorizationBasis ||
        authorized.scope.kind !== "PROJECT"
      )
        throw new Error("QA_SCOPE_DENIED");
      const now = new Date();
      const facts = await this.access.authorizationFacts(
        authorized.scope,
        authorized.actor.principalId,
        now,
      );
      const refs = new Set(
        authorized.authorizationBasis.entitlementRefs.map(({ id, version }) => `${id}:${version}`),
      );
      const ceilings = facts.entitlements
        .filter(
          (grant) =>
            refs.has(`${grant.ref.id}:${grant.ref.version}`) &&
            grant.workspaceId === input.scope.workspaceId &&
            grant.projectId === input.scope.projectId &&
            grant.principalId === authorized.actor.principalId &&
            grant.effect === "ALLOW" &&
            grant.validFrom <= now &&
            (!grant.validUntil || grant.validUntil > now) &&
            !grant.revokedAt &&
            (grant.permissions.has(input.permission) || grant.permissions.has("*")),
        )
        .map((grant) => {
          const canonical = defaultClassificationCatalog.reference(grant.classificationCeiling.key);
          if (canonical.rank !== grant.classificationCeiling.rank)
            throw new Error("QA_SCOPE_DENIED");
          return canonical;
        })
        .sort((a, b) => b.rank - a.rank);
      const current = await this.sessions.authorize(request, query, handler);
      if (
        !ceilings[0] ||
        pilotContentHash(current.authorizationBasis) !==
          pilotContentHash(authorized.authorizationBasis) ||
        current.actor.principalId !== authorized.actor.principalId
      )
        throw new Error("QA_SCOPE_DENIED");
      const ceiling = ceilings[0].key;
      if (
        ceiling !== "PUBLIC" &&
        ceiling !== "INTERNAL" &&
        ceiling !== "RESTRICTED" &&
        ceiling !== "CONFIDENTIAL"
      )
        throw new Error("QA_SCOPE_DENIED");
      const session = await this.sessions.session(request);
      if (session.principalId !== current.actor.principalId) throw new Error("QA_SCOPE_DENIED");
      return {
        actor: authorized.actor,
        basis: authorized.authorizationBasis,
        scope: authorized.scope,
        classificationCeiling: ceiling,
        authentication: {
          contextRef: pilotContentHash({
            principalId: session.principalId,
            csrfToken: session.csrfToken,
            expiresAt: session.expiresAt,
          }),
          verifiedAt: new Date().toISOString(),
          ...(session.stepUpAt ? { stepUpAt: session.stepUpAt } : {}),
        },
      };
    };
  }
}
