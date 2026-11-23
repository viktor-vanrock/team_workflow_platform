import { Body, Controller, Get, Headers, Param, Post } from "@nestjs/common";

import type { WorkspaceContext } from "@awp/platform-core";

import { RequirePermission } from "../auth/authorize-use-case.interceptor.ts";
import {
  assertNoAuthoritativeClientFields,
  TargetPrincipalCommand,
  WorkspaceContextStore,
} from "../auth/workspace-context.ts";

export abstract class ProjectOnboardingApplication {
  abstract catalog(context: WorkspaceContext, workspaceId: string): Promise<unknown>;
  abstract register(
    context: WorkspaceContext,
    workspaceId: string,
    input: unknown,
    idempotencyKey: string,
  ): Promise<unknown>;
  abstract onboarding(
    context: WorkspaceContext,
    workspaceId: string,
    projectId: string,
  ): Promise<unknown>;
  abstract evaluate(
    context: WorkspaceContext,
    workspaceId: string,
    projectId: string,
    input: unknown,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<unknown>;
  abstract activatePilot(
    context: WorkspaceContext,
    workspaceId: string,
    projectId: string,
    input: unknown,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<unknown>;
  abstract changeEntitlement(
    context: WorkspaceContext,
    workspaceId: string,
    projectId: string,
    entitlementId: string | undefined,
    input: unknown,
    expectedVersion: number | undefined,
    idempotencyKey: string,
  ): Promise<unknown>;
  abstract validateBinding(
    context: WorkspaceContext,
    workspaceId: string,
    projectId: string,
    bindingId: string,
    input: unknown,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<unknown>;
  abstract acceptBinding(
    context: WorkspaceContext,
    workspaceId: string,
    projectId: string,
    bindingId: string,
    input: unknown,
    idempotencyKey: string,
  ): Promise<unknown>;
  abstract applyBindingAction(
    context: WorkspaceContext,
    workspaceId: string,
    projectId: string,
    bindingId: string,
    action: string,
    input: unknown,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<unknown>;
  abstract publishQaEnvironment(
    context: WorkspaceContext,
    workspaceId: string,
    projectId: string,
    input: unknown,
    idempotencyKey: string,
  ): Promise<unknown>;
  abstract publishQaContext(
    context: WorkspaceContext,
    workspaceId: string,
    projectId: string,
    input: unknown,
    idempotencyKey: string,
  ): Promise<unknown>;
  abstract publishQaResource(
    context: WorkspaceContext,
    workspaceId: string,
    projectId: string,
    resourceKind: string,
    input: unknown,
    idempotencyKey: string,
  ): Promise<unknown>;
  abstract acquireAccountLease(
    context: WorkspaceContext,
    workspaceId: string,
    projectId: string,
    input: unknown,
    idempotencyKey: string,
  ): Promise<unknown>;
  abstract releaseAccountLease(
    context: WorkspaceContext,
    workspaceId: string,
    projectId: string,
    leaseId: string,
    input: unknown,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<unknown>;
}

function requiredHeader(value: string | undefined, code: string): string {
  if (!value?.trim()) throw new Error(code);
  return value.trim();
}

function ifMatch(value: string | undefined): number {
  const header = requiredHeader(value, "IF_MATCH_REQUIRED");
  const match = /^(?:W\/)?"?(\d+)"?$/u.exec(header);
  if (!match) throw new Error("IF_MATCH_INVALID");
  return Number(match[1]);
}

@Controller("v1/workspaces/:workspaceId/projects")
export class ProjectOnboardingController {
  constructor(
    private readonly application: ProjectOnboardingApplication,
    private readonly contexts: WorkspaceContextStore,
  ) {}

  @Get()
  @RequirePermission("project.catalog.read")
  catalog(@Param("workspaceId") workspaceId: string) {
    return this.application.catalog(this.contexts.current(), workspaceId);
  }

  @Post()
  @RequirePermission("project.register")
  register(
    @Param("workspaceId") workspaceId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
  ) {
    assertNoAuthoritativeClientFields(body);
    return this.application.register(
      this.contexts.current(),
      workspaceId,
      body,
      requiredHeader(key, "IDEMPOTENCY_KEY_REQUIRED"),
    );
  }

  @Get(":projectId/onboarding")
  @RequirePermission("project.onboarding.read")
  onboarding(@Param("workspaceId") workspaceId: string, @Param("projectId") projectId: string) {
    return this.application.onboarding(this.contexts.current(), workspaceId, projectId);
  }

  @Post(":projectId/onboarding/evaluations")
  @RequirePermission("project.onboarding.evaluate")
  evaluate(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers("if-match") etag: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
  ) {
    assertNoAuthoritativeClientFields(body);
    return this.application.evaluate(
      this.contexts.current(),
      workspaceId,
      projectId,
      body,
      ifMatch(etag),
      requiredHeader(key, "IDEMPOTENCY_KEY_REQUIRED"),
    );
  }

  @Post(":projectId/onboarding/activate-pilot")
  @RequirePermission("project.onboarding.activate")
  activatePilot(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers("if-match") etag: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
  ) {
    assertNoAuthoritativeClientFields(body);
    return this.application.activatePilot(
      this.contexts.current(),
      workspaceId,
      projectId,
      body,
      ifMatch(etag),
      requiredHeader(key, "IDEMPOTENCY_KEY_REQUIRED"),
    );
  }

  @Post(":projectId/entitlements")
  @TargetPrincipalCommand()
  @RequirePermission("project.entitlement.grant")
  grantEntitlement(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
  ) {
    assertNoAuthoritativeClientFields(
      body,
      Object.getOwnPropertyDescriptor(ProjectOnboardingController.prototype, "grantEntitlement")
        ?.value as object | undefined,
    );
    return this.application.changeEntitlement(
      this.contexts.current(),
      workspaceId,
      projectId,
      undefined,
      body,
      undefined,
      requiredHeader(key, "IDEMPOTENCY_KEY_REQUIRED"),
    );
  }

  @Post(":projectId/entitlements/:entitlementId/revoke")
  @RequirePermission("project.entitlement.revoke")
  revokeEntitlement(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("entitlementId") entitlementId: string,
    @Headers("if-match") etag: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
  ) {
    assertNoAuthoritativeClientFields(body);
    return this.application.changeEntitlement(
      this.contexts.current(),
      workspaceId,
      projectId,
      entitlementId,
      body,
      ifMatch(etag),
      requiredHeader(key, "IDEMPOTENCY_KEY_REQUIRED"),
    );
  }

  @Post(":projectId/bindings/:bindingId/validate")
  @RequirePermission("integration.validate")
  validateBinding(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("bindingId") bindingId: string,
    @Headers("if-match") etag: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
  ) {
    assertNoAuthoritativeClientFields(body);
    return this.application.validateBinding(
      this.contexts.current(),
      workspaceId,
      projectId,
      bindingId,
      body,
      ifMatch(etag),
      requiredHeader(key, "IDEMPOTENCY_KEY_REQUIRED"),
    );
  }

  @Post(":projectId/bindings/:bindingId/acceptances")
  @RequirePermission("integration.accept")
  acceptBinding(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("bindingId") bindingId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
  ) {
    assertNoAuthoritativeClientFields(body);
    return this.application.acceptBinding(
      this.contexts.current(),
      workspaceId,
      projectId,
      bindingId,
      body,
      requiredHeader(key, "IDEMPOTENCY_KEY_REQUIRED"),
    );
  }

  @Post(":projectId/bindings/:bindingId/:bindingAction")
  @RequirePermission("integration.publish")
  applyBindingLifecycleAction(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("bindingId") bindingId: string,
    @Param("bindingAction") action: string,
    @Headers("if-match") etag: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
  ) {
    assertNoAuthoritativeClientFields(body);
    return this.application.applyBindingAction(
      this.contexts.current(),
      workspaceId,
      projectId,
      bindingId,
      action,
      body,
      ifMatch(etag),
      requiredHeader(key, "IDEMPOTENCY_KEY_REQUIRED"),
    );
  }

  @Post(":projectId/qa/environments")
  @RequirePermission("qa.environment.publish")
  publishQaEnvironment(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
  ) {
    assertNoAuthoritativeClientFields(body);
    return this.application.publishQaEnvironment(
      this.contexts.current(),
      workspaceId,
      projectId,
      body,
      requiredHeader(key, "IDEMPOTENCY_KEY_REQUIRED"),
    );
  }

  @Post(":projectId/qa/context")
  @RequirePermission("qa.context.publish")
  publishQaContext(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
  ) {
    assertNoAuthoritativeClientFields(body);
    return this.application.publishQaContext(
      this.contexts.current(),
      workspaceId,
      projectId,
      body,
      requiredHeader(key, "IDEMPOTENCY_KEY_REQUIRED"),
    );
  }

  @Post(":projectId/qa/resources/:resourceKind")
  @RequirePermission("qa.resource.publish")
  publishQaResource(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("resourceKind") resourceKind: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
  ) {
    assertNoAuthoritativeClientFields(body);
    return this.application.publishQaResource(
      this.contexts.current(),
      workspaceId,
      projectId,
      resourceKind,
      body,
      requiredHeader(key, "IDEMPOTENCY_KEY_REQUIRED"),
    );
  }

  @Post(":projectId/qa/account-leases")
  @RequirePermission("qa.account-lease.acquire")
  acquireAccountLease(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
  ) {
    assertNoAuthoritativeClientFields(body);
    return this.application.acquireAccountLease(
      this.contexts.current(),
      workspaceId,
      projectId,
      body,
      requiredHeader(key, "IDEMPOTENCY_KEY_REQUIRED"),
    );
  }

  @Post(":projectId/qa/account-leases/:leaseId/release")
  @RequirePermission("qa.account-lease.release")
  releaseAccountLease(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("leaseId") leaseId: string,
    @Headers("if-match") etag: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
  ) {
    assertNoAuthoritativeClientFields(body);
    return this.application.releaseAccountLease(
      this.contexts.current(),
      workspaceId,
      projectId,
      leaseId,
      body,
      ifMatch(etag),
      requiredHeader(key, "IDEMPOTENCY_KEY_REQUIRED"),
    );
  }
}
