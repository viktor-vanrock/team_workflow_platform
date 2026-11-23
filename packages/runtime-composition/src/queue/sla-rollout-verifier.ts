import type { DataSource } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  type CompleteOperationalObservation,
  type ConfirmedJiraProjectionRef,
  type JiraStatusMappingRef,
  type OperationalProjectionRevision,
  type QueueVersionedContentRef,
  reduceOperationalProjection,
  type SlaGoal,
} from "@awp/platform-core";
import {
  SlaClockRepository,
  type SlaRolloutAuthorityVerificationReceipt,
  SlaRolloutVerificationRepository,
  TypeOrmOperationalAuthorityRepository,
} from "@awp/platform-persistence-typeorm";

export interface SlaRolloutCurrentAuthority {
  readonly projection: OperationalProjectionRevision;
  readonly projectionRef: ConfirmedJiraProjectionRef;
}

export interface SlaRolloutVerifierPorts {
  currentClock(
    input: Readonly<{ workspaceId: string; projectId: string; workItemId: string; goal: SlaGoal }>,
  ): Promise<boolean>;
  currentReceipt(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      workItemId: string;
      goal: SlaGoal;
      policyEnableEpochRef: QueueVersionedContentRef;
    }>,
  ): Promise<SlaRolloutAuthorityVerificationReceipt | undefined>;
  currentAuthority(
    input: Readonly<{ workspaceId: string; projectId: string; workItemId: string }>,
  ): Promise<SlaRolloutCurrentAuthority | undefined>;
  readAuthoritative(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      workItemId: string;
      current: SlaRolloutCurrentAuthority;
      mappingRef: JiraStatusMappingRef;
    }>,
  ): Promise<CompleteOperationalObservation>;
  appendReceipt(
    input: Readonly<{
      receipt: SlaRolloutAuthorityVerificationReceipt;
    }>,
  ): Promise<
    Readonly<{
      outcome: "APPENDED" | "NO_OP_DUPLICATE";
      receipt: SlaRolloutAuthorityVerificationReceipt;
    }>
  >;
}

export type SlaRolloutVerificationResult =
  | Readonly<{
      state: "VERIFIED";
      replayed: boolean;
      receipt: SlaRolloutAuthorityVerificationReceipt;
      startSourceRef: Readonly<{
        sourceType: "SLA_ROLLOUT_AUTHORITY_VERIFICATION";
        sourceId: string;
        sourceVersion: 1;
        semanticHash: SlaRolloutAuthorityVerificationReceipt["semanticHash"];
        confirmedAt: string;
      }>;
    }>
  | Readonly<{ state: "ALREADY_STARTED" }>
  | Readonly<{
      state: "ROLLOUT_CONFIRMATION_REQUIRED";
      reason:
        | "FEATURE_DISABLED"
        | "NO_CONFIRMED_PROJECTION"
        | "JIRA_READ_UNAVAILABLE"
        | "STATUS_NOT_CONFIGURED"
        | "MAPPING_MISMATCH"
        | "AUTHORITATIVE_STATE_CHANGED"
        | "AUTHORITY_SCOPE_MISMATCH"
        | "CLOCK_SKEW";
    }>;

export interface VerifySlaRolloutInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly goal: SlaGoal;
  readonly rolloutEnabled: boolean;
  readonly configuredStartNormalizedStatuses: readonly string[];
  readonly policyEnableEpochRef: QueueVersionedContentRef;
  readonly policyFacetRef: QueueVersionedContentRef;
  readonly calendarRef: QueueVersionedContentRef;
  readonly mappingRef: JiraStatusMappingRef;
  readonly verifierRunRef: QueueVersionedContentRef;
}

