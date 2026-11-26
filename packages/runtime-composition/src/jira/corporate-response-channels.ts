import { qaAggregateSnapshotHash, type QaResponseChannelResolver } from "@awp/competency-qa/node";

/** Until a verified channel inventory is connected, retain the explicit missing-channel fact. */
export function createUnresolvedCorporateQaResponseChannels(): QaResponseChannelResolver {
  const policy = Object.freeze({
    key: "qa.response-channel-resolution",
    version: "1.0.0",
    contentHash: qaAggregateSnapshotHash({
      key: "qa.response-channel-resolution",
      version: "1.0.0",
    }),
  });
  return {
    async resolve({ requester, evaluatedAt }) {
      return {
        state: "MISSING",
        requesterPrincipal: requester,
        resolutionPolicyRef: policy,
        evaluatedAt,
        missingReasonCode: "REQUESTER_RESPONSE_CHANNEL_MISSING",
      };
    },
  };
}
