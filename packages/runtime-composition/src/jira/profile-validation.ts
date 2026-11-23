import {
  compileJiraMapping,
  JiraConfigurationLifecycle,
  type JiraMappingProgram,
} from "@awp/connector-jira";

import {
  createSafeCapabilityProbe,
  type SafeCapabilityProbeInput,
} from "../onboarding/capability-probes.ts";

export function profileAvailability(
  profiles: readonly Readonly<{ profileId: string; status: "VALID" | "DRIFTED" | "INVALID" }>[],
  profileId: string,
): "AVAILABLE" | "QUARANTINED" | "MISSING" {
  const profile = profiles.find((value) => value.profileId === profileId);
  return !profile ? "MISSING" : profile.status === "VALID" ? "AVAILABLE" : "QUARANTINED";
}
export interface ProfileValidationInput {
  readonly profileId: string;
  readonly outputFields: readonly string[];
  readonly allowedSourcePaths: readonly string[];
  readonly mapping: Readonly<{
    outputFieldAllowlist: readonly string[];
    limits: JiraMappingProgram["limits"];
    expression: unknown;
    lookupTables: JiraMappingProgram["lookupTables"];
  }>;
}
export class JiraProfileValidationService {
  readonly lifecycle = new JiraConfigurationLifecycle();
  validateMapping(
    input: ProfileValidationInput,
  ): Readonly<{ status: "VALID"; program: JiraMappingProgram }> {
    const program = compileJiraMapping(input.mapping, input.allowedSourcePaths);
    if (program.outputFieldAllowlist.some((field) => !input.outputFields.includes(field)))
      throw new Error("JIRA_PROFILE_FIELD_NOT_DISCOVERED");
    return Object.freeze({ status: "VALID", program });
  }
  quarantineDrift(profileId: string, reasonCode: string) {
    return this.lifecycle.markDrift(profileId, reasonCode);
  }
}

export function createJiraCapabilityProbe(
  input: Omit<SafeCapabilityProbeInput, "status" | "safeIssueCodes"> &
    Readonly<{ available: boolean; safeIssueCodes?: readonly string[] }>,
) {
  const { available, safeIssueCodes = [], ...probe } = input;
  return createSafeCapabilityProbe({
    ...probe,
    status: available ? "AVAILABLE" : "UNAVAILABLE",
    safeIssueCodes: available ? [] : safeIssueCodes,
  });
}
