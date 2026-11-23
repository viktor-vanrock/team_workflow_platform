import { type JsonValue, sha256 } from "@awp/platform-contracts";

export function qaWorkItemReadiness(
  input: Readonly<{
    workspaceId: string;
    projectId: string;
    workItemId: string;
    version: number;
    contentHash: string;
    facts: Readonly<Record<string, JsonValue>>;
    agentRunId: string;
    now: Date;
  }>,
) {
  const required = ["title", "acceptanceOutcome"] as const;
  const missing = required.filter((key) => !input.facts[key]);
  return Object.freeze({
    schemaVersion: "intake-completeness@1.0.0",
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    draftId: input.workItemId,
    revision: input.version,
    contentHash: input.contentHash,
    state: missing.length ? "INCOMPLETE" : "VALID",
    missingFields: missing,
    invalidFields: [],
    blockers: missing.map((fieldKey) => ({ code: "FIELD_MISSING", fieldKey })),
    inputFingerprint: sha256(input.facts as JsonValue),
    rulesRef: { key: "qa.dor", version: "1.0.0", hash: sha256({ required: [...required] }) },
    skillRef: {
      key: "qa-work-item-readiness",
      version: "1.0.0",
      hash: sha256({ key: "qa-work-item-readiness" }),
    },
    actionProvenanceRef: `agent-run:${input.agentRunId}`,
    createdAt: input.now.toISOString(),
  });
}
