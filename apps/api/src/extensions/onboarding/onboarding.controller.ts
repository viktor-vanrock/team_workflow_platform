import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { DataSource } from "typeorm";

import { TargetPrincipalCommand } from "@awp/platform-runtime-nest";

import { QA_DATA_SOURCE, QaSessionGuard, type QaSessionRequest } from "../qa-api-authorization.ts";
import { BINDING_HTTP_APPLICATION, DurableBindingHttpApplication } from "./bindings.application.ts";
import {
  bindingApprovedCommand,
  bindingCandidateCommand,
  bindingLifecycleAction,
} from "./bindings.controller.ts";
import {
  etag,
  idempotencyKey,
  object,
  onboardingRequest,
  reject,
  safeResult,
  text,
  uuid,
} from "./durable-http.ts";
import { ProjectMetadataApplication } from "./project-metadata.application.ts";
import { isPublishedOnboardingRequest } from "./published-http-context.ts";
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

@Controller("v1/workspaces/:workspaceId/projects")
export class OnboardingController {
  constructor(
    @Inject(QA_DATA_SOURCE) private readonly bindingSource: DataSource,
    @Inject(BINDING_HTTP_APPLICATION) private readonly bindings: DurableBindingHttpApplication,
    @Inject(REGISTRY_HTTP_APPLICATION) private readonly registry: DurableRegistryHttpApplication,
    @Inject(RESOURCES_HTTP_APPLICATION) private readonly resources: DurableResourcesHttpApplication,
    @Inject(VALIDATION_HTTP_APPLICATION)
    private readonly validation: DurableValidationHttpApplication,
  ) {}

