import { readFileSync } from "node:fs";

import { assessQaIntakeCompleteness } from "../../packages/competency-qa/src/application/intake-completeness.ts";
import { deterministicQaResultReviewPreparation } from "../../packages/competency-qa/src/skills/qa-result-review-prep.ts";
import {
  qaTriageModelPolicy,
  type QaTriageV11FingerprintComponents,
  runQaTriageV11,
} from "../../packages/competency-qa/src/skills/qa-triage.ts";
import { type JsonValue, sha256 } from "../../packages/platform-contracts/src/index.ts";
import { type SkillDefinition } from "../../packages/platform-core/src/index.ts";
import {
  type HermesCorpus,
  type HermesEvaluationCandidate,
  type HermesEvaluationPort,
  hermesWorkflowSchemas,
  parseHermesCorpus,
  sameHermesEvaluationCandidate,
  sameHermesSubject,
} from "../../packages/runtime-composition/src/hermes/evaluation.ts";
import { HermesEvaluationContext } from "../../packages/runtime-composition/src/hermes/evaluation-context.ts";
import { PromptManifestBuilder } from "../../packages/runtime-composition/src/hermes/prompt-manifest-builder.ts";

export const readHermesCorpus008 = () =>
  parseHermesCorpus(
    JSON.parse(
      readFileSync(new URL("../fixtures/008/hermes-corpus.json", import.meta.url), "utf8"),
    ),
  );