const verified = (
  receipt: SlaRolloutAuthorityVerificationReceipt,
  replayed: boolean,
): SlaRolloutVerificationResult =>
  Object.freeze({
    state: "VERIFIED" as const,
    replayed,
    receipt,
    startSourceRef: Object.freeze({
      sourceType: "SLA_ROLLOUT_AUTHORITY_VERIFICATION" as const,
      sourceId: receipt.receiptId,
      sourceVersion: 1 as const,
      semanticHash: receipt.semanticHash,
      confirmedAt: receipt.confirmedAt,
    }),
  });

/**
 * Verifies already-qualifying rollout items without changing Jira projection
 * history. Only a reducer DUPLICATE can create the one-time start authority.
 */
export class SlaRolloutVerifier {
  constructor(
    private readonly ports: SlaRolloutVerifierPorts,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async verify(input: VerifySlaRolloutInput): Promise<SlaRolloutVerificationResult> {
    if (!input.rolloutEnabled)
      return Object.freeze({ state: "ROLLOUT_CONFIRMATION_REQUIRED", reason: "FEATURE_DISABLED" });
    if (
      input.mappingRef.sourceType !== "JIRA_STATUS_MAPPING_REVISION" ||
      input.configuredStartNormalizedStatuses.length === 0 ||
      new Set(input.configuredStartNormalizedStatuses).size !==
        input.configuredStartNormalizedStatuses.length
    ) {
      throw new Error("SLA_ROLLOUT_CONFIGURATION_INVALID");
    }
    const alreadyStarted = await this.ports.currentClock(input);
    if (alreadyStarted) return Object.freeze({ state: "ALREADY_STARTED" });
    const existing = await this.ports.currentReceipt(input);
    if (existing) return verified(existing, true);
    const current = await this.ports.currentAuthority(input);
    if (!current)
      return Object.freeze({
        state: "ROLLOUT_CONFIRMATION_REQUIRED",
        reason: "NO_CONFIRMED_PROJECTION",
      });
    if (
      !current.projectionRef.sourceId ||
      current.projectionRef.semanticHash !== current.projection.authorityFieldsHash
    ) {
      return Object.freeze({
        state: "ROLLOUT_CONFIRMATION_REQUIRED",
        reason: "AUTHORITY_SCOPE_MISMATCH",
      });
    }
    if (
      current.projection.mappingRef.id !== input.mappingRef.sourceId ||
      current.projection.mappingRef.version !== input.mappingRef.sourceVersion
    ) {
      return Object.freeze({ state: "ROLLOUT_CONFIRMATION_REQUIRED", reason: "MAPPING_MISMATCH" });
    }
    let authoritative: CompleteOperationalObservation;
    try {
      authoritative = await this.ports.readAuthoritative({
        ...input,
        current,
        mappingRef: input.mappingRef,
      });
    } catch {
      return Object.freeze({
        state: "ROLLOUT_CONFIRMATION_REQUIRED",
        reason: "JIRA_READ_UNAVAILABLE",
      });
    }
    if (authoritative.externalEntityId !== current.projection.externalEntityId) {
      return Object.freeze({
        state: "ROLLOUT_CONFIRMATION_REQUIRED",
        reason: "AUTHORITY_SCOPE_MISMATCH",
      });
    }
    if (
      authoritative.mappingRef.id !== input.mappingRef.sourceId ||
      authoritative.mappingRef.version !== input.mappingRef.sourceVersion
    ) {
      return Object.freeze({ state: "ROLLOUT_CONFIRMATION_REQUIRED", reason: "MAPPING_MISMATCH" });
    }
    const reduction = reduceOperationalProjection(current.projection, authoritative);
    if (reduction.disposition !== "DUPLICATE") {
      return Object.freeze({
        state: "ROLLOUT_CONFIRMATION_REQUIRED",
        reason: "AUTHORITATIVE_STATE_CHANGED",
      });
    }
    if (!input.configuredStartNormalizedStatuses.includes(authoritative.normalizedStatus)) {
      return Object.freeze({
        state: "ROLLOUT_CONFIRMATION_REQUIRED",
        reason: "STATUS_NOT_CONFIGURED",
      });
    }
    const confirmedAt = this.now();
    if (
      !Number.isFinite(Date.parse(confirmedAt)) ||
      !Number.isFinite(Date.parse(authoritative.observedAt)) ||
      Date.parse(confirmedAt) < Date.parse(authoritative.observedAt)
    ) {
      return Object.freeze({ state: "ROLLOUT_CONFIRMATION_REQUIRED", reason: "CLOCK_SKEW" });
    }
    const receiptId = crypto.randomUUID();
    const body = Object.freeze({
      schemaVersion: "sla-rollout-authority-verification@1.0.0" as const,
      receiptId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      workItemId: input.workItemId,
      goal: input.goal,
      policyEnableEpochRef: Object.freeze({ ...input.policyEnableEpochRef }),
      policyFacetRef: Object.freeze({ ...input.policyFacetRef }),
      calendarRef: Object.freeze({ ...input.calendarRef }),
      mappingRef: Object.freeze({ ...input.mappingRef }),
      operationalProjectionRef: Object.freeze({ ...current.projectionRef }),
      externalRevisionToken: authoritative.externalRevisionToken,
      authorityFieldsHash:
        authoritative.authorityFieldsHash as SlaRolloutAuthorityVerificationReceipt["authorityFieldsHash"],
      observedNormalizedStatus: authoritative.normalizedStatus,
      providerObservedAt: authoritative.observedAt,
      verifierRunRef: Object.freeze({ ...input.verifierRunRef }),
      reducerDisposition: "DUPLICATE" as const,
      confirmedAt,
    });
    const receipt: SlaRolloutAuthorityVerificationReceipt = Object.freeze({
      ...body,
      semanticHash: sha256(body as unknown as JsonValue),
    });
    const stored = await this.ports.appendReceipt({ receipt });
    return verified(stored.receipt, stored.outcome === "NO_OP_DUPLICATE");
  }
}

export function createPostgresSlaRolloutVerifier(
  input: Readonly<{
    source: DataSource;
    readAuthoritative: SlaRolloutVerifierPorts["readAuthoritative"];
    now?: () => string;
  }>,
): SlaRolloutVerifier {
  const receipts = new SlaRolloutVerificationRepository(input.source);
  const clocks = new SlaClockRepository(input.source);
  const authority = new TypeOrmOperationalAuthorityRepository(input.source);
  return new SlaRolloutVerifier(
    {
      currentClock: async (value) =>
        (await clocks.currentClock(
          { kind: "PROJECT", workspaceId: value.workspaceId, projectId: value.projectId },
          value.workItemId,
          value.goal,
        )) !== undefined,
      currentReceipt: async (value) =>
        await receipts.currentForEpoch({
          scope: { kind: "PROJECT", workspaceId: value.workspaceId, projectId: value.projectId },
          workItemId: value.workItemId,
          goal: value.goal,
          policyEnableEpochHash: value.policyEnableEpochRef.semanticHash,
        }),
      currentAuthority: async (value) => {
        const current = await authority.confirmedProjectionForWorkItem(value, value.workItemId);
        if (!current) return undefined;
        return Object.freeze({
          projection: Object.freeze({
            ...current.snapshot,
            revision: current.revision,
            appliedAt: current.confirmedAt,
          }),
          projectionRef: Object.freeze({
            sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION" as const,
            sourceId: current.projectionId,
            sourceVersion: current.revision,
            semanticHash: current.authorityFieldsHash,
            observedAt: current.observedAt,
            confirmedAt: current.confirmedAt,
          }),
        });
      },
      readAuthoritative: input.readAuthoritative,
      appendReceipt: async ({ receipt }) =>
        await receipts.appendReceipt({
          scope: {
            kind: "PROJECT",
            workspaceId: receipt.workspaceId,
            projectId: receipt.projectId,
          },
          receipt,
        }),
    },
    input.now,
  );
}
