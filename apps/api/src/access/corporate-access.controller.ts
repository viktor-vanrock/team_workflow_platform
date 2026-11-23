import { Controller, Inject, UseFilters } from "@nestjs/common";
import type { DataSource } from "typeorm";

import { CorporateSessionService } from "@awp/platform-runtime-nest";
import { PlatformAccessService } from "@awp/runtime-composition";

import { QA_DATA_SOURCE } from "../extensions/qa-api-authorization.ts";
import { AccessController } from "./access.controller.ts";
import { AccessProblemFilter } from "./access-problem.filter.ts";

@Controller("api/v1/access")
@UseFilters(AccessProblemFilter)
export class CorporateAccessController extends AccessController {
  constructor(
    @Inject(QA_DATA_SOURCE) source: DataSource,
    @Inject(CorporateSessionService) sessions: CorporateSessionService,
  ) {
    super(new PlatformAccessService(source), {
      principal: async (request) => (await sessions.session(request)).principalId,
      authorize: (request, permission, mutate) =>
        sessions.authorizePlatform(request, {
          permission,
          operationClass: mutate ? "MUTATE" : "READ",
          requireStepUp: mutate,
        }),
    });
  }
}
