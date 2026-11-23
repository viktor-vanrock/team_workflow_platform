import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type Feature007GovernanceManifest,
  verifyFeature007GovernanceBinding,
} from "../../../tools/verification/feature-007-governance.mts";

const constitution = `**Версия:** 2.0.0
Jira является первым и каноническим источником operational state.
Доступ вычисляется как пересечение Workspace membership ∩ Project Entitlement ∩ Role permission ∩ Data Classification; default — deny.
Hermes/модель не инициирует, не утверждает и не исполняет критические действия.
QA Verdict создаётся только человеком.
Evidence обязан быть immutable и содержать exact TargetSnapshot.
Первый релиз не выполняет production actions.
`;
const specification = `
Авторизация MUST вычисляться как пересечение membership, entitlement, role permission и data classification.
Поиск, очередь, прямой URL, API и экспорт применяют одну и ту же политику.
Jira operational authority остаётся внешним каноническим источником.
Publish/retire/resume требуют exact one-time Workspace Owner approval, отличного от инициатора.
Каждая завершённая сессия формирует signed evidence manifest; QA Verdict остаётся HUMAN.
Credentials и токены не хранятся. PLATFORM_PROD запрещён.
`;
const plan = `
Platform Core owns Project identity, entitlements, bindings, exact actions, audit and artifact access.
QA Competency Pack owns environments, test resources, capability requirements and evidence semantics.
Connectors own provider protocol only. Hermes cannot initiate, approve or consume administrative actions.
Authorization filters before lookup, count, aggregation, cursor or cache computation.
qa-jira-gitlab-mattermost-local is the accepted L0 contour; external egress and production effects are denied.
Missing corporate inputs produce BLOCKED_INPUT and SKIPPED_GATED; Feature 008 owns corporate runtime wiring.
Evidence Manifest v2 is immutable, contains human attestation and is sealed by detached JWS.
`;

