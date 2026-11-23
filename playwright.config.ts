import { defineConfig, devices } from "@playwright/test";

import { browserTestFiles } from "./tests/browser-test-files.ts";
import { fakeIdpChromiumTrustArguments } from "./tests/e2e/support/fake-idp-trust.ts";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: browserTestFiles,
  fullyParallel: false,
  timeout: 45_000,
  use: {
    baseURL: process.env.AWP_WEB_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: [...fakeIdpChromiumTrustArguments()] },
      },
    },
  ],
});
