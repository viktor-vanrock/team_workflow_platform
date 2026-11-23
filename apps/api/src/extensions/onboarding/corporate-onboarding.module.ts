import { type DynamicModule, ForbiddenException, Module } from "@nestjs/common";
import type { DataSource } from "typeorm";

import { TypeOrmScopedAccessRepository } from "@awp/platform-persistence-typeorm";
import {
  CorporateAuthenticationModule,
  type CorporateSessionService,
} from "@awp/platform-runtime-nest";

import { CorporateQaHttpIdentity } from "../corporate-qa-http-identity.ts";
import { HermesMattermostController } from "../hermes/mattermost.controller.ts";
import { QA_DATA_SOURCE, QA_HTTP_IDENTITY, QaSessionGuard } from "../qa-api-authorization.ts";
import { BINDING_HTTP_APPLICATION, DurableBindingHttpApplication } from "./bindings.application.ts";
import {
  DurableEvidenceHttpApplication,
  EVIDENCE_HTTP_APPLICATION,
  type EvidenceCrypto,
} from "./evidence.application.ts";
import { EvidenceIntegrityController } from "./evidence.controller.ts";
import { OnboardingController } from "./onboarding.controller.ts";
import { ProjectDialogueController } from "./project-dialogue.controller.ts";
import {
  DurableProjectOperationsApplication,
  PROJECT_OPERATIONS_HTTP_APPLICATION,
} from "./project-operations.application.ts";
import { ProjectOperationsController } from "./project-operations.controller.ts";
import { ProjectReadsController } from "./project-reads.controller.ts";
import {
  PublishedOnboardingController,
  PublishedProjectOperationsController,
} from "./published.controllers.ts";
import {
  DurableRegistryHttpApplication,
  REGISTRY_HTTP_APPLICATION,
} from "./registry.application.ts";
import {
  type AccountInventoryPort,
  DurableResourcesHttpApplication,
  RESOURCES_HTTP_APPLICATION,
} from "./resources.application.ts";
import {
  DurableValidationHttpApplication,
  VALIDATION_HTTP_APPLICATION,
} from "./validation.application.ts";

export interface CorporateOnboardingBindings {
  readonly sessions: CorporateSessionService;
  readonly accountInventory: AccountInventoryPort;
  readonly evidenceCrypto: (
    scope: Readonly<{ workspaceId: string; projectId: string }>,
  ) => EvidenceCrypto;
}

/** Additional policy checks on the same verified session used by the pilot controllers. */
export const corporateOnboardingStepUpPermissions = Object.freeze([
  "project.entitlement.grant",
  "project.entitlement.revoke",
  "project.suspend",
  "project.resume",
  "integration.publish",
  "integration.retire",
  "project.onboarding.activate",
  "qa.evidence.export",
]);

/** Durable domain services with explicit corporate trust/resource ports; no local composition import. */
@Module({})
export class CorporateOnboardingModule {
  static register(source: DataSource, input: CorporateOnboardingBindings): DynamicModule {
    if (
      !source.isInitialized ||
      !input.sessions ||
      typeof input.sessions.authorize !== "function" ||
      typeof input.accountInventory?.slots !== "function" ||
      typeof input.evidenceCrypto !== "function"
    )
      throw new Error("CORPORATE_ONBOARDING_BINDINGS_REQUIRED");
    const identity = new CorporateQaHttpIdentity(
      input.sessions,
      new TypeOrmScopedAccessRepository(source),
      corporateOnboardingStepUpPermissions,
    );
    const registry = new DurableRegistryHttpApplication(
      source,
      async (request, workspaceId, operation = "MUTATE", permission = "project.register") => {
        try {
          const authorized = await input.sessions.authorize(request, {
            scope: { kind: "WORKSPACE", workspaceId },
            permission,
            operationClass: operation,
            requireStepUp: operation === "MUTATE",
          });
          if (!authorized.authorizationBasis) throw new Error("CORPORATE_REGISTRATION_DENIED");
          return authorized.authorizationBasis;
        } catch {
          throw new ForbiddenException("CORPORATE_REGISTRATION_DENIED");
        }
      },
    );
    return {
      module: CorporateOnboardingModule,
      imports: [CorporateAuthenticationModule.configured(input.sessions)],
      controllers: [
        OnboardingController,
        PublishedOnboardingController,
        ProjectDialogueController,
        HermesMattermostController,
        ProjectOperationsController,
        PublishedProjectOperationsController,
        ProjectReadsController,
        EvidenceIntegrityController,
      ],
      providers: [
        { provide: QA_DATA_SOURCE, useValue: source },
        { provide: QA_HTTP_IDENTITY, useValue: identity },
        QaSessionGuard,
        { provide: REGISTRY_HTTP_APPLICATION, useValue: registry },
        { provide: BINDING_HTTP_APPLICATION, useValue: new DurableBindingHttpApplication(source) },
        {
          provide: RESOURCES_HTTP_APPLICATION,
          useValue: new DurableResourcesHttpApplication(source, input.accountInventory),
        },
        {
          provide: VALIDATION_HTTP_APPLICATION,
          useValue: new DurableValidationHttpApplication(source),
        },
        {
          provide: EVIDENCE_HTTP_APPLICATION,
          useValue: new DurableEvidenceHttpApplication(source, input.evidenceCrypto),
        },
        {
          provide: PROJECT_OPERATIONS_HTTP_APPLICATION,
          useValue: new DurableProjectOperationsApplication(source),
        },
      ],
      exports: [QA_DATA_SOURCE, QA_HTTP_IDENTITY],
    };
  }
}
