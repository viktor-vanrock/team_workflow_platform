import { type DynamicModule, ForbiddenException, Module } from "@nestjs/common";
import type { DataSource } from "typeorm";

import { defaultClassificationCatalog } from "@awp/platform-core";
import { TypeOrmScopedAccessRepository } from "@awp/platform-persistence-typeorm";
import {
  AGENT_RUNS_API,
  AgentRunsController,
  APPROVALS_V11_API,
  APPROVALS_V11_HTTP_ACCESS,
  ApprovalsV11Controller,
  ApprovalsV11HttpGuard,
  type CorporateSessionService,
  INTAKE_CANDIDATES_API,
  INTAKE_DRAFT_HTTP_ACCESS,
  INTAKE_DRAFT_REVISIONS_API,
  IntakeCandidatesController,
  IntakeDraftHttpGuard,
  IntakeDraftRevisionsController,
  NOTIFICATION_INTENTS_API,
  NotificationIntentsController,
} from "@awp/platform-runtime-nest";
import {
  CorporateQueueHttpAuthority,
  type QaCompletionApprovalRuntime,
  type QaCompletionRuntime,
  type QaDefectApprovalRuntime,
  type QaDefectPublicationRuntime,
  type QaDodRuntime,
  type QaReadinessRuntime,
  type QaSessionRuntime,
  qaUs1OperationalRoute,
  type QaVerdictRuntime,
} from "@awp/runtime-composition";

import { type CoreAgentGrantAuthority, createCoreIntakeHttpApis } from "./core-intake-http-api.ts";
import {
  type CorporateCommandAdmissionAuthority,
  QA_COMMAND_ADMISSION_AUTHORITY,
} from "./corporate-command-admission.ts";
import { CorporateQaHttpIdentity } from "./corporate-qa-http-identity.ts";
import { CorporateAutomationReadController } from "./gitlab-automation/corporate-automation-read.controller.ts";
import { CorporateSuiteClosedController } from "./gitlab-automation/corporate-suite-closed.controller.ts";
import { corporateOnboardingStepUpPermissions } from "./onboarding/corporate-onboarding.module.ts";
import { QA_DATA_SOURCE, QA_HTTP_IDENTITY, QaSessionGuard } from "./qa-api-authorization.ts";
import {
  QA_DEFECT_APPROVAL_RUNTIME,
  QA_DEFECT_PUBLICATION_RUNTIME,
  QaDefectsController,
} from "./qa-defects.controller.ts";
import { QaEvidenceController } from "./qa-evidence.controller.ts";
import { QaFindingsController } from "./qa-findings.controller.ts";
import { QA_INTAKE_CONFIGURATION, type QaIntakeConfiguration } from "./qa-intake-configuration.ts";
import { QaManualExecutionController } from "./qa-manual-execution.controller.ts";
import {
  QA_API_OPERATIONAL_BROKER_MAP,
  QA_API_OPERATIONAL_DELIVERY_MODE,
  QA_INTAKE_CLASSIFICATION_POLICY,
  QaPackController,
} from "./qa-pack.controller.ts";
import { QA_READINESS_RUNTIME, QaReadinessController } from "./qa-readiness.controller.ts";
import { QaRequiredSessionPlansController } from "./qa-required-session-plans.controller.ts";
import { QaSessionReviewController } from "./qa-session-review.controller.ts";
import { QA_SESSION_RUNTIME, QaSessionsController } from "./qa-sessions.controller.ts";
import {
  QA_COMPLETION_APPROVAL_RUNTIME,
  QA_COMPLETION_RUNTIME,
  QA_DOD_RUNTIME,
  QA_VERDICT_RUNTIME,
  QaVerdictCompletionController,
} from "./qa-verdict-completion.controller.ts";
import { createApprovalsV11Api } from "./queue/approval-v11.api.ts";
import { PortfolioQueueController, QueueController } from "./queue/queue.controller.ts";
import { QueueControlsController } from "./queue/queue-controls.controller.ts";
import { QUEUE_HTTP_AUTHORITY } from "./queue/queue-http-authority.ts";
import { QueuePoliciesController } from "./queue/queue-policies.controller.ts";

/** All ports are supplied by the trusted host, never from an HTTP request. */
export interface CorporateQaBindings {
  readonly intake: QaIntakeConfiguration;
  readonly agentAuthority: CoreAgentGrantAuthority;
  readonly commandAdmission: CorporateCommandAdmissionAuthority;
  readonly session: QaSessionRuntime;
  readonly readiness: QaReadinessRuntime;
  readonly defectPublication: QaDefectPublicationRuntime;
  readonly defectApproval: QaDefectApprovalRuntime;
  readonly dod: QaDodRuntime;
  readonly verdict: QaVerdictRuntime;
  readonly completion: QaCompletionRuntime;
  readonly completionApproval: QaCompletionApprovalRuntime;
  readonly stepUpPermissions: readonly string[];
}

