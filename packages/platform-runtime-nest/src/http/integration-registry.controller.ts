import { Body, Controller, Get, Headers, Param, Post } from "@nestjs/common";

import type {
  BindingContent,
  ConnectionContent,
  MappingContent,
  ProfileContent,
} from "@awp/platform-core";

import { RequirePermission } from "../auth/authorize-use-case.interceptor.ts";
import {
  assertNoAuthoritativeClientFields,
  WorkspaceContextStore,
} from "../auth/workspace-context.ts";

export abstract class IntegrationRegistryApplication {
  abstract createConnection(
    context: ReturnType<WorkspaceContextStore["current"]>,
    input: ConnectionContent,
  ): Promise<unknown>;
  abstract getConnection(
    context: ReturnType<WorkspaceContextStore["current"]>,
    id: string,
    version: number,
  ): Promise<unknown>;
  abstract validateConnection(
    context: ReturnType<WorkspaceContextStore["current"]>,
    id: string,
    version: number,
    etag: number,
  ): Promise<unknown>;
  abstract publishConnection(
    context: ReturnType<WorkspaceContextStore["current"]>,
    id: string,
    version: number,
    etag: number,
  ): Promise<unknown>;
  abstract createMapping(
    context: ReturnType<WorkspaceContextStore["current"]>,
    input: MappingContent,
  ): Promise<unknown>;
  abstract getMapping(
    context: ReturnType<WorkspaceContextStore["current"]>,
    id: string,
    version: number,
  ): Promise<unknown>;
  abstract validateMapping(
    context: ReturnType<WorkspaceContextStore["current"]>,
    id: string,
    version: number,
    etag: number,
  ): Promise<unknown>;
  abstract publishMapping(
    context: ReturnType<WorkspaceContextStore["current"]>,
    id: string,
    version: number,
    etag: number,
  ): Promise<unknown>;
  abstract createProfile(
    context: ReturnType<WorkspaceContextStore["current"]>,
    input: ProfileContent,
  ): Promise<unknown>;
  abstract getProfile(
    context: ReturnType<WorkspaceContextStore["current"]>,
    id: string,
    version: number,
  ): Promise<unknown>;
  abstract validateProfile(
    context: ReturnType<WorkspaceContextStore["current"]>,
    id: string,
    version: number,
    etag: number,
  ): Promise<unknown>;
  abstract publishProfile(
    context: ReturnType<WorkspaceContextStore["current"]>,
    id: string,
    version: number,
    etag: number,
  ): Promise<unknown>;
  abstract createBinding(
    context: ReturnType<WorkspaceContextStore["current"]>,
    input: BindingContent,
  ): Promise<unknown>;
  abstract getBinding(
    context: ReturnType<WorkspaceContextStore["current"]>,
    id: string,
    version: number,
  ): Promise<unknown>;
  abstract validateBinding(
    context: ReturnType<WorkspaceContextStore["current"]>,
    id: string,
    version: number,
    etag: number,
  ): Promise<unknown>;
  abstract connectionHealth(
    context: ReturnType<WorkspaceContextStore["current"]>,
    id: string,
  ): Promise<unknown>;
  abstract validationReport(
    context: ReturnType<WorkspaceContextStore["current"]>,
    id: string,
  ): Promise<unknown>;
  abstract capabilityAvailability(
    context: ReturnType<WorkspaceContextStore["current"]>,
    bindingId: string,
    version: number,
  ): Promise<unknown>;
}

function version(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("INVALID_VERSION");
  return parsed;
}
function ifMatch(value: string | undefined): number {
  if (!value) throw new Error("IF_MATCH_REQUIRED");
  const match = /^(?:W\/)?"?(\d+)"?$/u.exec(value.trim());
  if (!match) throw new Error("IF_MATCH_INVALID");
  return Number(match[1]);
}

