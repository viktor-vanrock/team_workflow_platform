import { describe, expect, it, vi } from "vitest";

import { redactQaAuditAttributes } from "../../../packages/competency-qa/src/application/domain-events.ts";
import {
  FakeQaDraftAssistant,
  requestQaDefectDraftWordingProposal,
} from "../../../packages/competency-qa/src/application/qa-draft-assistant.ts";
import { redactAuditAttributes } from "../../../packages/platform-core/src/audit/redaction.ts";
import { ProblemDetailsFilter } from "../../../packages/platform-runtime-nest/src/http/problem-details.filter.ts";
import {
  redactTelemetryAttributes,
  StructuredLogger,
} from "../../../packages/platform-runtime-nest/src/observability/telemetry.ts";
import { createFrozenFinding } from "../../support/002-us4-fixtures.ts";

const forbidden =
  /bearer\s+|secretref:\/\/|s3:\/\/|raw evidence|model prompt|private-object|project-beta/iu;

describe("Feature 002 secret, evidence and scope redaction scan", () => {
  it("removes secrets, evidence, prompt material, locators and foreign IDs from audit and telemetry", () => {
    const hostile = {
      operation: "qa.complete",
      reasonCode: "DENIED",
      token: "Bearer token.value.signature",
      rawEvidence: "raw evidence: password=secret",
      modelPrompt: "model prompt with private data",
      objectLocator: "s3://bucket/private-object",
      foreignProjectId: "project-beta",
      latencyMs: 3,
    };
    expect(JSON.stringify(redactAuditAttributes(hostile))).not.toMatch(forbidden);
    expect(JSON.stringify(redactQaAuditAttributes(hostile))).not.toMatch(forbidden);
    expect(JSON.stringify(redactTelemetryAttributes(hostile))).not.toMatch(forbidden);
    expect(redactQaAuditAttributes(hostile)).toEqual({
      operation: "qa.complete",
      reasonCode: "DENIED",
      latencyMs: 3,
    });
  });

  it("redacts hostile log messages and attributes", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    new StructuredLogger().write("error", "raw evidence s3://bucket/private-object", {
      modelPrompt: "model prompt",
      foreignProjectId: "project-beta",
    });
    const line = String(write.mock.calls[0]?.[0] ?? "");
    write.mockRestore();
    expect(line).toContain("redacted.event");
    expect(line).not.toMatch(forbidden);
  });

  it("returns policy-safe Problem Details without exception text or query values", () => {
    let body: unknown;
    const response = {
      status: () => response,
      type: () => response,
      json: (value: unknown) => {
        body = value;
      },
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({
          url: "/api/v1/qa?artifact=s3://bucket/private-object&project=project-beta",
          correlationId: "correlation-safe",
        }),
      }),
    };
    new ProblemDetailsFilter().catch(
      new Error("Bearer secret raw evidence project-beta"),
      host as never,
    );
    expect(body).toEqual({
      type: "urn:awp:problem:http-500",
      title: "Internal Server Error",
      status: 500,
      code: "HTTP_500",
      instance: "/api/v1/qa",
      correlationId: "correlation-safe",
    });
    expect(JSON.stringify(body)).not.toMatch(forbidden);
  });

  it("does not construct or send a model prompt for restricted classification", async () => {
    const assistant = new FakeQaDraftAssistant();
    const result = await requestQaDefectDraftWordingProposal({
      finding: createFrozenFinding({ classification: "PRODUCT", disposition: "CREATE_DEFECT" }),
      assistant,
      modelRef: {
        kind: "MODEL",
        id: "fake",
        version: "1",
        contentHash: `sha256:${"a".repeat(64)}`,
      },
      dataClassificationKey: "RESTRICTED",
      now: () => "2026-08-31T00:00:00.000Z",
    });
    expect(result.fallbackReasonCode).toBe("MODEL_INPUT_DENIED");
    expect(assistant.calls).toHaveLength(0);
  });
});
