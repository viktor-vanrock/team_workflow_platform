import { Body, Controller, Get, NotFoundException, Param, Post } from "@nestjs/common";

import type { DummyRequestApplicationService, PublishSampleRecord } from "@awp/competency-dummy";
import type { WorkspaceContext } from "@awp/platform-core";
import { RequirePermission, WorkspaceContextStore } from "@awp/platform-runtime-nest";

@Controller("work-items/:workItemId/extensions/dummy")
export class DummyPackController {
  constructor(
    private readonly application: DummyRequestApplicationService,
    private readonly contexts: WorkspaceContextStore,
    private readonly publisher?: PublishSampleRecord,
  ) {}
  @Get("sample")
  @RequirePermission("work-item.read")
  async getSampleWorkItemExtension(@Param("workItemId") workItemId: string) {
    const value = await this.application.get(
      this.contexts.current() as WorkspaceContext,
      workItemId,
    );
    if (!value) throw new NotFoundException("Dummy extension not found");
    return value;
  }
  @Post("publish")
  @RequirePermission("sample.record.publish")
  publishSampleRecord(
    @Param("workItemId") workItemId: string,
    @Body()
    body: Readonly<{ recordKey: string; title: string; body: string; clientRequestKey: string }>,
  ) {
    if (!this.publisher) throw new Error("DUMMY_PUBLISH_NOT_COMPOSED");
    return this.publisher.publish(this.contexts.current(), { workItemId, ...body });
  }
}
