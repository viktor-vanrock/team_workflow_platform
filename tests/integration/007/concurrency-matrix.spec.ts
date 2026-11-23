import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const scenarios = Object.freeze([
  ["binding-publish-retire-rollback", "tests/integration/007/us2-binding-concurrency.spec.ts"],
  ["workspace-rollout-lease", "tests/integration/007/us2-pilot-activation.spec.ts"],
  ["entitlement-revocation", "tests/integration/007/us3-entitlement-revocation-race.spec.ts"],
  ["account-lease", "tests/integration/007/us1-account-leases.spec.ts"],
  ["evidence-correction-signing", "tests/integration/007/us4-evidence-concurrency.spec.ts"],
  ["suspend-effect-session-lease", "tests/integration/007/us5-operational-concurrency.spec.ts"],
] as const);

describe("Feature 007 aggregate concurrency matrix", () => {
  it("binds every administrative/effect race to an executable test", () => {
    expect(new Set(scenarios.map(([name]) => name)).size).toBe(6);
    for (const [name, file] of scenarios) {
      const source = readFileSync(resolve(root, file), "utf8");
      expect(source, name).toMatch(/\b(?:it|test)\s*\(/u);
      expect(source, name).not.toMatch(/\.skip\s*\(/u);
    }
  });

  it("keeps one fixed administrative lock order documented in the repository", () => {
    const source = readFileSync(
      resolve(root, "packages/platform-persistence-typeorm/src/project-onboarding.repository.ts"),
      "utf8",
    );
    expect(source).toContain(
      "Workspace rollout domain -> Project onboarding -> Binding -> action/Approval rows",
    );
    expect(source).toContain("pg_advisory_xact_lock");
  });
});
