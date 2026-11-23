import type { DataSource } from "typeorm";

function returnedRows(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) return [];
  if (Array.isArray(value[0])) return value[0] as readonly Readonly<Record<string, unknown>>[];
  return value.filter(
    (candidate): candidate is Readonly<Record<string, unknown>> =>
      !!candidate && typeof candidate === "object" && !Array.isArray(candidate),
  );
}

export interface JiraMockLink {
  readonly typeId: string;
  readonly direction: "INWARD" | "OUTWARD";
  readonly issueId: string;
}
export interface JiraMockComment {
  readonly marker: string;
  readonly body: string;
}
export type JiraMockEffectOperation = "CREATE" | "PROPERTY" | "LINK" | "COMMENT";
export interface JiraMockEffectCall {
  readonly operation: JiraMockEffectOperation;
  readonly requestBody: unknown;
}
export interface JiraMockIssue {
  readonly id: string;
  readonly key: string;
  readonly projectId: string;
  readonly issueTypeId: string;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly marker?: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly links: readonly JiraMockLink[];
  readonly comments: readonly JiraMockComment[];
  readonly updated: string;
  readonly changelogId: string;
}
export interface JiraCreateIssueInput {
  readonly projectId: string;
  readonly issueTypeId: string;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly marker?: string;
}

export interface JiraRepository {
  createIssue(input: JiraCreateIssueInput): Promise<JiraMockIssue>;
  issue(id: string): Promise<JiraMockIssue | undefined>;
  searchByMarker(marker: string): Promise<readonly JiraMockIssue[]>;
  searchByScope(
    projectId: string,
    issueTypeId: string,
    discriminatorFieldId: string,
    discriminator: string,
  ): Promise<readonly JiraMockIssue[]>;
  updateIssueFields(id: string, fields: Readonly<Record<string, unknown>>): Promise<JiraMockIssue>;
  putProperty(id: string, key: string, value: unknown): Promise<void>;
  addLink(
    id: string,
    typeId: string,
    otherIssueId: string,
    direction: "INWARD" | "OUTWARD",
  ): Promise<void>;
  addIssueLink(typeId: string, outwardIssueId: string, inwardIssueId: string): Promise<void>;
  addComment(id: string, marker: string, body: string): Promise<void>;
  recordEffectCall(operation: JiraMockEffectOperation, requestBody: unknown): Promise<void>;
}

