import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";

interface ResponseLike {
  status(code: number): ResponseLike;
  type(contentType: string): ResponseLike;
  json(body: unknown): void;
}
interface RequestLike {
  url?: string;
  correlationId?: string;
}

function problemTitle(status: number): string {
  if (status === 400) return "Bad Request";
  if (status === 401) return "Unauthorized";
  if (status === 403) return "Forbidden";
  if (status === 404) return "Not Found";
  if (status === 409) return "Conflict";
  if (status === 410) return "Gone";
  if (status === 429) return "Too Many Requests";
  if (status >= 500) return "Internal Server Error";
  return "Request Failed";
}

export function safeProjectProblem(
  _privateReason: string,
  correlationId: string,
): Readonly<{
  type: "urn:awp:problem:project-resource-not-available";
  title: "Not Found";
  status: 404;
  code: "PROJECT_RESOURCE_NOT_AVAILABLE";
  correlationId: string;
}> {
  return Object.freeze({
    type: "urn:awp:problem:project-resource-not-available",
    title: "Not Found",
    status: 404,
    code: "PROJECT_RESOURCE_NOT_AVAILABLE",
    correlationId,
  });
}

export function safeVisiblePage<T>(
  items: readonly T[],
  visibilityHash: string,
  limit: number,
): Readonly<{
  items: readonly T[];
  visibleCount: number;
  nextCursor?: string;
}> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("VISIBLE_PAGE_LIMIT_INVALID");
  const visible = items.slice(0, limit);
  return Object.freeze({
    items: visible,
    visibleCount: visible.length,
    ...(items.length > visible.length
      ? { nextCursor: `scope:${encodeURIComponent(visibilityHash)}:offset:${visible.length}` }
      : {}),
  });
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ResponseLike>();
    const request = host.switchToHttp().getRequest<RequestLike>();
    const privateCode =
      exception instanceof Error
        ? ((exception as Error & { code?: string }).code ?? exception.message)
        : "";
    const hiddenProjectResource = new Set([
      "PROJECT_RESOURCE_NOT_AVAILABLE",
      "PROJECT_SCOPE_DENIED",
      "ARTIFACT_ACCESS_DENIED",
      "ARTIFACT_NOT_FOUND",
      "PROJECT_EVENT_NOT_AUTHORIZED",
    ]).has(privateCode);
    if (hiddenProjectResource) {
      const problem = safeProjectProblem(
        privateCode,
        request.correlationId ?? "correlation-unavailable",
      );
      response.status(problem.status).type("application/problem+json").json(problem);
      return;
    }
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const title = problemTitle(status);
    response
      .status(status)
      .type("application/problem+json")
      .json({
        type: `urn:awp:problem:http-${status}`,
        title,
        status,
        code: `HTTP_${status}`,
        instance: request.url?.split("?", 1)[0],
        correlationId: request.correlationId,
      });
  }
}
