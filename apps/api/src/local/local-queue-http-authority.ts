import type { DataSource } from "typeorm";

import { LocalQueueHttpAuthority } from "@awp/runtime-composition";

import { authorizeLocalQaApi } from "./local-qa-authorization.ts";

export function createLocalQueueHttpAuthority(source: DataSource) {
  return new LocalQueueHttpAuthority(source, {
    authorize: async (input) =>
      await authorizeLocalQaApi(
        source,
        { headers: {}, localPersonaKey: input.actorSubject },
        input.workspaceId,
        input.projectId,
        input.permission,
      ),
  });
}
