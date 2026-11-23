import { Body, Controller, Inject, Param, Post } from "@nestjs/common";

import { RequirePermission, ResourceClassification } from "@awp/platform-runtime-nest";

export const MATTERMOST_ADMINISTRATION = Symbol("MATTERMOST_ADMINISTRATION");

export interface MattermostAdministrationPort {
  discover(input: Readonly<{ connectionId: string; connectionVersion: number }>): Promise<unknown>;
  validate(
    input: Readonly<{ profileId: string; profileVersion: number; candidate?: unknown }>,
  ): Promise<unknown>;
  preview(
    input: Readonly<{
      profileId: string;
      profileVersion: number;
      template: string;
      variables: Readonly<Record<string, unknown>>;
    }>,
  ): Promise<unknown>;
  dryRun(
    input: Readonly<{ profileId: string; profileVersion: number; targetPurpose: string }>,
  ): Promise<unknown>;
}

const version = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error("MATTERMOST_ADMIN_VERSION_INVALID");
  return parsed;
};

@Controller("api/v1/integrations/mattermost")
@ResourceClassification("INTERNAL")
export class MattermostIntegrationController {
  constructor(
    @Inject(MATTERMOST_ADMINISTRATION)
    private readonly administration: MattermostAdministrationPort,
  ) {}

  @Post("connections/:connectionId/versions/:connectionVersion/discover")
  @RequirePermission("integration.connection.validate")
  discover(
    @Param("connectionId") connectionId: string,
    @Param("connectionVersion") connectionVersion: string,
  ) {
    return this.administration.discover({
      connectionId,
      connectionVersion: version(connectionVersion),
    });
  }

  @Post("profiles/:profileId/versions/:profileVersion/validate")
  @RequirePermission("integration.profile.validate")
  validate(
    @Param("profileId") profileId: string,
    @Param("profileVersion") profileVersion: string,
    @Body() candidate: unknown,
  ) {
    return this.administration.validate({
      profileId,
      profileVersion: version(profileVersion),
      candidate,
    });
  }

  @Post("profiles/:profileId/versions/:profileVersion/preview")
  @RequirePermission("integration.profile.read")
  preview(
    @Param("profileId") profileId: string,
    @Param("profileVersion") profileVersion: string,
    @Body() body: Readonly<{ template: string; variables?: Readonly<Record<string, unknown>> }>,
  ) {
    return this.administration.preview({
      profileId,
      profileVersion: version(profileVersion),
      template: body.template,
      variables: body.variables ?? {},
    });
  }

  @Post("profiles/:profileId/versions/:profileVersion/dry-run")
  @RequirePermission("integration.profile.validate")
  dryRun(
    @Param("profileId") profileId: string,
    @Param("profileVersion") profileVersion: string,
    @Body() body: Readonly<{ targetPurpose?: string }>,
  ) {
    return this.administration.dryRun({
      profileId,
      profileVersion: version(profileVersion),
      targetPurpose: body.targetPurpose ?? "QA_UPDATES",
    });
  }
}
