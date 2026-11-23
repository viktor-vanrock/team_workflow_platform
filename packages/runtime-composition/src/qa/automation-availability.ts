import {
  deriveAutomationAvailability,
  type QaAutomationAvailability,
  type QaAutomationConfigurationIntersection,
  type QaScope,
} from "@awp/competency-qa/node";

export interface QaAutomationIntersectionProjection {
  current(scope: QaScope): Promise<QaAutomationConfigurationIntersection>;
}

export interface QaAutomationLiveHealthProjection {
  current(scope: QaScope): Promise<
    Readonly<{
      liveAvailability: QaAutomationAvailability["liveAvailability"];
      reasonCodes: readonly string[];
    }>
  >;
}

/**
 * Persistence/configuration adapters resolve authoritative server-owned refs;
 * QA owns the deterministic structural-mode and live-health reduction.
 */
export class RuntimeQaAutomationAvailability {
  constructor(
    private readonly intersections: QaAutomationIntersectionProjection,
    private readonly operationalHealth?: QaAutomationLiveHealthProjection,
  ) {}

  async current(scope: QaScope): Promise<QaAutomationAvailability> {
    if (!scope.workspaceId || !scope.projectId)
      throw new Error("QA_AUTOMATION_PROJECT_SCOPE_REQUIRED");
    const exactScope = Object.freeze({ ...scope });
    const intersection = await this.intersections.current(exactScope);
    const health =
      this.operationalHealth === undefined
        ? undefined
        : await this.operationalHealth.current(exactScope);
    return deriveAutomationAvailability(
      health === undefined
        ? intersection
        : Object.freeze({
            ...intersection,
            liveHealth: Object.freeze({
              availability: health.liveAvailability,
              reasonCodes: Object.freeze([...health.reasonCodes]),
            }),
          }),
    );
  }
}
