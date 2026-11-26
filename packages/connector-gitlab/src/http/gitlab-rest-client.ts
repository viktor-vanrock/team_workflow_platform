import type { JsonValue } from "@awp/platform-contracts";

import {
  type GitLabAuth,
  type GitLabClock,
  type GitLabOperationRoutingKey,
  systemGitLabClock,
} from "../auth/gitlab-auth.ts";

export type GitLabEnvironmentClass = "LOCAL" | "DEVELOPMENT" | "TEST";
export type GitLabTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type GitLabReadOperation = Exclude<
  GitLabOperationRoutingKey,
  "pipelineTrigger" | "webhookVerify"
>;

export interface GitLabTelemetryEvent {
  readonly operation: string;
  readonly method: "GET" | "POST";
  readonly outcome: "SUCCESS" | "HTTP_ERROR" | "TRANSPORT_ERROR" | "POLICY_DENIED";
  readonly status?: number;
  readonly durationMs: number;
}

export interface GitLabTelemetry {
  record(event: GitLabTelemetryEvent): void;
}

export interface GitLabRestClientOptions {
  readonly baseUrl: string;
  readonly numericProjectId?: number;
  readonly environmentClass: GitLabEnvironmentClass;
  readonly allowedOrigins: readonly string[];
  readonly allowedLocalHostnames?: readonly string[];
  readonly transport?: GitLabTransport;
  readonly auth: GitLabAuth;
  readonly clock?: GitLabClock;
  readonly telemetry?: GitLabTelemetry;
  readonly requestTimeoutMs?: number;
  readonly maxJsonResponseBytes?: number;
  /** Opt-in is reserved for an approved 1.1.0 connector deployment. */
  readonly connectorVersion?: "1.0.0" | "1.1.0";
}

export interface GitLabRequest {
  readonly operation: string;
  readonly authOperation: GitLabReadOperation;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal?: AbortSignal;
  /** Bounded raw-response limit for non-JSON reads such as CI artifacts. */
  readonly maxResponseBytes?: number;
}

export class GitLabTransportError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = "GitLabTransportError";
  }
}

const safeOperation = /^[a-z][a-z0-9.-]{0,127}$/u;
const localHostname =
  /^(?:localhost|127\.0\.0\.1|\[?::1\]?|[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?)$/u;
const allowedReadPaths = Object.freeze([
  /^\/api\/v4\/version$/u,
  /^\/api\/v4\/projects\/\d+$/u,
  /^\/api\/v4\/projects\/\d+\/merge_requests\/[^/]+$/u,
  /^\/api\/v4\/projects\/\d+\/repository\/commits\/[^/]+$/u,
  /^\/api\/v4\/projects\/\d+\/repository\/branches\/[^/]+$/u,
  /^\/api\/v4\/projects\/\d+\/pipelines$/u,
  /^\/api\/v4\/projects\/\d+\/pipelines\/[^/]+$/u,
  /^\/api\/v4\/projects\/\d+\/pipelines\/[^/]+\/(?:variables|jobs)$/u,
  /^\/api\/v4\/projects\/\d+\/jobs\/[^/]+\/artifacts(?:\/[^/].*)?$/u,
]);
const allowedReadCredentialPostPaths = Object.freeze([/^\/api\/v4\/projects\/\d+\/ci\/lint$/u]);
const suiteResultExamplePath =
  /^\/api\/v4\/projects\/\d+\/repository\/files\/\.awp%2Fqa%2Fresult-example\.json\/raw$/u;

function origin(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash)
    throw new GitLabTransportError("GITLAB_ORIGIN_INVALID");
  return url.origin;
}

function retryAfterSeconds(response: Response, now: number): number | undefined {
  const value = response.headers.get("retry-after");
  if (value === null) return undefined;
  if (/^\d+$/u.test(value)) return Number(value);
  const date =
    /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/u.test(
      value,
    )
      ? Date.parse(value)
      : NaN;
  // Preserve invalid/oversized hints for the scheduler to stop; don't silently retry early.
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - now) / 1000)) : NaN;
}

function validatedHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (
      /authorization|cookie|private-token|token/iu.test(key) ||
      /[\r\n]/u.test(key) ||
      /[\r\n]/u.test(value)
    ) {
      throw new GitLabTransportError("GITLAB_REQUEST_HEADER_FORBIDDEN");
    }
    result[key] = value;
  }
  return Object.freeze(result);
}

function validatedTimeout(value: number | undefined): number {
  const timeout = value ?? 10_000;
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 60_000) {
    throw new GitLabTransportError("GITLAB_REQUEST_TIMEOUT_INVALID");
  }
  return timeout;
}

export class GitLabRestClient {
  readonly #baseUrl: URL;
  readonly #allowedOrigins: ReadonlySet<string>;
  readonly #transport: GitLabTransport;
  readonly #clock: GitLabClock;
  readonly #timeoutMs: number;

