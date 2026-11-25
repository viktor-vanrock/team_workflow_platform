import { createSign, generateKeyPairSync, type KeyObject, randomUUID } from "node:crypto";

import { Body, Controller, Get, Inject, Injectable, Post } from "@nestjs/common";

const allowedSubjects = new Set([
  "superadmin.local",
  "writer.docs",
  "lead.docs",
  "owner.local",
  "integration-admin.alpha",
  "requester.alpha",
  "executor.alpha",
  "executor.qa2",
  "lead.alpha",
  "viewer.beta",
  "worker.local",
]);

interface PublicSigningJwk extends JsonWebKey {
  readonly kid: string;
  readonly use: "sig";
  readonly alg: "ES256";
}
interface SigningKey {
  readonly kid: string;
  readonly privateKey: KeyObject;
  readonly publicJwk: PublicSigningJwk;
}

function base64url(input: string | Uint8Array): string {
  return Buffer.from(input).toString("base64url");
}

function createSigningKey(): SigningKey {
  const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const kid = randomUUID();
  const jwk = pair.publicKey.export({ format: "jwk" });
  return Object.freeze({
    kid,
    privateKey: pair.privateKey,
    publicJwk: Object.freeze({ ...jwk, kid, use: "sig", alg: "ES256" }),
  });
}

@Injectable()
export class FakeOidcService {
  readonly issuer: string;
  readonly audience: string;
  #current = createSigningKey();
  #previous?: SigningKey;

  constructor() {
    this.issuer = process.env.FAKE_IDP_ISSUER ?? "https://fake-idp:4443/oidc";
    this.audience = process.env.AWP_IDENTITY_AUDIENCE ?? "awp-local";
    const parsed = new URL(this.issuer);
    if (parsed.protocol !== "https:" || parsed.pathname.replace(/\/$/u, "") !== "/oidc")
      throw new Error("FAKE_IDP_ISSUER_INVALID");
  }

  discovery(): Readonly<Record<string, unknown>> {
    return Object.freeze({
      issuer: this.issuer,
      jwks_uri: `${this.issuer}/jwks`,
      token_endpoint: `${this.issuer}/token`,
      response_types_supported: ["token"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["ES256"],
    });
  }

  jwks(): Readonly<{ keys: readonly PublicSigningJwk[] }> {
    return Object.freeze({
      keys: Object.freeze([
        this.#current.publicJwk,
        ...(this.#previous ? [this.#previous.publicJwk] : []),
      ]),
    });
  }

  issue(
    personaKey: string,
  ): Readonly<{ access_token: string; token_type: "Bearer"; expires_in: number }> {
    return this.sign(personaKey, false);
  }

  issueDevelopmentStepUp(personaKey: string) {
    if (process.env.AWP_RUNTIME_PROFILE !== "local")
      throw new Error("FAKE_IDP_LOCAL_PROFILE_REQUIRED");
    return this.sign(personaKey, true);
  }

  private sign(
    personaKey: string,
    stepUp: boolean,
  ): Readonly<{ access_token: string; token_type: "Bearer"; expires_in: number }> {
    if (!allowedSubjects.has(personaKey)) throw new Error("FAKE_IDP_SUBJECT_UNKNOWN");
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid: this.#current.kid }));
    const payload = base64url(
      JSON.stringify({
        iss: this.issuer,
        sub: personaKey,
        aud: this.audience,
        iat: now,
        exp: now + 900,
        jti: randomUUID(),
        ...(stepUp ? { auth_time: now, amr: ["development", "mfa"] } : {}),
      }),
    );
    const signingInput = `${header}.${payload}`;
    const signature = createSign("SHA256")
      .update(signingInput)
      .end()
      .sign({ key: this.#current.privateKey, dsaEncoding: "ieee-p1363" });
    return Object.freeze({
      access_token: `${signingInput}.${base64url(signature)}`,
      token_type: "Bearer",
      expires_in: 900,
    });
  }

  rotate(): Readonly<{ activeKid: string; retainedKid: string }> {
    this.#previous = this.#current;
    this.#current = createSigningKey();
    return Object.freeze({ activeKid: this.#current.kid, retainedKid: this.#previous.kid });
  }
}

@Controller("oidc")
export class FakeOidcController {
  constructor(@Inject(FakeOidcService) private readonly oidc: FakeOidcService) {}
  @Get(".well-known/openid-configuration") discovery() {
    return this.oidc.discovery();
  }
  @Get("jwks") jwks() {
    return this.oidc.jwks();
  }
  @Post("token") token(@Body() body: Readonly<{ personaKey?: string }>) {
    if (!body.personaKey || Object.keys(body).some((key) => key !== "personaKey"))
      throw new Error("FAKE_IDP_PERSONA_KEY_ONLY");
    return this.oidc.issue(body.personaKey);
  }
  @Post("_test/rotate") rotate() {
    return this.oidc.rotate();
  }
  @Post("_test/step-up") stepUp(@Body() body: Readonly<{ personaKey?: string }>) {
    if (!body.personaKey || Object.keys(body).some((key) => key !== "personaKey"))
      throw new Error("FAKE_IDP_PERSONA_KEY_ONLY");
    return this.oidc.issueDevelopmentStepUp(body.personaKey);
  }
}
