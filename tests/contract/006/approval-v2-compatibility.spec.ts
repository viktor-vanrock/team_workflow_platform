import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type JsonValue,
  schemaDocuments,
  sha256,
} from "../../../packages/platform-contracts/src/index.ts";
import { requiredFixture } from "../../support/fixture-value.ts";

const root = resolve(import.meta.dirname, "../../../specs");
const readSchema = (path: string) =>
  JSON.parse(readFileSync(resolve(root, path), "utf8")) as Record<string, JsonValue>;
const v1 = readSchema(
  "001-extension-kernel-local-skeleton/contracts/schemas/commands/approval-subject.v1.schema.json",
);
const v2 = readSchema(
  "006-queue-triage-capacity-sla/contracts/schemas/approval-subject.v2.schema.json",
);
const candidate = readSchema(
  "006-queue-triage-capacity-sla/contracts/schemas/queue-action-candidate.v1.schema.json",
);

describe("Feature 006 Approval v2 additive compatibility", () => {
  it("keeps frozen Approval v1 bytes registered while adding a distinct v2 identity", () => {
    const v1Document = schemaDocuments.find(
      ({ id }) => id === "urn:awp:contracts:commands:approval-subject:v1",
    );
    const v2Document = schemaDocuments.find(
      ({ id }) => id === "urn:awp:contracts:commands:approval-subject:v2",
    );
    expect(v1Document).toMatchObject({
      digest: "sha256:3b897fc996b8be124dfc88190cd287adb3f584abf6a3602cbf97733b9e7b50fb",
    });
    expect(sha256(v1)).toBe(
      "sha256:3b897fc996b8be124dfc88190cd287adb3f584abf6a3602cbf97733b9e7b50fb",
    );
    expect(v2Document).toMatchObject({ contributionOrder: 600, digest: sha256(v2) });
    expect(v1).not.toEqual(v2);
  });

  it("closes EXTERNAL_COMMAND and PLATFORM_ACTION as separate exact branches", () => {
    const action = (v2.$defs as Record<string, Record<string, unknown>>).Action;
    const branches = requiredFixture(action).oneOf as readonly Record<string, unknown>[];
    const kinds = branches.map(
      (branch) =>
        requiredFixture((branch.properties as Record<string, Record<string, unknown>>).actionKind)
          .const,
    );
    expect(kinds).toEqual(["EXTERNAL_COMMAND", "PLATFORM_ACTION"]);
    expect(branches.every(({ additionalProperties }) => additionalProperties === false)).toBe(true);

    const serialized = JSON.stringify(v2.allOf);
    expect(serialized).toContain("expectedExternalState");
    expect(serialized).toContain("expectedLocalState");
    expect(serialized).toContain("bindingRef");
    expect(serialized).toContain("initiatorAuthorizationScopeWitness");
  });

  it("pins the complete safe candidate and forbids self approval for platform actions", () => {
    const serialized = JSON.stringify(v2);
    expect(serialized).toContain(`"digest":{"const":"${sha256(candidate)}"}`);
    expect(serialized).toContain("urn:awp:schemas:006:queue-action-candidate:v1");
    expect(serialized).toContain("SELF_APPROVAL_FORBIDDEN");
    expect(serialized).toContain("currentPublishedVersion");
    expect(serialized).toContain("publicIntentHash");
  });

  it("keeps authorization witnesses safe and lifecycle/result families closed", () => {
    const witness = (v2.$defs as Record<string, Record<string, unknown>>).AuthorizationScopeWitness;
    expect(requiredFixture(witness).additionalProperties).toBe(false);
    expect(Object.keys(requiredFixture(witness).properties as object).sort()).toEqual([
      "authorizedProjectSetHash",
      "evaluatedAt",
      "projectAuthorizationFacetHash",
      "projectId",
      "requiredPermission",
      "scopeKind",
      "workspaceId",
    ]);
    const lifecycle = JSON.stringify(v2.allOf);
    expect(lifecycle).toContain("NOT_AUTHORIZED");
    expect(lifecycle).toContain("AUTHORIZED");
    expect(lifecycle).toContain("INVALIDATED");
    expect(lifecycle).toContain("CONSUMED");
    expect(lifecycle).toContain("consumedAt");
  });
});
