import { describe, expect, it, vi } from "vitest";

import { normalizeOperationalRequestCreateResult } from "../../../packages/connector-mock/src/index.ts";
import type { OperationalWorkItemTarget } from "../../../packages/connector-sdk/src/index.ts";

const target: OperationalWorkItemTarget = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  entityKind: "REQUEST",
  authorityScopeKey: "qa.alpha",
  naturalKey: "security-draft-1",
};
const profileRef = { id: "33333333-3333-4333-8333-333333333333", version: 1 };
const result = {
  operation: "request.create" as const,
  entityKind: "REQUEST" as const,
  externalEntityId: "REQ-1",
  externalDisplayKey: "REQ-1",
  externalVersion: "1",
  rawExternalState: "MOCK_NEW",
  normalizedStatus: "NEW" as const,
  naturalKey: "security-draft-1",
  effectId: "effect:scope:1",
  observedAt: "2026-08-30T10:00:00.000Z",
  scope: { workspaceId: target.workspaceId, projectId: target.projectId },
  profileRef,
};

describe.each([
  [
    "Workspace",
    { ...result, scope: { ...result.scope, workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } },
    "RESULT_SCOPE_MISMATCH",
  ],
  [
    "Project",
    { ...result, scope: { ...result.scope, projectId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } },
    "RESULT_SCOPE_MISMATCH",
  ],
  [
    "Profile",
    { ...result, profileRef: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", version: 1 } },
    "RESULT_PROFILE_MISMATCH",
  ],
] as const)("wrong %s result", (_field, candidate, code) => {
  it("is rejected before the local confirmation UoW", async () => {
    const confirmationUnitOfWork = vi.fn();
    expect(() =>
      normalizeOperationalRequestCreateResult(target, profileRef, "effect:scope:1", candidate),
    ).toThrow(code);
    expect(confirmationUnitOfWork).not.toHaveBeenCalled();
  });
});
