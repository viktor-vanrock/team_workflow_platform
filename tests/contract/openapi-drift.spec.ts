import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { requiredFixture } from "../support/fixture-value.ts";

type Document = Record<string, unknown>;
const root = resolve(import.meta.dirname, "../..");
const designPaths = [
  "specs/001-extension-kernel-local-skeleton/contracts/openapi/core-api.v1.yaml",
  "specs/001-extension-kernel-local-skeleton/contracts/openapi/dummy-pack-api.v1.yaml",
  "specs/001-extension-kernel-local-skeleton/contracts/openapi/mock-hub-api.v1.yaml",
] as const;
const qaDesignPath = "specs/002-qa-manual-walking-skeleton/contracts/openapi/qa-pack-api.v1.yaml";
const operationalMockDesignPath =
  "specs/002-qa-manual-walking-skeleton/contracts/openapi/mock-hub-operational-api.v1.yaml";
const extensionDesignPaths = [
  "specs/023-hermes-customer-projects/contracts/project-dialogues.v1.yaml",
  "specs/003-jira-operational-authority/contracts/openapi/jira-operational-authority-api.v1.yaml",
  "specs/004-mattermost-hermes-intake/contracts/openapi/mattermost-hermes-intake-api.v1.yaml",
  "specs/005-gitlab-automated-validation/contracts/openapi/gitlab-automated-validation-api.v1.yaml",
  "specs/006-queue-triage-capacity-sla/contracts/openapi/queue-triage-capacity-sla-api.v1.yaml",
  "specs/006-queue-triage-capacity-sla/contracts/openapi/core-approval-api.v1.1.yaml",
  "specs/007-project-onboarding-evidence-security/contracts/openapi/project-onboarding-evidence-api.v1.yaml",
  "specs/007-project-onboarding-evidence-security/contracts/openapi/project-onboarding-api.v1.1.yaml",
  "specs/007-project-onboarding-evidence-security/contracts/openapi/project-reads-api.v1.yaml",
] as const;
const mockMattermostOperationIds = [
  "pingMockMattermost",
  "lookupMockMattermostPostByEffect",
  "createMockMattermostPost",
  "getMockMattermostState",
  "setMockMattermostFault",
  "recordMockMattermostCallback",
] as const;
const qaImplementedOperationIds = new Set([
  "confirmQaIntakeDraft",
  "getQaRequestExtension",
  "getQaWorkItemDetailHistory",
  "getQaRequestInputHistory",
  "getCurrentQaRequestInputRevision",
  "listConfirmedQaBacklog",
  "getConfirmedQaBacklogItem",
  "reviseQaRequestInputs",
  "evaluateQaReadiness",
  "confirmQaReadiness",
  "requestQaWaiver",
  "getRequiredSessionPlanHistory",
  "publishRequiredSessionPlanRevision",
  "getCurrentRequiredSessionPlanRevision",
  "getRequiredSessionPlanRevision",
  "listQaSessions",
  "createQaSession",
  "getQaSession",
  "transitionQaSession",
  "listQaPlanItems",
  "createQaPlanItem",
  "getQaPlanItem",
  "updateQaPlanItemBeforeSessionStart",
  "listManualAttempts",
  "startManualAttempt",
  "completeManualAttempt",
  "listQaObservationsForAttempt",
  "recordQaObservation",
  "listQaPlanItemResultRevisions",
  "recordQaPlanItemResultRevision",
  "listQaEvidenceArtifactLinks",
  "getQaEvidenceArtifactLink",
  "listQaEvidenceManifests",
  "reviewQaSessionAndPublishEvidence",
  "getQaEvidenceManifestHistory",
  "getQaEvidenceManifestRevision",
  "createQaVerdict",
  "supersedeQaVerdictBeforeDone",
  "signQaVerdict",
  "evaluateQaDefinitionOfDone",
  "createQaCompletionCandidate",
  "getQaCompletionCandidate",
  "getQaFinalCloseConfirmation",
  "requestQaFinalClose",
  "createQaPostCloseManifestRevision",
]);
const methods = new Set(["get", "put", "post", "delete", "patch", "options", "head", "trace"]);
function operations(
  document: Document,
): Array<{ id: string; method: string; path: string; value: Document }> {
  const result: Array<{ id: string; method: string; path: string; value: Document }> = [];
  for (const [path, pathItem] of Object.entries(document.paths as Document))
    for (const [method, value] of Object.entries(pathItem as Document)) {
      if (!methods.has(method) || typeof (value as Document).operationId !== "string") continue;
      result.push({
        id: String((value as Document).operationId),
        method,
        path,
        value: value as Document,
      });
    }
  return result;
}
function refs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refs);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Document).flatMap(([key, child]) =>
    key === "$ref" && typeof child === "string" ? [child] : refs(child),
  );
}

