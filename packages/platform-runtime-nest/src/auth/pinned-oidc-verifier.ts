import {
  createRemoteJWKSet,
  customFetch,
  decodeProtectedHeader,
  type JWTPayload,
  jwtVerify,
} from "jose";

import {
  assertOidcEndpoint,
  type OidcHttpPolicy,
  oidcJsonRequest,
  type OidcTransport,
} from "./oidc-http.ts";

export interface PinnedOidcPolicy extends OidcHttpPolicy {
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUri: string;
  readonly algorithms: readonly ("RS256" | "PS256" | "ES256" | "EdDSA")[];
  readonly discriminator:
    | Readonly<{ kind: "RFC9068" }>
    | Readonly<{ kind: "VENDOR_JWT"; typ: string; claim: string; value: string }>;
  readonly allowedClientIds: readonly string[];
  readonly clockToleranceSeconds: number;
  readonly maximumTokenAgeSeconds: number;
  readonly maximumTokenLifetimeSeconds: number;
  readonly keyCacheMs: number;
  readonly groupsClaim: string;
}
export interface VerifiedOidcIdentity {
  readonly displayName?: string;
  readonly username?: string;
  readonly issuer: string;
  readonly subject: string;
  readonly tokenId: string;
  readonly clientId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly groups: readonly string[];
  readonly authTime?: number;
  readonly acr?: string;
  readonly amr: readonly string[];
}

const string = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256 && !/\p{Cc}/u.test(value);
const list = (value: unknown, max = 256): readonly string[] => {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > max || !value.every(string))
    throw new Error("OIDC_TOKEN_REJECTED");
  return Object.freeze([...new Set(value as string[])]);
};

