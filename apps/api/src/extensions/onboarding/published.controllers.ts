import { Controller, Inject, UseFilters, UseInterceptors } from "@nestjs/common";
import type { DataSource } from "typeorm";

import { QA_DATA_SOURCE } from "../qa-api-authorization.ts";
import { BINDING_HTTP_APPLICATION, DurableBindingHttpApplication } from "./bindings.application.ts";
import { OnboardingController } from "./onboarding.controller.ts";
import {
  DurableProjectOperationsApplication,
  PROJECT_OPERATIONS_HTTP_APPLICATION,
} from "./project-operations.application.ts";
import { ProjectOperationsController } from "./project-operations.controller.ts";
import {
  PublishedOnboardingInterceptor,
  PublishedOnboardingProblemFilter,
} from "./published-http.ts";
import {
  DurableRegistryHttpApplication,
  REGISTRY_HTTP_APPLICATION,
} from "./registry.application.ts";
import {
  DurableResourcesHttpApplication,
  RESOURCES_HTTP_APPLICATION,
} from "./resources.application.ts";
import {
  DurableValidationHttpApplication,
  VALIDATION_HTTP_APPLICATION,
} from "./validation.application.ts";

/** Share the same guarded use cases with legacy clients; only the wire contract differs. */
@Controller("api/v1/workspaces/:workspaceId/projects")
@UseInterceptors(PublishedOnboardingInterceptor)
@UseFilters(PublishedOnboardingProblemFilter)
export class PublishedOnboardingController extends OnboardingController {
  constructor(
    @Inject(QA_DATA_SOURCE) source: DataSource,
    @Inject(BINDING_HTTP_APPLICATION) bindings: DurableBindingHttpApplication,
    @Inject(REGISTRY_HTTP_APPLICATION) registry: DurableRegistryHttpApplication,
    @Inject(RESOURCES_HTTP_APPLICATION) resources: DurableResourcesHttpApplication,
    @Inject(VALIDATION_HTTP_APPLICATION) validation: DurableValidationHttpApplication,
  ) {
    super(source, bindings, registry, resources, validation);
  }
}
@Controller("api/v1/workspaces/:workspaceId/projects/:projectId/operations")
@UseInterceptors(PublishedOnboardingInterceptor)
@UseFilters(PublishedOnboardingProblemFilter)
export class PublishedProjectOperationsController extends ProjectOperationsController {
  constructor(
    @Inject(QA_DATA_SOURCE) source: DataSource,
    @Inject(PROJECT_OPERATIONS_HTTP_APPLICATION) application: DurableProjectOperationsApplication,
  ) {
    super(source, application);
  }
}
