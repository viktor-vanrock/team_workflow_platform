import { type DynamicModule, Module } from "@nestjs/common";
import type { DataSource } from "typeorm";

import type { PilotDeadLetterService } from "@awp/runtime-composition";

import {
  QA_DATA_SOURCE,
  QA_HTTP_IDENTITY,
  type QaHttpIdentity,
  QaSessionGuard,
} from "../qa-api-authorization.ts";
import { PILOT_DEAD_LETTERS, PilotDeadLetterController } from "./pilot.controller.ts";

/** The selected deployment supplies current identity and original-command guards. */
@Module({})
export class PilotDeadLetterModule {
  static register(
    input: Readonly<{
      source: DataSource;
      identity: QaHttpIdentity;
      service: PilotDeadLetterService;
    }>,
  ): DynamicModule {
    return {
      module: PilotDeadLetterModule,
      controllers: [PilotDeadLetterController],
      providers: [
        QaSessionGuard,
        { provide: QA_DATA_SOURCE, useValue: input.source },
        { provide: QA_HTTP_IDENTITY, useValue: input.identity },
        { provide: PILOT_DEAD_LETTERS, useValue: input.service },
      ],
    };
  }
}
