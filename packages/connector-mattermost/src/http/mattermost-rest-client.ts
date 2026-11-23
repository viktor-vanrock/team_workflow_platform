import type { MattermostCredentialLease } from "../auth/mattermost-auth.ts";

export interface MattermostRestClientOptions {
  readonly baseUrl: string;
  readonly environmentClass: "LOCAL" | "DEVELOPMENT" | "TEST" | "PRODUCTION";
  readonly allowedHosts: readonly string[];
  readonly credential: MattermostCredentialLease;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}
export class MattermostTransportError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = "MattermostTransportError";
  }
}
function retryAfter(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (value === null) return undefined;
  if (/^\d+$/u.test(value)) return Number(value);
  const date =
    /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/u.test(
      value,
    )
      ? Date.parse(value)
      : NaN;
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : NaN;
}
export class MattermostRestClient {
  readonly #base: URL;
  constructor(private readonly options: MattermostRestClientOptions) {
    this.#base = new URL(options.baseUrl);
  }
  async get(path: string): Promise<unknown> {
    return this.request("GET", path);
  }
  async post(path: string, body: unknown): Promise<unknown> {
    return this.request("POST", path, body);
  }
  async request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    if (this.options.environmentClass === "PRODUCTION")
      throw new Error("MATTERMOST_PRODUCTION_FORBIDDEN");
    if (!path.startsWith("/api/v4/") || path.includes("..") || /^\/\//u.test(path))
      throw new Error("MATTERMOST_PATH_NOT_ALLOWLISTED");
    const loopback = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]).has(this.#base.hostname);
    if (this.options.environmentClass === "LOCAL" ? !loopback : this.#base.protocol !== "https:")
      throw new Error("MATTERMOST_EGRESS_TLS_INVALID");
    if (!loopback && !this.options.allowedHosts.includes(this.#base.hostname))
      throw new Error("MATTERMOST_EGRESS_HOST_FORBIDDEN");
    const fetcher = this.options.fetcher ?? fetch;
    return this.options.credential.use(async (credential) => {
      const signal = AbortSignal.timeout(this.options.timeoutMs ?? 5000);
      let response: Response;
      try {
        response = await fetcher(new URL(path, this.#base), {
          method,
          headers: {
            authorization: `Bearer ${credential}`,
            accept: "application/json",
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal,
          redirect: "error",
        });
      } catch (error) {
        if (signal.aborted) throw new MattermostTransportError("MATTERMOST_TIMEOUT");
        const cause =
          error instanceof TypeError ? (error.cause as { code?: unknown } | undefined) : undefined;
        if (
          typeof cause?.code === "string" &&
          /^(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT)$/u.test(
            cause.code,
          )
        )
          throw new MattermostTransportError("MATTERMOST_NETWORK_ERROR");
        throw error;
      }
      if (response.status >= 300 && response.status < 400)
        throw new Error("MATTERMOST_REDIRECT_FORBIDDEN");
      if (!response.ok)
        throw new MattermostTransportError(
          `MATTERMOST_HTTP_${response.status}`,
          response.status,
          retryAfter(response),
        );
      return response.json() as Promise<unknown>;
    });
  }
}
