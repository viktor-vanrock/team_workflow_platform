import { Body, Get, HttpException, Param, Put, Query, Req } from "@nestjs/common";

import type { PlatformAccessContext, PlatformAccessPermission } from "@awp/platform-core";
import { type CorporateSessionRequest } from "@awp/platform-runtime-nest";
import { PlatformAccessService, type ReplaceWorkspaceAccess } from "@awp/runtime-composition";

import { AccessHttpError } from "./access-problem.filter.ts";

interface AccessAuthority {
  principal(request: CorporateSessionRequest): Promise<string>;
  authorize(
    request: CorporateSessionRequest,
    permission: PlatformAccessPermission,
    mutate: boolean,
  ): Promise<PlatformAccessContext>;
}
async function response<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof HttpException) throw error;
    const code = error instanceof Error ? error.message : "ACCESS_FAILED";
    const status = code.includes("CONFLICT")
      ? 409
      : code.includes("NOT_FOUND")
        ? 404
        : code.includes("INVALID")
          ? 400
          : code.includes("DENIED") || code.includes("STEP_UP") || code.includes("NOT_AVAILABLE")
            ? 403
            : 500;
    throw new AccessHttpError(code, status);
  }
}
export class AccessController {
  constructor(
    private readonly access: PlatformAccessService,
    private readonly authority: AccessAuthority,
  ) {}
  @Get("me") me(@Req() request: CorporateSessionRequest) {
    return response(async () => {
      const principalId = await this.authority.principal(request);
      let administrator = false;
      try {
        await this.authority.authorize(request, "platform.users.read", false);
        administrator = true;
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("DENIED")) throw error;
      }
      return this.access.own(principalId, administrator);
    });
  }
  @Get("users") users(
    @Req() request: CorporateSessionRequest,
    @Query("q") query?: string,
    @Query("offset") offset?: string,
  ) {
    return response(async () =>
      this.access.users(
        await this.authority.authorize(request, "platform.users.read", false),
        query ?? "",
        offset === undefined ? 0 : Number(offset),
      ),
    );
  }
  @Get("workspaces") workspaces(@Req() request: CorporateSessionRequest) {
    return response(async () =>
      this.access.workspaces(await this.authority.authorize(request, "platform.users.read", false)),
    );
  }
  @Get("users/:principalId") detail(
    @Req() request: CorporateSessionRequest,
    @Param("principalId") principalId: string,
  ) {
    return response(async () =>
      this.access.detail(
        await this.authority.authorize(request, "platform.users.read", false),
        principalId,
      ),
    );
  }
  @Put("users/:principalId/workspaces/:workspaceId") replace(
    @Req() request: CorporateSessionRequest,
    @Param("principalId") principalId: string,
    @Param("workspaceId") workspaceId: string,
    @Body() body: ReplaceWorkspaceAccess,
  ) {
    return response(async () =>
      this.access.replace(
        await this.authority.authorize(request, "platform.workspace-roles.manage", true),
        principalId,
        workspaceId,
        body,
      ),
    );
  }
}
