import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  InternalServerErrorException,
  Param,
  Post,
  Put,
  Query,
  RequestTimeoutException,
  UnauthorizedException,
} from "@nestjs/common";

import {
  type JiraMockEffectOperation,
  type JiraMockIssue,
  JiraMockService,
} from "./jira.repository.ts";
import { type JiraScenario, JiraScenarioController } from "./jira-scenarios.ts";

function beforeRequest(scenario: JiraScenario): void {
  if (scenario === "TIMEOUT_BEFORE_EFFECT") {
    throw new RequestTimeoutException({ code: "JIRA_MOCK_TIMEOUT_BEFORE_EFFECT" });
  }
  if (scenario === "AUTHENTICATION_401") {
    throw new UnauthorizedException({ code: "JIRA_MOCK_AUTHENTICATION_401" });
  }
  if (scenario === "PERMISSION_403") {
    throw new ForbiddenException({ code: "JIRA_MOCK_PERMISSION_403" });
  }
  if (scenario === "RATE_LIMIT_429") {
    throw new HttpException({ code: "JIRA_MOCK_RATE_LIMIT_429" }, HttpStatus.TOO_MANY_REQUESTS);
  }
  if (scenario === "SERVER_500") {
    throw new InternalServerErrorException({ code: "JIRA_MOCK_SERVER_500" });
  }
  if (scenario === "SCHEMA_DRIFT") {
    throw new InternalServerErrorException({ code: "JIRA_MOCK_SCHEMA_DRIFT" });
  }
}

function afterEffect(scenario: JiraScenario): void {
  if (scenario === "TIMEOUT_AFTER_EFFECT") {
    throw new RequestTimeoutException({ code: "JIRA_MOCK_TIMEOUT_AFTER_EFFECT" });
  }
}

function requestRecord(value: unknown, code: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException({ code });
  }
  return value as Readonly<Record<string, unknown>>;
}

function requestIdentifier(value: unknown, code: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]+$/u.test(value)) {
    throw new BadRequestException({ code });
  }
  return value;
}

function requestName(value: unknown, code: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 255 ||
    /\p{Cc}/u.test(value)
  ) {
    throw new BadRequestException({ code });
  }
  return value;
}

function issueRefId(
  body: Readonly<Record<string, unknown>>,
  field: "inwardIssue" | "outwardIssue",
): string {
  const reference = requestRecord(body[field], "JIRA_MOCK_ISSUE_LINK_REFERENCE_INVALID");
  return requestIdentifier(reference.id, "JIRA_MOCK_ISSUE_LINK_REFERENCE_ID_INVALID");
}

function issueLinkTypeId(
  body: Readonly<Record<string, unknown>>,
  linkTypes: readonly Readonly<{ id: string; name: string }>[],
): string {
  const type = requestRecord(body.type, "JIRA_MOCK_ISSUE_LINK_TYPE_INVALID");
  if (type.id !== undefined)
    return requestIdentifier(type.id, "JIRA_MOCK_ISSUE_LINK_TYPE_ID_INVALID");
  const name = requestName(type.name, "JIRA_MOCK_ISSUE_LINK_TYPE_NAME_INVALID");
  const configured = linkTypes.find((candidate) => candidate.name === name);
  if (!configured) throw new BadRequestException({ code: "JIRA_MOCK_ISSUE_LINK_TYPE_UNKNOWN" });
  return configured.id;
}

function issueDocument(
  issue: JiraMockIssue,
  linkTypes: readonly Readonly<{ id: string; name: string; inward: string; outward: string }>[],
): Readonly<Record<string, unknown>> {
  const issueLinks = issue.links.map((link) => {
    const type = linkTypes.find((candidate) => candidate.id === link.typeId);
    if (!type) throw new Error("JIRA_MOCK_ISSUE_LINK_TYPE_UNKNOWN");
    return Object.freeze({
      type: Object.freeze({ ...type }),
      ...(link.direction === "OUTWARD"
        ? { outwardIssue: Object.freeze({ id: link.issueId }) }
        : { inwardIssue: Object.freeze({ id: link.issueId }) }),
    });
  });
  return Object.freeze({
    id: issue.id,
    key: issue.key,
    updated: issue.updated,
    changelogId: issue.changelogId,
    fields: Object.freeze({
      // Older fixtures omitted the initial workflow state. Jira supplies it even
      // when a create request does not include a status field.
      status: Object.freeze({ id: "1", name: "Open" }),
      ...issue.fields,
      project: Object.freeze({ id: issue.projectId }),
      issuetype: Object.freeze({ id: issue.issueTypeId }),
      updated: issue.updated,
      issuelinks: Object.freeze(issueLinks),
    }),
  });
}

