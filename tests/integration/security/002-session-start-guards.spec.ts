import { describe, expect, it } from "vitest";

import {
  assertSessionStartGuards,
  type QaSessionStartGuardInput,
} from "../../../packages/competency-qa/src/application/session-start-guards.ts";

const valid: QaSessionStartGuardInput = {
  confirmedOperationalReady: true,
  environment: { scope: "NON_PROD", currentRevision: 2, snapshotRevision: 2 },
  buildPinned: true,
  testDataOrAccountPinned: true,
  checklistPinned: true,
  bindingCompatible: true,
  profilesCompatible: true,
  readyAgainstCurrentStructure: true,
};
describe("Session start guard matrix", () => {
  it.each([
    [
      "operational READY",
      { confirmedOperationalReady: false },
      "QA_SESSION_OPERATIONAL_READY_REQUIRED",
    ],
    [
      "non-production",
      { environment: { scope: "PRODUCTION", currentRevision: 2, snapshotRevision: 2 } },
      "QA_SESSION_PRODUCTION_FORBIDDEN",
    ],
    [
      "environment revision",
      { environment: { scope: "NON_PROD", currentRevision: 3, snapshotRevision: 2 } },
      "QA_SESSION_ENVIRONMENT_REVISION_STALE",
    ],
    ["build", { buildPinned: false }, "QA_SESSION_BUILD_REQUIRED"],
    ["test data", { testDataOrAccountPinned: false }, "QA_SESSION_TEST_DATA_REQUIRED"],
    ["checklist", { checklistPinned: false }, "QA_SESSION_CHECKLIST_REQUIRED"],
    ["binding", { bindingCompatible: false }, "QA_SESSION_BINDING_INCOMPATIBLE"],
    ["profile", { profilesCompatible: false }, "QA_SESSION_PROFILE_INCOMPATIBLE"],
  ])("rejects invalid %s", (_name, patch, code) =>
    expect(() =>
      assertSessionStartGuards({ ...valid, ...patch } as QaSessionStartGuardInput),
    ).toThrow(code),
  );
});
