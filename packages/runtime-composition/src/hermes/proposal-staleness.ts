export interface ProposalStalenessPort {
  markStale(
    workspaceId: string,
    projectId: string,
    id: string,
    expectedContentHash: string,
    reasonCode?: string,
  ): Promise<void>;
}

export async function enforceProposalFreshness(
  input: Readonly<{
    workspaceId: string;
    projectId: string;
    id: string;
    contentHash: string;
    sourceFactSetHash: string;
    currentFactSetHash: string;
    inputFingerprint?: string;
    currentInputFingerprint?: string;
    ruleVersion?: string;
    currentRuleVersion?: string;
    skillVersion?: string;
    currentSkillVersion?: string;
    sourceAuthorized?: boolean;
    state: string;
    expiresAt: Date;
    now: Date;
    repository: ProposalStalenessPort;
  }>,
) {
  if (input.state !== "CURRENT") throw new Error("PROPOSAL_NOT_CURRENT");
  const reasonCode =
    input.now >= input.expiresAt
      ? "EXPIRED"
      : input.sourceAuthorized === false
        ? "SOURCE_REVOKED"
        : input.ruleVersion !== undefined &&
            input.currentRuleVersion !== undefined &&
            input.ruleVersion !== input.currentRuleVersion
          ? "PROFILE_CHANGED"
          : input.skillVersion !== undefined &&
              input.currentSkillVersion !== undefined &&
              input.skillVersion !== input.currentSkillVersion
            ? "BINDING_CHANGED"
            : (input.inputFingerprint ?? input.sourceFactSetHash) !==
                (input.currentInputFingerprint ?? input.currentFactSetHash)
              ? "SOURCE_CHANGED"
              : undefined;
  if (!reasonCode) return Object.freeze({ state: "CURRENT" as const });
  await input.repository.markStale(
    input.workspaceId,
    input.projectId,
    input.id,
    input.contentHash,
    reasonCode,
  );
  return Object.freeze({ state: "STALE" as const, reasonCode });
}
