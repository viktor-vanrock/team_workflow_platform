import "../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Module, UnauthorizedException } from "../../apps/api/node_modules/@nestjs/common/index.js";
import { NestFactory } from "../../apps/api/node_modules/@nestjs/core/index.js";
import type { NestExpressApplication } from "../../apps/api/node_modules/@nestjs/platform-express/index.js";
import {
  bindingRevision,
  configurationFacts,
} from "../../apps/api/src/extensions/onboarding/binding-facts.ts";
import {
  BINDING_HTTP_APPLICATION,
  DurableBindingHttpApplication,
} from "../../apps/api/src/extensions/onboarding/bindings.application.ts";
import {
  currentAuthority,
  digest,
  ref,
} from "../../apps/api/src/extensions/onboarding/durable-http.ts";
import { OnboardingController } from "../../apps/api/src/extensions/onboarding/onboarding.controller.ts";
import { ProjectDialogueController } from "../../apps/api/src/extensions/onboarding/project-dialogue.controller.ts";
import {
  DurableProjectOperationsApplication,
  PROJECT_OPERATIONS_HTTP_APPLICATION,
} from "../../apps/api/src/extensions/onboarding/project-operations.application.ts";
import { ProjectOperationsController } from "../../apps/api/src/extensions/onboarding/project-operations.controller.ts";
import {
  PublishedOnboardingController,
  PublishedProjectOperationsController,
} from "../../apps/api/src/extensions/onboarding/published.controllers.ts";
import {
  DurableRegistryHttpApplication,
  REGISTRY_HTTP_APPLICATION,
} from "../../apps/api/src/extensions/onboarding/registry.application.ts";
import {
  DurableResourcesHttpApplication,
  FileAccountInventory,
  RESOURCES_HTTP_APPLICATION,
} from "../../apps/api/src/extensions/onboarding/resources.application.ts";
import {
  DurableValidationHttpApplication,
  VALIDATION_HTTP_APPLICATION,
} from "../../apps/api/src/extensions/onboarding/validation.application.ts";
import {
  QA_DATA_SOURCE,
  QA_HTTP_IDENTITY,
  type QaHttpIdentity,
  QaSessionGuard,
} from "../../apps/api/src/extensions/qa-api-authorization.ts";
import { authorizeLocalQaApi } from "../../apps/api/src/local/local-qa-authorization.ts";
import {
  type BindingContent,
  type ConnectionContent,
  createValidationReport,
  type ExactRevisionRef,
  type ProfileContent,
  semanticContentHash,
} from "../../packages/platform-core/src/index.ts";
import {
  ProjectBindingRepository,
  TypeOrmIntegrationConfigurationRepository,
} from "../../packages/platform-persistence-typeorm/src/index.ts";
import {
  ProblemDetailsFilter,
  ProjectOnboardingApplication,
  WorkspaceContextStore,
} from "../../packages/platform-runtime-nest/src/index.ts";
import { acceptBindingFunctionally } from "../../packages/runtime-composition/src/onboarding/binding-acceptance-service.ts";
import { createSafeCapabilityProbe } from "../../packages/runtime-composition/src/onboarding/capability-probes.ts";
import { localPersonaIds } from "../../packages/runtime-composition/src/seed/local-seed.ts";
import { startProjectOperationsFixture } from "./007-project-operations-fixture.ts";

