import { describe, expect, it } from "vitest";

import {
  type CommandConfigurationPin,
  ConfigurationPinSet,
} from "../../packages/platform-core/src/index.ts";
import {
  normalizeQaJiraSourceIssueObservation,
  planQaJiraRequestSourceContext,
  type QaJiraResolvedPins,
  qaJiraSourceRefFromObservation,
  resolveQaJiraSourceLinkPolicy,
} from "../../packages/runtime-composition/src/index.ts";

const hash = (value: string): `sha256:${string}` => `sha256:${value.padEnd(64, "0").slice(0, 64)}`;
const ref = (id: string, version = 1) => Object.freeze({ id, version });

function pin(
  sequence: number,
  purpose: "PRIMARY" | "AUXILIARY",
  logicalRole: "QA_REQUEST_AUTHORITY" | "SOURCE_CONTEXT",
): CommandConfigurationPin {
  return Object.freeze({
    sequence,
    purpose,
    logicalRole,
    bindingRef: ref("binding", 4),
    profileRef: ref(`profile-${sequence}`, sequence + 7),
    mappingRef: ref(`mapping-${sequence}`, sequence + 2),
    connectionRef: ref("connection", 2),
    contentHash: hash(`pin-${sequence}`),
    adapterFamily: "jira-cloud-v3",
    adapterContractVersion: "1.0.0",
    authorityNamespaceHash: hash("same-authority"),
  });
}

function resolvedPins(
  change: Readonly<{ sourceConnectionId?: string; allowedDirection?: "INWARD" | "OUTWARD" }> = {},
): QaJiraResolvedPins {
  const primary = pin(0, "PRIMARY", "QA_REQUEST_AUTHORITY");
  const sourceBase = pin(1, "AUXILIARY", "SOURCE_CONTEXT");
  const source = change.sourceConnectionId
    ? Object.freeze({ ...sourceBase, connectionRef: ref(change.sourceConnectionId, 2) })
    : sourceBase;
  const connection = Object.freeze({
    connectorKey: "jira.operational-authority",
    endpoint: "http://127.0.0.1:4999/jira/",
    environmentScope: "LOCAL",
    adapterFamily: "jira-cloud-v3",
    adapterContractVersion: "1.0.0",
  });
  const primaryProfile = Object.freeze({
    connectorKey: "jira.operational-authority",
    sourceLinkPolicy: Object.freeze({
      strategy: "NATIVE_SAME_AUTHORITY",
      typeId: "10000",
      direction: "OUTWARD",
    }),
  });
  const sourceProfile = Object.freeze({
    connectorKey: "jira.operational-authority",
    logicalRole: "SOURCE_CONTEXT",
    allowedProjectIds: Object.freeze(["200"]),
    allowedIssueTypeIds: Object.freeze(["10002"]),
    jiraLinkTypes: Object.freeze([
      Object.freeze({ typeId: "10000", direction: change.allowedDirection ?? "OUTWARD" }),
    ]),
  });
  const entries = Object.freeze([
    Object.freeze({
      pin: primary,
      profileContent: primaryProfile,
      mappingContent: Object.freeze({}),
      connectionContent: connection,
    }),
    Object.freeze({
      pin: source,
      profileContent: sourceProfile,
      mappingContent: Object.freeze({}),
      connectionContent: connection,
    }),
  ]);
  return Object.freeze({
    pinSet: ConfigurationPinSet.create([primary, source]),
    entries,
    bindingRef: primary.bindingRef,
    bindingContent: Object.freeze({}),
    profileRef: primary.profileRef,
    profileContent: primaryProfile,
    mappingRef: primary.mappingRef,
    mappingContent: Object.freeze({}),
    connectionRef: primary.connectionRef,
    connectionContent: connection,
    connectionHeaderId: primary.connectionRef.id,
    adapterFamily: "jira-cloud-v3",
    adapterContractVersion: "1.0.0",
  });
}

function sourceDocument(
  change: Readonly<{ id?: string; projectId?: string; issueTypeId?: string }> = {},
) {
  return Object.freeze({
    id: change.id ?? "SRC-7",
    key: "APP-7",
    projectId: change.projectId ?? "200",
    issueTypeId: change.issueTypeId ?? "10002",
    updated: "2026-08-31T12:34:56.000Z",
    changelogId: "19",
    fields: Object.freeze({ summary: "Ignored provider content" }),
  });
}

