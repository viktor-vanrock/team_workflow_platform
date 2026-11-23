import { describe, expect, it } from "vitest";

import { createQaRequestMapping } from "../../../packages/connector-jira/src/operational/request-create-mapper.ts";
import {
  deriveOperationalCreateCommandIdentity,
  deriveOperationalCreateIdentity,
} from "../../../packages/platform-core/src/work-management/confirm-operational-create.ts";
import { ConfigurationPinSet } from "../../../packages/platform-core/src/work-management/operational-authority.ts";

const ref = (id: string, version = 1) => ({ id, version });
const hash = (value: string) => `sha256:${value.padEnd(64, "0")}` as const;
const pins = ConfigurationPinSet.create([
  {
    sequence: 0,
    purpose: "PRIMARY",
    logicalRole: "QA_REQUEST_AUTHORITY",
    bindingRef: ref("binding"),
    profileRef: ref("central"),
    mappingRef: ref("central-map"),
    connectionRef: ref("central-connection"),
    contentHash: hash("1"),
    adapterFamily: "cloud-v3",
    adapterContractVersion: "1.0.0",
    authorityNamespaceHash: hash("central"),
  },
  {
    sequence: 1,
    purpose: "AUXILIARY",
    logicalRole: "SOURCE_CONTEXT",
    bindingRef: ref("binding"),
    profileRef: ref("source"),
    mappingRef: ref("source-map"),
    connectionRef: ref("source-connection"),
    contentHash: hash("2"),
    adapterFamily: "cloud-v3",
    adapterContractVersion: "1.0.0",
    authorityNamespaceHash: hash("source"),
  },
]);

describe("US1 request.create contract", () => {
  it("derives a stable identity and deterministic marker from confirmation plus ordered pins", () => {
    const identity = deriveOperationalCreateIdentity({
      sourceId: "draft-1",
      sourceVersion: 4,
      operation: "request.create",
      pins,
    });
    const repeated = deriveOperationalCreateIdentity({
      sourceId: "draft-1",
      sourceVersion: 4,
      operation: "request.create",
      pins,
    });
    expect(identity).toEqual(repeated);
    const mapped = createQaRequestMapping({
      identity,
      title: "Validate checkout",
      description: "Acceptance is confirmed",
      projectDiscriminator: "alpha",
      projectId: "100",
      issueTypeId: "10001",
      pins,
    });
    expect(mapped.target).toEqual({
      projectId: "100",
      issueTypeId: "10001",
      projectDiscriminator: "alpha",
    });
    expect(mapped.fields).toMatchObject({
      summary: "Validate checkout",
      customfield_awp_project: "alpha",
      customfield_awp_effect: identity.effectMarker,
    });
    expect(mapped.configurationChain.map(({ logicalRole }) => logicalRole)).toEqual([
      "QA_REQUEST_AUTHORITY",
      "SOURCE_CONTEXT",
    ]);
  });

  it("keeps command/effect identity stable when an HTTP retry uses a different client key", () => {
    const first = deriveOperationalCreateCommandIdentity({
      sourceId: "draft-1",
      sourceVersion: 4,
      operation: "request.create",
      pins,
      commandNamespace: "qa-jira-request-create",
    });
    const differentTransportRetry = deriveOperationalCreateCommandIdentity({
      sourceId: "draft-1",
      sourceVersion: 4,
      operation: "request.create",
      pins,
      commandNamespace: "qa-jira-request-create",
    });
    expect(differentTransportRetry).toEqual(first);
    expect(first.effectIdempotencyKey).toBe(`awp:effect:${first.commandId}`);
    expect(
      deriveOperationalCreateCommandIdentity({
        sourceId: "draft-1",
        sourceVersion: 5,
        operation: "request.create",
        pins,
        commandNamespace: "qa-jira-request-create",
      }).commandId,
    ).not.toBe(first.commandId);
  });
});
