import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { type DynamicModule, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import type { DataSource } from "typeorm";

import { ArtifactAuthorizationContributionRegistry } from "@awp/platform-core";
import {
  TypeOrmArtifactRepository,
  TypeOrmExternalInteractionReceiptRepository,
} from "@awp/platform-persistence-typeorm";
import {
  AGENT_RUNS_API,
  AgentRunsController,
  APPROVALS_V11_API,
  APPROVALS_V11_HTTP_ACCESS,
  ApprovalsV11Controller,
  ApprovalsV11HttpGuard,
  CONNECTOR_WEBHOOK_INGRESS,
  ConnectorWebhooksController,
  INTAKE_CANDIDATES_API,
  INTAKE_DRAFT_HTTP_ACCESS,
  INTAKE_DRAFT_REVISIONS_API,
  IntakeCandidatesController,
  IntakeDraftHttpGuard,
  IntakeDraftRevisionsController,
  NOTIFICATION_INTENTS_API,
  NotificationIntentsController,
  OPERATIONAL_AUTHORITY_API,
  OPERATIONAL_AUTHORITY_HTTP_ACCESS,
  type OperationalAuthorityApiPort,
  OperationalAuthorityController,
  OperationalAuthorityHttpGuard,
  WorkspaceContextStore,
} from "@awp/platform-runtime-nest";
import {
  createLocalGitLabArtifactStorageAuthority,
  createMattermostAdministrationService,
  createQaLocalOperationalBrokerMap,
  createQueueFoundationRepositoryProviders,
  createRuntimeDataSource,
  type DurablePilotEvidenceImport,
  DurableQaCompletionApprovalRuntime,
  type DurableQaCompletionRuntime,
  isQaJiraLocalComposition,
  jiraAuthoritativeReadInvalidation,
  loadEnvironment,
  localPersonaIds,
  localSeedIds,
  MattermostIngressService,
  onboardingLocalComposition,
  type PilotReadinessQuery,
  qaLocalSeedIds,
  type QaUs1OperationalBrokerMap,
  qaUs1OperationalRoute,
  type QueueHttpAuthority,
  selectRuntimeComposition,
  TypeOrmGitLabArtifactStorage,
  TypeOrmGitLabAutomationAttemptQuery,
  TypeOrmGitLabWebhookAuthorityLoader,
  TypeOrmGitLabWebhookIngressService,
} from "@awp/runtime-composition";

import { CorporateAccessModule } from "./access/access.module.ts";
import { LocalAccessController } from "./access/local-access.controller.ts";
import {
  type CoreIntakeHttpApis,
  createCoreIntakeHttpApis,
} from "./extensions/core-intake-http-api.ts";
import {
  GITLAB_WEBHOOK_INGRESS_API,
  GitLabWebhookController,
} from "./extensions/gitlab-automation/gitlab-webhook.controller.ts";
import {
  QA_AUTOMATED_SESSIONS_API,
  QaAutomatedSessionsController,
} from "./extensions/gitlab-automation/qa-automated-sessions.controller.ts";
import {
  QA_AUTOMATION_ATTEMPTS_API,
  QaAutomationAttemptsController,
} from "./extensions/gitlab-automation/qa-automation-attempts.controller.ts";
import {
  QA_AUTOMATION_AVAILABILITY_API,
  QaAutomationAvailabilityController,
} from "./extensions/gitlab-automation/qa-automation-availability.controller.ts";
import {
  TypeOrmQaAutomatedSessionsApi,
  TypeOrmQaAutomationAvailabilityApi,
  TypeOrmQaAutomationSuiteApi,
} from "./extensions/gitlab-automation/qa-automation-local.adapters.ts";
import {
  QA_AUTOMATION_QUARANTINES_API,
  QaAutomationQuarantinesController,
  TypeOrmQaAutomationQuarantineApi,
} from "./extensions/gitlab-automation/qa-automation-quarantines.controller.ts";
import {
  QA_AUTOMATION_SUITE_API,
  QaAutomationSuiteBindingsController,
} from "./extensions/gitlab-automation/qa-automation-suite-bindings.controller.ts";
import { HermesMattermostController } from "./extensions/hermes/mattermost.controller.ts";
import { MattermostBootstrapController } from "./extensions/mattermost-bootstrap.controller.ts";
import {
  MATTERMOST_INGRESS,
  MattermostIngressController,
} from "./extensions/mattermost-ingress.controller.ts";
import {
  MATTERMOST_ADMINISTRATION,
  type MattermostAdministrationPort,
  MattermostIntegrationController,
} from "./extensions/mattermost-integration.controller.ts";
import {
  MATTERMOST_PROJECT_SELECTION,
  MattermostProjectSelectionController,
  type MattermostProjectSelectionPort,
} from "./extensions/mattermost-project-selection.controller.ts";
import { createMattermostProjectSelectionApi } from "./extensions/mattermost-project-selection-api.ts";
import {
  BINDING_HTTP_APPLICATION,
  DurableBindingHttpApplication,
} from "./extensions/onboarding/bindings.application.ts";
import {
  type CorporateOnboardingBindings,
  CorporateOnboardingModule,
} from "./extensions/onboarding/corporate-onboarding.module.ts";
import { EVIDENCE_HTTP_APPLICATION } from "./extensions/onboarding/evidence.application.ts";
import { EvidenceIntegrityController } from "./extensions/onboarding/evidence.controller.ts";
import { OnboardingController } from "./extensions/onboarding/onboarding.controller.ts";
import { ProjectDialogueController } from "./extensions/onboarding/project-dialogue.controller.ts";
import {
  DurableProjectOperationsApplication,
  PROJECT_OPERATIONS_HTTP_APPLICATION,
} from "./extensions/onboarding/project-operations.application.ts";
import { ProjectOperationsController } from "./extensions/onboarding/project-operations.controller.ts";
import { ProjectReadsController } from "./extensions/onboarding/project-reads.controller.ts";
import {
  PublishedOnboardingController,
  PublishedProjectOperationsController,
} from "./extensions/onboarding/published.controllers.ts";
import {
  DurableRegistryHttpApplication,
  REGISTRY_HTTP_APPLICATION,
} from "./extensions/onboarding/registry.application.ts";
import {
  DurableResourcesHttpApplication,
  FileAccountInventory,
  RESOURCES_HTTP_APPLICATION,
} from "./extensions/onboarding/resources.application.ts";
import {
  DurableValidationHttpApplication,
  VALIDATION_HTTP_APPLICATION,
} from "./extensions/onboarding/validation.application.ts";
import { createOperationalAuthorityHttpApi } from "./extensions/operational-authority-http-api.ts";
import {
  PILOT_EVIDENCE_IMPORT,
  PILOT_READINESS_QUERY,
  PILOT_RUN_SERVICE,
  PilotController,
  type PilotRunApiService,
} from "./extensions/pilot/pilot.controller.ts";
import {
  QA_DATA_SOURCE,
  QA_HTTP_IDENTITY,
  type QaHttpIdentity,
  QaSessionGuard,
} from "./extensions/qa-api-authorization.ts";
import { createQaArtifactHttpApi } from "./extensions/qa-artifact-http-api.ts";
import {
  QA_ARTIFACT_HTTP_API,
  QaArtifactsController,
} from "./extensions/qa-artifacts.controller.ts";
import {
  QA_DEFECT_APPROVAL_RUNTIME,
  QA_DEFECT_PUBLICATION_RUNTIME,
  QaDefectsController,
} from "./extensions/qa-defects.controller.ts";
import { QaEvidenceController } from "./extensions/qa-evidence.controller.ts";
import { QaFindingsController } from "./extensions/qa-findings.controller.ts";
import {
  QaHermesProposalResourcesController,
  QaHermesProposalsController,
} from "./extensions/qa-hermes-proposals.controller.ts";
import { QA_INTAKE_CONFIGURATION } from "./extensions/qa-intake-configuration.ts";
import { QaManualExecutionController } from "./extensions/qa-manual-execution.controller.ts";
import {
  QA_API_OPERATIONAL_BROKER_MAP,
  QA_API_OPERATIONAL_DELIVERY_MODE,
  QaPackController,
} from "./extensions/qa-pack.controller.ts";
import {
  QA_READINESS_RUNTIME,
  QaReadinessController,
} from "./extensions/qa-readiness.controller.ts";
import { QaRequiredSessionPlansController } from "./extensions/qa-required-session-plans.controller.ts";
import { QaSessionReviewController } from "./extensions/qa-session-review.controller.ts";
import { QA_SESSION_RUNTIME, QaSessionsController } from "./extensions/qa-sessions.controller.ts";
import {
  QA_COMPLETION_APPROVAL_RUNTIME,
  QA_COMPLETION_RUNTIME,
  QA_DOD_RUNTIME,
  QA_VERDICT_RUNTIME,
  QaVerdictCompletionController,
} from "./extensions/qa-verdict-completion.controller.ts";
import { createApprovalsV11Api } from "./extensions/queue/approval-v11.api.ts";
import { PortfolioQueueController, QueueController } from "./extensions/queue/queue.controller.ts";
import { QueueFoundationApiModule } from "./extensions/queue/queue.module.ts";
import { QueueControlsController } from "./extensions/queue/queue-controls.controller.ts";
import { QUEUE_HTTP_AUTHORITY } from "./extensions/queue/queue-http-authority.ts";
import { QueuePoliciesController } from "./extensions/queue/queue-policies.controller.ts";
import { HealthController } from "./health.controller.ts";
import { createLocalAgentGrantAuthority } from "./local/local-agent-grant-authority.ts";
import { createLocalArtifactScope } from "./local/local-artifact-scope.ts";
import { createLocalEvidenceIntegrity } from "./local/local-evidence-integrity.ts";
import { LocalHealthController } from "./local/local-health.controller.ts";
import { LocalOpenApiController } from "./local/local-openapi.controller.ts";
import { createLocalOperationalAuthorityHandlers } from "./local/local-operational-authority.ts";
import {
  HttpsFakeIdpTokenClient,
  LOCAL_PERSONA_DATA_SOURCE,
  LocalPersonaController,
  LocalPersonaSessionService,
} from "./local/local-persona.controller.ts";
import { createLocalQaCompletionRuntime } from "./local/local-qa-completion-runtime.ts";
import { createLocalQaDefectApproval } from "./local/local-qa-defect-approval.ts";
import { createLocalQaDefectPublication } from "./local/local-qa-defect-publication.ts";
import {
  createLocalQaDodRuntime,
  createLocalQaVerdictRuntime,
} from "./local/local-qa-dod-runtime.ts";
import { LocalQaHttpIdentity } from "./local/local-qa-http-identity.ts";
import { createLocalQaIntakeConfiguration } from "./local/local-qa-intake-configuration.ts";
import { createLocalQaReadinessRuntime } from "./local/local-qa-readiness-runtime.ts";
import { createLocalQaSessionRuntime } from "./local/local-qa-session-runtime.ts";
import { createLocalQueueHttpAuthority } from "./local/local-queue-http-authority.ts";
import { LocalSessionGuard } from "./local/local-session.guard.ts";
import { LocalWalkingSkeletonController } from "./local/local-walking-skeleton.controller.ts";
import { TechWritingController } from "./local/tech-writing.controller.ts";
import { TechWritingService } from "./local/tech-writing.service.ts";
import { WorkspaceSubjectsController } from "./local/workspace-subjects.controller.ts";

export const onboardingApiComposition = onboardingLocalComposition;
const CORE_INTAKE_HTTP_APIS = Symbol("CORE_INTAKE_HTTP_APIS");
const QUEUE_FOUNDATION_REPOSITORIES = Symbol("QUEUE_FOUNDATION_REPOSITORIES");

const durableWorkerOnlyBroker: QaUs1OperationalBrokerMap = Object.freeze({
  [qaUs1OperationalRoute]: Object.freeze({
    invoke: async () => {
      throw new Error("QA_JIRA_EFFECT_MUST_RUN_IN_WORKER");
    },
    readByEffect: async () => {
      throw new Error("QA_JIRA_READBACK_MUST_RUN_IN_WORKER");
    },
  }),
});

class LocalApiShutdown implements OnApplicationShutdown {
  constructor(@Inject(LOCAL_PERSONA_DATA_SOURCE) private readonly source: DataSource) {}
  async onApplicationShutdown(): Promise<void> {
    if (this.source.isInitialized) await this.source.destroy();
  }
}

@Module({
  controllers: [
    LocalHealthController,
    LocalOpenApiController,
    LocalPersonaController,
    LocalAccessController,
    WorkspaceSubjectsController,
    TechWritingController,
    LocalWalkingSkeletonController,
  ],
  providers: [
    {
      provide: LOCAL_PERSONA_DATA_SOURCE,
      useFactory: async () => {
        const environment = loadEnvironment();
        const source = createRuntimeDataSource(environment);
        await source.initialize();
        return source;
      },
    },
    {
      provide: HttpsFakeIdpTokenClient,
      useFactory: () => new HttpsFakeIdpTokenClient(loadEnvironment().identityIssuer),
    },
    LocalPersonaSessionService,
    TechWritingService,
    LocalSessionGuard,
    LocalQaHttpIdentity,
    {
      provide: QUEUE_HTTP_AUTHORITY,
      useFactory: createLocalQueueHttpAuthority,
      inject: [LOCAL_PERSONA_DATA_SOURCE],
    },
    { provide: QA_HTTP_IDENTITY, useExisting: LocalQaHttpIdentity },
    QaSessionGuard,
    LocalApiShutdown,
  ],
})
export class LocalApiModule {}

@Module({
  controllers: [
    LocalHealthController,
    LocalOpenApiController,
    LocalPersonaController,
    LocalAccessController,
    WorkspaceSubjectsController,
    TechWritingController,
    LocalWalkingSkeletonController,
    QaPackController,
    QaReadinessController,
    QaRequiredSessionPlansController,
    QaSessionsController,
    QaManualExecutionController,
    QaEvidenceController,
    QaSessionReviewController,
    QaFindingsController,
    QaDefectsController,
    QaVerdictCompletionController,
  ],
  providers: [
    {
      provide: LOCAL_PERSONA_DATA_SOURCE,
      useFactory: async () => {
        const environment = loadEnvironment();
        if (selectRuntimeComposition(process.env, environment) !== "qa-local") {
          throw new Error("QA_LOCAL_API_COMPOSITION_REQUIRED");
        }
        const source = createRuntimeDataSource(environment);
        await source.initialize();
        return source;
      },
    },
    {
      provide: HttpsFakeIdpTokenClient,
      useFactory: () => new HttpsFakeIdpTokenClient(loadEnvironment().identityIssuer),
    },
    {
      provide: QA_API_OPERATIONAL_BROKER_MAP,
      useFactory: () => createQaLocalOperationalBrokerMap(loadEnvironment()),
    },
    { provide: QA_API_OPERATIONAL_DELIVERY_MODE, useValue: "INLINE_LOCAL" },
    {
      provide: QA_INTAKE_CONFIGURATION,
      useFactory: (source: DataSource) => createLocalQaIntakeConfiguration(source, "INLINE_LOCAL"),
      inject: [LOCAL_PERSONA_DATA_SOURCE],
    },
    { provide: QA_SESSION_RUNTIME, useFactory: createLocalQaSessionRuntime },
    {
      provide: QA_READINESS_RUNTIME,
      useFactory: createLocalQaReadinessRuntime,
      inject: [LOCAL_PERSONA_DATA_SOURCE],
    },
    {
      provide: QA_DEFECT_PUBLICATION_RUNTIME,
      useFactory: createLocalQaDefectPublication,
      inject: [LOCAL_PERSONA_DATA_SOURCE],
    },
    {
      provide: QA_DOD_RUNTIME,
      useFactory: createLocalQaDodRuntime,
      inject: [LOCAL_PERSONA_DATA_SOURCE],
    },
    {
      provide: QA_VERDICT_RUNTIME,
      useFactory: createLocalQaVerdictRuntime,
      inject: [LOCAL_PERSONA_DATA_SOURCE],
    },
    {
      provide: QA_COMPLETION_RUNTIME,
      useFactory: createLocalQaCompletionRuntime,
      inject: [LOCAL_PERSONA_DATA_SOURCE, QA_DOD_RUNTIME],
    },
    {
      provide: QA_COMPLETION_APPROVAL_RUNTIME,
      useFactory: (source: DataSource, runtime: DurableQaCompletionRuntime) =>
        new DurableQaCompletionApprovalRuntime(source, runtime),
      inject: [LOCAL_PERSONA_DATA_SOURCE, QA_COMPLETION_RUNTIME],
    },
    {
      provide: QA_DEFECT_APPROVAL_RUNTIME,
      useFactory: createLocalQaDefectApproval,
      inject: [
        LOCAL_PERSONA_DATA_SOURCE,
        QA_DEFECT_PUBLICATION_RUNTIME,
        QA_API_OPERATIONAL_BROKER_MAP,
      ],
    },
    LocalPersonaSessionService,
    TechWritingService,
    LocalSessionGuard,
    LocalQaHttpIdentity,
    {
      provide: QUEUE_HTTP_AUTHORITY,
      useFactory: createLocalQueueHttpAuthority,
      inject: [LOCAL_PERSONA_DATA_SOURCE],
    },
    { provide: QA_HTTP_IDENTITY, useExisting: LocalQaHttpIdentity },
    QaSessionGuard,
    LocalApiShutdown,
  ],
})
export class QaLocalApiModule {}

function deterministicUuid(namespace: string): string {
  const hex = createHash("sha256").update(namespace).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function verifyLocalJiraSignature(
  input: Readonly<{
    webhookKey: string;
    rawBytes: Uint8Array;
    headers: Readonly<Record<string, string>>;
    receivedAt: Date;
  }>,
): void {
  const expectedWebhookKey =
    process.env.AWP_JIRA_WEBHOOK_KEY?.trim() || "local-webhook-key-0000000000000001";
  if (input.webhookKey !== expectedWebhookKey) throw new Error("JIRA_WEBHOOK_KEY_REJECTED");
  const hubSignature = input.headers["x-hub-signature"];
  if (hubSignature?.startsWith("sha256=")) {
    const expected = createHmac("sha256", "local-hmac").update(input.rawBytes).digest();
    const supplied = Buffer.from(hubSignature.slice("sha256=".length), "hex");
    if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected)) {
      throw new Error("JIRA_WEBHOOK_SIGNATURE_INVALID");
    }
    return;
  }
  const timestamp = input.headers["x-awp-timestamp"];
  const signature = input.headers["x-awp-signature"];
  if (!timestamp || !signature?.startsWith("sha256="))
    throw new Error("JIRA_WEBHOOK_SIGNATURE_REQUIRED");
  const signedAt = Date.parse(timestamp);
  if (Number.isNaN(signedAt) || Math.abs(input.receivedAt.getTime() - signedAt) > 300_000) {
    throw new Error("JIRA_WEBHOOK_TIMESTAMP_REJECTED");
  }
  const expected = createHmac("sha256", "local-hmac")
    .update(timestamp)
    .update(".")
    .update(input.rawBytes)
    .digest();
  const supplied = Buffer.from(signature.slice("sha256=".length), "hex");
  if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected)) {
    throw new Error("JIRA_WEBHOOK_SIGNATURE_INVALID");
  }
}

