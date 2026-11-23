import { Readable } from "node:stream";

import {
  Controller,
  Get,
  Inject,
  Param,
  Req,
  Res,
  StreamableFile,
  UseFilters,
  UseGuards,
} from "@nestjs/common";

import type { ArtifactContentStream, ArtifactMetadata } from "@awp/platform-core";

import { PublishedOnboardingProblemFilter } from "./onboarding/published-http.ts";
import { QaSessionGuard } from "./qa-api-authorization.ts";

export const QA_ARTIFACT_HTTP_API = Symbol("QA_ARTIFACT_HTTP_API");
export interface QaArtifactHttpApi {
  metadata(request: object, artifactId: string): Promise<ArtifactMetadata>;
  content(request: object, artifactId: string): Promise<ArtifactContentStream>;
}
type ResponseHeaders = Readonly<{ setHeader(name: string, value: string): void }>;

@Controller(["artifacts", "api/v1/workspaces/:workspaceId/projects/:projectId/artifacts"])
@UseGuards(QaSessionGuard)
@UseFilters(PublishedOnboardingProblemFilter)
export class QaArtifactsController {
  constructor(@Inject(QA_ARTIFACT_HTTP_API) private readonly api: QaArtifactHttpApi) {}
  @Get(":id")
  async metadata(
    @Req() request: object,
    @Param("id") id: string,
    @Res({ passthrough: true }) response: ResponseHeaders,
  ) {
    response.setHeader("Cache-Control", "private, no-store");
    return this.api.metadata(request, id);
  }
  @Get(":id/content")
  async content(
    @Req() request: object,
    @Param("id") id: string,
    @Res({ passthrough: true }) response: ResponseHeaders,
  ) {
    response.setHeader("Cache-Control", "private, no-store");
    const content = await this.api.content(request, id);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Content-SHA256", content.checksum.value);
    return new StreamableFile(Readable.from(content.body), {
      type: content.mediaType,
      length: content.sizeBytes,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(content.fileName)}`,
    });
  }
}
