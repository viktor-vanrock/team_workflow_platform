import { Module } from "@nestjs/common";

import { MockOperationalService, OperationalController } from "./operational.controller.ts";

@Module({
  controllers: [OperationalController],
  providers: [MockOperationalService],
  exports: [MockOperationalService],
})
export class OperationalModule {}