@Controller("integration-registry")
export class IntegrationRegistryController {
  constructor(
    private readonly application: IntegrationRegistryApplication,
    private readonly contexts: WorkspaceContextStore,
  ) {}
  @Post("connections") @RequirePermission("integration.connection.write") createConnection(
    @Body() body: ConnectionContent,
  ) {
    assertNoAuthoritativeClientFields(body);
    return this.application.createConnection(this.contexts.current(), body);
  }
  @Get("connections/:id/versions/:version")
  @RequirePermission("integration.connection.read")
  getConnection(@Param("id") id: string, @Param("version") value: string) {
    return this.application.getConnection(this.contexts.current(), id, version(value));
  }
  @Post("connections/:id/versions/:version/validate")
  @RequirePermission("integration.connection.validate")
  validateConnection(
    @Param("id") id: string,
    @Param("version") value: string,
    @Headers("if-match") etag?: string,
  ) {
    return this.application.validateConnection(
      this.contexts.current(),
      id,
      version(value),
      ifMatch(etag),
    );
  }
  @Post("connections/:id/versions/:version/publish")
  @RequirePermission("integration.connection.publish")
  publishConnection(
    @Param("id") id: string,
    @Param("version") value: string,
    @Headers("if-match") etag?: string,
  ) {
    return this.application.publishConnection(
      this.contexts.current(),
      id,
      version(value),
      ifMatch(etag),
    );
  }
  @Get("connections/:id/health") @RequirePermission("integration.connection.read") health(
    @Param("id") id: string,
  ) {
    return this.application.connectionHealth(this.contexts.current(), id);
  }

  @Post("mappings") @RequirePermission("integration.mapping.write") createMapping(
    @Body() body: MappingContent,
  ) {
    assertNoAuthoritativeClientFields(body);
    return this.application.createMapping(this.contexts.current(), body);
  }
  @Get("mappings/:id/versions/:version") @RequirePermission("integration.mapping.read") getMapping(
    @Param("id") id: string,
    @Param("version") value: string,
  ) {
    return this.application.getMapping(this.contexts.current(), id, version(value));
  }
  @Post("mappings/:id/versions/:version/validate")
  @RequirePermission("integration.mapping.validate")
  validateMapping(
    @Param("id") id: string,
    @Param("version") value: string,
    @Headers("if-match") etag?: string,
  ) {
    return this.application.validateMapping(
      this.contexts.current(),
      id,
      version(value),
      ifMatch(etag),
    );
  }
  @Post("mappings/:id/versions/:version/publish")
  @RequirePermission("integration.mapping.publish")
  publishMapping(
    @Param("id") id: string,
    @Param("version") value: string,
    @Headers("if-match") etag?: string,
  ) {
    return this.application.publishMapping(
      this.contexts.current(),
      id,
      version(value),
      ifMatch(etag),
    );
  }

  @Post("profiles") @RequirePermission("integration.profile.write") createProfile(
    @Body() body: ProfileContent,
  ) {
    assertNoAuthoritativeClientFields(body);
    return this.application.createProfile(this.contexts.current(), body);
  }
  @Get("profiles/:id/versions/:version") @RequirePermission("integration.profile.read") getProfile(
    @Param("id") id: string,
    @Param("version") value: string,
  ) {
    return this.application.getProfile(this.contexts.current(), id, version(value));
  }
  @Post("profiles/:id/versions/:version/validate")
  @RequirePermission("integration.profile.validate")
  validateProfile(
    @Param("id") id: string,
    @Param("version") value: string,
    @Headers("if-match") etag?: string,
  ) {
    return this.application.validateProfile(
      this.contexts.current(),
      id,
      version(value),
      ifMatch(etag),
    );
  }
  @Post("profiles/:id/versions/:version/publish")
  @RequirePermission("integration.profile.publish")
  publishProfile(
    @Param("id") id: string,
    @Param("version") value: string,
    @Headers("if-match") etag?: string,
  ) {
    return this.application.publishProfile(
      this.contexts.current(),
      id,
      version(value),
      ifMatch(etag),
    );
  }

  @Post("bindings") @RequirePermission("integration.binding.write") createBinding(
    @Body() body: BindingContent,
  ) {
    assertNoAuthoritativeClientFields(body);
    return this.application.createBinding(this.contexts.current(), body);
  }
  @Get("bindings/:id/versions/:version") @RequirePermission("integration.binding.read") getBinding(
    @Param("id") id: string,
    @Param("version") value: string,
  ) {
    return this.application.getBinding(this.contexts.current(), id, version(value));
  }
  @Post("bindings/:id/versions/:version/validate")
  @RequirePermission("integration.binding.validate")
  validateBinding(
    @Param("id") id: string,
    @Param("version") value: string,
    @Headers("if-match") etag?: string,
  ) {
    return this.application.validateBinding(
      this.contexts.current(),
      id,
      version(value),
      ifMatch(etag),
    );
  }
  @Get("bindings/:id/versions/:version/availability")
  @RequirePermission("integration.binding.read")
  availability(@Param("id") id: string, @Param("version") value: string) {
    return this.application.capabilityAvailability(this.contexts.current(), id, version(value));
  }
  @Get("validation-reports/:id") @RequirePermission("integration.validation-report.read") report(
    @Param("id") id: string,
  ) {
    return this.application.validationReport(this.contexts.current(), id);
  }
}
