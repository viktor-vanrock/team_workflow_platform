import { describe, expect, it } from "vitest";

import {
  createJiraDialect,
  JiraHttpRequestCreatePort,
  JiraRestClient,
} from "../../../packages/connector-jira/src/index.ts";

type StoredIssue = Readonly<{
  id: string;
  key: string;
  fields: Readonly<Record<string, unknown>>;
  marker: string;
  updated: string;
  changelogId: string;
  links: readonly Readonly<{ typeId: string; direction: "INWARD" | "OUTWARD"; issueId: string }>[];
}>;

class MockHubJiraTransport {
  readonly calls: Array<Readonly<{ method: string; path: string; body?: unknown }>> = [];
  readonly issues = new Map<string, StoredIssue>();
  readonly properties = new Map<string, unknown>();
  timeoutAfterNextLink = false;

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    this.calls.push(
      Object.freeze({
        method,
        path: `${url.pathname}${url.search}`,
        ...(body === undefined ? {} : { body }),
      }),
    );

    if (
      method === "GET" &&
      (url.pathname === "/rest/api/3/search/jql" || url.pathname === "/rest/api/2/search")
    ) {
      const marker =
        /customfield_10011\s*=\s*"((?:\\.|[^"])*)"/u
          .exec(url.searchParams.get("jql") ?? "")?.[1]
          ?.replaceAll('\\"', '"')
          .replaceAll("\\\\", "\\") ?? "";
      const issues = [...this.issues.values()]
        .filter((issue) => issue.marker === marker)
        .map(({ id }) => ({ id }));
      return Response.json({
        issues,
        total: issues.length,
        startAt: Number(url.searchParams.get("startAt") ?? 0),
        nextPageToken: null,
      });
    }

    if (
      method === "POST" &&
      (url.pathname === "/rest/api/3/issue" || url.pathname === "/rest/api/2/issue")
    ) {
      const fields = (body as { fields: Record<string, unknown> }).fields;
      const id = "10001";
      this.issues.set(
        id,
        Object.freeze({
          id,
          key: "QAC-1",
          fields: Object.freeze(structuredClone(fields)),
          marker: String(fields.customfield_10011),
          updated: "2026-08-31T12:00:00.000Z",
          changelogId: "7",
          links: Object.freeze([]),
        }),
      );
      return Response.json({ id, key: "QAC-1" });
    }

    if (
      method === "POST" &&
      (url.pathname === "/rest/api/3/issueLink" || url.pathname === "/rest/api/2/issueLink")
    ) {
      const link = body as Readonly<{
        type: Readonly<{ id: string }>;
        outwardIssue: Readonly<{ id: string }>;
        inwardIssue: Readonly<{ id: string }>;
      }>;
      const outward = this.issues.get(link.outwardIssue.id);
      const inward = this.issues.get(link.inwardIssue.id);
      if (!outward && !inward) return new Response(null, { status: 404 });
      if (outward) {
        this.issues.set(
          outward.id,
          Object.freeze({
            ...outward,
            links: Object.freeze([
              ...outward.links,
              Object.freeze({
                typeId: link.type.id,
                direction: "OUTWARD",
                issueId: link.inwardIssue.id,
              }),
            ]),
          }),
        );
      }
      if (inward) {
        this.issues.set(
          inward.id,
          Object.freeze({
            ...inward,
            links: Object.freeze([
              ...inward.links,
              Object.freeze({
                typeId: link.type.id,
                direction: "INWARD",
                issueId: link.outwardIssue.id,
              }),
            ]),
          }),
        );
      }
      if (this.timeoutAfterNextLink) {
        this.timeoutAfterNextLink = false;
        throw new Error("TEST_TIMEOUT_AFTER_LINK_EFFECT");
      }
      return new Response(null, { status: 201 });
    }

    const issueMatch = /^\/rest\/api\/(?:2|3)\/issue\/([^/]+)$/u.exec(url.pathname);
    if (method === "GET" && issueMatch) {
      const issue = this.issues.get(decodeURIComponent(issueMatch[1]!));
      return issue
        ? Response.json({
            id: issue.id,
            key: issue.key,
            updated: issue.updated,
            changelogId: issue.changelogId,
            fields: {
              ...issue.fields,
              updated: issue.updated,
              issuelinks: issue.links.map((link) => ({
                type: {
                  id: link.typeId,
                  name: "Relates",
                  inward: "relates to",
                  outward: "relates to",
                },
                ...(link.direction === "OUTWARD"
                  ? { outwardIssue: { id: link.issueId } }
                  : { inwardIssue: { id: link.issueId } }),
              })),
            },
          })
        : new Response(null, { status: 404 });
    }

    const propertyMatch = /^\/rest\/api\/(?:2|3)\/issue\/([^/]+)\/properties\/([^/]+)$/u.exec(
      url.pathname,
    );
    if (method === "PUT" && propertyMatch) {
      this.properties.set(
        `${decodeURIComponent(propertyMatch[1]!)}:${decodeURIComponent(propertyMatch[2]!)}`,
        body,
      );
      return Response.json({ ok: true });
    }

    return Response.json({ code: "UNEXPECTED_TEST_REQUEST" }, { status: 500 });
  };
}

