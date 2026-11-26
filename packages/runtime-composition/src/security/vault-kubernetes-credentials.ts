import { readFile } from "node:fs/promises";

import type { PinnedNetworkTransport } from "../pilot/network-policy.ts";
import type { VaultRequestUse, VaultWorkloadCredentials } from "./vault-http-client.ts";

export interface VaultKubernetesCredentialsOptions {
  readonly vaultOrigin: string;
  readonly namespace: string;
  readonly authMount: string;
  readonly role: string;
  readonly serviceAccountTokenFile: string;
  readonly network: PinnedNetworkTransport;
  readonly deadlineMs: number;
  readonly maximumResponseBytes: number;
}

/** A fresh Kubernetes workload login is scoped to one call. No Vault token is persisted or logged. */
export class VaultKubernetesCredentials implements VaultWorkloadCredentials {
  readonly #options: VaultKubernetesCredentialsOptions;
  constructor(options: VaultKubernetesCredentialsOptions) {
    let origin: URL;
    try {
      origin = new URL(options.vaultOrigin);
    } catch {
      throw new Error("VAULT_WORKLOAD_CONFIGURATION_INVALID");
    }
    if (
      origin.origin !== options.vaultOrigin ||
      origin.protocol !== "https:" ||
      !options.network ||
      options.network.policy.mode !== "CORPORATE" ||
      !/^[A-Za-z0-9_-]+$/u.test(options.authMount) ||
      !/^[A-Za-z0-9_-]{1,128}$/u.test(options.role) ||
      !/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]*$/u.test(options.namespace) ||
      typeof options.serviceAccountTokenFile !== "string" ||
      !options.serviceAccountTokenFile.startsWith("/") ||
      !Number.isSafeInteger(options.deadlineMs) ||
      options.deadlineMs < 1 ||
      options.deadlineMs > 30_000 ||
      !Number.isSafeInteger(options.maximumResponseBytes) ||
      options.maximumResponseBytes < 1 ||
      options.maximumResponseBytes > 65_536
    )
      throw new Error("VAULT_WORKLOAD_CONFIGURATION_INVALID");
    this.#options = Object.freeze({ ...options });
  }

  async withToken<T>(
    use: VaultRequestUse,
    signal: AbortSignal,
    consume: (token: string, expiresAt: number) => Promise<T>,
  ): Promise<T> {
    const options = this.#options;
    if (signal.aborted || !use.workspaceId || !use.projectId || !use.servicePrincipalId)
      throw new Error("VAULT_WORKLOAD_AUTHENTICATION_FAILED");
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(options.deadlineMs)]);
    let jwtBytes: Buffer | undefined;
    try {
      jwtBytes = await readFile(options.serviceAccountTokenFile, { signal: bounded });
      if (jwtBytes.length < 1 || jwtBytes.length > 16_384) throw new Error();
      const jwt = jwtBytes.toString("utf8").trim();
      if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(jwt)) throw new Error();
      const requestedAt = Date.now();
      const response = await options.network.fetch(
        `${options.vaultOrigin}/v1/auth/${options.authMount}/login`,
        {
          method: "POST",
          signal: bounded,
          redirect: "error",
          headers: { "content-type": "application/json", "x-vault-namespace": options.namespace },
          body: JSON.stringify({ role: options.role, jwt }),
        },
      );
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error();
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > options.maximumResponseBytes) throw new Error();
          chunks.push(chunk.value);
        }
      } catch (error) {
        chunks.forEach((chunk) => chunk.fill(0));
        throw error;
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const bytes = Buffer.concat(chunks);
      let decoded: unknown;
      try {
        decoded = JSON.parse(bytes.toString("utf8"));
      } finally {
        bytes.fill(0);
        chunks.forEach((chunk) => chunk.fill(0));
      }
      if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error();
      const auth = (decoded as Record<string, unknown>).auth;
      if (!auth || typeof auth !== "object" || Array.isArray(auth)) throw new Error();
      const values = auth as Record<string, unknown>;
      const token = values.client_token;
      const seconds = values.lease_duration;
      if (
        typeof token !== "string" ||
        !token ||
        token.length > 16_384 ||
        /[\r\n]/u.test(token) ||
        typeof seconds !== "number" ||
        !Number.isSafeInteger(seconds) ||
        seconds < 1 ||
        seconds > 86_400 ||
        bounded.aborted
      )
        throw new Error();
      const expiresAt = requestedAt + Math.min(seconds * 1000, 60_000);
      if (expiresAt <= Date.now()) throw new Error();
      values.client_token = null;
      return await consume(token, expiresAt);
    } catch {
      throw new Error("VAULT_WORKLOAD_AUTHENTICATION_FAILED");
    } finally {
      jwtBytes?.fill(0);
    }
  }
}
