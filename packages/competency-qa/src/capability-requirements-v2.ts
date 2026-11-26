import { sha256 } from "@awp/platform-contracts";
import { qaValidationCapabilityRequirementSetV1 } from "./manifest-v1.4.ts";

const body = Object.freeze({
  id: qaValidationCapabilityRequirementSetV1.id,
  version: 2,
  requirements: Object.freeze(
    qaValidationCapabilityRequirementSetV1.requirements.map((requirement) =>
      requirement.requirementKey === "mattermost-pilot-messaging"
        ? Object.freeze({ ...requirement, capabilityKey: "messaging.notify" as const })
        : requirement,
    ),
  ),
});
export const qaValidationCapabilityRequirementSetV2 = Object.freeze({
  ...body,
  ref: Object.freeze({ id: body.id, version: body.version, contentHash: sha256(body) }),
});

/** Never infer the version from client input; resolve an exact persisted context pin. */
export function resolveQaCapabilityRequirementSet(
  ref: Readonly<{ id: string; version: number; contentHash: string }>,
) {
  return [qaValidationCapabilityRequirementSetV1, qaValidationCapabilityRequirementSetV2].find(
    (set) =>
      set.ref.id === ref.id &&
      set.ref.version === ref.version &&
      set.ref.contentHash === ref.contentHash,
  );
}
