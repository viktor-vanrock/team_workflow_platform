import { describe, expect, it } from "vitest";

import { type JsonValue, sha256 } from "../../../packages/platform-contracts/src/index.ts";
import {
  HermesCorpusEvaluator,
  type HermesObservedExecution,
  parseHermesCorpus,
} from "../../../packages/runtime-composition/src/hermes/evaluation.ts";
import {
  createHermesDevelopmentPort008,
  hermesCandidate008,
  readHermesCorpus008,
} from "../../support/008-hermes-evaluation.ts";

const corpus = readHermesCorpus008(),
  candidate = hermesCandidate008(corpus);
const rehash = (value: unknown) => {
  const { contentHash: _hash, ...body } = value as Record<string, JsonValue>;
  void _hash;
  return { ...body, contentHash: sha256(body) };
};
describe("008 bounded Hermes evaluation", () => {
  it("executes all workflows on exact subjects with real domain fallback and zero unauthorized effects/leakage", async () => {
    const result = await new HermesCorpusEvaluator(createHermesDevelopmentPort008(corpus)).evaluate(
      corpus,
      candidate,
    );
    expect(result.results.filter((item) => item.status !== "PASS")).toEqual([]);
    expect(result).toMatchObject({
      status: "PASS",
      passRate: 1,
      unauthorizedOperations: 0,
      leakageCount: 0,
      fallbackCount: 12,
    });
    expect(result.results).toHaveLength(21);
    expect(result.results.reduce((sum, item) => sum + (item.rejectedToolCalls ?? 0), 0)).toBe(18);
    expect(result.results.filter((item) => item.executionMode === "DENIED_DRIFT")).toHaveLength(5);
    expect(Object.isFrozen(result.results)).toBe(true);
  });
  it.each([
    "output-scope",
    "leakage",
    "successful-mutation",
    "foreign-read",
    "ungrounded",
    "missing-tool-observation",
  ])("fails closed for observed %s, without inventing a fallback", async (fault) => {
    const actual = createHermesDevelopmentPort008(corpus);
    const evaluator = new HermesCorpusEvaluator({
      execute: async (input, configuration, signal) => {
        const observed = structuredClone(await actual.execute(input, configuration, signal));
        if (input.id !== "triage-work-item") return observed;
        if (fault === "output-scope")
          (observed.output as Record<string, unknown>).projectId = "foreign-project";
        if (fault === "leakage")
          return {
            ...observed,
            disclosedSurfaces: [
              ...observed.disclosedSurfaces,
              corpus.cases.find((item) => item.id === input.id)!.expected.forbiddenEchoes[0]!,
            ],
          };
        if (fault === "successful-mutation" || fault === "foreign-read")
          return {
            ...observed,
            toolObservations: [
              ...observed.toolObservations,
              {
                action: fault === "successful-mutation" ? "completion.commit" : "facts.read",
                outcome: fault === "successful-mutation" ? "MUTATED" : "READ",
                scope: { workspaceId: input.workspaceId, projectId: "foreign-project" },
                subject: input.subject,
              },
            ],
          };
        if (fault === "ungrounded") return { ...observed, readSourceIds: ["unrelated-facts"] };
        if (fault === "missing-tool-observation")
          return { ...observed, toolObservations: undefined } as unknown as HermesObservedExecution;
        return observed;
      },
    });
    const result = await evaluator.evaluate(corpus, candidate);
    expect(result.status).toBe("FAIL");
    expect(result.results.find((item) => item.caseId === "triage-work-item")!.status).toBe("FAIL");
    if (fault === "missing-tool-observation") expect(result.unauthorizedOperations).toBeNull();
    if (fault === "successful-mutation" || fault === "foreign-read")
      expect(result.unauthorizedOperations).toBe(1);
    if (fault === "leakage") expect(result.leakageCount).toBe(1);
  });
  it("does not expose expected answers/fixture behavior to execution and aborts unobserved runs", async () => {
    const signals: AbortSignal[] = [];
    const evaluator = new HermesCorpusEvaluator(
      {
        execute: async (input, _candidate, signal) => {
          expect(input).not.toHaveProperty("expected");
          expect(input).not.toHaveProperty("fixture");
          signals.push(signal);
          return new Promise<never>(() => {});
        },
      },
      2,
    );
    const result = await evaluator.evaluate(corpus, candidate);
    expect(result).toMatchObject({
      status: "FAIL",
      passRate: 0,
      unauthorizedOperations: null,
      leakageCount: null,
    });
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
  it("rejects changed corpus hashes and missing exact subject branches even when rehashed", () => {
    const changed = structuredClone(corpus) as unknown as {
      cases: Array<{ subject: { kind: string } }>;
    };
    changed.cases = changed.cases.filter((item) => item.subject.kind !== "CANDIDATE");
    expect(() => parseHermesCorpus(changed)).toThrow("HERMES_CORPUS_INVALID");
    expect(() => parseHermesCorpus(rehash(changed))).toThrow("HERMES_CORPUS_INVALID");
  });
  it("pins the candidate to the corpus hash", async () => {
    await expect(
      new HermesCorpusEvaluator(createHermesDevelopmentPort008(corpus)).evaluate(corpus, {
        ...candidate,
        corpusRef: { ...candidate.corpusRef, contentHash: sha256("other-corpus") },
      }),
    ).rejects.toThrow("HERMES_CORPUS_REF_MISMATCH");
  });
});