function client(
  transport: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): JiraRestClient {
  return new JiraRestClient({
    baseUrl: "http://127.0.0.1:4010/",
    environment: "LOCAL",
    allowedOrigins: ["http://127.0.0.1:4010"],
    transport,
  });
}

describe("JiraHttpRequestCreatePort", () => {
  it("uses pinned Cloud v3 paths for marker lookup, create, read-back and Mock Hub property sub-effects", async () => {
    const mock = new MockHubJiraTransport();
    const port = new JiraHttpRequestCreatePort({
      client: client(mock.fetch),
      dialect: createJiraDialect("jira-cloud-v3"),
      projectId: "100",
      issueTypeId: "10001",
      markerFieldId: "customfield_10011",
      authorityFieldIds: ["summary", "customfield_10010", "customfield_10011"],
      remoteLinkStrategy: { kind: "ISSUE_PROPERTY", propertyKeyPrefix: "awp.remote-link" },
    });

    expect(await port.lookup("awp:effect-1")).toEqual({ state: "PROVEN_ABSENT" });
    const created = await port.create({
      fields: { summary: "QA", project: { id: "wrong" }, customfield_10010: "ALPHA" },
      marker: "awp:effect-1",
    });
    expect(created).toEqual({ externalEntityId: "10001" });
    expect(await port.lookup("awp:effect-1")).toEqual({
      state: "FOUND",
      externalEntityId: "10001",
    });

    const observation = await port.observe(created.externalEntityId);
    expect(observation).toMatchObject({
      externalEntityId: "10001",
      externalDisplayKey: "QAC-1",
      providerChangelogId: "7",
    });
    expect(observation.externalRevisionToken).toContain("2026-08-31T12:00:00.000Z:7");
    expect(observation.authorityFieldsHash).toMatch(/^sha256:[a-f0-9]{64}$/u);

    const subEffectReceipt = await port.applySubEffect("10001", {
      kind: "REMOTE_LINK",
      semanticIdentity: "source:effect-1",
      payload: { marker: "awp:effect-1" },
    });
    expect(subEffectReceipt).toMatch(/^jira-property:sha256:[a-f0-9]{64}$/u);
    expect([...mock.properties.values()]).toEqual([
      {
        kind: "REMOTE_LINK",
        semanticIdentity: "source:effect-1",
        payload: { marker: "awp:effect-1" },
      },
    ]);

    expect(mock.calls.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^\/rest\/api\/3\/search\/jql\?/u),
        "/rest/api/3/issue",
        expect.stringMatching(/^\/rest\/api\/3\/issue\/10001\?/u),
        expect.stringMatching(/^\/rest\/api\/3\/issue\/10001\/properties\/awp.remote-link\./u),
      ]),
    );
    expect(mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: expect.stringContaining("/latest") }),
      ]),
    );
    expect(mock.issues.get("10001")?.fields).toMatchObject({
      project: { id: "100" },
      issuetype: { id: "10001" },
      customfield_10011: "awp:effect-1",
    });
  });

  it("fails closed when a zero-result Cloud page does not prove visibility", async () => {
    const transport = async () => Response.json({ issues: [] });
    const port = new JiraHttpRequestCreatePort({
      client: client(transport),
      dialect: createJiraDialect("jira-cloud-v3"),
      projectId: "100",
      issueTypeId: "10001",
      markerFieldId: "customfield_10011",
    });
    expect(await port.lookup("awp:unknown")).toEqual({ state: "UNKNOWN" });
  });

  it("adopts an exact source link after the first response is lost", async () => {
    const mock = new MockHubJiraTransport();
    const port = new JiraHttpRequestCreatePort({
      client: client(mock.fetch),
      dialect: createJiraDialect("jira-cloud-v3"),
      projectId: "100",
      issueTypeId: "10001",
      markerFieldId: "customfield_10011",
      issueLinkTypeId: "10000",
      issueLinkDirection: "OUTWARD",
    });
    await port.create({ fields: { summary: "QA" }, marker: "awp:link-recovery" });
    const effect = Object.freeze({
      kind: "LINK" as const,
      semanticIdentity: "issue:20001",
      payload: Object.freeze({ externalEntityId: "20001" }),
    });
    mock.timeoutAfterNextLink = true;
    await expect(port.applySubEffect("10001", effect)).rejects.toThrow(
      "TEST_TIMEOUT_AFTER_LINK_EFFECT",
    );
    await expect(port.applySubEffect("10001", effect)).resolves.toMatch(/^jira-link:sha256:/u);
    expect(mock.issues.get("10001")?.links).toEqual([
      { typeId: "10000", direction: "OUTWARD", issueId: "20001" },
    ]);
    const linkPosts = mock.calls.filter(
      ({ method, path }) => method === "POST" && path === "/rest/api/3/issueLink",
    );
    expect(linkPosts).toEqual([
      expect.objectContaining({
        body: {
          type: { id: "10000" },
          outwardIssue: { id: "10001" },
          inwardIssue: { id: "20001" },
        },
      }),
    ]);
  });

  it("preserves inward direction in the official Jira issue-link request and read-back", async () => {
    const mock = new MockHubJiraTransport();
    const port = new JiraHttpRequestCreatePort({
      client: client(mock.fetch),
      dialect: createJiraDialect("jira-cloud-v3"),
      projectId: "100",
      issueTypeId: "10001",
      markerFieldId: "customfield_10011",
      issueLinkTypeId: "10000",
      issueLinkDirection: "INWARD",
    });
    await port.create({ fields: { summary: "QA" }, marker: "awp:inward-link" });
    const effect = Object.freeze({
      kind: "LINK" as const,
      semanticIdentity: "issue:20002",
      payload: Object.freeze({ externalEntityId: "20002" }),
    });
    await expect(port.applySubEffect("10001", effect)).resolves.toMatch(/^jira-link:sha256:/u);
    await expect(port.applySubEffect("10001", effect)).resolves.toMatch(/^jira-link:sha256:/u);
    expect(mock.issues.get("10001")?.links).toEqual([
      { typeId: "10000", direction: "INWARD", issueId: "20002" },
    ]);
    expect(
      mock.calls.filter(
        ({ method, path }) => method === "POST" && path === "/rest/api/3/issueLink",
      ),
    ).toEqual([
      expect.objectContaining({
        body: {
          type: { id: "10000" },
          outwardIssue: { id: "20002" },
          inwardIssue: { id: "10001" },
        },
      }),
    ]);
  });

  it("follows Cloud tokens to detect multiple marker matches", async () => {
    const calls: string[] = [];
    const transport = async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls.push(url.search);
      return url.searchParams.has("nextPageToken")
        ? Response.json({ issues: [{ id: "2" }], nextPageToken: null })
        : Response.json({ issues: [{ id: "1" }], nextPageToken: "page-2" });
    };
    const port = new JiraHttpRequestCreatePort({
      client: client(transport),
      dialect: createJiraDialect("jira-cloud-v3"),
      projectId: "100",
      issueTypeId: "10001",
      markerFieldId: "customfield_10011",
    });
    expect(await port.lookup('awp:"quoted\\marker')).toEqual({
      state: "MULTIPLE",
      candidates: ["1", "2"],
    });
    expect(calls).toHaveLength(2);
    expect(new URLSearchParams(calls[1]!).get("nextPageToken")).toBe("page-2");
    expect(new URLSearchParams(calls[0]!).get("jql")).toContain(
      'customfield_10011 = "awp:\\"quoted\\\\marker"',
    );
  });

  it("uses the explicitly selected DC v2 paths without auto-detection", async () => {
    const paths: string[] = [];
    const bodies: unknown[] = [];
    const transport = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      paths.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (typeof init?.body === "string") bodies.push(JSON.parse(init.body) as unknown);
      if (url.pathname.endsWith("/search"))
        return Response.json({ issues: [], startAt: 0, total: 0 });
      if (init?.method === "POST") return Response.json({ id: "20001" });
      return Response.json({
        id: "20001",
        key: "QAC-2",
        updated: "2026-08-31T12:00:00.000Z",
        changelogId: "1",
        fields: { summary: "QA" },
      });
    };
    const port = new JiraHttpRequestCreatePort({
      client: client(transport),
      dialect: createJiraDialect("jira-dc-11-v2"),
      projectId: "100",
      issueTypeId: "10001",
      markerFieldId: "customfield_10011",
      issueLinkTypeId: "10000",
      issueLinkDirection: "OUTWARD",
    });
    expect(await port.lookup("awp:dc")).toEqual({ state: "PROVEN_ABSENT" });
    await port.create({ fields: { summary: "QA" }, marker: "awp:dc" });
    await port.observe("20001");
    await port.applySubEffect("20001", {
      kind: "LINK",
      semanticIdentity: "issue:30001",
      payload: { externalEntityId: "30001" },
    });
    expect(paths).toEqual([
      "GET /rest/api/2/search",
      "POST /rest/api/2/issue",
      "GET /rest/api/2/issue/20001",
      "GET /rest/api/2/issue/20001",
      "POST /rest/api/2/issueLink",
    ]);
    expect(bodies.at(-1)).toEqual({
      type: { id: "10000" },
      outwardIssue: { id: "20001" },
      inwardIssue: { id: "30001" },
    });
  });

  it("supports explicit Jira remote-link writes and direct issue properties", async () => {
    const calls: Array<Readonly<{ method: string; path: string; body: unknown }>> = [];
    const transport = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({
        method: init?.method ?? "GET",
        path: url.pathname,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      return Response.json({ ok: true });
    };
    const port = new JiraHttpRequestCreatePort({
      client: client(transport),
      dialect: createJiraDialect("jira-cloud-v3"),
      projectId: "100",
      issueTypeId: "10001",
      markerFieldId: "customfield_10011",
      remoteLinkStrategy: { kind: "JIRA_REMOTE_LINK" },
    });
    expect(
      await port.applySubEffect("10001", {
        kind: "REMOTE_LINK",
        semanticIdentity: "source-url",
        payload: { url: "https://git.example/issue/1", title: "Source" },
      }),
    ).toMatch(/^jira-remote-link:sha256:/u);
    expect(await port.putProperty("10001", "awp.effect", { marker: "awp:1" })).toMatch(
      /^jira-property:sha256:/u,
    );
    expect(calls).toEqual([
      expect.objectContaining({
        method: "POST",
        path: "/rest/api/3/issue/10001/remotelink",
        body: expect.objectContaining({
          object: { url: "https://git.example/issue/1", title: "Source" },
        }),
      }),
      expect.objectContaining({
        method: "PUT",
        path: "/rest/api/3/issue/10001/properties/awp.effect",
        body: { marker: "awp:1" },
      }),
    ]);
  });
});
