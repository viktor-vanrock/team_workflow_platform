import { describe, expect, it } from "vitest";

import type {
  OperationalImmutableRef,
  OperationalRequestCreateInput,
} from "../../packages/connector-sdk/src/index.ts";
import {
  type CommandConfigurationPin,
  ConfigurationPinSet,
} from "../../packages/platform-core/src/index.ts";
import {
  createQaJiraPinnedOperationalBrokerMap,
  normalizeQaJiraSourceIssueObservation,
  type QaJiraResolvedPins,
  qaJiraSourceRefFromObservation,
} from "../../packages/runtime-composition/src/index.ts";
import { qaUs1OperationalRoute } from "../../packages/runtime-composition/src/qa/operational-composition.ts";

const hash = (value: string): `sha256:${string}` => `sha256:${value.padEnd(64, "0").slice(0, 64)}`;
const ref = (id: string) => Object.freeze({ id, version: 1 });

function pin(
  sequence: number,
  purpose: "PRIMARY" | "AUXILIARY",
  logicalRole: string,
): CommandConfigurationPin {
  return Object.freeze({
    sequence,
    purpose,
    logicalRole,
    bindingRef: ref("binding"),
    profileRef: ref(`profile-${sequence}`),
    mappingRef: ref(`mapping-${sequence}`),
    connectionRef: ref(`connection-${sequence}`),
    contentHash: hash(`pin${sequence}`),
    adapterFamily: "jira-cloud-v3",
    adapterContractVersion: "1.0.0",
    authorityNamespaceHash: hash(`namespace${sequence}`),
  });
}

function resolvedPins(
  change: Readonly<{ legacyWithoutSourcePolicy?: boolean }> = {},
): QaJiraResolvedPins {
  const primary = pin(0, "PRIMARY", "QA_REQUEST_AUTHORITY");
  const auxiliaryBase = Object.freeze({
    ...pin(1, "AUXILIARY", "SOURCE_CONTEXT"),
    connectionRef: primary.connectionRef,
    authorityNamespaceHash: primary.authorityNamespaceHash,
  });
  const auxiliary = change.legacyWithoutSourcePolicy
    ? Object.freeze({
        ...auxiliaryBase,
        profileRef: primary.profileRef,
        mappingRef: primary.mappingRef,
      })
    : auxiliaryBase;
  const primaryProfile = Object.freeze({
    connectorKey: "jira.operational-authority",
    connectionRef: primary.connectionRef,
    mappingRef: primary.mappingRef,
    project: { id: "777", name: "Central QA" },
    issueType: { id: "888", name: "QA Request" },
    projectDiscriminatorFieldId: "customfield_23001",
    effectMarkerFieldId: "customfield_23002",
    ...(change.legacyWithoutSourcePolicy
      ? {}
      : {
          sourceLinkPolicy: {
            strategy: "NATIVE_SAME_AUTHORITY",
            typeId: "10000",
            direction: "OUTWARD",
          },
        }),
  });
  const primaryMapping = Object.freeze({
    connectorKey: "jira.operational-authority",
    projectDiscriminator: "ALPHA-PINNED",
    outputFieldAllowlist: ["summary", "description", "customfield_23001", "customfield_23003"],
    requestCreateFieldIds: {
      summary: "summary",
      description: "description",
      projectDiscriminator: "customfield_23001",
      acceptanceOutcome: "customfield_23003",
    },
  });
  const primaryConnection = Object.freeze({
    connectorKey: "jira.operational-authority",
    endpoint: "http://127.0.0.1:4999/jira/",
    environmentScope: "LOCAL",
    adapterFamily: "jira-cloud-v3",
    adapterContractVersion: "1.0.0",
  });
  const auxiliaryProfile = change.legacyWithoutSourcePolicy
    ? primaryProfile
    : Object.freeze({
        connectorKey: "jira.operational-authority",
        logicalRole: "SOURCE_CONTEXT",
        allowedProjectIds: ["200"],
        allowedIssueTypeIds: ["10002"],
        jiraLinkTypes: [{ typeId: "10000", direction: "OUTWARD" }],
      });
  const auxiliaryContent = Object.freeze({ connectorKey: "jira.operational-authority" });
  const entries = Object.freeze([
    Object.freeze({
      pin: primary,
      profileContent: primaryProfile,
      mappingContent: primaryMapping,
      connectionContent: primaryConnection,
    }),
    Object.freeze({
      pin: auxiliary,
      profileContent: auxiliaryProfile,
      mappingContent: auxiliaryContent,
      connectionContent: primaryConnection,
    }),
  ]);
  return Object.freeze({
    pinSet: ConfigurationPinSet.create([primary, auxiliary]),
    entries,
    bindingRef: primary.bindingRef,
    bindingContent: Object.freeze({ entries: [] }),
    profileRef: primary.profileRef,
    profileContent: primaryProfile,
    mappingRef: primary.mappingRef,
    mappingContent: primaryMapping,
    connectionRef: primary.connectionRef,
    connectionContent: primaryConnection,
    connectionHeaderId: primary.connectionRef.id,
    adapterFamily: "jira-cloud-v3",
    adapterContractVersion: "1.0.0",
  });
}

