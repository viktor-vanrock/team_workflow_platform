import { describe, expect, it, vi } from "vitest";

import {
  createGitLabDialect,
  GitLabAuth,
  type GitLabConnectionConfiguration,
  GitLabRestClient,
  type GitLabSecretResolver,
  redactGitLabHeaders,
} from "../../../packages/connector-gitlab/src/index.ts";

const hash = `sha256:${"a".repeat(64)}` as const;

function configuration(): GitLabConnectionConfiguration {
  const common = {
    ownerRef: "team:qa",
    rotationPolicyRef: "policy:rotation:v1",
    revocationRunbookRef: "runbook:revoke:v1",
  } as const;
  return Object.freeze({
    schemaVersion: "gitlab-connection-configuration@1.0.0",
    identityReferences: Object.freeze({
      read: Object.freeze({
        ...common,
        identityKind: "NON_HUMAN_PROJECT",
        scope: "read_api",
        nonHumanIdentityEvidenceRef: "evidence:read",
        reference: "secretref://gitlab/read",
        referenceFingerprint: hash,
      }),
      trigger: Object.freeze({
        ...common,
        identityKind: "NON_HUMAN_PROJECT",
        scope: "pipeline_trigger",
        nonHumanIdentityEvidenceRef: "evidence:trigger",
        reference: "secretref://gitlab/trigger",
        referenceFingerprint: `sha256:${"b".repeat(64)}`,
      }),
      webhook: Object.freeze({
        ...common,
        identityMaterialKind: "STANDARD_WEBHOOK_HMAC_KEY",
        keyVersionRef: "key:webhook:v1",
        reference: "secretref://gitlab/webhook",
        referenceFingerprint: `sha256:${"c".repeat(64)}`,
      }),
    }),
    operationIdentityRouting: Object.freeze({
      mergeRequestRead: "READ",
      commitRead: "READ",
      buildRead: "READ",
      pipelineTrigger: "TRIGGER",
      pipelineRead: "READ",
      pipelineLookup: "READ",
      artifactMetadata: "READ",
      artifactStream: "READ",
      webhookVerify: "WEBHOOK",
    }),
    identitySeparationEvidenceHash: `sha256:${"d".repeat(64)}`,
  });
}

function resolver(onResolve = vi.fn()): GitLabSecretResolver {
  return {
    async resolve(reference, allowedUseHash) {
      onResolve(reference, allowedUseHash);
      return {
        metadata: Object.freeze({ expiresAt: "2026-09-01T18:00:00.000Z" }),
        async use(_now, consumer) {
          return await consumer(new TextEncoder().encode("read-credential"));
        },
      };
    },
  };
}

function client(
  input: Readonly<{
    transport: typeof fetch;
    maximum?: number;
    onResolve?: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
  }>,
): GitLabRestClient {
  return new GitLabRestClient({
    baseUrl: "http://127.0.0.1:4010",
    numericProjectId: 5001,
    environmentClass: "LOCAL",
    allowedOrigins: ["http://127.0.0.1:4010"],
    auth: new GitLabAuth(configuration(), resolver(input.onResolve)),
    transport: input.transport,
    ...(input.maximum === undefined ? {} : { maxJsonResponseBytes: input.maximum }),
  });
}

describe("GitLab connector foundation conformance", () => {
  it("uses injected native-fetch shape, the routed read lease, and safe telemetry-free request fields", async () => {
    const transport = vi.fn(async (target: RequestInfo | URL, init?: RequestInit) => {
      expect(String(target)).toBe("http://127.0.0.1:4010/api/v4/projects/5001/pipelines/17");
      expect(init?.redirect).toBe("manual");
      expect(new Headers(init?.headers).get("private-token")).toBe("read-credential");
      return new Response(JSON.stringify({ id: 17 }), {
        headers: { "content-type": "application/json" },
      });
    });
    const result = await client({ transport }).requestJson({
      operation: "pipeline.read",
      authOperation: "pipelineRead",
      method: "GET",
      path: "/api/v4/projects/5001/pipelines/17",
    });
    expect(result).toEqual({ id: 17 });
    expect(transport).toHaveBeenCalledOnce();
  });

  it("rejects redirects and bounded-response overflow without following provider locations", async () => {
    const redirect = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: "https://evil.invalid/" } }),
    );
    await expect(
      client({ transport: redirect }).requestJson({
        operation: "pipeline.read",
        authOperation: "pipelineRead",
        method: "GET",
        path: "/api/v4/projects/5001/pipelines/17",
      }),
    ).rejects.toThrow("GITLAB_REDIRECT_FORBIDDEN");
    const oversized = vi.fn(
      async () =>
        new Response(JSON.stringify({ value: "0123456789" }), {
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      client({ transport: oversized, maximum: 4 }).requestJson({
        operation: "pipeline.read",
        authOperation: "pipelineRead",
        method: "GET",
        path: "/api/v4/projects/5001/pipelines/17",
      }),
    ).rejects.toThrow("GITLAB_RESPONSE_TOO_LARGE");
  });

  it("keeps retry/cancel/config/deployment routes outside the transport surface", async () => {
    const transport = vi.fn(async () => new Response("{}"));
    const onResolve = vi.fn();
    const rest = client({ transport, onResolve });
    for (const path of [
      "/api/v4/projects/5001/pipelines/17/retry",
      "/api/v4/projects/5001/pipelines/17/cancel",
      "/api/v4/projects/5001/repository/files/.gitlab-ci.yml",
      "/api/v4/projects/5001/deployments",
    ]) {
      await expect(
        rest.requestJson({
          operation: "profile.discovery",
          authOperation: "buildRead",
          method: "GET",
          path,
        }),
      ).rejects.toThrow("GITLAB_ROUTE_FORBIDDEN");
    }
    expect(onResolve).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("routes only an exact pinned REST v4 instance dialect and redacts credential headers", () => {
    const dialect = createGitLabDialect({
      adapterFamily: "gitlab-rest-v4",
      apiFamily: "v4",
      edition: "EE",
      exactVersion: "18.1.0-mock.1",
      exactBuild: "mock-build-1",
      triggerDialect: "TYPED_INPUTS",
      webhookDialect: "STANDARD_WEBHOOKS_HMAC_SHA256",
    });
    expect(dialect.ciLintPath(5001)).toBe("/api/v4/projects/5001/ci/lint");
    expect(() => createGitLabDialect({ ...dialect, apiFamily: "v5" as never })).toThrow(
      "GITLAB_DIALECT_UNSUPPORTED",
    );
    expect(redactGitLabHeaders({ "private-token": "secret", accept: "application/json" })).toEqual({
      "private-token": "[REDACTED]",
      accept: "application/json",
    });
  });
});
