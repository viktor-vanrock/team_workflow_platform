import { describe, expect, it } from "vitest";

import {
  canonicalRoleKey,
  isSystemAdministratorRole,
} from "../../../packages/platform-core/src/access/role-key.ts";
import { assertBindingPublicationDecision } from "../../../packages/platform-core/src/approval/binding-publication-policy.ts";

describe("017 canonical system roles", () => {
  it.each([
    "workspace-owner",
    "integration-admin",
    "integration-administrator",
    "WORKSPACE_OWNER",
    "INTEGRATION_ADMINISTRATOR",
    "system-administrator",
  ])("maps administrative role %s", (role) => {
    expect(canonicalRoleKey(role)).toBe("system-administrator");
    expect(isSystemAdministratorRole(role)).toBe(true);
  });
  it.each(["limited-reader", "viewer", "reader"])("maps read-only role %s", (role) =>
    expect(canonicalRoleKey(role)).toBe("reader"),
  );
  it("retains independent approval and real permission checks after merging roles", () => {
    expect(() =>
      assertBindingPublicationDecision("same", {
        approverId: "same",
        approverRole: "system-administrator",
        permissions: ["project.admin"],
      }),
    ).toThrow("SELF_APPROVAL_FORBIDDEN");
    expect(() =>
      assertBindingPublicationDecision("one", {
        approverId: "two",
        approverRole: "system-administrator",
        permissions: ["project.admin"],
      }),
    ).not.toThrow();
    expect(() =>
      assertBindingPublicationDecision("one", {
        approverId: "two",
        approverRole: "system-administrator",
        permissions: [],
      }),
    ).toThrow("BINDING_PUBLICATION_APPROVER_UNAUTHORIZED");
    expect(isSystemAdministratorRole("qa-executor")).toBe(false);
  });
});
