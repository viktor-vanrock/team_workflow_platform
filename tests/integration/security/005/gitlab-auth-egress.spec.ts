import { describe, expect, it, vi } from "vitest";

import {
  GitLabAuth,
  type GitLabConnectionConfiguration,
  GitLabRestClient,
  type GitLabSecretResolver,
} from "../../../../packages/connector-gitlab/src/index.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

function configuration(): GitLabConnectionConfiguration {
  return {
    schemaVersion: "gitlab-connection-configuration@1.0.0",
    identityReferences: {
      read: {
        identityKind: "NON_HUMAN_PROJECT",
        scope: "read_api",
        nonHumanIdentityEvidenceRef: "evidence:read",
        reference: "secretref://gitlab/read",
        referenceFingerprint: digest("1"),
        ownerRef: "team:qa",
        rotationPolicyRef: "policy:rotation",
        revocationRunbookRef: "runbook:revoke",
      },
      trigger: {
        identityKind: "NON_HUMAN_PROJECT",
        scope: "pipeline_trigger",
        nonHumanIdentityEvidenceRef: "evidence:trigger",
        reference: "secretref://gitlab/trigger",
        referenceFingerprint: digest("2"),
        ownerRef: "team:qa",
        rotationPolicyRef: "policy:rotation",
        revocationRunbookRef: "runbook:revoke",
      },
      webhook: {
        identityMaterialKind: "STANDARD_WEBHOOK_HMAC_KEY",
        keyVersionRef: "key:webhook:v1",
        reference: "secretref://gitlab/webhook",
        referenceFingerprint: digest("3"),
        ownerRef: "team:qa",
        rotationPolicyRef: "policy:rotation",
        revocationRunbookRef: "runbook:revoke",
      },
    },
    operationIdentityRouting: {
      mergeRequestRead: "READ",
      commitRead: "READ",
      buildRead: "READ",
      pipelineTrigger: "TRIGGER",
      pipelineRead: "READ",
      pipelineLookup: "READ",
      artifactMetadata: "READ",
      artifactStream: "READ",
      webhookVerify: "WEBHOOK",
    },
    identitySeparationEvidenceHash: digest("4"),
  };
}

function auth(resolveAudit: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>): GitLabAuth {
  const resolver: GitLabSecretResolver = {
    async resolve(secretRef, allowedUseHash) {
      resolveAudit(secretRef, allowedUseHash);
      return {
        metadata: {},
        async use(_now, consumer) {
          return await consumer(new TextEncoder().encode("credential-value"));
        },
      };
    },
  };
  return new GitLabAuth(configuration(), resolver);
}

function rest(
  resolveAudit: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>,
  transport: typeof fetch,
): GitLabRestClient {
  return new GitLabRestClient({
    baseUrl: "http://127.0.0.1:4010",
    numericProjectId: 5001,
    environmentClass: "LOCAL",
    allowedOrigins: ["http://127.0.0.1:4010"],
    auth: auth(resolveAudit),
    transport,
  });
}

describe("GitLab auth and egress security", () => {
  it("uses the exact operation lease once and never exposes material in the URL", async () => {
    const resolved = vi.fn();
    const transport = vi.fn(async (target: RequestInfo | URL, init?: RequestInit) => {
      expect(String(target)).not.toContain("credential-value");
      expect(new Headers(init?.headers).get("private-token")).toBe("credential-value");
      return new Response("{}", { headers: { "content-type": "application/json" } });
    });
    await rest(resolved, transport).requestJson({
      operation: "pipeline.read",
      authOperation: "pipelineRead",
      method: "GET",
      path: "/api/v4/projects/5001/pipelines/9",
    });
    expect(resolved).toHaveBeenCalledExactlyOnceWith("secretref://gitlab/read", digest("1"));
  });

  it("rejects SSRF, credential query injection, and cross-project substitution before secret resolution", async () => {
    const resolved = vi.fn();
    const transport = vi.fn(async () => new Response("{}"));
    const client = rest(resolved, transport);
    for (const path of [
      "https://evil.invalid/api/v4/projects/5001",
      "/api/v4/projects/5002/pipelines/9",
      "/api/v4/projects/5001/pipelines/9?private_token=stolen",
      "/api/v4/projects/5001/repository/files/secret",
    ]) {
      await expect(
        client.requestJson({
          operation: "pipeline.read",
          authOperation: "pipelineRead",
          method: "GET",
          path,
        }),
      ).rejects.toThrow(/GITLAB_/u);
    }
    expect(resolved).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("treats 401 and 403 as one terminal call and does not retry in the transport", async () => {
    for (const status of [401, 403]) {
      const resolved = vi.fn();
      const transport = vi.fn(async () => new Response("{}", { status }));
      await expect(
        rest(resolved, transport).requestJson({
          operation: "pipeline.read",
          authOperation: "pipelineRead",
          method: "GET",
          path: "/api/v4/projects/5001/pipelines/9",
        }),
      ).rejects.toThrow(`GITLAB_HTTP_${status}`);
      expect(transport).toHaveBeenCalledOnce();
      expect(resolved).toHaveBeenCalledOnce();
    }
  });

  it("rejects caller-supplied authority headers before resolving any secret", async () => {
    const resolved = vi.fn();
    const transport = vi.fn(async () => new Response("{}"));
    await expect(
      rest(resolved, transport).requestJson({
        operation: "pipeline.read",
        authOperation: "pipelineRead",
        method: "GET",
        path: "/api/v4/projects/5001/pipelines/9",
        headers: { authorization: "Bearer caller-value" },
      }),
    ).rejects.toThrow("GITLAB_REQUEST_HEADER_FORBIDDEN");
    expect(resolved).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });
});
