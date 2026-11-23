import { describe, expect, it, vi } from "vitest";

import {
  executeAfterQaAutomationGate,
  validateCreateAutomatedSessionBody,
} from "../../../../apps/api/src/extensions/gitlab-automation/qa-automation-security.ts";
import {
  GitLabAuth,
  type GitLabConnectionConfiguration,
  GitLabRestClient,
  redactGitLabHeaders,
} from "../../../../packages/connector-gitlab/src/index.ts";
import {
  AgentRunAggregate,
  ArtifactService,
} from "../../../../packages/platform-core/src/index.ts";
import { QaToolGateway } from "../../../../packages/runtime-composition/src/index.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const workspaceId = "550e8400-e29b-41d4-a716-446655440601";
const projectId = "550e8400-e29b-41d4-a716-446655440602";
const suiteBindingId = "550e8400-e29b-41d4-a716-446655440603";
const validBody = Object.freeze({
  workItemId: "550e8400-e29b-41d4-a716-446655440604",
  suiteBindingRef: Object.freeze({ id: suiteBindingId, version: 1 }),
  target: Object.freeze({
    type: "MERGE_REQUEST",
    mergeRequestRef: "5001:17",
    commitSha: "a".repeat(40),
  }),
  environmentRef: "environment:test:qa-1@17",
  parameters: Object.freeze({ shard: 1 }),
});

