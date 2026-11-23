import {
  type AuthorizedProjectQueryToken,
  type InMemoryEventInbox,
  processEvent,
  type ProjectEventEnvelope,
} from "@awp/platform-core";

function authorized(token: AuthorizedProjectQueryToken, event: ProjectEventEnvelope): boolean {
  return (
    event.payload.scope.workspaceId === token.workspaceId &&
    token.allows(event.payload.scope.projectId, 0, "READ")
  );
}

export function filterAuthorizedProjectEvents(
  token: AuthorizedProjectQueryToken,
  events: readonly ProjectEventEnvelope[],
): readonly ProjectEventEnvelope[] {
  return events.filter((event) => authorized(token, event));
}

export async function processAuthorizedProjectEvent(
  inbox: InMemoryEventInbox,
  consumerKey: string,
  event: ProjectEventEnvelope,
  reauthorize: () => Promise<AuthorizedProjectQueryToken>,
): Promise<Awaited<ReturnType<typeof processEvent>>> {
  const token = await reauthorize();
  if (!authorized(token, event)) {
    const key = `${consumerKey}\0${event.payload.eventId}`;
    inbox.quarantine.set(
      key,
      Object.freeze({
        consumerKey,
        reason: "PROJECT_EVENT_NOT_AUTHORIZED",
        event: Object.freeze({ eventId: event.payload.eventId }),
      }),
    );
    throw new Error("PROJECT_EVENT_NOT_AUTHORIZED");
  }
  return processEvent(inbox, consumerKey, {
    eventId: event.payload.eventId,
    entityId: event.payload.subjectRef.id,
    entityVersion: event.payload.subjectRef.version,
  });
}
