import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { chromium, type Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import type { Evaluation, FilePlan, ManifestFile, VisualSpec } from "@/lib/domain";
import { scaffoldProject } from "./scaffold";
import { compareImages } from "./visual-comparison";
import { compareTypography, edgeDeltasPx, edgeTolerancePx, hasEdgeMismatch, measureLayoutRelationships, typographySelectorForRole, type TypographyObservation } from "./fidelity-metrics";

export type RenderInput = { files: ManifestFile[]; plan: FilePlan; referenceDataUrl: string; viewport: { width: number; height: number }; visualSpec?: VisualSpec; framework?: "react-tailwind" | "nextjs-tailwind" };
export type RenderResult = { screenshot: string; diff: string; html: string; visualScore: number; visualFindings: Evaluation["visualFindings"]; a11yFindings: Evaluation["a11yFindings"]; metrics: Evaluation["metrics"] };
const signed = (value: number) => (value > 0 ? "+" : "") + value;

async function command(args: string[], cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, windowsHide: true, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { output = (output + chunk.toString()).slice(-12_000); });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(output.replaceAll(cwd, "<project>"))));
  });
}

async function stableScreenshot(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode().catch(() => undefined)));
  });
  let last = await page.screenshot({ animations: "disabled", caret: "hide", timeout: 10_000 });
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.waitForTimeout(150);
    const current = await page.screenshot({ animations: "disabled", caret: "hide", timeout: 10_000 });
    if (current.equals(last)) return current;
    last = current;
  }
  throw new Error("Preview did not stabilize. Remove timers or layout changes before validation.");
}

function bundleHtml(script: string, css: string) {
  const nonce = randomUUID();
  const policy = "default-src 'none'; script-src 'nonce-" + nonce + "'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none';";
  const bridge = [
    'let inspecting = false;',
    'window.addEventListener("message", e => { if (e.source !== parent || e.data?.type !== "ss2:inspect") return; inspecting = e.data.enabled === true; document.body.style.cursor = inspecting ? "crosshair" : ""; });',
    'document.addEventListener("click", e => { if (!inspecting || !(e.target instanceof Element)) return; e.preventDefault(); e.stopImmediatePropagation(); const node = e.target.closest("[data-ss2-region]"); parent.postMessage({type:"ss2:selection",region:node?.getAttribute("data-ss2-region") ?? "",tag:e.target.tagName,text:(e.target.textContent ?? "").slice(0,160)},"*"); }, true);',
    'document.addEventListener("submit", e => e.preventDefault(), true);',
    'document.addEventListener("click", e => { const a = e.target instanceof Element ? e.target.closest("a") : null; if(a && !a.getAttribute("href")?.startsWith("#")) e.preventDefault(); }, true);',
  ].join("\n");
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="' + policy + '"><title>Reconstructed interface</title><style>' + css.replace(/<\/style/gi, "<\\/style") + '</style></head><body><div id="root"></div><script nonce="' + nonce + '">' + (bridge + "\n" + script).replace(/<\/script/gi, "<\\/script") + "</script></body></html>";
}