describe("OpenAPI 3.1 design and generated snapshot drift", () => {
  it("defines 48 unique Core/Dummy/Mock Hub operations with RFC 9457 errors and explicit statuses", async () => {
    const documents = await Promise.all(
      designPaths.map(
        async (path) => parse(await readFile(resolve(root, path), "utf8")) as Document,
      ),
    );
    const all = documents.flatMap(operations);
    expect(documents.map(({ openapi }) => openapi)).toEqual(["3.1.0", "3.1.0", "3.1.0"]);
    expect(all).toHaveLength(48);
    expect(new Set(all.map(({ id }) => id))).toHaveProperty("size", 48);
    for (const operation of all) {
      const responses = operation.value.responses as Document;
      expect(Object.keys(responses).length, operation.id).toBeGreaterThan(0);
      for (const response of Object.values(responses))
        if (!(response as Document).$ref)
          expect((response as Document).description, operation.id).toEqual(expect.any(String));
      if (operation.method !== "get")
        expect(
          operation.path.startsWith("/api/") ||
            operation.path.startsWith("/local/") ||
            operation.path.startsWith("/mock/") ||
            operation.path.startsWith("/health/"),
          operation.id,
        ).toBe(true);
    }
    for (const document of documents)
      expect(document.components).toMatchObject({
        responses: { Problem: { content: { "application/problem+json": expect.any(Object) } } },
      });
    for (const id of [
      "submitIntakeDraft",
      "requestProjectIntegrationBindingPublication",
      "publishSampleRecord",
    ]) {
      const response = all.find((operation) => operation.id === id)!.value.responses as Document;
      expect((response["202"] as Document).headers, id).toMatchObject({
        Location: expect.any(Object),
      });
    }
  });

  it("keeps standalone generated snapshots byte-current with all design operations and local refs", async () => {
    const [core, dummy, mock, qa, operationalMock, ...extensions] = await Promise.all(
      [...designPaths, qaDesignPath, operationalMockDesignPath, ...extensionDesignPaths].map(
        async (path) => parse(await readFile(resolve(root, path), "utf8")) as Document,
      ),
    );
    const [apiGenerated, mockGenerated] = await Promise.all([
      readFile(resolve(root, "apps/api/openapi.generated.json"), "utf8").then(
        (value) => JSON.parse(value) as Document,
      ),
      readFile(resolve(root, "apps/mock-hub/openapi.generated.json"), "utf8").then(
        (value) => JSON.parse(value) as Document,
      ),
    ]);
    const replacedCoreApprovalOperations = new Set(["decideApproval", "getApproval"]);
    // Later versioned contracts supersede an earlier operation at the same method/path.
    const extensionOperations = [
      ...new Map(
        extensions
          .flatMap(operations)
          .map((operation) => [`${operation.method}:${operation.path}`, operation]),
      ).values(),
    ];
    expect(
      operations(apiGenerated)
        .map(({ id }) => id)
        .sort(),
    ).toEqual(
      [
        ...operations(requiredFixture(core)).filter(
          ({ id }) => !replacedCoreApprovalOperations.has(id),
        ),
        ...operations(requiredFixture(dummy)),
        ...operations(requiredFixture(qa)).filter(({ id }) => qaImplementedOperationIds.has(id)),
        ...extensionOperations,
      ]
        .map(({ id }) => id)
        .sort(),
    );
    const acceptance = operations(apiGenerated).find(
      (operation) => operation.id === "acceptBindingFunctionally",
    )!;
    expect(JSON.stringify(acceptance.value.responses)).toContain(
      "binding_functional_acceptance_v2",
    );
    expect(
      operations(mockGenerated)
        .map(({ id }) => id)
        .sort(),
    ).toEqual(
      [...operations(requiredFixture(mock)), ...operations(requiredFixture(operationalMock))]
        .map(({ id }) => id)
        .concat(mockMattermostOperationIds)
        .sort(),
    );
    expect(
      [...refs(apiGenerated), ...refs(mockGenerated)].every(
        (ref) => ref.startsWith("#/") || ref.startsWith("#"),
      ),
    ).toBe(true);
    for (const generated of [apiGenerated, mockGenerated]) {
      expect(
        Object.keys((generated.components as Document).schemas as Document).length,
      ).toBeGreaterThanOrEqual(31);
      const digests = generated["x-awp-source-digests"] as Record<string, string>;
      for (const [path, digest] of Object.entries(digests))
        expect(
          `sha256:${createHash("sha256")
            .update(await readFile(resolve(root, path)))
            .digest("hex")}`,
        ).toBe(digest);
    }
  });
});
