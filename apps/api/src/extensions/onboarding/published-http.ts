import { randomUUID } from "node:crypto";

import {
  type ArgumentsHost,
  type CallHandler,
  Catch,
  type ExceptionFilter,
  type ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { mergeMap } from "rxjs";
import type { DataSource } from "typeorm";

import { designContractRegistry } from "@awp/platform-contracts";
import type { ExactRevisionRef } from "@awp/platform-core";

import {
  QA_DATA_SOURCE,
  qaInteractionSession,
  type QaSessionRequest,
} from "../qa-api-authorization.ts";
import { currentAuthority, digest, etag, exact, reject, validHash } from "./durable-http.ts";
import { markPublishedOnboardingRequest } from "./published-http-context.ts";
import { validatePublishedRequest, validatePublishedResponse } from "./published-validation.ts";

type Document = Record<string, unknown>;
type Request = QaSessionRequest & {
  params: { workspaceId: string; projectId?: string };
  body?: Document;
  headers: Record<string, string | undefined>;
  method: string;
  correlationId?: string;
};
interface Response {
  statusCode: number;
  status(code: number): Response;
  type(value: string): Response;
  setHeader(key: string, value: string): unknown;
  json(body: unknown): unknown;
}
const doc = (v: unknown): Document => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    return reject("HTTP_PROJECTION_UNAVAILABLE", 503);
  return v as Document;
};
const actor = (v: unknown) => {
  const a = doc(v);
  if (typeof a.authenticationContextRef === "string") return a;
  const authentication = exact(a.authenticationContextRef),
    basis = exact(a.authorizationBasisRef);
  return {
    kind: "HUMAN",
    principalId: a.principalId,
    roleKey: a.roleKey,
    authorizationBasisHash: basis.contentHash,
    authenticationContextRef: `${authentication.id}@${authentication.version}#${authentication.contentHash}`,
    ...(a.stepUpAt ? { stepUpAt: a.stepUpAt } : {}),
  };
};
const schema = (key: string, version = 1) => `urn:awp:schemas:007:${key}:v${version}`;
/** Wire projections have their own canonical hash. AWP-Resource-Ref identifies the unchanged Core record. */
function projection(id: string, body: Document, overrides: Document = {}) {
  const definition = designContractRegistry.document(id).schema,
    properties = doc(definition.properties);
  const value = { ...body, ...overrides },
    selected = Object.fromEntries(
      Object.keys(properties)
        .filter((k) => k !== "contentHash" && value[k] !== undefined)
        .map((k) => [k, value[k]]),
    );
  const result = { ...selected, contentHash: digest(selected) };
  return designContractRegistry.validateById(id, result);
}
function packageDto(body: Document) {
  return projection(schema("project-onboarding-package"), body, {
    schemaVersion: 1,
    actor: actor(body.actor),
  });
}

@Catch()
export class PublishedOnboardingProblemFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const request = host.switchToHttp().getRequest<Request>(),
      response = host.switchToHttp().getResponse<Response>();
    let status = error instanceof HttpException ? error.getStatus() : 500;
    const payload = error instanceof HttpException ? error.getResponse() : undefined;
    const candidate =
      payload && typeof payload === "object"
        ? String((payload as Document).code ?? (payload as Document).message ?? "")
        : "";
    let code = /^[A-Z][A-Z0-9_]{1,63}$/u.test(candidate) ? candidate : `HTTP_${status}`;
    if (
      status === 404 ||
      (request.method === "GET" && status === 403) ||
      [
        "CURRENT_AUTHORIZATION_REQUIRED",
        "PROJECT_RESOURCE_NOT_AVAILABLE",
        "PROJECT_SCOPE_DENIED",
        "QA_SCOPE_DENIED",
        "QA_PERMISSION_DENIED",
      ].includes(code)
    ) {
      status = 404;
      code = "PROJECT_RESOURCE_NOT_AVAILABLE";
    }
    const title: Record<number, string> = {
      400: "Bad Request",
      401: "Unauthorized",
      403: "Forbidden",
      404: "Not Found",
      409: "Conflict",
      422: "Unprocessable Content",
      429: "Too Many Requests",
      500: "Internal Server Error",
      503: "Service Unavailable",
    };
    const correlationId =
      request.correlationId && /^[a-zA-Z0-9._:-]{8,256}$/u.test(request.correlationId)
        ? request.correlationId
        : randomUUID();
    response.setHeader("Cache-Control", "private, no-store");
    response
      .status(status)
      .type("application/problem+json")
      .json({
        type: `urn:awp:problem:${code.toLowerCase().replaceAll("_", "-")}`,
        title: title[status] ?? "Request Failed",
        status,
        code,
        correlationId,
      });
  }
}

