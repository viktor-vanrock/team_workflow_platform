import { describe, expect, it } from "vitest";

import {
  type DependencyProbe,
  ReadinessService,
} from "../../../packages/platform-runtime-nest/src/health/readiness.service.ts";

describe("Feature 010 readiness contract", () => {
  it("reports only v1 dependencies", async () => {
    const probes: readonly DependencyProbe[] = [
      { key: "db", check: async () => ({ state: "UP" }) },
      { key: "schema", check: async () => ({ state: "UP" }) },
      { key: "extensions", check: async () => ({ state: "UP" }) },
      { key: "mockHub", check: async () => ({ state: "UP" }) },
    ];
    const report = await new ReadinessService("local", probes).readiness();
    expect(report.status).toBe("UP");
    expect(Object.keys(report.dependencies).sort()).toEqual([
      "db",
      "extensions",
      "mockHub",
      "schema",
    ]);
  });
});
