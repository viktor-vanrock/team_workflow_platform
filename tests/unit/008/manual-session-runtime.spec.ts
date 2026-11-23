import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PublishedQaSessionRuntime,
  type QaSessionRuntimeAuthority,
} from "../../../packages/runtime-composition/src/pilot/manual-session-runtime.ts";

const ref = (id: string) => ({ id, version: 1, contentHash: `sha256:${"a".repeat(64)}` as const });
const pins = {
  workspaceId: "workspace",
  projectId: "project",
  bindingRef: ref("binding"),
  profileRef: ref("profile"),
  connectionRef: ref("connection"),
};
const actor = {
  kind: "HUMAN" as const,
  principalId: "human",
  issuer: "issuer",
  subject: "subject",
};
const authority = (
  authorize: QaSessionRuntimeAuthority["authorize"],
): QaSessionRuntimeAuthority => ({
  workspaceId: pins.workspaceId,
  projectId: pins.projectId,
  actor,
  authorize,
});

describe("008 manual session runtime configuration", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("denies before configuration SQL when current authorization or scope is invalid", async () => {
    let queries = 0;
    const source = {
      query: async <T>(): Promise<T> => {
        queries++;
        throw new Error("SQL_MUST_NOT_RUN");
      },
    };
    const runtime = new PublishedQaSessionRuntime([pins], { assertEffectsAllowed: async () => {} });
    await expect(
      runtime.profiles(
        source,
        authority(async () => {
          throw new Error("REVOKED");
        }),
        pins.bindingRef,
        "qa.session.plan",
      ),
    ).rejects.toThrow("QA_SESSION_CONFIGURATION_DENIED");
    await expect(
      runtime.profiles(
        source,
        {
          ...authority(async () => ({ actor, basis: {} as never, scope: pins })),
          projectId: "foreign",
        },
        pins.bindingRef,
        "qa.session.plan",
      ),
    ).rejects.toThrow("QA_SESSION_CONFIGURATION_DENIED");
    expect(queries).toBe(0);
  });
  it("requires current queue permission and effect admission even when the local queue flag is false", async () => {
    vi.stubEnv("AWP_QUEUE_STATIC_CONTOUR", "false");
    let queries = 0;
    let effects = 0;
    const permissions: string[] = [];
    const runtime = new PublishedQaSessionRuntime([pins], {
      assertEffectsAllowed: async () => {
        effects++;
      },
    });
    const manager = {
      query: async () => {
        queries++;
        return [];
      },
    };
    const hook = runtime.admission(manager as never, {
      ...authority(async (permission) => {
        permissions.push(permission);
        throw new Error("CURRENT_CORE_DENY");
      }),
      correlationId: "correlation",
      causationId: "cause",
    });
    const previous = { workspaceId: pins.workspaceId, projectId: pins.projectId, id: "session" };
    await expect(hook.admit(previous as never, previous as never)).rejects.toThrow(
      "QA_SESSION_CONFIGURATION_DENIED",
    );
    expect(permissions).toEqual(["queue.work-admit"]);
    expect(queries).toBe(0);
    expect(effects).toBe(0);
  });
});