@Module({
  imports: [QueueFoundationApiModule],
  controllers: [
    LocalHealthController,
    LocalOpenApiController,
    LocalPersonaController,
    LocalAccessController,
    WorkspaceSubjectsController,
    TechWritingController,
    LocalWalkingSkeletonController,
    QaPackController,
    QaReadinessController,
    QaRequiredSessionPlansController,
    QaSessionsController,
    QaManualExecutionController,
    QaEvidenceController,
    QaSessionReviewController,
    QaFindingsController,
    QaDefectsController,
    QaVerdictCompletionController,
    ConnectorWebhooksController,
    OperationalAuthorityController,
    ApprovalsV11Controller,
    QueueController,
    PortfolioQueueController,
    QueueControlsController,
    QueuePoliciesController,
  ],
  providers: [
    {
      provide: LOCAL_PERSONA_DATA_SOURCE,
      useFactory: async () => {
        const environment = loadEnvironment();
        const composition = selectRuntimeComposition(process.env, environment);
        if (!isQaJiraLocalComposition(composition))
          throw new Error("QA_JIRA_LOCAL_API_COMPOSITION_REQUIRED");
        const source = createRuntimeDataSource(environment);
        await source.initialize();
        return source;
      },
    },
    {
      provide: QUEUE_FOUNDATION_REPOSITORIES,
      useFactory: (source: DataSource) => createQueueFoundationRepositoryProviders(source),
      inject: [LOCAL_PERSONA_DATA_SOURCE],
    },
    {
      provide: APPROVALS_V11_API,
      useFactory: (source: DataSource, authority: QueueHttpAuthority) =>
        createApprovalsV11Api(source, authority),
      inject: [LOCAL_PERSONA_DATA_SOURCE, QUEUE_HTTP_AUTHORITY],
    },
    ApprovalsV11HttpGuard,
    { provide: APPROVALS_V11_HTTP_ACCESS, useExisting: QaSessionGuard },
    {
      provide: HttpsFakeIdpTokenClient,
      useFactory: () => new HttpsFakeIdpTokenClient(loadEnvironment().identityIssuer),
    },
    { provide: QA_API_OPERATIONAL_BROKER_MAP, useValue: durableWorkerOnlyBroker },
    { provide: QA_API_OPERATIONAL_DELIVERY_MODE, useValue: "DURABLE_WORKER" },
    {
      provide: QA_INTAKE_CONFIGURATION,
      useFactory: (source: DataSource) =>
        createLocalQaIntakeConfiguration(source, "DURABLE_WORKER"),
      inject: [LOCAL_PERSONA_DATA_SOURCE],
    },
    { provide: QA_SESSION_RUNTIME, useFactory: createLocalQaSessionRuntime },
    {
      provide: QA_READINESS_RUNTIME,
      useFactory: createLocalQaReadinessRuntime,
      inject: [LOCAL_PERSONA_DATA_SOURCE],
    },
    {
      provide: QA_DEFECT_PUBLICATION_RUNTIME,
      useFactory: createLocalQaDefectPublication,
      inject: [LOCAL_PERSONA_DATA_SOURCE],
    },
    {
      provide: QA_DOD_RUNTIME,
      useFactory: createLocalQaDodRuntime,
      inject: [LOCAL_PERSONA_DATA_SOURCE],
    },
    {
      provide: QA_VERDICT_RUNTIME,
      useFactory: createLocalQaVerdictRuntime,
      inject: [LOCAL_PERSONA_DATA_SOURCE],
    },
    {
      provide: QA_COMPLETION_RUNTIME,
      useFactory: createLocalQaCompletionRuntime,
      inject: [LOCAL_PERSONA_DATA_SOURCE, QA_DOD_RUNTIME],
    },
    {
      provide: QA_COMPLETION_APPROVAL_RUNTIME,
      useFactory: (source: DataSource, runtime: DurableQaCompletionRuntime) =>
        new DurableQaCompletionApprovalRuntime(source, runtime),
      inject: [LOCAL_PERSONA_DATA_SOURCE, QA_COMPLETION_RUNTIME],
    },
    {
      provide: QA_DEFECT_APPROVAL_RUNTIME,
      useFactory: createLocalQaDefectApproval,
      inject: [
        LOCAL_PERSONA_DATA_SOURCE,
        QA_DEFECT_PUBLICATION_RUNTIME,
        QA_API_OPERATIONAL_BROKER_MAP,
      ],
    },
    {
      provide: CONNECTOR_WEBHOOK_INGRESS,
      useFactory: (source: DataSource) => ({
        accept: async (
          input: Readonly<{
            connectorKey: string;
            connectionId: string;
            webhookKey: string;
            contentType: string;
            rawBytes: Uint8Array;
            receivedAt: Date;
            headers: Readonly<Record<string, string>>;
          }>,
        ) => {
          if (input.connectorKey !== "jira")
            throw new Error("CONNECTOR_WEBHOOK_PROVIDER_UNSUPPORTED");
          if (input.connectionId !== qaLocalSeedIds.connection)
            throw new Error("JIRA_WEBHOOK_CONNECTION_SCOPE_REJECTED");
          if (!input.contentType.toLowerCase().startsWith("application/json"))
            throw new Error("WEBHOOK_CONTENT_TYPE_REJECTED");
          if (input.rawBytes.byteLength > 1_048_576) throw new Error("WEBHOOK_BODY_TOO_LARGE");
          const deliveryId =
            input.headers["x-atlassian-webhook-identifier"] ?? input.headers["x-awp-delivery-id"];
          if (!deliveryId) throw new Error("WEBHOOK_DELIVERY_ID_REQUIRED");
          verifyLocalJiraSignature(input);
          const bodyHash = `sha256:${createHash("sha256").update(input.rawBytes).digest("hex")}`;
          const receiptId = deterministicUuid(`jira-webhook:${input.connectionId}:${deliveryId}`);
          let event: unknown;
          try {
            event = JSON.parse(new TextDecoder().decode(input.rawBytes)) as unknown;
          } catch {
            throw new Error("JIRA_WEBHOOK_JSON_INVALID");
          }
          const invalidation = jiraAuthoritativeReadInvalidation({
            connectionId: input.connectionId,
            deliveryId,
            bodyHash,
            event,
          });
          return await source.transaction(async (manager) => {
            const receipt = (await manager.query(
              `WITH inserted AS (
                 INSERT INTO webhook_receipts(
                   connector_key,delivery_id,body_hash,received_at,raw_body,content_type,
                   body_size,verification_result,secret_key_version,retention_until
                 ) VALUES($1,$2,$3,$4,$5,$6,$7,'SIGNATURE_VERIFIED','local-v1',$8)
                 ON CONFLICT(connector_key,delivery_id) DO NOTHING
                 RETURNING body_hash
               )
               SELECT body_hash,true AS inserted FROM inserted
               UNION ALL
               SELECT body_hash,false AS inserted
                 FROM webhook_receipts
                WHERE connector_key=$1 AND delivery_id=$2 AND NOT EXISTS(SELECT 1 FROM inserted)
               LIMIT 1`,
              [
                `jira:${input.connectionId}`,
                deliveryId,
                bodyHash,
                input.receivedAt,
                Buffer.from(input.rawBytes),
                input.contentType,
                input.rawBytes.byteLength,
                new Date(input.receivedAt.getTime() + 86_400_000),
              ],
            )) as readonly Readonly<{ body_hash: string; inserted: boolean }>[];
            if (!receipt[0] || receipt[0].body_hash !== bodyHash)
              throw new Error("DELIVERY_HASH_CONFLICT");
            if (!receipt[0].inserted) return { status: "DUPLICATE" as const, receiptId };
            const eventId = receiptId;
            await manager.query(
              "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,'jira.authoritative-read.requested.v1',$4,$5,'READY',$6) ON CONFLICT DO NOTHING",
              [
                eventId,
                localSeedIds.workspaceFunctional,
                localSeedIds.alpha,
                JSON.stringify(invalidation.job),
                bodyHash,
                input.receivedAt,
              ],
            );
            return { status: "ACCEPTED" as const, receiptId };
          });
        },
      }),
      inject: [LOCAL_PERSONA_DATA_SOURCE],
    },
    {
      provide: OPERATIONAL_AUTHORITY_API,
      useFactory: (source: DataSource): OperationalAuthorityApiPort => {
        return createOperationalAuthorityHttpApi(
          source,
          createLocalOperationalAuthorityHandlers(source),
        );
      },
      inject: [LOCAL_PERSONA_DATA_SOURCE],
    },
    LocalPersonaSessionService,
    TechWritingService,
    LocalSessionGuard,
    LocalQaHttpIdentity,
    {
      provide: QUEUE_HTTP_AUTHORITY,
      useFactory: createLocalQueueHttpAuthority,
      inject: [LOCAL_PERSONA_DATA_SOURCE],
    },
    { provide: QA_HTTP_IDENTITY, useExisting: LocalQaHttpIdentity },
    QaSessionGuard,
    OperationalAuthorityHttpGuard,
    { provide: OPERATIONAL_AUTHORITY_HTTP_ACCESS, useExisting: QaSessionGuard },
    LocalApiShutdown,
  ],
  exports: [
    LOCAL_PERSONA_DATA_SOURCE,
    LocalSessionGuard,
    QA_HTTP_IDENTITY,
    QaSessionGuard,
    QUEUE_HTTP_AUTHORITY,
  ],
})
export class QaJiraLocalApiModule {}

