import { afterEach, expect, it, vi } from "vitest";

import { runSuperadminLocalSeed } from "../../../packages/runtime-composition/src/seed/superadmin-local-seed.ts";

afterEach(() => vi.unstubAllEnvs());

it("provisions the pilot superadministrator's platform role without restoring revoked assignments", async () => {
  vi.stubEnv("AWP_RUNTIME_PROFILE", "local");
  vi.stubEnv("AWP_PILOT_ADAPTER_MODE", "development");
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("SELECT id FROM identities")) return [{ id: "principal" }];
    return [];
  });
  const source = {
    transaction: async (work: (manager: { query: typeof query }) => Promise<void>) =>
      work({ query }),
  };
  await runSuperadminLocalSeed(source as never, "https://fake-idp:4443/oidc");
  const grant = query.mock.calls.find(([sql]) =>
    sql.includes("INSERT INTO platform_role_assignments"),
  );
  expect(grant?.[0]).toContain("'access-administrator','LOCAL_BOOTSTRAP'");
  expect(grant?.[0]).toContain("ON CONFLICT(principal_id,role_key) DO NOTHING");
});
