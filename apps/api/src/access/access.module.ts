import { type DynamicModule, Module } from "@nestjs/common";
import type { DataSource } from "typeorm";

import { CorporateAuthenticationModule, CorporateSessionService } from "@awp/platform-runtime-nest";

import { QA_DATA_SOURCE } from "../extensions/qa-api-authorization.ts";
import { CorporateAccessController } from "./corporate-access.controller.ts";

@Module({})
export class CorporateAccessModule {
  static register(source: DataSource, sessions: CorporateSessionService): DynamicModule {
    if (!source.isInitialized || !sessions) throw new Error("CORPORATE_ACCESS_BINDINGS_REQUIRED");
    return {
      module: CorporateAccessModule,
      imports: [CorporateAuthenticationModule.configured(sessions)],
      controllers: [CorporateAccessController],
      providers: [
        { provide: QA_DATA_SOURCE, useValue: source },
        { provide: CorporateSessionService, useValue: sessions },
      ],
    };
  }
}