const qaGitLabAutomationControllers = [
  QaAutomationAvailabilityController,
  QaAutomationSuiteBindingsController,
  QaAutomatedSessionsController,
  QaAutomationAttemptsController,
  QaAutomationQuarantinesController,
  GitLabWebhookController,
  QaArtifactsController,
];

const qaGitLabAutomationProviders = [
  WorkspaceContextStore,
  {
    provide: QA_ARTIFACT_HTTP_API,
    useFactory: (source: DataSource) =>
      createQaArtifactHttpApi({
        source,
        repository: new TypeOrmArtifactRepository(source),
        storage: new TypeOrmGitLabArtifactStorage(
          source,
          createLocalGitLabArtifactStorageAuthority(source, loadEnvironment()),
        ),
        scope: createLocalArtifactScope(source),
        contributions: new ArtifactAuthorizationContributionRegistry(),
      }),
    inject: [LOCAL_PERSONA_DATA_SOURCE],
  },
  {
    provide: GITLAB_WEBHOOK_INGRESS_API,
    useFactory: (source: DataSource) =>
      new TypeOrmGitLabWebhookIngressService(
        source,
        new TypeOrmGitLabWebhookAuthorityLoader(source),
        Object.freeze({
          async resolve(
            secretRef: string,
            allowedUseHash: `sha256:${string}`,
          ): Promise<Uint8Array> {
            const environment = loadEnvironment();
            if (
              (environment.gitLabWebhookSecretRef !== undefined &&
                environment.gitLabWebhookSecretRef !== secretRef) ||
              !/^sha256:[a-f0-9]{64}$/u.test(allowedUseHash)
            )
              throw new Error("GITLAB_WEBHOOK_KEY_RESOLUTION_DENIED");
            return new TextEncoder().encode("mock-gitlab-webhook");
          },
        }),
      ),
    inject: [LOCAL_PERSONA_DATA_SOURCE],
  },
  {
    provide: QA_AUTOMATION_QUARANTINES_API,
    useFactory: (source: DataSource) => new TypeOrmQaAutomationQuarantineApi(source),
    inject: [LOCAL_PERSONA_DATA_SOURCE],
  },
  {
    provide: QA_AUTOMATION_AVAILABILITY_API,
    useFactory: (source: DataSource) => new TypeOrmQaAutomationAvailabilityApi(source),
    inject: [LOCAL_PERSONA_DATA_SOURCE],
  },
  {
    provide: QA_AUTOMATION_SUITE_API,
    useFactory: (source: DataSource) => new TypeOrmQaAutomationSuiteApi(source),
    inject: [LOCAL_PERSONA_DATA_SOURCE],
  },
  {
    provide: QA_AUTOMATED_SESSIONS_API,
    useFactory: (source: DataSource) => new TypeOrmQaAutomatedSessionsApi(source),
    inject: [LOCAL_PERSONA_DATA_SOURCE],
  },
  {
    provide: QA_AUTOMATION_ATTEMPTS_API,
    useFactory: (source: DataSource) =>
      new TypeOrmGitLabAutomationAttemptQuery(source, {
        executingService: Object.freeze({
          kind: "SERVICE",
          principalId: localPersonaIds["worker.local"],
          serviceKey: "gitlab-automation",
        }),
        assertFullQaCurrent: async (manager, subject) => {
          const bindingPins = subject.targetSnapshot.configurationPins.map(
            ({ projectIntegrationBindingRef }) => projectIntegrationBindingRef,
          );
          const binding = bindingPins[0];
          if (
            !binding ||
            bindingPins.some(
              (candidate) =>
                candidate.id !== binding.id ||
                candidate.version !== binding.version ||
                candidate.contentHash !== binding.contentHash,
            )
          ) {
            throw new Error("QA_AUTOMATION_BINDING_PIN_MISMATCH");
          }
          const suiteRef = {
            id: subject.targetSnapshot.suite.suiteBindingRef.id,
            version: subject.targetSnapshot.suite.suiteBindingRef.version,
            contentHash: subject.targetSnapshot.suite.suiteBindingHash,
          };
          const rows = (await manager.query(
            `
SELECT 1
FROM project_onboarding_headers onboarding
WHERE onboarding.workspace_id=$1 AND onboarding.project_id=$2
  AND onboarding.current_operational_state='ACTIVE' AND onboarding.current_capability_mode='FULL_QA'
  AND EXISTS(SELECT 1 FROM binding_functional_acceptances acceptance
    WHERE acceptance.workspace_id=$1 AND acceptance.project_id=$2 AND acceptance.outcome='ACCEPTED'
      AND acceptance.binding_ref->>'id'=$3 AND (acceptance.binding_ref->>'version')::int=$4 AND acceptance.binding_ref->>'contentHash'=$5
      AND acceptance.accepted_resource_refs @> $6::jsonb)`,
            [
              subject.workspaceId,
              subject.projectId,
              binding.id,
              binding.version,
              binding.contentHash,
              JSON.stringify([suiteRef]),
            ],
          )) as readonly unknown[];
          if (rows.length !== 1) throw new Error("QA_AUTOMATION_FULL_QA_OR_EXACT_SUITE_REQUIRED");
        },
        authorize: async (manager, input) => {
          if (input.actor.kind !== "HUMAN" || input.authorizationBasis.kind !== "PROJECT")
            throw new Error("QA_AUTOMATION_VERIFIED_HUMAN_REQUIRED");
          const authorized = (await manager.query(
            `
SELECT 1
FROM identities identity
JOIN workspace_memberships membership ON membership.principal_id=identity.id AND membership.workspace_id=$4
  AND membership.id=$5 AND membership.row_version=$6 AND membership.state='ACTIVE' AND membership.revoked_at IS NULL
  AND membership.valid_from<=clock_timestamp() AND (membership.valid_until IS NULL OR membership.valid_until>clock_timestamp())
JOIN projects project ON project.workspace_id=membership.workspace_id AND project.id=$7 AND project.state='ACTIVE'
WHERE identity.id=$1 AND identity.issuer=$2 AND identity.subject=$3
  AND EXISTS(SELECT 1 FROM project_entitlements entitlement
    WHERE entitlement.principal_id=identity.id AND entitlement.workspace_id=$4 AND entitlement.project_id=$7
      AND entitlement.id=ANY($8::uuid[]) AND entitlement.effect='ALLOW' AND entitlement.revoked_at IS NULL
      AND entitlement.valid_from<=clock_timestamp() AND (entitlement.valid_until IS NULL OR entitlement.valid_until>clock_timestamp()))`,
            [
              input.actor.principalId,
              input.actor.issuer,
              input.actor.subject,
              input.scope.workspaceId,
              input.authorizationBasis.membershipRef.id,
              input.authorizationBasis.membershipRef.version,
              input.scope.projectId,
              input.authorizationBasis.entitlementRefs.map(({ id }) => id),
            ],
          )) as readonly unknown[];
          if (authorized.length !== 1)
            throw new Error("QA_AUTOMATION_LAUNCH_AUTHORIZATION_REVOKED");
          const target = input.subject.targetSnapshot;
          if (
            target.workspaceId !== input.scope.workspaceId ||
            target.projectId !== input.scope.projectId ||
            target.testSessionId !== input.sessionId
          ) {
            throw new Error("QA_AUTOMATION_TARGET_SCOPE_FORBIDDEN");
          }
          const executionPins = target.configurationPins.filter(
            ({ logicalRole }) => logicalRole === "TEST_EXECUTION",
          );
          const pin = executionPins[0];
          if (executionPins.length !== 1 || !pin)
            throw new Error("QA_AUTOMATION_TEST_EXECUTION_PIN_INVALID");
          const configuration = (await manager.query(
            `
SELECT 1
FROM connector_profile_revisions profile
JOIN connection_revisions connection ON connection.workspace_id=profile.workspace_id
  AND connection.header_id=$4 AND connection.version=$5 AND connection.content_hash=$6 AND connection.status='PUBLISHED'
JOIN project_integration_binding_revisions binding ON binding.workspace_id=profile.workspace_id AND binding.project_id=$7
  AND binding.header_id=$8 AND binding.version=$9 AND binding.content_hash=$10 AND binding.status='PUBLISHED'
WHERE profile.workspace_id=$1 AND profile.header_id=$2 AND profile.version=$3 AND profile.content_hash=$11 AND profile.status='PUBLISHED'
  AND EXISTS(SELECT 1 FROM integration_validation_reports report
    WHERE report.workspace_id=$1 AND report.project_id=$7 AND report.subject_kind='PROFILE'
      AND report.subject_id=$2 AND report.subject_version=$3 AND report.outcome='VALID')`,
            [
              input.scope.workspaceId,
              pin.profileRef.id,
              pin.profileRef.version,
              pin.connectionRef.id,
              pin.connectionRef.version,
              pin.connectionRef.contentHash,
              input.scope.projectId,
              pin.projectIntegrationBindingRef.id,
              pin.projectIntegrationBindingRef.version,
              pin.projectIntegrationBindingRef.contentHash,
              pin.profileRef.contentHash,
            ],
          )) as readonly unknown[];
          if (configuration.length !== 1) throw new Error("QA_AUTOMATION_CONFIGURATION_REVOKED");
        },
      }),
    inject: [LOCAL_PERSONA_DATA_SOURCE],
  },
];

