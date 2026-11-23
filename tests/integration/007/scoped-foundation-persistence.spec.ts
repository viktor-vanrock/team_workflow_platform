import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { InMemoryEvidenceIntegrityRepository } from "../../../packages/competency-qa/src/persistence/evidence-integrity.repository.ts";
import { InMemoryProjectEntitlementRepository } from "../../../packages/platform-persistence-typeorm/src/project-entitlement.repository.ts";
import { InMemoryProjectOnboardingRepository } from "../../../packages/platform-persistence-typeorm/src/project-onboarding.repository.ts";
import {
  exactRef,
  humanActor,
  onboardingFixture,
  projectScope,
  testHash,
} from "../../support/007-onboarding-fixture.ts";

describe("Feature 007 scoped persistence foundation", () => {
  it("declares composite Project foreign keys and uniqueness for published bindings and active account slots", () => {
    const root = resolve(import.meta.dirname, "../../..");
    const core = readFileSync(
      resolve(
        root,
        "packages/platform-persistence-typeorm/src/migrations/core/0155-project-binding-entitlements.ts",
      ),
      "utf8",
    );
    const qa = readFileSync(
      resolve(root, "packages/competency-qa/src/persistence/migrations/2080-project-resources.ts"),
      "utf8",
    );
    expect(core).toMatch(/FOREIGN KEY\(workspace_id,project_id(?:,[^)]+)?\)/u);
    expect(core).toMatch(/project_binding_one_published_idx[\s\S]*WHERE status='PUBLISHED'/u);
    expect(qa).toMatch(/FOREIGN KEY\(workspace_id,project_id(?:,[^)]+)?\)/u);
    expect(qa).toMatch(/qa_test_account_one_active_slot_idx[\s\S]*WHERE state='ACTIVE'/u);
  });

  it("never resolves a Project revision by global ID alone or across scope", async () => {
    const repository = new InMemoryProjectOnboardingRepository();
    const revision = {
      revisionId: "registry-r1",
      version: 1,
      ...projectScope(),
      key: "project-a",
      name: "Project A",
      ownerIds: [onboardingFixture.qaLeadId],
      criticalityKey: "STANDARD",
      dataClassificationKey: "INTERNAL",
      verificationStatus: "CURRENT" as const,
      reason: "register",
      createdBy: humanActor(),
      createdAt: onboardingFixture.now,
      contentHash: testHash("registry-r1"),
    };
    await repository.appendRegistryRevision(revision);
    await expect(repository.registryRevision(projectScope(), "registry-r1", 1)).resolves.toEqual(
      revision,
    );
    await expect(
      repository.registryRevision(projectScope(onboardingFixture.projectB), "registry-r1", 1),
    ).resolves.toBeUndefined();
    expect("registryRevisionById" in repository).toBe(false);
    await expect(
      repository.appendRegistryRevision({ ...revision, contentHash: testHash("mutation") }),
    ).rejects.toThrow("IMMUTABLE");
  });

  it("atomically advances entitlement revisions and rejects scope drift", async () => {
    const repository = new InMemoryProjectEntitlementRepository();
    const first = {
      revisionId: "entitlement-r1",
      entitlementId: "entitlement",
      version: 1,
      ...projectScope(),
      principalId: onboardingFixture.qaEngineerId,
      operation: "GRANT" as const,
      effect: "ALLOW" as const,
      permissions: ["qa.session.read"],
      classificationCeilingKey: "INTERNAL",
      validFrom: onboardingFixture.now,
      actor: humanActor(),
      reason: "starter",
      correlationId: onboardingFixture.correlationId,
      createdAt: onboardingFixture.now,
      contentHash: testHash("entitlement-r1"),
    };
    await repository.append(first);
    await expect(repository.current(projectScope(), "entitlement")).resolves.toEqual(first);
    await expect(
      repository.current(projectScope(onboardingFixture.projectB), "entitlement"),
    ).resolves.toBeUndefined();
    await expect(
      repository.append({
        ...first,
        revisionId: "gap",
        version: 3,
        previousRevisionRef: exactRef("entitlement-r1"),
      }),
    ).rejects.toThrow("VERSION_GAP");
  });

  it("preserves immutable evidence revision chains", async () => {
    const repository = new InMemoryEvidenceIntegrityRepository();
    const first = {
      manifestRevisionId: "manifest-r1",
      manifestId: "manifest",
      version: 1,
      ...projectScope(),
      sessionId: "session",
      workItemId: "work",
      contentHash: testHash("manifest-r1"),
    };
    await repository.appendManifest(first);
    await expect(
      repository.appendManifest({ ...first, contentHash: testHash("changed") }),
    ).rejects.toThrow("IMMUTABLE");
    await expect(
      repository.manifestRevision(projectScope(onboardingFixture.projectB), "manifest", 1),
    ).resolves.toBeUndefined();
  });
});
