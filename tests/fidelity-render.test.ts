import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { renderProject } from "../src/server/render-project";
import { fixtureFiles, fixturePlan, fixtureSpec, fixtureHtml } from "./support/fixture";

const browserExecutable = process.env.SS2_TEST_CHROME;

test("a real browser reports confident heading mismatch despite high raw pixel agreement", { skip: !browserExecutable, timeout: 180_000 }, async () => {
  const originalLaunch = chromium.launch;
  const launch = originalLaunch.bind(chromium);
  chromium.launch = options => launch({ ...options, executablePath: browserExecutable });
  try {
    const referenceBrowser = await chromium.launch({ headless: true, executablePath: browserExecutable });
    let referenceDataUrl: string;
    try {
      const page = await referenceBrowser.newPage({ viewport: fixtureSpec.reference.viewport });
      await page.setContent(fixtureHtml);
      referenceDataUrl = "data:image/png;base64," + (await page.screenshot()).toString("base64");
    } finally { await referenceBrowser.close(); }

    const typographySpec = { ...fixtureSpec, observations: { ...fixtureSpec.observations, style: { ...fixtureSpec.observations.style, typography: [{ role: "heading", sizePxApprox: 32, weight: "700", notes: "Page title", regionId: "page", confidence: "high" as const }] } } };
    const typographyFiles = fixtureFiles.map(file => file.path === "src/Header.tsx" ? { ...file, content: file.content.replace("<h1>", '<h1 data-ss2-typography="heading">') } : file.path.endsWith(".css") ? { ...file, content: file.content.replace("font-size:32px;line-height:1.2;font-weight:700", "font-size:28px;line-height:1.2;font-weight:400") } : file);
    assert.notEqual(typographyFiles.at(-1)?.content, fixtureFiles.at(-1)?.content);
    const result = await renderProject({ files: typographyFiles, plan: fixturePlan, visualSpec: typographySpec, referenceDataUrl, viewport: fixtureSpec.reference.viewport });

    assert.ok(result.visualScore > 0.98, "Small typography differences should be capable of retaining a misleadingly high global pixel score");
    assert.equal(result.metrics.typographyChecks?.[0].status, "measured");
    assert.deepEqual(result.metrics.typographyChecks?.[0].mismatches, ["font size expected 32px, rendered 28px (-4px)", "font weight expected 700, rendered 400"]);
    assert.ok(result.visualFindings.some(f => f.id === "typography-heading-page" && f.severity === "critical"));
  } finally { chromium.launch = originalLaunch; }
});
