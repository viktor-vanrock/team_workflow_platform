import { beforeEach, describe, expect, it, vi } from "vitest";

import { VaultKubernetesCredentials } from "../../../packages/runtime-composition/src/security/vault-kubernetes-credentials.ts";

const file = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: file.read }));

const use = {
  workspaceId: "workspace",
  projectId: "project",
  servicePrincipalId: "service",
  purpose: "CONNECTOR_READ",
  allowedUseHash: `sha256:${"a".repeat(64)}`,
};
const fetcher = vi.fn();
const options = {
  vaultOrigin: "https://vault.example.test",
  namespace: "team/",
  authMount: "kubernetes",
  role: "qa-worker",
  serviceAccountTokenFile: "/var/run/secrets/kubernetes.io/serviceaccount/token",
  network: { policy: { mode: "CORPORATE" }, fetch: fetcher },
  deadlineMs: 1000,
  maximumResponseBytes: 1024,
} as const;

beforeEach(() => {
  file.read.mockReset();
  fetcher.mockReset();
});

describe("Vault Kubernetes workload identity", () => {
  it("uses pinned transport for each login and supplies the short lease only to its consumer", async () => {
    const jwt = Buffer.from("header.payload.signature");
    file.read.mockResolvedValue(jwt);
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({ auth: { client_token: "test-vault-token", lease_duration: 60 } }),
      ),
    );
    const provider = new VaultKubernetesCredentials(options as never);
    const consume = vi.fn().mockResolvedValue("result");
    expect(await provider.withToken(use, new AbortController().signal, consume)).toBe("result");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]![0]).toBe("https://vault.example.test/v1/auth/kubernetes/login");
    expect(consume).toHaveBeenCalledWith("test-vault-token", expect.any(Number));
    expect(jwt.every((byte) => byte === 0)).toBe(true);
  });
  it("fails closed and does not expose provider response text on denied login", async () => {
    file.read.mockResolvedValue(Buffer.from("header.payload.signature"));
    fetcher.mockResolvedValue(new Response("secret-provider-error", { status: 403 }));
    const provider = new VaultKubernetesCredentials(options as never);
    const consume = vi.fn();
    await expect(provider.withToken(use, new AbortController().signal, consume)).rejects.toThrow(
      "VAULT_WORKLOAD_AUTHENTICATION_FAILED",
    );
    expect(consume).not.toHaveBeenCalled();
  });
  it("rejects non-corporate transport and non-HTTPS origin", () => {
    expect(
      () =>
        new VaultKubernetesCredentials({
          ...options,
          vaultOrigin: "http://vault.example.test",
        } as never),
    ).toThrow("VAULT_WORKLOAD_CONFIGURATION_INVALID");
  });
});
