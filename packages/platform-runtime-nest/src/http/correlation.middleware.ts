import { randomUUID } from "node:crypto";

import { Injectable, type NestMiddleware } from "@nestjs/common";

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  correlationId?: string;
  causationId?: string;
}
interface ResponseLike {
  setHeader(name: string, value: string): void;
}
const accepted = (value: string | string[] | undefined): string => {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && /^[0-9a-f-]{16,64}$/iu.test(candidate) ? candidate : randomUUID();
};
const correlations = new WeakMap<
  object,
  Readonly<{ correlationId: string; causationId: string }>
>();
/** Server-held, normalized identifiers for telemetry/audit only; never request authority. */
export function httpRequestCorrelation(
  request: object,
): Readonly<{ correlationId: string; causationId: string }> {
  let value = correlations.get(request);
  if (!value) {
    const headers = (request as Partial<RequestLike>).headers ?? {};
    value = Object.freeze({
      correlationId: accepted(headers["x-correlation-id"]),
      causationId: accepted(headers["x-causation-id"]),
    });
    correlations.set(request, value);
  }
  return value;
}

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(request: RequestLike, response: ResponseLike, next: () => void): void {
    Object.assign(request, httpRequestCorrelation(request));
    response.setHeader("x-correlation-id", request.correlationId!);
    response.setHeader("x-causation-id", request.causationId!);
    next();
  }
}
