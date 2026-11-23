export const candidateSourceRegistry = Object.freeze([
  Object.freeze({ kind: "JIRA", producerState: "ACTIVE", authority: "AUTHORITATIVE_READ" }),
  Object.freeze({ kind: "GITLAB", producerState: "NOT_INSTALLED", authority: "DENY" }),
] as const);
export function requireCandidateProducer(kind: string) {
  const source = candidateSourceRegistry.find((value) => value.kind === kind);
  if (!source || source.producerState !== "ACTIVE")
    throw new Error(`CANDIDATE_SOURCE_PRODUCER_UNAVAILABLE:${kind}`);
  return source;
}
