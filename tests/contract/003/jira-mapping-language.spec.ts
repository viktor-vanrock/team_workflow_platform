import { describe, expect, it } from "vitest";

import {
  compileJiraMapping,
  evaluateJiraMapping,
} from "../../../packages/connector-jira/src/index.ts";

describe("bounded Jira mapping language", () => {
  it("evaluates the closed AST under field/resource limits", () => {
    const program = compileJiraMapping(
      {
        outputFieldAllowlist: ["summary", "customfield_10010"],
        limits: { maxDepth: 8, maxNodes: 32, maxOutputBytes: 1024 },
        lookupTables: {},
        expression: {
          op: "object",
          fields: {
            summary: { op: "source", path: "$.summary" },
            customfield_10010: { op: "literal", value: "APP" },
          },
        },
      },
      ["$.summary"],
    );
    expect(evaluateJiraMapping(program, { summary: "Check APP" })).toEqual({
      summary: "Check APP",
      customfield_10010: "APP",
    });
  });

  it.each([
    [{ op: "code", source: "return 1" }, "MAPPING_OPERATION_FORBIDDEN"],
    [{ op: "source", path: "$.secret.token" }, "MAPPING_SOURCE_PATH_FORBIDDEN"],
    [
      { op: "object", fields: { customfield_99999: { op: "literal", value: 1 } } },
      "MAPPING_TARGET_FIELD_FORBIDDEN",
    ],
  ])("rejects executable, secret and unknown-field nodes", (expression, code) => {
    expect(() =>
      compileJiraMapping(
        {
          outputFieldAllowlist: ["summary"],
          limits: { maxDepth: 8, maxNodes: 32, maxOutputBytes: 1024 },
          lookupTables: {},
          expression,
        },
        ["$.summary"],
      ),
    ).toThrow(code);
  });
});
