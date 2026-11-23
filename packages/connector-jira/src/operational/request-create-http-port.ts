import { type JsonValue, sha256 } from "@awp/platform-contracts";

import type { JiraDialect } from "../dialects/jira-cloud-v3.ts";
import type { JiraRestClient } from "../http/jira-rest-client.ts";
import { type JiraEffectLookup, lookupJiraEffect } from "./jira-effect-control.ts";
import type { RequestCreateObservation, RequestCreatePort } from "./request-create.ts";
import type { RequestSubEffect } from "./request-create-reconciliation.ts";

export type JiraRemoteLinkWriteStrategy =
  | Readonly<{ kind: "ISSUE_PROPERTY"; propertyKeyPrefix: string }>
  | Readonly<{ kind: "JIRA_REMOTE_LINK" }>;

export interface JiraHttpRequestCreatePortOptions {
  readonly client: JiraRestClient;
  readonly dialect: JiraDialect;
  readonly projectId: string;
  readonly issueTypeId: string;
  readonly markerFieldId: string;
  readonly authorityFieldIds?: readonly string[];
  readonly issueLinkTypeId?: string;
  readonly issueLinkDirection?: "INWARD" | "OUTWARD";
  readonly remoteLinkStrategy?: JiraRemoteLinkWriteStrategy;
  readonly maxSearchPages?: number;
}

interface JiraSearchIssue {
  readonly id?: unknown;
}
interface JiraSearchPage {
  readonly issues?: unknown;
  readonly total?: unknown;
  readonly startAt?: unknown;
  readonly nextPageToken?: unknown;
  readonly isLast?: unknown;
}

interface JiraIssueDocument {
  readonly id?: unknown;
  readonly key?: unknown;
  readonly updated?: unknown;
  readonly changelogId?: unknown;
  readonly fields?: unknown;
  readonly changelog?: unknown;
  readonly links?: unknown;
  readonly comments?: unknown;
}

interface ObservedIssueLink {
  readonly typeId: string;
  readonly direction: "INWARD" | "OUTWARD";
  readonly issueId: string;
}

const identifier = /^[A-Za-z0-9._-]+$/u;
const markerField = /^customfield_[1-9][0-9]*$/u;

function assertIdentifier(value: string, code: string): void {
  if (!value || !identifier.test(value)) throw new Error(code);
}

function assertMarker(value: string): void {
  if (!value || value.length > 255 || /\p{Cc}/u.test(value))
    throw new Error("JIRA_EFFECT_MARKER_INVALID");
}

function escapeJqlLiteral(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function asRecord(value: unknown, code: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(code);
  return value as Readonly<Record<string, unknown>>;
}

async function responseJson(
  response: Response,
  code: string,
): Promise<Readonly<Record<string, unknown>>> {
  try {
    return asRecord(await response.json(), code);
  } catch (error) {
    if (error instanceof Error && error.message === code) throw error;
    throw new Error(code, { cause: error });
  }
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function selectedAuthorityFields(
  fields: Readonly<Record<string, unknown>>,
  fieldIds: readonly string[] | undefined,
): Readonly<Record<string, unknown>> {
  if (!fieldIds?.length) return fields;
  return Object.freeze(
    Object.fromEntries(fieldIds.map((fieldId) => [fieldId, fields[fieldId] ?? null])),
  );
}

function latestChangelogId(changelog: unknown): string | undefined {
  if (typeof changelog !== "object" || changelog === null || Array.isArray(changelog))
    return undefined;
  const histories = (changelog as Readonly<Record<string, unknown>>).histories;
  if (!Array.isArray(histories)) return undefined;
  const ids = histories
    .map((history) =>
      typeof history === "object" && history !== null && !Array.isArray(history)
        ? (history as Readonly<Record<string, unknown>>).id
        : undefined,
    )
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  return ids.at(-1);
}

function observedIssueLinks(issue: JiraIssueDocument): readonly ObservedIssueLink[] {
  const result: ObservedIssueLink[] = [];
  if (Array.isArray(issue.links)) {
    for (const value of issue.links) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const link = value as Readonly<Record<string, unknown>>;
      if (
        typeof link.typeId === "string" &&
        (link.direction === "INWARD" || link.direction === "OUTWARD") &&
        typeof link.issueId === "string"
      )
        result.push({ typeId: link.typeId, direction: link.direction, issueId: link.issueId });
    }
  }
  const fields =
    issue.fields && typeof issue.fields === "object" && !Array.isArray(issue.fields)
      ? (issue.fields as Readonly<Record<string, unknown>>)
      : undefined;
  if (Array.isArray(fields?.issuelinks)) {
    for (const value of fields.issuelinks) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const link = value as Readonly<Record<string, unknown>>;
      const type =
        link.type && typeof link.type === "object" && !Array.isArray(link.type)
          ? (link.type as Readonly<Record<string, unknown>>)
          : undefined;
      const typeId = typeof type?.id === "string" ? type.id : undefined;
      for (const [key, direction] of [
        ["outwardIssue", "OUTWARD"],
        ["inwardIssue", "INWARD"],
      ] as const) {
        const other =
          link[key] && typeof link[key] === "object" && !Array.isArray(link[key])
            ? (link[key] as Readonly<Record<string, unknown>>)
            : undefined;
        if (typeId && typeof other?.id === "string")
          result.push({ typeId, direction, issueId: other.id });
      }
    }
  }
  return Object.freeze(result);
}

