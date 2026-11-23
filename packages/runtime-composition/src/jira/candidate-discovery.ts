import { createHash } from "node:crypto";

import { type JsonValue, sha256 } from "@awp/platform-contracts";

export interface AuthoritativeJiraCandidateFact {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly connectionId: string;
  readonly externalEntityId: string;
  readonly externalVersion: string;
  readonly title: string;
  readonly issueType: string;
  readonly status: string;
  readonly labels: readonly string[];
  readonly classificationKey: string;
  readonly observedAt: Date;
}
export interface CandidateObservationPort {
  discoverOrObserve(
    input: Readonly<{
      id: string;
      workspaceId: string;
      projectId: string;
      deduplicationKey: string;
      sourceFingerprint: string;
      sourceEntityVersion: string;
      minimalSummary: JsonValue;
      expiresAt: Date;
      actionProvenanceRef: string;
      observedAt: Date;
    }>,
  ): Promise<unknown>;
}
const uuid = (value: string): string => {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
};
export class JiraCandidateDiscovery {
  constructor(
    private readonly candidates: CandidateObservationPort,
    private readonly trigger: Readonly<{
      issueTypes: readonly string[];
      statuses: readonly string[];
      labelsAny: readonly string[];
    }>,
    private readonly ttlMs = 7 * 86_400_000,
  ) {}
  async discover(fact: AuthoritativeJiraCandidateFact) {
    const triggered =
      this.trigger.issueTypes.includes(fact.issueType) &&
      this.trigger.statuses.includes(fact.status) &&
      (this.trigger.labelsAny.length === 0 ||
        fact.labels.some((label) => this.trigger.labelsAny.includes(label)));
    if (!triggered) return Object.freeze({ status: "NOT_TRIGGERED" as const });
    const deduplicationKey = `JIRA:${fact.connectionId}:${fact.externalEntityId}`;
    const sourceFingerprint = sha256({
      externalVersion: fact.externalVersion,
      title: fact.title,
      issueType: fact.issueType,
      status: fact.status,
      labels: [...fact.labels].sort(),
      classificationKey: fact.classificationKey,
    });
    const candidateId = uuid(`${fact.workspaceId}:${fact.projectId}:${deduplicationKey}`);
    const result = await this.candidates.discoverOrObserve({
      id: candidateId,
      workspaceId: fact.workspaceId,
      projectId: fact.projectId,
      deduplicationKey,
      sourceFingerprint,
      sourceEntityVersion: fact.externalVersion,
      minimalSummary: {
        title: fact.title,
        sourceRef: {
          kind: "jira-issue",
          id: fact.externalEntityId,
          version: fact.externalVersion,
          contentHash: sourceFingerprint,
        },
      },
      expiresAt: new Date(fact.observedAt.getTime() + this.ttlMs),
      actionProvenanceRef: `candidate-discovery:${candidateId}:${fact.externalVersion}`,
      observedAt: fact.observedAt,
    });
    return Object.freeze({ status: "OBSERVED" as const, candidateId, result });
  }
}
