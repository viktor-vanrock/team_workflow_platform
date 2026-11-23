import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "../..");
async function files(directory: string): Promise<string[]> {
  return (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map(async (entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory()
          ? files(path)
          : /\.(?:ts|tsx|mts)$/u.test(entry.name)
            ? [path]
            : [];
      }),
    )
  ).flat();
}
async function source(directory: string): Promise<string> {
  return (
    await Promise.all((await files(directory)).map(async (file) => await readFile(file, "utf8")))
  ).join("\n");
}

describe("Feature 002 final hard boundaries", () => {
  it("keeps Core and generic runtime free of QA semantics", async () => {
    const generic = ["packages/platform-core/src", "packages/platform-runtime-nest/src"];
    for (const directory of generic) {
      const content = await source(resolve(root, directory));
      expect(content, directory).not.toMatch(
        /@awp\/competency-qa|qa\.validation|QaVerdict|EvidenceManifest|TestSession|QA_REQUEST_AUTHORITY|DEFECT_DESTINATION/u,
      );
    }
  });

  it("keeps the Pack vendor-neutral and statically loaded", async () => {
    const qa = await source(resolve(root, "packages/competency-qa/src"));
    expect(qa).not.toMatch(
      /@awp\/connector-|@nestjs\/|jql|customfield_|transitionId|gitlab\/api|mattermost\/api/iu,
    );
    expect(qa).not.toMatch(
      /\beval\s*\(|\bnew\s+Function\s*\(|\bcreateRequire\s*\(|\brequire\s*\(|import\s*\(\s*(?:`|[^"'])/u,
    );
  });

  it("keeps published Feature 002 MANUAL V1 sources byte-semantically MANUAL-only", async () => {
    const historical = `${await readFile(resolve(root, "packages/competency-qa/src/manifest.ts"), "utf8")}\n${await readFile(resolve(root, "packages/competency-qa/src/domain/manual-attempt.ts"), "utf8")}`;
    expect(historical).toMatch(/qaSessionModes\s*=\s*Object\.freeze\(\["MANUAL"\]/u);
    expect(historical).not.toMatch(/\bAUTOMATED\b|executeAutomated|AutomatedExecutor/u);
  });

  it("keeps browser code away from Pack Node and Connector surfaces", async () => {
    const web = await source(resolve(root, "apps/web/src"));
    expect(web).not.toMatch(/@awp\/competency-qa\/node|@awp\/connector-|@awp\/platform-core/u);
  });

  it("classifies every public QA mutation in the closed guard catalog", async () => {
    const contract = parse(
      await readFile(
        resolve(root, "specs/002-qa-manual-walking-skeleton/contracts/openapi/qa-pack-api.v1.yaml"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const retiredV1OperationIds = new Set([
      "initiateQaEvidenceAttachment",
      "uploadQaEvidenceContent",
      "finalizeQaEvidenceAttachment",
    ]);
    const mutationIds = Object.values(contract.paths as Record<string, unknown>)
      .flatMap((path) =>
        Object.entries(path as Record<string, unknown>)
          .filter(([method]) => ["post", "put", "patch", "delete"].includes(method))
          .map(([, operation]) => String((operation as Record<string, unknown>).operationId)),
      )
      .filter((operationId) => !retiredV1OperationIds.has(operationId))
      .sort();
    const qa = (await import("../../packages/competency-qa/src/node.ts")) as unknown as {
      qaOperationGuardDeclarations?: readonly Readonly<{
        operationId: string;
        classification: string;
      }>[];
    };
    expect(
      qa.qaOperationGuardDeclarations,
      "every QA mutation must declare one closed guard class",
    ).toBeDefined();
    expect(qa.qaOperationGuardDeclarations?.map(({ operationId }) => operationId).sort()).toEqual(
      mutationIds,
    );
    expect(
      qa.qaOperationGuardDeclarations?.every(({ classification }) =>
        [
          "AGGREGATE_MUTATION",
          "COMPLETION_SELF_TRANSITION",
          "POST_CLOSE_CLERICAL_CORRECTION",
          "READ_ONLY",
        ].includes(classification),
      ),
    ).toBe(true);
    expect(
      new Set(qa.qaOperationGuardDeclarations?.map(({ operationId }) => operationId)),
    ).toHaveProperty("size", mutationIds.length);
  });

  it("contains no release-decision authority or provider-specific API surface", async () => {
    const sources = `${await source(resolve(root, "packages/competency-qa/src/domain"))}\n${await source(resolve(root, "packages/competency-qa/src/application"))}`;
    expect(sources).not.toMatch(
      /releaseDecision\s*[:=]|RELEASE_DECISION|createReleaseDecision|approveRelease/iu,
    );
    expect(sources).not.toMatch(/jira|jql|customfield_|transitionId/iu);
  });
});
