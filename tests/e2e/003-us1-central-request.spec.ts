import { describe, expect, it } from "vitest";

import { onQaIntakeConfirmed } from "../../packages/competency-qa/src/application/on-intake-confirmed.ts";
import { JiraRequestCreateService } from "../../packages/connector-jira/src/operational/request-create.ts";
import { createQaRequestMapping } from "../../packages/connector-jira/src/operational/request-create-mapper.ts";
import { deriveOperationalCreateIdentity } from "../../packages/platform-core/src/work-management/confirm-operational-create.ts";
import { ConfigurationPinSet } from "../../packages/platform-core/src/work-management/operational-authority.ts";

const ref = (id: string) => ({ id, version: 1 });
const h = (v: string) => `sha256:${v.padEnd(64, "0")}` as const;

describe("003 US1 central request E2E", () => {
  it("flows from confirmed intake to one authoritative issue observation and survives replay", async () => {
    const intent = onQaIntakeConfirmed({
      workspaceId: "w",
      projectId: "p",
      draftId: "d",
      confirmationVersion: 1,
      title: "Checkout",
      goal: "Verify",
      acceptanceOutcome: "Pass",
      dataClassificationKey: "INTERNAL",
    });
    const pins = ConfigurationPinSet.create([
      {
        sequence: 0,
        purpose: "PRIMARY",
        logicalRole: "QA_REQUEST_AUTHORITY",
        bindingRef: ref("b"),
        profileRef: ref("p1"),
        mappingRef: ref("m1"),
        connectionRef: ref("c1"),
        contentHash: h("1"),
        adapterFamily: "cloud",
        adapterContractVersion: "1",
        authorityNamespaceHash: h("n1"),
      },
      {
        sequence: 1,
        purpose: "AUXILIARY",
        logicalRole: "SOURCE_CONTEXT",
        bindingRef: ref("b"),
        profileRef: ref("p2"),
        mappingRef: ref("m2"),
        connectionRef: ref("c2"),
        contentHash: h("2"),
        adapterFamily: "cloud",
        adapterContractVersion: "1",
        authorityNamespaceHash: h("n2"),
      },
    ]);
    const identity = deriveOperationalCreateIdentity({
      sourceId: intent.source.intakeDraftId,
      sourceVersion: intent.source.confirmationVersion,
      operation: intent.operation,
      pins,
    });
    const mapped = createQaRequestMapping({
      identity,
      title: "Checkout",
      description: "Verify",
      projectDiscriminator: "p",
      projectId: "100",
      issueTypeId: "10001",
      pins,
    });
    let id: string | undefined;
    let creates = 0;
    const service = new JiraRequestCreateService({
      lookup: async () =>
        id ? { state: "FOUND", externalEntityId: id } : { state: "PROVEN_ABSENT" },
      create: async () => {
        creates++;
        id = "10001";
        return { externalEntityId: id };
      },
      observe: async (value) => ({
        externalEntityId: value,
        externalDisplayKey: "QAC-1",
        externalRevisionToken: "1",
        authorityFieldsHash: h("o"),
      }),
    });
    const first = await service.execute({
      effectMarker: mapped.effectMarker,
      fields: mapped.fields,
      subEffects: [],
    });
    const replay = await service.execute({
      effectMarker: mapped.effectMarker,
      fields: mapped.fields,
      subEffects: [],
    });
    expect(first.status).toBe("CONFIRMED");
    expect(replay.status).toBe("CONFIRMED");
    expect(creates).toBe(1);
  });
});
