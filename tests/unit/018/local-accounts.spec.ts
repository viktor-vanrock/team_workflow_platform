import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalPersonaSessionService } from "../../../apps/api/src/local/local-persona.controller.ts";
import { FakeOidcService } from "../../../apps/fake-idp/src/oidc.controller.ts";
import { localPersonaCatalog } from "../../../packages/runtime-composition/src/security/local-security.ts";

afterEach(() => vi.unstubAllEnvs());

describe("018 local account boundaries", () => {
  it("offers nine working humans and separately retains the service principal", () => {
    const options = localPersonaCatalog.publicOptions();
    expect(options).toHaveLength(9);
    expect(options.every(({ key }) => localPersonaCatalog.resolve(key).kind === "HUMAN")).toBe(
      true,
    );
    expect(options.filter(({ key }) => key.startsWith("executor."))).toHaveLength(2);
    expect(options.find(({ key }) => key === "viewer.beta")?.label).toBe("Читатель");
    expect(localPersonaCatalog.seedOptions()).toHaveLength(10);
    expect(localPersonaCatalog.resolve("worker.local").kind).toBe("SERVICE");
    const idp = new FakeOidcService();
    for (const { key } of localPersonaCatalog.seedOptions())
      expect(idp.issue(key).access_token.split(".")).toHaveLength(3);
  });

  it.each(["limited.alpha", "outsider.delta", "auditor.local"])(
    "rejects retired %s in the catalog and both token flows",
    (key) => {
      vi.stubEnv("AWP_RUNTIME_PROFILE", "local");
      expect(() => localPersonaCatalog.resolve(key)).toThrow("LOCAL_PERSONA_UNKNOWN");
      const idp = new FakeOidcService();
      expect(() => idp.issue(key)).toThrow("FAKE_IDP_SUBJECT_UNKNOWN");
      expect(() => idp.issueDevelopmentStepUp(key)).toThrow("FAKE_IDP_SUBJECT_UNKNOWN");
    },
  );

  it.each(["limited.alpha", "outsider.delta", "worker.local", "auditor.local"])(
    "rejects human session entry for %s before touching storage or issuing tokens",
    async (key) => {
      vi.stubEnv("AWP_RUNTIME_PROFILE", "local");
      const transaction = vi.fn(),
        issue = vi.fn(),
        stepUp = vi.fn();
      const service = new LocalPersonaSessionService(
        { transaction } as never,
        { issue, stepUp } as never,
      );
      for (const action of [
        () => service.exchange(key),
        () => service.stepUp(key),
        () => service.selectProject(key, "project"),
      ]) {
        await expect(action()).rejects.toMatchObject({
          status: 403,
          message: "LOCAL_PERSONA_NOT_AVAILABLE",
        });
      }
      expect(transaction).not.toHaveBeenCalled();
      expect(issue).not.toHaveBeenCalled();
      expect(stepUp).not.toHaveBeenCalled();
    },
  );
});