function receipt(prefix: string, value: Readonly<Record<string, unknown>>): string {
  return `${prefix}:${sha256(value as JsonValue)}`;
}

/**
 * Pure Jira HTTP adapter for the request-create protocol.
 *
 * The caller supplies an already selected exact Cloud/DC dialect. The adapter
 * never auto-detects or falls back to `/latest`, and every request still passes
 * through JiraRestClient's environment/origin/redirect/size boundary.
 */
export class JiraHttpRequestCreatePort implements RequestCreatePort {
  readonly #client: JiraRestClient;
  readonly #dialect: JiraDialect;
  readonly #projectId: string;
  readonly #issueTypeId: string;
  readonly #markerFieldId: string;
  readonly #authorityFieldIds: readonly string[] | undefined;
  readonly #issueLinkTypeId: string | undefined;
  readonly #issueLinkDirection: "INWARD" | "OUTWARD";
  readonly #remoteLinkStrategy: JiraRemoteLinkWriteStrategy;
  readonly #maxSearchPages: number;

  constructor(options: JiraHttpRequestCreatePortOptions) {
    assertIdentifier(options.projectId, "JIRA_REQUEST_PROJECT_ID_INVALID");
    assertIdentifier(options.issueTypeId, "JIRA_REQUEST_ISSUE_TYPE_ID_INVALID");
    if (!markerField.test(options.markerFieldId))
      throw new Error("JIRA_EFFECT_MARKER_FIELD_INVALID");
    for (const fieldId of options.authorityFieldIds ?? [])
      assertIdentifier(fieldId, "JIRA_AUTHORITY_FIELD_ID_INVALID");
    if (options.issueLinkTypeId !== undefined)
      assertIdentifier(options.issueLinkTypeId, "JIRA_ISSUE_LINK_TYPE_ID_INVALID");
    const remoteLinkStrategy =
      options.remoteLinkStrategy ??
      Object.freeze({ kind: "ISSUE_PROPERTY" as const, propertyKeyPrefix: "awp.remote-link" });
    if (remoteLinkStrategy.kind === "ISSUE_PROPERTY")
      assertIdentifier(
        remoteLinkStrategy.propertyKeyPrefix,
        "JIRA_REMOTE_LINK_PROPERTY_PREFIX_INVALID",
      );
    const maxSearchPages = options.maxSearchPages ?? 32;
    if (!Number.isSafeInteger(maxSearchPages) || maxSearchPages < 1 || maxSearchPages > 1_000)
      throw new Error("JIRA_MARKER_SEARCH_PAGE_LIMIT_INVALID");
    this.#client = options.client;
    this.#dialect = options.dialect;
    this.#projectId = options.projectId;
    this.#issueTypeId = options.issueTypeId;
    this.#markerFieldId = options.markerFieldId;
    this.#authorityFieldIds = options.authorityFieldIds
      ? Object.freeze([...options.authorityFieldIds])
      : undefined;
    this.#issueLinkTypeId = options.issueLinkTypeId;
    this.#issueLinkDirection = options.issueLinkDirection ?? "OUTWARD";
    this.#remoteLinkStrategy = remoteLinkStrategy;
    this.#maxSearchPages = maxSearchPages;
  }

