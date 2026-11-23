import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { type AgentOptions, request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { checkServerIdentity, type ConnectionOptions } from "node:tls";

import {
  assertExactRevisionRef,
  type ExactRevisionRef,
  freezePilotValue,
} from "@awp/platform-core";

export interface OutboundNetworkPolicy {
  readonly ref: ExactRevisionRef;
  readonly mode: "CORPORATE" | "LOCAL_FIXTURE";
  readonly validUntil: string;
  readonly deadlineMs: number;
  readonly maximumRequestBytes: number;
  readonly maximumResponseBytes: number;
  readonly endpoints: readonly Readonly<{
    origin: string;
    addressRanges: readonly string[];
    routes: readonly Readonly<{
      path: string;
      match: "EXACT" | "PREFIX";
      methods: readonly string[];
      queryKeys: readonly string[];
    }>[];
  }>[];
}
export interface NetworkTransportOptions {
  readonly resolve?: (hostname: string, signal: AbortSignal) => Promise<readonly string[]>;
  readonly tls?: Pick<ConnectionOptions, "ca" | "cert" | "key" | "passphrase">;
}
type Endpoint = OutboundNetworkPolicy["endpoints"][number];
const failure = () => new Error("NETWORK_REQUEST_DENIED");
const hostname = (url: URL) => url.hostname.replace(/^\[|\]$/gu, "");
const family = (address: string) => (isIP(address) === 4 ? "ipv4" : "ipv6");
const matches = (list: BlockList, address: string) =>
  Boolean(isIP(address)) && !address.includes("%") && list.check(address, family(address));
function ranges(values: readonly string[]): BlockList {
  const list = new BlockList();
  if (!values.length || values.length > 64) throw failure();
  for (const value of values) {
    const [address, prefix, extra] = value.split("/");
    const version = isIP(address!);
    if (
      !version ||
      address!.includes("%") ||
      extra !== undefined ||
      prefix === undefined ||
      !/^(0|[1-9][0-9]*)$/u.test(prefix) ||
      Number(prefix) > (version === 4 ? 32 : 128)
    )
      throw failure();
    list.addSubnet(address!, Number(prefix), version === 4 ? "ipv4" : "ipv6");
  }
  return list;
}
const protectedAddresses = ranges([
  "0.0.0.0/8",
  "169.254.0.0/16",
  "168.63.129.16/32",
  "100.100.100.200/32",
  "224.0.0.0/4",
  "240.0.0.0/4",
  "::/128",
  "fe80::/10",
  "ff00::/8",
  "fd00:ec2::254/128",
  "64:ff9b::/96",
  "64:ff9b:1::/48",
  "2002::/16",
  "2001::/32",
]);
const loopback = ranges(["127.0.0.0/8", "::1/128"]);
const methods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw failure();
  let interrupt!: () => void;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        interrupt = () => reject(failure());
        signal.addEventListener("abort", interrupt, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", interrupt);
  }
}

