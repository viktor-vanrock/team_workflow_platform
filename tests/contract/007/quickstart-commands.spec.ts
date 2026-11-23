import { describe, expect, it } from "vitest";

import { quickstartCommands } from "../../../tools/verification/quickstart-commands.mts";

describe("Feature 007 quickstart command discovery", () => {
  it("ignores prose versions and non-shell examples while preserving real commands", () => {
    const markdown = [
      "pnpm 11.21.0. The contour was healthy.",
      "```text",
      "pnpm not-a-command",
      "```",
      "```bash",
      "corepack enable",
      "pnpm prerequisites",
      "pnpm smoke:007",
      "```",
      "~~~sh",
      "pnpm smoke:007",
      "pnpm trace:007",
      "~~~",
    ].join("\n");
    expect(quickstartCommands(markdown)).toEqual([
      "corepack enable",
      "pnpm prerequisites",
      "pnpm smoke:007",
      "pnpm trace:007",
    ]);
  });

  it("keeps unknown shell commands for fail-closed script validation", () => {
    expect(quickstartCommands("```bash\r\npnpm missing:script\r\n```")).toEqual([
      "pnpm missing:script",
    ]);
  });
});
