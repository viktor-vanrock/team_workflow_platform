import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  assertExactRevisionRef,
  type ExactRevisionRef,
  freezePilotValue,
  type Identity,
  type PlatformAccessContext,
  type PlatformAccessPermission,
  type ResourceScope,
  type WorkspaceContext,
} from "@awp/platform-core";

import { assertOidcEndpoint, oidcJsonRequest, type OidcTransport } from "./oidc-http.ts";
import { PinnedOidcTokenVerifier, type VerifiedOidcIdentity } from "./pinned-oidc-verifier.ts";
import type { SessionStateCodec } from "./session-state-codec.ts";
import { assertNoAuthoritativeClientFields } from "./workspace-context.ts";

export interface CorporateSessionStore {
  put(
    namespace: string,
    key: string,
    ciphertext: string,
    expiresAt: number,
    now: number,
  ): Promise<void>;
  get(namespace: string, key: string, now: number): Promise<string | undefined>;
  take(namespace: string, key: string, now: number): Promise<string | undefined>;
  remove(namespace: string, key: string): Promise<void>;
  rotate(
    namespace: string,
    previousKey: string,
    nextKey: string,
    ciphertext: string,
    expiresAt: number,
    now: number,
  ): Promise<boolean>;
}
export interface CorporateSessionPolicy {
  readonly policyRef: ExactRevisionRef;
  readonly namespace: string;
  readonly browserOrigin: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly callbackUrl: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
  readonly returnPaths: readonly string[];
  readonly loginLifetimeMs: number;
  readonly sessionLifetimeMs: number;
  readonly stepUp: Readonly<{
    acrValues: readonly string[];
    amrValues: readonly string[];
    maximumAgeSeconds: number;
  }>;
}
export interface CorporateSessionRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
  readonly method?: string;
}
export interface SessionAuthorizationInput {
  readonly scope: ResourceScope;
  readonly permission: string;
  readonly operationClass: "READ" | "MUTATE" | "EFFECT";
  readonly correlationId?: string;
  readonly causationId?: string;
}
export interface CorporateSessionIdentityPort {
  completeVerifiedLogin?(evidence: VerifiedOidcIdentity): Promise<void>;
  authorizePlatform?(
    evidence: VerifiedOidcIdentity,
    permission: PlatformAccessPermission,
  ): Promise<PlatformAccessContext>;
  authenticate(evidence: VerifiedOidcIdentity): Promise<Identity>;
  authorize(
    evidence: VerifiedOidcIdentity,
    input: SessionAuthorizationInput,
  ): Promise<WorkspaceContext>;
}
export interface OidcClientAuthentication {
  authorizeTokenRequest(
    signal: AbortSignal,
  ): Promise<
    Readonly<{ headers: Readonly<Record<string, string>>; form: Readonly<Record<string, string>> }>
  >;
}
interface Flow {
  readonly policyRef: ExactRevisionRef;
  readonly browserHash: string;
  readonly nonce: string;
  readonly verifier: string;
  readonly returnPath: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly stepUp: boolean;
  readonly previousSession?: string;
  readonly subject?: string;
}
interface Session {
  readonly policyRef: ExactRevisionRef;
  readonly identity: VerifiedOidcIdentity;
  readonly principalId: string;
  readonly csrfToken: string;
  readonly expiresAt: number;
  readonly stepUpAt?: number;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const opaque = () => randomBytes(32).toString("base64url");
const validOpaque = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{43}$/u.test(value);
const same = (left: string, right: string) =>
  timingSafeEqual(Buffer.from(hash(left)), Buffer.from(hash(right)));
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("CORPORATE_SESSION_DENIED");
  return value as Record<string, unknown>;
};

