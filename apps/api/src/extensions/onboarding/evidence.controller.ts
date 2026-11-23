import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import type { DataSource } from "typeorm";

import type { ExactRevisionRef } from "@awp/platform-core";

import {
  authorizeQaApi,
  QA_DATA_SOURCE,
  QaSessionGuard,
  type QaSessionRequest,
} from "../qa-api-authorization.ts";
import {
  DurableEvidenceHttpApplication,
  EVIDENCE_HTTP_APPLICATION,
  EvidenceHttpError,
} from "./evidence.application.ts";
import { PublishedOnboardingProblemFilter } from "./published-http.ts";

const invalid = (code: string): never => {
  throw new HttpException({ code }, 400);
};
const uuid = (value: string) =>
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu.test(value)
    ? value
    : invalid("EVIDENCE_ID_INVALID");
const version = (value: unknown) => {
  const result = Number(value);
  if (!/^[1-9][0-9]*$/u.test(String(value)) || !Number.isSafeInteger(result))
    return invalid("EVIDENCE_VERSION_INVALID");
  return result;
};
const key = (value: string | undefined) =>
  value && value.length >= 8 && value.length <= 256 && !/[\r\n]/u.test(value)
    ? value
    : invalid("IDEMPOTENCY_KEY_INVALID");
const object = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    return invalid("EVIDENCE_COMMAND_INVALID");
  return value as Record<string, unknown>;
};
const reason = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 2000
    ? value.trim()
    : invalid("EVIDENCE_REASON_REQUIRED");
const exact = (value: unknown): ExactRevisionRef => {
  const ref = object(value, ["id", "version", "contentHash"]);
  if (
    typeof ref.id !== "string" ||
    ref.id.length < 1 ||
    ref.id.length > 256 ||
    typeof ref.contentHash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(ref.contentHash)
  )
    return invalid("EVIDENCE_POLICY_REF_INVALID");
  return {
    id: ref.id,
    version: version(ref.version),
    contentHash: ref.contentHash as `sha256:${string}`,
  };
};

@UseGuards(QaSessionGuard)
@Controller("v1/workspaces/:workspaceId/projects/:projectId/evidence")
@UseFilters(PublishedOnboardingProblemFilter)
export class EvidenceIntegrityController {
  constructor(
    @Inject(QA_DATA_SOURCE) private readonly source: DataSource,
    @Inject(EVIDENCE_HTTP_APPLICATION) private readonly application: DurableEvidenceHttpApplication,
  ) {}
  private request(
    request: QaSessionRequest,
    workspaceId: string,
    projectId: string,
    permission: string,
  ) {
    uuid(workspaceId);
    uuid(projectId);
    return {
      workspaceId,
      projectId,
      authorize: () => authorizeQaApi(this.source, request, workspaceId, projectId, permission),
    };
  }
  private async result<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof EvidenceHttpError)
        throw new HttpException({ code: error.code, state: "REJECTED" }, error.status);
      throw new HttpException({ code: "EVIDENCE_OPERATION_UNAVAILABLE", state: "REJECTED" }, 503);
    }
  }

  @Post("manifests/:manifestId/verify")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  verify(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("manifestId") manifestId: string,
    @Query("revision") revision: string,
  ) {
    return this.result(() =>
      this.application.verify({
        ...this.request(request, workspaceId, projectId, "qa.evidence.verify"),
        manifestId: uuid(manifestId),
        revision: version(revision),
      }),
    );
  }
  @Get("packages/:packageId")
  @Header("Cache-Control", "private, no-store")
  package(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("packageId") packageId: string,
  ) {
    return this.result(() =>
      this.application.getPackage({
        ...this.request(request, workspaceId, projectId, "qa.evidence.read"),
        packageId: uuid(packageId),
      }),
    );
  }
  @Get("export-options")
  @Header("Cache-Control", "private, no-store")
  exportOptions(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
  ) {
    return this.result(() =>
      this.application.exportOptions(
        this.request(request, workspaceId, projectId, "qa.evidence.export"),
      ),
    );
  }
  @Post("manifests/:manifestId/corrections")
  @HttpCode(202)
  @Header("Cache-Control", "private, no-store")
  correct(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("manifestId") manifestId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") etag: string | undefined,
    @Body() body: unknown,
  ) {
    const command = object(body, ["kind", "reason"]),
      match = /^"([1-9][0-9]*)"$/u.exec(etag ?? "");
    if (!match) return invalid("STRONG_IF_MATCH_REQUIRED");
    if (command.kind !== "CLERICAL" && command.kind !== "SUBSTANTIVE_CORRECTION")
      return invalid("EVIDENCE_CORRECTION_KIND_INVALID");
    const kind = command.kind;
    return this.result(() =>
      this.application.correct({
        ...this.request(
          request,
          workspaceId,
          projectId,
          "qa.evidence.post-close-correction.record",
        ),
        manifestId: uuid(manifestId),
        key: key(idempotencyKey),
        expectedVersion: version(match[1]),
        kind,
        reason: reason(command.reason),
      }),
    );
  }
  @Post("packages/:packageId/exports")
  @HttpCode(202)
  @Header("Cache-Control", "private, no-store")
  exportPackage(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("packageId") packageId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const command = object(body, ["packageVersion", "redactionPolicyRef", "format", "reason"]);
    if (command.format !== "JSON" && command.format !== "ZIP")
      return invalid("EVIDENCE_EXPORT_FORMAT_INVALID");
    const format = command.format;
    return this.result(() =>
      this.application.exportPackage({
        ...this.request(request, workspaceId, projectId, "qa.evidence.export"),
        packageId: uuid(packageId),
        packageVersion: version(command.packageVersion),
        key: key(idempotencyKey),
        redactionPolicyRef: exact(command.redactionPolicyRef),
        format,
        reason: reason(command.reason),
      }),
    );
  }
  @Get("exports/:exportId")
  @Header("Cache-Control", "private, no-store")
  exportResult(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("exportId") exportId: string,
  ) {
    return this.result(() =>
      this.application.getExport({
        ...this.request(request, workspaceId, projectId, "qa.evidence.export"),
        exportId: uuid(exportId),
      }),
    );
  }
}
