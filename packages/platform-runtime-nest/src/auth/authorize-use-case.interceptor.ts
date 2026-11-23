import {
  type CallHandler,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  type NestInterceptor,
  Optional,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Observable } from "rxjs";

import type {
  AuthorizationDecision,
  ClassificationReference,
  WorkspaceContext,
} from "@awp/platform-core";

import {
  AuthorizationContributionRegistry,
  ResourceClassificationResolver,
} from "./authorization-contributions.ts";
import { WorkspaceContextStore } from "./workspace-context.ts";

export const REQUIRED_PERMISSION = Symbol("awp.required-permission");
export const RequirePermission = (permission: string) =>
  SetMetadata(REQUIRED_PERMISSION, permission);
export const RESOURCE_CLASSIFICATION = Symbol("awp.resource-classification");
export const ResourceClassification = (
  classificationKey: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED",
) => SetMetadata(RESOURCE_CLASSIFICATION, classificationKey);

export interface LiveAuthorizationService {
  authorize(
    context: WorkspaceContext,
    permission: string,
    classification: ClassificationReference,
  ): Promise<AuthorizationDecision>;
}

@Injectable()
export class AuthorizeUseCaseInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly contexts: WorkspaceContextStore,
    private readonly authorization: LiveAuthorizationService,
    @Optional()
    private readonly contributions: AuthorizationContributionRegistry = new AuthorizationContributionRegistry(),
    @Optional()
    private readonly classifications: ResourceClassificationResolver = new ResourceClassificationResolver(),
  ) {}
  async intercept(
    executionContext: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const permission = this.reflector.getAllAndOverride<string | undefined>(REQUIRED_PERMISSION, [
      executionContext.getHandler(),
      executionContext.getClass(),
    ]);
    if (!permission) throw new ForbiddenException("Endpoint has no explicit permission metadata");
    const context = this.contexts.current();
    const declaredKey = this.reflector.getAllAndOverride<string | undefined>(
      RESOURCE_CLASSIFICATION,
      [executionContext.getHandler(), executionContext.getClass()],
    );
    const operation = `${executionContext.getClass().name}.${executionContext.getHandler().name}`;
    const resourceClassification = await this.classifications.resolve({
      permission,
      operation,
      ...(declaredKey ? { declaredKey } : {}),
      resource: executionContext.switchToHttp().getRequest<unknown>(),
    });
    const decision = await this.authorization.authorize(
      context,
      permission,
      resourceClassification,
    );
    if (!decision.allowed) throw new ForbiddenException({ reason: decision.reason });
    const contributionDecision = await this.contributions.authorize({
      context,
      permission,
      resourceClassification,
      operation,
    });
    if (!contributionDecision.allowed)
      throw new ForbiddenException({ reason: contributionDecision.reason });
    return next.handle();
  }
}
