import { Body, Controller, Get, Headers, Param, Post } from "@nestjs/common";

import type { WorkspaceContext } from "@awp/platform-core";

import { RequirePermission } from "../auth/authorize-use-case.interceptor.ts";
import {
  assertNoAuthoritativeClientFields,
  WorkspaceContextStore,
} from "../auth/workspace-context.ts";

export abstract class ControlPlaneApplication {
  abstract command(context: WorkspaceContext, id: string): Promise<unknown>;
  abstract approval(context: WorkspaceContext, id: string): Promise<unknown>;
  abstract decideApproval(
    context: WorkspaceContext,
    id: string,
    input: Readonly<{ decision: "APPROVE" | "REJECT"; reason?: string }>,
  ): Promise<unknown>;
  abstract requestBindingPublication(
    context: WorkspaceContext,
    input: Readonly<{
      bindingRef: { id: string; version: number };
      expectedResourceVersion: number;
    }>,
  ): Promise<unknown>;
  abstract rawWebhook(
    input: Readonly<{
      connectorKey: string;
      deliveryId: string;
      timestamp: string;
      signature: string;
      rawBody: Uint8Array;
    }>,
  ): Promise<unknown>;
}
@Controller("control-plane")
export class ControlPlaneController {
  constructor(
    private readonly application: ControlPlaneApplication,
    private readonly contexts: WorkspaceContextStore,
  ) {}
  @Get("commands/:id") @RequirePermission("command.read") command(@Param("id") id: string) {
    return this.application.command(this.contexts.current(), id);
  }
  @Get("approvals/:id") @RequirePermission("approval.read") approval(@Param("id") id: string) {
    return this.application.approval(this.contexts.current(), id);
  }
  @Post("approvals/:id/decision") @RequirePermission("approval.decide") decide(
    @Param("id") id: string,
    @Body() body: Readonly<{ decision: "APPROVE" | "REJECT"; reason?: string }>,
  ) {
    assertNoAuthoritativeClientFields(body);
    return this.application.decideApproval(this.contexts.current(), id, body);
  }
  @Post("bindings/request-publication")
  @RequirePermission("integration.binding.request-publication")
  requestPublication(
    @Body()
    body: Readonly<{
      bindingRef: { id: string; version: number };
      expectedResourceVersion: number;
    }>,
  ) {
    assertNoAuthoritativeClientFields(body);
    return this.application.requestBindingPublication(this.contexts.current(), body);
  }
  @Post("webhooks/:connectorKey") @RequirePermission("webhook.ingest") webhook(
    @Param("connectorKey") connectorKey: string,
    @Headers("x-awp-delivery-id") deliveryId: string,
    @Headers("x-awp-timestamp") timestamp: string,
    @Headers("x-awp-signature") signature: string,
    @Body() body: unknown,
  ) {
    const rawBody =
      body instanceof Uint8Array ? body : new TextEncoder().encode(JSON.stringify(body));
    return this.application.rawWebhook({ connectorKey, deliveryId, timestamp, signature, rawBody });
  }
}
