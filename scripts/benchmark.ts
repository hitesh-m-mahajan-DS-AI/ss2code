import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { datasetSchema, summarize, selectCases, type BenchmarkResult, type Lane } from "../src/evaluation/contracts";
import { structuredOpenRouterCall } from "../src/server/openrouter";
import { traceContext } from "../src/server/telemetry";
import { renderAndCompare } from "../src/server/sandbox";
import { validateGeneratedProject } from "../src/server/validation";
import { componentTreePrompt, filePlanPrompt, generationPrompt, repairPrompt, tokenPrompt, visualSpecPrompt, PROMPT_VERSION } from "../src/lib/prompts";
import { generatedProjectSchema, filePlanSchema, visualSpecSchema, patchSetSchema } from "../src/lib/schemas";
import type { FilePlan, GeneratedProject } from "../src/lib/domain";
import { boundedBraceFiles } from "../src/server/scaffold";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const lane = option("--lane", "self-test") as Lane;
if (!["direct", "staged", "repair", "self-test"].includes(lane)) throw new Error("Unknown lane");
const split = option("--split", "development");
if (!["development", "validation", "holdout"].includes(split)) throw new Error("Unknown split");
if (split === "holdout" && !args.includes("--allow-holdout")) throw new Error("Holdout is sealed by default. Freeze prompts before passing --allow-holdout.");
if (lane !== "self-test" && !process.env.OPENROUTER_API_KEY) throw new Error("Live lanes require OPENROUTER_API_KEY. Self-test is NOT an AI quality result.");
const limit = Number(option("--limit", "2")), repeats = Number(option("--repeats", "1"));
if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(repeats) || repeats < 1 || repeats > 5) throw new Error("Limits: 1–100 cases and 1–5 repeats");
const manifestPath = path.resolve(option("--manifest", ".data/benchmarks/pilot/manifest.json"));
const manifestBytes = await readFile(manifestPath);
const dataset = datasetSchema.parse(JSON.parse(manifestBytes.toString()));
const requestedCases = option("--cases", "").split(",").filter(Boolean);
if (requestedCases.some(id => !dataset.cases.some(item => item.id === id && item.split === split))) throw new Error("Requested case is absent from this split");
const selected = selectCases(dataset.cases.filter(item => !requestedCases.length || requestedCases.includes(item.id)), split, limit);
if (!selected.length) throw new Error("No cases selected");
const runId = randomUUID();
const out = path.resolve(".data/benchmarks/runs", runId);
await mkdir(out, { recursive: true });
let commit = "unavailable";
try { commit = execFileSync("git", ["-c", `safe.directory=${process.cwd().replaceAll("\\", "/")}`, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch {}
const results: BenchmarkResult[] = [];
const sourceFiles = ["scripts/benchmark.ts", "scripts/benchmark-fixtures.ts", "src/lib/prompts.ts", "src/lib/schemas.ts", "src/lib/domain.ts", "src/server/openrouter.ts", "src/server/validation.ts", "src/server/sandbox.ts", "src/server/render-project.ts", "src/server/scaffold.ts", "src/server/visual-comparison.ts", "src/workers/render.ts", "src/evaluation/contracts.ts", "resources/export/react-tailwind.lock.json", "resources/export/nextjs-tailwind.lock.json", "Dockerfile.render", "tsconfig.json", "package.json", "package-lock.json"];
sourceFiles.push(...boundedBraceFiles.map(file => "vendor/braces/" + file));
sourceFiles.push("src/server/output-contract.ts");
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash("sha256").update(await readFile(file)).digest("hex")])));
await writeFile(path.join(out, "run.json"), JSON.stringify({ runId, startedAt: new Date().toISOString(), lane, split, limit, repeats, selectedCases: selected.map(item => item.id), commit, sourceHashes, routing: { preferredFamilies: process.env.MODEL_PREFERRED_FAMILIES ?? "nemotron,gemma", retries: process.env.MAX_MODEL_RETRIES ?? "3", timeoutMs: process.env.REQUEST_TIMEOUT_MS ?? "90000" }, promptVersion: PROMPT_VERSION, datasetHash: createHash("sha256").update(manifestBytes).digest("hex"), environment: { node: process.version, platform: process.platform, sandbox: process.env.SANDBOX_MODE ?? "process" }, disclaimer: "Synthetic pilot, not real-user evidence. Self-test uses oracle code; live lanes use only OpenRouter." }, null, 2));
const safeError = (error: unknown) => String(error).replace(/sk-or-v1-[\w-]+/g, "[redacted]").slice(0, 5000);

