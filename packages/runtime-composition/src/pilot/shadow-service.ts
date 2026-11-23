import { type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";

export interface ShadowObservation {
  readonly observationId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly subjectRef: string;
  readonly proposedOutcome: string;
  readonly actualOutcome: string | null;
  readonly acceptanceState: "LOCAL_PROPOSAL" | "REJECTED";
  readonly notificationState: "LOCAL_SUPPRESSED";
  readonly observedAt: string;
  readonly contentHash: Sha256Digest;
}

export class PilotShadowService {
  readonly #observations: ShadowObservation[] = [];
  readonly #externalEffects: readonly never[] = Object.freeze([]);

  record(
    input: Omit<ShadowObservation, "acceptanceState" | "notificationState" | "contentHash"> &
      Readonly<{
        requestedExternalWrites: number;
        requestedAcceptance: "LOCAL_PROPOSAL" | "ACCEPTED_WORK_ITEM";
        scopeKind: "SHADOW" | "SANDBOX_CONFORMANCE";
      }>,
  ): ShadowObservation {
    if (input.scopeKind !== "SHADOW") throw new Error("PILOT_SHADOW_SCOPE_REQUIRED");
    if (input.requestedExternalWrites !== 0)
      throw new Error("PILOT_SHADOW_EXTERNAL_WRITE_FORBIDDEN");
    if (input.requestedAcceptance !== "LOCAL_PROPOSAL")
      throw new Error("PILOT_SHADOW_ACCEPTANCE_FORBIDDEN");
    if (
      !input.observationId ||
      !input.workspaceId ||
      !input.projectId ||
      !input.subjectRef ||
      Number.isNaN(Date.parse(input.observedAt))
    )
      throw new Error("PILOT_SHADOW_OBSERVATION_INVALID");
    const semantic = {
      observationId: input.observationId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      subjectRef: input.subjectRef,
      proposedOutcome: input.proposedOutcome,
      actualOutcome: input.actualOutcome,
      observedAt: input.observedAt,
    };
    const body = Object.freeze({
      ...structuredClone(semantic),
      acceptanceState: "LOCAL_PROPOSAL" as const,
      notificationState: "LOCAL_SUPPRESSED" as const,
    });
    const observation = Object.freeze({
      ...body,
      contentHash: sha256(body as unknown as JsonValue),
    });
    this.#observations.push(observation);
    return observation;
  }

  differences(): readonly Readonly<{
    observationId: string;
    differs: boolean;
    observationHash: Sha256Digest;
  }>[] {
    return Object.freeze(
      this.#observations.map((value) =>
        Object.freeze({
          observationId: value.observationId,
          differs: value.actualOutcome !== null && value.actualOutcome !== value.proposedOutcome,
          observationHash: value.contentHash,
        }),
      ),
    );
  }

  externalWriteCount(): number {
    return this.#externalEffects.length;
  }
  releasableNotificationCount(): number {
    return 0;
  }
}
