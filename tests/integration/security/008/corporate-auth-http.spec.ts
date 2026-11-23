import "../../../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";

import { describe, expect, it } from "vitest";

import {
  Controller,
  Get,
  Inject,
  Module,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from "../../../../apps/api/node_modules/@nestjs/common/index.js";
import { NestFactory } from "../../../../apps/api/node_modules/@nestjs/core/index.js";
import { createCoreIntakeHttpApis } from "../../../../apps/api/src/extensions/core-intake-http-api.ts";
import { CorporateQaHttpIdentity } from "../../../../apps/api/src/extensions/corporate-qa-http-identity.ts";
import {
  MATTERMOST_PROJECT_SELECTION,
  MattermostProjectSelectionController,
} from "../../../../apps/api/src/extensions/mattermost-project-selection.controller.ts";
import { createMattermostProjectSelectionApi } from "../../../../apps/api/src/extensions/mattermost-project-selection-api.ts";
import { createOperationalAuthorityHttpApi } from "../../../../apps/api/src/extensions/operational-authority-http-api.ts";
import {
  QA_DATA_SOURCE,
  QA_HTTP_IDENTITY,
  QaSessionGuard,
} from "../../../../apps/api/src/extensions/qa-api-authorization.ts";
import {
  createQaArtifactHttpApi,
  explicitArtifactScope,
} from "../../../../apps/api/src/extensions/qa-artifact-http-api.ts";
import {
  QA_ARTIFACT_HTTP_API,
  QaArtifactsController,
} from "../../../../apps/api/src/extensions/qa-artifacts.controller.ts";
import {
  QaHermesProposalResourcesController,
  QaHermesProposalsController,
} from "../../../../apps/api/src/extensions/qa-hermes-proposals.controller.ts";
import { QaRequiredSessionPlansController } from "../../../../apps/api/src/extensions/qa-required-session-plans.controller.ts";
import {
  PortfolioQueueController,
  QueueController,
} from "../../../../apps/api/src/extensions/queue/queue.controller.ts";
import { QUEUE_HTTP_AUTHORITY } from "../../../../apps/api/src/extensions/queue/queue-http-authority.ts";
import { QueuePoliciesController } from "../../../../apps/api/src/extensions/queue/queue-policies.controller.ts";
import {
  qaCompetencyManifestV13,
  qaValidationWorkTypeDefinitionV13,
} from "../../../../packages/competency-qa/src/node.ts";
import { sha256 } from "../../../../packages/platform-contracts/src/index.ts";
import { createExactApproval } from "../../../../packages/platform-core/src/approval/approval.ts";
import {
  ArtifactAuthorizationContributionRegistry,
  authorizedProjectSetHash,
} from "../../../../packages/platform-core/src/index.ts";
import { TypeOrmApprovalRepository } from "../../../../packages/platform-persistence-typeorm/src/approval.repository.ts";
import { TypeOrmArtifactRepository } from "../../../../packages/platform-persistence-typeorm/src/artifact.repository.ts";
import {
  createPlatformDataSource,
  TypeOrmScopedAccessRepository,
} from "../../../../packages/platform-persistence-typeorm/src/index.ts";
import { TypeOrmIntakeCandidateRepository } from "../../../../packages/platform-persistence-typeorm/src/intake-candidate.repository.ts";
import {
  CORPORATE_SESSION_SERVICE,
  CorporateAuthenticationModule,
} from "../../../../packages/platform-runtime-nest/src/auth/corporate-session.controller.ts";
import {
  type CorporateSessionRequest,
  CorporateSessionService,
} from "../../../../packages/platform-runtime-nest/src/auth/corporate-session.service.ts";
import {
  AGENT_RUNS_API,
  AgentRunsController,
} from "../../../../packages/platform-runtime-nest/src/http/agent-runs.controller.ts";
import {
  APPROVALS_V11_API,
  APPROVALS_V11_HTTP_ACCESS,
  ApprovalsV11Controller,
  ApprovalsV11HttpGuard,
} from "../../../../packages/platform-runtime-nest/src/http/approvals.controller.ts";
import {
  INTAKE_CANDIDATES_API,
  IntakeCandidatesController,
} from "../../../../packages/platform-runtime-nest/src/http/intake-candidates.controller.ts";
import {
  INTAKE_DRAFT_HTTP_ACCESS,
  INTAKE_DRAFT_REVISIONS_API,
  IntakeDraftHttpGuard,
  IntakeDraftRevisionsController,
} from "../../../../packages/platform-runtime-nest/src/http/intake-draft-revisions.controller.ts";
import {
  NOTIFICATION_INTENTS_API,
  NotificationIntentsController,
} from "../../../../packages/platform-runtime-nest/src/http/notification-intents.controller.ts";
import {
  OPERATIONAL_AUTHORITY_API,
  OPERATIONAL_AUTHORITY_HTTP_ACCESS,
  OperationalAuthorityController,
  OperationalAuthorityHttpGuard,
} from "../../../../packages/platform-runtime-nest/src/http/operational-authority.controller.ts";
import { startPostgres } from "../../../../packages/platform-testkit/src/postgres.ts";
import { PinnedNetworkTransport } from "../../../../packages/runtime-composition/src/pilot/network-policy.ts";
import { qaLocalMigrations } from "../../../../packages/runtime-composition/src/qa/composition.ts";
import { createRuntimeApprovalsV11Api } from "../../../../packages/runtime-composition/src/queue/approval-api.ts";
import { CorporateQueueHttpAuthority } from "../../../../packages/runtime-composition/src/security/corporate-queue-authority.ts";
import { createCorporateSessionBindings } from "../../../../packages/runtime-composition/src/security/corporate-session-bindings.ts";
import { startOidcFixture } from "../../../support/008-oidc-fixture.ts";
import { POSTGRES_TEST_IMAGES } from "../../../testcontainers.config.ts";

@Controller("proof/workspaces/:workspaceId/projects/:projectId")
class ScopedProofController {
  constructor(
    @Inject(CORPORATE_SESSION_SERVICE) private readonly sessions: CorporateSessionService,
  ) {}
  @Get()
  async read(
    @Req() request: CorporateSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
  ) {
    try {
      return await this.sessions.authorize(request, {
        scope: { kind: "PROJECT", workspaceId, projectId },
        permission: "pilot.read",
        operationClass: "READ",
      });
    } catch {
      throw new UnauthorizedException("PROJECT_RESOURCE_NOT_AVAILABLE");
    }
  }
  @Post()
  async mutate(
    @Req() request: CorporateSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
  ) {
    try {
      return await this.sessions.authorize(request, {
        scope: { kind: "PROJECT", workspaceId, projectId },
        permission: "pilot.read",
        operationClass: "MUTATE",
      });
    } catch {
      throw new UnauthorizedException("PROJECT_RESOURCE_NOT_AVAILABLE");
    }
  }
}
@Module({})
class HttpProofModule {}

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "008 corporate authentication HTTP + Core database",
  () => {
    it("binds real callback/session routes to encrypted durable state and current scoped authority", async () => {
      const postgres = await startPostgres(POSTGRES_TEST_IMAGES[0]);
      const idp = await startOidcFixture();
      const source = createPlatformDataSource({
        url: postgres.url,
        entities: [],
        migrations: [...qaLocalMigrations],
      });
      const reservation = createServer();
      await new Promise<void>((resolve) => {
        reservation.listen(0, "127.0.0.1", resolve);
      });
      const port = (reservation.address() as { port: number }).port;
      await new Promise<void>((resolve, reject) => {
        reservation.close((error) => (error ? reject(error) : resolve()));
      });
      const origin = `http://127.0.0.1:${port}`;
      const key = randomBytes(32);
      const workspace = randomUUID();
      const project = randomUUID();
      const deniedProject = randomUUID();
      const human = randomUUID();
      const ref = {
        id: "identity-policy",
        version: 1,
        contentHash: `sha256:${"a".repeat(64)}` as const,
      };
      let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
      try {
        await source.initialize();
        await source.runMigrations({ transaction: "all" });
        await source.query(
          "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,$2,'alice','HUMAN','Alice')",
          [human, idp.origin],
        );
        await source.query(
          "INSERT INTO workspaces(id,key,name,state) VALUES($1,'corporate-http','Corporate HTTP','ACTIVE')",
          [workspace],
        );
        await source.query(
          "INSERT INTO projects(id,workspace_id,key,name,state,classification_key) VALUES($1,$2,'p','P','ACTIVE','INTERNAL')",
          [project, workspace],
        );
        await source.query(
          "INSERT INTO workspace_memberships(id,workspace_id,principal_id,state,valid_from) VALUES($1,$2,$3,'ACTIVE',now()-interval '1 day')",
          [randomUUID(), workspace, human],
        );
        await source.query(
          'INSERT INTO role_assignments(id,workspace_id,project_id,principal_id,role_key,effect,permissions,valid_from) VALUES($1,$2,$3,$4,\'QA_LEAD\',\'ALLOW\',\'["pilot.read","work-item.read","qa.required-session-plan.publish","queue.project.read","queue.capacity.read","queue.portfolio.read","queue.policy.read","queue.calendar.read","approval.decide","qa.request.create","qa.request.input.revise","artifact.read"]\',now()-interval \'1 day\')',
          [randomUUID(), workspace, project, human],
        );
        await source.query(
          'INSERT INTO project_entitlements(id,workspace_id,project_id,principal_id,effect,classification_ceiling_key,permissions,valid_from) VALUES($1,$2,$3,$4,\'ALLOW\',\'INTERNAL\',\'["pilot.read","work-item.read","qa.required-session-plan.publish","queue.project.read","queue.capacity.read","queue.portfolio.read","queue.policy.read","queue.calendar.read","approval.decide","qa.request.create","qa.request.input.revise","artifact.read"]\',now()-interval \'1 day\')',
          [randomUUID(), workspace, project, human],
        );
        await source.query(
          "INSERT INTO role_assignments(id,workspace_id,principal_id,role_key,effect,permissions,valid_from) VALUES($1,$2,$3,'QA_LEAD','ALLOW',$4,now()-interval '1 day')",
          [
            randomUUID(),
            workspace,
            human,
            JSON.stringify([
              "queue.portfolio.read",
              "queue.capacity.read",
              "queue.policy.read",
              "queue.calendar.read",
            ]),
          ],
        );
        await source.query(
          "INSERT INTO projects(id,workspace_id,key,name,state,classification_key) VALUES($1,$2,'denied','Denied','ACTIVE','INTERNAL')",
          [deniedProject, workspace],
        );
        await source.query(
          "INSERT INTO project_entitlements(id,workspace_id,project_id,principal_id,effect,classification_ceiling_key,permissions,valid_from) VALUES($1,$2,$3,$4,'ALLOW','INTERNAL','[\"queue.project.read\",\"queue.capacity.read\"]',now()-interval '1 day')",
          [randomUUID(), workspace, deniedProject, human],
        );
        await source.query(
          "INSERT INTO role_assignments(id,workspace_id,project_id,principal_id,role_key,effect,permissions,valid_from) VALUES($1,$2,$3,$4,'QA_LEAD','ALLOW','[\"queue.project.read\",\"queue.capacity.read\"]',now()-interval '1 day')",
          [randomUUID(), workspace, deniedProject, human],
        );
        await source.query(
          "INSERT INTO role_assignments(id,workspace_id,project_id,principal_id,role_key,effect,permissions,valid_from) VALUES($1,$2,$3,$4,'QA_LEAD','DENY','[\"queue.project.read\"]',now()-interval '1 day')",
          [randomUUID(), workspace, deniedProject, human],
        );
        const packId = randomUUID();
        const definitionId = randomUUID();
        await source.query(
          "INSERT INTO competency_pack_registrations(id,pack_key,pack_version,manifest_schema_version,required_core_contract_range,manifest_payload,manifest_hash,registration_status,registered_at) VALUES($1,'competency-qa','1.3.0',1,'>=1.0.0 <2.0.0',$2,$3,'REGISTERED',now())",
          [
            packId,
            JSON.stringify(qaCompetencyManifestV13),
            sha256(qaCompetencyManifestV13 as never),
          ],
        );
        await source.query(
          "INSERT INTO work_type_definitions(id,pack_registration_id,work_type_key,definition_version,intake_schema,intake_schema_hash,required_capabilities,definition_payload,definition_hash,lifecycle_status,registered_at) VALUES($1,$2,'qa.validation','1.3.0',$3,$4,$5,$6,$7,'ACTIVE',now())",
          [
            definitionId,
            packId,
            JSON.stringify(qaValidationWorkTypeDefinitionV13.intakeSchemaRef),
            qaValidationWorkTypeDefinitionV13.intakeSchemaRef.digest,
            JSON.stringify(qaValidationWorkTypeDefinitionV13.capabilityRequirements),
            JSON.stringify(qaValidationWorkTypeDefinitionV13),
            sha256(qaValidationWorkTypeDefinitionV13 as never),
          ],
        );
        await source.query(
          "INSERT INTO workspace_work_types(id,workspace_id,work_type_key,active_definition_id,intake_state,changed_by,changed_at,reason) VALUES($1,$2,'qa.validation',$3,'ENABLED',$4,now(),'HTTP fixture explicit enablement')",
          [randomUUID(), workspace, definitionId, human],
        );
        const configuration: Parameters<typeof createCorporateSessionBindings>[0] = {
          source,
          accessProvisioning: false,
          tokens: {
            issuer: idp.origin,
            audience: "awp-api",
            jwksUri: `${idp.origin}/jwks`,
            algorithms: ["EdDSA"],
            mode: "LOCAL_FIXTURE",
            discriminator: { kind: "RFC9068" },
            allowedClientIds: ["awp-browser"],
            clockToleranceSeconds: 2,
            maximumTokenAgeSeconds: 300,
            maximumTokenLifetimeSeconds: 600,
            keyCacheMs: 60_000,
            deadlineMs: 1000,
            maximumResponseBytes: 16384,
            groupsClaim: "groups",
          },
          session: {
            policyRef: ref,
            namespace: "http-fixture",
            browserOrigin: origin,
            authorizationEndpoint: `${idp.origin}/authorize`,
            tokenEndpoint: `${idp.origin}/token`,
            callbackUrl: `${origin}/api/v1/auth/callback`,
            clientId: "awp-browser",
            scopes: ["openid"],
            returnPaths: ["/pilot/readiness"],
            loginLifetimeMs: 120_000,
            sessionLifetimeMs: 300_000,
            stepUp: { acrValues: ["urn:fixture:mfa"], amrValues: ["otp"], maximumAgeSeconds: 60 },
          },
          groups: {
            ref,
            issuer: idp.origin,
            mappings: [
              {
                group: "qa-team",
                workspaceId: workspace,
                projectIds: [project, deniedProject],
                roleKeys: ["QA_LEAD"],
              },
            ],
          },
          encryptionKeyId: "k1",
          encryptionKeys: { withKey: async (_id, use) => use(key) },
          network: new PinnedNetworkTransport({
            ref: { ...ref, id: "network-policy" },
            mode: "LOCAL_FIXTURE",
            validUntil: new Date(Date.now() + 120_000).toISOString(),
            deadlineMs: 1000,
            maximumRequestBytes: 16384,
            maximumResponseBytes: 16384,
            endpoints: [
              {
                origin: idp.origin,
                addressRanges: ["127.0.0.1/32"],
                routes: [
                  { path: "/jwks", match: "EXACT", methods: ["GET"], queryKeys: [] },
                  { path: "/token", match: "EXACT", methods: ["POST"], queryKeys: [] },
                ],
              },
            ],
          }),
          clientAuthentication: { authorizeTokenRequest: async () => ({ headers: {}, form: {} }) },
        };
        expect(() =>
          createCorporateSessionBindings({
            ...configuration,
            groups: { ...configuration.groups, ref: { ...ref, version: 2 } },
          }),
        ).toThrow("CORPORATE_IDENTITY_BINDING_INVALID");
        let bindings = createCorporateSessionBindings(configuration);
        let storageReads = 0;
        const artifactStorage = {
          stream: async () => {
            storageReads++;
            return {
              body: (async function* () {
                yield new TextEncoder().encode("abc");
              })(),
            };
          },
        };
        const artifactRepository = new TypeOrmArtifactRepository(source);
        const readableArtifactId = randomUUID();
        const restrictedArtifactId = randomUUID();
        const foreignArtifactId = randomUUID();
        for (const [artifactId, targetProject, classification] of [
          [readableArtifactId, project, { key: "INTERNAL", rank: 10 }],
          [restrictedArtifactId, project, { key: "RESTRICTED", rank: 20 }],
          [foreignArtifactId, deniedProject, { key: "INTERNAL", rank: 10 }],
        ] as const) {
          await artifactRepository.save(
            { kind: "PROJECT", workspaceId: workspace, projectId: targetProject },
            {
              id: artifactId,
              workspaceId: workspace,
              projectId: targetProject,
              owner: { entityType: "HTTP_FIXTURE", entityId: randomUUID() },
              artifactKind: "EVIDENCE",
              storage: {
                providerKind: "CONTROLLED_FIXTURE",
                opaqueLocator: "PRIVATE_STORAGE_LOCATOR",
                objectVersionOrEtag: "v1",
              },
              fileName: "evidence.txt",
              mediaType: "text/plain",
              sizeBytes: 3,
              checksum: {
                algorithm: "SHA256",
                value: `sha256:${createHash("sha256").update("abc").digest("hex")}`,
              },
              classification,
              availability: "AVAILABLE",
              createdBy: human,
              createdAt: new Date(),
            },
          );
        }
        const boot = async () => {
          const intake = createCoreIntakeHttpApis(source, {
            resolve: async () => {
              throw new Error("CORPORATE_AGENT_GRANTS_NOT_CONFIGURED");
            },
          });
          const result = await NestFactory.create(
            {
              module: HttpProofModule,
              imports: [CorporateAuthenticationModule.configured(bindings.sessions)],
              controllers: [
                QaArtifactsController,
                MattermostProjectSelectionController,
                OperationalAuthorityController,
                IntakeDraftRevisionsController,
                IntakeCandidatesController,
                AgentRunsController,
                NotificationIntentsController,
                ApprovalsV11Controller,
                ScopedProofController,
                QaRequiredSessionPlansController,
                QaHermesProposalsController,
                QaHermesProposalResourcesController,
                QueueController,
                PortfolioQueueController,
                QueuePoliciesController,
              ],
              providers: [
                {
                  provide: QA_ARTIFACT_HTTP_API,
                  useValue: createQaArtifactHttpApi({
                    source,
                    repository: artifactRepository,
                    storage: artifactStorage,
                    scope: explicitArtifactScope,
                    contributions: new ArtifactAuthorizationContributionRegistry(),
                  }),
                },
                OperationalAuthorityHttpGuard,
                { provide: OPERATIONAL_AUTHORITY_HTTP_ACCESS, useExisting: QaSessionGuard },
                {
                  provide: OPERATIONAL_AUTHORITY_API,
                  useValue: createOperationalAuthorityHttpApi(source, {
                    projection: async () => ({ state: "ABSENT" }),
                    conflicts: async () => [],
                    importDiagnostics: async () => [],
                    reconciliation: async () => {
                      throw new Error("UNCONFIGURED_RECONCILIATION");
                    },
                    prepareAction: async () => {
                      throw new Error("UNCONFIGURED_ACTIONS");
                    },
                    decideApproval: async () => {
                      throw new Error("UNCONFIGURED_APPROVALS");
                    },
                  }),
                },
                {
                  provide: MATTERMOST_PROJECT_SELECTION,
                  useValue: createMattermostProjectSelectionApi(source, async () => [
                    { workspaceId: workspace, projectId: project },
                    { workspaceId: workspace, projectId: deniedProject },
                  ]),
                },
                IntakeDraftHttpGuard,
                { provide: INTAKE_DRAFT_HTTP_ACCESS, useExisting: QaSessionGuard },
                { provide: INTAKE_DRAFT_REVISIONS_API, useValue: intake.drafts },
                { provide: INTAKE_CANDIDATES_API, useValue: intake.candidates },
                { provide: AGENT_RUNS_API, useValue: intake.agents },
                { provide: NOTIFICATION_INTENTS_API, useValue: intake.notifications },
                {
                  provide: QUEUE_HTTP_AUTHORITY,
                  useValue: new CorporateQueueHttpAuthority(
                    bindings.sessions,
                    [
                      { workspaceId: workspace, projectId: project },
                      { workspaceId: workspace, projectId: deniedProject },
                    ],
                    ["queue.control.approve", "approval.decide"],
                  ),
                },
                { provide: QA_DATA_SOURCE, useValue: source },
                {
                  provide: QA_HTTP_IDENTITY,
                  useValue: new CorporateQaHttpIdentity(
                    bindings.sessions,
                    new TypeOrmScopedAccessRepository(source),
                    [],
                  ),
                },
                QaSessionGuard,
                ApprovalsV11HttpGuard,
                { provide: APPROVALS_V11_HTTP_ACCESS, useExisting: QaSessionGuard },
                {
                  provide: APPROVALS_V11_API,
                  useFactory: (authority: CorporateQueueHttpAuthority) =>
                    createRuntimeApprovalsV11Api(source, authority),
                  inject: [QUEUE_HTTP_AUTHORITY],
                },
              ],
            },
            { logger: false, abortOnError: false },
          );
          await result.listen(port, "127.0.0.1");
          return result;
        };
        app = await boot();
        // Each test request owns its socket, including requests across the deliberate server restart.
        const api = (path: string, init: RequestInit = {}) => {
          const headers = new Headers(init.headers);
          headers.set("connection", "close");
          return fetch(`${origin}${path}`, { redirect: "manual", ...init, headers });
        };
        const login = async (previousCookie?: string, csrfToken?: string) => {
          const begin = await api("/api/v1/auth/login", {
            method: "POST",
            headers: {
              origin,
              "content-type": "application/json",
              ...(previousCookie ? { cookie: previousCookie, "x-csrf-token": csrfToken! } : {}),
            },
            body: JSON.stringify({
              returnPath: "/pilot/readiness",
              ...(previousCookie ? { stepUp: true } : {}),
            }),
          });
          expect(begin.status).toBe(200);
          expect(begin.headers.get("cache-control")).toBe("no-store");
          const flowCookie = begin.headers.getSetCookie()[0]!.split(";", 1)[0]!;
          const authorization = await fetch(
            ((await begin.json()) as { authorizationUrl: string }).authorizationUrl,
            { redirect: "manual" },
          );
          const callback = new URL(authorization.headers.get("location")!);
          expect(callback.origin).toBe(origin);
          const response = await api(`${callback.pathname}${callback.search}`, {
            headers: { cookie: flowCookie },
          });
          expect(response.status).toBe(303);
          expect(response.headers.get("location")).toBe("/pilot/readiness");
          expect(response.headers.get("referrer-policy")).toBe("no-referrer");
          const cookie = response.headers
            .getSetCookie()
            .find((value) => value.startsWith("awp-session="))!;
          expect(cookie).toContain("HttpOnly; SameSite=Lax");
          expect(
            (
              await api(`${callback.pathname}${callback.search}`, {
                headers: { cookie: flowCookie },
              })
            ).status,
          ).toBe(401);
          return cookie.split(";", 1)[0]!;
        };
        expect((await api("/api/v1/auth/session")).status).toBe(401);
        const forged = await api("/api/v1/auth/login", {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify({ returnPath: "/pilot/readiness", principalId: human }),
        });
        expect(forged.status).toBe(401);
        let cookie = await login();
        const scopedPath = `/proof/workspaces/${workspace}/projects/${project}`;
        let response = await api(scopedPath, { headers: { cookie } });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          actor: { principalId: human, issuer: idp.origin },
          scope: { workspaceId: workspace, projectId: project },
          authorizationBasis: { membershipRef: { version: 1 } },
        });
        expect(
          (
            await api(`/proof/workspaces/${randomUUID()}/projects/${project}`, {
              headers: { cookie },
            })
          ).status,
        ).toBe(401);
        expect(
          (
            await api(`/proof/workspaces/${workspace}/projects/${randomUUID()}`, {
              headers: { cookie },
            })
          ).status,
        ).toBe(401);
        response = await api("/api/v1/auth/session", { headers: { cookie } });
        let session = (await response.json()) as { csrfToken: string };
        expect(JSON.stringify(session)).not.toMatch(
          /access_token|id_token|refresh_token|eyJ[a-zA-Z0-9_-]{12,}\./u,
        );
        expect(
          (await api(scopedPath, { method: "POST", headers: { cookie, origin } })).status,
        ).toBe(401);
        expect(
          (
            await api(scopedPath, {
              method: "POST",
              headers: { cookie, origin, "x-csrf-token": session.csrfToken },
            })
          ).status,
        ).toBe(201);
        // Exercise product controllers through the same real cookie and current Core rights.
        const qaPath = `/api/v1/workspaces/${workspace}/projects/${project}`;
        const artifactPath = `${qaPath}/artifacts/${readableArtifactId}`;
        expect((await api(artifactPath)).status).toBe(401);
        response = await api(artifactPath, { headers: { cookie } });
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        const artifactMetadata = await response.json();
        expect(artifactMetadata).toMatchObject({
          id: readableArtifactId,
          classification: { key: "INTERNAL" },
        });
        expect(JSON.stringify(artifactMetadata)).not.toContain("PRIVATE_STORAGE_LOCATOR");
        expect(
          (await api(`/artifacts/${readableArtifactId}`, { headers: { cookie } })).status,
        ).toBe(404);
        expect(
          (
            await api(`/artifacts/${readableArtifactId}`, {
              headers: { cookie, "x-awp-workspace-id": workspace, "x-awp-project-id": project },
            })
          ).status,
        ).toBe(200);
        for (const inaccessiblePath of [
          `${qaPath}/artifacts/${restrictedArtifactId}`,
          `${qaPath}/artifacts/${foreignArtifactId}`,
          `${qaPath.replace(project, deniedProject)}/artifacts/${foreignArtifactId}`,
        ]) {
          expect((await api(inaccessiblePath, { headers: { cookie } })).status).toBe(404);
          expect((await api(`${inaccessiblePath}/content`, { headers: { cookie } })).status).toBe(
            404,
          );
        }
        expect(storageReads).toBe(0);
        response = await api(`${artifactPath}/content`, { headers: { cookie } });
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(await response.text()).toBe("abc");
        expect(storageReads).toBe(1);
        const interactionHeaders = {
          cookie,
          origin,
          "x-csrf-token": session.csrfToken,
          "content-type": "application/json",
        };
        const optionsPath = "/api/v1/intake/mattermost/project-option-sets";
        const selectionPath = "/api/v1/intake/mattermost/project-selections";
        expect(
          (await api(optionsPath, { method: "POST", headers: { cookie, origin } })).status,
        ).toBe(403);
        response = await api(optionsPath, { method: "POST", headers: interactionHeaders });
        expect(response.status).toBe(201);
        const projectOptions = (await response.json()) as {
          items: { intentId: string; intentToken: string; projectLabel: string }[];
        };
        expect(projectOptions.items).toHaveLength(1);
        expect(projectOptions.items[0]!.projectLabel).toBe("P");
        const selectionBody = JSON.stringify({
          intentId: projectOptions.items[0]!.intentId,
          intentToken: projectOptions.items[0]!.intentToken,
          requestKey: `http-selection-${randomUUID()}`,
        });
        const otherBrowserCookie = await login();
        const otherBrowserInfo = (await (
          await api("/api/v1/auth/session", { headers: { cookie: otherBrowserCookie } })
        ).json()) as { csrfToken: string };
        expect(
          (
            await api(selectionPath, {
              method: "POST",
              headers: {
                cookie: otherBrowserCookie,
                origin,
                "x-csrf-token": otherBrowserInfo.csrfToken,
                "content-type": "application/json",
              },
              body: selectionBody,
            })
          ).status,
        ).toBe(403);
        response = await api(selectionPath, {
          method: "POST",
          headers: interactionHeaders,
          body: selectionBody,
        });
        expect(response.status).toBe(201);
        const selected = (await response.json()) as {
          draft: { id: string; revision: number; contentHash: string };
          replayed: boolean;
        };
        expect(selected).toMatchObject({ draft: { revision: 1 }, replayed: false });
        response = await api(selectionPath, {
          method: "POST",
          headers: interactionHeaders,
          body: selectionBody,
        });
        expect(response.status).toBe(201);
        expect(await response.json()).toMatchObject({
          draft: { id: selected.draft.id },
          replayed: true,
        });
        response = await api(`${qaPath}/intake-drafts/${selected.draft.id}/revisions`, {
          method: "POST",
          headers: interactionHeaders,
          body: JSON.stringify({
            expectedRevision: 1,
            expectedContentHash: selected.draft.contentHash,
            content: { schemaVersion: 1, title: "Changed by canonical human" },
          }),
        });
        expect(response.status).toBe(201);
        expect(await response.json()).toMatchObject({ id: selected.draft.id, revision: 2 });
        const revisions = (await source.query(
          "SELECT work_type_definition_ref,created_by FROM intake_draft_revisions WHERE draft_id=$1 ORDER BY revision",
          [selected.draft.id],
        )) as { work_type_definition_ref: unknown; created_by: string }[];
        expect(revisions).toHaveLength(2);
        for (const revision of revisions)
          expect(revision).toMatchObject({
            created_by: human,
            work_type_definition_ref: {
              version: "1.3.0",
              hash: sha256(qaValidationWorkTypeDefinitionV13 as never),
            },
          });
        const operationalRoot = `${qaPath}/operational-authority`;
        expect((await api(`${operationalRoot}/imports`, { headers: { cookie } })).status).toBe(200);
        for (const tail of [
          "imports",
          `work-items/${randomUUID()}/projection`,
          `work-items/${randomUUID()}/conflicts`,
        ])
          expect(
            (
              await api(`${operationalRoot.replace(project, deniedProject)}/${tail}`, {
                headers: { cookie },
              })
            ).status,
          ).toBe(403);
        for (const tail of [
          "reconciliation/BOUND_REFRESH",
          `work-items/${randomUUID()}/actions/request.assign`,
        ])
          expect(
            (
              await api(`${operationalRoot}/${tail}`, {
                method: "POST",
                headers: { ...interactionHeaders, "if-match": "v1", "idempotency-key": "key" },
                body: "{}",
              })
            ).status,
          ).toBe(403);
        const candidateId = randomUUID();
        const candidateFingerprint = `sha256:${"b".repeat(64)}`;
        await new TypeOrmIntakeCandidateRepository(source).discoverOrObserve({
          id: candidateId,
          workspaceId: workspace,
          projectId: project,
          deduplicationKey: `corporate:${candidateId}`,
          sourceFingerprint: candidateFingerprint,
          sourceEntityVersion: "1",
          minimalSummary: { title: "Scoped candidate" },
          expiresAt: new Date(Date.now() + 120_000),
          actionProvenanceRef: `source:${candidateId}`,
          observedAt: new Date(),
        });
        const draftsPath = `/intake-drafts/${randomUUID()}`;
        const genericRoutes = [
          { path: `${draftsPath}/revisions`, method: "GET" },
          { path: `${draftsPath}/revisions`, method: "POST" },
          { path: `${draftsPath}/commands/validate`, method: "POST" },
          { path: "/intake-candidates", method: "GET" },
          { path: `/intake-candidates/${candidateId}`, method: "GET" },
          { path: `/intake-candidates/${candidateId}/decisions`, method: "POST" },
          { path: "/agent-runs", method: "POST" },
          { path: `/agent-runs/${randomUUID()}`, method: "GET" },
          { path: `/notification-intents/${randomUUID()}`, method: "GET" },
        ];
        for (const route of genericRoutes) {
          const write = route.method === "POST";
          expect((await api(`${qaPath}${route.path}`, { method: route.method })).status).toBe(401);
          expect(
            (
              await api(`${qaPath.replace(project, deniedProject)}${route.path}`, {
                method: route.method,
                headers: {
                  cookie,
                  origin,
                  "x-csrf-token": session.csrfToken,
                  "content-type": "application/json",
                },
                ...(write ? { body: "{}" } : {}),
              })
            ).status,
          ).toBe(403);
          if (write)
            expect(
              (
                await api(`${qaPath}${route.path}`, {
                  method: route.method,
                  headers: { cookie, origin, "content-type": "application/json" },
                  body: "{}",
                })
              ).status,
            ).toBe(403);
        }
        response = await api(`${qaPath}${draftsPath}/revisions`, { headers: { cookie } });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ items: [] });
        response = await api(`${qaPath}/intake-candidates`, { headers: { cookie } });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          items: [{ id: candidateId, state: "PENDING_CONFIRMATION" }],
        });
        response = await api(`${qaPath}/intake-candidates/${candidateId}`, { headers: { cookie } });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ id: candidateId });
        const candidateDecision = {
          decision: "IGNORE",
          expectedCandidateVersion: 1,
          expectedSourceObservationVersion: 1,
          requestKey: `ignore:${candidateId}`,
        };
        const candidateDecisionRequest = {
          method: "POST",
          headers: {
            cookie,
            origin,
            "x-csrf-token": session.csrfToken,
            "content-type": "application/json",
          },
          body: JSON.stringify(candidateDecision),
        };
        response = await api(
          `${qaPath}/intake-candidates/${candidateId}/decisions`,
          candidateDecisionRequest,
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          candidate: { id: candidateId, state: "IGNORED" },
          replayed: false,
        });
        response = await api(
          `${qaPath}/intake-candidates/${candidateId}/decisions`,
          candidateDecisionRequest,
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ replayed: true });
        const decisions = (await source.query(
          "SELECT actor_principal_id,authorization_basis_hash FROM intake_candidate_decisions WHERE candidate_id=$1",
          [candidateId],
        )) as { actor_principal_id: string; authorization_basis_hash: string }[];
        expect(decisions).toHaveLength(1);
        expect(decisions[0]).toMatchObject({ actor_principal_id: human });
        expect(decisions[0]!.authorization_basis_hash).toMatch(/^sha256:[a-f0-9]{64}$/u);
        const hermesPath = `${qaPath}/qa/hermes/triage/WORK_ITEM/${randomUUID()}`;
        expect((await api(hermesPath)).status).toBe(401);
        expect(
          (
            await api(hermesPath, {
              headers: {
                authorization: "Bearer executor.alpha",
                "x-local-persona-key": "executor.alpha",
              },
            })
          ).status,
        ).toBe(401);
        response = await api(hermesPath, { headers: { cookie } });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ items: [] });
        expect(
          (await api(`${qaPath}/qa/hermes/session-plans/${randomUUID()}`, { headers: { cookie } }))
            .status,
        ).toBe(200);
        expect(
          (await api(hermesPath.replace(project, randomUUID()), { headers: { cookie } })).status,
        ).toBe(403);
        expect(
          (
            await api(`${qaPath.replace(workspace, randomUUID())}/triage-assessments/missing`, {
              headers: { cookie },
            })
          ).status,
        ).toBe(403);
        expect(
          (
            await api(`${qaPath.replace(project, randomUUID())}/session-plan-proposals/missing`, {
              headers: { cookie },
            })
          ).status,
        ).toBe(403);
        response = await api(`${qaPath}/qa/queue`, { headers: { cookie } });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          scope: { kind: "PROJECT", authorizedProjectSetHash: authorizedProjectSetHash([project]) },
          items: [],
        });
        response = await api(`/api/v1/workspaces/${workspace}/qa/queue`, { headers: { cookie } });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          scope: {
            kind: "AUTHORIZED_PORTFOLIO",
            authorizedProjectSetHash: authorizedProjectSetHash([project]),
          },
          items: [],
        });
        expect(
          (await api(`${qaPath.replace(project, deniedProject)}/qa/queue`, { headers: { cookie } }))
            .status,
        ).toBe(404);
        expect(
          (await api(`/api/v1/workspaces/${workspace}/qa/queue/policy`, { headers: { cookie } }))
            .status,
        ).toBe(404);
        expect(
          (await api(`/api/v1/workspaces/${randomUUID()}/qa/queue/policy`, { headers: { cookie } }))
            .status,
        ).toBe(403);
        const planPath = `${qaPath}/work-items/${randomUUID()}/qa/required-session-plans`;
        expect((await api(`${planPath}/current`, { headers: { cookie } })).status).toBe(404);
        expect(
          (
            await api(planPath, {
              method: "POST",
              headers: { cookie, origin, "if-match": 'W/"1"', "content-type": "application/json" },
              body: JSON.stringify({ reason: "test", requirements: [] }),
            })
          ).status,
        ).toBe(403);
        expect(
          (
            await api(planPath, {
              method: "POST",
              headers: {
                cookie,
                origin,
                "x-csrf-token": session.csrfToken,
                "if-match": 'W/"1"',
                "content-type": "application/json",
              },
              body: JSON.stringify({ reason: "test", requirements: [] }),
            })
          ).status,
        ).toBe(404);
        await source.query("UPDATE projects SET state='SUSPENDED' WHERE id=$1", [project]);
        expect((await api(hermesPath, { headers: { cookie } })).status).toBe(200);
        expect(
          (
            await api(planPath, {
              method: "POST",
              headers: { cookie, origin, "x-csrf-token": session.csrfToken },
            })
          ).status,
        ).toBe(403);
        await source.query("UPDATE projects SET state='ACTIVE' WHERE id=$1", [project]);
        await source.query(
          "UPDATE project_entitlements SET valid_until=now()-interval '1 second',row_version=row_version+1 WHERE principal_id=$1",
          [human],
        );
        expect((await api(hermesPath, { headers: { cookie } })).status).toBe(403);
        expect(
          (
            await api(selectionPath, {
              method: "POST",
              headers: interactionHeaders,
              body: selectionBody,
            })
          ).status,
        ).toBe(403);
        await source.query(
          "UPDATE project_entitlements SET valid_until=NULL,row_version=row_version+1 WHERE principal_id=$1",
          [human],
        );
        const initiator = randomUUID();
        const approvalId = randomUUID();
        await source.query(
          "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,$2,'requester','HUMAN','Requester')",
          [initiator, idp.origin],
        );
        const approvalInput = {
          id: approvalId,
          workspaceId: workspace,
          projectId: project,
          initiatorId: initiator,
          initiator: {
            kind: "HUMAN" as const,
            principalId: initiator,
            issuer: idp.origin,
            subject: "requester",
          },
          action: {
            actionKind: "PLATFORM_ACTION" as const,
            actionId: randomUUID(),
            commandType: "controlled.test",
          },
          target: { id: "target" },
          targetHash: ref.contentHash,
          payloadHash: ref.contentHash,
          expectedState: { version: 1 },
          bindingRef: ref,
          profileRefs: [ref],
          requiredPermission: "approval.decide",
          separationOfDutyPolicy: "SELF_APPROVAL_FORBIDDEN" as const,
          effectIdempotencyKey: `approval:${approvalId}`,
          expiresAt: new Date(Date.now() + 120_000),
          createdAt: new Date(),
        };
        await new TypeOrmApprovalRepository(source).insert(createExactApproval(approvalInput));
        const approvalPath = `${qaPath}/approvals/${approvalId}`;
        expect((await api(approvalPath, { headers: { cookie } })).status).toBe(200);
        const decision = () =>
          api(`${approvalPath}/decisions`, {
            method: "POST",
            headers: {
              cookie,
              origin,
              "x-csrf-token": session.csrfToken,
              "content-type": "application/json",
            },
            body: JSON.stringify({ decision: "APPROVE" }),
          });
        expect((await decision()).status).toBe(404); // Step-up is required by the bound policy.
        expect(
          await source.query("SELECT decision_state FROM approvals WHERE id=$1", [approvalId]),
        ).toEqual([{ decision_state: "PENDING" }]);
        cookie = await login(cookie, session.csrfToken);
        session = (await (await api("/api/v1/auth/session", { headers: { cookie } })).json()) as {
          csrfToken: string;
        };
        response = await decision();
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          decisionStatus: "APPROVED",
          decision: { approverId: human, approverRole: "QA_LEAD" },
        });
        expect(
          (
            await api(`${approvalPath}/decisions`, {
              method: "POST",
              headers: {
                cookie,
                origin,
                "x-csrf-token": session.csrfToken,
                "content-type": "application/json",
              },
              body: JSON.stringify({ decision: "REJECT" }),
            })
          ).status,
        ).toBe(404);
        expect(
          await source.query("SELECT decision_state FROM approvals WHERE id=$1", [approvalId]),
        ).toEqual([{ decision_state: "APPROVED" }]);
        const expiredId = randomUUID();
        await new TypeOrmApprovalRepository(source).insert(
          createExactApproval({
            ...approvalInput,
            id: expiredId,
            action: { ...approvalInput.action, actionId: randomUUID() },
            effectIdempotencyKey: `approval:${expiredId}`,
            createdAt: new Date(Date.now() - 120_000),
            expiresAt: new Date(Date.now() - 60_000),
          }),
        );
        expect(
          (
            await api(`${qaPath}/approvals/${expiredId}/decisions`, {
              method: "POST",
              headers: {
                cookie,
                origin,
                "x-csrf-token": session.csrfToken,
                "content-type": "application/json",
              },
              body: JSON.stringify({ decision: "APPROVE" }),
            })
          ).status,
        ).toBe(404);
        expect(
          await source.query("SELECT decision_state FROM approvals WHERE id=$1", [expiredId]),
        ).toEqual([{ decision_state: "PENDING" }]);
        await app.close();
        bindings = createCorporateSessionBindings(configuration);
        app = await boot();
        expect((await api(hermesPath, { headers: { cookie } })).status).toBe(200);
        idp.state.outage = true;
        expect((await api(scopedPath, { headers: { cookie } })).status).toBe(200);
        await source.query(
          "UPDATE workspace_memberships SET state='REVOKED',row_version=row_version+1 WHERE principal_id=$1",
          [human],
        );
        expect((await api(scopedPath, { headers: { cookie } })).status).toBe(401);
        expect((await api(hermesPath, { headers: { cookie } })).status).toBe(403);
        expect((await api(`${artifactPath}/content`, { headers: { cookie } })).status).toBe(404);
        expect(storageReads).toBe(1);
        await source.query(
          "UPDATE workspace_memberships SET state='ACTIVE',row_version=row_version+1 WHERE principal_id=$1",
          [human],
        );
        expect(
          (
            await api("/api/v1/auth/logout", {
              method: "POST",
              headers: { cookie, origin, "x-csrf-token": session.csrfToken },
            })
          ).status,
        ).toBe(204);
        expect((await api(scopedPath, { headers: { cookie } })).status).toBe(401);
        idp.state.outage = false;
        const next = await login();
        await bindings.revocations.revokeThrough(
          idp.origin,
          "alice",
          Math.floor(Date.now() / 1000),
        );
        expect((await api("/api/v1/auth/session", { headers: { cookie: next } })).status).toBe(401);
        expect(
          JSON.stringify(await source.query("SELECT * FROM corporate_session_states")),
        ).not.toMatch(/alice|qa-team|access_token|code_verifier/u);
      } finally {
        await app?.close();
        if (source.isInitialized) await source.destroy();
        await idp.stop();
        await postgres.stop();
        key.fill(0);
      }
    }, 180_000);
  },
);
