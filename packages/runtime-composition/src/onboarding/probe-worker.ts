import type {
  CapabilityModeAssessment,
  CapabilityProbeResult,
  ExactRevisionRef,
  ProjectScope,
} from "@awp/platform-core";

export interface CapabilityProbeWorkItem extends ProjectScope {
  readonly bindingRef: ExactRevisionRef;
  readonly qaProjectContextRef: ExactRevisionRef;
  readonly requirementSetRef: ExactRevisionRef;
}

export interface CapabilityProbeJobSource {
  due(now: string): Promise<readonly CapabilityProbeWorkItem[]>;
}

export interface CapabilityProbeExecutor {
  execute(item: CapabilityProbeWorkItem, now: string): Promise<readonly CapabilityProbeResult[]>;
}

export interface CapabilityAssessmentProjector {
  appendProbes(probes: readonly CapabilityProbeResult[]): Promise<void>;
  assess(
    item: CapabilityProbeWorkItem,
    probes: readonly CapabilityProbeResult[],
    now: string,
  ): Promise<CapabilityModeAssessment>;
  appendAssessment(assessment: CapabilityModeAssessment): Promise<void>;
}

/**
 * Connector observations are facts only. This worker appends probes and a QA-owned
 * assessment; a separate onboarding action consumes the assessment to change mode.
 */
export class ProjectCapabilityProbeWorker {
  constructor(
    private readonly source: CapabilityProbeJobSource,
    private readonly probes: CapabilityProbeExecutor,
    private readonly projector: CapabilityAssessmentProjector,
    private readonly now: () => string,
  ) {}

  async run(): Promise<
    Readonly<{ checked: number; assessments: readonly CapabilityModeAssessment[] }>
  > {
    const now = this.now();
    const assessments: CapabilityModeAssessment[] = [];
    for (const item of await this.source.due(now)) {
      const observations = await this.probes.execute(item, now);
      await this.projector.appendProbes(observations);
      const assessment = await this.projector.assess(item, observations, now);
      await this.projector.appendAssessment(assessment);
      assessments.push(assessment);
    }
    return Object.freeze({ checked: assessments.length, assessments: Object.freeze(assessments) });
  }
}
