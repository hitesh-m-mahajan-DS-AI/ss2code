import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { renderAndCompare } from "../src/server/sandbox";
import { fixtureFiles, fixturePlan, fixtureSpec, fixtureHtml } from "./support/fixture";

test("real worker builds CSS/TS, measures fidelity, detects type errors and produces an interactive isolated preview", { timeout: 180_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: fixtureSpec.reference.viewport });
    await page.setContent(fixtureHtml);
    const reference = await page.screenshot();
    const input = { files: fixtureFiles, plan: fixturePlan, visualSpec: fixtureSpec, referenceDataUrl: "data:image/png;base64," + reference.toString("base64"), viewport: fixtureSpec.reference.viewport };
    const result = await renderAndCompare(input);
    assert.ok(result.visualScore > 0.97, "Expected faithful fixture capture, got " + result.visualScore);
    assert.equal(result.metrics.horizontalOverflow, false);
    assert.equal(result.metrics.regions?.[0].textCoverage, 1);
    assert.ok(!result.a11yFindings.some(f => ["critical", "serious"].includes(f.severity)));
    await page.setContent('<iframe sandbox="allow-scripts" title="Test preview"></iframe>');
    await page.locator("iframe").evaluate((node, html) => { (node as HTMLIFrameElement).srcdoc = html; }, result.html);
    const frame = page.frameLocator("iframe");
    await frame.getByRole("button", { name: "Interactions: 0" }).click();
    assert.equal(await frame.getByRole("button").innerText(), "Interactions: 1");
    const typographySpec = { ...fixtureSpec, observations: { ...fixtureSpec.observations, style: { ...fixtureSpec.observations.style, typography: [{ role: "heading", sizePxApprox: 32, weight: "700", notes: "Page title", regionId: "page", confidence: "high" as const }] } } };
    const typographyFiles = fixtureFiles.map(file => file.path === "src/Header.tsx" ? { ...file, content: file.content.replace("<h1>", '<h1 data-ss2-typography="heading">') } : file.path.endsWith(".css") ? { ...file, content: file.content.replace("font-size:32px;line-height:1.2;font-weight:700", "font-size:28px;line-height:1.2;font-weight:400") } : file);
    const typographyResult = await renderAndCompare({ ...input, files: typographyFiles, visualSpec: typographySpec });
    assert.ok(typographyResult.visualScore > 0.98, "Small text differences should be capable of retaining a misleadingly high global pixel score");
    assert.equal(typographyResult.metrics.typographyChecks?.[0].status, "measured");
    assert.deepEqual(typographyResult.metrics.typographyChecks?.[0].mismatches, ["font size expected 32px, rendered 28px (-4px)", "font weight expected 700, rendered 400"]);
    assert.ok(typographyResult.visualFindings.some(f => f.id === "typography-heading-page" && f.severity === "critical"));
    if (process.env.SANDBOX_MODE === "docker") {
      const nextResult = await renderAndCompare({ ...input, framework: "nextjs-tailwind" });
      assert.ok(nextResult.visualScore > 0.97, "Next.js export must build and retain reference fidelity");
    }
    const bad = fixtureFiles.map(f => f.path === "src/App.tsx" ? { ...f, content: "const value: number = 'wrong'; export default function App(){return <main>{value}</main>}" } : f);
    await assert.rejects(renderAndCompare({ ...input, files: bad }), /not assignable/);
    const mobileBad = fixtureFiles.map(file => file.path.endsWith(".css") ? { ...file, content: file.content + "\n@media(max-width:400px){body main h1{color:#cccccc;background:#ffffff}}" } : file);
    const mobileResult = await renderAndCompare({ ...input, files: mobileBad });
    assert.ok(mobileResult.a11yFindings.some(f => f.id === "color-contrast-360" && ["critical", "serious"].includes(f.severity)), "Mobile-only contrast must be checked, not just the reference viewport");
  } finally { await browser.close(); }
});
