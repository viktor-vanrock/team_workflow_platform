import { describe, expect, it } from "vitest";

import {
  feature007MetricDefinitions,
  Feature007ObservabilityFixture,
} from "../../support/007-observability-fixture.ts";

describe("Feature 007 observability and authorized-read performance", () => {
  it("publishes one bounded low-cardinality metric family per operational concern", () => {
    const fixture = new Feature007ObservabilityFixture();
    const labelValues = [
      { stage: "SHADOW", outcome: "PASS" },
      { connector: "JIRA", outcome: "PASS" },
      { mode: "FULL_QA", outcome: "PASS" },
      { state: "ACTIVE", outcome: "PASS" },
      { status: "VALID", outcome: "PASS" },
      { state: "EXPIRED", outcome: "PASS" },
    ];
    feature007MetricDefinitions.forEach(({ name }, index) => {
      fixture.record(name, labelValues[index]!);
    });
    expect(fixture.samples).toHaveLength(6);
    expect(() =>
      fixture.record(feature007MetricDefinitions[0].name, {
        stage: "SHADOW",
        outcome: "PASS",
        projectId: "00000000-0000-4000-8000-000000000001",
      }),
    ).toThrow("FEATURE_007_METRIC_LABEL_SET_INVALID");
  });

  it.each([1, 10, 1_000])(
    "uses three queries and zero provider/model reads for %i authorized Projects",
    async (projectCount) => {
      const fixture = new Feature007ObservabilityFixture();
      const values = await fixture.authorizedProjectRead(async () =>
        Array.from({ length: projectCount }, (_, index) => `project-${index}`),
      );
      expect(values).toHaveLength(projectCount);
      expect(fixture).toMatchObject({ queryCount: 3, providerReads: 0, modelReads: 0 });
    },
  );
});