  @Get()
  @UseGuards(QaSessionGuard)
  @Header("Cache-Control", "private, no-store")
  catalog(
    @Param("workspaceId") workspaceId: string,
    @Req() request?: QaSessionRequest,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    return safeResult(() => {
      if (!request) return reject("VERIFIED_REQUEST_REQUIRED", 403);
      return this.registry.catalog(request, workspaceId, {
        ...(limit === undefined ? {} : { limit }),
        ...(cursor === undefined ? {} : { cursor }),
      });
    });
  }
  @Get("registration-options")
  @UseGuards(QaSessionGuard)
  @Header("Cache-Control", "private, no-store")
  registrationOptions(
    @Param("workspaceId") workspaceId: string,
    @Req() request?: QaSessionRequest,
  ) {
    return safeResult(() => {
      if (!request) return reject("VERIFIED_REQUEST_REQUIRED", 403);
      return this.registry.registrationOptions(request, workspaceId);
    });
  }
  @Post()
  @UseGuards(QaSessionGuard)
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  register(
    @Param("workspaceId") workspaceId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
    @Req() request?: QaSessionRequest,
  ) {
    return safeResult(() => {
      if (!request) return reject("VERIFIED_REQUEST_REQUIRED", 403);
      return this.registry.register(request, workspaceId, body, idempotencyKey(key));
    });
  }
  @Get(":projectId/metadata")
  @UseGuards(QaSessionGuard)
  @Header("Cache-Control", "private, no-store")
  projectMetadata(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Req() request: QaSessionRequest,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): unknown },
  ) {
    return safeResult(async () => {
      const result = await new ProjectMetadataApplication(this.bindingSource).read(
        onboardingRequest(this.bindingSource, request, workspaceId, projectId),
      );
      response.setHeader("ETag", `"${result.project.version}"`);
      return result;
    });
  }
  @Put(":projectId/metadata")
  @UseGuards(QaSessionGuard)
  @Header("Cache-Control", "private, no-store")
  updateProjectMetadata(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Req() request: QaSessionRequest,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Headers("if-match") match: string | undefined,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): unknown },
  ) {
    return safeResult(async () => {
      const result = await new ProjectMetadataApplication(this.bindingSource).update(
        onboardingRequest(this.bindingSource, request, workspaceId, projectId),
        body,
        idempotencyKey(key),
        etag(match),
      );
      response.setHeader("ETag", `"${result.version}"`);
      return result;
    });
  }
  @Get(":projectId/onboarding")
  @UseGuards(QaSessionGuard)
  @Header("Cache-Control", "private, no-store")
  onboarding(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Req() request?: QaSessionRequest,
    @Res({ passthrough: true }) response?: { setHeader(name: string, value: string): unknown },
  ) {
    return safeResult(async () => {
      if (!request) return reject("VERIFIED_REQUEST_REQUIRED", 403);
      const result = await this.registry.onboarding(
        onboardingRequest(this.bindingSource, request, workspaceId, projectId),
      );
      response?.setHeader("ETag", `"${result.version}"`);
      return result;
    });
  }
  @Post(":projectId/entitlements")
  @TargetPrincipalCommand()
  @UseGuards(QaSessionGuard)
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  grantEntitlement(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
    @Req() request?: QaSessionRequest,
    @Headers("if-match") match?: string,
  ) {
    return safeResult(() => {
      if (!request) return reject("VERIFIED_REQUEST_REQUIRED", 403);
      return this.registry.entitlement(
        onboardingRequest(this.bindingSource, request, workspaceId, projectId),
        body,
        idempotencyKey(key),
        "GRANT",
        undefined,
        isPublishedOnboardingRequest(request) ? etag(match) : undefined,
      );
    });
  }
  @Post(":projectId/entitlements/:entitlementId/replace")
  @TargetPrincipalCommand()
  @UseGuards(QaSessionGuard)
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  replaceEntitlement(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("entitlementId") entitlementId: string,
    @Headers("if-match") match: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
    @Req() request: QaSessionRequest,
  ) {
    return safeResult(() =>
      this.registry.entitlement(
        onboardingRequest(this.bindingSource, request, workspaceId, projectId),
        body,
        idempotencyKey(key),
        "REPLACE",
        uuid(entitlementId),
        etag(match),
      ),
    );
  }
  @Post(":projectId/entitlements/:entitlementId/revoke")
  @UseGuards(QaSessionGuard)
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  revokeEntitlement(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("entitlementId") entitlementId: string,
    @Headers("if-match") match: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
    @Req() request?: QaSessionRequest,
  ) {
    return safeResult(() => {
      if (!request) return reject("VERIFIED_REQUEST_REQUIRED", 403);
      return this.registry.entitlement(
        onboardingRequest(this.bindingSource, request, workspaceId, projectId),
        body,
        idempotencyKey(key),
        "REVOKE",
        uuid(entitlementId),
        etag(match),
      );
    });
  }

  @Post(":projectId/qa/environments")
  @UseGuards(QaSessionGuard)
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  publishQaEnvironment(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
    @Req() request?: QaSessionRequest,
    @Headers("if-match") match?: string,
  ) {
    return safeResult(() => {
      if (!request) return reject("VERIFIED_REQUEST_REQUIRED", 403);
      return this.resources.publishEnvironment(
        onboardingRequest(this.bindingSource, request, workspaceId, projectId),
        body,
        idempotencyKey(key),
        match === undefined ? undefined : etag(match),
      );
    });
  }
  @Post(":projectId/qa/context")
  @UseGuards(QaSessionGuard)
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  publishQaContext(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
    @Req() request?: QaSessionRequest,
    @Headers("if-match") match?: string,
  ) {
    return safeResult(() => {
      if (!request) return reject("VERIFIED_REQUEST_REQUIRED", 403);
      return this.resources.publishContext(
        onboardingRequest(this.bindingSource, request, workspaceId, projectId),
        body,
        idempotencyKey(key),
        match === undefined ? undefined : etag(match),
      );
    });
  }
  @Post(":projectId/qa/resources/:resourceKind")
  @UseGuards(QaSessionGuard)
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  publishQaResource(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("resourceKind") kind: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
    @Req() request?: QaSessionRequest,
    @Headers("if-match") match?: string,
  ) {
    return safeResult(() => {
      if (!request) return reject("VERIFIED_REQUEST_REQUIRED", 403);
      return this.resources.publishResource(
        onboardingRequest(this.bindingSource, request, workspaceId, projectId),
        kind,
        body,
        idempotencyKey(key),
        match === undefined ? undefined : etag(match),
      );
    });
  }
  @Post(":projectId/qa/account-leases")
  @UseGuards(QaSessionGuard)
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  acquireAccountLease(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
    @Req() request?: QaSessionRequest,
  ) {
    return safeResult(() => {
      if (!request) return reject("VERIFIED_REQUEST_REQUIRED", 403);
      return this.resources.acquireLease(
        onboardingRequest(this.bindingSource, request, workspaceId, projectId),
        body,
        idempotencyKey(key),
      );
    });
  }
  @Post(":projectId/qa/account-leases/:leaseId/release")
  @UseGuards(QaSessionGuard)
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  releaseAccountLease(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("leaseId") leaseId: string,
    @Headers("if-match") match: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
    @Req() request?: QaSessionRequest,
  ) {
    return safeResult(() => {
      if (!request) return reject("VERIFIED_REQUEST_REQUIRED", 403);
      return this.resources.releaseLease(
        onboardingRequest(this.bindingSource, request, workspaceId, projectId),
        uuid(leaseId),
        body,
        idempotencyKey(key),
        etag(match),
      );
    });
  }

  @Post(":projectId/bindings/:bindingId/validate")
  @UseGuards(QaSessionGuard)
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  validateBinding(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("bindingId") bindingId: string,
    @Headers("if-match") match: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
    @Req() request?: QaSessionRequest,
  ) {
    return safeResult(() => {
      if (!request) return reject("VERIFIED_REQUEST_REQUIRED", 403);
      return this.validation.validate(
        onboardingRequest(this.bindingSource, request, workspaceId, projectId),
        uuid(bindingId),
        body,
        idempotencyKey(key),
        etag(match),
      );
    });
  }
  @Post(":projectId/bindings/:bindingId/acceptances")
  @UseGuards(QaSessionGuard)
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  acceptBinding(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("bindingId") bindingId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
    @Req() request?: QaSessionRequest,
  ) {
    return safeResult(() => {
      if (!request) return reject("VERIFIED_REQUEST_REQUIRED", 403);
      return this.validation.accept(
        onboardingRequest(this.bindingSource, request, workspaceId, projectId),
        uuid(bindingId),
        body,
        idempotencyKey(key),
      );
    });
  }
  @Post(":projectId/onboarding/evaluations")
  @UseGuards(QaSessionGuard)
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  evaluate(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers("if-match") match: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
    @Req() request?: QaSessionRequest,
  ) {
    return safeResult(() => {
      if (!request) return reject("VERIFIED_REQUEST_REQUIRED", 403);
      return this.validation.evaluate(
        onboardingRequest(this.bindingSource, request, workspaceId, projectId),
        body,
        idempotencyKey(key),
        etag(match),
      );
    });
  }

  @Post(":projectId/bindings/:bindingId/:bindingAction")
  @UseGuards(QaSessionGuard)
  @HttpCode(202)
  @Header("Cache-Control", "private, no-store")
  applyBindingLifecycleAction(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("bindingId") bindingId: string,
    @Param("bindingAction") action: string,
    @Headers("if-match") match: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
    @Req() request?: QaSessionRequest,
  ) {
    return safeResult(() => {
      if (!request) return reject("VERIFIED_REQUEST_REQUIRED", 403);
      return this.bindings.apply(
        onboardingRequest(this.bindingSource, request, workspaceId, projectId),
        uuid(bindingId),
        bindingLifecycleAction(action),
        bindingApprovedCommand(body, match),
        idempotencyKey(key),
      );
    });
  }
  @Post(":projectId/onboarding/activate-pilot")
  @UseGuards(QaSessionGuard)
  @HttpCode(202)
  @Header("Cache-Control", "private, no-store")
  activatePilot(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers("if-match") match: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
    @Req() request?: QaSessionRequest,
  ) {
    return safeResult(() => {
      if (!request) return reject("VERIFIED_REQUEST_REQUIRED", 403);
      return this.bindings.activatePilot(
        onboardingRequest(this.bindingSource, request, workspaceId, projectId),
        bindingApprovedCommand(body, match),
        idempotencyKey(key),
      );
    });
  }
  @Post(":projectId/binding-candidates")
  @UseGuards(QaSessionGuard)
  @HttpCode(202)
  @Header("Cache-Control", "private, no-store")
  prepareBinding(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers("if-match") match: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
    @Req() request: QaSessionRequest,
  ) {
    return safeResult(() =>
      this.bindings.prepare(
        onboardingRequest(this.bindingSource, request, workspaceId, projectId),
        bindingCandidateCommand(body, match),
        idempotencyKey(key),
      ),
    );
  }
  @Post(":projectId/onboarding/pilot-candidates")
  @UseGuards(QaSessionGuard)
  @HttpCode(202)
  @Header("Cache-Control", "private, no-store")
  preparePilot(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers("if-match") match: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
    @Req() request: QaSessionRequest,
  ) {
    return safeResult(() => {
      const b = object(body, ["reason"]);
      return this.bindings.preparePilot(
        onboardingRequest(this.bindingSource, request, workspaceId, projectId),
        { expectedVersion: etag(match), reason: text(b.reason) },
        idempotencyKey(key),
      );
    });
  }
}