@Module({})
export class CorporateQaModule {
  static register(
    source: DataSource,
    sessions: CorporateSessionService,
    projects: readonly Readonly<{ workspaceId: string; projectId: string }>[],
    input: CorporateQaBindings,
  ): DynamicModule {
    if (
      !source.isInitialized ||
      !sessions ||
      !projects.length ||
      typeof input?.intake?.load !== "function" ||
      typeof input.agentAuthority?.resolve !== "function" ||
      typeof input.commandAdmission?.context !== "function" ||
      typeof input.commandAdmission.guard?.assertEffectsAllowed !== "function" ||
      !input.session ||
      !input.readiness ||
      !input.defectPublication ||
      !input.defectApproval ||
      !input.dod ||
      !input.verdict ||
      !input.completion ||
      !input.completionApproval ||
      !Array.isArray(input.stepUpPermissions)
    )
      throw new Error("CORPORATE_QA_BINDINGS_REQUIRED");
    const stepUp = [
      ...new Set([
        ...corporateOnboardingStepUpPermissions,
        "queue.control.approve",
        "approval.decide",
        ...(input.stepUpPermissions as readonly string[]),
      ]),
    ];
    const identity = new CorporateQaHttpIdentity(
      sessions,
      new TypeOrmScopedAccessRepository(source),
      stepUp,
      projects,
    );
    const queue = new CorporateQueueHttpAuthority(sessions, projects, stepUp);
    const intake = createCoreIntakeHttpApis(source, input.agentAuthority);
    const workerOnlyBroker = Object.freeze({
      [qaUs1OperationalRoute]: Object.freeze({
        invoke: async () => {
          throw new Error("QA_JIRA_EFFECT_MUST_RUN_IN_WORKER");
        },
        readByEffect: async () => {
          throw new Error("QA_JIRA_READBACK_MUST_RUN_IN_WORKER");
        },
      }),
    });
    return {
      module: CorporateQaModule,
      controllers: [
        QaPackController,
        CorporateAutomationReadController,
        CorporateSuiteClosedController,
        QaReadinessController,
        QaRequiredSessionPlansController,
        QaSessionsController,
        QaManualExecutionController,
        QaEvidenceController,
        QaSessionReviewController,
        QaFindingsController,
        QaDefectsController,
        QaVerdictCompletionController,
        IntakeDraftRevisionsController,
        IntakeCandidatesController,
        AgentRunsController,
        NotificationIntentsController,
        ApprovalsV11Controller,
        QueueController,
        PortfolioQueueController,
        QueueControlsController,
        QueuePoliciesController,
      ],
      providers: [
        { provide: QA_DATA_SOURCE, useValue: source },
        { provide: QA_HTTP_IDENTITY, useValue: identity },
        { provide: QA_INTAKE_CONFIGURATION, useValue: input.intake },
        { provide: QA_COMMAND_ADMISSION_AUTHORITY, useValue: input.commandAdmission },
        { provide: QA_API_OPERATIONAL_BROKER_MAP, useValue: workerOnlyBroker },
        { provide: QA_API_OPERATIONAL_DELIVERY_MODE, useValue: "DURABLE_WORKER" },
        {
          provide: QA_INTAKE_CLASSIFICATION_POLICY,
          useValue: {
            assertAllowed(ceiling: string, requested: string, projectMaximum?: string) {
              try {
                const classification = defaultClassificationCatalog.reference(requested);
                if (
                  !defaultClassificationCatalog.permits(
                    defaultClassificationCatalog.reference(ceiling),
                    classification,
                  ) ||
                  (projectMaximum &&
                    !defaultClassificationCatalog.permits(
                      defaultClassificationCatalog.reference(projectMaximum),
                      classification,
                    ))
                )
                  throw new Error();
              } catch {
                throw new ForbiddenException("QA_CLASSIFICATION_DENIED");
              }
            },
          },
        },
        { provide: QA_SESSION_RUNTIME, useValue: input.session },
        { provide: QA_READINESS_RUNTIME, useValue: input.readiness },
        { provide: QA_DEFECT_PUBLICATION_RUNTIME, useValue: input.defectPublication },
        { provide: QA_DEFECT_APPROVAL_RUNTIME, useValue: input.defectApproval },
        { provide: QA_DOD_RUNTIME, useValue: input.dod },
        { provide: QA_VERDICT_RUNTIME, useValue: input.verdict },
        { provide: QA_COMPLETION_RUNTIME, useValue: input.completion },
        { provide: QA_COMPLETION_APPROVAL_RUNTIME, useValue: input.completionApproval },
        { provide: QUEUE_HTTP_AUTHORITY, useValue: queue },
        { provide: APPROVALS_V11_API, useValue: createApprovalsV11Api(source, queue) },
        { provide: INTAKE_DRAFT_REVISIONS_API, useValue: intake.drafts },
        { provide: INTAKE_CANDIDATES_API, useValue: intake.candidates },
        { provide: AGENT_RUNS_API, useValue: intake.agents },
        { provide: NOTIFICATION_INTENTS_API, useValue: intake.notifications },
        QaSessionGuard,
        IntakeDraftHttpGuard,
        ApprovalsV11HttpGuard,
        { provide: INTAKE_DRAFT_HTTP_ACCESS, useExisting: QaSessionGuard },
        { provide: APPROVALS_V11_HTTP_ACCESS, useExisting: QaSessionGuard },
      ],
    };
  }
}
