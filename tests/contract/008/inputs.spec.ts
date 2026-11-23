import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  canonicalInputHash008,
  validateInputPackage008,
} from "../../../tools/verification/feature-008-inputs.mts";

const example = () =>
  JSON.parse(
    readFileSync(new URL("../../../config/pilot/local-inputs.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;
const corporate = () => {
  const metadata: Record<string, Record<string, unknown>> = {
    "IN-01": {
      workspaceRef: "urn:workspace:pilot",
      projectRefs: ["urn:project:pilot"],
      workflowRef: "urn:jira:workflow",
      suiteRef: "urn:gitlab:suite",
      environmentRef: "urn:environment:non-prod",
      channelRefs: ["urn:mattermost:channel"],
    },
    "IN-02": {
      providers: [
        {
          type: "JIRA",
          edition: "data-center",
          version: "10.3",
          apiDialect: "rest-v2",
          authStrategy: "vault-oauth",
          documentRef: "urn:doc:jira",
          permissionsRef: "urn:permission:jira",
        },
        {
          type: "GITLAB",
          edition: "self-managed",
          version: "18.3",
          apiDialect: "rest-v4",
          authStrategy: "vault-token",
          documentRef: "urn:doc:gitlab",
          permissionsRef: "urn:permission:gitlab",
        },
        {
          type: "MATTERMOST",
          edition: "enterprise",
          version: "10.10",
          apiDialect: "rest-v4",
          authStrategy: "vault-token",
          documentRef: "urn:doc:mattermost",
          permissionsRef: "urn:permission:mattermost",
        },
      ],
    },
    "IN-03": {
      issuer: "https://identity.non-prod.example",
      audience: "awp-pilot",
      tokenDialect: "jwt-es256",
      groupMappingRef: "urn:iam:groups",
      sessionPolicyRef: "urn:iam:session",
      stepUpPolicyRef: "urn:iam:step-up",
    },
    "IN-04": {
      authMethod: "kubernetes-workload",
      resolverPolicyRef: "urn:vault:resolver",
      secretRefs: ["urn:vault:secret-ref"],
      signingPolicyRef: "urn:vault:signing",
      rotationPolicyRef: "urn:vault:rotation",
      breakGlassRef: "urn:runbook:break-glass",
    },
    "IN-05": {
      origins: [
        "https://jira.non-prod.example",
        "https://gitlab.non-prod.example",
        "https://mattermost.non-prod.example",
      ],
      trustPolicyRef: "urn:network:trust",
      egressPolicyRef: "urn:network:egress",
      callbackRoutes: ["https://pilot.non-prod.example/hooks"],
      ingressPolicyRef: "urn:network:ingress",
    },
    "IN-06": {
      telemetryPolicyRef: "urn:otel:policy",
      retentionPolicyRef: "urn:otel:retention",
      alertRouteRef: "urn:alert:route",
      onCallOwner: "group:platform-on-call",
    },
    "IN-07": {
      artifactMode: "GITLAB_ONLY",
      retentionPolicyRef: "urn:artifact:retention",
      verificationPolicyRef: "urn:artifact:verification",
      exportPolicyRef: "urn:artifact:export",
    },
    "IN-08": {
      backupMethod: "PHYSICAL_PITR",
      destinationRef: "urn:backup:destination",
      recoveryPolicyRef: "urn:recovery:policy",
      fencePolicyRef: "urn:recovery:fence",
      restoreOwner: "group:database-on-call",
    },
    "IN-09": {
      scanPolicyRef: "urn:security:scan-policy",
      scannerRef: "urn:security:scanner",
      freshnessPolicyRef: "urn:security:freshness",
      findingOwner: "group:security",
    },
    "IN-10": {
      cohortRef: "urn:pilot:cohort",
      humanRefs: ["user:qa-lead", "user:sponsor"],
      sponsorRef: "user:sponsor",
      qaLeadRef: "user:qa-lead",
      windowPolicyRef: "urn:pilot:window",
    },
    "IN-11": {
      baselineMethod: "frozen-observation",
      sourceRefs: ["urn:baseline:source"],
      measurementProtocolRef: "urn:baseline:protocol",
      spotCheckPolicyRef: "urn:baseline:spot-check",
    },
    "IN-12": {
      incidentRunbookRef: "urn:runbook:incident",
      rollbackRunbookRef: "urn:runbook:rollback",
      resumePolicyRef: "urn:runbook:resume",
      onCallOwner: "group:platform-on-call",
    },
  };
  const reviewedAt = new Date(Date.now() - 1_000).toISOString();
  const entries = Object.entries(metadata).map(([id, value]) => {
    const body = {
      id,
      version: 1,
      workspaceId: "workspace-pilot",
      projectIds: ["project-pilot"],
      synthetic: false,
      status: "ACCEPTED",
      suppliedBy: `owner:${id}`,
      reviewedBy: "reviewer:platform",
      reviewedAt,
      evidenceRef: `urn:evidence:${id}`,
      metadata: value,
    };
    return { ...body, contentHash: canonicalInputHash008(body) };
  });
  return {
    schemaVersion: 1,
    id: "corporate-pilot",
    version: 1,
    profile: "integration",
    scope: { workspaceId: "workspace-pilot", projectIds: ["project-pilot"] },
    entries,
  };
};
describe("008 secret-free input packages", () => {
  it("validates synthetic local data without corporate readiness", () =>
    expect(validateInputPackage008(example())).toMatchObject({
      status: "PASS",
      corporateReady: false,
    }));
  it("keeps missing corporate inputs blocked", () =>
    expect(
      validateInputPackage008({
        schemaVersion: 1,
        id: "corporate",
        version: 1,
        profile: "pilot",
        scope: { workspaceId: "w", projectIds: ["p"] },
        entries: [],
      }),
    ).toMatchObject({ status: "BLOCKED_INPUT", corporateReady: false }));
  it("rejects inline secrets and credential URLs without echoing their values", () => {
    const value = example();
    value.password = "DO_NOT_ECHO_CANARY";
    const result = validateInputPackage008(value);
    expect(result.status).toBe("FAIL");
    expect(JSON.stringify(result)).not.toContain("DO_NOT_ECHO_CANARY");
    const changed = example();
    changed.endpoint = "https://user:DO_NOT_ECHO_CANARY@example.test";
    expect(validateInputPackage008(changed).status).toBe("FAIL");
  });
  it("rejects tampered metadata, duplicate inputs and out-of-scope entries", () => {
    for (const mutation of ["hash", "duplicate", "scope"]) {
      const p = example();
      const entries = p.entries as Record<string, unknown>[];
      if (mutation === "hash") entries[0]!.contentHash = "sha256:" + "0".repeat(64);
      if (mutation === "duplicate") entries.push(entries[0]!);
      if (mutation === "scope") entries[0]!.workspaceId = "other";
      expect(validateInputPackage008(p).status).toBe("FAIL");
    }
  });
  it("does not promote synthetic metadata by changing profile", () => {
    const p = example();
    p.profile = "pilot";
    expect(validateInputPackage008(p).status).toBe("FAIL");
  });
  it("accepts reviewed corporate entries and rejects missing or non-accepted status", () => {
    expect(validateInputPackage008(corporate(), "N2")).toMatchObject({
      status: "PASS",
      missingInputIds: [],
    });
    for (const status of [undefined, "REJECTED"]) {
      const p = corporate();
      const entry = (p.entries as Record<string, unknown>[])[0]!;
      if (status === undefined) delete entry.status;
      else entry.status = status;
      const body = { ...entry };
      delete body.contentHash;
      entry.contentHash = canonicalInputHash008(body);
      const result = validateInputPackage008(p, "N2");
      expect(result.status).toBe("FAIL");
      expect(result.reasonCodes).toContain("ENTRY_STATUS_NOT_ACCEPTED:IN-01");
    }
  });
  it("canonicalizes object keys but preserves array order", () => {
    expect(canonicalInputHash008({ a: 1, b: 2 })).toBe(canonicalInputHash008({ b: 2, a: 1 }));
    expect(canonicalInputHash008([1, 2])).not.toBe(canonicalInputHash008([2, 1]));
  });
  it("preserves canonical JSON string hashing after sharing the runtime validator", () =>
    expect(canonicalInputHash008("value")).toBe(
      `sha256:${createHash("sha256").update(JSON.stringify("value")).digest("hex")}`,
    ));
});