  constructor(private readonly options: GitLabRestClientOptions) {
    if (
      !(["LOCAL", "DEVELOPMENT", "TEST"] as readonly string[]).includes(options.environmentClass)
    ) {
      throw new GitLabTransportError("GITLAB_PRODUCTION_FORBIDDEN");
    }
    this.#baseUrl = new URL(options.baseUrl);
    if (
      options.numericProjectId !== undefined &&
      (!Number.isSafeInteger(options.numericProjectId) || options.numericProjectId < 1)
    ) {
      throw new GitLabTransportError("GITLAB_PROJECT_ID_INVALID");
    }
    if (
      this.#baseUrl.username ||
      this.#baseUrl.password ||
      this.#baseUrl.search ||
      this.#baseUrl.hash
    ) {
      throw new GitLabTransportError("GITLAB_ENDPOINT_CREDENTIALS_FORBIDDEN");
    }
    if (this.#baseUrl.pathname !== "/")
      throw new GitLabTransportError("GITLAB_ENDPOINT_PATH_FORBIDDEN");

    const localNames = new Set(
      ["localhost", "127.0.0.1", "[::1]", "::1", ...(options.allowedLocalHostnames ?? [])].map(
        (hostname) => hostname.toLowerCase(),
      ),
    );
    if ([...localNames].some((hostname) => !localHostname.test(hostname))) {
      throw new GitLabTransportError("GITLAB_LOCAL_HOSTNAME_ALLOWLIST_INVALID");
    }
    const hostname = this.#baseUrl.hostname.toLowerCase();
    if (options.environmentClass === "LOCAL") {
      if (!localNames.has(hostname))
        throw new GitLabTransportError("GITLAB_LOCAL_ENDPOINT_FORBIDDEN");
      if (this.#baseUrl.protocol !== "http:" && this.#baseUrl.protocol !== "https:") {
        throw new GitLabTransportError("GITLAB_LOCAL_PROTOCOL_FORBIDDEN");
      }
    } else if (this.#baseUrl.protocol !== "https:") {
      throw new GitLabTransportError("GITLAB_TLS_REQUIRED");
    }

    this.#allowedOrigins = new Set(options.allowedOrigins.map(origin));
    if (!this.#allowedOrigins.has(this.#baseUrl.origin))
      throw new GitLabTransportError("GITLAB_ORIGIN_NOT_ALLOWLISTED");
    this.#transport = options.transport ?? fetch;
    this.#clock = options.clock ?? systemGitLabClock;
    this.#timeoutMs = validatedTimeout(options.requestTimeoutMs);
  }

  async get(path: string): Promise<unknown> {
    return await this.requestJson({
      operation: "profile.discovery",
      authOperation: "buildRead",
      method: "GET",
      path,
    });
  }

  async post(path: string, body: Readonly<Record<string, JsonValue>>): Promise<unknown> {
    return await this.requestJson({
      operation: "profile.ci-lint",
      authOperation: "buildRead",
      method: "POST",
      path,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async request(input: GitLabRequest): Promise<Response> {
    const startedAt = this.#clock.now().getTime();
    try {
      const target = this.#target(input);
      const callerHeaders = validatedHeaders(input.headers);
      const timeoutSignal = AbortSignal.timeout(this.#timeoutMs);
      const signal = input.signal ? AbortSignal.any([input.signal, timeoutSignal]) : timeoutSignal;
      const response = await this.options.auth.withReadHeaders(
        input.authOperation,
        signal,
        async (authHeaders) => {
          try {
            return await this.#transport(target, {
              method: input.method,
              headers: { ...authHeaders, ...callerHeaders },
              ...(input.body === undefined ? {} : { body: input.body }),
              signal,
              redirect: "manual",
            });
          } catch (error) {
            if (input.signal?.aborted) throw new GitLabTransportError("GITLAB_CANCELLED");
            if (timeoutSignal.aborted) throw new GitLabTransportError("GITLAB_TIMEOUT");
            // Native fetch signals network faults with a TypeError and a system-error cause.
            const cause =
              error instanceof TypeError
                ? (error.cause as { code?: unknown } | undefined)
                : undefined;
            if (
              typeof cause?.code === "string" &&
              /^(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT)$/u.test(
                cause.code,
              )
            )
              throw new GitLabTransportError("GITLAB_NETWORK_ERROR");
            throw error;
          }
        },
      );
      if (response.status >= 300 && response.status < 400) {
        this.#record(input, startedAt, "POLICY_DENIED", response.status);
        throw new GitLabTransportError("GITLAB_REDIRECT_FORBIDDEN", response.status);
      }
      if (!response.ok) {
        this.#record(input, startedAt, "HTTP_ERROR", response.status);
        throw new GitLabTransportError(
          `GITLAB_HTTP_${response.status}`,
          response.status,
          retryAfterSeconds(response, this.#clock.now().getTime()),
        );
      }
      const contentLength = Number(response.headers.get("content-length") ?? "0");
      if (contentLength > this.#responseLimit(input)) {
        this.#record(input, startedAt, "POLICY_DENIED", response.status);
        throw new GitLabTransportError("GITLAB_RESPONSE_TOO_LARGE", response.status);
      }
      this.#record(input, startedAt, "SUCCESS", response.status);
      return response;
    } catch (error) {
      if (!(error instanceof GitLabTransportError))
        this.#record(input, startedAt, "TRANSPORT_ERROR");
      throw error;
    }
  }

  async requestJson<T = unknown>(input: GitLabRequest): Promise<T> {
    const response = await this.request(input);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > this.#maxJsonResponseBytes())
      throw new GitLabTransportError("GITLAB_RESPONSE_TOO_LARGE", response.status);
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/iu.test(contentType)) {
      throw new GitLabTransportError("GITLAB_RESPONSE_CONTENT_TYPE_INVALID", response.status);
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T;
    } catch {
      throw new GitLabTransportError("GITLAB_RESPONSE_JSON_INVALID", response.status);
    }
  }

  #target(input: GitLabRequest): URL {
    if (!safeOperation.test(input.operation))
      throw new GitLabTransportError("GITLAB_OPERATION_LABEL_INVALID");
    if (
      !input.path.startsWith("/api/v4/") ||
      input.path.includes("\\") ||
      /(?:^|\/)(?:\.{1,2}|%2e(?:%2e)?)(?:\/|$)/iu.test(input.path)
    ) {
      throw new GitLabTransportError("GITLAB_PATH_FORBIDDEN");
    }
    const target = new URL(input.path, this.#baseUrl);
    if (target.origin !== this.#baseUrl.origin || !this.#allowedOrigins.has(target.origin)) {
      throw new GitLabTransportError("GITLAB_EGRESS_FORBIDDEN");
    }
    for (const key of target.searchParams.keys()) {
      if (/^(?:access_token|private_token|token)$/iu.test(key))
        throw new GitLabTransportError("GITLAB_QUERY_CREDENTIAL_FORBIDDEN");
    }
    const example =
      this.options.connectorVersion === "1.1.0" && suiteResultExamplePath.test(target.pathname);
    if (
      example &&
      (!Number.isSafeInteger(this.options.numericProjectId) ||
        (this.options.numericProjectId ?? 0) < 1 ||
        input.method !== "GET" ||
        input.operation !== "suite-result-example.read" ||
        input.authOperation !== "buildRead" ||
        [...target.searchParams.keys()].length !== 1 ||
        !/^[a-f0-9]{40}$/u.test(target.searchParams.get("ref") ?? ""))
    )
      throw new GitLabTransportError("GITLAB_EXAMPLE_READ_FORBIDDEN");
    const allowed =
      input.method === "GET"
        ? example || allowedReadPaths.some((pattern) => pattern.test(target.pathname))
        : allowedReadCredentialPostPaths.some((pattern) => pattern.test(target.pathname));
    if (!allowed) throw new GitLabTransportError("GITLAB_ROUTE_FORBIDDEN");
    const projectMatch = /^\/api\/v4\/projects\/(\d+)(?:\/|$)/u.exec(target.pathname);
    if (
      projectMatch &&
      this.options.numericProjectId !== undefined &&
      Number(projectMatch[1]) !== this.options.numericProjectId
    ) {
      throw new GitLabTransportError("GITLAB_PROJECT_SCOPE_FORBIDDEN");
    }
    if (input.method === "GET" && input.body !== undefined)
      throw new GitLabTransportError("GITLAB_GET_BODY_FORBIDDEN");
    return target;
  }

  #maxJsonResponseBytes(): number {
    const limit = this.options.maxJsonResponseBytes ?? 2_097_152;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_485_760) {
      throw new GitLabTransportError("GITLAB_RESPONSE_LIMIT_INVALID");
    }
    return limit;
  }

  #responseLimit(input: GitLabRequest): number {
    const limit = input.maxResponseBytes ?? this.#maxJsonResponseBytes();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 104_857_600) {
      throw new GitLabTransportError("GITLAB_RESPONSE_LIMIT_INVALID");
    }
    return limit;
  }

  #record(
    input: GitLabRequest,
    startedAt: number,
    outcome: GitLabTelemetryEvent["outcome"],
    status?: number,
  ): void {
    this.options.telemetry?.record(
      Object.freeze({
        operation: input.operation,
        method: input.method,
        outcome,
        ...(status === undefined ? {} : { status }),
        durationMs: Math.max(0, this.#clock.now().getTime() - startedAt),
      }),
    );
  }
}

export const nativeGitLabTransport: GitLabTransport = async (input, init) =>
  await fetch(input, init);
