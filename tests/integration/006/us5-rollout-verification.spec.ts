import { describe, expect, it, vi } from "vitest";

import { type JsonValue, sha256 } from "../../../packages/platform-contracts/src/index.ts";
import type {
  CompleteOperationalObservation,
  OperationalProjectionRevision,
} from "../../../packages/platform-core/src/index.ts";
import {
  type SlaRolloutAuthorityVerificationReceipt,
  SlaRolloutVerificationRepository,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  SlaRolloutVerifier,
  type SlaRolloutVerifierPorts,
} from "../../../packages/runtime-composition/src/index.ts";
import { policyIds } from "../../helpers/006/policy-fixture.ts";
import { digest } from "../../helpers/006/triage-fixture.ts";

const id = (suffix: string): string => `63000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const mappingRef = Object.freeze({
  sourceType: "JIRA_STATUS_MAPPING_REVISION" as const,
  sourceId: id("1"),
  sourceVersion: 3,
  semanticHash: digest("mapping"),
});
const policyEnableEpochRef = Object.freeze({
  id: id("2"),
  version: 1,
  semanticHash: digest("policy-enable-epoch"),
});
const policyFacetRef = Object.freeze({
  id: id("3"),
  version: 5,
  semanticHash: digest("policy-facet"),
});
const calendarRef = Object.freeze({ id: id("4"), version: 2, semanticHash: digest("calendar") });
const verifierRunRef = Object.freeze({
  id: id("5"),
  version: 1,
  semanticHash: digest("verifier-run"),
});

function observation(
  overrides: Partial<CompleteOperationalObservation> = {},
): CompleteOperationalObservation {
  return Object.freeze({
    observationId: id("10"),
    source: "RECONCILIATION_READ",
    externalEntityId: "jira-10001",
    externalDisplayKey: "QA-101",
    externalRevisionToken: "jira:ready:r7",
    authorityFieldsHash: digest("jira-ready-authority"),
    providerUpdatedAt: "2026-08-10T08:00:00.000Z",
    providerChangelogId: "7",
    observedAt: "2026-09-10T09:59:00.000Z",
    rawStatus: { id: "10002", name: "Ready" },
    normalizedStatus: "READY",
    blockReason: null,
    requester: { externalPrincipalId: "requester" },
    assignee: null,
    priority: null,
    dueDate: null,
    profileRef: { id: id("11"), version: 1 },
    mappingRef: { id: mappingRef.sourceId, version: mappingRef.sourceVersion },
    connectionRef: { id: id("12"), version: 1 },
    adapterFamily: "JIRA_CLOUD",
    adapterContractVersion: "1.0.0",
    ...overrides,
  });
}

function currentAuthority(value = observation()) {
  const projection: OperationalProjectionRevision = Object.freeze({
    ...value,
    revision: 4,
    appliedAt: "2026-08-10T08:01:00.000Z",
  });
  return Object.freeze({
    projection,
    projectionRef: Object.freeze({
      sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION" as const,
      sourceId: id("13"),
      sourceVersion: projection.revision,
      semanticHash: projection.authorityFieldsHash as `sha256:${string}`,
      observedAt: projection.observedAt,
      confirmedAt: projection.appliedAt,
    }),
  });
}

const request = Object.freeze({
  workspaceId: policyIds.workspace,
  projectId: policyIds.projectA,
  workItemId: id("20"),
  goal: "READY_TO_FIRST_QA_START" as const,
  rolloutEnabled: true,
  configuredStartNormalizedStatuses: Object.freeze(["READY", "PLANNED"]),
  policyEnableEpochRef,
  policyFacetRef,
  calendarRef,
  mappingRef,
  verifierRunRef,
});

function ports(authoritative: () => Promise<CompleteOperationalObservation>) {
  const receipts = new Map<string, SlaRolloutAuthorityVerificationReceipt>();
  const projectionHistory = [currentAuthority().projection];
  const key = (value: { goal: string; policyEnableEpochRef: { semanticHash: string } }) =>
    `${value.goal}:${value.policyEnableEpochRef.semanticHash}`;
  const currentAuthorityPort = vi.fn().mockResolvedValue(currentAuthority());
  const readAuthoritative = vi.fn(authoritative);
  const appendReceipt = vi.fn(
    async ({ receipt }: Readonly<{ receipt: SlaRolloutAuthorityVerificationReceipt }>) => {
      const receiptKey = `${receipt.goal}:${receipt.policyEnableEpochRef.semanticHash}`;
      const existing = receipts.get(receiptKey);
      if (existing) return { outcome: "NO_OP_DUPLICATE" as const, receipt: existing };
      receipts.set(receiptKey, receipt);
      return { outcome: "APPENDED" as const, receipt };
    },
  );
  const value: SlaRolloutVerifierPorts = {
    currentClock: vi.fn().mockResolvedValue(false),
    currentReceipt: vi.fn(async (input) => receipts.get(key(input))),
    currentAuthority: currentAuthorityPort,
    readAuthoritative,
    appendReceipt,
  };
  return {
    value,
    receipts,
    projectionHistory,
    currentAuthorityPort,
    readAuthoritative,
    appendReceipt,
  };
}

describe("US5 rollout authority verification", () => {
  it("accepts an authoritative reducer DUPLICATE at platform confirmation time without backdating or projection writes", async () => {
    const harness = ports(async () => observation());
    const verifier = new SlaRolloutVerifier(harness.value, () => "2026-09-10T10:00:00.000Z");
    const result = await verifier.verify(request);
    expect(result).toMatchObject({
      state: "VERIFIED",
      replayed: false,
      receipt: {
        reducerDisposition: "DUPLICATE",
        providerObservedAt: "2026-09-10T09:59:00.000Z",
        confirmedAt: "2026-09-10T10:00:00.000Z",
      },
      startSourceRef: {
        sourceType: "SLA_ROLLOUT_AUTHORITY_VERIFICATION",
        confirmedAt: "2026-09-10T10:00:00.000Z",
      },
    });
    expect(result.state === "VERIFIED" && result.startSourceRef.confirmedAt).not.toBe(
      observation().providerUpdatedAt,
    );
    expect(harness.projectionHistory).toHaveLength(1);
    expect(harness.appendReceipt).toHaveBeenCalledOnce();
  });

  it("creates at most one receipt per Work Item/goal/policy epoch and skips the second provider read", async () => {
    const harness = ports(async () => observation());
    const verifier = new SlaRolloutVerifier(harness.value, () => "2026-09-10T10:00:00.000Z");
    await expect(verifier.verify(request)).resolves.toMatchObject({
      state: "VERIFIED",
      replayed: false,
    });
    await expect(verifier.verify(request)).resolves.toMatchObject({
      state: "VERIFIED",
      replayed: true,
    });
    await expect(
      verifier.verify({ ...request, goal: "READY_TO_SIGNED_VERDICT" }),
    ).resolves.toMatchObject({ state: "VERIFIED", replayed: false });
    expect(harness.receipts).toHaveLength(2);
    expect(harness.readAuthoritative).toHaveBeenCalledTimes(2);
  });

  it("gates changed authority, status mismatch, outage and disabled rollout without persisting receipts", async () => {
    const changed = ports(async () =>
      observation({
        externalRevisionToken: "jira:changed:r8",
        providerUpdatedAt: "2026-09-10T09:58:00.000Z",
      }),
    );
    await expect(new SlaRolloutVerifier(changed.value).verify(request)).resolves.toEqual({
      state: "ROLLOUT_CONFIRMATION_REQUIRED",
      reason: "AUTHORITATIVE_STATE_CHANGED",
    });
    expect(changed.appendReceipt).not.toHaveBeenCalled();

    const wrongStatusValue = observation({
      normalizedStatus: "IN_PROGRESS",
      rawStatus: { id: "3", name: "In Progress" },
      authorityFieldsHash: digest("in-progress"),
    });
    const wrongStatus = ports(async () => wrongStatusValue);
    wrongStatus.currentAuthorityPort.mockResolvedValue(currentAuthority(wrongStatusValue));
    await expect(new SlaRolloutVerifier(wrongStatus.value).verify(request)).resolves.toEqual({
      state: "ROLLOUT_CONFIRMATION_REQUIRED",
      reason: "STATUS_NOT_CONFIGURED",
    });
    expect(wrongStatus.appendReceipt).not.toHaveBeenCalled();

    const outage = ports(async () => {
      throw new Error("jira unavailable");
    });
    await expect(new SlaRolloutVerifier(outage.value).verify(request)).resolves.toEqual({
      state: "ROLLOUT_CONFIRMATION_REQUIRED",
      reason: "JIRA_READ_UNAVAILABLE",
    });
    await expect(
      new SlaRolloutVerifier(outage.value).verify({ ...request, rolloutEnabled: false }),
    ).resolves.toEqual({ state: "ROLLOUT_CONFIRMATION_REQUIRED", reason: "FEATURE_DISABLED" });
    expect(outage.appendReceipt).not.toHaveBeenCalled();
  });

  it("persists an immutable exact receipt and returns the winner of a same-epoch insert race", async () => {
    const authoritative = observation();
    const current = currentAuthority(authoritative);
    const receiptBody = {
      schemaVersion: "sla-rollout-authority-verification@1.0.0" as const,
      receiptId: id("30"),
      workspaceId: request.workspaceId,
      projectId: request.projectId,
      workItemId: request.workItemId,
      goal: request.goal,
      policyEnableEpochRef,
      policyFacetRef,
      calendarRef,
      mappingRef,
      operationalProjectionRef: current.projectionRef,
      externalRevisionToken: authoritative.externalRevisionToken,
      authorityFieldsHash: authoritative.authorityFieldsHash as `sha256:${string}`,
      observedNormalizedStatus: authoritative.normalizedStatus,
      providerObservedAt: authoritative.observedAt,
      verifierRunRef,
      reducerDisposition: "DUPLICATE" as const,
      confirmedAt: "2026-09-10T10:00:00.000Z",
    };
    const receipt: SlaRolloutAuthorityVerificationReceipt = Object.freeze({
      ...receiptBody,
      semanticHash: sha256(receiptBody as unknown as JsonValue),
    });
    let inserted = false;
    const manager = {
      query: vi.fn(async (sql: string) => {
        if (
          sql
            .replace(/\s+/gu, " ")
            .trim()
            .startsWith("INSERT INTO sla_rollout_verification_receipts")
        ) {
          if (inserted) return [];
          inserted = true;
          return [{ public_receipt: receipt }];
        }
        return [{ public_receipt: receipt }];
      }),
    };
    const source = {
      transaction: vi.fn(
        async (_isolation: string, work: (value: typeof manager) => Promise<unknown>) =>
          await work(manager),
      ),
    };
    const repository = new SlaRolloutVerificationRepository(source as never);
    const scope = {
      kind: "PROJECT" as const,
      workspaceId: request.workspaceId,
      projectId: request.projectId,
    };
    await expect(repository.appendReceipt({ scope, receipt })).resolves.toMatchObject({
      outcome: "APPENDED",
      receipt,
    });
    await expect(repository.appendReceipt({ scope, receipt })).resolves.toMatchObject({
      outcome: "NO_OP_DUPLICATE",
      receipt,
    });
    expect(
      manager.query.mock.calls.filter(([sql]) =>
        sql.includes("INSERT INTO sla_rollout_verification_receipts"),
      ),
    ).toHaveLength(2);
  });
});