function runtimeContext(effectIdempotencyKey: string) {
  return Object.freeze({
    scope: Object.freeze({
      kind: "PROJECT" as const,
      workspaceId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
    }),
    actor: Object.freeze({
      kind: "SERVICE" as const,
      principalId: "33333333-3333-4333-8333-333333333333",
      serviceKey: "worker",
    }),
    correlationId: "44444444-4444-4444-8444-444444444444",
    causationId: "55555555-5555-4555-8555-555555555555",
    effectIdempotencyKey,
    profileRef: ref("profile-0"),
    classification: Object.freeze({ key: "INTERNAL", rank: 10 }),
    signal: new AbortController().signal,
  });
}

function workTarget() {
  return Object.freeze({
    workspaceId: "11111111-1111-4111-8111-111111111111",
    projectId: "22222222-2222-4222-8222-222222222222",
    entityKind: "REQUEST" as const,
    authorityScopeKey: "qa.alpha",
    naturalKey: "draft-1",
  });
}

function requestInput(
  sourceRefs: readonly OperationalImmutableRef[] = [],
): OperationalRequestCreateInput {
  return Object.freeze({
    sourceDraftId: "draft-1",
    workTypeKey: "qa.validation",
    workTypeVersion: "1.0.0",
    requestKind: "feature-validation",
    summary: "Pinned title",
    description: "Pinned description",
    acceptanceOutcome: "Pinned outcome",
    requestedNormalizedStatus: "NEW",
    dataClassificationKey: "INTERNAL",
    ...(sourceRefs.length > 0 ? { sourceRefs: Object.freeze([...sourceRefs]) } : {}),
  });
}

