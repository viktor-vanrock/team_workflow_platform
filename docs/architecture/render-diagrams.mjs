import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

// Uses rendering tools supplied by the caller, without changing project dependencies.
// node docs/architecture/render-diagrams.mjs --mermaid /path/mermaid.min.js --marked /path/marked.esm.js
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
if (!args.includes("--mermaid") || !args.includes("--marked"))
  throw new Error("Required: --mermaid /absolute/mermaid.min.js --marked /absolute/marked.esm.js");
const { marked } = await import(pathToFileURL(path.resolve(option("--marked"))).href);
const out = path.dirname(fileURLToPath(import.meta.url));
const markdown = fs.readFileSync(path.join(out, "README.md"), "utf8");
const inventoryMetadata = JSON.parse(fs.readFileSync(path.join(out, "inventory.json"), "utf8"));
const snapshotDate = new Date(inventoryMetadata.generatedAt).toLocaleDateString("ru-RU", {
  timeZone: "Europe/Samara",
});
const snapshotCommit = inventoryMetadata.commit.slice(0, 7);
const diagrams = [...markdown.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1].trim());
const names = [
  "01-context",
  "02-modules",
  "03-extension-binding",
  "04-domain-data",
  "05-command-delivery",
  "06-qa-workflow",
  "07-gitlab-automation",
  "08-evidence",
  "09-security",
  "10-local-deployment",
  "11-corporate-deployment",
];
if (diagrams.length !== names.length)
  throw new Error("Diagram count changed: update stable filenames.");