@Injectable()
export class PublishedOnboardingInterceptor implements NestInterceptor {
  constructor(@Inject(QA_DATA_SOURCE) private readonly source: DataSource) {}
  intercept(context: ExecutionContext, next: CallHandler<unknown>) {
    const request = context.switchToHttp().getRequest<Request>(),
      response = context.switchToHttp().getResponse<Response>(),
      method = context.getHandler().name;
    markPublishedOnboardingRequest(request);
    validatePublishedRequest(method, request.body);
    if (method === "grantEntitlement") etag(request.headers["if-match"]);
    if (
      method === "validateBinding" &&
      (!Array.isArray(request.body?.probeKeys) || !request.body.probeKeys.length)
    )
      reject("CAPABILITY_PROBE_KEYS_REQUIRED", 400);
    if (
      method === "register" &&
      (typeof request.body?.key !== "string" || !/^[A-Z][A-Z0-9_-]{1,31}$/u.test(request.body.key))
    )
      reject("PROJECT_KEY_INVALID", 400);
    return next.handle().pipe(
      mergeMap(async (value) => {
        const result = doc(value),
          workspaceId = request.params.workspaceId,
          projectId = request.params.projectId ?? String(result.projectId);
        const projected = await this.source.transaction("REPEATABLE READ", async (manager) => {
          const snapshot = async (
            table: string,
            idColumn: string,
            target: ExactRevisionRef,
            project = projectId,
          ) => {
            // Names come exclusively from this closed dispatch table; only scope/ref values are variable.
            const [row] = (await manager.query(
              `SELECT semantic_body,content_hash FROM ${table} WHERE workspace_id=$1 AND project_id=$2 AND ${idColumn}=$3 AND version=$4`,
              [workspaceId, project, target.id, target.version],
            )) as { semantic_body: Document; content_hash: string }[];
            if (
              !row ||
              row.content_hash !== target.contentHash ||
              row.semantic_body.contentHash !== row.content_hash ||
              !validHash(row.semantic_body as { contentHash: string })
            )
              return reject("HTTP_PROJECTION_UNAVAILABLE", 503);
            return row.semantic_body;
          };
          if (method === "catalog") {
            const items: Document[] = [],
              session = await qaInteractionSession(request);
            for (const value of result.items as Document[]) {
              const project = String(value.id);
              await currentAuthority(
                manager,
                { kind: "PROJECT", workspaceId, projectId: project },
                session.principalId,
                "project.catalog.read",
                undefined,
                session.authentication,
              );
              const [row] = (await manager.query(
                "SELECT semantic_body,content_hash FROM project_onboarding_revisions WHERE workspace_id=$1 AND project_id=$2 AND version=$3",
                [workspaceId, project, value.version],
              )) as { semantic_body: Document; content_hash: string }[];
              if (
                !row ||
                !validHash(row.semantic_body as { contentHash: string }) ||
                row.semantic_body.contentHash !== row.content_hash
              )
                return reject("HTTP_PROJECTION_UNAVAILABLE", 503);
              items.push(packageDto(row.semantic_body));
            }
            return { items, ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}) };
          }
          const target = result.resultRef ? exact(result.resultRef) : undefined;
          const headers = (version: number, reference = target) => {
            response.setHeader("ETag", `"${version}"`);
            if (reference) response.setHeader("AWP-Resource-Ref", JSON.stringify(reference));
          };
          if (["register", "onboarding", "suspend", "resume", "activatePilot"].includes(method)) {
            if (!target) return reject("HTTP_PROJECTION_UNAVAILABLE", 503);
            const body = await snapshot("project_onboarding_revisions", "revision_id", target);
            headers(target.version);
            response.status(method === "register" ? 201 : 200);
            return packageDto(body);
          }
          if (["grantEntitlement", "replaceEntitlement", "revokeEntitlement"].includes(method)) {
            if (!target) return reject("HTTP_PROJECTION_UNAVAILABLE", 503);
            const body = await snapshot("project_entitlement_revisions", "revision_id", target);
            headers(target.version);
            response.status(method === "revokeEntitlement" ? 200 : 201);
            return projection(schema("project-entitlement-revision"), body, {
              schemaVersion: 1,
              actor: actor(body.actor),
            });
          }
          const resources: Record<string, [string, string, string, number]> = {
            publishQaEnvironment: [
              "qa_project_environment_revisions",
              "environment_id",
              schema("project-environment-revision"),
              201,
            ],
            publishQaContext: [
              "qa_project_context_revisions_v2",
              "context_id",
              schema("qa-project-context", 2),
              201,
            ],
            acquireAccountLease: [
              "qa_test_account_leases",
              "lease_id",
              schema("test-account-lease"),
              201,
            ],
            releaseAccountLease: [
              "qa_test_account_leases",
              "lease_id",
              schema("test-account-lease"),
              200,
            ],
          };
          const resource = resources[method];
          if (resource) {
            if (!target) return reject("HTTP_PROJECTION_UNAVAILABLE", 503);
            const body = await snapshot(resource[0], resource[1], target);
            headers(target.version);
            response.status(resource[3]);
            return designContractRegistry.validateById(resource[2], body);
          }
          if (method === "acceptBinding") {
            if (!target) return reject("HTTP_PROJECTION_UNAVAILABLE", 503);
            const [row] = (await manager.query(
              "SELECT semantic_body,content_hash FROM binding_functional_acceptances WHERE workspace_id=$1 AND project_id=$2 AND acceptance_id=$3",
              [workspaceId, projectId, target.id],
            )) as { semantic_body: Document; content_hash: string }[];
            if (
              !row ||
              row.content_hash !== target.contentHash ||
              !validHash(row.semantic_body as { contentHash: string })
            )
              return reject("HTTP_PROJECTION_UNAVAILABLE", 503);
            const [audit] = (await manager.query(
              "SELECT attributes FROM audit_events WHERE workspace_id=$1 AND project_id=$2 AND action='BINDING_FUNCTIONAL_ACCEPTANCE_RECORDED' AND attributes->'resultRef'=$3::jsonb ORDER BY occurred_at,id LIMIT 1",
              [workspaceId, projectId, JSON.stringify(target)],
            )) as { attributes: { reason: string } }[];
            if (!audit) return reject("HTTP_PROJECTION_UNAVAILABLE", 503);
            headers(1);
            response.status(201);
            return projection(schema("binding-functional-acceptance", 2), row.semantic_body, {
              schemaVersion: 2,
              actor: actor(row.semantic_body.acceptedBy),
              reason: audit.attributes.reason,
            });
          }
          if (
            [
              "validateBinding",
              "evaluate",
              "applyBindingLifecycleAction",
              "publishQaResource",
            ].includes(method)
          ) {
            if (!target) return reject("HTTP_PROJECTION_UNAVAILABLE", 503);
            const [audit] = (await manager.query(
              "SELECT id,correlation_id FROM audit_events WHERE workspace_id=$1 AND project_id=$2 AND attributes->'resultRef'=$3::jsonb ORDER BY occurred_at,id LIMIT 1",
              [workspaceId, projectId, JSON.stringify(target)],
            )) as { id: string; correlation_id: string }[];
            if (!audit) return reject("HTTP_PROJECTION_UNAVAILABLE", 503);
            const pending = result.probeRequestRef ? exact(result.probeRequestRef) : undefined;
            response.status(
              method === "publishQaResource"
                ? 201
                : method === "applyBindingLifecycleAction"
                  ? 200
                  : 202,
            );
            if (Number.isSafeInteger(result.resourceVersion ?? result.version))
              headers(Number(result.resourceVersion ?? result.version));
            return {
              commandId: pending?.id ?? audit.id,
              state: pending
                ? "ACCEPTED"
                : ["BLOCKED_INPUT", "INVALID"].includes(String(result.outcome))
                  ? "REJECTED"
                  : "COMPLETED",
              resultRef: target,
              correlationId: audit.correlation_id,
            };
          }
          // Existing candidate/approval helper routes keep their explicit resource shape.
          return value;
        });
        validatePublishedResponse(method, response.statusCode, projected);
        return projected;
      }),
    );
  }
}
