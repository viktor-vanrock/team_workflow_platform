export class InMemoryNotificationUnitOfWork {
  readonly #results = new Map<
    string,
    Readonly<{
      denied: boolean;
      notificationIntentId: string | undefined;
      commandId: string | undefined;
      actionCount: number;
    }>
  >();
  async project(input: {
    allowed: boolean;
    dedupeKey: string;
    actionIntentIds: readonly string[];
  }): Promise<
    Readonly<{
      denied: boolean;
      notificationIntentId: string | undefined;
      commandId: string | undefined;
      actionCount: number;
    }>
  > {
    const existing = this.#results.get(input.dedupeKey);
    if (existing) return existing;
    const result = input.allowed
      ? Object.freeze({
          denied: false,
          notificationIntentId: `notification:${input.dedupeKey}`,
          commandId: `command:${input.dedupeKey}`,
          actionCount: input.actionIntentIds.length,
        })
      : Object.freeze({
          denied: true,
          notificationIntentId: undefined,
          commandId: undefined,
          actionCount: 0,
        });
    this.#results.set(input.dedupeKey, result);
    return result;
  }
}
export class InMemoryAgentNotificationUnitOfWork extends InMemoryNotificationUnitOfWork {}
