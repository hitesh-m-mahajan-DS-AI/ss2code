import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import type { FilePlan, ManifestFile } from "@/lib/domain";
import { assertSafeProjectPath } from "@/lib/security";

type SandboxResult = { screenshot: Buffer; visualScore: number; visualFindings: Array<{ id: string; severity: "critical" | "high" | "medium" | "low"; region: string; expected: string; observed: string; suggestedDirection: string }> };

function importPath(entry: string) {
  const withoutExtension = entry.replace(/\.(tsx?|jsx?)$/, "");
  return `./${withoutExtension}`;
}

async function materialize(workspace: string, files: ManifestFile[], plan: FilePlan) {
  for (const file of files) {
    const safePath = assertSafeProjectPath(file.path);
    const target = path.join(workspace, safePath);
    if (!target.startsWith(`${workspace}${path.sep}`)) throw new Error("Sandbox path escaped its workspace.");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf8");
  }
  const entry = assertSafeProjectPath(plan.entry);
  const generatedEntry = path.join(workspace, "__studio_entry.tsx");
  await writeFile(generatedEntry, `import React from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "${importPath(entry)}";\ncreateRoot(document.getElementById("root")!).render(<App />);`, "utf8");
  return generatedEntry;
}

function comparePngs(reference: Buffer, preview: Buffer) {
  const left = PNG.sync.read(reference);
  const right = PNG.sync.read(preview);
  if (left.width !== right.width || left.height !== right.height) return { score: 0, changed: left.width * left.height };
  const diff = new PNG({ width: left.width, height: left.height });
  const changed = pixelmatch(left.data, right.data, diff.data, left.width, left.height, { threshold: 0.16, includeAA: false });
  return { score: Number((1 - changed / (left.width * left.height)).toFixed(4)), changed };
}

export async function renderAndCompare(input: { files: ManifestFile[]; plan: FilePlan; referenceDataUrl: string; viewport: { width: number; height: number } }): Promise<SandboxResult> {
  const workspace = await mkdtemp(path.join(tmpdir(), "ss2-sandbox-"));
  try {
    const entry = await materialize(workspace, input.files, input.plan);
    const output = path.join(workspace, "bundle.js");
    await build({ entryPoints: [entry], outfile: output, bundle: true, platform: "browser", format: "iife", jsx: "automatic", nodePaths: [path.join(process.cwd(), "node_modules")], logLevel: "silent", loader: { ".svg": "dataurl", ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".webp": "dataurl" } });
    const script = await readFile(output, "utf8");
    let browser: Awaited<ReturnType<(typeof import("playwright"))["chromium"]["launch"]>> | undefined;
    try {
      const { chromium } = await import("playwright");
      browser = await chromium.launch({ headless: true, args: ["--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE localhost"] });
      const context = await browser.newContext({ viewport: input.viewport, javaScriptEnabled: true });
      const page = await context.newPage();
      await page.route("**/*", (route) => route.abort());
      await page.setContent("<main id=\"root\"></main>");
      await page.addScriptTag({ content: script });
      await page.waitForTimeout(80);
      const preview = await page.screenshot({ type: "png" });
      const referencePage = await context.newPage();
      await referencePage.setContent(`<style>html,body{margin:0;padding:0;background:#fff;overflow:hidden}img{display:block;width:${input.viewport.width}px;height:${input.viewport.height}px}</style><img alt=\"Reference\" src=\"${input.referenceDataUrl}\" />`);
      const reference = await referencePage.screenshot({ type: "png" });
      await context.close();
      const { score, changed } = comparePngs(reference, preview);
      const findings: SandboxResult["visualFindings"] = score < 0.7
        ? [{ id: "pixel-diff", severity: score < 0.45 ? "critical" : "high", region: "whole page", expected: "Reference geometry and visual treatment", observed: `${Math.round(changed)} pixels differ after thresholding`, suggestedDirection: "Use the side-by-side and overlay comparison to make a targeted geometry, typography, or surface repair." }]
        : [];
      return { screenshot: preview, visualScore: score, visualFindings: findings };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown renderer error";
      throw new Error(`Isolated renderer failed: ${detail}. Install the Playwright Chromium runtime and retry; generated source was not executed outside the browser sandbox.`);
    } finally {
      await browser?.close();
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
