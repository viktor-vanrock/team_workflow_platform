import { type DynamicModule, Module } from "@nestjs/common";
import type { DataSource } from "typeorm";

import {
  PublishedQaAutomationAvailability,
  type QaAutomationAvailabilityPins,
} from "@awp/runtime-composition";

import {
  QA_DATA_SOURCE,
  QA_HTTP_IDENTITY,
  type QaHttpIdentity,
  QaSessionGuard,
} from "../qa-api-authorization.ts";
import {
  QA_AUTOMATION_AVAILABILITY_API,
  QaAutomationAvailabilityController,
} from "./qa-automation-availability.controller.ts";

/** Explicit API slice for the corporate host; no local seed or local availability provider. */
@Module({})
export class PublishedAutomationAvailabilityModule {
  static register(
    input: Readonly<{
      source: DataSource;
      identity: QaHttpIdentity;
      pins: readonly QaAutomationAvailabilityPins[];
      deadlineMs?: number;
    }>,
  ): DynamicModule {
    const availability = new PublishedQaAutomationAvailability(
      input.source,
      input.pins,
      input.deadlineMs,
    );
    return {
      module: PublishedAutomationAvailabilityModule,
      controllers: [QaAutomationAvailabilityController],
      providers: [
        { provide: QA_DATA_SOURCE, useValue: input.source },
        { provide: QA_HTTP_IDENTITY, useValue: input.identity },
        { provide: QA_AUTOMATION_AVAILABILITY_API, useValue: availability },
        QaSessionGuard,
      ],
    };
  }
}