  async lookup(marker: string): Promise<JiraEffectLookup> {
    assertMarker(marker);
    const jql = `project = "${escapeJqlLiteral(this.#projectId)}" AND issuetype = "${escapeJqlLiteral(this.#issueTypeId)}" AND ${this.#markerFieldId} = "${escapeJqlLiteral(marker)}"`;
    const matches: string[] = [];
    let nextPageToken: string | undefined;
    let startAt = 0;
    let visibilityProven = false;
    const seenTokens = new Set<string>();

    for (let pageNumber = 0; pageNumber < this.#maxSearchPages; pageNumber += 1) {
      const query = new URLSearchParams({ jql, fields: "id", maxResults: "2" });
      if (this.#dialect.pagination === "TOKEN") {
        if (nextPageToken) query.set("nextPageToken", nextPageToken);
      } else {
        query.set("startAt", String(startAt));
      }
      const response = await this.#client.request({
        method: "GET",
        path: `${this.#dialect.searchPath()}?${query}`,
      });
      const page = (await responseJson(
        response,
        "JIRA_MARKER_SEARCH_RESPONSE_INVALID",
      )) as JiraSearchPage;
      if (!Array.isArray(page.issues)) throw new Error("JIRA_MARKER_SEARCH_ISSUES_INVALID");
      const pageIds = page.issues.map((issue) =>
        requiredString((issue as JiraSearchIssue)?.id, "JIRA_MARKER_SEARCH_ISSUE_ID_INVALID"),
      );
      matches.push(...pageIds);
      if (new Set(matches).size > 1) return lookupJiraEffect(matches, true);

      if (this.#dialect.pagination === "TOKEN") {
        const ownsToken = Object.hasOwn(page, "nextPageToken");
        const token =
          typeof page.nextPageToken === "string" && page.nextPageToken.length > 0
            ? page.nextPageToken
            : undefined;
        if (token) {
          if (seenTokens.has(token)) throw new Error("JIRA_MARKER_SEARCH_TOKEN_REPEATED");
          seenTokens.add(token);
          nextPageToken = token;
          continue;
        }
        const total = finiteNonNegative(page.total);
        visibilityProven =
          page.isLast === true ||
          (ownsToken && (page.nextPageToken === null || page.nextPageToken === "")) ||
          (total !== undefined && total <= matches.length);
        break;
      }

