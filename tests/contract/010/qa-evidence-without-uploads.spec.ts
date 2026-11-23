import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Feature 010 QA evidence API", () => {
  it("keeps evidence reads and manifests but exposes no binary attachment upload", async () => {
    const controller = await readFile(
      resolve(import.meta.dirname, "../../../apps/api/src/extensions/qa-evidence.controller.ts"),
      "utf8",
    );
    expect(controller).toContain('@Get("evidence-links")');
    expect(controller).toContain('@Get("evidence-manifests")');
    expect(controller).not.toMatch(/evidence-attachments|QA_EVIDENCE_UPLOADS|@Put\(/u);
  });
});
