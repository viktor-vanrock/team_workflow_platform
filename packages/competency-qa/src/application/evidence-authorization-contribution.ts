export interface QaEvidenceAuthorizationRequest {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly classificationRank: number;
  readonly revoked: boolean;
  readonly operation?:
    | "ARTIFACT_METADATA"
    | "ARTIFACT_CONTENT"
    | "MANIFEST_VERIFY"
    | "PACKAGE_VERIFY"
    | "EVIDENCE_EXPORT";
}

export function createQaEvidenceAuthorizationContribution(
  input: Readonly<{
    liveAuthorization: (
      request: QaEvidenceAuthorizationRequest,
    ) => Promise<Readonly<{ allowed: boolean }>>;
    onAuthorizedStorageAccess?: () => void;
  }>,
) {
  return Object.freeze({
    key: "competency-qa.evidence-authorization@1" as const,
    async authorize(
      request: QaEvidenceAuthorizationRequest,
    ): Promise<Readonly<{ allowed: boolean; reason?: string }>> {
      const decision = await input.liveAuthorization(request);
      if (!decision.allowed)
        return Object.freeze({ allowed: false, reason: "QA_EVIDENCE_ACCESS_DENIED" });
      input.onAuthorizedStorageAccess?.();
      return Object.freeze({ allowed: true });
    },
  });
}

export interface QaArtifactPolicyRequest {
  readonly context: Readonly<{
    readonly actor: Readonly<{ kind: "HUMAN" | "SERVICE"; principalId: string }>;
    readonly scope: Readonly<
      | { kind: "WORKSPACE"; workspaceId: string }
      | { kind: "PROJECT"; workspaceId: string; projectId: string }
    >;
  }>;
  readonly artifact: Readonly<{
    workspaceId: string;
    projectId: string;
    artifactKind: string;
    classification: Readonly<{ key: string; rank: number }>;
  }>;
  readonly operation: "READ_METADATA" | "STREAM_CONTENT";
}

/** Pack-owned restriction layered after the generic live scope/classification policy. */
export function createQaArtifactAuthorizationContribution(
  input: Readonly<{
    liveAuthorization?: (request: QaArtifactPolicyRequest) => Promise<boolean>;
  }> = {},
) {
  return Object.freeze({
    componentRef: "competency-qa.artifact-authorization@1" as const,
    matches: (request: QaArtifactPolicyRequest) => request.artifact.artifactKind === "QA_EVIDENCE",
    async authorize(request: QaArtifactPolicyRequest) {
      const projectScope =
        request.context.scope.kind === "PROJECT" ? request.context.scope : undefined;
      const baseAllowed =
        request.context.actor.kind === "HUMAN" &&
        projectScope?.workspaceId === request.artifact.workspaceId &&
        projectScope.projectId === request.artifact.projectId;
      const liveAllowed =
        baseAllowed && (input.liveAuthorization ? await input.liveAuthorization(request) : true);
      return liveAllowed
        ? Object.freeze({ allowed: true as const, reason: "ALLOW" as const })
        : Object.freeze({ allowed: false as const, reason: "EXPLICIT_DENY" as const });
    },
  });
}
