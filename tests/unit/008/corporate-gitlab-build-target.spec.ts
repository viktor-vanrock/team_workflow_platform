import { describe, expect, it } from "vitest";
import {
  assertCorporateGitLabBuildMapping,
  assertCorporateGitLabBuildRef,
} from "../../../packages/runtime-composition/src/gitlab/corporate-build-target.ts";

describe("corporate GitLab build reference", () => {
  it.each([undefined, "", "  ", "build\nname", "a".repeat(513)])(
    "rejects a missing or invalid reference",
    (buildRef) => {
      expect(() => assertCorporateGitLabBuildRef({ buildRef })).toThrow(
        "CORPORATE_GITLAB_BUILD_REF_REQUIRED",
      );
    },
  );
  it("accepts a bounded reference", () => {
    expect(() => assertCorporateGitLabBuildRef({ buildRef: "pipeline:101" })).not.toThrow();
  });
  it("requires the published profile to pass the exact selected build to CI", () => {
    const input = {
      target: { buildRef: "pipeline:101" },
      acceptedParameters: { BUILD_REF: "pipeline:101" },
      mappings: [{ logicalField: "BUILD_REF", source: "SUITE_PARAMETER", inputType: "STRING" }],
    };
    expect(() => assertCorporateGitLabBuildMapping(input)).not.toThrow();
    expect(() =>
      assertCorporateGitLabBuildMapping({
        ...input,
        acceptedParameters: { BUILD_REF: "pipeline:102" },
      }),
    ).toThrow("CORPORATE_GITLAB_BUILD_REF_MAPPING_REQUIRED");
    expect(() => assertCorporateGitLabBuildMapping({ ...input, mappings: [] })).toThrow(
      "CORPORATE_GITLAB_BUILD_REF_MAPPING_REQUIRED",
    );
  });
});
