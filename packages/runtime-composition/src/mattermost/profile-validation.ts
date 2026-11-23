import {
  type MattermostProfileCandidate,
  validateMattermostProfile,
} from "@awp/connector-mattermost";
import {
  type MattermostPilotMetadataPackage,
  validateMattermostPilotMetadataPackage,
} from "@awp/platform-contracts";

import type { RuntimeEnvironment } from "../config/environment.ts";
import {
  createSafeCapabilityProbe,
  type SafeCapabilityProbeInput,
} from "../onboarding/capability-probes.ts";

export interface MattermostProfileValidationRequest {
  readonly metadata: unknown;
  readonly profile: MattermostProfileCandidate;
  readonly activeAliases?: readonly MattermostProfileCandidate[];
}

export function createMattermostCapabilityProbe(
  input: Omit<SafeCapabilityProbeInput, "status" | "safeIssueCodes"> &
    Readonly<{
      health: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE";
      safeIssueCodes?: readonly string[];
    }>,
) {
  const { health, safeIssueCodes = [], ...probe } = input;
  return createSafeCapabilityProbe({
    ...probe,
    status: health,
    safeIssueCodes: health === "AVAILABLE" ? [] : safeIssueCodes,
  });
}

export class ComposedMattermostProfileValidator {
  constructor(private readonly environment: Pick<RuntimeEnvironment, "environmentScope">) {}

  validate(request: MattermostProfileValidationRequest) {
    if (this.environment.environmentScope === "PLATFORM_PROD")
      throw new Error("MATTERMOST_PRODUCTION_FORBIDDEN");
    const metadata = validateMattermostPilotMetadataPackage(
      request.metadata,
    ) as MattermostPilotMetadataPackage;
    return validateMattermostProfile({
      metadata,
      profile: request.profile,
      ...(request.activeAliases ? { activeAliases: request.activeAliases } : {}),
    });
  }
}
