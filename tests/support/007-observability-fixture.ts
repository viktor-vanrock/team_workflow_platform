export const feature007MetricDefinitions = Object.freeze([
  { name: "awp_onboarding_transitions_total", labels: ["stage", "outcome"] },
  { name: "awp_capability_probes_total", labels: ["connector", "outcome"] },
  { name: "awp_capability_mode_assessments_total", labels: ["mode", "outcome"] },
  { name: "awp_test_account_leases_total", labels: ["state", "outcome"] },
  { name: "awp_evidence_signatures_total", labels: ["status", "outcome"] },
  { name: "awp_artifact_retention_actions_total", labels: ["state", "outcome"] },
] as const);

export class Feature007ObservabilityFixture {
  readonly samples: Array<
    Readonly<{ name: string; labels: Readonly<Record<string, string>>; value: number }>
  > = [];
  queryCount = 0;
  providerReads = 0;
  modelReads = 0;

  record(name: string, labels: Readonly<Record<string, string>>, value = 1): void {
    const definition = feature007MetricDefinitions.find((candidate) => candidate.name === name);
    if (!definition) throw new Error("FEATURE_007_METRIC_NOT_BOUNDED");
    const keys = Object.keys(labels).sort();
    if (keys.join("\0") !== [...definition.labels].sort().join("\0"))
      throw new Error("FEATURE_007_METRIC_LABEL_SET_INVALID");
    if (
      Object.values(labels).some(
        (label) => label.length === 0 || /[0-9a-f]{8}-[0-9a-f-]{27,}/iu.test(label),
      )
    )
      throw new Error("FEATURE_007_HIGH_CARDINALITY_LABEL_FORBIDDEN");
    this.samples.push(Object.freeze({ name, labels: Object.freeze({ ...labels }), value }));
  }

  async authorizedProjectRead<T>(load: () => Promise<T>): Promise<T> {
    // Query token, prefiltered resource query and batched exact refs: the count
    // is constant regardless of the number of authorized Projects.
    this.queryCount += 3;
    return await load();
  }
}
