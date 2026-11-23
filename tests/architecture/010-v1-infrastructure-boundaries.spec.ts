import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "../..");
const read = async (path: string) => await readFile(resolve(root, path), "utf8");

describe("Feature 010 first-version infrastructure boundary", () => {
  it("contains no Redis/BullMQ dependency or service", async () => {
    const [workspace, lockfile, composeText] = await Promise.all([
      read("pnpm-workspace.yaml"),
      read("pnpm-lock.yaml"),
      read("infra/compose/docker-compose.local.yml"),
    ]);
    const compose = parse(composeText) as { services: Record<string, unknown> };
    expect(`${workspace}\n${lockfile}`).not.toMatch(/bullmq|@nestjs\/bullmq/iu);
    expect(Object.keys(compose.services)).not.toEqual(expect.arrayContaining(["redis"]));
    await expect(access(resolve(root, "packages/platform-queue-bullmq"))).rejects.toThrow();
  });

  it("contains no object-storage implementation or v1 deployment input", async () => {
    const [compose, environment, deployment, artifactPolicy] = await Promise.all([
      read("infra/compose/docker-compose.local.yml"),
      read("packages/runtime-composition/src/config/environment.ts"),
      read("packages/runtime-composition/src/pilot/deployment-config.ts"),
      read("packages/runtime-composition/src/pilot/artifact-source-policy.ts"),
    ]);
    expect(`${compose}\n${environment}`).not.toMatch(/AWP_(?:S3|OBJECT_STORE)/u);
    expect(deployment).toContain('readonly artifactMode: "GITLAB_ONLY"');
    expect(artifactPolicy).not.toMatch(/APPROVED_OBJECT_STORE|OBJECT_STORE|objectStorePolicyRef/u);
    await expect(
      access(
        resolve(root, "packages/runtime-composition/src/storage/s3-compatible-object-storage.ts"),
      ),
    ).rejects.toThrow();
    await expect(
      access(resolve(root, "packages/runtime-composition/src/storage/corporate-object-storage.ts")),
    ).rejects.toThrow();
  });

  it("documents one PostgreSQL and GitLab-only v1 contract", async () => {
    const paths = [
      "README.md",
      "docs/agentic-workspace-platform-master-spec-v2.md",
      "docs/architecture/README.md",
      "docs/deployment/configuration.md",
      "docs/deployment/templates/runtime.env.example",
      "docs/deployment/templates/deployment-passport.md",
      "docs/runbooks/pilot-deployment-checklist.md",
      "docs/runbooks/pilot-development.md",
      "docs/runbooks/pilot-infrastructure.md",
      "docs/runbooks/pilot-integration-intake.md",
      "docs/runbooks/pilot-recovery.md",
    ];
    const documents = (await Promise.all(paths.map(read))).join("\n");
    expect(documents).not.toMatch(
      /AWP_REDIS_URL\s*=|AWP_S3_|APPROVED_OBJECT_STORE|CorporateObjectStorage|platform-queue-bullmq/u,
    );
    expect(documents).toContain("GITLAB_ONLY");
    expect(documents).toContain("PostgreSQL");
  });
});
