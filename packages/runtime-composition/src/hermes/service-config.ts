import { readFileSync } from "node:fs";

import { type OutboundNetworkPolicy, PinnedNetworkTransport } from "../pilot/network-policy.ts";
import {
  createChatCompletionsModel,
  createHermesJsonModel,
  type HermesJsonModel,
  type ProjectModel,
} from "./project-model.ts";
import { hermesObject } from "./service-contract.ts";

export function readHermesSecret(path: string): string {
  const bytes = readFileSync(path);
  try {
    const value = bytes.toString("utf8").trim();
    if (bytes.length > 4096 || !/^[\x21-\x7e]{32,4096}$/u.test(value))
      throw new Error("HERMES_SECRET_INVALID");
    return value;
  } finally {
    bytes.fill(0);
  }
}
export function hermesServiceToken(env = process.env): string {
  try {
    if (env.AWP_HERMES_TOKEN_PATH) return readHermesSecret(env.AWP_HERMES_TOKEN_PATH);
    if (
      env.AWP_ENVIRONMENT === "LOCAL" &&
      /^[\x21-\x7e]{32,4096}$/u.test(env.AWP_HERMES_LOCAL_TOKEN ?? "")
    )
      return env.AWP_HERMES_LOCAL_TOKEN!;
    throw new Error();
  } catch {
    throw new Error("HERMES_SERVICE_TOKEN_REQUIRED");
  }
}
export interface HermesServiceConfig {
  token: string;
  port: number;
  mode: "deterministic" | "openai-compatible";
  model?: ProjectModel;
  jsonModel?: HermesJsonModel;
  ready: () => boolean;
}
export function loadHermesServiceConfig(env = process.env): HermesServiceConfig {
  try {
    const token = hermesServiceToken(env),
      port = Number(env.PORT ?? 3020);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error();
    const config = hermesObject(
      env.AWP_HERMES_CONFIG_PATH
        ? JSON.parse(readFileSync(env.AWP_HERMES_CONFIG_PATH, "utf8"))
        : { mode: "deterministic" },
      ["mode", "endpoint", "model", "tokenFile", "caFile", "network"],
    );
    if (config.mode === "deterministic") {
      if (Object.keys(config).length !== 1) throw new Error();
      return { token, port, mode: "deterministic", ready: () => true };
    }
    if (
      config.mode !== "openai-compatible" ||
      typeof config.endpoint !== "string" ||
      typeof config.model !== "string" ||
      !/^[a-zA-Z0-9._:/-]{1,160}$/u.test(config.model) ||
      /REPLACE|CHANGE|EXAMPLE/iu.test(config.model) ||
      typeof config.tokenFile !== "string"
    )
      throw new Error();
    const endpoint = new URL(config.endpoint);
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    )
      throw new Error();
    const network = config.network as OutboundNetworkPolicy;
    if (
      !network ||
      network.mode !== "CORPORATE" ||
      network.deadlineMs > 2000 ||
      network.maximumRequestBytes > 16_384 ||
      network.maximumResponseBytes > 32_768 ||
      network.endpoints.length !== 1
    )
      throw new Error();
    const allowed = network.endpoints[0]!;
    if (allowed.origin !== endpoint.origin || allowed.routes.length !== 1) throw new Error();
    const route = allowed.routes[0]!;
    if (
      route.path !== endpoint.pathname ||
      route.match !== "EXACT" ||
      route.methods.length !== 1 ||
      route.methods[0] !== "POST" ||
      route.queryKeys.length
    )
      throw new Error();
    new PinnedNetworkTransport(network);
    const ca =
      config.caFile === undefined ? undefined : readFileSync(String(config.caFile), "utf8");
    const options = {
      endpoint: config.endpoint,
      model: config.model,
      token: readHermesSecret(config.tokenFile),
      network,
      ...(ca ? { ca } : {}),
    };
    const model = createChatCompletionsModel(options),
      jsonModel = createHermesJsonModel(options);
    return {
      token,
      port,
      mode: "openai-compatible",
      model,
      jsonModel,
      ready: () => Date.now() < Date.parse(network.validUntil),
    };
  } catch {
    throw new Error("HERMES_CONFIGURATION_INVALID");
  }
}