export class InMemoryJiraRepository implements JiraRepository {
  readonly #issues = new Map<string, JiraMockIssue>();
  readonly effectCalls: JiraMockEffectCall[] = [];
  #sequence = 10000;
  #change = 1;
  async createIssue(input: JiraCreateIssueInput): Promise<JiraMockIssue> {
    const id = String(++this.#sequence);
    const value: JiraMockIssue = Object.freeze({
      id,
      key: `QAC-${this.#sequence - 10000}`,
      projectId: input.projectId,
      issueTypeId: input.issueTypeId,
      fields: Object.freeze(structuredClone(input.fields)),
      ...(input.marker ? { marker: input.marker } : {}),
      properties: Object.freeze({}),
      links: Object.freeze([]),
      comments: Object.freeze([]),
      updated: new Date(Date.UTC(2026, 0, 1, 0, 0, this.#change)).toISOString(),
      changelogId: String(this.#change++),
    });
    this.#issues.set(id, value);
    return structuredClone(value);
  }
  async issue(id: string): Promise<JiraMockIssue | undefined> {
    const value = this.#issues.get(id);
    return value ? structuredClone(value) : undefined;
  }
  async searchByMarker(marker: string): Promise<readonly JiraMockIssue[]> {
    return [...this.#issues.values()]
      .filter((issue) => issue.marker === marker)
      .map((issue) => structuredClone(issue));
  }
  async searchByScope(
    projectId: string,
    issueTypeId: string,
    discriminatorFieldId: string,
    discriminator: string,
  ): Promise<readonly JiraMockIssue[]> {
    return [...this.#issues.values()]
      .filter(
        (issue) =>
          issue.projectId === projectId &&
          issue.issueTypeId === issueTypeId &&
          issue.fields[discriminatorFieldId] === discriminator,
      )
      .map((issue) => structuredClone(issue));
  }
  async updateIssueFields(
    id: string,
    fields: Readonly<Record<string, unknown>>,
  ): Promise<JiraMockIssue> {
    this.#replace(id, (issue) => ({
      ...issue,
      fields: Object.freeze({ ...issue.fields, ...structuredClone(fields) }),
      updated: new Date(Date.UTC(2026, 0, 1, 0, 0, this.#change)).toISOString(),
      changelogId: String(this.#change++),
    }));
    return (await this.issue(id)) as JiraMockIssue;
  }
  async putProperty(id: string, key: string, value: unknown): Promise<void> {
    this.#replace(id, (issue) => ({
      ...issue,
      properties: Object.freeze({ ...issue.properties, [key]: structuredClone(value) }),
    }));
  }
  async addLink(
    id: string,
    typeId: string,
    otherIssueId: string,
    direction: "INWARD" | "OUTWARD",
  ): Promise<void> {
    this.#replace(id, (issue) =>
      issue.links.some(
        (link) =>
          link.typeId === typeId && link.issueId === otherIssueId && link.direction === direction,
      )
        ? issue
        : {
            ...issue,
            links: Object.freeze([
              ...issue.links,
              Object.freeze({ typeId, issueId: otherIssueId, direction }),
            ]),
          },
    );
  }
  async addIssueLink(typeId: string, outwardIssueId: string, inwardIssueId: string): Promise<void> {
    await this.addLink(outwardIssueId, typeId, inwardIssueId, "OUTWARD");
    await this.addLink(inwardIssueId, typeId, outwardIssueId, "INWARD");
  }
  async addComment(id: string, marker: string, body: string): Promise<void> {
    this.#replace(id, (issue) =>
      issue.comments.some((comment) => comment.marker === marker)
        ? issue
        : {
            ...issue,
            comments: Object.freeze([...issue.comments, Object.freeze({ marker, body })]),
          },
    );
  }
  async recordEffectCall(operation: JiraMockEffectOperation, requestBody: unknown): Promise<void> {
    this.effectCalls.push(Object.freeze({ operation, requestBody: structuredClone(requestBody) }));
  }
  #replace(id: string, change: (issue: JiraMockIssue) => JiraMockIssue): void {
    const current = this.#issues.get(id);
    if (!current) throw new Error("JIRA_MOCK_ISSUE_NOT_FOUND");
    this.#issues.set(id, Object.freeze(change(current)));
  }
}