      const total = finiteNonNegative(page.total);
      const responseStart = finiteNonNegative(page.startAt) ?? startAt;
      if (total === undefined) break;
      const covered = responseStart + pageIds.length;
      if (covered >= total) {
        visibilityProven = true;
        break;
      }
      if (pageIds.length === 0) throw new Error("JIRA_MARKER_SEARCH_PAGE_EMPTY");
      startAt = covered;
    }

    if (!visibilityProven && this.#dialect.pagination === "TOKEN" && nextPageToken)
      throw new Error("JIRA_MARKER_SEARCH_PAGE_LIMIT");
    if (!visibilityProven) return Object.freeze({ state: "UNKNOWN" });
    return lookupJiraEffect(matches, visibilityProven);
  }

  async create(
    input: Readonly<{ fields: Readonly<Record<string, unknown>>; marker: string }>,
  ): Promise<Readonly<{ externalEntityId: string }>> {
    assertMarker(input.marker);
    const fields = Object.freeze({
      ...input.fields,
      project: Object.freeze({ id: this.#projectId }),
      issuetype: Object.freeze({ id: this.#issueTypeId }),
      [this.#markerFieldId]: input.marker,
    });
    const response = await this.#client.request({
      method: "POST",
      path: this.#dialect.createIssuePath(),
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ fields }),
    });
    const result = await responseJson(response, "JIRA_REQUEST_CREATE_RESPONSE_INVALID");
    return Object.freeze({
      externalEntityId: requiredString(result.id, "JIRA_REQUEST_CREATE_ID_INVALID"),
    });
  }

  async observe(externalEntityId: string): Promise<RequestCreateObservation> {
    assertIdentifier(externalEntityId, "JIRA_REQUEST_EXTERNAL_ID_INVALID");
    const query = new URLSearchParams({
      fields: this.#authorityFieldIds?.length
        ? [...this.#authorityFieldIds, "updated"].join(",")
        : "*all",
      expand: "changelog",
    });
    const response = await this.#client.request({
      method: "GET",
      path: `${this.#dialect.issuePath(externalEntityId)}?${query}`,
    });
    const issue = (await responseJson(
      response,
      "JIRA_REQUEST_OBSERVATION_INVALID",
    )) as JiraIssueDocument;
    const observedId = requiredString(issue.id, "JIRA_REQUEST_OBSERVATION_ID_INVALID");
    if (observedId !== externalEntityId) throw new Error("JIRA_REQUEST_OBSERVATION_ID_MISMATCH");
    const fields = asRecord(issue.fields, "JIRA_REQUEST_OBSERVATION_FIELDS_INVALID");
    const authorityFields = selectedAuthorityFields(fields, this.#authorityFieldIds);
    const authorityFieldsHash = sha256(authorityFields as JsonValue);
    const updated = requiredString(
      issue.updated ?? fields.updated,
      "JIRA_REQUEST_OBSERVATION_UPDATED_INVALID",
    );
    if (Number.isNaN(Date.parse(updated)))
      throw new Error("JIRA_REQUEST_OBSERVATION_UPDATED_INVALID");
    const changelogId =
      typeof issue.changelogId === "string" && issue.changelogId.length > 0
        ? issue.changelogId
        : latestChangelogId(issue.changelog);
    return Object.freeze({
      externalEntityId: observedId,
      externalDisplayKey: requiredString(issue.key, "JIRA_REQUEST_OBSERVATION_KEY_INVALID"),
      externalRevisionToken: `${updated}:${changelogId ?? authorityFieldsHash}`,
      authorityFieldsHash,
      providerUpdatedAt: updated,
      ...(changelogId ? { providerChangelogId: changelogId } : {}),
      authorityFields,
    });
  }

  async putProperty(
    externalEntityId: string,
    propertyKey: string,
    value: unknown,
  ): Promise<string> {
    assertIdentifier(externalEntityId, "JIRA_REQUEST_EXTERNAL_ID_INVALID");
    assertIdentifier(propertyKey, "JIRA_ISSUE_PROPERTY_KEY_INVALID");
    await this.#client.request({
      method: "PUT",
      path: this.#dialect.issuePropertyPath(externalEntityId, propertyKey),
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(value),
    });
    return receipt("jira-property", { externalEntityId, propertyKey, value } as Readonly<
      Record<string, unknown>
    >);
  }

  async applySubEffect(externalEntityId: string, effect: RequestSubEffect): Promise<string> {
    assertIdentifier(externalEntityId, "JIRA_REQUEST_EXTERNAL_ID_INVALID");
    if (!effect.semanticIdentity) throw new Error("JIRA_SUB_EFFECT_IDENTITY_REQUIRED");
    if (effect.kind === "LINK") return await this.#applyIssueLink(externalEntityId, effect);
    if (effect.kind === "REMOTE_LINK") return await this.#applyRemoteLink(externalEntityId, effect);
    if (effect.kind === "COMMENT") return await this.#applyComment(externalEntityId, effect);
    throw new Error("JIRA_SUB_EFFECT_KIND_UNSUPPORTED");
  }

  async #applyIssueLink(externalEntityId: string, effect: RequestSubEffect): Promise<string> {
    if (!this.#issueLinkTypeId) throw new Error("JIRA_ISSUE_LINK_TYPE_REQUIRED");
    const otherIssueId = requiredString(
      effect.payload.externalEntityId,
      "JIRA_ISSUE_LINK_TARGET_REQUIRED",
    );
    const tuple = Object.freeze({
      issueId: externalEntityId,
      typeId: this.#issueLinkTypeId,
      otherIssueId,
      direction: this.#issueLinkDirection,
    });
    const currentResponse = await this.#client.request({
      method: "GET",
      path: `${this.#dialect.issuePath(externalEntityId)}?fields=issuelinks`,
    });
    const current = (await responseJson(
      currentResponse,
      "JIRA_ISSUE_LINK_OBSERVATION_INVALID",
    )) as JiraIssueDocument;
    const matching = observedIssueLinks(current).filter(
      (link) => link.typeId === this.#issueLinkTypeId && link.issueId === otherIssueId,
    );
    if (matching.some((link) => link.direction === this.#issueLinkDirection)) {
      return receipt("jira-link", { semanticIdentity: effect.semanticIdentity, ...tuple });
    }
    if (matching.length > 0) throw new Error("JIRA_ISSUE_LINK_DIRECTION_CONFLICT");
    const body =
      this.#issueLinkDirection === "OUTWARD"
        ? Object.freeze({
            type: Object.freeze({ id: this.#issueLinkTypeId }),
            outwardIssue: Object.freeze({ id: externalEntityId }),
            inwardIssue: Object.freeze({ id: otherIssueId }),
          })
        : Object.freeze({
            type: Object.freeze({ id: this.#issueLinkTypeId }),
            outwardIssue: Object.freeze({ id: otherIssueId }),
            inwardIssue: Object.freeze({ id: externalEntityId }),
          });
    await this.#client.request({
      method: "POST",
      path: this.#dialect.issueLinkPath(),
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    return receipt("jira-link", { semanticIdentity: effect.semanticIdentity, ...tuple });
  }

  async #applyRemoteLink(externalEntityId: string, effect: RequestSubEffect): Promise<string> {
    if (this.#remoteLinkStrategy.kind === "ISSUE_PROPERTY") {
      const suffix = sha256(effect.semanticIdentity as JsonValue).slice(
        "sha256:".length,
        "sha256:".length + 24,
      );
      return await this.putProperty(
        externalEntityId,
        `${this.#remoteLinkStrategy.propertyKeyPrefix}.${suffix}`,
        Object.freeze({
          kind: "REMOTE_LINK",
          semanticIdentity: effect.semanticIdentity,
          payload: effect.payload,
        }),
      );
    }
    const url = requiredString(effect.payload.url, "JIRA_REMOTE_LINK_URL_REQUIRED");
    if (!url.startsWith("https://")) throw new Error("JIRA_REMOTE_LINK_URL_FORBIDDEN");
    const body = Object.freeze({
      globalId: `awp:${sha256(effect.semanticIdentity as JsonValue)}`,
      object: Object.freeze({
        url,
        title:
          typeof effect.payload.title === "string" && effect.payload.title.length > 0
            ? effect.payload.title
            : effect.semanticIdentity,
      }),
    });
    await this.#client.request({
      method: "POST",
      path: this.#dialect.issueRemoteLinkPath(externalEntityId),
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    return receipt("jira-remote-link", {
      externalEntityId,
      semanticIdentity: effect.semanticIdentity,
      body,
    });
  }

  async #applyComment(externalEntityId: string, effect: RequestSubEffect): Promise<string> {
    const marker =
      typeof effect.payload.marker === "string" && effect.payload.marker.length > 0
        ? effect.payload.marker
        : effect.semanticIdentity;
    const bodyText =
      typeof effect.payload.body === "string" && effect.payload.body.length > 0
        ? effect.payload.body
        : requiredString(effect.payload.reference, "JIRA_COMMENT_BODY_REQUIRED");
    const body = Object.freeze({ marker, body: bodyText });
    await this.#client.request({
      method: "POST",
      path: this.#dialect.issueCommentPath(externalEntityId),
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    return receipt("jira-comment", {
      externalEntityId,
      semanticIdentity: effect.semanticIdentity,
      body,
    });
  }
}

export function createJiraHttpRequestCreatePort(
  options: JiraHttpRequestCreatePortOptions,
): JiraHttpRequestCreatePort {
  return new JiraHttpRequestCreatePort(options);
}