describe("qa-jira worker pinned operational broker", () => {
  it("builds Jira lookup/create/read from exact Profile, Mapping and Connection content", async () => {
    const calls: Array<Readonly<{ method: string; url: URL; body?: unknown }>> = [];
    const transport = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push(Object.freeze({ method, url, ...(body === undefined ? {} : { body }) }));
      if (method === "GET" && url.pathname.endsWith("/search/jql"))
        return Response.json({ issues: [], total: 0, nextPageToken: null });
      if (method === "POST" && url.pathname.endsWith("/issue"))
        return Response.json({ id: "90001", key: "PIN-1" });
      if (method === "GET" && url.pathname.endsWith("/issue/90001")) {
        return Response.json({
          id: "90001",
          key: "PIN-1",
          updated: "2026-08-31T12:00:00.000Z",
          fields: {
            summary: "Pinned title",
            customfield_23001: "ALPHA-PINNED",
            customfield_23002: "effect-pinned",
          },
        });
      }
      return Response.json({ code: "UNEXPECTED" }, { status: 500 });
    };
    const broker = createQaJiraPinnedOperationalBrokerMap(resolvedPins(), transport);
    await broker[qaUs1OperationalRoute].invoke(
      {
        scope: {
          kind: "PROJECT",
          workspaceId: "11111111-1111-4111-8111-111111111111",
          projectId: "22222222-2222-4222-8222-222222222222",
        },
        actor: {
          kind: "SERVICE",
          principalId: "33333333-3333-4333-8333-333333333333",
          serviceKey: "worker",
        },
        correlationId: "44444444-4444-4444-8444-444444444444",
        causationId: "55555555-5555-4555-8555-555555555555",
        effectIdempotencyKey: "effect-pinned",
        profileRef: ref("profile-0"),
        classification: { key: "INTERNAL", rank: 10 },
        signal: new AbortController().signal,
      },
      {
        workspaceId: "11111111-1111-4111-8111-111111111111",
        projectId: "22222222-2222-4222-8222-222222222222",
        entityKind: "REQUEST",
        authorityScopeKey: "qa.alpha",
        naturalKey: "draft-1",
      },
      {
        sourceDraftId: "draft-1",
        workTypeKey: "qa.validation",
        workTypeVersion: "1.0.0",
        requestKind: "feature-validation",
        summary: "Pinned title",
        description: "Pinned description",
        acceptanceOutcome: "Pinned outcome",
        requestedNormalizedStatus: "NEW",
        dataClassificationKey: "INTERNAL",
      },
    );

    const searchJql = calls[0]?.url.searchParams.get("jql");
    expect(searchJql).toContain('project = "777"');
    expect(searchJql).toContain('issuetype = "888"');
    expect(searchJql).toContain('customfield_23002 = "effect-pinned"');
    const create = calls.find(
      ({ method, url }) => method === "POST" && url.pathname.endsWith("/issue"),
    );
    expect(create?.url.origin).toBe("http://127.0.0.1:4999");
    expect(create?.body).toEqual({
      fields: {
        summary: "Pinned title",
        description: "Pinned description",
        customfield_23001: "ALPHA-PINNED",
        customfield_23003: "Pinned outcome",
        project: { id: "777" },
        issuetype: { id: "888" },
        customfield_23002: "effect-pinned",
      },
    });
    expect(JSON.stringify(calls)).not.toContain("customfield_10010");
    expect(JSON.stringify(calls)).not.toContain("customfield_10011");
  });

  it("continues a legacy Profile v5 command without source refs or sourceLinkPolicy", async () => {
    let creates = 0;
    const transport = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      if (method === "GET" && url.pathname.endsWith("/search/jql")) {
        return Response.json({ issues: [], total: 0, nextPageToken: null });
      }
      if (method === "POST" && url.pathname.endsWith("/issue")) {
        creates += 1;
        return Response.json({ id: "90001", key: "PIN-1" });
      }
      if (method === "GET" && url.pathname.endsWith("/issue/90001")) {
        return Response.json({
          id: "90001",
          key: "PIN-1",
          updated: "2026-08-31T12:00:00.000Z",
          fields: {
            summary: "Pinned title",
            customfield_23001: "ALPHA-PINNED",
            customfield_23002: "effect-legacy",
          },
        });
      }
      return Response.json({ code: "UNEXPECTED" }, { status: 500 });
    };

    const broker = createQaJiraPinnedOperationalBrokerMap(
      resolvedPins({ legacyWithoutSourcePolicy: true }),
      transport,
    );
    const result = await broker[qaUs1OperationalRoute].invoke(
      runtimeContext("effect-legacy"),
      workTarget(),
      requestInput(),
    );

    expect(result.externalEntityId).toBe("90001");
    expect(creates).toBe(1);

    await expect(
      broker[qaUs1OperationalRoute].invoke(
        runtimeContext("effect-legacy-source"),
        workTarget(),
        requestInput([
          {
            kind: "JIRA_ISSUE",
            id: "SRC-7",
            version: "2026-08-31T12:00:00.000Z:19",
            contentHash: hash("abc"),
          },
        ]),
      ),
    ).rejects.toThrow("JIRA_SOURCE_CONTEXT_PROFILE_ROLE_INVALID");
    expect(creates).toBe(1);
  });

  it("strictly validates a source immediately before the first central create", async () => {
    const originalDocument = Object.freeze({
      id: "SRC-7",
      projectId: "200",
      issueTypeId: "10002",
      updated: "2026-08-31T12:00:00.000Z",
      changelogId: "19",
    });
    const sourceRef = qaJiraSourceRefFromObservation(
      normalizeQaJiraSourceIssueObservation(originalDocument),
    );
    let creates = 0;
    const transport = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      if (method === "GET" && url.pathname.endsWith("/search/jql")) {
        return Response.json({ issues: [], total: 0, nextPageToken: null });
      }
      if (method === "GET" && url.pathname.endsWith("/issue/SRC-7")) {
        return Response.json({
          ...originalDocument,
          updated: "2026-08-31T12:01:00.000Z",
          changelogId: "20",
        });
      }
      if (method === "POST" && url.pathname.endsWith("/issue")) {
        creates += 1;
        return Response.json({ id: "90001", key: "PIN-1" });
      }
      return Response.json({ code: "UNEXPECTED" }, { status: 500 });
    };

    const broker = createQaJiraPinnedOperationalBrokerMap(resolvedPins(), transport);
    await expect(
      broker[qaUs1OperationalRoute].invoke(
        runtimeContext("effect-stale-before-create"),
        workTarget(),
        requestInput([sourceRef]),
      ),
    ).rejects.toThrow("JIRA_SOURCE_REFERENCE_VERSION_STALE");
    expect(creates).toBe(0);
  });

  it("recovers an already-created issue/link after the source revision changes", async () => {
    let sourceUpdated = "2026-08-31T12:00:00.000Z";
    let sourceChangelogId = "19";
    const sourceDocument = () =>
      Object.freeze({
        id: "SRC-7",
        projectId: "200",
        issueTypeId: "10002",
        updated: sourceUpdated,
        changelogId: sourceChangelogId,
      });
    const sourceRef = qaJiraSourceRefFromObservation(
      normalizeQaJiraSourceIssueObservation(sourceDocument()),
    );
    let centralCreated = false;
    let linkCreated = false;
    let sourceReads = 0;
    let centralCreates = 0;
    let linkWrites = 0;

    const transport = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      if (method === "GET" && url.pathname.endsWith("/search/jql")) {
        return Response.json({
          issues: centralCreated ? [{ id: "90001" }] : [],
          total: centralCreated ? 1 : 0,
          nextPageToken: null,
        });
      }
      if (method === "GET" && url.pathname.endsWith("/issue/SRC-7")) {
        sourceReads += 1;
        return Response.json(sourceDocument());
      }
      if (method === "POST" && url.pathname.endsWith("/issue")) {
        centralCreates += 1;
        centralCreated = true;
        return Response.json({ id: "90001", key: "PIN-1" });
      }
      if (
        method === "GET" &&
        url.pathname.endsWith("/issue/90001") &&
        url.searchParams.get("fields") === "issuelinks"
      ) {
        return Response.json({
          id: "90001",
          links: linkCreated ? [{ typeId: "10000", direction: "OUTWARD", issueId: "SRC-7" }] : [],
        });
      }
      if (method === "POST" && url.pathname.endsWith("/issueLink")) {
        linkWrites += 1;
        linkCreated = true;
        throw new Error("simulated lost link response");
      }
      if (method === "GET" && url.pathname.endsWith("/issue/90001")) {
        return Response.json({
          id: "90001",
          key: "PIN-1",
          updated: "2026-08-31T12:02:00.000Z",
          fields: {
            summary: "Pinned title",
            customfield_23001: "ALPHA-PINNED",
            customfield_23002: "effect-recovery",
          },
        });
      }
      return Response.json({ code: "UNEXPECTED" }, { status: 500 });
    };

    const firstBroker = createQaJiraPinnedOperationalBrokerMap(resolvedPins(), transport);
    await expect(
      firstBroker[qaUs1OperationalRoute].invoke(
        runtimeContext("effect-recovery"),
        workTarget(),
        requestInput([sourceRef]),
      ),
    ).rejects.toThrow("simulated lost link response");
    expect({ centralCreated, linkCreated, sourceReads, centralCreates, linkWrites }).toEqual({
      centralCreated: true,
      linkCreated: true,
      sourceReads: 1,
      centralCreates: 1,
      linkWrites: 1,
    });

    // Jira source revisions are mutable. Recovery must use the immutable plan
    // already validated before the central create, not reinterpret this update.
    sourceUpdated = "2026-08-31T12:03:00.000Z";
    sourceChangelogId = "20";
    const recoveryBroker = createQaJiraPinnedOperationalBrokerMap(resolvedPins(), transport);
    const result = await recoveryBroker[qaUs1OperationalRoute].invoke(
      runtimeContext("effect-recovery"),
      workTarget(),
      requestInput([sourceRef]),
    );

    expect(result.externalEntityId).toBe("90001");
    expect(sourceReads).toBe(1);
    expect(centralCreates).toBe(1);
    expect(linkWrites).toBe(1);
  });
});
