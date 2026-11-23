import type { PinnedNetworkTransport } from "../pilot/network-policy.ts";

export interface VaultRequestUse {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly servicePrincipalId: string;
  readonly purpose: string;
  readonly allowedUseHash: string;
}

/** Implemented by the C1-selected workload authentication strategy, never an environment dev-token fallback. */
export interface VaultWorkloadCredentials {
  withToken<T>(
    use: VaultRequestUse,
    signal: AbortSignal,
    consume: (token: string, expiresAt: number) => Promise<T>,
  ): Promise<T>;
}
export interface VaultHttpOptions {
  readonly baseUrl: string;
  readonly namespace: string;
  readonly mode: "CORPORATE" | "LOCAL_FIXTURE";
  readonly deadlineMs: number;
  readonly maximumResponseBytes: number;
  readonly credentials: VaultWorkloadCredentials;
  readonly authorizeEndpoint: (
    request: Readonly<{ url: string; method: "GET" | "POST"; use: VaultRequestUse }>,
    signal: AbortSignal,
  ) => Promise<boolean>;
  readonly clock?: () => number;
  readonly fetch?: typeof fetch;
  readonly network?: PinnedNetworkTransport;
}
class VaultBoundaryError extends Error {}
const denied = (code: string): never => {
  throw new VaultBoundaryError(code);
};
export function vaultObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return denied("VAULT_RESPONSE_INVALID");
  return value as Record<string, unknown>;
}
async function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return denied("VAULT_REQUEST_FAILED");
  let abort: () => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new VaultBoundaryError("VAULT_REQUEST_FAILED"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([promise, interrupted]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export class VaultHttpClient {
  readonly #options: VaultHttpOptions;
  readonly #base: string;
  constructor(options: VaultHttpOptions) {
    let url: URL;
    try {
      url = new URL(options.baseUrl);
    } catch {
      throw new VaultBoundaryError("VAULT_ENDPOINT_DENIED");
    }
    if (
      options.baseUrl !== url.origin ||
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      (options.mode === "CORPORATE" && !options.network) ||
      (options.network !== undefined && options.network.policy.mode !== options.mode) ||
      (options.mode === "CORPORATE"
        ? url.protocol !== "https:"
        : options.mode !== "LOCAL_FIXTURE" ||
          url.protocol !== "http:" ||
          url.hostname !== "127.0.0.1") ||
      !/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]*$/u.test(options.namespace) ||
      !Number.isInteger(options.deadlineMs) ||
      options.deadlineMs < 1 ||
      options.deadlineMs > 30_000 ||
      !Number.isInteger(options.maximumResponseBytes) ||
      options.maximumResponseBytes < 1 ||
      options.maximumResponseBytes > 2_000_000
    )
      throw new VaultBoundaryError("VAULT_ENDPOINT_DENIED");
    this.#base = url.origin;
    this.#options = Object.freeze({ ...options });
  }

  usesNetwork(network: PinnedNetworkTransport): boolean {
    return this.#options.network === network;
  }

  async request(
    use: VaultRequestUse,
    method: "GET" | "POST",
    path: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<Readonly<{ value: unknown; credentialExpiresAt: number }>> {
    const options = this.#options;
    const clock = options.clock ?? Date.now;
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(options.deadlineMs)]);
    try {
      if (
        !/^\/v1\/[a-zA-Z0-9_/-]+(?:\?version=[1-9][0-9]*)?$/u.test(path) ||
        path.includes("//") ||
        !use.workspaceId ||
        !use.projectId ||
        !use.servicePrincipalId ||
        !use.purpose ||
        !/^sha256:[a-f0-9]{64}$/u.test(use.allowedUseHash)
      )
        return denied("VAULT_ENDPOINT_DENIED");
      const request = Object.freeze({
        url: `${this.#base}${path}`,
        method,
        use: Object.freeze({ ...use }),
      });
      if (
        options.network &&
        !(await options.network.authorizeEndpoint(request.url, method, bounded))
      )
        return denied("VAULT_ENDPOINT_DENIED");
      if (!(await untilAborted(options.authorizeEndpoint(request, bounded), bounded)))
        return denied("VAULT_ENDPOINT_DENIED");
      let invoked = false;
      return await untilAborted(
        options.credentials.withToken(request.use, bounded, async (token, expiresAt) => {
          if (
            invoked ||
            !token ||
            token.length > 16384 ||
            /[\r\n]/u.test(token) ||
            !Number.isFinite(expiresAt) ||
            expiresAt <= clock() ||
            bounded.aborted
          )
            return denied("VAULT_REQUEST_FAILED");
          invoked = true;
          if (!(await untilAborted(options.authorizeEndpoint(request, bounded), bounded)))
            return denied("VAULT_ENDPOINT_DENIED");
          if (expiresAt <= clock() || bounded.aborted) return denied("VAULT_REQUEST_FAILED");
          const encoded = body === undefined ? undefined : JSON.stringify(body);
          if (encoded !== undefined && Buffer.byteLength(encoded) > 2_000_000)
            return denied("VAULT_RESPONSE_INVALID");
          const response = await untilAborted(
            (options.network?.fetch ?? options.fetch ?? fetch)(request.url, {
              method,
              headers: {
                "x-vault-token": token,
                "x-vault-namespace": options.namespace,
                "content-type": "application/json",
              },
              redirect: "error",
              signal: bounded,
              ...(encoded === undefined ? {} : { body: encoded }),
            }),
            bounded,
          );
          if (!response.ok) {
            await response.body?.cancel();
            return denied("VAULT_REQUEST_FAILED");
          }
          const reader = response.body?.getReader();
          if (!reader) return denied("VAULT_RESPONSE_INVALID");
          const parts: Uint8Array[] = [];
          let size = 0;
          try {
            for (;;) {
              const chunk = await untilAborted(reader.read(), bounded);
              if (chunk.done) break;
              size += chunk.value.byteLength;
              if (size > options.maximumResponseBytes) return denied("VAULT_RESPONSE_INVALID");
              parts.push(chunk.value);
            }
          } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
          if (bounded.aborted || expiresAt <= clock()) return denied("VAULT_REQUEST_FAILED");
          const bytes = Buffer.concat(parts);
          let value: unknown;
          try {
            value = JSON.parse(bytes.toString("utf8"));
          } catch {
            return denied("VAULT_RESPONSE_INVALID");
          } finally {
            bytes.fill(0);
            parts.forEach((part) => {
              part.fill(0);
            });
          }
          return Object.freeze({ value, credentialExpiresAt: expiresAt });
        }),
        bounded,
      );
    } catch (error) {
      // Never include provider bodies, credential errors or transport causes in logs/reports.
      throw new Error(error instanceof VaultBoundaryError ? error.message : "VAULT_REQUEST_FAILED");
    }
  }
}