export class CorporateSessionService {
  readonly policy: CorporateSessionPolicy;
  readonly #sessionCookie: string;
  readonly #flowCookie: string;
  constructor(
    policy: CorporateSessionPolicy,
    private readonly verifier: PinnedOidcTokenVerifier,
    private readonly transport: OidcTransport,
    private readonly store: CorporateSessionStore,
    private readonly codec: SessionStateCodec,
    private readonly identities: CorporateSessionIdentityPort,
    private readonly credentials: OidcClientAuthentication,
    private readonly clock: () => number = Date.now,
  ) {
    this.policy = freezePilotValue(structuredClone(policy));
    try {
      assertExactRevisionRef(policy.policyRef);
      for (const url of [
        policy.authorizationEndpoint,
        policy.tokenEndpoint,
        policy.callbackUrl,
        policy.browserOrigin,
      ])
        assertOidcEndpoint(url, verifier.policy);
      if (
        new URL(policy.browserOrigin).origin !== policy.browserOrigin ||
        new URL(policy.callbackUrl).origin !== policy.browserOrigin ||
        !/^[a-zA-Z0-9_-]{1,96}$/u.test(policy.namespace) ||
        !verifier.policy.allowedClientIds.includes(policy.clientId) ||
        !policy.scopes.includes("openid") ||
        policy.scopes.some((scope) => !/^[a-zA-Z0-9:._-]{1,64}$/u.test(scope)) ||
        !policy.returnPaths.length ||
        policy.returnPaths.some((path) => !/^\/(?!\/)[a-zA-Z0-9/_-]*$/u.test(path)) ||
        !Number.isSafeInteger(policy.loginLifetimeMs) ||
        policy.loginLifetimeMs < 1000 ||
        policy.loginLifetimeMs > 300_000 ||
        !Number.isSafeInteger(policy.sessionLifetimeMs) ||
        policy.sessionLifetimeMs < 1000 ||
        policy.sessionLifetimeMs > 3600_000 ||
        !policy.stepUp.acrValues.length ||
        !policy.stepUp.amrValues.length ||
        !Number.isSafeInteger(policy.stepUp.maximumAgeSeconds) ||
        policy.stepUp.maximumAgeSeconds < 1 ||
        policy.stepUp.maximumAgeSeconds > 600
      )
        throw new Error();
    } catch {
      throw new Error("CORPORATE_SESSION_POLICY_INVALID");
    }
    this.#sessionCookie =
      verifier.policy.mode === "CORPORATE" ? "__Host-awp-session" : "awp-session";
    this.#flowCookie = verifier.policy.mode === "CORPORATE" ? "__Host-awp-login" : "awp-login";
  }