const assetDir = path.join(out, "diagrams");
fs.mkdirSync(assetDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1100 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    '<!doctype html><html lang="ru"><head><meta charset="utf-8"></head><body style="margin:0;background:white"><div id="diagram"></div></body></html>',
  );
  await page.addScriptTag({ path: path.resolve(option("--mermaid")) });
  await page.evaluate(() =>
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: {
        fontFamily: "Arial, sans-serif",
        fontSize: "16px",
        primaryColor: "#eaf2fc",
        primaryTextColor: "#17324f",
        primaryBorderColor: "#8fa9c8",
        secondaryColor: "#edf7f3",
        tertiaryColor: "#f6f8fb",
        lineColor: "#59718a",
        textColor: "#17324f",
        mainBkg: "#eaf2fc",
        clusterBkg: "#f5f8fc",
        clusterBorder: "#a8bbce",
        edgeLabelBackground: "#ffffff",
        actorBkg: "#eaf2fc",
        actorBorder: "#8fa9c8",
        actorTextColor: "#17324f",
        signalTextColor: "#17324f",
        signalColor: "#59718a",
      },
      flowchart: {
        htmlLabels: true,
        curve: "basis",
        nodeSpacing: 35,
        rankSpacing: 55,
        padding: 18,
        useMaxWidth: false,
      },
      sequence: { useMaxWidth: false, actorMargin: 55, messageMargin: 35, mirrorActors: false },
      er: { useMaxWidth: false, fontSize: 16, minEntityWidth: 130 },
    }),
  );
  const rendered = [],
    stats = [];
  for (let i = 0; i < diagrams.length; i++) {
    const svg = await page.evaluate(
      async ({ source, id }) => {
        await mermaid.parse(source);
        const { svg } = await mermaid.render(id, source);
        document.getElementById("diagram").innerHTML = svg;
        const element = document.querySelector("#diagram svg");
        element.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        element.setAttribute("style", "background:#fff;font-family:Arial,sans-serif;");
        element.setAttribute("width", String(element.viewBox.baseVal.width));
        element.setAttribute("height", String(element.viewBox.baseVal.height));
        return new XMLSerializer().serializeToString(element);
      },
      { source: diagrams[i], id: "awpdiagram" + i },
    );
    fs.writeFileSync(path.join(assetDir, names[i] + ".mmd"), diagrams[i] + "\n");
    fs.writeFileSync(path.join(assetDir, names[i] + ".svg"), svg);
    const dimensions = await page.locator("#diagram svg").evaluate((el) => ({
      viewBox: el.getAttribute("viewBox"),
      labels: el.querySelectorAll("text,foreignObject").length,
    }));
    stats.push({ name: names[i], ...dimensions, parsed: true });
    rendered.push(svg);
  }
  let index = 0;
  const escaped = (value) =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const sourceMd = markdown.replace(/```mermaid\n([\s\S]*?)```/g, (_, code) => {
    const i = index++;
    return `<figure class="architecture-figure"><div class="diagram-controls" aria-label="Масштаб схемы ${i + 1}"><button type="button" data-scale="fit" aria-pressed="true">Вписать</button><button type="button" data-scale="1" aria-pressed="false">100%</button><button type="button" data-scale="1.5" aria-pressed="false">150%</button></div><div class="diagram-scroll">${rendered[i]}</div><figcaption>Схема ${i + 1} · <a href="diagrams/${names[i]}.svg" target="_blank" rel="noopener">Открыть SVG в полном размере</a> · <a href="diagrams/${names[i]}.mmd">Mermaid source</a></figcaption><details><summary>Исходник схемы</summary><pre><code>${escaped(code.trim())}</code></pre></details></figure>`;
  });
  const nav =
    '<a href="#context">01 Общий контур</a><a href="#runtime">02 Процессы</a><a href="#modules">03 Модули</a><a href="#extensions">04 Расширения</a><a href="#data">05 Данные</a><a href="#commands">06 Команды</a><a href="#qa">07 QA и очередь</a><a href="#automation">08 GitLab</a><a href="#evidence">09 Evidence</a><a href="#security">10 Безопасность</a><a href="#deployment">11 Развёртывание</a><a href="#operations">12 Эксплуатация</a><a href="inventory.html">Технический каталог ↗</a>';
  const withHeadings = (html) =>
    html
      .replace(
        /<h([1-6])>([\s\S]*?)<\/h\1>/g,
        (_, level, text) =>
          "<h" +
          level +
          ' id="' +
          text
            .replace(/<[^>]*>/g, "")
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s_-]/gu, "")
            .replace(/\s/g, "-") +
          '">' +
          text +
          "</h" +
          level +
          ">",
      )
      .replaceAll('href="inventory.md', 'href="inventory.html')
      .replaceAll('href="README.md', 'href="architecture.html');
  const shell = (title, content, navigation) => `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
:root{color-scheme:light;--ink:#19344f;--muted:#567087;--line:#dbe4ed;--accent:#185fb0}
*{box-sizing:border-box}body{margin:0;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:var(--ink);background:#fff}header{padding:22px 36px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:20px;font-weight:600}header span{font-weight:400;color:var(--muted)}.layout{display:grid;grid-template-columns:240px minmax(0,1fr);max-width:1720px;margin:0 auto}nav{padding:30px 20px;position:sticky;top:0;align-self:start;max-height:100vh;overflow:auto}nav a{display:block;padding:8px 10px;font-size:14px;text-decoration:none;border-radius:5px}nav a:hover{background:#edf4fc}main{padding:26px 48px 100px;min-width:0;border-left:1px solid var(--line)}h1{font-size:36px;line-height:1.18;letter-spacing:-.8px;margin:6px 0 28px}h2{font-size:27px;line-height:1.3;margin:60px 0 20px;padding-top:18px;border-top:1px solid var(--line)}h3{font-size:20px;line-height:1.4;margin:32px 0 14px}p{margin:16px 0}a{color:var(--accent);overflow-wrap:anywhere}code{font-size:.86em;background:#f1f5f9;padding:2px 5px;border-radius:4px;overflow-wrap:anywhere}pre{background:#f4f7fb;padding:18px;border-radius:6px;overflow:auto;line-height:1.4}pre code{background:none;padding:0}table{width:100%;border-collapse:collapse;font-size:14px;margin:22px 0}th{text-align:left;background:#f1f6fb;font-weight:600}td,th{padding:12px 13px;border:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}li{margin:9px 0}.architecture-figure{margin:28px 0;padding:18px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.diagram-scroll{overflow:auto;padding:12px 0}.diagram-scroll>svg{display:block;margin:0 auto;max-width:100%;height:auto}figcaption{font-size:13px;color:var(--muted);padding-top:14px}details{margin-top:12px}summary{cursor:pointer;color:var(--accent);font-size:13px}a[id]{scroll-margin-top:18px}
.diagram-controls{display:flex;gap:8px;justify-content:flex-end}.diagram-controls button{cursor:pointer;border:1px solid var(--line);color:var(--ink);background:#fff;border-radius:4px;padding:5px 10px;font:inherit;font-size:13px}.diagram-controls button[aria-pressed=true]{background:#eaf2fc;border-color:#8fa9c8}
@media(max-width:950px){.layout{grid-template-columns:1fr}nav{position:static;max-height:none;display:flex;flex-wrap:wrap;padding:12px}nav a{padding:5px 8px}main{padding:20px;border:0}h1{font-size:28px}header{padding:18px;flex-wrap:wrap}.diagram-scroll>svg{min-width:800px}table{font-size:12px}td,th{padding:8px 6px}}
@media print{nav,header,details,figcaption{display:none}.layout{display:block}main{padding:0;border:0}h2{break-before:page}.architecture-figure,table{break-inside:avoid}a{color:inherit}}
</style></head><body><header>AWP <span>Архитектура · ${snapshotDate} · рабочий срез ${snapshotCommit}</span></header><div class="layout"><nav aria-label="Разделы">${navigation}</nav><main>${withHeadings(content)}</main></div><script>document.querySelectorAll('.architecture-figure').forEach(figure=>{figure.querySelectorAll('[data-scale]').forEach(button=>button.addEventListener('click',()=>{const svg=figure.querySelector('svg'),scale=button.dataset.scale;svg.style.maxWidth=scale==='fit'?'100%':'none';svg.style.width=scale==='fit'?'100%':svg.viewBox.baseVal.width*Number(scale)+'px';svg.style.height='auto';figure.querySelectorAll('[data-scale]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));}));});</script></body></html>`;
  fs.writeFileSync(
    path.join(out, "architecture.html"),
    shell("Архитектура Agentic Workspace Platform", await marked.parse(sourceMd), nav),
  );
  const inventory = fs
    .readFileSync(path.join(out, "inventory.md"), "utf8")
    .replaceAll("(README.md)", "(architecture.html)");
  fs.writeFileSync(
    path.join(out, "inventory.html"),
    shell(
      "AWP — технический каталог",
      await marked.parse(inventory),
      '<a href="architecture.html">← Архитектурная схема</a>',
    ),
  );
  await page.goto(pathToFileURL(path.join(out, "architecture.html")).href);
  const documentCheck = await page.evaluate(() => ({
    figures: document.querySelectorAll("figure.architecture-figure").length,
    renderedSvgs: document.querySelectorAll("figure.architecture-figure svg").length,
    brokenAnchors: [...document.querySelectorAll('a[href^="#"]')]
      .filter((a) => !document.getElementById(a.getAttribute("href").slice(1)))
      .map((a) => a.getAttribute("href")),
    externalScripts: document.querySelectorAll("script[src]").length,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
  }));
  if (
    documentCheck.renderedSvgs !== names.length ||
    documentCheck.brokenAnchors.length ||
    documentCheck.horizontalOverflow
  )
    throw new Error("Document render validation failed: " + JSON.stringify(documentCheck));
  await page.locator(".architecture-figure").first().locator('[data-scale="1"]').click();
  const zoomCheck = await page
    .locator(".architecture-figure")
    .first()
    .locator("svg")
    .evaluate((el) => Math.abs(el.getBoundingClientRect().width - el.viewBox.baseVal.width) < 1);
  if (!zoomCheck) throw new Error("Native-size diagram zoom failed.");
  await page.locator(".architecture-figure").first().locator('[data-scale="fit"]').click();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: path.join(out, "architecture-preview.png") });
  await page.goto(pathToFileURL(path.join(assetDir, names[0] + ".svg")).href);
  await page.locator("svg").screenshot({ path: path.join(out, "overview.png") });
  fs.writeFileSync(
    path.join(out, "render-validation.json"),
    JSON.stringify(
      {
        renderedAt: new Date().toISOString(),
        renderer: "mermaid@11.12.0",
        count: diagrams.length,
        diagrams: stats,
        documentCheck,
        zoomCheck,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({ diagrams: stats, html: path.join(out, "architecture.html") }, null, 2),
  );
} finally {
  await browser.close();
}
