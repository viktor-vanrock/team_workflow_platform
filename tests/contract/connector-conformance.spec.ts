import { describe, expect, it } from "vitest";

import {
  AlternateSampleRecordConnector,
  runSampleRecordConformance,
} from "../../packages/platform-testkit/src/index.ts";

describe("T075 reusable Connector conformance kit", () => {
  it("accepts a second sample.record implementation", async () => {
    expect(await runSampleRecordConformance(new AlternateSampleRecordConnector())).toEqual({
      stableResult: true,
      effectCount: 1,
    });
  });
});
