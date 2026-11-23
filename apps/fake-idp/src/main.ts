import "reflect-metadata";

import { readFileSync } from "node:fs";

import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { FakeOidcController, FakeOidcService } from "./oidc.controller.ts";

@Controller("health")
class IdpHealthController {
  @Get("live") live() {
    return { status: "UP", service: "fake-idp", localOnly: true };
  }
  @Get("ready") ready() {
    return { status: "UP", service: "fake-idp", https: true };
  }
}

@Module({ controllers: [IdpHealthController, FakeOidcController], providers: [FakeOidcService] })
class FakeIdpModule {}

export async function bootstrapFakeIdp(): Promise<void> {
  if ((process.env.AWP_RUNTIME_PROFILE ?? "local") !== "local")
    throw new Error("FAKE_IDP_LOCAL_PROFILE_REQUIRED");
  const keyPath = process.env.FAKE_IDP_TLS_KEY_PATH;
  const certPath = process.env.FAKE_IDP_TLS_CERT_PATH;
  if (!keyPath || !certPath) throw new Error("FAKE_IDP_TLS_FILES_REQUIRED");
  const app = await NestFactory.create(FakeIdpModule, {
    httpsOptions: { key: readFileSync(keyPath), cert: readFileSync(certPath) },
    logger: ["error", "warn", "log"],
  });
  await app.listen(Number(process.env.PORT ?? 4443), "0.0.0.0");
}

if (import.meta.url === `file://${process.argv[1]}`) await bootstrapFakeIdp();
