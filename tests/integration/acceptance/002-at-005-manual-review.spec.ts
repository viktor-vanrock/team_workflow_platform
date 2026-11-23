import { describe, expect, it } from "vitest";

import { NativeQaSessionRetestLineageResolver } from "../../../packages/competency-qa/src/application/native-retest-lineage-resolver.ts";
import { completeCleanManualSession } from "../../../packages/competency-qa/src/application/review-manual-session.ts";

describe("AT-005 manual review lifecycle", () => {
  it("completes only the clean PASS path and exposes native same-scope RETEST lineage", async () => {
    const completed = await completeCleanManualSession({
      workspaceId: "w",
      projectId: "p",
      workItemId: "wi",
      sessionId: "s",
      expectedSessionVersion: 9,
      actor: { kind: "HUMAN", principalId: "executor", issuer: "fake", subject: "executor" },
      outcomeSummary: "Clean pass",
      at: "2026-08-30T10:10:00.000Z",
    });
    expect(completed.session.state).toBe("COMPLETED");
    expect(completed.session.sessionOutcome).toBe("PASSED");
    expect(completed.manifest.revision).toBe(1);
    expect(completed.nativeRetestLineage).toMatchObject({
      kind: "QA_SESSION",
      sessionId: "s",
      workspaceId: "w",
      projectId: "p",
    });
    const resolver = new NativeQaSessionRetestLineageResolver(async (scope, sessionId) =>
      scope.workspaceId === "w" && scope.projectId === "p" && sessionId === "s"
        ? completed
        : undefined,
    );
    await expect(resolver.resolve({ workspaceId: "w", projectId: "p" }, "s")).resolves.toEqual(
      completed.nativeRetestLineage,
    );
    await expect(resolver.resolve({ workspaceId: "w", projectId: "other" }, "s")).rejects.toThrow(
      "QA_RETEST_NATIVE_SESSION_INVALID",
    );
    const stale = {
      ...completed,
      nativeRetestLineage: {
        ...completed.nativeRetestLineage,
        manifestRevisionRef: {
          ...completed.nativeRetestLineage.manifestRevisionRef,
          contentHash: "sha256:stale" as const,
        },
      },
    };
    await expect(
      new NativeQaSessionRetestLineageResolver(async () => stale).resolve(
        { workspaceId: "w", projectId: "p" },
        "s",
      ),
    ).rejects.toThrow("QA_RETEST_NATIVE_SESSION_STALE_REF");
  });
});
