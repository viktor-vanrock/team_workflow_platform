import { createHash } from "node:crypto";

import { Body, Controller, ForbiddenException, Get, Headers, Post } from "@nestjs/common";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new ForbiddenException();
  return encoded;
}

/** External test double only. It never activates Projects or triggers provider effects. */
@Controller("mock/pilot/capabilities")
export class PilotCapabilitiesController {
  private calls = 0;
  private status: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" = "AVAILABLE";
  private guard(key: string | undefined) {
    if (process.env.AWP_PILOT_ADAPTER_MODE !== "development" || key !== "local-gitlab-control")
      throw new ForbiddenException();
  }
  @Get("state") state(@Headers("x-awp-mock-control-key") key?: string) {
    this.guard(key);
    return { calls: this.calls, status: this.status, providerEffects: 0 };
  }
  @Post("fault") fault(
    @Headers("x-awp-mock-control-key") key: string | undefined,
    @Body() body: { status: string },
  ) {
    this.guard(key);
    if (!["AVAILABLE", "DEGRADED", "UNAVAILABLE"].includes(body.status))
      throw new ForbiddenException();
    this.status = body.status as typeof this.status;
    return { status: this.status };
  }
  @Post() probe(
    @Headers("x-awp-mock-control-key") key: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    this.guard(key);
    if (
      body.environmentScope !== "LOCAL" ||
      !body.workspaceId ||
      !body.projectId ||
      !body.bindingRef ||
      !body.profileRef ||
      !body.connectionRef ||
      !body.validationReportRef ||
      !body.operation
    )
      throw new ForbiddenException();
    this.calls++;
    return {
      status: this.status,
      subjectHash: `sha256:${createHash("sha256").update(canonical(body)).digest("hex")}`,
    };
  }
}
