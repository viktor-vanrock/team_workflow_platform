import { describe, expect, it } from "vitest";

import { classifyMattermostConnectionHealth } from "../../../packages/runtime-composition/src/index.ts";

describe("US4 connection health", () => {
  it.each([
    ["AUTHENTICATION_401", "DEGRADED"],
    ["PERMISSION_403", "DEGRADED"],
    ["SCHEMA_INVALID", "DEGRADED"],
    ["CHANNEL_MISSING", "DEGRADED"],
    ["SERVER_500", "UNAVAILABLE"],
    ["OK", "HEALTHY"],
  ] as const)("maps %s to %s", (code, state) =>
    expect(classifyMattermostConnectionHealth(code).state).toBe(state),
  );
  it("recovers only after an explicit healthy validation probe", () => {
    let current = classifyMattermostConnectionHealth("AUTHENTICATION_401");
    expect(current.state).toBe("DEGRADED");
    current = classifyMattermostConnectionHealth("OK");
    expect(current).toEqual({ state: "HEALTHY" });
  });
});
