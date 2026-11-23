import { createHash } from "node:crypto";

import { type JsonValue, sha256 } from "@awp/platform-contracts";
import type { AgentRunSubject, SkillDefinition } from "@awp/platform-core";

export interface PromptFact {
  readonly sourceKind:
    "DRAFT" | "JIRA" | "MATTERMOST" | "GITLAB" | "QA_STATE" | "ARTIFACT_METADATA" | "POLICY_FACT";
  readonly sourceRef: string;
  readonly sourceVersion: string;
  readonly sourceHash: string;
  readonly classification: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  readonly key: string;
  readonly value: unknown;
}
const rank = { PUBLIC: 0, INTERNAL: 1, CONFIDENTIAL: 2, RESTRICTED: 3 } as const;
const forbidden =
  /password|token|cookie|credential|secret|authorization|raw.?history|attachment.?body/iu;
const versioned = (key: string) => Object.freeze({ key, version: "1.0.0", hash: sha256({ key }) });
export class PromptManifestBuilder {
  build(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      subject: AgentRunSubject;
      skill: SkillDefinition;
      facts: readonly PromptFact[];
      allowedFactKeys: readonly string[];
      maximumClassification: keyof typeof rank;
      createdAt: Date;
    }>,
  ) {
    if (!input.skill.allowedSubjects.includes(input.subject.kind))
      throw new Error("PROMPT_SUBJECT_DENIED");
    const allowed = new Set(input.allowedFactKeys);
    const segments = input.facts
      .filter(({ key }) => allowed.has(key))
      .map((fact) => {
        if (
          forbidden.test(fact.key) ||
          rank[fact.classification] > rank[input.maximumClassification]
        )
          throw new Error("PROMPT_FACT_DENIED");
        if (!(fact.value === null || ["string", "number", "boolean"].includes(typeof fact.value)))
          throw new Error("PROMPT_FACT_VALUE_NOT_MINIMIZED");
        const value =
          typeof fact.value === "string"
            ? fact.value
                .replace(
                  /(?:ignore previous|system prompt|developer message)/giu,
                  "[UNTRUSTED_INSTRUCTION_REMOVED]",
                )
                .slice(0, 4000)
            : fact.value;
        return Object.freeze({
          sourceKind: fact.sourceKind,
          sourceRef: fact.sourceRef,
          sourceVersion: fact.sourceVersion,
          sourceHash: fact.sourceHash,
          classification: fact.classification,
          trust: "UNTRUSTED" as const,
          sanitizedValue: value,
          sanitizationRuleRef: versioned("prompt.sanitize"),
        });
      });
    if (!segments.length) throw new Error("PROMPT_FACTS_REQUIRED");
    const classificationDecisionHash = sha256({
      maximumClassification: input.maximumClassification,
      facts: segments.map(({ sourceRef, classification }) => ({ sourceRef, classification })),
    } as JsonValue);
    const inputFingerprint = sha256({ subject: input.subject, segments } as unknown as JsonValue);
    const manifestId = createHash("sha256")
      .update(`${input.subject.id}:${input.subject.version}:${input.skill.key}:${inputFingerprint}`)
      .digest("hex")
      .slice(0, 32);
    return Object.freeze({
      schemaVersion: "prompt-manifest@1.0.0",
      manifestId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      subject: input.subject,
      agentDefinitionRef: versioned("hermes.qa"),
      skillRef: { key: input.skill.key, version: input.skill.version, hash: input.skill.hash },
      rulesRef: versioned(`${input.skill.key}.rules`),
      policyRef: versioned("qa.agent-policy"),
      promptTemplateRef: versioned(`${input.skill.key}.prompt`),
      factSegments: Object.freeze(segments),
      maximumClassification: input.maximumClassification,
      classificationDecisionHash,
      outputSchemaRef: input.skill.outputSchemaRef,
      inputFingerprint,
      createdAt: input.createdAt.toISOString(),
    });
  }
}
