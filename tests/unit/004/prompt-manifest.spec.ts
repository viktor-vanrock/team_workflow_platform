import { describe, expect, it } from "vitest";

import {
  createHermesSkillRegistry,
  PromptManifestBuilder,
} from "../../../packages/runtime-composition/src/index.ts";

const subject = {
  kind: "WORK_ITEM" as const,
  id: "wi",
  version: 1,
  contentHash: "sha256:wi",
  aggregateSnapshotHash: "sha256:snapshot",
};
const input = (facts: Parameters<PromptManifestBuilder["build"]>[0]["facts"]) => ({
  workspaceId: "w",
  projectId: "p",
  subject,
  skill: createHermesSkillRegistry().resolve("qa-triage", "1.0.0"),
  facts,
  allowedFactKeys: ["summary"],
  maximumClassification: "INTERNAL" as const,
  createdAt: new Date("2026-09-01"),
});

describe("PromptManifest minimization", () => {
  it("keeps only allowlisted primitive classified facts and fingerprints them", () => {
    const manifest = new PromptManifestBuilder().build(
      input([
        {
          sourceKind: "QA_STATE",
          sourceRef: "wi:1",
          sourceVersion: "1",
          sourceHash: "sha256:wi",
          classification: "INTERNAL",
          key: "summary",
          value: "bounded",
        },
        {
          sourceKind: "QA_STATE",
          sourceRef: "wi:1",
          sourceVersion: "1",
          sourceHash: "sha256:wi",
          classification: "INTERNAL",
          key: "ignored",
          value: "drop",
        },
      ] as never),
    );
    expect(manifest.factSegments).toHaveLength(1);
    expect(manifest).not.toHaveProperty("renderedPrompt");
    expect(manifest.inputFingerprint).toMatch(/^sha256:/u);
  });

  it("rejects secrets, structured values and classifications above the ceiling", () => {
    const build = (overrides: Record<string, unknown>) => () => {
      const fact = {
        sourceKind: "QA_STATE",
        sourceRef: "wi:1",
        sourceVersion: "1",
        sourceHash: "sha256:wi",
        classification: "INTERNAL",
        key: "summary",
        value: "safe",
        ...overrides,
      };
      return new PromptManifestBuilder().build({
        ...input([fact] as never),
        allowedFactKeys: [fact.key],
      });
    };
    expect(build({ key: "authorizationToken" })).toThrow("PROMPT_FACT_DENIED");
    expect(build({ value: { raw: true } })).toThrow("PROMPT_FACT_VALUE_NOT_MINIMIZED");
    expect(build({ classification: "CONFIDENTIAL" })).toThrow("PROMPT_FACT_DENIED");
  });
});
