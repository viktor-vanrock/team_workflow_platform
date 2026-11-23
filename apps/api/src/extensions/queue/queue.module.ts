import { Module } from "@nestjs/common";

import { queueFoundationOperationModuleShell } from "@awp/runtime-composition";

/** Route handlers are added story-by-story; this module fixes the static boundary. */
@Module({})
export class QueueFoundationApiModule {
  static readonly operations = queueFoundationOperationModuleShell.apiOperations;
}
