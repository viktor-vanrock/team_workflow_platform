# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 007/compose-live.spec.ts >> 007 live Compose browser verifies suspended-project evidence and exports through explicit step-up
- Location: tests/e2e/007/compose-live.spec.ts:5:1

# Error details

```
Test timeout of 90000ms exceeded.
```

```
Error: locator.fill: Test timeout of 90000ms exceeded.
Call log:
  - waiting for getByLabel('Manifest ID', { exact: true })

```

# Page snapshot

```yaml
- generic [ref=f1e4]:
  - alert [ref=f1e5]:
    - generic [ref=f1e9]:
      - strong [ref=f1e10]: LOCAL DEVELOPMENT
      - text: · deterministic providers · external egress denied
  - generic [ref=f1e11]:
    - generic [ref=f1e12]:
      - heading "Agentic Workspace" [level=3] [ref=f1e13]
      - paragraph [ref=f1e14]: Extension kernel walking skeleton
    - generic [ref=f1e15]:
      - generic [ref=f1e16]: LOCAL
      - generic [ref=f1e18]: dummy.request@1.0.0
  - generic [ref=f1e22]:
    - heading "Identity & context" [level=5] [ref=f1e23]
    - generic [ref=f1e24]:
      - combobox "Persona" [ref=f1e25]:
        - option "Workspace Owner" [selected]
        - option "Integration Admin · ALPHA"
        - option "Requester · ALPHA"
        - option "Limited Reader · ALPHA"
        - option "Executor · ALPHA"
        - option "QA Lead · ALPHA"
        - option "Viewer · BETA"
        - option "Auditor"
        - option "Worker Service"
        - option "Outsider · DELTA"
      - button "Switch persona" [ref=f1e26] [cursor=pointer]
      - button "Confirm development step-up" [ref=f1e27] [cursor=pointer]
    - generic [ref=f1e28]:
      - generic [ref=f1e29]: Workspace Owner
      - generic [ref=f1e31]: local-functional/ALPHA
      - generic [ref=f1e33]: ceiling RESTRICTED
      - generic [ref=f1e35]: workspace-owner
    - alert [ref=f1e37]:
      - generic [ref=f1e41]: Authenticated as Workspace Owner; grants resolved server-side.
  - generic [ref=f1e42]:
    - generic [ref=f1e45]:
      - heading "Dummy intake" [level=5] [ref=f1e46]
      - generic [ref=f1e47]:
        - generic [ref=f1e48]: Sample name
        - generic [ref=f1e49]:
          - textbox "Sample name" [ref=f1e50]: Local request
          - group:
            - generic: Sample name
      - generic [ref=f1e51]:
        - generic [ref=f1e52]: Message
        - generic [ref=f1e53]:
          - textbox "Message" [ref=f1e54]: Walk the extension kernel
          - group:
            - generic: Message
      - button "Create Work Item" [ref=f1e55] [cursor=pointer]
    - generic [ref=f1e58]:
      - heading "External command" [level=5] [ref=f1e59]
      - generic [ref=f1e60]:
        - generic [ref=f1e61]: Record key
        - generic [ref=f1e62]:
          - textbox "Record key" [ref=f1e63]: local-ui-record
          - group:
            - generic: Record key
      - generic [ref=f1e64]:
        - generic [ref=f1e65]: Payload message
        - generic [ref=f1e66]:
          - textbox "Payload message" [ref=f1e67]: Walk the extension kernel
          - group:
            - generic: Payload message
      - generic [ref=f1e68] [cursor=pointer]:
        - checkbox "Require exact Approval" [ref=f1e70]
        - generic [ref=f1e73]: Require exact Approval
      - button "Publish through Mock Hub" [ref=f1e74] [cursor=pointer]
  - generic [ref=f1e77]:
    - heading "Durable status" [level=5] [ref=f1e78]
    - paragraph [ref=f1e79]: "Model: deterministic-fake · MODEL_PROVIDER_CONFIGURED"
    - separator [ref=f1e80]
    - heading "Work Items (2)" [level=6] [ref=f1e81]
    - paragraph [ref=f1e82]: 995fcdaa-67b9-4f8c-9290-7ed4346f64c8 · NEW · INTERNAL
    - paragraph [ref=f1e83]: Historical request · OPEN · INTERNAL
    - separator [ref=f1e84]
    - heading "Commands (2)" [level=6] [ref=f1e85]
    - paragraph [ref=f1e86]: 0e8a0d85-d8a1-45a9-848f-c72d0043797a · CONFIRMED · correlation c3534437-9997-4e88-ae3e-1c21be8c3c45
    - paragraph [ref=f1e87]: 82000000-0000-4000-8000-000000000001 · CONFIRMED · correlation 84000000-0000-4000-8000-000000000001
  - main [ref=f1e88]:
    - heading "Evidence integrity" [level=4] [ref=f1e89]
    - generic [ref=f1e92]:
      - heading "Verify a signed revision" [level=6] [ref=f1e93]
      - generic [ref=f1e94]:
        - generic:
          - text: Manifest ID
          - generic: "*"
        - generic [ref=f1e95]:
          - textbox "Manifest ID" [ref=f1e96]
          - group:
            - generic: Manifest ID *
      - generic [ref=f1e97]:
        - generic [ref=f1e98]:
          - text: Revision
          - generic [ref=f1e99]: "*"
        - generic [ref=f1e100]:
          - spinbutton "Revision" [ref=f1e101]: "1"
          - group:
            - generic: Revision *
      - button "Verify evidence" [disabled]
    - generic [ref=f1e104]:
      - heading "Export verified package metadata" [level=6] [ref=f1e105]
      - paragraph [ref=f1e106]: The current project policy and all package signatures are checked before export. Step-up authentication is required.
      - generic [ref=f1e107]:
        - generic:
          - text: Evidence package ID
          - generic: "*"
        - generic [ref=f1e108]:
          - textbox "Evidence package ID" [ref=f1e109]
          - group:
            - generic: Evidence package ID *
      - generic [ref=f1e110]:
        - generic:
          - text: Export reason
          - generic: "*"
        - generic [ref=f1e111]:
          - textbox "Export reason" [ref=f1e112]
          - group:
            - generic: Export reason *
      - button "Export verified evidence" [disabled]
  - generic [ref=f1e113]:
    - generic [ref=f1e116]:
      - heading "Approvals" [level=5] [ref=f1e117]
      - generic [ref=f1e118]:
        - paragraph [ref=f1e119]: PENDING · 81000000-0000-4000-8000-000000000001
        - button "Approve" [ref=f1e120] [cursor=pointer]
      - paragraph [ref=f1e122]: APPROVED · 81000000-0000-4000-8000-000000000002
    - generic [ref=f1e125]:
      - heading "Artifacts" [level=5] [ref=f1e126]
      - generic [ref=f1e127]:
        - paragraph [ref=f1e128]: local-walking-skeleton.txt · PUBLIC · AVAILABLE
        - button "Download" [ref=f1e129] [cursor=pointer]
      - generic [ref=f1e130]:
        - paragraph [ref=f1e131]: alpha.txt · RESTRICTED · AVAILABLE
        - button "Download" [ref=f1e132] [cursor=pointer]
      - generic [ref=f1e133]:
        - paragraph [ref=f1e134]: local.txt · PUBLIC · EXPIRED
        - button "Download" [disabled]
```

