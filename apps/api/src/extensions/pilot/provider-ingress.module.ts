import type { IncomingHttpHeaders } from "node:http";

import {
  Controller,
  type DynamicModule,
  HttpException,
  Inject,
  Module,
  Post,
  Req,
  Res,
} from "@nestjs/common";

import {
  bindIngressTlsPeer,
  type ProviderIngressRequest,
  type ProviderIngressRuntime,
  type TrustedIngressEnvelope,
} from "@awp/runtime-composition";

type IngressHttpRequest = Readonly<{
  path: string;
  method: string;
  rawBody?: Buffer;
  rawHeaders: readonly string[];
  headers: IncomingHttpHeaders;
  socket: unknown;
}>;
type IngressHttpResponse = Readonly<{ setHeader(name: string, value: string): void }>;

const INGRESS_ROUTES = Symbol("PILOT_INGRESS_ROUTES");
type Routes = Readonly<{
  mode: "GATEWAY" | "RECEIVER";
  values: ReadonlyMap<string, ProviderIngressRuntime>;
}>;
@Controller("api/v1/pilot/ingress")
export class ProviderIngressController {
  constructor(@Inject(INGRESS_ROUTES) private readonly routes: Routes) {}
  @Post(":routeId")
  async receive(
    @Req() incoming: IngressHttpRequest,
    @Res({ passthrough: true }) response: IngressHttpResponse,
  ) {
    response.setHeader("Cache-Control", "no-store");
    try {
      const runtime = this.routes.values.get(incoming.path);
      if (!runtime || !incoming.rawBody) throw new Error("INGRESS_ROUTE_DENIED");
      const headers: Record<string, string | undefined> = {};
      // rawHeaders retains duplicate security headers hidden by Node's merge.
      const names = new Set<string>();
      for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
        const name = incoming.rawHeaders[index]!.toLowerCase();
        if (names.has(name)) throw new Error("INGRESS_HEADERS_INVALID");
        names.add(name);
      }
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) throw new Error("INGRESS_HEADERS_INVALID");
        headers[name] = value;
      }
      const request: ProviderIngressRequest = {
        route: incoming.path,
        method: incoming.method,
        contentType: headers["content-type"] ?? "",
        rawBody: incoming.rawBody,
        headers,
      };
      bindIngressTlsPeer(request, incoming.socket);
      if (this.routes.mode === "GATEWAY") return await runtime.attest(request);
      const encoded = headers["x-awp-ingress-envelope"];
      let envelope: TrustedIngressEnvelope | undefined;
      if (encoded !== undefined) {
        if (encoded.length > 32768 || !/^[A-Za-z0-9_-]+$/u.test(encoded))
          throw new Error("INGRESS_ENVELOPE_INVALID");
        const bytes = Buffer.from(encoded, "base64url");
        if (bytes.toString("base64url") !== encoded) throw new Error("INGRESS_ENVELOPE_INVALID");
        envelope = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        ) as TrustedIngressEnvelope;
      }
      return await runtime.accept(request, envelope);
    } catch (error) {
      const conflict =
        error instanceof Error &&
        ["INGRESS_DELIVERY_BODY_CONFLICT", "MATTERMOST_INTENT_REPLAY_CONFLICT"].includes(
          error.message,
        );
      throw new HttpException(
        { code: conflict ? "INGRESS_CONFLICT" : "INGRESS_DENIED" },
        conflict ? 409 : 403,
      );
    }
  }
}
/** Exact deployments select routes explicitly. Boot verifies conformance before
 * mounting any handler; a failed binding never falls back to a local adapter. */
@Module({})
export class ProviderIngressModule {
  static async register(
    input: Readonly<{ mode: Routes["mode"]; runtimes: readonly ProviderIngressRuntime[] }>,
  ): Promise<DynamicModule> {
    const values = new Map<string, ProviderIngressRuntime>();
    for (const runtime of input.runtimes) {
      if (values.has(runtime.policy.route)) throw new Error("INGRESS_ROUTE_COLLISION");
      await runtime.initialize();
      values.set(runtime.policy.route, runtime);
    }
    return {
      module: ProviderIngressModule,
      controllers: [ProviderIngressController],
      providers: [
        { provide: INGRESS_ROUTES, useValue: Object.freeze({ mode: input.mode, values }) },
      ],
    };
  }
}
