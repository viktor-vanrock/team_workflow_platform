export const qaDodRulesV1 = Object.freeze({
  id: "qa.dod.rules",
  version: "1.0.0",
  hardBlockers: Object.freeze([
    "AGGREGATE_CHANGED",
    "REQUIRED_SESSION_REVIEW_MISSING",
    "NEGATIVE_EVIDENCE_INCOMPLETE",
    "VERDICT_UNSIGNED",
    "VERDICT_STALE",
    "FINDING_UNRESOLVED",
    "DRAFT_PUBLICATION_UNRESOLVED",
  ]),
});