@Module({
  imports: [QaJiraLocalApiModule],
  controllers: qaGitLabAutomationControllers,
  providers: qaGitLabAutomationProviders,
})
export class QaJiraGitLabLocalApiModule {}

@Module({
  imports: [QaJiraLocalApiModule],
  controllers: [
    MattermostIntegrationController,
    MattermostBootstrapController,
    MattermostProjectSelectionController,
    MattermostIngressController,
    IntakeDraftRevisionsController,
    IntakeCandidatesController,
    AgentRunsController,
    NotificationIntentsController,
    QaHermesProposalsController,
    QaHermesProposalResourcesController,
    OnboardingController,
    ProjectDialogueController,
    HermesMattermostController,
    PublishedOnboardingController,
    ProjectReadsController,
    EvidenceIntegrityController,
    ProjectOperationsController,
    PublishedProjectOperationsController,
  ],
  providers: [
    {
      provide: MATTERMOST_ADMINISTRATION,
      useFactory: (source: DataSource): MattermostAdministrationPort =>
        createMattermostAdministrationService(source, loadEnvironment()),
      inject: [LOCAL_PERSONA_DATA_SOURCE],
    },
    {
      provide: MATTERMOST_PROJECT_SELECTION,
      useFactory: (source: DataSource): MattermostProjectSelectionPort => {
        return createMattermostProjectSelectionApi(source, async () => {
          if (!["local", "test"].includes(loadEnvironment().profile))
            throw new Error("LOCAL_PROJECT_INVENTORY_FORBIDDEN");
          return (await source.query(
            'SELECT workspace_id AS "workspaceId",id AS "projectId" FROM projects ORDER BY id LIMIT 101',
          )) as { workspaceId: string; projectId: string }[];
        });
      },
      inject: [LOCAL_PERSONA_DATA_SOURCE],
    },
    {
      provide: MATTERMOST_INGRESS,
      useFactory: (source: DataSource) =>
        new MattermostIngressService(
          new TypeOrmExternalInteractionReceiptRepository(source),
          {
            dispatch: async (input) => {
              const envelopeHash = `sha256:${createHash("sha256").update(JSON.stringify(input.envelope)).digest("hex")}`;
              await source.query(
                "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,'mattermost.callback.received.v1',$4,$5,'READY',clock_timestamp()) ON CONFLICT(id) DO NOTHING",
                [
                  input.receiptId,
                  input.scope.workspaceId,
                  input.scope.projectId,
                  JSON.stringify({
                    receiptId: input.receiptId,
                    transportKind: input.transportKind,
                  }),
                  envelopeHash,
                ],
              );
            },
          },
          async (connectionId) => {
            const rows = (await source.query(
              `SELECT c.workspace_id,(c.content->>'projectId') AS project_id,c.header_id AS connection_id FROM connection_revisions c WHERE c.header_id=$1 AND c.status='PUBLISHED' ORDER BY c.version DESC LIMIT 1`,
              [connectionId],
            )) as readonly Readonly<Record<string, unknown>>[];
            const row = rows[0];
            if (!row?.project_id) throw new Error("MATTERMOST_CONNECTION_SCOPE_NOT_FOUND");
            return Object.freeze({
              workspaceId: String(row.workspace_id),
              projectId: String(row.project_id),
              connectionId: String(row.connection_id),
            });
          },
          process.env.AWP_MATTERMOST_CALLBACK_HMAC_SECRET ?? "local-mattermost-callback-hmac",
        ),
      inject: [LOCAL_PERSONA_DATA_SOURCE],
    },
    {
      provide: CORE_INTAKE_HTTP_APIS,
      useFactory: (source: DataSource) =>
        createCoreIntakeHttpApis(source, createLocalAgentGrantAuthority()),
      inject: [LOCAL_PERSONA_DATA_SOURCE],
    },
    {
      provide: INTAKE_DRAFT_REVISIONS_API,
      useFactory: (apis: CoreIntakeHttpApis) => apis.drafts,
      inject: [CORE_INTAKE_HTTP_APIS],
    },
    {
      provide: INTAKE_CANDIDATES_API,
      useFactory: (apis: CoreIntakeHttpApis) => apis.candidates,
      inject: [CORE_INTAKE_HTTP_APIS],
    },
    {
      provide: AGENT_RUNS_API,
      useFactory: (apis: CoreIntakeHttpApis) => apis.agents,
      inject: [CORE_INTAKE_HTTP_APIS],
    },
    {
      provide: NOTIFICATION_INTENTS_API,
      useFactory: (apis: CoreIntakeHttpApis) => apis.notifications,
      inject: [CORE_INTAKE_HTTP_APIS],
    },
    IntakeDraftHttpGuard,
    { provide: INTAKE_DRAFT_HTTP_ACCESS, useExisting: QaSessionGuard },
    WorkspaceContextStore,
    {
      provide: VALIDATION_HTTP_APPLICATION,
      useFactory: (source: DataSource) => new DurableValidationHttpApplication(source),
      inject: [LOCAL_PERSONA_DATA_SOURCE],
    },
    {
      provide: RESOURCES_HTTP_APPLICATION,
      useFactory: (source: DataSource) =>
        new DurableResourcesHttpApplication(
          source,
          new FileAccountInventory(process.env.AWP_QA_ACCOUNT_INVENTORY_FILE),
        ),
      inject: [LOCAL_PERSONA_DATA_SOURCE],
    },
    {
      provide: REGISTRY_HTTP_APPLICATION,
      useFactory: (source: DataSource) => new DurableRegistryHttpApplication(source),
      inject: [LOCAL_PERSONA_DATA_SOURCE],
    },
    {
      provide: BINDING_HTTP_APPLICATION,
      useFactory: (source: DataSource) => new DurableBindingHttpApplication(source),
      inject: [LOCAL_PERSONA_DATA_SOURCE],
    },
    {
      provide: EVIDENCE_HTTP_APPLICATION,
      useFactory: createLocalEvidenceIntegrity,
      inject: [LOCAL_PERSONA_DATA_SOURCE],
    },
    {
      provide: PROJECT_OPERATIONS_HTTP_APPLICATION,
      useFactory: (source: DataSource) => new DurableProjectOperationsApplication(source),
      inject: [LOCAL_PERSONA_DATA_SOURCE],
    },
  ],
})
export class QaJiraMattermostLocalApiModule {}

