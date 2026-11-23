import type {
  confirmQaIntake,
  QaServiceActor,
  QaVersionedReference,
} from "@awp/competency-qa/node";

export const QA_INTAKE_CONFIGURATION = Symbol("QA_INTAKE_CONFIGURATION");
export interface QaIntakeConfiguration {
  load(scope: Readonly<{ workspaceId: string; projectId: string }>): Promise<
    Readonly<{
      bindingRef: QaVersionedReference;
      profileRef: QaVersionedReference;
      projectContextId: string;
      responseChannels: Parameters<typeof confirmQaIntake>[0]["responseChannels"];
      inlineService?: QaServiceActor;
      commandIdentity(
        input: Readonly<{ sourceId: string; confirmationVersion: number }>,
      ): Promise<Readonly<{ commandId: string; effectIdempotencyKey: string }>>;
    }>
  >;
}