export async function renderProject(input: RenderInput): Promise<RenderResult> {
  if (input.viewport.width < 280 || input.viewport.width > 3840 || input.viewport.height < 320 || input.viewport.height > 4096) throw new Error("Unsupported capture dimensions.");
  if (!/^data:image\/(?:png|jpeg|webp|avif|gif);base64,[A-Za-z0-9+/=]+$/.test(input.referenceDataUrl)) throw new Error("Reference must be a validated inline image.");
  const workspace = await mkdtemp(path.join(tmpdir(), "ss2-render-"));
  const moduleRoot = path.join(process.cwd(), "node_modules");
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const scaffold = scaffoldProject(input.files, input.plan, input.framework);
    for (const file of scaffold) {
      const target = path.join(workspace, file.path);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.content);
    }
    await symlink(moduleRoot, path.join(workspace, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    await command([path.join(moduleRoot, "typescript/bin/tsc"), "--noEmit"], workspace);
    await command([path.join(moduleRoot, "eslint/bin/eslint.js"), ".", "--max-warnings", "0"], workspace);
    if (input.framework === "nextjs-tailwind") {
      if (process.env.SS2_CONTAINER !== "1") throw new Error("Next.js server builds require SANDBOX_MODE=docker.");
      await command([path.join(moduleRoot, "next/dist/bin/next"), "build", "--webpack"], workspace);
    }
    await command(["scripts/build.mjs"], workspace);
    const html = bundleHtml(await readFile(path.join(workspace, "dist/app.js"), "utf8"), await readFile(path.join(workspace, "dist/app.css"), "utf8"));
    browser = await chromium.launch({ headless: true, chromiumSandbox: process.env.SS2_CONTAINER !== "1", args: ["--host-resolver-rules=MAP * 0.0.0.0"] });
    const context = await browser.newContext({ viewport: input.viewport, reducedMotion: "reduce", serviceWorkers: "block", bypassCSP: true });
    await context.route("**/*", route => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const runtimeErrors: string[] = [];
    page.on("pageerror", error => runtimeErrors.push(error.message));
    await page.setContent(html);
    await page.waitForFunction(() => document.getElementById("root")!.childElementCount > 0);
    const screenshot = await stableScreenshot(page);
    if (runtimeErrors.length) throw new Error("Browser runtime failure: " + runtimeErrors.join("; ").slice(0, 2000));
    const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    const a11yFindings = accessibility.violations.map(item => ({ id: item.id + "-" + input.viewport.width, severity: item.impact ?? "moderate", message: (item.help + ": " + (item.nodes[0]?.failureSummary ?? "")).slice(0, 600), target: item.nodes.map(n => n.target.join(" ")).join(", ").slice(0, 200) }));
    const visualFindings: Evaluation["visualFindings"] = [];
    const typographyRequests = (input.visualSpec?.observations.style.typography ?? []).map(item => ({ ...item, selector: typographySelectorForRole(item.role) }));
    const evidence = await page.evaluate(requests => {
      const regionNodes = [...document.querySelectorAll<HTMLElement>("[data-ss2-region]")];
      const regions = [];
      for (const node of regionNodes) {
        const rect = node.getBoundingClientRect();
        regions.push({
          id: node.dataset.ss2Region!,
          text: (node.innerText ?? "").replace(/\s+/g, " ").trim(),
          boundsPct: [rect.x / innerWidth * 100, rect.y / innerHeight * 100, rect.width / innerWidth * 100, rect.height / innerHeight * 100],
          boundsPx: [rect.x, rect.y, rect.width, rect.height] as [number, number, number, number],
        });
      }
      const typography = [];
      for (const request of requests) {
        const roots = [];
        for (const node of regionNodes) if (!request.regionId || node.dataset.ss2Region === request.regionId) roots.push(node);
        const targets = new Set<HTMLElement>();
        for (const root of roots) {
          const elements = [root, ...root.querySelectorAll<HTMLElement>("*")];
          const marked = [];
          for (const element of elements) if (element.dataset.ss2Typography?.trim().toLowerCase() === request.role.trim().toLowerCase()) marked.push(element);
          if (marked.length) {
            for (const element of marked) targets.add(element);
          } else if (request.selector) {
            for (const element of elements) if (element.matches(request.selector)) targets.add(element);
          }
        }
        if (targets.size !== 1) {
          typography.push({ status: targets.size ? "ambiguous" : "missing" });
          continue;
        }
        const target = [...targets][0];
        const actualRegionId = target.closest<HTMLElement>("[data-ss2-region]")?.dataset.ss2Region;
        if (request.regionId && actualRegionId !== request.regionId) {
          typography.push({ status: "ambiguous", regionId: actualRegionId });
          continue;
        }
        const style = getComputedStyle(target);
        const fontSizePx = Number.parseFloat(style.fontSize);
        const lineHeightPx = Number.parseFloat(style.lineHeight);
        const letterSpacingPx = Number.parseFloat(style.letterSpacing);
        typography.push({
          status: "measured",
          regionId: actualRegionId,
          fontSizePx: Number.isFinite(fontSizePx) ? fontSizePx : undefined,
          weight: style.fontWeight,
          family: style.fontFamily,
          lineHeightPx: Number.isFinite(lineHeightPx) ? lineHeightPx : undefined,
          letterSpacingPx: Number.isFinite(letterSpacingPx) ? letterSpacingPx : undefined,
        });
      }
      return { regions, typography };
    }, typographyRequests) as {
      regions: Array<{ id: string; text: string; boundsPct: [number, number, number, number]; boundsPx: [number, number, number, number] }>;
      typography: TypographyObservation[];
    };
    const referencePage = await context.newPage();
    await referencePage.setContent('<style>html,body{margin:0;background:white}img{display:block}</style><img alt="" src="' + input.referenceDataUrl + '">');
    const dimensions = await referencePage.locator("img").evaluate(async node => { const img = node as HTMLImageElement; await img.decode(); return { width: img.naturalWidth, height: img.naturalHeight }; });
    if (dimensions.width !== input.viewport.width || dimensions.height !== input.viewport.height) throw new Error("Target viewport must match the reference's original dimensions. Reanalyse the reference; images are never stretched for scoring.");
    const reference = await stableScreenshot(referencePage);
    const layout = input.visualSpec?.observations.layout ?? [];
    const compared = compareImages(reference, screenshot, layout);
    const evidenceById = new Map<string, typeof evidence.regions>();
    for (const node of evidence.regions) evidenceById.set(node.id, [...(evidenceById.get(node.id) ?? []), node]);
    const typographyChecks = compareTypography(input.visualSpec?.observations.style.typography ?? [], evidence.typography);
    const regions = compared.regions.map(region => {
      const observed = layout.find(r => r.id === region.region)!;
      const matches = evidenceById.get(region.region) ?? [];
      const node = matches.length === 1 ? matches[0] : undefined;
      const visibleText = (input.visualSpec?.observations.visibleText ?? []).filter(t => (t.region === observed.id || t.region === observed.region) && t.confidence === "high" && !t.text.includes("["));
      const geometryScore = node ? Math.max(0, 1 - observed.boundsPct.reduce((sum, value, i) => sum + Math.abs(value - node.boundsPct[i]), 0) / 100) : 0;
      const textCoverage = visibleText.length ? visibleText.filter(t => node?.text.includes(t.text.replace(/\s+/g, " ").trim())).length / visibleText.length : undefined;
      const edges = node ? edgeDeltasPx(observed.boundsPct, node.boundsPx, input.viewport) : undefined;
      const edgeMismatch = hasEdgeMismatch(edges, input.viewport);
      const foregroundMismatch = region.foregroundScore < 0.55;
      if (!node || geometryScore < 0.85 || edgeMismatch || region.pixelScore < 0.7 || foregroundMismatch || (textCoverage !== undefined && textCoverage < 1)) {
        const critical = observed.importance === "critical" && (!node || geometryScore < 0.85 || edgeMismatch || region.pixelScore < 0.7 || foregroundMismatch || (textCoverage !== undefined && textCoverage < 1));
        const edgeText = edges ? "; rendered − expected edges L " + signed(edges.left) + "px, T " + signed(edges.top) + "px, R " + signed(edges.right) + "px, B " + signed(edges.bottom) + "px" : "";
        const mappingText = matches.length ? "Multiple elements map to this region (" + matches.length + "); exactly one is required." : "No element maps to this observed region.";
        visualFindings.push({ id: "region-" + region.region, severity: critical ? "critical" : "high", region: observed.region, expected: "Match the observed [x, y, width, height] bounds " + observed.boundsPct.join(", ") + "% within " + Math.round(edgeTolerancePx(input.viewport)) + "px edge tolerance and preserve legible text.", observed: node ? "Pixel agreement " + Math.round(region.pixelScore * 100) + "%; visible-content overlap " + Math.round(region.foregroundScore * 100) + "%; geometry " + Math.round(geometryScore * 100) + "%; text coverage " + (textCoverage === undefined ? "not measured" : Math.round(textCoverage * 100) + "%") + edgeText : mappingText, suggestedDirection: "Use the signed edge offsets and visible-content overlap to correct this region's position, size and missing content; then correct text/styling only where measured. Preserve matched regions." });
      }
      return { ...region, geometryScore, textCoverage, ...(edges ? { edgeDeltasPx: edges } : {}) };
    });
    const actualBounds = new Map([...evidenceById].filter(([, nodes]) => nodes.length === 1).map(([id, nodes]) => [id, nodes[0].boundsPx]));
    const spacingMeasurements = measureLayoutRelationships(layout, actualBounds, input.viewport);
    const layoutRelationships = spacingMeasurements.deviations;
    for (const relation of layoutRelationships) {
      const first = layout.find(item => item.id === relation.firstRegion);
      const second = layout.find(item => item.id === relation.secondRegion);
      const important = first?.importance === "critical" || second?.importance === "critical";
      visualFindings.push({
        id: "spacing-" + relation.axis + "-" + relation.firstRegion + "-" + relation.secondRegion,
        severity: important && Math.abs(relation.deltaPx) >= 24 ? "high" : "medium",
        region: (first?.region ?? relation.firstRegion) + " ↔ " + (second?.region ?? relation.secondRegion),
        expected: "Preserve the observed " + relation.axis + " gap of " + relation.expectedGapPx + "px.",
        observed: "Rendered gap " + relation.actualGapPx + "px (rendered − expected " + signed(relation.deltaPx) + "px).",
        suggestedDirection: "Adjust the gap between these regions locally; preserve their measured outer bounds and all matched regions.",
      });
    }
    for (const check of typographyChecks) {
      if (!check.mismatches.length || !check.verified) continue;
      const targetRegion = layout.find(region => region.id === check.regionId);
      const criticalHeading = targetRegion?.importance === "critical" && /^(?:(?:page )?(?:title|heading)(?: [1-6])?)$/i.test(check.role.trim());
      visualFindings.push({ id: "typography-" + check.role + "-" + check.regionId, severity: criticalHeading ? "critical" : "high", region: check.role + " · " + check.regionId, expected: "Match the high-confidence approved typography observations for this exact region.", observed: check.mismatches.join("; "), suggestedDirection: "Correct only the mapped text element's measured typography properties; keep its wording, line wrapping intent and surrounding geometry intact." });
    }
    let horizontalOverflow = false;
    for (const width of [...new Set([input.viewport.width, 768, 360])]) {
      await page.setViewportSize({ width, height: input.viewport.height });
      const overflow = await page.evaluate(() => ({ exceeds: document.documentElement.scrollWidth > innerWidth + 1, suspects: [...document.querySelectorAll<HTMLElement>("body *")].filter(node => node.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map(node => node.tagName.toLowerCase() + (node.id ? "#" + node.id : "") + (node.dataset.ss2Region ? " region=" + node.dataset.ss2Region : "")) }));
      if (overflow.exceeds) {
        horizontalOverflow = true;
        visualFindings.push({ id: "overflow-" + width, severity: "critical", region: "viewport " + width, expected: "No horizontal document overflow", observed: "Content exceeds the viewport: " + overflow.suspects.join(", "), suggestedDirection: "Use min-width:0, responsive widths/wrapping and a local scroll container for dense tables; preserve source hierarchy." });
      }
      if (width !== input.viewport.width) {
        const responsiveA11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        a11yFindings.push(...responsiveA11y.violations.map(item => ({ id: item.id + "-" + width, severity: item.impact ?? "moderate", message: (item.help + ": " + (item.nodes[0]?.failureSummary ?? "")).slice(0, 600), target: item.nodes.map(n => n.target.join(" ")).join(", ").slice(0, 200) })));
      }
    }
    if (runtimeErrors.length) throw new Error("Responsive runtime failure: " + runtimeErrors.join("; "));
    const metrics: Evaluation["metrics"] = { visualScore: compared.score, horizontalOverflow, regions, layoutRelationships, layoutRelationshipsChecked: spacingMeasurements.checkedPairs, typographyChecks, viewport: input.viewport, checks: ["TypeScript", "ESLint", "production bundle", "stable render", "runtime errors", "per-region visible-content overlap", "per-region edge geometry", "adjacent-region spacing", "mapped typography measurements", "360/768/reference axe accessibility", "360/768/reference overflow"], limitations: ["Raw pixel agreement is not a fidelity score and can stay high when small text/layout regions are wrong; visible-content overlap is measured separately.", "Typography mismatches are actionable only when the approved observation is high-confidence and tied to an exact layout region; missing or ambiguous mappings are shown as unverified.", "Geometry and text checks use the confirmed visual specification; unseen states are not verified.", "Interactions require human review in the live preview."] };
    return { screenshot: screenshot.toString("base64"), diff: compared.diff.toString("base64"), html, visualScore: compared.score, visualFindings, a11yFindings, metrics };
  } finally {
    await browser?.close();
    // The only removable directory is the unique directory created above.
    await rm(workspace, { recursive: true, force: true });
  }
}
