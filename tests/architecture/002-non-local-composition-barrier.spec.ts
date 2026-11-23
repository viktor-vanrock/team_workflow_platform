import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadEnvironment } from "../../packages/runtime-composition/src/index.ts";
import {
  assertNonLocalConfiguration,
  nonLocalComposition,
} from "../../packages/runtime-composition/src/non-local.composition.ts";

const root = resolve(import.meta.dirname, "../..");
const nonLocal = Object.freeze({
  AWP_RUNTIME_PROFILE: "non-local",
  AWP_EXTERNAL_NETWORK_MODE: "allowlisted",
  AWP_IDENTITY_ISSUER: "https://identity.example.test",
  AWP_EXTERNAL_ENDPOINT_ALLOWLIST: "https://jira.example.test",
  AWP_DATABASE_URL: "postgresql://runtime@example.test/awp",
});

describe("Feature 002 non-local composition barrier", () => {
  it("requires a published deployment even for a QA-free non-local foundation", () => {
    expect(() => loadEnvironment(nonLocal)).toThrow("BLOCKED_INPUT:AWP_DEPLOYMENT_CONFIG");
    expect(() => loadEnvironment({ ...nonLocal, AWP_COMPOSITION: "foundation" })).toThrow(
      "BLOCKED_INPUT:AWP_DEPLOYMENT_CONFIG",
    );
    expect(JSON.stringify(nonLocalComposition)).not.toMatch(
      /competency-qa|qa-local|mock-hub|fake-idp/iu,
    );
  });

  it("rejects qa-local outside local/test and under allowlisted egress", () => {
    expect(() => loadEnvironment({ ...nonLocal, AWP_COMPOSITION: "qa-local" })).toThrow(
      "QA_LOCAL_COMPOSITION_PROFILE_FORBIDDEN",
    );
    const localAllowlisted = {
      ...nonLocal,
      AWP_RUNTIME_PROFILE: "local",
      AWP_COMPOSITION: "qa-local",
      AWP_MOCK_HUB_URL: "http://mock-hub:4010",
      AWP_EXTERNAL_NETWORK_MODE: "allowlisted",
    };
    expect(() => loadEnvironment(localAllowlisted)).toThrow(
      "QA_LOCAL_COMPOSITION_NETWORK_FORBIDDEN",
    );
  });

  it("accepts only HTTPS allowlisted non-local endpoints and excludes local providers", () => {
    expect(() => assertNonLocalConfiguration(nonLocal)).not.toThrow();
    expect(() =>
      assertNonLocalConfiguration({
        ...nonLocal,
        AWP_EXTERNAL_ENDPOINT_ALLOWLIST: "http://mock-hub:4010",
      }),
    ).toThrow();
    expect(() =>
      assertNonLocalConfiguration({ ...nonLocal, AWP_MODEL_PROVIDER: "deterministic-fake" }),
    ).toThrow("NON_LOCAL_LOCAL_COMPONENT_REFERENCE_FORBIDDEN");
  });

  it("keeps the non-local composition dependency closure free of local QA adapters", async () => {
    const content = await readFile(
      resolve(root, "packages/runtime-composition/src/non-local.composition.ts"),
      "utf8",
    );
    const imports = content.match(/^import .*$/gmu) ?? [];
    expect(imports.join("\n")).not.toMatch(/\.\/qa\/|connector-mock|fake-qa|local-seed|mock-hub/iu);
  });
});