export class PinnedOidcTokenVerifier {
  readonly policy: PinnedOidcPolicy;
  readonly #keys;
  constructor(
    policy: PinnedOidcPolicy,
    private readonly transport: OidcTransport,
  ) {
    this.policy = Object.freeze({
      ...structuredClone(policy),
      algorithms: Object.freeze([...policy.algorithms]),
      allowedClientIds: Object.freeze([...policy.allowedClientIds]),
      discriminator: Object.freeze({ ...policy.discriminator }),
    });
    try {
      assertOidcEndpoint(policy.issuer, policy);
      assertOidcEndpoint(policy.jwksUri, policy);
      if (
        !string(policy.audience) ||
        !policy.algorithms.length ||
        policy.algorithms.some(
          (algorithm) => !["RS256", "PS256", "ES256", "EdDSA"].includes(algorithm),
        ) ||
        !policy.allowedClientIds.length ||
        !policy.allowedClientIds.every(string) ||
        !string(policy.groupsClaim) ||
        !Number.isSafeInteger(policy.clockToleranceSeconds) ||
        policy.clockToleranceSeconds < 0 ||
        policy.clockToleranceSeconds > 60 ||
        !Number.isSafeInteger(policy.maximumTokenAgeSeconds) ||
        policy.maximumTokenAgeSeconds < 1 ||
        policy.maximumTokenAgeSeconds > 3600 ||
        !Number.isSafeInteger(policy.maximumTokenLifetimeSeconds) ||
        policy.maximumTokenLifetimeSeconds < 1 ||
        policy.maximumTokenLifetimeSeconds > 3600 ||
        !Number.isSafeInteger(policy.keyCacheMs) ||
        policy.keyCacheMs < 1 ||
        policy.keyCacheMs > 3600_000 ||
        !["RFC9068", "VENDOR_JWT"].includes(policy.discriminator.kind) ||
        (policy.discriminator.kind === "VENDOR_JWT" &&
          (!string(policy.discriminator.typ) ||
            !/^[a-zA-Z][a-zA-Z0-9_:.-]{0,127}$/u.test(policy.discriminator.claim) ||
            !string(policy.discriminator.value)))
      )
        throw new Error();
    } catch {
      throw new Error("OIDC_POLICY_INVALID");
    }
    this.#keys = createRemoteJWKSet(new URL(this.policy.jwksUri), {
      timeoutDuration: policy.deadlineMs,
      cacheMaxAge: policy.keyCacheMs,
      cooldownDuration: 1000,
      [customFetch]: async () => {
        const value = await oidcJsonRequest(this.policy.jwksUri, this.policy, transport, {
          method: "GET",
        });
        if (
          !Array.isArray(value.keys) ||
          !value.keys.length ||
          value.keys.length > 64 ||
          value.keys.some(
            (key: unknown) => !key || typeof key !== "object" || "d" in key || "k" in key,
          )
        )
          throw new Error("OIDC_KEYS_REJECTED");
        return new Response(JSON.stringify(value), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
  }

  async verifyAccessToken(token: string): Promise<VerifiedOidcIdentity> {
    try {
      const { payload, typ } = await this.verify(token, this.policy.audience);
      const rule = this.policy.discriminator;
      if (
        rule.kind === "RFC9068"
          ? typ !== "at+jwt" && typ !== "application/at+jwt"
          : typ !== rule.typ || payload[rule.claim] !== rule.value
      )
        throw new Error();
      // Корпоративный IAM не выдаёт claim client_id; azp — его штатный эквивалент у Keycloak.
      // Привязка токена к клиенту держится на aud (проверен выше) вместе с azp.
      const clientId = string(payload.client_id) ? payload.client_id : payload.azp;
      if (
        !string(clientId) ||
        !this.policy.allowedClientIds.includes(clientId) ||
        !string(payload.jti)
      )
        throw new Error();
      return this.project(payload, clientId, payload.jti);
    } catch (error) {
      console.error("AWP_DEBUG token", error); // ponytail: временная диагностика, снять после починки входа
      throw new Error("OIDC_TOKEN_REJECTED");
    }
  }

  async verifyIdToken(
    token: string,
    expected: Readonly<{
      clientId: string;
      nonce: string;
      subject: string;
      authenticationStartedAt: number;
      stepUp?: Readonly<{
        acrValues: readonly string[];
        amrValues: readonly string[];
        maximumAgeSeconds: number;
      }>;
    }>,
  ): Promise<VerifiedOidcIdentity> {
    try {
      if (!this.policy.allowedClientIds.includes(expected.clientId)) throw new Error();
      const { payload, typ } = await this.verify(token, expected.clientId);
      if (typ !== undefined && typ !== "JWT" && typ !== "application/JWT") throw new Error();
      if (
        payload.sub !== expected.subject ||
        payload.nonce !== expected.nonce ||
        (payload.azp !== undefined && payload.azp !== expected.clientId) ||
        (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== expected.clientId)
      )
        throw new Error();
      const value = this.project(
        payload,
        expected.clientId,
        typeof payload.jti === "string" ? payload.jti : "id-token",
      );
      if (expected.stepUp) {
        const at = Math.floor((this.transport.clock ?? Date.now)() / 1000);
        if (
          value.authTime === undefined ||
          value.authTime < expected.authenticationStartedAt - this.policy.clockToleranceSeconds ||
          value.authTime > at + this.policy.clockToleranceSeconds ||
          at - value.authTime > expected.stepUp.maximumAgeSeconds ||
          !value.acr ||
          !expected.stepUp.acrValues.includes(value.acr) ||
          !expected.stepUp.amrValues.every((method) => value.amr.includes(method))
        )
          throw new Error();
      }
      return value;
    } catch (error) {
      console.error("AWP_DEBUG token", error); // ponytail: временная диагностика, снять после починки входа
      throw new Error("OIDC_TOKEN_REJECTED");
    }
  }

  private async verify(
    token: string,
    audience: string,
  ): Promise<{ payload: JWTPayload; typ: string | undefined }> {
    if (
      typeof token !== "string" ||
      token.length > 16384 ||
      !/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/u.test(token)
    )
      throw new Error();
    const header = decodeProtectedHeader(token);
    if (
      !string(header.kid) ||
      header.jku ||
      header.jwk ||
      header.x5u ||
      !this.policy.algorithms.includes(header.alg as PinnedOidcPolicy["algorithms"][number])
    )
      throw new Error();
    const now = (this.transport.clock ?? Date.now)();
    const result = await jwtVerify(token, this.#keys, {
      issuer: this.policy.issuer,
      audience,
      algorithms: [...this.policy.algorithms],
      requiredClaims: ["iss", "sub", "aud", "exp", "iat"],
      clockTolerance: this.policy.clockToleranceSeconds,
      maxTokenAge: this.policy.maximumTokenAgeSeconds,
      currentDate: new Date(now),
    });
    const payload = result.payload;
    if (
      !string(payload.sub) ||
      !Number.isSafeInteger(payload.iat) ||
      !Number.isSafeInteger(payload.exp) ||
      payload.iat! < 0 ||
      payload.exp! <= payload.iat! ||
      payload.exp! - payload.iat! > this.policy.maximumTokenLifetimeSeconds
    )
      throw new Error();
    return { payload, typ: result.protectedHeader.typ };
  }

  private project(payload: JWTPayload, clientId: string, tokenId: string): VerifiedOidcIdentity {
    if (
      payload.auth_time !== undefined &&
      (!Number.isSafeInteger(payload.auth_time) ||
        Number(payload.auth_time) < 0 ||
        Number(payload.auth_time) > payload.iat! + this.policy.clockToleranceSeconds)
    )
      throw new Error();
    if (payload.acr !== undefined && !string(payload.acr)) throw new Error();
    if (
      (payload.name !== undefined && !string(payload.name)) ||
      (payload.preferred_username !== undefined && !string(payload.preferred_username))
    )
      throw new Error();
    return Object.freeze({
      issuer: this.policy.issuer,
      subject: payload.sub!,
      tokenId,
      clientId,
      issuedAt: payload.iat!,
      expiresAt: Math.min(payload.exp!, payload.iat! + this.policy.maximumTokenAgeSeconds),
      groups: list(payload[this.policy.groupsClaim]),
      ...(typeof payload.name === "string" ? { displayName: payload.name } : {}),
      ...(typeof payload.preferred_username === "string"
        ? { username: payload.preferred_username }
        : {}),
      amr: list(payload.amr, 16),
      ...(payload.auth_time !== undefined ? { authTime: Number(payload.auth_time) } : {}),
      ...(payload.acr !== undefined ? { acr: payload.acr } : {}),
    });
  }
}