@Module({})
class BindingJourneyModule {}
export async function startBindingHttpFixture(
  image: string,
  stage: "SHADOW" | "PILOT_ACTIVE" = "SHADOW",
  options: { globalProblemFilter?: boolean } = {},
) {
  const f = await startProjectOperationsFixture(image, { stage });
  let app: NestExpressApplication | undefined,
    origin = "";
  const errors: string[] = [];
  const inventoryDir = await mkdtemp(join(tmpdir(), "qa-http-inventory-")),
    inventoryPath = join(inventoryDir, "accounts.json");
  await writeFile(
    inventoryPath,
    JSON.stringify([
      {
        id: "local-http-accounts",
        version: 1,
        ...f.scope,
        opaqueAccountRefs: ["accountref://controlled/account-1"],
      },
    ]),
  );
  const identity: QaHttpIdentity = {
    authenticate: async (context) => {
      const token = context.switchToHttp().getRequest<{ headers: { authorization?: string } }>()
        .headers.authorization;
      const persona =
        token === "Bearer requester" || token === "Bearer requester-no-mfa"
          ? "requester.alpha"
          : token === "Bearer other-requester"
            ? "viewer.beta"
            : token === "Bearer owner"
              ? "owner.local"
              : token === "Bearer lead"
                ? "lead.alpha"
                : token === "Bearer executor"
                  ? "executor.alpha"
                  : token === "Bearer admin" || token === "Bearer no-mfa"
                    ? "integration-admin.alpha"
                    : undefined;
      if (!persona) throw new UnauthorizedException();
      return async ({ scope, permission }) => ({
        ...(await authorizeLocalQaApi(
          f.source,
          { headers: {}, localPersonaKey: persona },
          scope.workspaceId,
          scope.projectId,
          permission,
        )),
        authentication: {
          contextRef: `verified:${persona}`,
          verifiedAt: new Date().toISOString(),
          ...(token !== "Bearer no-mfa" && token !== "Bearer requester-no-mfa"
            ? { stepUpAt: new Date().toISOString() }
            : {}),
        },
      });
    },
    interaction: async (context) => {
      const token = context.switchToHttp().getRequest<{ headers: { authorization?: string } }>()
        .headers.authorization;
      const persona =
        token === "Bearer requester" || token === "Bearer requester-no-mfa"
          ? "requester.alpha"
          : token === "Bearer other-requester"
            ? "viewer.beta"
            : token === "Bearer owner"
              ? "owner.local"
              : token === "Bearer lead"
                ? "lead.alpha"
                : token === "Bearer executor"
                  ? "executor.alpha"
                  : "integration-admin.alpha";
      return {
        principalId: localPersonaIds[persona],
        binding: digest({ token }),
        authentication: {
          contextRef: digest({ token }),
          verifiedAt: new Date().toISOString(),
          ...(token !== "Bearer no-mfa" && token !== "Bearer requester-no-mfa"
            ? { stepUpAt: new Date().toISOString() }
            : {}),
        },
      };
    },
  };
  const boot = async () => {
    const application = new DurableBindingHttpApplication(f.source);
    for (const name of ["prepare", "apply", "preparePilot", "activatePilot"] as const) {
      const method = application[name].bind(application);
      Object.defineProperty(application, name, {
        value: async (...args: unknown[]) => {
          try {
            return await (Reflect.apply(method, application, args) as Promise<unknown>);
          } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
            throw error;
          }
        },
      });
    }
    const validation = new DurableValidationHttpApplication(f.source);
    for (const name of ["validate", "accept", "evaluate"] as const) {
      const method = validation[name].bind(validation);
      Object.defineProperty(validation, name, {
        value: async (...args: unknown[]) => {
          try {
            return await (Reflect.apply(method, validation, args) as Promise<unknown>);
          } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
            throw error;
          }
        },
      });
    }
    app = await NestFactory.create<NestExpressApplication>(
      {
        module: BindingJourneyModule,
        controllers: [
          OnboardingController,
          ProjectDialogueController,
          ProjectOperationsController,
          PublishedOnboardingController,
          PublishedProjectOperationsController,
        ],
        providers: [
          QaSessionGuard,
          { provide: ProjectOnboardingApplication, useValue: {} },
          {
            provide: WorkspaceContextStore,
            useValue: {
              current: () => {
                throw new Error("LEGACY_CONTEXT_USED");
              },
            },
          },
          { provide: QA_DATA_SOURCE, useValue: f.source },
          { provide: QA_HTTP_IDENTITY, useValue: identity },
          { provide: VALIDATION_HTTP_APPLICATION, useValue: validation },
          {
            provide: RESOURCES_HTTP_APPLICATION,
            useValue: new DurableResourcesHttpApplication(
              f.source,
              new FileAccountInventory(inventoryPath),
            ),
          },
          {
            provide: REGISTRY_HTTP_APPLICATION,
            useValue: new DurableRegistryHttpApplication(f.source),
          },
          { provide: BINDING_HTTP_APPLICATION, useValue: application },
          {
            provide: PROJECT_OPERATIONS_HTTP_APPLICATION,
            useValue: new DurableProjectOperationsApplication(f.source),
          },
        ],
      },
      { logger: false, abortOnError: false },
    );
    if (options.globalProblemFilter) app.useGlobalFilters(new ProblemDetailsFilter());
    await app.listen(0, "127.0.0.1");
    origin = await app.getUrl();
  };
  const send = async (
    path: string,
    body: unknown,
    key: string,
    version: number,
    token = "admin",
    match = `"${version}"`,
  ) => {
    const response = await fetch(
      `${origin}/v1/workspaces/${f.scope.workspaceId}/projects/${f.scope.projectId}/${path}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "if-match": match,
          "idempotency-key": key,
        },
        body: JSON.stringify(body),
      },
    );
    return {
      status: response.status,
      body: (await response.json()) as { resultRef: ExactRevisionRef; [key: string]: unknown },
    };
  };
  // Validation/QA acceptance are independent source facts; T071 exposes their separate write workflow.
  const accept = async (target: ExactRevisionRef) => {
    await f.source.transaction(async (manager) =>
      configurationFacts(manager, f.scope, await bindingRevision(manager, f.scope, target)),
    );
    const validator = await f.source.transaction((manager) =>
      currentAuthority(
        manager,
        { kind: "PROJECT", ...f.scope },
        localPersonaIds["integration-admin.alpha"],
        "integration.validate",
        "integration-administrator",
      ),
    );
    const id = randomUUID(),
      now = new Date().toISOString();
    const report = createValidationReport({
      context: {
        scope: { kind: "PROJECT", ...f.scope },
        actor: validator.actor,
        authorizationBasis: validator.basis,
        correlationId: randomUUID(),
        causationId: randomUUID(),
      },
      subjectKind: "BINDING",
      subjectId: target.id,
      subjectVersion: target.version,
      contentHash: target.contentHash,
      issues: [],
      clock: { now: () => new Date(now) },
      ids: { next: () => id },
    });
    await new TypeOrmIntegrationConfigurationRepository(f.source).saveValidationReport(report);
    const reportHash = digest({ ...report, createdAt: report.createdAt.toISOString() });
    const authority = await f.source.transaction((manager) =>
      currentAuthority(
        manager,
        { kind: "PROJECT", ...f.scope },
        localPersonaIds["lead.alpha"],
        "integration.accept",
        "qa-lead",
      ),
    );
    const acceptance = acceptBindingFunctionally({
      ...f.scope,
      acceptanceId: randomUUID(),
      bindingRef: target,
      validationReportRef: ref(id, 1, reportHash),
      qaProjectContextRef: f.contextRef,
      acceptedResourceRefs: [],
      checklistRef: ref("local-checklist", 1, digest({ checked: true })),
      acceptedBy: authority.human,
      acceptedAt: now,
    });
    await new ProjectBindingRepository(f.source).appendFunctionalAcceptance(acceptance);
    return {
      validationRef: ref(id, 1, reportHash),
      acceptanceRef: ref(acceptance.acceptanceId, 1, acceptance.contentHash),
    };
  };
  const coreDraft = async (automation = false) => {
    const repository = new TypeOrmIntegrationConfigurationRepository(f.source);
    const authority = await f.source.transaction((manager) =>
      currentAuthority(
        manager,
        { kind: "PROJECT", ...f.scope },
        localPersonaIds["integration-admin.alpha"],
        "integration.validate",
        "integration-administrator",
      ),
    );
    const metadata = {
      workspaceId: f.scope.workspaceId,
      version: 1,
      resourceVersion: 1,
      state: "PUBLISHED" as const,
      createdAt: new Date(),
      createdBy: authority.actor.principalId,
      authorizationBasis: authority.basis,
    };
    const connectionId = randomUUID(),
      profileId = randomUUID(),
      bindingId = randomUUID();
    const connectorRef = { key: "connector-jira", version: "1.0.0" };
    const connection: ConnectionContent = {
      key: connectionId,
      connectorRef,
      environmentClass: "LOCAL",
      endpoint: "http://mock-hub:4000/jira",
      serviceIdentitySecretRef: "secretref://controlled/jira",
      quarantineClassificationKey: "INTERNAL",
      dataClassificationKey: "INTERNAL",
    };
    await repository.insertConnection({
      ...connection,
      ...metadata,
      id: connectionId,
      revisionId: randomUUID(),
      contentHash: semanticContentHash(connection as never),
    });
    await f.source.query("UPDATE connection_headers SET current_published_version=1 WHERE id=$1", [
      connectionId,
    ]);
    const externalScope = {
      schemaRef: {
        id: "urn:controlled:project-scope",
        version: 1,
        digest: digest({ type: "object" }),
      },
      value: { projectKey: "ALPHA" },
    };
    const profile: ProfileContent = {
      key: profileId,
      connectorRef,
      connectionRef: { id: connectionId, version: 1 },
      dataClassificationKey: "INTERNAL",
      capabilityConfigurations: [
        {
          capabilityKey: "operational-work-item",
          exactContractVersion: "1.0.0",
          environmentScopes: ["LOCAL"],
          allowedDataClassifications: ["INTERNAL"],
          externalScope,
          operations: ["request.create", "request.transition", "request.read", "defect.create"].map(
            (operation) => ({
              operation,
              effect: operation.endsWith(".read") ? "READ" : "WRITE",
              idempotencyStrategy: "NATURAL_KEY_LOOKUP",
              confirmationMode: "READ_BACK",
            }),
          ),
        },
      ],
    };
    await repository.insertProfile({
      ...profile,
      ...metadata,
      id: profileId,
      revisionId: randomUUID(),
      contentHash: semanticContentHash(profile as never),
    });
    await f.source.query(
      "UPDATE connector_profile_headers SET current_published_version=1 WHERE id=$1",
      [profileId],
    );
    const content: BindingContent = {
      key: bindingId,
      dataClassificationKey: "INTERNAL",
      entries: ["QA_REQUEST_AUTHORITY", "SOURCE_CONTEXT", "DEFECT_DESTINATION"].map(
        (logicalRole) => ({
          logicalRole,
          capabilityKey: "operational-work-item",
          exactContractVersion: "1.0.0",
          environmentScope: "LOCAL",
          classificationCeilingKey: "INTERNAL",
          profileRef: { id: profileId, version: 1 },
          externalScope,
        }),
      ),
      configurationRefs: [],
      resourceRefs: [],
    };
    if (automation) {
      const gitlabConnectionId = randomUUID(),
        gitlabProfileId = randomUUID(),
        gitlabConnector = { key: "connector-gitlab", version: "1.0.0" };
      const connection: ConnectionContent = {
        key: gitlabConnectionId,
        connectorRef: gitlabConnector,
        environmentClass: "LOCAL",
        endpoint: "http://mock-hub:4000/gitlab",
        serviceIdentitySecretRef: "secretref://controlled/gitlab",
        quarantineClassificationKey: "INTERNAL",
        dataClassificationKey: "INTERNAL",
      };
      await repository.insertConnection({
        ...connection,
        ...metadata,
        id: gitlabConnectionId,
        revisionId: randomUUID(),
        contentHash: semanticContentHash(connection as never),
      });
      await f.source.query(
        "UPDATE connection_headers SET current_published_version=1 WHERE id=$1",
        [gitlabConnectionId],
      );
      const requirements = [
        {
          logicalRole: "SOURCE_CONTEXT",
          capabilityKey: "source-context.read",
          operations: ["merge-request.read", "commit.read", "build.read"],
        },
        {
          logicalRole: "TEST_EXECUTION",
          capabilityKey: "test-executor.trigger-status",
          operations: ["pipeline.trigger", "pipeline.read", "pipeline.lookup"],
        },
        {
          logicalRole: "ARTIFACT_SOURCE",
          capabilityKey: "artifact.ci-read",
          operations: ["artifact.metadata", "artifact.stream"],
        },
      ];
      const profile: ProfileContent = {
        key: gitlabProfileId,
        connectorRef: gitlabConnector,
        connectionRef: { id: gitlabConnectionId, version: 1 },
        dataClassificationKey: "INTERNAL",
        capabilityConfigurations: requirements.map((r) => ({
          capabilityKey: r.capabilityKey,
          exactContractVersion: "1.0.0",
          environmentScopes: ["LOCAL"],
          allowedDataClassifications: ["INTERNAL"],
          externalScope,
          operations: r.operations.map((operation) => ({
            operation,
            effect: operation === "pipeline.trigger" ? "WRITE" : "READ",
            idempotencyStrategy: "NATURAL_KEY_LOOKUP",
            confirmationMode: "READ_BACK",
          })),
        })),
      };
      await repository.insertProfile({
        ...profile,
        ...metadata,
        id: gitlabProfileId,
        revisionId: randomUUID(),
        contentHash: semanticContentHash(profile as never),
      });
      await f.source.query(
        "UPDATE connector_profile_headers SET current_published_version=1 WHERE id=$1",
        [gitlabProfileId],
      );
      (content.entries as unknown[]).push(
        ...requirements.map((r) => ({
          logicalRole: r.logicalRole,
          capabilityKey: r.capabilityKey,
          exactContractVersion: "1.0.0",
          environmentScope: "LOCAL",
          classificationCeilingKey: "INTERNAL",
          profileRef: { id: gitlabProfileId, version: 1 },
          externalScope,
        })),
      );
    }
    const hash = semanticContentHash(content as never);
    await repository.insertBinding({
      ...content,
      ...metadata,
      projectId: f.scope.projectId,
      id: bindingId,
      revisionId: randomUUID(),
      state: "DRAFT",
      contentHash: hash,
    });
    return ref(bindingId, 1, hash);
  };
  const probe = async (target: ExactRevisionRef, validationReportRef: ExactRevisionRef) => {
    const refs: ExactRevisionRef[] = [];
    const binding = await f.source.transaction((manager) =>
      bindingRevision(manager, f.scope, target),
    );
    const configuration = await f.source.transaction((manager) =>
      configurationFacts(manager, f.scope, binding),
    );
    const entries = binding.content.entries as {
      logicalRole: string;
      profileRef: ExactRevisionRef;
    }[];
    for (const entry of entries) {
      const profileRef = configuration.find((r) => r.id === entry.profileRef.id)!;
      const [profile] = (await f.source.query(
        "SELECT content FROM connector_profile_revisions WHERE header_id=$1 AND version=$2",
        [profileRef.id, profileRef.version],
      )) as { content: { connectionRef: ExactRevisionRef } }[];
      const connectionRef = configuration.find((r) => r.id === profile!.content.connectionRef.id)!;
      const operations =
        entry.logicalRole === "QA_REQUEST_AUTHORITY"
          ? ["request.create", "request.transition"]
          : entry.logicalRole === "SOURCE_CONTEXT"
            ? ["request.read"]
            : ["defect.create"];
      for (const operation of operations) {
        const result = createSafeCapabilityProbe({
          ...f.scope,
          probeId: randomUUID(),
          bindingRef: target,
          profileRef,
          connectionRef,
          validationReportRef,
          logicalRole: entry.logicalRole,
          capabilityKey: "operational-work-item",
          exactContractVersion: "1.0.0",
          operation,
          environmentScope: "LOCAL",
          status: "AVAILABLE",
          safeIssueCodes: [],
          observedAt: new Date().toISOString(),
          validUntil: new Date(Date.now() + 300_000).toISOString(),
        });
        await new ProjectBindingRepository(f.source).appendCapabilityProbe(result);
        refs.push(ref(result.probeId, 1, result.contentHash));
      }
    }
    return refs;
  };
  const gates = async (outcome = "PASS") => {
    for (const kind of ["C1", "N2", "P3"]) {
      const now = new Date().toISOString(),
        until = new Date(Date.now() + 300_000).toISOString(),
        id = randomUUID();
      const body = {
        gateResultId: id,
        version: 1,
        ...f.scope,
        gateKind: kind,
        outcome,
        subjectRefs: [
          ref(f.initial.revisionId, f.initial.version, f.initial.contentHash),
          f.initial.projectRegistryRef,
          f.bindingRef,
          f.contextRef,
        ],
        evaluatedAt: now,
        validUntil: until,
      };
      const signed = { ...body, contentHash: digest(body) };
      await f.source.query(
        "INSERT INTO project_onboarding_gate_results(gate_result_id,workspace_id,project_id,gate_kind,check_key,check_version,subject_refs,outcome,safe_issue_codes,evidence_refs,evaluated_by,evaluated_at,valid_until,semantic_body,content_hash) VALUES($1,$2,$3,$4,'controlled-local-conformance','1',$5,$6,'[]','[]',$7,$8,$9,$10,$11)",
        [
          id,
          f.scope.workspaceId,
          f.scope.projectId,
          kind,
          JSON.stringify(body.subjectRefs),
          outcome,
          f.initial.actor,
          now,
          until,
          signed,
          signed.contentHash,
        ],
      );
    }
  };
  const request = async (
    path: string,
    method = "GET",
    body?: unknown,
    token = "owner",
    key = "onboarding-request",
    version?: number,
  ) => {
    const response = await fetch(`${origin}/v1/workspaces/${f.scope.workspaceId}/projects${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": key,
        ...(version ? { "if-match": `"${version}"` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      etag: method === "GET" ? response.headers.get("etag") : null,
      body: (await response.json()) as Record<string, unknown>,
    };
  };
  const apiRequest = async (
    path: string,
    method = "GET",
    body?: unknown,
    token = "owner",
    key = "published-http-request",
    match?: string,
    workspaceId: string = f.scope.workspaceId,
  ) => {
    const response = await fetch(`${origin}/api/v1/workspaces/${workspaceId}/projects${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": key,
        ...(match ? { "if-match": match } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: (await response.json()) as Record<string, unknown>,
    };
  };
  try {
    await boot();
    return {
      ...f,
      errors,
      send,
      request,
      apiRequest,
      dialogueRequest: async (path: string, body?: unknown, token = "requester") => {
        const response = await fetch(
          `${origin}/api/v1/workspaces/${f.scope.workspaceId}/project-dialogues${path}`,
          {
            method: body === undefined ? "GET" : "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          },
        );
        return {
          status: response.status,
          body: (await response.json()) as Record<string, unknown>,
        };
      },
      accept,
      gates,
      coreDraft,
      probe,
      restart: async () => {
        await app?.close();
        app = undefined;
        await f.source.destroy();
        await f.source.initialize();
        await boot();
      },
      close: async () => {
        await app?.close();
        await f.close();
        await rm(inventoryDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await app?.close();
    await f.close();
    await rm(inventoryDir, { recursive: true, force: true });
    throw error;
  }
}
