import "../../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { describe, expect, it, vi } from "vitest";
import { GUARDS_METADATA } from "../../../apps/api/node_modules/@nestjs/common/constants.js";

import {
  CorporateQaModule,
  type CorporateQaBindings,
} from "../../../apps/api/src/extensions/corporate-qa.module.ts";
import { createCorporateQaBindings } from "../../../apps/api/src/extensions/corporate-qa-composition.ts";
import {
  assertCorporateQaDeploymentPins,
  parseCorporateQaHostConfig,
} from "../../../apps/api/src/extensions/corporate-qa-config.ts";
import { pilotContentHash } from "../../../packages/platform-core/src/index.ts";
import { CorporateQaHttpIdentity } from "../../../apps/api/src/extensions/corporate-qa-http-identity.ts";
import { createCorporateQaIntakeConfiguration } from "../../../apps/api/src/extensions/corporate-qa-intake-configuration.ts";
import { createUnresolvedCorporateQaResponseChannels } from "../../../apps/api/src/extensions/corporate-qa-response-channels.ts";
import {
  QA_API_OPERATIONAL_DELIVERY_MODE,
  QaPackController,
} from "../../../apps/api/src/extensions/qa-pack.controller.ts";
import { QaSessionGuard } from "../../../apps/api/src/extensions/qa-api-authorization.ts";
import { QueueController } from "../../../apps/api/src/extensions/queue/queue.controller.ts";
import { bootstrapCorporateQaApi } from "../../../apps/api/src/corporate-main.ts";
import { startCorporateQaHost } from "../../../apps/api/src/corporate-host.ts";
import { QaAutomationAttemptsController } from "../../../apps/api/src/extensions/gitlab-automation/qa-automation-attempts.controller.ts";
import { TypeOrmQaAutomatedSessionsApi } from "../../../apps/api/src/extensions/gitlab-automation/qa-automation-local.adapters.ts";
import { CorporateAutomationReadController } from "../../../apps/api/src/extensions/gitlab-automation/corporate-automation-read.controller.ts";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000001";
const bindings = {
  intake: { load: vi.fn() },
  agentAuthority: { resolve: vi.fn() },
  commandAdmission: { context: vi.fn(), guard: { assertEffectsAllowed: vi.fn() } },
  session: {},
  readiness: {},
  defectPublication: {},
  defectApproval: {},
  dod: {},
  verdict: {},
  completion: {},
  completionApproval: {},
  stepUpPermissions: ["queue.control.approve"],
} as unknown as CorporateQaBindings;

