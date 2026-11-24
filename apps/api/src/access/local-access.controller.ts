import { Controller, Inject, UseFilters, UseGuards } from "@nestjs/common";
import type { DataSource } from "typeorm";

import { localPersonaCatalog, PlatformAccessService } from "@awp/runtime-composition";

import { QA_DATA_SOURCE } from "../extensions/qa-api-authorization.ts";
import { LocalSessionGuard, type LocalSessionRequest } from "../local/local-session.guard.ts";
import { AccessController } from "./access.controller.ts";
import { AccessProblemFilter } from "./access-problem.filter.ts";

@Controller("api/v1/access")
@UseFilters(AccessProblemFilter)
@UseGuards(LocalSessionGuard)
export class LocalAccessController extends AccessController {
  constructor(
    @Inject(QA_DATA_SOURCE) source: DataSource,
    @Inject(LocalSessionGuard) guard: LocalSessionGuard,
  ) {
    const access = new PlatformAccessService(source);
    const principal = async (request: LocalSessionRequest) => {
      if (!guard.authentication(request) || !request.localPersonaKey)
        throw new Error("PLATFORM_ACCESS_DENIED");
      const persona = localPersonaCatalog.resolve(request.localPersonaKey);
      if (persona.kind !== "HUMAN") throw new Error("PLATFORM_ACCESS_DENIED");
      const [identity] = (await source.query(
        "SELECT id FROM identities WHERE issuer=$1 AND subject=$2 AND kind='HUMAN'",
        [process.env.AWP_IDENTITY_ISSUER, persona.subject],
      )) as { id: string }[];
      if (!identity) throw new Error("PLATFORM_ACCESS_DENIED");
      return identity.id;
    };
    super(access, {
      principal,
      authorize: async (request, permission, mutate) => {
        const principalId = await principal(request);
        if (mutate) {
          const step = Date.parse(guard.authentication(request)?.stepUpAt ?? "");
          if (!Number.isFinite(step) || step > Date.now() || Date.now() - step > 300_000)
            throw new Error("ACCESS_STEP_UP_REQUIRED");
        }
        return access.authorizeLocal(principalId, permission);
      },
    });
  }
}