  async begin(
    request: CorporateSessionRequest,
    input: Readonly<{ returnPath: string; stepUp?: boolean }>,
  ): Promise<Readonly<{ authorizationUrl: string; cookie: string }>> {
    this.origin(request);
    assertNoAuthoritativeClientFields(request.body);
    if (!this.policy.returnPaths.includes(input.returnPath))
      throw new Error("CORPORATE_SESSION_DENIED");
    const previous = this.cookie(request, this.#sessionCookie);
    const session = input.stepUp ? await this.read(request, true) : undefined;
    const now = this.clock();
    const state = opaque();
    const browser = opaque();
    const flow: Flow = {
      policyRef: this.policy.policyRef,
      browserHash: hash(browser),
      nonce: opaque(),
      verifier: opaque(),
      returnPath: input.returnPath,
      createdAt: now,
      expiresAt: now + this.policy.loginLifetimeMs,
      stepUp: input.stepUp === true,
      ...(previous ? { previousSession: hash(previous) } : {}),
      ...(session ? { subject: session.identity.subject } : {}),
    };
    await this.write("flow", hash(state), flow, flow.expiresAt);
    const target = new URL(this.policy.authorizationEndpoint);
    target.search = new URLSearchParams({
      response_type: "code",
      client_id: this.policy.clientId,
      redirect_uri: this.policy.callbackUrl,
      scope: this.policy.scopes.join(" "),
      state,
      nonce: flow.nonce,
      code_challenge: createHash("sha256").update(flow.verifier).digest("base64url"),
      code_challenge_method: "S256",
      ...(flow.stepUp
        ? { max_age: "0", prompt: "login", acr_values: this.policy.stepUp.acrValues.join(" ") }
        : {}),
    }).toString();
    return Object.freeze({
      authorizationUrl: target.href,
      cookie: this.setCookie(this.#flowCookie, browser, flow.expiresAt),
    });
  }

  async callback(
    request: CorporateSessionRequest,
    query: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<{ cookie: string; clearLoginCookie: string; returnPath: string }>> {
    try {
      if (
        !validOpaque(query.state) ||
        typeof query.code !== "string" ||
        !query.code ||
        query.code.length > 2048 ||
        /[\p{Cc} ]/u.test(query.code) ||
        query.iss !== this.verifier.policy.issuer ||
        query.error !== undefined
      )
        throw new Error();
      const browser = this.cookie(request, this.#flowCookie);
      if (!browser) throw new Error();
      const flowKey = hash(query.state);
      const flow = await this.load<Flow>("flow", flowKey);
      if (!flow || !same(flow.browserHash, hash(browser))) throw new Error();
      // Bad browser/issuer attempts cannot consume another browser's login.
      const claimed = await this.store.take(`${this.policy.namespace}:flow`, flowKey, this.clock());
      if (!claimed || flow.expiresAt <= this.clock()) throw new Error();
      const signal = AbortSignal.timeout(this.verifier.policy.deadlineMs);
      const authentication = await this.clientAuthentication(signal);
      const form = new URLSearchParams({
        grant_type: "authorization_code",
        code: query.code,
        redirect_uri: this.policy.callbackUrl,
        client_id: this.policy.clientId,
        code_verifier: flow.verifier,
        ...authentication.form,
      });
      const response = await oidcJsonRequest(
        this.policy.tokenEndpoint,
        this.verifier.policy,
        this.transport,
        {
          method: "POST",
          headers: {
            ...authentication.headers,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: form.toString(),
        },
        signal,
      );
      if (
        response.token_type !== "Bearer" ||
        typeof response.access_token !== "string" ||
        typeof response.id_token !== "string"
      )
        throw new Error();
      let access: VerifiedOidcIdentity;
      let id: VerifiedOidcIdentity;
      try {
        access = await this.verifier.verifyAccessToken(response.access_token);
        id = await this.verifier.verifyIdToken(response.id_token, {
          clientId: this.policy.clientId,
          nonce: flow.nonce,
          subject: access.subject,
          authenticationStartedAt: Math.floor(flow.createdAt / 1000),
          ...(flow.stepUp ? { stepUp: this.policy.stepUp } : {}),
        });
      } finally {
        response.access_token = null;
        response.id_token = null;
        response.refresh_token = null;
      }
      if (flow.stepUp && flow.subject !== access.subject) throw new Error();
      if (
        Math.min(access.expiresAt, id.expiresAt) * 1000 <= this.clock() ||
        flow.expiresAt <= this.clock()
      )
        throw new Error();
      await this.identities.completeVerifiedLogin?.(access);
      const principal = await this.identities.authenticate(access);
      if (principal.kind !== "HUMAN") throw new Error();
      if (flow.previousSession && flow.stepUp) {
        const prior = await this.load<Session>("session", flow.previousSession);
        if (!prior || prior.principalId !== principal.id) throw new Error();
      }
      const expiresAt = Math.min(
        access.expiresAt * 1000,
        id.expiresAt * 1000,
        this.clock() + this.policy.sessionLifetimeMs,
      );
      if (expiresAt <= this.clock() || flow.expiresAt <= this.clock()) throw new Error();
      const sessionId = opaque();
      const session: Session = {
        policyRef: this.policy.policyRef,
        identity: access,
        principalId: principal.id,
        csrfToken: opaque(),
        expiresAt,
        ...(flow.stepUp ? { stepUpAt: id.authTime! * 1000 } : {}),
      };
      if (flow.previousSession && flow.stepUp) {
        const namespace = `${this.policy.namespace}:session`;
        const nextKey = hash(sessionId);
        const rotated = await this.store.rotate(
          namespace,
          flow.previousSession,
          nextKey,
          await this.codec.seal(session, `${namespace}:${nextKey}`),
          expiresAt,
          this.clock(),
        );
        if (!rotated) throw new Error();
      } else {
        if (flow.previousSession)
          await this.store.remove(`${this.policy.namespace}:session`, flow.previousSession);
        await this.write("session", hash(sessionId), session, expiresAt);
      }
      return Object.freeze({
        cookie: this.setCookie(this.#sessionCookie, sessionId, expiresAt),
        clearLoginCookie: this.setCookie(this.#flowCookie, "", 0),
        returnPath: flow.returnPath,
      });
    } catch (error) {
      console.error("AWP_DEBUG callback", error); // ponytail: временная диагностика, снять после починки входа
      throw new Error("CORPORATE_SESSION_DENIED");
    }
  }

  async session(request: CorporateSessionRequest): Promise<
    Readonly<{
      principalId: string;
      subject: string;
      csrfToken: string;
      expiresAt: string;
      stepUpAt?: string;
    }>
  > {
    const session = await this.read(request, false);
    return Object.freeze({
      principalId: session.principalId,
      subject: session.identity.subject,
      csrfToken: session.csrfToken,
      expiresAt: new Date(session.expiresAt).toISOString(),
      ...(session.stepUpAt !== undefined
        ? { stepUpAt: new Date(session.stepUpAt).toISOString() }
        : {}),
    });
  }
  /** Server-only interaction binding. Never return the cookie or bearer evidence to a domain service. */
  async interactionSession(
    request: CorporateSessionRequest,
  ): Promise<Readonly<{ principalId: string; binding: string }>> {
    const session = await this.read(
      request,
      !["GET", "HEAD"].includes(request.method?.toUpperCase() ?? ""),
    );
    return Object.freeze({
      principalId: session.principalId,
      binding: `sha256:${hash(`${this.policy.namespace}:project-selection:${this.cookie(request, this.#sessionCookie)!}`)}`,
    });
  }
  async authorize(
    request: CorporateSessionRequest,
    input: SessionAuthorizationInput & Readonly<{ requireStepUp?: boolean }>,
    handler?: object,
  ): Promise<WorkspaceContext> {
    // Only a server handler bearing TargetPrincipalCommand may carry a target principalId.
    assertNoAuthoritativeClientFields(request.body, handler);
    const session = await this.read(request, input.operationClass !== "READ");
    if (
      input.requireStepUp &&
      (session.stepUpAt === undefined ||
        session.stepUpAt > this.clock() + this.verifier.policy.clockToleranceSeconds * 1000 ||
        this.clock() - session.stepUpAt > this.policy.stepUp.maximumAgeSeconds * 1000)
    )
      throw new Error("CORPORATE_STEP_UP_REQUIRED");
    return await this.identities.authorize(session.identity, input);
  }
  async authorizePlatform(
    request: CorporateSessionRequest,
    input: Readonly<{
      permission: PlatformAccessPermission;
      operationClass: "READ" | "MUTATE";
      requireStepUp?: boolean;
    }>,
  ): Promise<PlatformAccessContext> {
    assertNoAuthoritativeClientFields(request.body);
    const session = await this.read(request, input.operationClass !== "READ");
    if (
      input.requireStepUp &&
      (session.stepUpAt === undefined ||
        session.stepUpAt > this.clock() + this.verifier.policy.clockToleranceSeconds * 1000 ||
        this.clock() - session.stepUpAt > this.policy.stepUp.maximumAgeSeconds * 1000)
    )
      throw new Error("CORPORATE_STEP_UP_REQUIRED");
    if (!this.identities.authorizePlatform) throw new Error("PLATFORM_ACCESS_DENIED");
    return this.identities.authorizePlatform(session.identity, input.permission);
  }
  async logout(request: CorporateSessionRequest): Promise<string> {
    await this.read(request, true);
    await this.store.remove(
      `${this.policy.namespace}:session`,
      hash(this.cookie(request, this.#sessionCookie)!),
    );
    return this.setCookie(this.#sessionCookie, "", 0);
  }

  private async read(request: CorporateSessionRequest, mutate: boolean): Promise<Session> {
    try {
      if (mutate) this.origin(request);
      if (this.header(request, "sec-fetch-site") === "cross-site") throw new Error();
      const raw = this.cookie(request, this.#sessionCookie);
      if (!raw) throw new Error();
      const session = await this.load<Session>("session", hash(raw));
      if (!session || !validOpaque(session.csrfToken)) throw new Error();
      if (
        mutate &&
        (!this.header(request, "x-csrf-token") ||
          !same(this.header(request, "x-csrf-token")!, session.csrfToken))
      )
        throw new Error();
      const identity = await this.identities.authenticate(session.identity);
      if (
        identity.id !== session.principalId ||
        identity.kind !== "HUMAN" ||
        session.identity.expiresAt * 1000 <= this.clock()
      )
        throw new Error();
      return session;
    } catch {
      throw new Error("CORPORATE_SESSION_DENIED");
    }
  }
  private async write(
    kind: "flow" | "session",
    key: string,
    value: Flow | Session,
    expiresAt: number,
  ): Promise<void> {
    const namespace = `${this.policy.namespace}:${kind}`;
    await this.store.put(
      namespace,
      key,
      await this.codec.seal(value, `${namespace}:${key}`),
      expiresAt,
      this.clock(),
    );
  }
  private async load<T extends Flow | Session>(
    kind: "flow" | "session",
    key: string,
  ): Promise<T | undefined> {
    const namespace = `${this.policy.namespace}:${kind}`;
    const value = await this.store.get(namespace, key, this.clock());
    if (!value) return undefined;
    const body = object(await this.codec.open(value, `${namespace}:${key}`));
    const ref = object(body.policyRef);
    if (
      ref.id !== this.policy.policyRef.id ||
      ref.version !== this.policy.policyRef.version ||
      ref.contentHash !== this.policy.policyRef.contentHash ||
      typeof body.expiresAt !== "number" ||
      !Number.isFinite(body.expiresAt) ||
      body.expiresAt <= this.clock()
    )
      throw new Error("CORPORATE_SESSION_DENIED");
    return body as unknown as T;
  }
  private origin(request: CorporateSessionRequest): void {
    if (
      this.header(request, "origin") !== this.policy.browserOrigin ||
      this.header(request, "sec-fetch-site") === "cross-site"
    )
      throw new Error("CORPORATE_SESSION_DENIED");
  }
  private header(request: CorporateSessionRequest, key: string): string | undefined {
    const value = request.headers[key];
    return typeof value === "string" ? value : undefined;
  }
  private cookie(request: CorporateSessionRequest, key: string): string | undefined {
    const raw = this.header(request, "cookie");
    if (!raw || raw.length > 8192) return undefined;
    const found = raw
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${key}=`));
    if (found.length !== 1) return undefined;
    const value = found[0]!.slice(key.length + 1);
    return validOpaque(value) ? value : undefined;
  }
  private setCookie(name: string, value: string, expiresAt: number): string {
    return `${name}=${value}; Path=/; Max-Age=${Math.max(0, Math.floor((expiresAt - this.clock()) / 1000))}; HttpOnly; SameSite=Lax${this.verifier.policy.mode === "CORPORATE" ? "; Secure" : ""}`;
  }
  private async clientAuthentication(signal: AbortSignal) {
    let abort!: () => void;
    const interrupted = new Promise<never>((_resolve, reject) => {
      abort = () => {
        reject(new Error("CORPORATE_SESSION_DENIED"));
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    try {
      const authentication = await Promise.race([
        this.credentials.authorizeTokenRequest(signal),
        interrupted,
      ]);
      if (
        Object.keys(authentication.form).some(
          (key) => !["client_assertion", "client_assertion_type", "client_secret"].includes(key),
        ) ||
        Object.keys(authentication.headers).some((key) => key.toLowerCase() !== "authorization") ||
        Object.values(authentication.headers).some(
          (value) => !value || value.length > 8192 || /[\r\n]/u.test(value),
        ) ||
        Object.values(authentication.form).some((value) => !value || value.length > 8192) ||
        (this.verifier.policy.mode === "CORPORATE" &&
          !Object.keys(authentication.headers).length &&
          !Object.keys(authentication.form).length)
      )
        throw new Error();
      return authentication;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
}
