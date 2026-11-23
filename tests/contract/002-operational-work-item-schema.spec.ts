import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { OfflineSchemaRegistry } from "../../packages/platform-contracts/src/index.ts";

const root = resolve(import.meta.dirname, "../..");
const examples = resolve(root, "specs/002-qa-manual-walking-skeleton/contracts/examples");
const registry = new OfflineSchemaRegistry();

async function fixture(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(resolve(examples, path), "utf8")) as Record<string, unknown>;
}

describe("operational-work-item@1.0.0 typed capability", () => {
  it("publishes an exact typed three-operation SDK surface", () => {
    const capabilityPath = resolve(root, "packages/connector-sdk/src/operational-work-item.ts");
    expect(
      existsSync(capabilityPath),
      "T045 must add the typed operational-work-item SDK surface",
    ).toBe(true);
    const capability = readFileSync(capabilityPath, "utf8");
    const sdkIndex = readFileSync(resolve(root, "packages/connector-sdk/src/index.ts"), "utf8");
    for (const operation of ["request.create", "request.transition", "defect.create"]) {
      expect(capability).toContain(operation);
    }
    expect(capability).toMatch(/OperationalWorkItemOperation/gu);
    expect(capability).not.toMatch(/["']read-back["']/gu);
    expect(sdkIndex).toContain("./operational-work-item.ts");
  });

  it("validates only the three closed input/result operation branches", async () => {
    const requestCreate = await fixture("positive/request-create.valid.json");
    const requestTransition = await fixture("positive/request-transition-done.valid.json");
    const defectCreate = await fixture("positive/defect-create.valid.json");
    const requestResult = await fixture("positive/operational-result-request-created.valid.json");
    const doneResult = await fixture("positive/operational-result-done.valid.json");
    const defectResult = {
      ...requestResult,
      operation: "defect.create",
      entityKind: "DEFECT",
      rawExternalState: "OPEN",
      normalizedStatus: "NEW",
    };

    expect(() =>
      registry.validateById(
        "urn:awp:schemas:operational-work-item:request-create:v1",
        requestCreate,
      ),
    ).not.toThrow();
    expect(() =>
      registry.validateById(
        "urn:awp:schemas:operational-work-item:request-transition:v1",
        requestTransition,
      ),
    ).not.toThrow();
    expect(() =>
      registry.validateById("urn:awp:schemas:operational-work-item:defect-create:v1", defectCreate),
    ).not.toThrow();
    for (const result of [requestResult, doneResult, defectResult]) {
      expect(() =>
        registry.validateById("urn:awp:schemas:operational-work-item:result:v1", result),
      ).not.toThrow();
    }
    expect(() =>
      registry.validateById("urn:awp:schemas:operational-work-item:result:v1", {
        ...requestResult,
        operation: "request.delete",
      }),
    ).toThrow();
  });

  it("keeps read-back in generic confirmation modes and rejects it as an operation", async () => {
    const genericSdk = readFileSync(resolve(root, "packages/connector-sdk/src/index.ts"), "utf8");
    expect(genericSdk).toMatch(/ConfirmationMode\s*=\s*[\s\S]*"READ_BACK"/gu);
    const invalidReadBack = await fixture("negative/operational-read-back-operation.invalid.json");
    expect(() =>
      registry.validateById("urn:awp:schemas:operational-work-item:result:v1", invalidReadBack),
    ).toThrow();
  });
});
