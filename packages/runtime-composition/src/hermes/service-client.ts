import {
  type HermesContextRequest,
  type HermesContextResponse,
  localHermesContext,
  parseHermesContextRequest,
  parseHermesContextResponse,
} from "./project-context.ts";
import { hermesServiceToken } from "./service-config.ts";
import {
  type HermesDialoguePort,
  hermesResponseLimit,
  localHermesProposal,
  parseHermesProposal,
  parseHermesRequest,
} from "./service-contract.ts";

export async function readHermesJson(response: Response): Promise<unknown> {
  if (
    !response.ok ||
    !response.headers.get("content-type")?.toLowerCase().startsWith("application/json") ||
    Number(response.headers.get("content-length")) > hermesResponseLimit ||
    !response.body
  )
    throw new Error("HERMES_RESPONSE_INVALID");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > hermesResponseLimit) throw new Error("HERMES_RESPONSE_INVALID");
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export function createHermesDialogueClient(
  env = process.env,
  required = false,
): HermesDialoguePort {
  const value = env.AWP_HERMES_URL;
  if (!value) {
    if (required || env.AWP_HERMES_TOKEN_PATH || env.AWP_HERMES_LOCAL_TOKEN)
      throw new Error("HERMES_SERVICE_URL_REQUIRED");
    return {
      advance: async (input) => localHermesProposal(parseHermesRequest(input)),
      ready: async () => true,
    };
  }
  let origin: string, token: string;
  try {
    const url = new URL(value);
    if (
      url.origin !== value ||
      url.username ||
      url.password ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["hermes", "127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
        ))
    )
      throw new Error();
    origin = url.origin;
    token = hermesServiceToken(env);
  } catch {
    throw new Error("HERMES_CLIENT_CONFIGURATION_INVALID");
  }
  return {
    async advance(supplied) {
      const input = parseHermesRequest(supplied),
        fallback = localHermesProposal(input, "SERVICE_UNAVAILABLE");
      try {
        const response = await fetch(`${origin}/v1/project-dialogue`, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(3000),
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(input),
        });
        return parseHermesProposal(await readHermesJson(response), input);
      } catch {
        return fallback;
      }
    },
    async ready() {
      try {
        const response = await fetch(`${origin}/health/ready`, {
          headers: { authorization: `Bearer ${token}` },
          redirect: "error",
          signal: AbortSignal.timeout(1000),
        });
        const body = (await readHermesJson(response)) as {
          ready?: unknown;
          service?: unknown;
          version?: unknown;
        };
        return body.ready === true && body.service === "hermes" && body.version === 1;
      } catch {
        return false;
      }
    },
  };
}

export interface HermesContextPort {
  respond(input: HermesContextRequest): Promise<HermesContextResponse>;
}
export function createHermesContextClient(env = process.env): HermesContextPort {
  // Reuse startup validation, including the narrow internal-origin and token policy.
  createHermesDialogueClient(env, true);
  const origin = env.AWP_HERMES_URL!,
    token = hermesServiceToken(env);
  return {
    async respond(supplied) {
      const input = parseHermesContextRequest(supplied);
      try {
        const response = await fetch(`${origin}/v1/project-context`, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(3000),
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(input),
        });
        return parseHermesContextResponse(await readHermesJson(response), input);
      } catch {
        return localHermesContext(input, true);
      }
    },
  };
}