export class TypeOrmJiraRepository implements JiraRepository {
  constructor(private readonly source: DataSource) {}
  async createIssue(input: JiraCreateIssueInput): Promise<JiraMockIssue> {
    const rows = (await this.source.query(
      "INSERT INTO jira_mock_issues(project_id,issue_type_id,fields,marker,updated_at) VALUES($1,$2,$3,$4,clock_timestamp()) RETURNING id,key,project_id,issue_type_id,fields,marker,updated_at,changelog_id",
      [input.projectId, input.issueTypeId, JSON.stringify(input.fields), input.marker ?? null],
    )) as Record<string, unknown>[];
    return (await this.issue(String(rows[0]!.id))) as JiraMockIssue;
  }
  async issue(id: string): Promise<JiraMockIssue | undefined> {
    const rows = (await this.source.query("SELECT * FROM jira_mock_issues WHERE id=$1", [
      id,
    ])) as Record<string, unknown>[];
    const row = rows[0];
    if (!row) return undefined;
    const links = (await this.source.query(
      'SELECT type_id AS "typeId",direction,other_issue_id AS "issueId" FROM jira_mock_links WHERE issue_id=$1 ORDER BY id',
      [id],
    )) as unknown as JiraMockLink[];
    const comments = (await this.source.query(
      "SELECT marker,body FROM jira_mock_comments WHERE issue_id=$1 ORDER BY id",
      [id],
    )) as unknown as JiraMockComment[];
    const properties = Object.fromEntries(
      (
        (await this.source.query("SELECT key,value FROM jira_mock_properties WHERE issue_id=$1", [
          id,
        ])) as Record<string, unknown>[]
      ).map((item) => [String(item.key), item.value]),
    );
    return Object.freeze({
      id: String(row.id),
      key: String(row.key),
      projectId: String(row.project_id),
      issueTypeId: String(row.issue_type_id),
      fields: row.fields as Record<string, unknown>,
      ...(row.marker ? { marker: String(row.marker) } : {}),
      properties: Object.freeze(properties),
      links: Object.freeze(links),
      comments: Object.freeze(comments),
      updated: new Date(String(row.updated_at)).toISOString(),
      changelogId: String(row.changelog_id),
    });
  }
  async searchByMarker(marker: string): Promise<readonly JiraMockIssue[]> {
    const rows = (await this.source.query(
      "SELECT id FROM jira_mock_issues WHERE marker=$1 ORDER BY id",
      [marker],
    )) as Record<string, unknown>[];
    return await Promise.all(
      rows.map(async (row) => (await this.issue(String(row.id))) as JiraMockIssue),
    );
  }
  async searchByScope(
    projectId: string,
    issueTypeId: string,
    discriminatorFieldId: string,
    discriminator: string,
  ): Promise<readonly JiraMockIssue[]> {
    if (!/^customfield_[1-9][0-9]*$/u.test(discriminatorFieldId))
      throw new Error("JIRA_MOCK_SCOPE_FIELD_INVALID");
    const rows = (await this.source.query(
      "SELECT id FROM jira_mock_issues WHERE project_id=$1 AND issue_type_id=$2 AND fields->>$3=$4 ORDER BY id",
      [projectId, issueTypeId, discriminatorFieldId, discriminator],
    )) as Record<string, unknown>[];
    return await Promise.all(
      rows.map(async (row) => (await this.issue(String(row.id))) as JiraMockIssue),
    );
  }
  async updateIssueFields(
    id: string,
    fields: Readonly<Record<string, unknown>>,
  ): Promise<JiraMockIssue> {
    const rows = returnedRows(
      await this.source.query(
        "UPDATE jira_mock_issues SET fields=fields||$2::jsonb,updated_at=clock_timestamp(),changelog_id=DEFAULT WHERE id=$1 RETURNING id",
        [id, JSON.stringify(fields)],
      ),
    );
    if (rows.length !== 1) throw new Error("JIRA_MOCK_ISSUE_NOT_FOUND");
    return (await this.issue(id)) as JiraMockIssue;
  }
  async putProperty(id: string, key: string, value: unknown): Promise<void> {
    await this.source.query(
      "INSERT INTO jira_mock_properties(issue_id,key,value) VALUES($1,$2,$3) ON CONFLICT(issue_id,key) DO UPDATE SET value=EXCLUDED.value",
      [id, key, JSON.stringify(value)],
    );
  }
  async addLink(
    id: string,
    typeId: string,
    otherIssueId: string,
    direction: "INWARD" | "OUTWARD",
  ): Promise<void> {
    await this.source.query(
      "INSERT INTO jira_mock_links(issue_id,type_id,other_issue_id,direction) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [id, typeId, otherIssueId, direction],
    );
  }
  async addIssueLink(typeId: string, outwardIssueId: string, inwardIssueId: string): Promise<void> {
    await this.source.transaction(async (manager) => {
      await manager.query(
        "INSERT INTO jira_mock_links(issue_id,type_id,other_issue_id,direction) VALUES($1,$2,$3,'OUTWARD') ON CONFLICT DO NOTHING",
        [outwardIssueId, typeId, inwardIssueId],
      );
      await manager.query(
        "INSERT INTO jira_mock_links(issue_id,type_id,other_issue_id,direction) VALUES($1,$2,$3,'INWARD') ON CONFLICT DO NOTHING",
        [inwardIssueId, typeId, outwardIssueId],
      );
    });
  }
  async addComment(id: string, marker: string, body: string): Promise<void> {
    await this.source.query(
      "INSERT INTO jira_mock_comments(issue_id,marker,body) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [id, marker, body],
    );
  }
  async recordEffectCall(operation: JiraMockEffectOperation, requestBody: unknown): Promise<void> {
    await this.source.query(
      "INSERT INTO jira_mock_effect_calls(operation,request_body) VALUES($1,$2)",
      [operation, JSON.stringify(requestBody)],
    );
  }
}