@Module({
  imports: [QaJiraMattermostLocalApiModule, QaJiraLocalApiModule],
  controllers: qaGitLabAutomationControllers,
  providers: qaGitLabAutomationProviders,
})
export class QaJiraGitLabMattermostLocalApiModule {}

@Module({ controllers: [HealthController] })
export class CoreApiModule {}

export interface PilotNonLocalApiBindings {
  readonly source: DataSource;
  readonly identity?: QaHttpIdentity;
  readonly onboarding?: CorporateOnboardingBindings;
  readonly evidenceImport: DurablePilotEvidenceImport;
  readonly readinessQuery: PilotReadinessQuery;
  readonly pilotRuns?: PilotRunApiService;
}

/** The non-local API surface contains only guarded corporate routes and explicit ports.
 * It cannot import local personas, fixture identity, local secret resolution or inline effects. */
@Module({})
export class PilotNonLocalApiModule {
  static register(input: PilotNonLocalApiBindings): DynamicModule {
    if (
      !input.source.isInitialized ||
      (!input.onboarding && !input.identity) ||
      !input.evidenceImport ||
      !input.readinessQuery
    )
      throw new Error("PILOT_NON_LOCAL_API_BINDINGS_REQUIRED");
    if (input.onboarding && input.identity) throw new Error("PILOT_NON_LOCAL_IDENTITY_AMBIGUOUS");
    return {
      module: PilotNonLocalApiModule,
      imports: input.onboarding
        ? [
            CorporateOnboardingModule.register(input.source, input.onboarding),
            CorporateAccessModule.register(input.source, input.onboarding.sessions),
          ]
        : [],
      controllers: [HealthController, PilotController],
      providers: [
        ...(!input.onboarding
          ? [
              { provide: QA_DATA_SOURCE, useValue: input.source },
              { provide: QA_HTTP_IDENTITY, useValue: input.identity },
            ]
          : []),
        { provide: PILOT_EVIDENCE_IMPORT, useValue: input.evidenceImport },
        { provide: PILOT_READINESS_QUERY, useValue: input.readinessQuery },
        ...(input.pilotRuns ? [{ provide: PILOT_RUN_SERVICE, useValue: input.pilotRuns }] : []),
        QaSessionGuard,
      ],
    };
  }
}
