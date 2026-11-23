import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type Feature004GovernanceManifest,
  verifyFeature004GovernanceBinding,
} from "../../../tools/verification/feature-004-governance.mts";

function fixture(): string {
  return mkdtempSync(resolve(tmpdir(), "awp-004-governance-"));
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function write(root: string, path: string, value: string): void {
  const target = resolve(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value, "utf8");
}

const adr0008 = `# ADR-0008\n\n**Status:** Accepted\n\n**Date accepted:** 2026-09-01\n\n**Partially supersedes:** ADR-0005 Decision 1 only\n\nDRAFT | CANDIDATE | WORK_ITEM\n`;
const adr0005 = `# ADR-0005\n\n**Статус:** Accepted — Decision 1 partially superseded by ADR-0008\n`;
const constitution = `# Constitution\n\n**Версия:** 2.0.0\n**Статус:** Ratified\n\nDRAFT | CANDIDATE | WORK_ITEM\n`;

function manifest(values = { adr0008, adr0005, constitution }): Feature004GovernanceManifest {
  return {
    schemaVersion: 1,
    acceptedAdr: { path: "docs/adr/0008.md", sha256: digest(values.adr0008) },
    partiallySupersededAdr: { path: "docs/adr/0005.md", sha256: digest(values.adr0005) },
    constitution: {
      path: ".specify/memory/constitution.md",
      sha256: digest(values.constitution),
      version: "2.0.0",
    },
  };
}

function populate(
  root: string,
  values = { adr0008, adr0005, constitution },
): Feature004GovernanceManifest {
  const requirement = manifest(values);
  write(root, requirement.acceptedAdr.path, values.adr0008);
  write(root, requirement.partiallySupersededAdr.path, values.adr0005);
  write(root, requirement.constitution.path, values.constitution);
  return requirement;
}

describe("Feature 004 governance digest binding", () => {
  it("accepts exact Accepted ADR-0008, exact partial supersession and Constitution 2.0.0", () => {
    const root = fixture();
    const result = verifyFeature004GovernanceBinding(root, populate(root));

    expect(result.status).toBe("PASS");
    expect(result.checks).toHaveLength(3);
    expect(
      result.checks.every(
        ({ status, code }) => status === "PASS" && code === "GOVERNANCE_DOCUMENT_ACCEPTED",
      ),
    ).toBe(true);
  });

  it("rejects an unaccepted ADR even when the frozen digest matches", () => {
    const root = fixture();
    const values = {
      adr0008: adr0008.replace("Status:** Accepted", "Status:** Proposed"),
      adr0005,
      constitution,
    };
    const result = verifyFeature004GovernanceBinding(root, populate(root, values));

    expect(result.status).toBe("FAIL");
    expect(result.checks[0]).toMatchObject({ status: "FAIL", code: "ADR_0008_NOT_ACCEPTED" });
  });

  it("rejects broad or missing ADR-0005 partial-supersession semantics", () => {
    const root = fixture();
    const values = {
      adr0008: adr0008.replace("ADR-0005 Decision 1 only", "ADR-0005 entirely"),
      adr0005,
      constitution,
    };
    const result = verifyFeature004GovernanceBinding(root, populate(root, values));

    expect(result.status).toBe("FAIL");
    expect(result.checks[0]).toMatchObject({
      status: "FAIL",
      code: "ADR_0008_PARTIAL_SUPERSESSION_INVALID",
    });
  });

  it("rejects a non-2.0.0 or non-ratified Constitution", () => {
    const root = fixture();
    const values = {
      adr0008,
      adr0005,
      constitution: constitution.replace("2.0.0", "1.1.1").replace("Ratified", "Draft"),
    };
    const requirement = populate(root, values);
    const result = verifyFeature004GovernanceBinding(root, {
      ...requirement,
      constitution: { ...requirement.constitution, version: "2.0.0" },
    });

    expect(result.status).toBe("FAIL");
    expect(result.checks[2]).toMatchObject({ status: "FAIL", code: "CONSTITUTION_INCOMPATIBLE" });
  });

  it("rejects byte drift before interpreting otherwise valid governance prose", () => {
    const root = fixture();
    const requirement = populate(root);
    write(root, requirement.acceptedAdr.path, `${adr0008}\n`);

    const result = verifyFeature004GovernanceBinding(root, requirement);

    expect(result.status).toBe("FAIL");
    expect(result.checks[0]).toMatchObject({ status: "FAIL", code: "GOVERNANCE_DIGEST_MISMATCH" });
  });
});
