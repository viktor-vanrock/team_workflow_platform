import { type JsonValue, sha256 } from "@awp/platform-contracts";

import type { QaProposalFact } from "./qa-triage.ts";

const ref = (key: string) => ({ key, version: "1.0.0", hash: sha256({ key }) });
export function deterministicQaSessionPlan(
  input: Readonly<{
    proposalId: string;
    workspaceId: string;
    projectId: string;
    workItemId: string;
    workItemVersion: number;
    workItemContentHash: string;
    revision: number;
    facts: readonly QaProposalFact[];
    environmentRef: string;
    agentRunId: string;
    now: Date;
    expiresAt: Date;
  }>,
) {
  if (!input.facts.length) throw new Error("SESSION_PLAN_FACTS_REQUIRED");
  const facts = input.facts.map(({ sourceRef, sourceVersion, contentHash }) => ({
    sourceRef,
    sourceVersion,
    contentHash,
  }));
  return Object.freeze({
    schemaVersion: "session-plan-proposal@1.0.0",
    proposalId: input.proposalId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    workItemId: input.workItemId,
    workItemVersion: input.workItemVersion,
    workItemContentHash: input.workItemContentHash,
    revision: input.revision,
    sessionSlices: [
      {
        mode: "MANUAL",
        goal: "Проверить подтверждённый acceptance outcome",
        environmentRef: input.environmentRef,
        definitionRefs: [],
      },
    ],
    facts,
    explanation: "Предложение не создаёт и не принимает Session.",
    confidence: 0,
    inputFingerprint: sha256({ workItemId: input.workItemId, facts } as JsonValue),
    rulesRef: ref("qa.session-plan"),
    skillRef: ref("qa-session-plan"),
    policyRef: ref("qa.agent-policy"),
    agentRunRef: input.agentRunId,
    actionProvenanceRef: `agent-run:${input.agentRunId}:session-plan`,
    state: "CURRENT",
    expiresAt: input.expiresAt.toISOString(),
    createdAt: input.now.toISOString(),
  });
}
