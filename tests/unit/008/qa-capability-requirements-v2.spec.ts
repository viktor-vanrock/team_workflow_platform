import { describe, expect, it } from "vitest";

import {
  qaValidationCapabilityRequirementSetV2,
  resolveQaCapabilityRequirementSet,
} from "../../../packages/competency-qa/src/capability-requirements-v2.ts";
import { qaValidationCapabilityRequirementSetV1 } from "../../../packages/competency-qa/src/manifest-v1.4.ts";
import { mattermostConnectorManifest } from "../../../packages/connector-mattermost/src/manifest.ts";

describe("versioned QA capability requirements", () => {
  it("matches the actual Mattermost notification capability without changing v1", () => {
    const before = qaValidationCapabilityRequirementSetV1.requirements.find(
      (item) => item.requirementKey === "mattermost-pilot-messaging",
    )!;
    const after = qaValidationCapabilityRequirementSetV2.requirements.find(
      (item) => item.requirementKey === "mattermost-pilot-messaging",
    )!;
    expect(before.capabilityKey).toBe("messaging.notification");
    expect(after.capabilityKey).toBe("messaging.notify");
    expect(
      mattermostConnectorManifest.implements.some(
        (capability) =>
          capability.capabilityKey === after.capabilityKey &&
          capability.operations.includes("notification.send" as never),
      ),
    ).toBe(true);
    expect({ ...after, capabilityKey: before.capabilityKey }).toEqual(before);
    expect(
      qaValidationCapabilityRequirementSetV2.requirements.filter((item) => item !== after),
    ).toEqual(
      qaValidationCapabilityRequirementSetV1.requirements.filter((item) => item !== before),
    );
  });
  it("resolves only exact version and content hash", () => {
    expect(resolveQaCapabilityRequirementSet(qaValidationCapabilityRequirementSetV1.ref)).toBe(
      qaValidationCapabilityRequirementSetV1,
    );
    expect(resolveQaCapabilityRequirementSet(qaValidationCapabilityRequirementSetV2.ref)).toBe(
      qaValidationCapabilityRequirementSetV2,
    );
    expect(
      resolveQaCapabilityRequirementSet({
        ...qaValidationCapabilityRequirementSetV2.ref,
        contentHash: qaValidationCapabilityRequirementSetV1.ref.contentHash,
      }),
    ).toBeUndefined();
  });
});
