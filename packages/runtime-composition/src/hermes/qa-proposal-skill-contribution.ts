import { qaSkillCatalog } from "@awp/competency-qa";
import { designContractRegistry, sha256 } from "@awp/platform-contracts";
import type { SkillDefinition } from "@awp/platform-core";

import {
  qaAutomationReviewPacketSchemaId,
  qaAutomationReviewPacketSkillKey,
} from "./qa-automation-review-packet.ts";
import { qaSkillDefinitionSkeletons } from "./skill-registry.ts";

const keys = new Set([
  "qa-work-item-readiness",
  "qa-triage",
  "qa-session-plan",
  "qa-result-review-prep",
  "qa-defect-draft",
  "qa-dod-check",
]);

const baseReviewDefinition = qaSkillDefinitionSkeletons().find(
  ({ key }) => key === qaAutomationReviewPacketSkillKey,
)!;

export const qaAutomationReviewPacketSkillDefinition: SkillDefinition = Object.freeze({
  ...baseReviewDefinition,
  hash: sha256({
    key: qaAutomationReviewPacketSkillKey,
    version: baseReviewDefinition.version,
    outputSchemaId: qaAutomationReviewPacketSchemaId,
    proposalOnly: true,
    actions: baseReviewDefinition.actionAllowlist.map(({ action }) => action),
  }),
  outputSchemaRef: Object.freeze({
    id: qaAutomationReviewPacketSchemaId,
    version: 1,
    digest: sha256({ schema: qaAutomationReviewPacketSchemaId }),
  }),
});

export const qaTriageV11SkillDefinition: SkillDefinition = Object.freeze({
  key: "qa-triage",
  version: "1.1.0",
  hash: sha256({
    key: "qa-triage",
    version: "1.1.0",
    outputSchemaId: "urn:awp:schemas:004:triage-assessment:v1.1",
    outputProfile: "FACTORIZED_REQUIRED",
    proposalOnly: true,
    actions: ["facts.read"],
  }),
  allowedSubjects: Object.freeze(["DRAFT", "CANDIDATE", "WORK_ITEM"] as const),
  outputSchemaRef: Object.freeze({
    id: "urn:awp:schemas:004:triage-assessment:v1.1",
    version: 1,
    digest: designContractRegistry.digest("urn:awp:schemas:004:triage-assessment:v1.1"),
  }),
  actionAllowlist: Object.freeze([
    Object.freeze({ action: "facts.read", effectClass: "READ_ONLY" }),
  ]),
  maxClassification: "INTERNAL",
});

export const qaTriageV11ExecutionContract = Object.freeze({
  skillRef: "qa-triage@1.1.0",
  proposalOnly: true,
  actionAllowlist: Object.freeze(["facts.read"] as const),
  forbiddenAuthority: Object.freeze([
    "authorization",
    "accepted-rank",
    "jira-priority",
    "jira-due",
    "assignment",
  ] as const),
  deterministicFallback: "deterministicQaTriageV11",
  sourceDriftPolicy: "MARK_STALE_BEFORE_ACCEPT",
});

export function qaSkillDefinitionsWithQueueTriage(): readonly SkillDefinition[] {
  return Object.freeze([...qaSkillDefinitionSkeletons(), qaTriageV11SkillDefinition]);
}

export function qaSkillDefinitionsWithAutomationReviewPacket(): readonly SkillDefinition[] {
  return Object.freeze([
    ...qaSkillDefinitionSkeletons().map((definition) =>
      definition.key === qaAutomationReviewPacketSkillKey
        ? qaAutomationReviewPacketSkillDefinition
        : definition,
    ),
    qaTriageV11SkillDefinition,
  ]);
}

export const qaProposalSkillContribution = Object.freeze({
  key: "competency-qa.proposal-skills",
  catalog: Object.freeze(qaSkillCatalog.filter(({ key }) => keys.has(key))),
  definitions: Object.freeze(qaSkillDefinitionSkeletons().filter(({ key }) => keys.has(key))),
  optionalExtensions: Object.freeze([
    Object.freeze({
      key: "feature-005.automation-result-review-packet",
      definition: qaAutomationReviewPacketSkillDefinition,
      proposalOnly: true as const,
    }),
  ]),
  queueExtensions: Object.freeze([
    Object.freeze({
      key: "feature-006.factorized-triage",
      definition: qaTriageV11SkillDefinition,
      proposalOnly: true as const,
      deterministicFallback: true as const,
    }),
  ]),
});
