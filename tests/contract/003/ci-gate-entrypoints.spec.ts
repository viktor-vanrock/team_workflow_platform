import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  FEATURE_003_NODE_VERSION,
  verifyFeature003NodeVersion,
} from "../../../tools/verification/feature-003-prerequisites.mts";

const workspace = resolve(import.meta.dirname, "../../..");

describe("Feature 003 aggregate gate entrypoints", () => {
  it("accepts only the exact configured and active Node.js 24.20.0 runtime", () => {
    expect(FEATURE_003_NODE_VERSION).toBe("24.20.0");
    expect(
      verifyFeature003NodeVersion({
        active: "24.20.0",
        configured: "24.20.0",
        engine: "24.20.0",
      }),
    ).toMatchObject({ status: "PASS", code: "NODE_VERSION_ACCEPTED" });

    for (const mismatch of [
      { active: "24.20.1", configured: "24.20.0", engine: "24.20.0" },
      { active: "24.20.0", configured: "24", engine: "24.20.0" },
      { active: "24.20.0", configured: "24.20.0", engine: ">=24 <25" },
    ]) {
      expect(verifyFeature003NodeVersion(mismatch)).toMatchObject({
        status: "FAIL",
        code: "NODE_VERSION_MISMATCH",
      });
    }
  });

  it("maps the public CI and test names to their actual aggregate coverage", () => {
    const packageJson = JSON.parse(readFileSync(resolve(workspace, "package.json"), "utf8")) as {
      readonly scripts: Readonly<Record<string, string>>;
    };

    expect(packageJson.scripts["ci:003"]).toBe("node tools/verification/feature-003-gate.mts");
    expect(packageJson.scripts["verify:003"]).toBe(packageJson.scripts["ci:003"]);
    expect(packageJson.scripts["verify:003:setup"]).toBe("node tools/ci/feature-003.mts --setup");
    expect(packageJson.scripts["verify:003:evidence"]).toBe(
      "node tools/verification/feature-003-evidence.mts",
    );
    expect(packageJson.scripts["test:003"]).toBeUndefined();
    expect(packageJson.scripts["test:003:contract-integration-e2e"]).toBe(
      "node tools/ci/feature-003-tests.mts",
    );

    const aggregateTests = readFileSync(
      resolve(workspace, "tools/ci/feature-003-tests.mts"),
      "utf8",
    );
    for (const script of ["test:contract:003", "test:integration:003", "test:e2e:003"]) {
      expect(aggregateTests).toContain(`"${script}"`);
    }
    expect(aggregateTests).toContain("test:003:contract-integration-e2e");

    const setupGate = readFileSync(resolve(workspace, "tools/ci/feature-003.mts"), "utf8");
    expect(setupGate).toContain("verify:003:setup");
    expect(setupGate).not.toContain("[ci:003]");
  });

  it("runs the exact Node preflight before every aggregate-gate mode", () => {
    const aggregateGate = readFileSync(
      resolve(workspace, "tools/verification/feature-003-gate.mts"),
      "utf8",
    );
    const preflight = aggregateGate.indexOf("verifyFeature003NodeVersion({");
    const plan = aggregateGate.indexOf('if (flags.has("--plan"))');

    expect(preflight).toBeGreaterThanOrEqual(0);
    expect(plan).toBeGreaterThan(preflight);
    expect(aggregateGate).toContain("NODE_VERSION_MISMATCH");
    expect(aggregateGate).toContain('status: "RUNNING"');
    expect(aggregateGate).toContain("captureFeature003HandoffSnapshot(workspace)");
    expect(aggregateGate).toContain(
      "verifyFeature003HandoffReport({ workspace, report: candidate })",
    );
    expect(aggregateGate).toContain("PATH: [exactNodePath, process.env.PATH]");
  });

  it("executes the full Feature 003 gate from repository CI on the pinned toolchain", () => {
    const workflow = parse(
      readFileSync(resolve(workspace, ".github/workflows/feature-003.yml"), "utf8"),
    ) as {
      readonly jobs?: Readonly<
        Record<
          string,
          {
            readonly steps?: readonly Readonly<Record<string, unknown>>[];
          }
        >
      >;
    };
    const steps = Object.values(workflow.jobs ?? {}).flatMap(({ steps = [] }) => steps);
    const setupNode = steps.find((step) => step.uses === "actions/setup-node@v4");
    const setupPnpm = steps.find((step) => step.uses === "pnpm/action-setup@v4");
    const commands = steps.map((step) => String(step.run ?? ""));

    expect(setupNode?.with).toMatchObject({ "node-version-file": ".node-version" });
    expect(setupPnpm?.with).toMatchObject({ version: "11.21.0" });
    expect(commands).toContain("pnpm install --frozen-lockfile");
    expect(commands).toContain("pnpm exec playwright install --with-deps chromium");
    expect(commands).toContain("pnpm ci:003");
    expect(commands).toContain("pnpm verify:003:evidence");
  });
});
