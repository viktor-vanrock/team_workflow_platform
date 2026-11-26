import { describe, expect, it } from "vitest";

import {
  corporateJiraObservationMappings,
  normalizeCorporateJiraObservation,
} from "../../../packages/runtime-composition/src/jira/corporate-issue-observation.ts";

describe("corporate Jira observations", () => {
  const ref = { id: "ref", version: 1 };
  const input = {
    issue: {
      id: "100",
      key: "QA-100",
      updated: "2026-01-01T00:00:00.000Z",
      changelogId: "23",
      fields: { status: { id: "17", name: "In progress" }, requester: { accountId: "jira-user" } },
    },
    statusMapping: { "17": "IN_PROGRESS" },
    expectedExternalEntityId: "100",
    observationId: "observation",
    observedAt: "2026-01-01T00:00:01.000Z",
    source: "RECONCILIATION_READ" as const,
    profileRef: ref,
    mappingRef: ref,
    connectionRef: ref,
    adapterFamily: "jira-cloud-v3",
    adapterContractVersion: "1.0.0",
  };
  it("uses the supplied status mapping and preserves exact configuration references", () => {
    const result = normalizeCorporateJiraObservation(input);
    expect(result.normalizedStatus).toBe("IN_PROGRESS");
    expect(result.requester).toEqual({ externalPrincipalId: "jira-user" });
    expect(result.mappingRef).toEqual(ref);
    expect(result.providerChangelogId).toBe("23");
  });
  it("rejects unmapped, invalid and cross-issue observations", () => {
    expect(() => normalizeCorporateJiraObservation({ ...input, statusMapping: {} })).toThrow(
      "JIRA_STATUS_MAPPING_REQUIRED",
    );
    expect(() =>
      normalizeCorporateJiraObservation({ ...input, statusMapping: { "17": "PROVIDER_STATE" } }),
    ).toThrow("CORPORATE_JIRA_STATUS_MAPPING_INVALID");
    expect(() =>
      normalizeCorporateJiraObservation({ ...input, expectedExternalEntityId: "other" }),
    ).toThrow("CORPORATE_JIRA_OBSERVATION_INVALID");
  });
  it("extracts mappings from the existing Jira profile and rejects duplicate ids", () => {
    const profile = {
      schemaVersion: 1,
      logicalRole: "QA_REQUEST_AUTHORITY",
      statusMappings: [
        { rawStatusId: "17", rawStatusName: "Working", normalizedStatus: "IN_PROGRESS" },
      ],
      priorityMappings: [{ priorityId: "4", priorityName: "Medium", normalizedKey: "MEDIUM" }],
    };
    expect(corporateJiraObservationMappings(profile)).toEqual({
      statusMapping: { "17": "IN_PROGRESS" },
      priorityMapping: { "4": "MEDIUM" },
    });
    expect(() =>
      corporateJiraObservationMappings({
        ...profile,
        statusMappings: [...profile.statusMappings, ...profile.statusMappings],
      }),
    ).toThrow("CORPORATE_JIRA_PROFILE_MAPPING_INVALID");
  });
});
