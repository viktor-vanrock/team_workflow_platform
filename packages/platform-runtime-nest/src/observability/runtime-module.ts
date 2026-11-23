import {
  type CallHandler,
  type DynamicModule,
  type ExecutionContext,
  Injectable,
  Module,
  type NestInterceptor,
  type Type,
} from "@nestjs/common";
import { defer, lastValueFrom } from "rxjs";

import { httpRequestCorrelation } from "../http/correlation.middleware.ts";
import { startTelemetry, type TelemetryRuntime } from "./bootstrap.ts";
import { measured } from "./telemetry.ts";

export const TELEMETRY_RUNTIME = Symbol("TELEMETRY_RUNTIME");
export const DEPLOYMENT_READINESS = Symbol("DEPLOYMENT_READINESS");
export interface DeploymentReadinessRuntime {
  readiness(): Promise<Readonly<{ ready: boolean; reasonCode: string }>>;
  keepAlive(): void;
  stop(): Promise<void>;
}
@Module({})
export class InstrumentedRuntimeModule {
  static compose(
    runtime: Type | DynamicModule,
    telemetry: TelemetryRuntime | undefined,
    deployment?: DeploymentReadinessRuntime,
  ): DynamicModule {
    return {
      module: InstrumentedRuntimeModule,
      imports: [runtime],
      global: true,
      providers: [
        ...(telemetry
          ? [
              { provide: TELEMETRY_RUNTIME, useValue: telemetry },
              {
                provide: "AWP_TELEMETRY_LIFECYCLE",
                useValue: { onApplicationShutdown: () => telemetry.shutdown() },
              },
            ]
          : []),
        ...(deployment
          ? [
              { provide: DEPLOYMENT_READINESS, useValue: deployment },
              {
                provide: "AWP_DEPLOYMENT_LIFECYCLE",
                useValue: {
                  onModuleInit: () => deployment.keepAlive(),
                  onApplicationShutdown: () => deployment.stop(),
                },
              },
            ]
          : []),
      ],
      exports: [
        ...(telemetry ? [TELEMETRY_RUNTIME] : []),
        ...(deployment ? [DEPLOYMENT_READINESS] : []),
      ],
    };
  }
}

/** Non-local startup must receive a policy-bound runtime from corporate composition. */
export async function selectRuntimeTelemetry(
  component: "api" | "worker",
  source: Readonly<Record<string, string | undefined>>,
  corporate?: TelemetryRuntime,
): Promise<TelemetryRuntime | undefined> {
  if (source.AWP_RUNTIME_PROFILE === "non-local") {
    if (!corporate) throw new Error("CORPORATE_TELEMETRY_BINDING_REQUIRED");
    return corporate;
  }
  if (corporate) throw new Error("TELEMETRY_PROFILE_CONFLICT");
  const origin = source.AWP_OTEL_COLLECTOR_ORIGIN;
  if (!origin) return undefined;
  return await startTelemetry(
    {
      mode: "LOCAL_FIXTURE",
      component,
      collectorOrigin: origin,
      deadlineMs: 1000,
      exportIntervalMs: 2000,
      maximumQueueSize: 256,
      maximumBatchSize: 64,
      freshnessMs: 10_000,
    },
    { authorizeExport: async (url) => new URL(url).origin === origin, headers: async () => ({}) },
  );
}

@Injectable()
export class SafeHttpTelemetryInterceptor implements NestInterceptor {
  intercept(execution: ExecutionContext, next: CallHandler) {
    const request = execution
      .switchToHttp()
      .getRequest<{ correlationId?: string; causationId?: string }>();
    // Authenticated application services add authoritative scope in their own spans.
    const correlation = httpRequestCorrelation(request);
    Object.assign(request, correlation);
    execution
      .switchToHttp()
      .getResponse<{ setHeader(name: string, value: string): void }>()
      .setHeader("x-correlation-id", correlation.correlationId);
    return defer(() =>
      measured("http.request", { component: "api", ...correlation }, () =>
        lastValueFrom(next.handle(), { defaultValue: undefined }),
      ),
    );
  }
}
