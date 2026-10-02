import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { recordSpan, traceContext } from "../src/server/telemetry";

test("analytics CLI exports only safe aggregates and keyboard-accessible responsive tables", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ss2-analytics-"));
  const previous = process.env.PRIVATE_STORAGE_ROOT, enabled = process.env.TELEMETRY_ENABLED;
  let output: string | undefined;
  process.env.PRIVATE_STORAGE_ROOT = root; process.env.TELEMETRY_ENABLED = "true";
  try {
    traceContext.run({ id: "private-test-trace-never-export", source: "benchmark" }, () => recordSpan({ stage: "GENERATE", outcome: "ok", durationMs: 10, model: "test/explicit-synthetic-instrumentation-fixture", usage: { totalTokens: 10, costCredits: 0 } }));
    const result = await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/analytics.ts"], { env: { ...process.env, PRIVATE_STORAGE_ROOT: root }, windowsHide: true });
    output = result.stdout.match(/Validated local warehouse and dashboard: (.+)/)?.[1].trim();
    assert.ok(output);
    const relative = path.relative(path.resolve(".data/analytics"), path.resolve(output));
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    const report = await readFile(path.join(output, "report.json"), "utf8");
    assert.ok(!report.includes("private-test-trace-never-export"));
    assert.equal(JSON.parse(report).p95StageMs, null);
    const browser = await chromium.launch({ headless: true });
    try {
      // Audit injection bypasses CSP only inside this test context; generated CSP stays strict.
      const context = await browser.newContext({ bypassCSP: true });
      const page = await context.newPage();
      await page.goto(pathToFileURL(path.join(output, "dashboard.html")).href);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        assert.deepEqual(audit.violations.filter(item => ["critical", "serious"].includes(item.impact ?? "")).map(item => item.id), []);
        await page.getByRole("region", { name: "model reliability table" }).focus();
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("role")), "region");
      }
    } finally { await browser.close(); }
  } finally {
    if (previous === undefined) delete process.env.PRIVATE_STORAGE_ROOT; else process.env.PRIVATE_STORAGE_ROOT = previous;
    if (enabled === undefined) delete process.env.TELEMETRY_ENABLED; else process.env.TELEMETRY_ENABLED = enabled;
    await rm(root, { recursive: true, force: true });
    if (output) {
      const relative = path.relative(path.resolve(".data/analytics"), path.resolve(output));
      if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) await rm(output, { recursive: true, force: true });
    }
  }
});