# Test source

```ts
  1  | import { readFile } from "node:fs/promises";
  2  | import { test, expect } from "@playwright/test";
  3  | import type { SmokeEvidence } from "../../../tools/smoke/007-http-journey.mts";
  4  | 
  5  | test("007 live Compose browser verifies suspended-project evidence and exports through explicit step-up",async({page})=>{
  6  |   test.setTimeout(90000);
  7  |   const input=process.env.AWP_007_SMOKE_INPUT;if(!input)throw new Error("Use pnpm smoke:007 for the live Compose journey");
  8  |   const proof=JSON.parse(await readFile(input,"utf8")) as SmokeEvidence & {projectName:string};
  9  |   expect(proof.projectName).toBe(process.env.AWP_LOCAL_PROJECT_NAME);
  10 |   const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  11 |   await page.goto(`${process.env.AWP_WEB_URL}/projects/${proof.projectId}/onboarding`);
  12 |   await page.getByLabel("Persona").selectOption("integration-admin.alpha");await page.getByRole("button",{name:"Switch persona"}).click();
  13 |   await expect(page.getByText("Project onboarding · Compose onboarding smoke",{exact:true})).toBeVisible();
  14 |   await expect(page.getByText("SUSPENDED",{exact:true})).toBeVisible();
  15 |   await page.goto(`${process.env.AWP_WEB_URL}/projects/${proof.projectId}/evidence`);
  16 |   await page.getByLabel("Persona").selectOption("owner.local");await page.getByRole("button",{name:"Switch persona"}).click();
> 17 |   await page.getByLabel("Manifest ID",{exact:true}).fill(proof.manifestId);
     |                                                     ^ Error: locator.fill: Test timeout of 90000ms exceeded.
  18 |   await page.getByRole("button",{name:"Verify evidence",exact:true}).click();
  19 |   await expect(page.getByText(/signature PASS/iu)).toBeVisible();
  20 |   await page.getByRole("button",{name:"Confirm development step-up"}).click();
  21 |   await expect(page.getByText(/Development step-up confirmed/)).toBeVisible();
  22 |   await page.getByLabel("Evidence package ID").fill(proof.packageId);await page.getByLabel("Export reason").fill("Live Compose browser proof");
  23 |   const [download]=await Promise.all([page.waitForEvent("download"),page.getByRole("button",{name:"Export verified evidence",exact:true}).click()]);
  24 |   const file=await download.path();expect(file).toBeTruthy();const bytes=await readFile(file!,"utf8");
  25 |   expect(bytes).toContain(proof.packageId);expect(bytes).not.toMatch(/opaqueLocator|privateKey/u);
  26 |   await expect(page.getByText("Verified metadata export downloaded and recorded in the audit log.")).toBeVisible();
  27 |   expect(errors).toEqual([]);
  28 | });
  29 | 
```