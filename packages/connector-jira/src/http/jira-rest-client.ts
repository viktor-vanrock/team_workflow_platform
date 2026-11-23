export type JiraEffectEnvironment = "LOCAL" | "NON_PROD";
export type JiraTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface JiraRestClientOptions {
  readonly baseUrl: string;
  readonly environment: JiraEffectEnvironment;
  readonly allowedOrigins: readonly string[];
  /** Explicit container-DNS names accepted only for LOCAL compositions. */
  readonly allowedLocalHostnames?: readonly string[];
  readonly transport: JiraTransport;
  readonly maxResponseBytes?: number;
}

export interface JiraRequest {
  readonly method: "GET" | "HEAD" | "POST" | "PUT" | "DELETE";
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal?: AbortSignal;
}

export class JiraTransportError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = "JiraTransportError";
  }
}

function normalizedOrigin(value: string): string {
  return new URL(value).origin;
}

export class JiraRestClient {
  readonly #baseUrl: URL;
  readonly #allowedOrigins: ReadonlySet<string>;
  constructor(private readonly options: JiraRestClientOptions) {
    if (options.environment !== "LOCAL" && options.environment !== "NON_PROD")
      throw new JiraTransportError("JIRA_ENVIRONMENT_FORBIDDEN");
    this.#baseUrl = new URL(options.baseUrl);
    if (this.#baseUrl.username || this.#baseUrl.password)
      throw new JiraTransportError("JIRA_ENDPOINT_CREDENTIALS_FORBIDDEN");
    if (options.environment === "NON_PROD" && this.#baseUrl.protocol !== "https:")
      throw new JiraTransportError("JIRA_TLS_REQUIRED");
    const localHostnames = new Set([
      "127.0.0.1",
      "localhost",
      ...(options.allowedLocalHostnames ?? []).map((hostname) => hostname.toLowerCase()),
    ]);
    if (
      [...localHostnames].some(
        (hostname) => !/^(?:[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?|127\.0\.0\.1)$/u.test(hostname),
      )
    ) {
      throw new JiraTransportError("JIRA_LOCAL_HOSTNAME_ALLOWLIST_INVALID");
    }
    if (
      options.environment === "LOCAL" &&
      !localHostnames.has(this.#baseUrl.hostname.toLowerCase())
    )
      throw new JiraTransportError("JIRA_LOCAL_ENDPOINT_FORBIDDEN");
    this.#allowedOrigins = new Set(options.allowedOrigins.map(normalizedOrigin));
    if (!this.#allowedOrigins.has(this.#baseUrl.origin))
      throw new JiraTransportError("JIRA_ORIGIN_NOT_ALLOWLISTED");
  }
  async request(input: JiraRequest): Promise<Response> {
    if (
      !input.path.startsWith("/") ||
      input.path.includes("/latest") ||
      input.path.includes("\\") ||
      input.path.includes("..")
    )
      throw new JiraTransportError("JIRA_PATH_FORBIDDEN");
    const target = new URL(input.path, this.#baseUrl);
    if (target.origin !== this.#baseUrl.origin || !this.#allowedOrigins.has(target.origin))
      throw new JiraTransportError("JIRA_EGRESS_FORBIDDEN");
    const response = await this.options.transport(target, {
      method: input.method,
      ...(input.headers ? { headers: input.headers } : {}),
      ...(input.body === undefined ? {} : { body: input.body }),
      redirect: "manual",
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (response.status >= 300 && response.status < 400)
      throw new JiraTransportError("JIRA_REDIRECT_FORBIDDEN", response.status);
    if (response.status >= 400) {
      const retryAfter = response.headers.get("retry-after");
      throw new JiraTransportError(
        `JIRA_HTTP_${response.status}`,
        response.status,
        retryAfter && /^\d+$/u.test(retryAfter) ? Number(retryAfter) : undefined,
      );
    }
    const limit = this.options.maxResponseBytes ?? 2_097_152;
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > limit) throw new JiraTransportError("JIRA_RESPONSE_TOO_LARGE");
    return response;
  }
}
