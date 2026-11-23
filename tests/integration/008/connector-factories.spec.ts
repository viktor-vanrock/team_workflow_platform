import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type GitLabConnectionConfiguration,
  gitLabOperationIdentityRouting,
} from "../../../packages/connector-gitlab/src/index.ts";
import {
  type CorporateConnectorBinding,
  CorporateConnectorFactories,
} from "../../../packages/runtime-composition/src/pilot/connector-factories.ts";
import { PinnedNetworkTransport } from "../../../packages/runtime-composition/src/pilot/network-policy.ts";
import { VaultHttpClient } from "../../../packages/runtime-composition/src/security/vault-http-client.ts";
import {
  secretAllowedUseHash,
  type VaultSecretMapping,
} from "../../../packages/runtime-composition/src/security/vault-secret-resolver.ts";
import { startVaultFixture008 } from "../../support/008-vault-fixture.ts";

const ref = (id: string) => ({ id, version: 1, contentHash: `sha256:${"a".repeat(64)}` as const });
const scope = { workspaceId: "workspace", projectId: "project", servicePrincipalId: "service" };
describe("008 corporate connector factories", () => {
  let vault: Awaited<ReturnType<typeof startVaultFixture008>>;
  let provider: ReturnType<typeof createServer>;
  let origin: string;
  let network: PinnedNetworkTransport;
  let client: VaultHttpClient;
  let allowed: boolean;
  let status: number;
  let effects: number;
  let delayMs: number;
  let requests: {
    path: string;
    method: string;
    authorization?: string;
    token?: string;
    body: string;
  }[];
  beforeEach(async () => {
    vault = await startVaultFixture008();
    allowed = true;
    status = 200;
    effects = 0;
    delayMs = 0;
    requests = [];
    provider = createServer((request, response) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
        requests.push({
          path: request.url ?? "",
          method: request.method ?? "",
          ...(request.headers.authorization
            ? { authorization: request.headers.authorization }
            : {}),
          ...(request.headers["private-token"]
            ? { token: String(request.headers["private-token"]) }
            : {}),
          body: Buffer.concat(chunks).toString(),
        });
        if (request.method === "POST" && status === 200) effects++;
        if (delayMs)
          await new Promise((resolve) => {
            setTimeout(resolve, delayMs);
          });
        response.writeHead(status, { "content-type": "application/json" });
        response.end(
          JSON.stringify(status === 200 ? { id: 42 } : { error: "SECRET_PROVIDER_CANARY" }),
        );
      })().catch(() => response.destroy());
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    origin = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
    network = new PinnedNetworkTransport({
      ref: ref("network"),
      mode: "LOCAL_FIXTURE",
      validUntil: new Date(Date.now() + 60_000).toISOString(),
      deadlineMs: 1000,
      maximumRequestBytes: 8192,
      maximumResponseBytes: 8192,
      endpoints: [origin, vault.origin].map((endpoint) => ({
        origin: endpoint,
        addressRanges: ["127.0.0.1/32"],
        routes: [
          {
            path: endpoint === origin ? "/" : "/v1/secret/data/",
            match: "PREFIX" as const,
            methods: ["GET", "POST"],
            queryKeys: ["version"],
          },
        ],
      })),
    });
    client = new VaultHttpClient({
      baseUrl: vault.origin,
      namespace: "pilot/",
      mode: "LOCAL_FIXTURE",
      deadlineMs: 500,
      maximumResponseBytes: 8192,
      network,
      authorizeEndpoint: async (request, signal) =>
        network.authorizeEndpoint(request.url, request.method, signal),
      credentials: {
        withToken: async (_use, _signal, consume) =>
          consume("fixture-workload-credential", Date.now() + 5000),
      },
    });
  });
  afterEach(async () => {
    await vault.stop();
    provider.closeAllConnections();
    await new Promise<void>((resolve) => {
      provider.close(() => resolve());
    });
  });
  function binding(providerKind: "JIRA" | "GITLAB" | "MATTERMOST"): CorporateConnectorBinding {
    return {
      ref: ref(providerKind),
      ...scope,
      profileRef: ref("profile"),
      connectionRef: ref("connection"),
      policyRef: ref("policy"),
      provider: providerKind,
      endpoint: origin,
      mode: "LOCAL_FIXTURE",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      ...(providerKind === "GITLAB"
        ? {
            gitlab: {
              numericProjectId: 42,
              trigger: {
                dialect: "TYPED_INPUTS" as const,
                ref: "qa",
                pipelineNameInput: "awp_name",
              },
            },
          }
        : {}),
      routes: [
        {
          method: "GET",
          path:
            providerKind === "JIRA"
              ? "/rest/api/3/issue/42"
              : providerKind === "GITLAB"
                ? "/api/v4/projects/42"
                : "/api/v4/users/me",
          match: "EXACT",
          purpose: "CONNECTOR_READ",
        },
        {
          method: "POST",
          path:
            providerKind === "JIRA"
              ? "/rest/api/3/issue"
              : providerKind === "GITLAB"
                ? "/api/v4/projects/42/trigger/pipeline"
                : "/api/v4/posts",
          match: "EXACT",
          purpose: "CONNECTOR_WRITE",
        },
      ],
    };
  }
  function mapping(
    value: CorporateConnectorBinding,
    purpose: VaultSecretMapping["use"]["purpose"],
  ): VaultSecretMapping {
    const path = `qa/${value.provider.toLowerCase()}/${purpose.toLowerCase()}`;
    vault.state.credentials[path] = `fixture-${purpose}-secret-canary`;
    return {
      ref: ref(purpose),
      secretRef:
        value.provider === "GITLAB"
          ? `secretref://gitlab/${purpose.toLowerCase()}`
          : `secret-ref:${value.provider}/${purpose}`,
      use: {
        ...scope,
        purpose,
        profileRef: value.profileRef,
        connectionRef: value.connectionRef,
        policyRef: value.policyRef,
      },
      mount: "secret",
      path,
      field: "credential",
      secretVersion: 3,
      maximumLeaseMs: 1000,
    };
  }
  function factories(value: CorporateConnectorBinding, maximumLeaseMs = 1000, basic = false) {
    const read = { ...mapping(value, "CONNECTOR_READ"), maximumLeaseMs };
    const write = { ...mapping(value, "CONNECTOR_WRITE"), maximumLeaseMs };
    const webhook = mapping(value, "CONNECTOR_WEBHOOK");
    const runtime = new CorporateConnectorFactories({
      network,
      vault: client,
      authority: { authorize: async () => allowed },
      secretAuthorization: { authorize: async () => allowed, isCurrent: () => allowed },
      bindings: [
        {
          binding: value,
          credentials: [
            {
              mapping: read,
              authentication:
                value.provider === "GITLAB"
                  ? "GITLAB_PRIVATE_TOKEN"
                  : basic
                    ? "JIRA_BASIC"
                    : "BEARER",
            },
            {
              mapping: write,
              authentication: value.provider === "GITLAB" ? "GITLAB_TRIGGER_TOKEN" : "BEARER",
            },
            ...(value.provider === "GITLAB"
              ? [{ mapping: webhook, authentication: "STANDARD_WEBHOOK_HMAC" as const }]
              : []),
          ],
        },
      ],
    });
    return { runtime, read, write, webhook };
  }
  it("uses current scoped Vault leases for Jira reads and writes over the pinned transport", async () => {
    const value = binding("JIRA");
    const { runtime } = factories(value);
    const jira = runtime.jira(value.ref.id);
    await jira.request({ method: "GET", path: "/rest/api/3/issue/42" });
    await jira.request({ method: "POST", path: "/rest/api/3/issue", body: "{}" });
    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.authorization)).toEqual([
      "Bearer fixture-CONNECTOR_READ-secret-canary",
      "Bearer fixture-CONNECTOR_WRITE-secret-canary",
    ]);
    expect(vault.requests).toHaveLength(2);
    expect(effects).toBe(1);
  });
  it("denies drift, caller credential overrides and unapproved routes before sending secrets", async () => {
    const value = binding("JIRA");
    const jira = factories(value).runtime.jira(value.ref.id);
    await expect(jira.request({ method: "GET", path: "/rest/api/3/issue/43" })).rejects.toThrow();
    await expect(
      jira.request({
        method: "GET",
        path: "/rest/api/3/issue/42",
        headers: { authorization: "Bearer injected" },
      }),
    ).rejects.toThrow();
    allowed = false;
    await expect(jira.request({ method: "GET", path: "/rest/api/3/issue/42" })).rejects.toThrow();
    expect(vault.requests).toHaveLength(0);
    expect(requests).toHaveLength(0);
    expect(() => factories({ ...value, mode: "CORPORATE" })).toThrow();
    expect(() => factories({ ...value, expiresAt: "2000-01-01T00:00:00Z" })).toThrow();
  });
  it("separates Mattermost read and write clients and does not retry HTTP failures", async () => {
    const value = binding("MATTERMOST");
    const runtime = factories(value).runtime;
    const read = runtime.mattermost(value.ref.id, "CONNECTOR_READ");
    const write = runtime.mattermost(value.ref.id, "CONNECTOR_WRITE");
    await expect(read.post("/api/v4/posts", {})).rejects.toThrow();
    expect(effects).toBe(0);
    await expect(read.get("/api/v4/users/me")).resolves.toEqual({ id: 42 });
    status = 503;
    await expect(write.post("/api/v4/posts", {})).rejects.toThrow("MATTERMOST_HTTP_503");
    expect(requests).toHaveLength(2);
    expect(effects).toBe(0);
  });
  it("binds GitLab read/trigger/webhook slots to distinct exact allowed-use hashes", async () => {
    const value = binding("GITLAB");
    const { runtime, read, write, webhook } = factories(value);
    const credential = (map: VaultSecretMapping) => ({
      reference: map.secretRef,
      referenceFingerprint: secretAllowedUseHash(map) as `sha256:${string}`,
      ownerRef: "owner",
      rotationPolicyRef: "rotation",
      revocationRunbookRef: "revocation",
    });
    const connection: GitLabConnectionConfiguration = {
      schemaVersion: "gitlab-connection-configuration@1.0.0",
      identityReferences: {
        read: {
          ...credential(read),
          identityKind: "NON_HUMAN_PROJECT",
          scope: "read_api",
          nonHumanIdentityEvidenceRef: "read-proof",
        },
        trigger: {
          ...credential(write),
          identityKind: "NON_HUMAN_PROJECT",
          scope: "pipeline_trigger",
          nonHumanIdentityEvidenceRef: "write-proof",
        },
        webhook: {
          ...credential(webhook),
          identityMaterialKind: "STANDARD_WEBHOOK_HMAC_KEY",
          keyVersionRef: "key-v1",
        },
      },
      operationIdentityRouting: gitLabOperationIdentityRouting,
      identitySeparationEvidenceHash: ref("separation").contentHash,
    };
    const gitlab = runtime.gitlab(value.ref.id, connection, 42);
    await gitlab.client.get("/api/v4/projects/42");
    expect(requests[0]?.token).toBe("fixture-CONNECTOR_READ-secret-canary");
    await expect(gitlab.client.get("/api/v4/projects/43")).rejects.toThrow();
    const wrong = {
      ...connection,
      identityReferences: {
        ...connection.identityReferences,
        read: { ...connection.identityReferences.read, reference: write.secretRef },
      },
    };
    expect(() => runtime.gitlab(value.ref.id, wrong, 42)).toThrow();
    await gitlab.triggerTransport.trigger({
      numericProjectId: 42,
      path: "/api/v4/projects/42/trigger/pipeline",
      dialect: "TYPED_INPUTS",
      pipelineName: "attempt-one",
      body: { ref: "qa", name: "attempt-one", inputs: { marker: "same-effect" } },
    });
    expect(JSON.parse(requests[1]!.body)).toEqual({
      ref: "qa",
      inputs: { marker: "same-effect", awp_name: "attempt-one" },
      token: "fixture-CONNECTOR_WRITE-secret-canary",
    });
    expect(requests).toHaveLength(2);
    expect(effects).toBe(1);
  });
  it("redacts Vault outage without falling back to an environment credential", async () => {
    const value = binding("JIRA");
    const jira = factories(value).runtime.jira(value.ref.id);
    vault.state.status = 503;
    await expect(jira.request({ method: "GET", path: "/rest/api/3/issue/42" })).rejects.toThrow(
      /^CORPORATE_CONNECTOR_DENIED$/u,
    );
    expect(requests).toHaveLength(0);
    expect(vault.requests).toHaveLength(1);
  });
  it("uses the selected Jira Basic protocol and denies an expired in-flight lease", async () => {
    const value = binding("JIRA");
    const { runtime, read } = factories(value, 1000, true);
    vault.state.credentials[read.path] = "service@example.test:api-token-canary";
    await runtime.jira(value.ref.id).request({ method: "GET", path: "/rest/api/3/issue/42" });
    expect(requests[0]?.authorization).toBe(
      `Basic ${Buffer.from("service@example.test:api-token-canary").toString("base64")}`,
    );
    const short = factories(value, 40).runtime.jira(value.ref.id);
    delayMs = 500;
    const started = Date.now();
    await expect(short.request({ method: "GET", path: "/rest/api/3/issue/42" })).rejects.toThrow(
      "CORPORATE_CONNECTOR_DENIED",
    );
    expect(Date.now() - started).toBeLessThan(400);
    expect(requests).toHaveLength(2);
  });
});