export const hermesDevelopmentModelPolicy008 = Object.freeze({
  ...qaTriageModelPolicy,
  deadlineMs: 20,
});
export function hermesCandidate008(corpus: HermesCorpus): HermesEvaluationCandidate {
  const ref = (id: string, content: unknown) => ({
    id,
    version: 1,
    contentHash: sha256(content as JsonValue),
  });
  return {
    configurationRef: ref("hermes-development-policy", hermesDevelopmentModelPolicy008),
    modelRef: ref("synthetic-model", "bounded-development-fixture-v1"),
    promptRef: ref("minimized-prompt", "prompt-manifest-v1"),
    skillRef: ref("qa-evaluation-skills", hermesWorkflowSchemas),
    corpusRef: {
      id: "synthetic-hermes-corpus",
      version: 1,
      contentHash: corpus.contentHash as `sha256:${string}`,
    },
  };
}
/** Provider/authority are development fixtures. Domain skills, prompt minimization and grant gateway are actual implementations. */
export function createHermesDevelopmentPort008(
  corpus: HermesCorpus,
  selected = hermesCandidate008(corpus),
): HermesEvaluationPort {
  const fixtures = new Map(corpus.cases.map((item) => [item.id, structuredClone(item.fixture)]));
  return {
    async execute(input, candidate, signal) {
      if (!sameHermesEvaluationCandidate(selected, candidate))
        throw new Error("HERMES_CANDIDATE_NOT_LOADED");
      const fixture = fixtures.get(input.id);
      if (!fixture) throw new Error("HERMES_FIXTURE_MISSING");
      const authority = {
        currentSubject: async () =>
          fixture.behavior === "REVOKED" ? null : structuredClone(fixture.currentSubject),
        authorize: async (
          _principalId: string,
          scope: { workspaceId: string; projectId: string },
          subject: typeof input.subject,
          action: string,
        ) =>
          fixture.behavior !== "REVOKED" &&
          scope.workspaceId === input.workspaceId &&
          scope.projectId === input.projectId &&
          sameHermesSubject(subject, fixture.currentSubject) &&
          input.readActions.includes(action as "facts.read"),
        sourceAuthorized: async (_scope: unknown, _subject: unknown, id: string) =>
          fixture.allowedSourceIds.includes(id),
      };
      const context = new HermesEvaluationContext(input, authority, {
        humanId: "fixture-human",
        serviceId: "fixture-service",
        humanActions: input.readActions,
        serviceActions: input.readActions,
      });
      const currentSubject = await context.current();
      if (!sameHermesSubject(currentSubject, input.subject))
        return {
          mode: "DENIED_DRIFT",
          currentSubject,
          ...context.observations(),
          disclosedSurfaces: [],
          reasonCode: "SUBJECT_OR_RIGHTS_DRIFT",
        };
      const sources = await context.readSources();
      if (!sources.length) throw new Error("HERMES_AUTHORIZED_SOURCES_REQUIRED");
      const skill: SkillDefinition = {
        key: `qa-${input.workflow.toLowerCase()}`,
        version: "1.0.0",
        hash: sha256(hermesWorkflowSchemas[input.workflow]),
        allowedSubjects: [input.subject.kind],
        outputSchemaRef: {
          id: hermesWorkflowSchemas[input.workflow],
          version: 1,
          digest: sha256(hermesWorkflowSchemas[input.workflow]),
        },
        actionAllowlist: input.readActions.map((action) => ({ action, effectClass: "READ_ONLY" })),
        maxClassification: "INTERNAL",
      };
      const manifest = new PromptManifestBuilder().build({
        ...input,
        skill,
        facts: sources.flatMap((source) =>
          Object.entries(source.facts).map(([key, value]) => ({
            key,
            value,
            sourceKind: "QA_STATE" as const,
            sourceRef: source.id,
            sourceVersion: String(source.version),
            sourceHash: source.contentHash,
            classification: source.classification,
          })),
        ),
        allowedFactKeys: [
          "summary",
          "title",
          "requestKind",
          "requestedClassificationKey",
          "businessImpact",
        ],
        maximumClassification: "INTERNAL",
        createdAt: new Date("2026-09-04T10:00:00.000Z"),
      });
      const disclosedSurfaces = [JSON.stringify(manifest)];
      // Simulates tool calls requested by hostile retrieved/provider text; the actual gateway rejects them.
      for (const action of fixture.forbiddenToolActions) {
        let handlerReached = false;
        try {
          await context.invoke(action, input, input.subject, async () => {
            handlerReached = true;
          });
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "HERMES_CONTEXT_DENIED") throw error;
        }
        if (handlerReached) throw new Error("FORBIDDEN_HANDLER_REACHED");
      }
      const now = new Date("2026-09-04T10:00:00.000Z"),
        expiresAt = new Date("2026-09-04T11:00:00.000Z");
      let output: unknown,
        mode: "MODEL" | "DETERMINISTIC_FALLBACK" = "DETERMINISTIC_FALLBACK",
        reasonCode: string | undefined = "DETERMINISTIC_SKILL";
      if (input.workflow === "INTAKE")
        output = assessQaIntakeCompleteness(
          {
            ...input,
            draftId: input.subject.id,
            revision: input.subject.version,
            contentHash: input.subject.contentHash as `sha256:${string}`,
            content: sources[0]!.facts,
          },
          now,
        );
      else if (input.workflow === "EVIDENCE")
        output = deterministicQaResultReviewPreparation({
          ...input,
          workItemId: input.subject.id,
          workItemVersion: input.subject.version,
          workItemContentHash: input.subject.contentHash,
          evidenceManifestRefs: sources.map((source) => source.id),
          sessionReviewRefs: [],
          findingReviewRefs: [],
          agentRunId: `run-${input.id}`,
          now,
          expiresAt,
        });
      else {
        const { aggregateSnapshotHash: _aggregate, ...subject } = input.subject;
        void _aggregate;
        const component =
          input.subject.kind === "WORK_ITEM"
            ? { state: "UNKNOWN" as const, reasonCode: "NOT_OBSERVED" as const }
            : { state: "NOT_APPLICABLE" as const, reasonCode: "SUBJECT_NOT_WORK_ITEM" as const };
        const inputFingerprintComponents: QaTriageV11FingerprintComponents = {
          subject: {
            sourceType:
              subject.kind === "DRAFT"
                ? "INTAKE_DRAFT_REVISION"
                : subject.kind === "CANDIDATE"
                  ? "INTAKE_CANDIDATE_REVISION"
                  : "WORK_ITEM_REVISION",
            sourceId: subject.id,
            sourceVersion: subject.version,
            semanticHash: subject.contentHash,
          },
          jiraOperationalProjection: component,
          qaPlanningFacts: component,
          automationFacts: {
            state: "NOT_APPLICABLE",
            reasonCode:
              subject.kind === "WORK_ITEM" ? "AUTOMATION_NOT_CONFIGURED" : "SUBJECT_NOT_WORK_ITEM",
          },
        };
        const result = await runQaTriageV11(
          {
            ...input,
            subject,
            assessmentId: `assessment-${input.id}`,
            revision: 1,
            facts: sources.map((source) => ({
              sourceRef: source.id,
              sourceVersion: String(source.version),
              contentHash: source.contentHash,
              polarity: "UNKNOWN",
            })),
            inputFingerprintComponents,
            agentRunId: `run-${input.id}`,
            now,
            expiresAt,
          },
          fixture.behavior === "DISABLED"
            ? undefined
            : {
                propose: async (request) => {
                  if (fixture.behavior === "TIMEOUT")
                    return new Promise<never>((_resolve, reject) => {
                      request.signal.addEventListener(
                        "abort",
                        () => reject(new Error("MODEL_ABORTED")),
                        { once: true },
                      );
                    });
                  if (fixture.behavior === "OUTAGE")
                    throw new Error("SYNTHETIC_PROVIDER_UNAVAILABLE");
                  if (fixture.behavior === "INVALID_SCHEMA") return { proposal: "unvalidated" };
                  const proposed = structuredClone({
                    ...request.recommendationTemplate,
                    confidence: fixture.behavior === "LOW_CONFIDENCE" ? 0.1 : 0.9,
                  });
                  if (fixture.behavior === "FORGED_SCOPE") proposed.projectId = "foreign-project";
                  if (fixture.behavior === "FORGED_SOURCE")
                    proposed.facts = proposed.facts.map((fact) => ({
                      ...fact,
                      sourceRef: "foreign-source",
                    }));
                  return proposed;
                },
              },
          hermesDevelopmentModelPolicy008,
        );
        output = result.assessment;
        mode = result.executionMode;
        reasonCode = result.fallbackReason;
      }
      if (signal.aborted) throw new Error("HERMES_EVALUATION_ABORTED");
      return {
        mode,
        output,
        ...(reasonCode ? { reasonCode } : {}),
        currentSubject: await context.current(),
        ...context.observations(),
        disclosedSurfaces,
      };
    },
  };
}
