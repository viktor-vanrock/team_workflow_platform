import { createHash } from "node:crypto";

import {
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { assertNoAuthoritativeClientFields } from "@awp/platform-runtime-nest";
import { localPersonaCatalog } from "@awp/runtime-composition";

export interface LocalSessionRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
  localPersonaKey?: string;
}

// Nest may instantiate route enhancers separately from injected providers.
// Evidence belongs to the verified request object, never to client fields.
const verifiedLocalAuthentication = new WeakMap<
  LocalSessionRequest,
  Readonly<{ contextRef: string; verifiedAt: string; stepUpAt?: string }>
>();

@Injectable()
export class LocalSessionGuard implements CanActivate {
  authentication(request: LocalSessionRequest) {
    return verifiedLocalAuthentication.get(request);
  }
  readonly #issuer: string;
  readonly #audience: string;
  readonly #jwks;
  constructor() {
    if (process.env.AWP_RUNTIME_PROFILE !== "local")
      throw new Error("LOCAL_SESSION_GUARD_FORBIDDEN");
    this.#issuer = process.env.AWP_IDENTITY_ISSUER ?? "";
    this.#audience = process.env.AWP_IDENTITY_AUDIENCE ?? "";
    this.#jwks = createRemoteJWKSet(new URL(`${this.#issuer}/jwks`));
  }
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<LocalSessionRequest>();
    verifiedLocalAuthentication.delete(request);
    try {
      assertNoAuthoritativeClientFields(request.body, context.getHandler?.());
    } catch {
      throw new BadRequestException("CLIENT_AUTHORITY_FORBIDDEN");
    }
    const raw = request.headers.authorization;
    const authorization = Array.isArray(raw) ? raw[0] : raw;
    if (!authorization?.startsWith("Bearer "))
      throw new UnauthorizedException("Bearer token is required");
    try {
      const verified = await jwtVerify(authorization.slice(7), this.#jwks, {
        issuer: this.#issuer,
        audience: this.#audience,
        algorithms: ["ES256"],
      });
      if (!verified.payload.sub) throw new Error("subject missing");
      localPersonaCatalog.resolve(verified.payload.sub);
      request.localPersonaKey = verified.payload.sub;
      const now = Date.now(),
        authTime = verified.payload.auth_time;
      const steppedUp =
        Array.isArray(verified.payload.amr) &&
        verified.payload.amr.includes("mfa") &&
        typeof authTime === "number" &&
        Number.isFinite(authTime) &&
        authTime * 1000 <= now &&
        now - authTime * 1000 <= 300_000;
      verifiedLocalAuthentication.set(
        request,
        Object.freeze({
          contextRef: `sha256:${createHash("sha256").update(authorization).digest("hex")}`,
          verifiedAt: new Date(now).toISOString(),
          ...(steppedUp ? { stepUpAt: new Date(authTime * 1000).toISOString() } : {}),
        }),
      );
      return true;
    } catch {
      throw new UnauthorizedException("Local session verification failed");
    }
  }
}