const connection: GitLabConnectionConfiguration = Object.freeze({
  schemaVersion: "gitlab-connection-configuration@1.0.0",
  identityReferences: Object.freeze({
    read: Object.freeze({
      identityKind: "NON_HUMAN_PROJECT",
      scope: "read_api",
      nonHumanIdentityEvidenceRef: "evidence:read",
      reference: "secretref://gitlab/read",
      referenceFingerprint: digest("1"),
      ownerRef: "team:qa",
      rotationPolicyRef: "policy:rotation",
      revocationRunbookRef: "runbook:revoke",
    }),
    trigger: Object.freeze({
      identityKind: "NON_HUMAN_PROJECT",
      scope: "pipeline_trigger",
      nonHumanIdentityEvidenceRef: "evidence:trigger",
      reference: "secretref://gitlab/trigger",
      referenceFingerprint: digest("2"),
      ownerRef: "team:qa",
      rotationPolicyRef: "policy:rotation",
      revocationRunbookRef: "runbook:revoke",
    }),
    webhook: Object.freeze({
      identityMaterialKind: "STANDARD_WEBHOOK_HMAC_KEY",
      keyVersionRef: "key:webhook:v1",
      reference: "secretref://gitlab/webhook",
      referenceFingerprint: digest("3"),
      ownerRef: "team:qa",
      rotationPolicyRef: "policy:rotation",
      revocationRunbookRef: "runbook:revoke",
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
  identitySeparationEvidenceHash: digest("4"),
});

describe("Feature 005 aggregate production and scope boundary", () => {
  it.each(["RBAC", "ENTITLEMENT", "CROSS_SCOPE"] as const)(
    "denies %s before durable or provider effects",
    async (denial) => {
      const effect = vi.fn(async () => ({ status: "READY" }));
      const operation = executeAfterQaAutomationGate({
        workspaceId,
        projectId,
        body: validBody,
        authorize: async () => {
          if (denial === "RBAC") throw new Error("QA_PERMISSION_DENIED");
          if (denial === "ENTITLEMENT") throw new Error("QA_ENTITLEMENT_DENIED");
          return Object.freeze({
            actor: Object.freeze({ kind: "HUMAN" }),
            workspaceId,
            projectId: "550e8400-e29b-41d4-a716-446655440699",
          });
        },
        validate: validateCreateAutomatedSessionBody,
        invoke: effect,
      });
      await expect(operation).rejects.toThrow();
      expect(effect).not.toHaveBeenCalled();
    },
  );

  it("denies agent/tool launch without an exact grant and dual authorization", async () => {
    const subject = Object.freeze({
      kind: "WORK_ITEM" as const,
      id: validBody.workItemId,
      version: 1,
      contentHash: digest("5"),
      aggregateSnapshotHash: digest("6"),
    });
    const run = AgentRunAggregate.start({
      id: "agent-run-005",
      workspaceId,
      projectId,
      requestKey: "agent-launch-denied",
      subject,
      humanPrincipalId: "human-005",
      servicePrincipalId: "hermes-005",
      grants: [],
      requestPayload: { action: "qa.automation.launch" },
    }).snapshot();
    const handler = vi.fn(async () => ({ status: "READY" }));
    const gateway = new QaToolGateway(
      { humanAllows: async () => true, serviceAllows: async () => true },
      new Map([["qa.automation.launch", handler]]),
    );
    await expect(gateway.invoke(run, "qa.automation.launch", {})).rejects.toThrow(
      "AGENT_TOOL_GRANT_DENIED",
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects provider-shaped and shell/secret injection while redacting every credential header", () => {
    for (const body of [
      Object.freeze({ ...validBody, token: "caller-secret" }),
      Object.freeze({ ...validBody, environmentRef: "test@17\nprivate-token: stolen" }),
      Object.freeze({
        ...validBody,
        parameters: Object.freeze({ shard: 1, command: "$(deploy production)" }),
      }),
      Object.freeze({
        ...validBody,
        parameters: Object.freeze({ shard: 1, credential: "secretref://foreign" }),
      }),
    ])
      expect(() => validateCreateAutomatedSessionBody(body)).toThrow();

    expect(
      redactGitLabHeaders({
        accept: "application/json",
        authorization: "Bearer top-secret",
        "private-token": "top-secret",
        cookie: "session=top-secret",
        "x-correlation-id": "safe-correlation",
      }),
    ).toEqual({
      accept: "application/json",
      authorization: "[REDACTED]",
      "private-token": "[REDACTED]",
      cookie: "[REDACTED]",
      "x-correlation-id": "safe-correlation",
    });
  });

  it("denies artifact access before scope lookup or storage streaming", async () => {
    const get = vi.fn();
    const stream = vi.fn();
    const service = new ArtifactService({ get, save: vi.fn() } as never, { stream } as never, {
      authorizeScope: async () => ({ allowed: false, reason: "NO_ENTITLEMENT" }),
      authorizeResource: vi.fn(),
    });
    await expect(
      service.streamArtifactContent(
        {
          actor: Object.freeze({
            kind: "HUMAN",
            principalId: "human-005",
            issuer: "local",
            subject: "artifact-reader",
          }),
          scope: Object.freeze({ kind: "PROJECT", workspaceId, projectId }),
          correlationId: "550e8400-e29b-41d4-a716-446655440605",
          causationId: "550e8400-e29b-41d4-a716-446655440606",
        } as never,
        "550e8400-e29b-41d4-a716-446655440607" as never,
      ),
    ).rejects.toThrow("ARTIFACT_ACCESS_DENIED");
    expect(get).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });

  it("denies production and deploy inputs with zero secret resolution and zero provider calls", async () => {
    const secretResolution = vi.fn();
    const providerCall = vi.fn();
    const auth = new GitLabAuth(connection, {
      async resolve() {
        secretResolution();
        throw new Error("SHOULD_NOT_RESOLVE");
      },
    });
    expect(
      () =>
        new GitLabRestClient({
          baseUrl: "https://gitlab.production.invalid",
          numericProjectId: 5001,
          environmentClass: "PRODUCTION" as never,
          allowedOrigins: ["https://gitlab.production.invalid"],
          auth,
          transport: providerCall,
        }),
    ).toThrow("GITLAB_PRODUCTION_FORBIDDEN");

    const invoke = vi.fn(async () => ({ status: "READY" }));
    await expect(
      executeAfterQaAutomationGate({
        workspaceId,
        projectId,
        body: Object.freeze({
          ...validBody,
          environmentRef: "environment:production:primary",
          parameters: Object.freeze({ action: "deploy" }),
        }),
        authorize: async () =>
          Object.freeze({ actor: Object.freeze({ kind: "HUMAN" }), workspaceId, projectId }),
        validate: validateCreateAutomatedSessionBody,
        invoke,
      }),
    ).rejects.toThrow("QA_AUTOMATED_SESSION_PRODUCTION_DEPLOY_OR_INPUT_FORBIDDEN");
    expect(secretResolution).not.toHaveBeenCalled();
    expect(providerCall).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
