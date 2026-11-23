import { Readable } from "node:stream";

import { Controller, Get, Optional, Param, Res, StreamableFile } from "@nestjs/common";

import {
  ArtifactAccessDeniedError,
  ArtifactAuthorizationContributionRegistry,
  type ArtifactAuthorizationOperation,
  type ArtifactMetadata,
  ArtifactService,
  type WorkspaceContext,
} from "@awp/platform-core";

import { RequirePermission } from "../auth/authorize-use-case.interceptor.ts";
import { WorkspaceContextStore } from "../auth/workspace-context.ts";

@Controller("artifacts")
export class ArtifactsController {
  constructor(
    private readonly artifacts: ArtifactService,
    private readonly contexts: WorkspaceContextStore,
    @Optional()
    private readonly authorizationContributions: ArtifactAuthorizationContributionRegistry = new ArtifactAuthorizationContributionRegistry(),
  ) {}

  @Get(":id")
  @RequirePermission("artifact.read")
  async getArtifactMetadata(@Param("id") id: string): Promise<ArtifactMetadata> {
    const context = this.contexts.current();
    const artifact = await this.artifacts.getArtifactMetadata(context, id);
    await this.#authorizeContribution(context, "READ_METADATA", artifact);
    return artifact;
  }

  @Get(":id/content")
  @RequirePermission("artifact.read")
  async streamArtifactContent(
    @Param("id") id: string,
    @Res({ passthrough: true })
    response: Readonly<{ setHeader(name: string, value: string): void }>,
  ): Promise<StreamableFile> {
    const context = this.contexts.current();
    const artifact = await this.artifacts.getArtifactMetadata(context, id);
    await this.#authorizeContribution(context, "STREAM_CONTENT", artifact);
    const content = await this.artifacts.streamArtifactContent(context, id);
    response.setHeader("X-Content-SHA256", content.checksum.value);
    return new StreamableFile(Readable.from(content.body), {
      type: content.mediaType,
      length: content.sizeBytes,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(content.fileName)}`,
    });
  }

  async #authorizeContribution(
    context: WorkspaceContext,
    operation: ArtifactAuthorizationOperation,
    artifact: ArtifactMetadata,
  ): Promise<void> {
    const decision = await this.authorizationContributions.authorize({
      context,
      permission: "artifact.read",
      operation,
      artifact,
    });
    if (!decision.allowed) throw new ArtifactAccessDeniedError(decision.reason);
  }
}
