import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from "@nestjs/common";

const publicCodes = new Set([
  "PLATFORM_ACCESS_DENIED",
  "ACCESS_STEP_UP_REQUIRED",
  "CORPORATE_STEP_UP_REQUIRED",
  "CORPORATE_SESSION_DENIED",
  "ACCESS_USER_NOT_FOUND",
  "ACCESS_INPUT_INVALID",
  "ACCESS_QUERY_INVALID",
  "ACCESS_ROLE_INVALID",
  "ACCESS_WORKSPACE_NOT_AVAILABLE",
  "ACCESS_REQUEST_CONFLICT",
  "ACCESS_VERSION_CONFLICT",
]);
export class AccessHttpError extends HttpException {
  constructor(code: string, status: number) {
    super({ code: publicCodes.has(code) ? code : "ACCESS_FAILED" }, status);
  }
}
/** Preserve only this endpoint's public errors through the global safe-error boundary. */
@Catch(AccessHttpError)
export class AccessProblemFilter implements ExceptionFilter {
  catch(error: AccessHttpError, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<{ status(code: number): { json(body: unknown): void } }>()
      .status(error.getStatus())
      .json(error.getResponse());
  }
}