for (const item of selected) for (let repeat = 0; repeat < repeats; repeat++) {
  const traceId = `${runId}:${item.id}:${repeat}`;
  await traceContext.run({ id: traceId, source: "benchmark" }, async () => {
    const started = performance.now();
    const row: BenchmarkResult = { id: item.id, group: item.group, category: item.category, lane, repeat, traceId, completed: false, firstBuildPassed: false, durationMs: 0, modelIds: [], repairPasses: 0 };
    let phase = "input";
    const call = async (input: Parameters<typeof structuredOpenRouterCall>[0]) => {
      phase = input.prompt.match(/^ROLE: (\w+)/)?.[1] ?? "generation";
      const response = await structuredOpenRouterCall(input); row.modelIds.push(response.modelId);
      await writeFile(path.join(out, `${item.id}-${repeat}-stage-${row.modelIds.length}-${phase}.json`), JSON.stringify(response, null, 2));
      return response.value;
    };
    try {
      const imagePath = path.resolve(path.dirname(manifestPath), item.reference);
      if (!imagePath.startsWith(path.dirname(manifestPath) + path.sep)) throw new Error("Reference escaped dataset directory");
      const bytes = await readFile(imagePath);
      if (createHash("sha256").update(bytes).digest("hex") !== item.sha256) throw new Error("Reference hash mismatch");
      const referenceDataUrl = "data:image/png;base64," + bytes.toString("base64");
      let project: GeneratedProject, plan: FilePlan;
      phase = "generation";
      if (lane === "self-test") {
        project = { files: item.oracleFiles, summary: "Oracle infrastructure check — not AI output", interactionNotes: [], assumptionsApplied: [] }; plan = item.oraclePlan;
      } else if (lane === "direct") {
        project = generatedProjectSchema.parse(await call({ role: "code", imageDataUrl: referenceDataUrl, stream: true, prompt: `ROLE: GENERATE\nReconstruct this screenshot faithfully as React + TypeScript + CSS. Use src/App.tsx as the default component entry, relative imports and source files under src/ only. Allowed packages: react, react-dom, lucide-react. No remote assets, configs or package manifests. Put data-ss2-region="page" on the main page container. The original viewport is ${item.viewport.width}x${item.viewport.height}. Return GeneratedProject JSON. Do not invent text or sections.` }));
        plan = { entry: "src/App.tsx", files: project.files.map(f => ({ path: f.path, purpose: "Direct baseline output", exports: [], dependsOn: [], visualRegions: ["page"] })), designTokens: { colors: {}, spacing: {}, radii: {}, shadows: {}, motion: {} }, implementationDecisions: [], assumptionsUsed: [] };
      } else {
        const spec = visualSpecSchema.parse(await call({ role: "vision", imageDataUrl: referenceDataUrl, prompt: visualSpecPrompt({ ...item.viewport, assetKind: "image", userIntent: 'Use region ID "page" for the outer page container; preserve all visible contents.' }) }));
        spec.reference.viewport = item.viewport;
        const tokens = await call({ role: "blueprint", prompt: tokenPrompt(spec) });
        const tree = await call({ role: "blueprint", prompt: componentTreePrompt(spec, tokens) });
        plan = filePlanSchema.parse(await call({ role: "blueprint", prompt: filePlanPrompt(spec, tokens, tree, "react-tailwind") }));
        project = generatedProjectSchema.parse(await call({ role: "code", allowedFilePaths: plan.files.map(f => f.path), imageDataUrl: referenceDataUrl, stream: true, prompt: generationPrompt(spec, plan, "react-tailwind", item.viewport) }));
      }
      let best: Awaited<ReturnType<typeof renderAndCompare>> | undefined;
      let selectedPass: number | undefined;
      let findings: unknown;
      phase = "validation";
      for (let pass = 0; pass <= (lane === "repair" ? 2 : 0); pass++) {
        phase = "validation";
        await writeFile(path.join(out, `${item.id}-${repeat}-candidate-${pass}.json`), JSON.stringify({ project, plan }, null, 2));
        try {
          const validation = validateGeneratedProject(project, plan);
          if (validation.buildFindings.length) throw new Error(JSON.stringify(validation.buildFindings));
          const rendered = await renderAndCompare({ files: project.files, plan, referenceDataUrl, viewport: item.viewport, visualSpec: item.truth });
          await writeFile(path.join(out, `${item.id}-${repeat}-capture-${pass}.png`), rendered.screenshot);
          await writeFile(path.join(out, `${item.id}-${repeat}-diff-${pass}.png`), rendered.diff);
          await writeFile(path.join(out, `${item.id}-${repeat}-evaluation-${pass}.json`), JSON.stringify({ metrics: rendered.metrics, visual: rendered.visualFindings, accessibility: rendered.a11yFindings }, null, 2));
          if (pass === 0) row.firstBuildPassed = true;
          const passed = !rendered.metrics.horizontalOverflow && !rendered.a11yFindings.some(f => ["critical", "serious"].includes(f.severity)) && !rendered.visualFindings.some(f => f.severity === "critical");
          if (passed && (!best || rendered.visualScore >= best.visualScore)) { best = rendered; selectedPass = pass; }
          findings = { visual: rendered.visualFindings, accessibility: rendered.a11yFindings };
          if (passed && rendered.visualFindings.length === 0) break;
        } catch (error) { findings = { build: safeError(error) }; }
        await writeFile(path.join(out, `${item.id}-${repeat}-findings-${pass}.json`), JSON.stringify(findings, null, 2));
        if (pass < (lane === "repair" ? 2 : 0)) {
          try {
            const mode = findings && typeof findings === "object" && "build" in findings ? "build" : "visual";
            const patch = patchSetSchema.parse(await call({ role: "repair", allowedFilePaths: project.files.map(f => f.path), imageDataUrl: mode === "visual" ? referenceDataUrl : undefined, prompt: repairPrompt({ mode, filePlan: plan, files: project.files, findings, viewport: item.viewport, refinementPass: pass + 1 }) }));
            const replacements = new Map(patch.files.map(f => [f.path, f]));
            if (replacements.size !== patch.files.length || [...replacements.keys()].some(p => !project.files.some(f => f.path === p))) throw new Error("Invalid repair scope");
            project = { ...project, files: project.files.map(f => replacements.get(f.path) ?? f) }; row.repairPasses++;
          } catch (error) {
            if (!best) throw error;
            // A failed optional improvement cannot invalidate a gate-passing result.
            await writeFile(path.join(out, `${item.id}-${repeat}-refinement-warning.json`), JSON.stringify({ stage: phase, error: safeError(error), retainedPass: selectedPass }, null, 2));
            break;
          }
        }
      }
      if (!best) throw new Error("No candidate passed the deterministic gates");
      await writeFile(path.join(out, `${item.id}-${repeat}-selected.json`), JSON.stringify({ pass: selectedPass, candidate: `${item.id}-${repeat}-candidate-${selectedPass}.json` }, null, 2));
      row.completed = true; row.pixelAgreement = best.visualScore; row.overflow = best.metrics.horizontalOverflow;
      const regions = best.metrics.regions ?? [];
      const avg = (values: (number | undefined)[]) => { const n = values.filter((v): v is number => v !== undefined); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : undefined; };
      row.geometry = avg(regions.map(r => r.geometryScore)); row.textCoverage = avg(regions.map(r => r.textCoverage)); row.seriousA11y = best.a11yFindings.filter(f => ["critical", "serious"].includes(f.severity)).length;
      await writeFile(path.join(out, `${item.id}-${repeat}.png`), best.screenshot);
      await writeFile(path.join(out, `${item.id}-${repeat}.diff.png`), best.diff);
    } catch (error) { row.failureCategory = phase; row.failureMessage = safeError(error); }
    row.durationMs = performance.now() - started; results.push(row);
    await writeFile(path.join(out, "results.json"), JSON.stringify(results, null, 2));
    console.log(`${item.id} / ${lane}: ${row.completed ? "validated" : "failed (" + row.failureCategory + ")"}`);
  });
}
const summary = summarize(results);
await writeFile(path.join(out, "summary.json"), JSON.stringify(summary, null, 2));
await writeFile(path.join(out, "REPORT.md"), `# Benchmark ${runId}\n\nLane: ${lane}. ${lane === "self-test" ? "ORACLE INFRASTRUCTURE CHECK; NOT AI QUALITY." : "Live OpenRouter run."}\n\nSynthetic references only; ${summary.independentGroups} independent template groups. Failed attempts remain in the completion denominator. Pixel/geometry/text means are conditional on measured outputs and include coverage counts in summary.json. Group-bootstrap intervals with few groups are unstable. No human study has been run.\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n`);
console.log(`Report: ${out}`);
if (lane === "self-test" && results.some(result => !result.completed)) process.exitCode = 1;
