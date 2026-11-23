import { describe, expect, it } from "vitest";

import {
  createApprovedDefectIntent,
  DefectPublicationApprovalPolicy,
} from "../../packages/competency-qa/src/application/publish-defect-draft.ts";
import {
  assertDefectRouting,
  JiraDefectCreateService,
} from "../../packages/connector-jira/src/operational/defect-create.ts";
import { createDefectMapping } from "../../packages/connector-jira/src/operational/defect-create-mapper.ts";
import { planDefectLinks } from "../../packages/connector-jira/src/operational/defect-links.ts";

describe("003 US4 approved defect E2E", () => {
  it("publishes one defect with recoverable request/evidence links and blocks wrong destination", async () => {
    const intent = createApprovedDefectIntent({
      defectDraftId: "d",
      version: 1,
      findingRef: { id: "f", version: "1", contentHash: "h" },
      sessionRef: { id: "s", version: "1", contentHash: "h" },
      buildRef: { id: "b", version: "1", contentHash: "h" },
      evidenceRefs: [{ id: "a", version: "1", contentHash: "h" }],
      title: "Bug",
      description: "Steps",
    });
    const policy = new DefectPublicationApprovalPolicy();
    const approved = policy.approve(
      policy.request({
        approvalId: "a",
        initiatorId: "i",
        subjectHash: "subject",
        expiresAt: "2026-09-01T00:00:00Z",
      }),
      { actorId: "owner", role: "WORKSPACE_OWNER", now: "2026-08-31T00:00:00Z" },
    );
    expect(policy.consume(approved, "subject").state).toBe("CONSUMED");
    const mapped = createDefectMapping({
      effectId: "e",
      effectMarker: "awp:e",
      target: { projectId: "200", issueTypeId: "bug" },
      payload: intent.payload,
      requiredFields: ["summary", "description"],
      pins: [
        {
          sequence: 0,
          purpose: "PRIMARY",
          logicalRole: "DEFECT_DESTINATION",
          authorityNamespaceHash: "defect",
        },
        {
          sequence: 1,
          purpose: "AUXILIARY",
          logicalRole: "QA_REQUEST_AUTHORITY",
          authorityNamespaceHash: "request",
        },
      ],
    });
    const subEffects = planDefectLinks({
      requestExternalEntityId: "10001",
      sessionRef: "s",
      buildRef: "b",
      evidenceRefs: ["a"],
      sameAuthority: true,
    });
    let creates = 0;
    let id: string | undefined;
    const service = new JiraDefectCreateService({
      lookup: async () =>
        id ? { state: "FOUND", externalEntityId: id } : { state: "PROVEN_ABSENT" },
      create: async () => {
        creates++;
        id = "20001";
        return { externalEntityId: id };
      },
      observe: async (value) => ({
        externalEntityId: value,
        externalDisplayKey: "APP-1",
        externalRevisionToken: "r1",
        authorityFieldsHash: "h",
      }),
      applySubEffect: async (_value, effect) => `receipt:${effect.semanticIdentity}`,
    });
    expect(
      (
        await service.execute({
          effectMarker: mapped.effectMarker,
          fields: mapped.fields,
          subEffects,
        })
      ).status,
    ).toBe("CONFIRMED");
    expect(
      (
        await service.execute({
          effectMarker: mapped.effectMarker,
          fields: mapped.fields,
          subEffects,
        })
      ).status,
    ).toBe("CONFIRMED");
    expect(creates).toBe(1);
    expect(() =>
      assertDefectRouting({
        approved: true,
        profileStatus: "VALID",
        expectedProjectId: "200",
        targetProjectId: "wrong",
        classificationAllowed: true,
        expectedAuthorityNamespace: "n",
        actualAuthorityNamespace: "n",
      }),
    ).toThrow("DEFECT_DESTINATION_MISMATCH");
  });
});