describe("qa-jira SOURCE_CONTEXT runtime", () => {
  it("returns no effects and performs no read when source is absent", async () => {
    let calls = 0;
    const plan = await planQaJiraRequestSourceContext({
      resolved: resolvedPins(),
      request: {},
      effectMarker: "effect-1",
      transport: async () => {
        calls += 1;
        throw new Error("must not read");
      },
    });
    expect(plan).toEqual({ subEffects: [] });
    expect(calls).toBe(0);
  });

  it("reads one exact source issue, validates scope and plans the required pinned link", async () => {
    const document = sourceDocument();
    const sourceRef = qaJiraSourceRefFromObservation(
      normalizeQaJiraSourceIssueObservation(document),
    );
    const calls: URL[] = [];
    const plan = await planQaJiraRequestSourceContext({
      resolved: resolvedPins(),
      request: { sourceRefs: Object.freeze([sourceRef]) },
      effectMarker: "effect-7",
      transport: async (input) => {
        calls.push(new URL(String(input)));
        return Response.json(document);
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.pathname).toBe("/rest/api/3/issue/SRC-7");
    expect(calls[0]?.searchParams.get("fields")).toBe("project,issuetype,updated");
    expect(calls[0]?.searchParams.get("expand")).toBe("changelog");
    expect(plan.issueLink).toEqual({ typeId: "10000", direction: "OUTWARD" });
    expect(plan.validatedSourceRef).toEqual(sourceRef);
    expect(plan.subEffects).toEqual([
      {
        kind: "LINK",
        semanticIdentity: "issue:SRC-7",
        required: true,
        payload: {
          externalEntityId: "SRC-7",
          marker: "effect-7",
          typeId: "10000",
          direction: "OUTWARD",
        },
      },
    ]);
  });

  it("rejects unsupported or multiple refs before any provider read", async () => {
    let calls = 0;
    const transport = async () => {
      calls += 1;
      return Response.json(sourceDocument());
    };
    const valid = qaJiraSourceRefFromObservation(
      normalizeQaJiraSourceIssueObservation(sourceDocument()),
    );
    await expect(
      planQaJiraRequestSourceContext({
        resolved: resolvedPins(),
        request: { sourceRefs: [{ ...valid, kind: "COMMIT" }] },
        effectMarker: "effect-invalid",
        transport,
      }),
    ).rejects.toThrow("JIRA_SOURCE_REFERENCE_EXACTLY_ONE_REQUIRED");
    await expect(
      planQaJiraRequestSourceContext({
        resolved: resolvedPins(),
        request: { sourceRefs: [valid, valid] },
        effectMarker: "effect-multiple",
        transport,
      }),
    ).rejects.toThrow("JIRA_SOURCE_REFERENCE_EXACTLY_ONE_REQUIRED");
    expect(calls).toBe(0);
  });

  it("fails closed on an out-of-scope or stale authoritative observation", async () => {
    const foreign = sourceDocument({ projectId: "201" });
    const foreignRef = qaJiraSourceRefFromObservation(
      normalizeQaJiraSourceIssueObservation(foreign),
    );
    await expect(
      planQaJiraRequestSourceContext({
        resolved: resolvedPins(),
        request: { sourceRefs: [foreignRef] },
        effectMarker: "effect-foreign",
        transport: async () => Response.json(foreign),
      }),
    ).rejects.toThrow("JIRA_SOURCE_PROJECT_OUT_OF_SCOPE");

    const current = sourceDocument();
    const currentRef = qaJiraSourceRefFromObservation(
      normalizeQaJiraSourceIssueObservation(current),
    );
    await expect(
      planQaJiraRequestSourceContext({
        resolved: resolvedPins(),
        request: { sourceRefs: [{ ...currentRef, version: `${currentRef.version}-stale` }] },
        effectMarker: "effect-stale",
        transport: async () => Response.json(current),
      }),
    ).rejects.toThrow("JIRA_SOURCE_REFERENCE_VERSION_STALE");
  });

  it("requires a same-connection pin and an auxiliary-allowlisted link tuple", () => {
    expect(() =>
      resolveQaJiraSourceLinkPolicy(resolvedPins({ sourceConnectionId: "other-connection" })),
    ).toThrow("JIRA_SOURCE_CONTEXT_SAME_CONNECTION_REQUIRED");
    expect(() =>
      resolveQaJiraSourceLinkPolicy(resolvedPins({ allowedDirection: "INWARD" })),
    ).toThrow("JIRA_SOURCE_LINK_NOT_ALLOWLISTED");
  });
});
