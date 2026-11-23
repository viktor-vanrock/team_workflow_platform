import { readFileSync } from "node:fs";

import { hermesObject } from "@awp/runtime-composition";

import { text, uuid } from "../onboarding/durable-http.ts";

export interface HermesMattermostBinding {
  key: string;
  workspaceId: string;
  projectId: string;
  connectionHeaderId: string;
  providerNamespace: string;
  teamId: string;
  channelId: string;
  token: string;
  validUntil: string;
  version: number;
  webOrigin: string;
}
export function loadHermesMattermostBindings(
  env = process.env,
): readonly HermesMattermostBinding[] {
  if (!env.AWP_HERMES_MATTERMOST_CONFIG_PATH) return [];
  try {
    const root = hermesObject(
      JSON.parse(readFileSync(env.AWP_HERMES_MATTERMOST_CONFIG_PATH, "utf8")),
      ["schemaVersion", "bindings"],
    );
    if (
      root.schemaVersion !== 1 ||
      !Array.isArray(root.bindings) ||
      !root.bindings.length ||
      root.bindings.length > 100
    )
      throw new Error();
    const result = root.bindings.map((value: unknown) => {
      const b = hermesObject(value, [
        "key",
        "workspaceId",
        "projectId",
        "connectionHeaderId",
        "providerNamespace",
        "teamId",
        "channelId",
        "tokenFile",
        "validUntil",
        "version",
        "webOrigin",
      ]);
      const token = readFileSync(text(b.tokenFile), "utf8").trim(),
        origin = new URL(text(b.webOrigin));
      if (
        !/^[a-zA-Z0-9_-]{26,256}$/u.test(token) ||
        Date.parse(String(b.validUntil)) <= Date.now() ||
        !Number.isFinite(Date.parse(String(b.validUntil))) ||
        !Number.isSafeInteger(b.version) ||
        Number(b.version) < 1 ||
        origin.origin !== b.webOrigin ||
        (origin.protocol !== "https:" &&
          !(
            env.AWP_ENVIRONMENT === "LOCAL" &&
            origin.protocol === "http:" &&
            ["localhost", "127.0.0.1"].includes(origin.hostname)
          ))
      )
        throw new Error();
      return {
        key: text(b.key, 80),
        workspaceId: uuid(b.workspaceId),
        projectId: uuid(b.projectId),
        connectionHeaderId: uuid(b.connectionHeaderId),
        providerNamespace: text(b.providerNamespace, 100),
        teamId: text(b.teamId, 100),
        channelId: text(b.channelId, 100),
        token,
        validUntil: String(b.validUntil),
        version: Number(b.version),
        webOrigin: origin.origin,
      };
    });
    if (
      new Set(result.map((b) => b.key)).size !== result.length ||
      new Set(result.map((b) => `${b.teamId}:${b.channelId}`)).size !== result.length
    )
      throw new Error();
    return Object.freeze(result);
  } catch {
    throw new Error("HERMES_MATTERMOST_CONFIGURATION_INVALID");
  }
}