@Controller()
export class JiraController {
  constructor(
    @Inject(JiraMockService) private readonly service: JiraMockService,
    @Inject(JiraScenarioController) private readonly scenarios: JiraScenarioController,
  ) {}
  @Get(["rest/api/3/serverInfo", "rest/api/2/serverInfo"]) serverInfo() {
    return {
      buildNumber: "local-cloud-fixture",
      version: "11.0.0",
      metadata: this.service.metadata(),
    };
  }
  @Get(["rest/api/3/issue/:id", "rest/api/2/issue/:id"])
  async issue(@Param("id") id: string) {
    const scenario = await this.scenarios.consume("READ");
    beforeRequest(scenario);
    return issueDocument(await this.service.issue(id), this.service.metadata().linkTypes);
  }
  @Post(["rest/api/3/issue", "rest/api/2/issue"])
  async create(@Body() body: Record<string, unknown>) {
    return await this.runEffect("CREATE", body, async () => {
      const fields = (body.fields ?? {}) as Record<string, unknown>;
      const marker =
        typeof fields.customfield_10011 === "string" ? fields.customfield_10011 : undefined;
      return await this.service.createIssue({
        projectId: String((fields.project as Record<string, unknown> | undefined)?.id ?? "100"),
        issueTypeId: String(
          (fields.issuetype as Record<string, unknown> | undefined)?.id ?? "10001",
        ),
        fields,
        ...(marker ? { marker } : {}),
      });
    });
  }
  @Get(["rest/api/3/search/jql", "rest/api/2/search"])
  async search(
    @Query("marker") marker: string | undefined,
    @Query("jql") jql: string | undefined,
  ): Promise<Readonly<Record<string, unknown>>> {
    const scenario = await this.scenarios.consume("LOOKUP");
    beforeRequest(scenario);
    if (scenario === "EVENTUAL_SEARCH_ZERO") return Object.freeze({ issues: Object.freeze([]) });
    const match = marker ?? /customfield_10011\s*=\s*"([^"]+)"/u.exec(jql ?? "")?.[1] ?? "";
    const scoped =
      /^project\s*=\s*([A-Za-z0-9._-]+)\s+AND\s+issuetype\s*=\s*([A-Za-z0-9._-]+)\s+AND\s+(customfield_[1-9][0-9]*)\s*=\s*"([A-Za-z0-9._-]+)"$/u.exec(
        jql ?? "",
      );
    const issues = match
      ? await this.service.searchByMarker(match)
      : scoped
        ? await this.service.searchByScope(scoped[1]!, scoped[2]!, scoped[3]!, scoped[4]!)
        : [];
    return Object.freeze({ issues, total: issues.length, nextPageToken: null, startAt: 0 });
  }
  @Put(["rest/api/3/issue/:id", "rest/api/2/issue/:id"])
  async edit(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    const fields = requestRecord(body.fields, "JIRA_MOCK_ISSUE_FIELDS_INVALID");
    return await this.runEffect("PROPERTY", { id, fields }, async () =>
      issueDocument(
        await this.service.updateIssueFields(id, fields),
        this.service.metadata().linkTypes,
      ),
    );
  }
  @Post(["rest/api/3/issue/:id/transitions", "rest/api/2/issue/:id/transitions"])
  async transition(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    const transition = requestRecord(body.transition, "JIRA_MOCK_TRANSITION_INVALID");
    const transitionId = requestIdentifier(transition.id, "JIRA_MOCK_TRANSITION_ID_INVALID");
    if (transitionId !== "11")
      throw new BadRequestException({ code: "JIRA_MOCK_TRANSITION_UNKNOWN" });
    return await this.runEffect("PROPERTY", { id, transition: { id: transitionId } }, async () =>
      issueDocument(
        await this.service.updateIssueFields(id, { status: { id: "2", name: "Done" } }),
        this.service.metadata().linkTypes,
      ),
    );
  }
  @Put(["rest/api/3/issue/:id/properties/:key", "rest/api/2/issue/:id/properties/:key"])
  async property(@Param("id") id: string, @Param("key") key: string, @Body() value: unknown) {
    return await this.runEffect("PROPERTY", { id, key, value }, async () => {
      await this.service.putProperty(id, key, value);
      return { ok: true };
    });
  }
  @Post(["rest/api/3/issueLink", "rest/api/2/issueLink"])
  async link(@Body() body: Record<string, unknown>): Promise<void> {
    await this.runEffect("LINK", body, async () => {
      const typeId = issueLinkTypeId(body, this.service.metadata().linkTypes);
      const outwardIssueId = issueRefId(body, "outwardIssue");
      const inwardIssueId = issueRefId(body, "inwardIssue");
      await this.service.addIssueLink(typeId, outwardIssueId, inwardIssueId);
    });
  }
  @Post(["rest/api/3/issue/:id/comment", "rest/api/2/issue/:id/comment"])
  async comment(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return await this.runEffect("COMMENT", { id, ...body }, async () => {
      await this.service.addComment(id, String(body.marker), String(body.body));
      return { ok: true };
    });
  }
  @Post("mock/jira/scenario")
  async scenario(@Body() body: { scenario: Parameters<JiraScenarioController["set"]>[0] }) {
    await this.scenarios.set(body.scenario);
    return { ok: true };
  }
  @Get("mock/jira/rate") rate() {
    return this.service.metadata().rateHeaders;
  }

  private async runEffect<T>(
    operation: JiraMockEffectOperation,
    requestBody: unknown,
    effect: () => Promise<T>,
  ): Promise<T> {
    await this.service.recordEffectCall(operation, requestBody);
    const scenario = await this.scenarios.consume(operation);
    beforeRequest(scenario);
    const result = await effect();
    afterEffect(scenario);
    return result;
  }
}
