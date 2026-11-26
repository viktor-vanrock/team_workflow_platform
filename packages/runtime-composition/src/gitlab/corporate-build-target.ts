/** A corporate GitLab run must have an independent build reference to validate the result. */
export function assertCorporateGitLabBuildRef(target: Readonly<{ buildRef?: unknown }>): void {
  if (
    typeof target.buildRef !== "string" ||
    !target.buildRef.trim() ||
    target.buildRef.length > 512 ||
    /\p{Cc}/u.test(target.buildRef)
  )
    throw new Error("CORPORATE_GITLAB_BUILD_REF_REQUIRED");
}

/** The existing SUITE_PARAMETER mapping carries the pinned build to the CI job. */
export function assertCorporateGitLabBuildMapping(
  input: Readonly<{
    target: Readonly<{ buildRef?: unknown }>;
    acceptedParameters: Readonly<Record<string, unknown>>;
    mappings: readonly Readonly<{ logicalField: string; source: string; inputType: string }>[];
  }>,
): void {
  assertCorporateGitLabBuildRef(input.target);
  const mappings = input.mappings.filter((mapping) => mapping.logicalField === "BUILD_REF");
  if (
    mappings.length !== 1 ||
    mappings[0]!.source !== "SUITE_PARAMETER" ||
    mappings[0]!.inputType !== "STRING" ||
    input.acceptedParameters.BUILD_REF !== input.target.buildRef
  )
    throw new Error("CORPORATE_GITLAB_BUILD_REF_MAPPING_REQUIRED");
}
