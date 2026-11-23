import { randomUUID } from "node:crypto";

import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";

import type { ActorReference, IdentityRepositoryPort, WorkspaceContext } from "@awp/platform-core";

import type { OidcTransport } from "./oidc-http.ts";
import { type PinnedOidcPolicy, PinnedOidcTokenVerifier } from "./pinned-oidc-verifier.ts";
import {
  assertNoAuthoritativeClientFields,
  type AuthoritativeScopeResolver,
  WorkspaceContextStore,
} from "./workspace-context.ts";

interface HttpRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
}

export type OidcGuardConfiguration = PinnedOidcPolicy;

function header(request: HttpRequest, key: string): string | undefined {
  const value = request.headers[key] ?? request.headers[key.toLowerCase()];
  return Array.isArray(value) ? (value.length === 1 ? value[0] : undefined) : value;
}
function correlation(value: string | undefined): string {
  return value && /^[0-9a-f-]{16,64}$/iu.test(value) ? value : randomUUID();
}

@Injectable()
export class OidcAuthGuard implements CanActivate {
  readonly #verifier;
  constructor(
    config: OidcGuardConfiguration,
    private readonly identities: IdentityRepositoryPort,
    private readonly scopes: AuthoritativeScopeResolver<HttpRequest>,
    private readonly contexts: WorkspaceContextStore,
    transport: OidcTransport,
  ) {
    this.#verifier = new PinnedOidcTokenVerifier(config, transport);
  }

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const request = executionContext.switchToHttp().getRequest<HttpRequest>();
    assertNoAuthoritativeClientFields(request.body);
    const authorization = header(request, "authorization");
    if (!authorization?.startsWith("Bearer "))
      throw new UnauthorizedException("Bearer token is required");
    let issuer: string;
    let subject: string;
    try {
      ({ issuer, subject } = await this.#verifier.verifyAccessToken(authorization.slice(7)));
    } catch {
      throw new UnauthorizedException("Token verification failed");
    }
    const identity = await this.identities.findByVerifiedSubject(issuer, subject);
    if (!identity) throw new UnauthorizedException("Verified identity is not registered");
    const scope = await this.scopes.resolve(request, identity.id);
    const actor: ActorReference =
      identity.kind === "HUMAN"
        ? {
            kind: "HUMAN",
            principalId: identity.id,
            issuer: identity.issuer,
            subject: identity.subject,
          }
        : { kind: "SERVICE", principalId: identity.id, serviceKey: identity.subject };
    const context: WorkspaceContext = Object.freeze({
      actor,
      scope,
      correlationId: correlation(header(request, "x-correlation-id")),
      causationId: correlation(header(request, "x-causation-id")),
    });
    this.contexts.enter(context);
    return true;
  }
}