describe("corporate QA module", () => {
  it("requires explicit trusted dependencies and an initialized database", () => {
    expect(() =>
      CorporateQaModule.register({ isInitialized: false } as never, {} as never, [], bindings),
    ).toThrow("CORPORATE_QA_BINDINGS_REQUIRED");
    expect(() =>
      CorporateQaModule.register(
        { isInitialized: true } as never,
        {} as never,
        [{ workspaceId, projectId }],
        {} as CorporateQaBindings,
      ),
    ).toThrow("CORPORATE_QA_BINDINGS_REQUIRED");
  });

  it("registers guarded QA and queue endpoints with worker-only delivery", () => {
    const module = CorporateQaModule.register(
      { isInitialized: true } as never,
      {} as never,
      [{ workspaceId, projectId }],
      bindings,
    );
    expect(module.controllers).toContain(QaPackController);
    expect(module.controllers).toContain(QueueController);
    expect(module.controllers).toContain(CorporateAutomationReadController);
    expect(Reflect.getMetadata(GUARDS_METADATA, CorporateAutomationReadController)).toContain(
      QaSessionGuard,
    );
    expect(module.controllers).not.toContain(QaAutomationAttemptsController);
    expect(module.providers).not.toContain(TypeOrmQaAutomatedSessionsApi);
    expect(Reflect.getMetadata(GUARDS_METADATA, QaPackController)).toContain(QaSessionGuard);
    expect(Reflect.getMetadata(GUARDS_METADATA, QueueController)).toContain(QaSessionGuard);
    expect(module.providers).toContainEqual({
      provide: QA_API_OPERATIONAL_DELIVERY_MODE,
      useValue: "DURABLE_WORKER",
    });
  });

  it("rejects QA scopes outside the deployment before consulting rights", async () => {
    const authorize = vi.fn();
    const identity = new CorporateQaHttpIdentity(
      { session: vi.fn().mockResolvedValue({}), authorize } as never,
      {} as never,
      [],
      [{ workspaceId, projectId }],
    );
    const check = await identity.authenticate({
      switchToHttp: () => ({ getRequest: () => ({ headers: {}, method: "GET" }) }),
      getHandler: () => () => undefined,
    } as never);
    await expect(
      check({
        scope: { kind: "PROJECT", workspaceId, projectId: "another" },
        permission: "work-item.read",
        operationClass: "READ",
      }),
    ).rejects.toThrow("QA_SCOPE_DENIED");
    expect(authorize).not.toHaveBeenCalled();
  });

  it("passes the request and required step-up to corporate session authorization", async () => {
    const request = { headers: { "x-csrf-token": "csrf" }, method: "POST" };
    const authorize = vi.fn().mockRejectedValue(new Error("STEP_UP_REQUIRED"));
    const identity = new CorporateQaHttpIdentity(
      { session: vi.fn().mockResolvedValue({}), authorize } as never,
      {} as never,
      ["qa.verdict.sign"],
      [{ workspaceId, projectId }],
    );
    const check = await identity.authenticate({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => () => undefined,
    } as never);
    await expect(
      check({
        scope: { kind: "PROJECT", workspaceId, projectId },
        permission: "qa.verdict.sign",
        operationClass: "MUTATE",
      }),
    ).rejects.toThrow("STEP_UP_REQUIRED");
    expect(authorize).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        permission: "qa.verdict.sign",
        operationClass: "MUTATE",
        requireStepUp: true,
      }),
      expect.any(Function),
    );
  });

  it("does not start the corporate entrypoint without session and QA bindings", async () => {
    await expect(bootstrapCorporateQaApi({} as never, { api: {} } as never)).rejects.toThrow(
      "CORPORATE_QA_BINDINGS_REQUIRED",
    );
    await expect(startCorporateQaHost()).rejects.toThrow();
  });

  it("rejects local profiles and projects outside the approved deployment", async () => {
    const channels = { resolve: vi.fn() };
    expect(() =>
      createCorporateQaIntakeConfiguration(
        {} as never,
        { profile: "local" } as never,
        channels,
        [],
      ),
    ).toThrow("CORPORATE_QA_CONFIGURATION_REQUIRED");
    const query = vi.fn();
    const config = createCorporateQaIntakeConfiguration(
      { query } as never,
      { profile: "non-local", deployment: { workspaceId, projectIds: [projectId] } } as never,
      channels,
      [],
    );
    await expect(config.load({ workspaceId, projectId: "another" })).rejects.toThrow(
      "QA_SCOPE_DENIED",
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("does not fall back to ALPHA when a corporate project has no published binding", async () => {
    const query = vi.fn().mockResolvedValue([]);
    const config = createCorporateQaIntakeConfiguration(
      { query } as never,
      { profile: "non-local", deployment: { workspaceId, projectIds: [projectId] } } as never,
      { resolve: vi.fn() },
      [],
    );
    await expect(config.load({ workspaceId, projectId })).rejects.toThrow(
      "QA_PROJECT_JIRA_BINDING_NOT_CONFIGURED",
    );
    expect(query).toHaveBeenCalledOnce();
  });

  it("does not compose QA runtimes without corporate policy and scoped ports", () => {
    expect(() =>
      createCorporateQaBindings(
        { isInitialized: true } as never,
        { profile: "local" } as never,
        {} as never,
      ),
    ).toThrow("CORPORATE_QA_COMPOSITION_REQUIRED");
    expect(() =>
      createCorporateQaBindings(
        { isInitialized: true } as never,
        { profile: "non-local", deployment: { workspaceId, projectIds: [projectId] } } as never,
        {
          responseChannels: { resolve: vi.fn() },
          agentAuthority: { resolve: vi.fn() },
          commandAdmission: { context: vi.fn(), guard: { assertEffectsAllowed: vi.fn() } } as never,
          sessionAdmission: { context: vi.fn(), guard: { assertEffectsAllowed: vi.fn() } } as never,
          defectPins: [],
          completionPins: [],
          stepUpPermissions: [],
          readinessPins: [],
          dodPins: [],
        },
      ),
    ).toThrow("CORPORATE_QA_PROJECT_PINS_INVALID");
  });

  it("records an unresolved response channel without claiming a verified destination", async () => {
    const requester = {
      kind: "HUMAN" as const,
      principalId: "person",
      issuer: "issuer",
      subject: "sub",
    };
    const result = await createUnresolvedCorporateQaResponseChannels().resolve({
      context: {} as never,
      requester,
      allowedKinds: ["PLATFORM_WEB"],
      evaluatedAt: "2026-01-01T00:00:00Z",
    });
    expect(result).toMatchObject({
      state: "MISSING",
      requesterPrincipal: requester,
      missingReasonCode: "REQUESTER_RESPONSE_CHANNEL_MISSING",
    });
    expect(result).not.toHaveProperty("responseChannelRef");
  });

  it("binds the non-secret QA host configuration to the exact deployment and project", () => {
    const deployment = { workspaceId, projectIds: [projectId] };
    const environment = { profile: "non-local", environmentScope: "NON_PROD", deployment } as never;
    const ref = { id: "configuration", version: 1, contentHash: `sha256:${"a".repeat(64)}` };
    const chain = { profileRef: ref, mappingRef: ref, connectionRef: ref };
    const scope = { workspaceId, projectId };
    const config = {
      schemaVersion: 1,
      deploymentPolicyHash: pilotContentHash(deployment),
      stepUpPermissions: [],
      readinessPins: [
        {
          ...scope,
          bindingRef: ref,
          profileRef: ref,
          connectionRef: ref,
          contextRef: ref,
          freshnessPolicyRef: ref,
          maximumProjectionAgeMs: 1000,
          authorityScopeKey: "qa.test",
        },
      ],
      dodPins: [{ ...scope, contextRef: ref, riskPolicyRef: ref }],
      defectPins: [
        {
          ...scope,
          bindingRef: ref,
          destination: chain,
          requestAuthority: chain,
          authorityScopeKey: "qa.test",
          externalProjectId: "100",
          externalIssueTypeId: "10001",
          maximumClassificationKey: "INTERNAL",
        },
      ],
      completionPins: [
        {
          ...scope,
          bindingRef: ref,
          profileRef: ref,
          mappingRef: ref,
          connectionRef: ref,
          authorityScopeKey: "qa.test",
          externalProjectId: "100",
          maximumClassificationKey: "INTERNAL",
          maximumProjectionAgeMs: 1000,
          allowedFromStates: ["READY"],
        },
      ],
    };
    expect(parseCorporateQaHostConfig(config, environment)).toEqual(config);
    const parsed = parseCorporateQaHostConfig(config, environment);
    const publication = [
      {
        kind: "CONNECTOR_BINDING",
        document: {
          provider: "jira",
          projects: [
            {
              projectId,
              integrationBindingRef: ref,
              profileRef: ref,
              connectionRef: ref,
            },
          ],
        },
      },
    ] as never;
    expect(() => assertCorporateQaDeploymentPins(parsed, publication)).not.toThrow();
    expect(() =>
      assertCorporateQaDeploymentPins(parsed, [
        {
          kind: "CONNECTOR_BINDING",
          document: {
            provider: "jira",
            projects: [
              {
                projectId,
                integrationBindingRef: { ...ref, version: 2 },
                profileRef: ref,
                connectionRef: ref,
              },
            ],
          },
        },
      ] as never),
    ).toThrow("CORPORATE_QA_DEPLOYMENT_PINS_INVALID");
    expect(() =>
      parseCorporateQaHostConfig(
        { ...config, deploymentPolicyHash: `sha256:${"b".repeat(64)}` },
        environment,
      ),
    ).toThrow("CORPORATE_QA_CONFIG_INVALID");
    expect(() =>
      parseCorporateQaHostConfig({ ...config, apiToken: "not-a-real-token" }, environment),
    ).toThrow("CORPORATE_QA_CONFIG_INVALID");
    expect(() =>
      parseCorporateQaHostConfig(
        {
          ...config,
          readinessPins: [
            { ...config.readinessPins[0], profileRef: { ...ref, token: "not-a-real-token" } },
          ],
        },
        environment,
      ),
    ).toThrow("CORPORATE_QA_CONFIG_SECRET_FORBIDDEN");
    expect(() =>
      parseCorporateQaHostConfig(
        {
          ...config,
          dodPins: [{ ...scope, projectId: "other", contextRef: ref, riskPolicyRef: ref }],
        },
        environment,
      ),
    ).toThrow("CORPORATE_QA_CONFIG_SCOPE_DENIED");
  });
});