export class JiraMockService {
  constructor(private readonly repository: JiraRepository) {}
  createIssue(input: JiraCreateIssueInput): Promise<JiraMockIssue> {
    return this.repository.createIssue({
      ...input,
      fields: { status: { id: "1", name: "Open" }, ...input.fields },
    });
  }
  async issue(id: string): Promise<JiraMockIssue> {
    const value = await this.repository.issue(id);
    if (!value) throw new Error("JIRA_MOCK_ISSUE_NOT_FOUND");
    return value;
  }
  searchByMarker(marker: string): Promise<readonly JiraMockIssue[]> {
    return this.repository.searchByMarker(marker);
  }
  searchByScope(
    projectId: string,
    issueTypeId: string,
    discriminatorFieldId: string,
    discriminator: string,
  ): Promise<readonly JiraMockIssue[]> {
    return this.repository.searchByScope(
      projectId,
      issueTypeId,
      discriminatorFieldId,
      discriminator,
    );
  }
  updateIssueFields(id: string, fields: Readonly<Record<string, unknown>>): Promise<JiraMockIssue> {
    return this.repository.updateIssueFields(id, fields);
  }
  putProperty(id: string, key: string, value: unknown): Promise<void> {
    return this.repository.putProperty(id, key, value);
  }
  addLink(
    id: string,
    typeId: string,
    otherIssueId: string,
    direction: "INWARD" | "OUTWARD",
  ): Promise<void> {
    return this.repository.addLink(id, typeId, otherIssueId, direction);
  }
  addIssueLink(typeId: string, outwardIssueId: string, inwardIssueId: string): Promise<void> {
    return this.repository.addIssueLink(typeId, outwardIssueId, inwardIssueId);
  }
  addComment(id: string, marker: string, body: string): Promise<void> {
    return this.repository.addComment(id, marker, body);
  }
  recordEffectCall(operation: JiraMockEffectOperation, requestBody: unknown): Promise<void> {
    return this.repository.recordEffectCall(operation, requestBody);
  }
  metadata() {
    return Object.freeze({
      version: "local-cloud-fixture",
      projects: [
        { id: "100", key: "QAC", name: "QA Central" },
        { id: "200", key: "APP", name: "Application" },
      ],
      issueTypes: [
        { id: "10001", name: "QA Request", projectIds: ["100"] },
        { id: "10002", name: "Bug", projectIds: ["200"] },
      ],
      fields: [
        { id: "summary", name: "Summary", schemaType: "string" },
        { id: "customfield_10010", name: "Project discriminator", schemaType: "string" },
        { id: "customfield_10011", name: "Effect marker", schemaType: "string" },
      ],
      statuses: [
        { id: "1", name: "Open" },
        { id: "2", name: "Done" },
      ],
      transitions: [{ id: "11", name: "Done", fromStatusIds: ["1"], toStatusId: "2" }],
      priorities: [{ id: "1", name: "High" }],
      linkTypes: [{ id: "10000", name: "Relates", inward: "relates to", outward: "relates to" }],
      capabilities: { search: true, webhooks: true, properties: true },
      rateHeaders: { "x-ratelimit-remaining": "299" },
    });
  }
}