function fixture(): string {
  return mkdtempSync(resolve(tmpdir(), "awp-007-governance-"));
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function write(root: string, path: string, value: string): void {
  const target = resolve(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value, "utf8");
}

function populate(
  root: string,
  values: { constitution: string; specification: string; plan: string } = {
    constitution,
    specification,
    plan,
  },
): Feature007GovernanceManifest {
  const manifest: Feature007GovernanceManifest = {
    schemaVersion: 1,
    constitution: {
      path: ".specify/memory/constitution.md",
      sha256: digest(values.constitution),
      version: "2.0.0",
    },
    specification: { path: "specs/007/spec.md", sha256: digest(values.specification) },
    plan: { path: "specs/007/plan.md", sha256: digest(values.plan) },
    acceptedContour: "qa-jira-gitlab-mattermost-local",
    production: "DENIED",
    corporateRuntimeOwner: "FEATURE_008",
  };
  write(root, manifest.constitution.path, values.constitution);
  write(root, manifest.specification.path, values.specification);
  write(root, manifest.plan.path, values.plan);
  return manifest;
}

describe("Feature 007 Constitution and deployment governance", () => {
  it("accepts exact ownership, Jira authority, scoped authorization, human evidence decisions and local-only execution", () => {
    const root = fixture();
    const result = verifyFeature007GovernanceBinding(root, populate(root));

    expect(result.status).toBe("PASS");
    expect(result.checks.map(({ code }) => code)).toEqual([
      "CONSTITUTION_2_0_ACCEPTED",
      "OWNERSHIP_BOUNDARIES_ACCEPTED",
      "JIRA_OPERATIONAL_AUTHORITY_ACCEPTED",
      "PROJECT_SCOPE_BEFORE_AGGREGATION_ACCEPTED",
      "EXACT_APPROVAL_HUMAN_EVIDENCE_ACCEPTED",
      "SECRET_STORAGE_BOUNDARY_ACCEPTED",
      "LOCAL_INPUT_PRODUCTION_BOUNDARY_ACCEPTED",
    ]);
  });

  it("rejects a non-2.0 Constitution or digest drift", () => {
    const root = fixture();
    const original = populate(root);
    const manifest: Feature007GovernanceManifest = {
      ...original,
      constitution: { ...original.constitution, version: "1.1.1" },
    };

    expect(verifyFeature007GovernanceBinding(root, manifest).checks[0]).toMatchObject({
      status: "FAIL",
      code: "CONSTITUTION_2_0_INVALID",
    });
  });

  it("rejects QA semantics in Core, Project authority in Connectors or administrative authority in Hermes", () => {
    const root = fixture();
    const invalidPlan = `${plan}\nCore owns QA environment semantics. Connectors mutate Project lifecycle. Hermes approves administrative actions.`;

    expect(
      verifyFeature007GovernanceBinding(
        root,
        populate(root, { constitution, specification, plan: invalidPlan }),
      ).checks[1],
    ).toMatchObject({ status: "FAIL", code: "OWNERSHIP_BOUNDARIES_INVALID" });
  });

  it("rejects local Project state as a replacement Jira authority", () => {
    const root = fixture();
    const invalidSpecification = specification.replace(
      "Jira operational authority остаётся внешним каноническим источником.",
      "Platform Project state replaces Jira operational authority.",
    );

    expect(
      verifyFeature007GovernanceBinding(
        root,
        populate(root, { constitution, specification: invalidSpecification, plan }),
      ).checks[2],
    ).toMatchObject({ status: "FAIL", code: "JIRA_OPERATIONAL_AUTHORITY_INVALID" });
  });

  it("rejects lookup or aggregation before Project authorization", () => {
    const root = fixture();
    const invalidPlan = plan.replace(
      "Authorization filters before lookup, count, aggregation, cursor or cache computation.",
      "Authorization filters after aggregation.",
    );

    expect(
      verifyFeature007GovernanceBinding(
        root,
        populate(root, { constitution, specification, plan: invalidPlan }),
      ).checks[3],
    ).toMatchObject({ status: "FAIL", code: "PROJECT_SCOPE_BEFORE_AGGREGATION_INVALID" });
  });

  it("rejects self-approved administration, Hermes consumption or automated QA Verdict authority", () => {
    const root = fixture();
    const invalidSpecification = `${specification}\nInitiator may self-approve publish. Hermes consumes resume. Model creates QA Verdict.`;

    expect(
      verifyFeature007GovernanceBinding(
        root,
        populate(root, { constitution, specification: invalidSpecification, plan }),
      ).checks[4],
    ).toMatchObject({ status: "FAIL", code: "EXACT_APPROVAL_HUMAN_EVIDENCE_INVALID" });
  });

  it("rejects credential persistence in Binding, Session, evidence or logs", () => {
    const root = fixture();
    const invalidSpecification = specification.replace(
      "Credentials и токены не хранятся.",
      "Credentials are stored in ProjectBinding and evidence logs.",
    );

    expect(
      verifyFeature007GovernanceBinding(
        root,
        populate(root, { constitution, specification: invalidSpecification, plan }),
      ).checks[5],
    ).toMatchObject({ status: "FAIL", code: "SECRET_STORAGE_BOUNDARY_INVALID" });
  });

  it("rejects production/live contours and guessed corporate inputs", () => {
    const root = fixture();
    const original = populate(root, {
      constitution,
      specification,
      plan: "production contour; external egress allowed; missing corporate values use local defaults",
    });
    const manifest: Feature007GovernanceManifest = {
      ...original,
      acceptedContour: "qa-jira-gitlab-mattermost-production",
      production: "ALLOWED",
      corporateRuntimeOwner: "FEATURE_007",
    };

    expect(verifyFeature007GovernanceBinding(root, manifest).checks[6]).toMatchObject({
      status: "FAIL",
      code: "LOCAL_INPUT_PRODUCTION_BOUNDARY_INVALID",
    });
  });
});
