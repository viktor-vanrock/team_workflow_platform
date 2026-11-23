import { describe, expect, it } from "vitest";

import {
  assessQaIntakeCompleteness,
  boundQaIntakePatch,
  selectQaIntakeQuestions,
} from "../../../packages/competency-qa/src/index.ts";
import { sha256 } from "../../../packages/platform-contracts/src/index.ts";
import { fixtureJson } from "../../support/fixture-value.ts";

const subject = (content: Record<string, never> | Record<string, unknown>) => ({
  workspaceId: "w",
  projectId: "p",
  draftId: "d",
  revision: 1,
  contentHash: sha256(fixtureJson(content)),
  content: content as never,
});
describe("US1 intake skills", () => {
  it("orders only missing or invalid questions and never reasks valid fields", () => {
    const result = assessQaIntakeCompleteness(
      subject({ schemaVersion: 1, title: "Checkout", requestKind: "bad" }),
    );
    expect(result.state).toBe("INVALID");
    expect(selectQaIntakeQuestions(result as never).map(({ fieldKey }) => fieldKey)).toEqual([
      "requestKind",
      "requestedClassificationKey",
    ]);
  });
  it("accepts a structural partial and bounds authority-free patches", () => {
    expect(assessQaIntakeCompleteness(subject({ schemaVersion: 1 })).state).toBe("INCOMPLETE");
    expect(
      boundQaIntakePatch({ schemaVersion: 1 }, [{ fieldKey: "title", value: "A" }], ["title"]),
    ).toEqual([{ fieldKey: "title", value: "A" }]);
    expect(() =>
      boundQaIntakePatch(
        { schemaVersion: 1 },
        Array.from({ length: 7 }, (_, index) => ({
          fieldKey: index === 0 ? "title" : "goal",
          value: "x",
        })),
        ["title", "goal"],
      ),
    ).toThrow("INTAKE_PATCH_LIMIT_EXCEEDED");
  });
});
