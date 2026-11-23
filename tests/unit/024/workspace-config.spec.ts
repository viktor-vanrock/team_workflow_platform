import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, expect, it } from "vitest";

import {
  createWorkspaceInstallationDataSource,
  loadWorkspaceInstallationConfig,
} from "../../../packages/runtime-composition/src/bootstrap/workspace-installation.ts";

const directory = mkdtempSync(join(tmpdir(), "awp-workspace-config-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const template = () =>
  JSON.parse(readFileSync("infra/deploy/workspace.config.example.json", "utf8"));
const load = (config: unknown) => {
  const path = join(directory, "config.json");
  writeFileSync(path, JSON.stringify(config));
  return loadWorkspaceInstallationConfig({ AWP_WORKSPACE_CONFIG_PATH: path });
};
it("requires corporate mode, an exact callback origin and all project return paths", () => {
  expect(load(template()).tokens.mode).toBe("CORPORATE");
  for (const change of [
    (value: ReturnType<typeof template>) => {
      value.tokens.mode = "LOCAL_FIXTURE";
    },
    (value: ReturnType<typeof template>) => {
      value.network.mode = "LOCAL_FIXTURE";
    },
    (value: ReturnType<typeof template>) => {
      value.session.callbackUrl = "https://attacker.invalid/api/v1/auth/callback";
    },
    (value: ReturnType<typeof template>) => {
      value.session.returnPaths = ["/access"];
    },
  ]) {
    const value = template();
    change(value);
    expect(() => load(value)).toThrow("WORKSPACE_CORPORATE_CONFIGURATION_REQUIRED");
  }
});
it("uses TLS verification and the migration registry without automatic schema changes", () => {
  const path = join(directory, "database.url");
  writeFileSync(path, "postgresql://runtime:fixture@database.invalid:5432/qa\n");
  const source = createWorkspaceInstallationDataSource({ AWP_WORKSPACE_DATABASE_URL_FILE: path });
  expect(source.options).toMatchObject({
    ssl: { rejectUnauthorized: true },
    synchronize: false,
    migrationsRun: false,
    migrationsTransactionMode: "all",
  });
  expect(source.options.migrations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "M0235QaWorkspaceBootstrap1700000000235" }),
    ]),
  );
  expect(() =>
    createWorkspaceInstallationDataSource({
      AWP_WORKSPACE_DATABASE_URL_FILE: path,
      AWP_WORKSPACE_DATABASE_URL: "postgresql://other.invalid/qa",
    }),
  ).toThrow("WORKSPACE_DATABASE_CONFIGURATION_CONFLICT");
});
it("cannot override TLS through the DSN or unsupported TLS modes", () => {
  for (const value of [
    "https://database.invalid/qa",
    "postgresql://database.invalid/qa?sslmode=disable",
    "postgresql://database.invalid/qa#fragment",
  ])
    expect(() =>
      createWorkspaceInstallationDataSource({ AWP_WORKSPACE_DATABASE_URL: value }),
    ).toThrow("WORKSPACE_DATABASE_URL_INVALID");
  expect(() =>
    createWorkspaceInstallationDataSource({
      AWP_WORKSPACE_DATABASE_URL: "postgresql://database.invalid/qa",
      AWP_WORKSPACE_DATABASE_TLS: "prefer",
    }),
  ).toThrow("WORKSPACE_DATABASE_TLS_INVALID");
});