/** Connects to an approved IP directly while retaining the exact HTTP Host/TLS identity. */
export class PinnedNetworkTransport {
  readonly policy: OutboundNetworkPolicy;
  readonly #ranges = new Map<string, BlockList>();
  readonly #expiresAt: number;
  readonly #options: NetworkTransportOptions;
  constructor(policy: OutboundNetworkPolicy, options: NetworkTransportOptions = {}) {
    try {
      assertExactRevisionRef(policy.ref);
      this.#expiresAt = Date.parse(policy.validUntil);
      if (
        !Number.isFinite(this.#expiresAt) ||
        this.#expiresAt <= Date.now() ||
        !["CORPORATE", "LOCAL_FIXTURE"].includes(policy.mode) ||
        !Number.isInteger(policy.deadlineMs) ||
        policy.deadlineMs < 1 ||
        policy.deadlineMs > 30_000 ||
        !Number.isInteger(policy.maximumRequestBytes) ||
        policy.maximumRequestBytes < 1 ||
        policy.maximumRequestBytes > 20_000_000 ||
        !Number.isInteger(policy.maximumResponseBytes) ||
        policy.maximumResponseBytes < 1 ||
        policy.maximumResponseBytes > 20_000_000 ||
        !policy.endpoints.length ||
        policy.endpoints.length > 64
      )
        throw failure();
      for (const endpoint of policy.endpoints) {
        const url = new URL(endpoint.origin);
        if (
          url.origin !== endpoint.origin ||
          url.username ||
          url.password ||
          (policy.mode === "CORPORATE"
            ? url.protocol !== "https:"
            : !["http:", "https:"].includes(url.protocol)) ||
          this.#ranges.has(endpoint.origin) ||
          !endpoint.routes.length ||
          endpoint.routes.length > 128
        )
          throw failure();
        this.#ranges.set(endpoint.origin, ranges(endpoint.addressRanges));
        for (const route of endpoint.routes) {
          if (
            !/^\/[a-zA-Z0-9/_~.-]*$/u.test(route.path) ||
            route.path.includes("..") ||
            route.path.includes("//") ||
            !["EXACT", "PREFIX"].includes(route.match) ||
            (route.match === "PREFIX" && !route.path.endsWith("/")) ||
            !route.methods.length ||
            route.methods.some((method) => !methods.has(method)) ||
            route.queryKeys.length > 64 ||
            route.queryKeys.some((key) => !/^[a-zA-Z0-9_[\].-]{1,64}$/u.test(key))
          )
            throw failure();
        }
      }
      this.policy = freezePilotValue(structuredClone(policy));
      const tls = options.tls
        ? {
            ca: options.tls.ca,
            cert: options.tls.cert,
            key: options.tls.key,
            passphrase: options.tls.passphrase,
          }
        : undefined;
      this.#options = Object.freeze({
        ...(options.resolve ? { resolve: options.resolve } : {}),
        ...(tls ? { tls } : {}),
      });
    } catch {
      throw new Error("NETWORK_POLICY_INVALID");
    }
  }
  private signal(signal?: AbortSignal | null): AbortSignal {
    const remaining = this.#expiresAt - Date.now();
    if (remaining <= 0) throw failure();
    const timeout = AbortSignal.timeout(
      Math.max(1, Math.min(this.policy.deadlineMs, Math.floor(remaining))),
    );
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }
  private route(value: string, method: string): { url: URL; endpoint: Endpoint } {
    if (value.length > 8192 || /[\\\p{Cc} ]/u.test(value) || this.#expiresAt <= Date.now())
      throw failure();
    const url = new URL(value);
    const endpoint = this.policy.endpoints.find((item) => item.origin === url.origin);
    if (!endpoint || url.username || url.password || url.hash || url.pathname.includes("%25"))
      throw failure();
    const path = decodeURIComponent(url.pathname);
    if (
      /[\\\p{Cc}]/u.test(path) ||
      path.split("/").some((segment) => segment === "." || segment === "..")
    )
      throw failure();
    const route = endpoint.routes.find(
      (item) =>
        item.methods.includes(method) &&
        (item.match === "EXACT" ? path === item.path : path.startsWith(item.path)) &&
        [...url.searchParams].every(
          ([key, value]) =>
            item.queryKeys.includes(key) && value.length <= 4096 && !/\p{Cc}/u.test(value),
        ),
    );
    if (!route || [...url.searchParams].length > 64) throw failure();
    return { url, endpoint };
  }
  private async address(url: URL, signal: AbortSignal): Promise<string> {
    const host = hostname(url);
    const answers = isIP(host)
      ? [host]
      : await abortable(
          (
            this.#options.resolve ??
            (async (name) =>
              (await lookup(name, { all: true, verbatim: true })).map((entry) => entry.address))
          )(host, signal),
          signal,
        );
    if (
      signal.aborted ||
      this.#expiresAt <= Date.now() ||
      !answers.length ||
      answers.length > 64 ||
      answers.some(
        (address) =>
          !matches(this.#ranges.get(url.origin)!, address) ||
          matches(protectedAddresses, address) ||
          (this.policy.mode === "CORPORATE"
            ? matches(loopback, address)
            : !matches(loopback, address)),
      )
    )
      throw failure();
    return answers[0]!;
  }
  async authorizeEndpoint(url: string, method: string, caller?: AbortSignal): Promise<boolean> {
    try {
      const value = this.route(url, method);
      await this.address(value.url, this.signal(caller));
      return true;
    } catch {
      return false;
    }
  }
  /** For SDKs using native HTTPS agents; DNS is validated at the actual connect lookup. */
  agentOptionsForOrigin(origin: string): AgentOptions {
    const url = new URL(origin);
    if (url.origin !== origin || url.protocol !== "https:" || !this.#ranges.has(origin))
      throw failure();
    return {
      ...this.#options.tls,
      rejectUnauthorized: true,
      keepAlive: false,
      checkServerIdentity: (_name, certificate) => checkServerIdentity(hostname(url), certificate),
      lookup: (name, options, callback) => {
        if (name !== hostname(url)) {
          callback(failure(), "", 4);
          return;
        }
        try {
          void this.address(url, this.signal()).then(
            (address) => {
              if (options.all) callback(null, [{ address, family: isIP(address) }]);
              else callback(null, address, isIP(address));
            },
            () => callback(failure(), "", 4),
          );
        } catch {
          callback(failure(), "", 4);
        }
      },
    };
  }
  readonly fetch: typeof fetch = async (input, init = {}) => {
    try {
      if (typeof input !== "string" && !(input instanceof URL)) throw failure();
      const method = (init.method ?? "GET").toUpperCase();
      const { url } = this.route(input.toString(), method);
      const signal = this.signal(init.signal);
      const headers = new Headers(init.headers);
      if (
        [
          "host",
          "connection",
          "transfer-encoding",
          "content-length",
          "proxy-authorization",
          "upgrade",
          "te",
        ].some((name) => headers.has(name))
      )
        throw failure();
      let body: Buffer | undefined;
      if (init.body !== undefined && init.body !== null) {
        if (["GET", "HEAD"].includes(method)) throw failure();
        if (typeof init.body === "string" || init.body instanceof URLSearchParams)
          body = Buffer.from(init.body.toString());
        else if (init.body instanceof ArrayBuffer) body = Buffer.from(new Uint8Array(init.body));
        else if (ArrayBuffer.isView(init.body))
          body = Buffer.from(
            new Uint8Array(init.body.buffer, init.body.byteOffset, init.body.byteLength),
          );
        else throw failure();
        if (body.length > this.policy.maximumRequestBytes) {
          body.fill(0);
          throw failure();
        }
      }
      try {
        const address = await this.address(url, signal);
        headers.set("host", url.host);
        headers.set("accept-encoding", "identity");
        return await abortable(
          new Promise<Response>((resolve, reject) => {
            const parts: Buffer[] = [];
            let size = 0;
            let rejected = false;
            const deny = () => {
              rejected = true;
              parts.forEach((part) => {
                part.fill(0);
              });
              reject(failure());
            };
            const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
              {
                protocol: url.protocol,
                hostname: address,
                port: url.port || (url.protocol === "https:" ? 443 : 80),
                path: `${url.pathname}${url.search}`,
                method,
                headers: Object.fromEntries(headers),
                agent: false,
                family: isIP(address),
                signal,
                maxHeaderSize: 16_384,
                ...(url.protocol === "https:"
                  ? {
                      ...this.#options.tls,
                      servername: isIP(hostname(url)) ? "" : hostname(url),
                      rejectUnauthorized: true,
                      checkServerIdentity: (_name, certificate) =>
                        checkServerIdentity(hostname(url), certificate),
                    }
                  : {}),
              },
              (response) => {
                const status = response.statusCode ?? 0;
                if (
                  status < 200 ||
                  status >= 600 ||
                  (status >= 300 && status < 400) ||
                  (response.headers["content-encoding"] &&
                    response.headers["content-encoding"] !== "identity") ||
                  Number(response.headers["content-length"] ?? 0) > this.policy.maximumResponseBytes
                ) {
                  deny();
                  response.destroy();
                  request.destroy(failure());
                  return;
                }
                response.on("data", (part: Buffer) => {
                  size += part.length;
                  if (rejected || size > this.policy.maximumResponseBytes) {
                    part.fill(0);
                    deny();
                    response.destroy();
                    request.destroy(failure());
                  } else parts.push(part);
                });
                response.once("error", deny);
                response.once("aborted", deny);
                response.once("end", () => {
                  try {
                    if (rejected || signal.aborted || this.#expiresAt <= Date.now())
                      throw failure();
                    const responseHeaders = new Headers();
                    for (const [name, value] of Object.entries(response.headers)) {
                      if (Array.isArray(value))
                        value.forEach((entry) => {
                          responseHeaders.append(name, entry);
                        });
                      else if (value !== undefined) responseHeaders.set(name, value);
                    }
                    const bytes = Buffer.concat(parts);
                    try {
                      resolve(
                        new Response(
                          method === "HEAD" || status === 204 || status === 205 ? null : bytes,
                          { status, headers: responseHeaders },
                        ),
                      );
                    } finally {
                      bytes.fill(0);
                    }
                  } catch {
                    reject(failure());
                  } finally {
                    parts.forEach((part) => {
                      part.fill(0);
                    });
                  }
                });
              },
            );
            request.once("error", deny);
            request.end(body);
          }),
          signal,
        );
      } finally {
        body?.fill(0);
      }
    } catch {
      throw failure();
    }
  };
}
