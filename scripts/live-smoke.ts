import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type APIRequestContext } from "playwright";
import { unzipSync } from "fflate";
import { datasetSchema, selectCases } from "../src/evaluation/contracts";
import type { GenerationJob, Revision } from "../src/lib/domain";
import { boundedBraceFiles } from "../src/server/scaffold";
import { PROMPT_VERSION } from "../src/lib/prompts";

if (!process.env.OPENROUTER_API_KEY) throw new Error("Live smoke requires a real OpenRouter key; this command does not mock inference.");
if (process.env.SANDBOX_MODE !== "docker") throw new Error("Live smoke requires SANDBOX_MODE=docker and the current renderer image.");
const args = process.argv.slice(2), count = Number(args.includes("--limit") ? args[args.indexOf("--limit") + 1] : 2);
if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error("Use --limit 1–4; live calls consume free-model quotas.");
const manifestBytes = await readFile(".data/benchmarks/pilot/manifest.json"), dataset = datasetSchema.parse(JSON.parse(manifestBytes.toString()));
const selected = selectCases(dataset.cases, "development", count); // Never open the holdout here.
const runId = randomUUID(), root = path.resolve(".data/live-smoke", runId), origin = "http://localhost:3200";
const imageId = execFileSync("docker", ["image", "inspect", process.env.SANDBOX_IMAGE ?? "ss2code-render:local", "--format", "{{.Id}}"], { encoding: "utf8", timeout: 8000, windowsHide: true }).trim();
await mkdir(root, { recursive: true });
try { await fetch(origin, { signal: AbortSignal.timeout(1000) }); throw new Error("Port 3200 is occupied; stop its owner before running live smoke."); }
catch (error) { if (error instanceof Error && error.message.startsWith("Port 3200")) throw error; }
const sourceFiles = ["scripts/live-smoke.ts", "src/server/orchestration.ts", "src/server/openrouter.ts", "src/lib/prompts.ts", "src/lib/schemas.ts", "src/lib/domain.ts", "src/server/quality-gates.ts", "src/server/render-project.ts", "src/server/scaffold.ts", "src/server/validation.ts", "src/server/sandbox.ts", "src/server/visual-comparison.ts", "src/server/repository.ts", "src/server/http.ts", "src/workers/jobs.ts", "src/workers/render.ts", "src/app/api/v1/uploads/initiate/route.ts", "src/app/api/v1/projects/[projectId]/spec/route.ts", "src/app/api/v1/projects/[projectId]/generations/route.ts", "src/app/api/v1/revisions/[revisionId]/export/route.ts", "resources/export/react-tailwind.lock.json", "resources/export/nextjs-tailwind.lock.json", ".npmrc", "package.json", "package-lock.json", "Dockerfile.render", ...boundedBraceFiles.map(file => "vendor/braces/" + file)];
sourceFiles.push("src/components/project-tree.tsx", "src/components/studio.tsx", "src/components/preview-workspace.tsx");
sourceFiles.push("src/server/output-contract.ts", "src/server/reference-classification.ts");
const metadata = { runId, startedAt: new Date().toISOString(), promptVersion: PROMPT_VERSION, datasetHash: createHash("sha256").update(manifestBytes).digest("hex"), sourceHashes: Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash("sha256").update(await readFile(file)).digest("hex")]))), cases: selected.map(c => c.id), sandbox: "docker", environment: { node: process.version, platform: process.platform, rendererImageId: imageId }, routing: { preferredFamilies: process.env.MODEL_PREFERRED_FAMILIES ?? "nemotron,gemma", retries: process.env.MAX_MODEL_RETRIES ?? "3", timeoutMs: process.env.REQUEST_TIMEOUT_MS ?? "90000", maxRefinementIterations: process.env.MAX_REFINEMENT_ITERATIONS ?? "2", pricePolicy: "zero-only" }, limitations: ["Authored development references; not real-user, holdout, or generalization evidence.", "Uses the actual upload/analysis/queue/generation/review/export APIs; no oracle source or truth is sent to inference.", "The model-produced specification is submitted automatically in this test, without human confirmation.", "A ready revision is studio-gate acceptance, not independent visual accuracy; inspect the retained captures and findings."] };
await writeFile(path.join(root, "run.json"), JSON.stringify(metadata, null, 2));
const children: ChildProcess[] = [], results: Record<string, unknown>[] = [];
const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "development", PORT: "3200", PRIVATE_STORAGE_ROOT: path.join(root, "private"), SESSION_SECRET: randomUUID() + randomUUID() };
let safeLogs = "";
const redact = (s: string) => s.replace(/sk-or-v1-[\w-]+/g, "[redacted]").slice(0, 1200);
function launch(args: string[]) {
  const child = spawn(process.execPath, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", data => { safeLogs = (safeLogs + redact(data.toString())).slice(-4000); });
  child.stderr?.on("data", data => { safeLogs = (safeLogs + redact(data.toString())).slice(-4000); });
  child.on("error", error => { safeLogs = (safeLogs + redact(String(error))).slice(-4000); });
  children.push(child);
}
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
async function json(request: APIRequestContext, endpoint: string, data?: unknown) {
  const response = data === undefined ? await request.get(origin + endpoint) : await request.post(origin + endpoint, { data, headers: { Origin: origin, "Idempotency-Key": randomUUID() }, timeout: 450000 });
  const body = await response.json();
  if (!response.ok()) throw new Error(redact(String(body.error ?? "HTTP " + response.status())));
  return body;
}
try {
  launch(["node_modules/next/dist/bin/next", "dev", "-p", "3200", "--hostname", "127.0.0.1"]);
  launch(["--import", "tsx", "src/workers/jobs.ts"]);
  let ready = false;
  for (let i = 0; i < 90; i++) {
    try { ready = (await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (ready) break; await delay(1000);
  }
  if (!ready) throw new Error("Studio startup failed: " + safeLogs);
  browser = await chromium.launch({ headless: true });
  for (const item of selected) {
    const started = Date.now(), context = await browser.newContext(), request = context.request;
    let phase = "upload", jobId: string | undefined;
    const row: Record<string, unknown> = { caseId: item.id, group: item.group, completed: false };
    try {
      const referencePath = path.resolve(".data/benchmarks/pilot", item.reference);
      if (!referencePath.startsWith(path.resolve(".data/benchmarks/pilot") + path.sep)) throw new Error("Reference escaped dataset");
      const bytes = await readFile(referencePath);
      if (createHash("sha256").update(bytes).digest("hex") !== item.sha256) throw new Error("Reference hash mismatch");
      const uploaded = await request.post(origin + "/api/v1/uploads/initiate", { headers: { Origin: origin, "Idempotency-Key": randomUUID() }, multipart: { file: { name: item.id + ".png", mimeType: "image/png", buffer: bytes } } });
      const upload = await uploaded.json(); if (!uploaded.ok()) throw new Error(upload.error);
      phase = "analysis";
      const analysis = await json(request, "/api/v1/projects/" + upload.projectId + "/spec", { assetId: upload.asset.id });
      row.analysisModel = analysis.modelId;
      await writeFile(path.join(root, item.id + "-analysis.json"), JSON.stringify(analysis, null, 2));
      phase = "generation";
      const queued = await json(request, "/api/v1/projects/" + upload.projectId + "/generations", { assetId: upload.asset.id, visualSpec: analysis.spec, targetViewport: item.viewport, framework: "react-tailwind" });
      jobId = queued.job.id;
      const deadline = Date.now() + 15 * 60000;
      let job: GenerationJob = queued.job;
      let lastPhase = job.phase;
      while (!["ready", "failed", "cancelled"].includes(job.phase)) {
        if (Date.now() > deadline) throw new Error("Live smoke job exceeded its 15-minute observation budget");
        await delay(2000); job = (await json(request, "/api/v1/generations/" + jobId)).job;
        if (job.phase !== lastPhase) { console.log(item.id + ": " + job.phase); lastPhase = job.phase; }
      }
      await writeFile(path.join(root, item.id + "-job.json"), JSON.stringify(job, null, 2));
      row.models = [...new Set(job.modelAudit?.map(a => a.resolvedModelId) ?? [])];
      if (job.phase !== "ready" || !job.revisionId) throw new Error(job.error ?? "Job did not produce a ready revision");
      const revision: Revision = (await json(request, "/api/v1/revisions/" + job.revisionId)).revision;
      await writeFile(path.join(root, item.id + "-revision.json"), JSON.stringify(revision, null, 2));
      row.metrics = revision.evaluation.metrics; row.remainingFindings = revision.evaluation.visualFindings;
      phase = "export";
      const exported = await request.post(origin + "/api/v1/revisions/" + revision.id + "/export", { headers: { Origin: origin, "Idempotency-Key": randomUUID() } });
      if (!exported.ok()) throw new Error("Export failed: " + exported.status());
      const zip = await exported.body(), files = unzipSync(zip);
      if (!files["package-lock.json"] || !files["vendor/braces/lib/bounds.js"] || files[".env"] || files[".env.local"]) throw new Error("Export completeness/privacy check failed");
      await writeFile(path.join(root, item.id + ".zip"), zip);
      await context.addInitScript(projectId => localStorage.setItem("ss2-project", projectId), upload.projectId);
      const page = await context.newPage(); await page.goto(origin);
      await page.getByText("Project restored.", { exact: false }).waitFor();
      await page.screenshot({ path: path.join(root, item.id + "-studio.png"), fullPage: true });
      row.completed = true; row.exportBytes = zip.length;
    } catch (error) {
      row.failurePhase = phase; row.error = redact(String(error));
      if (jobId) await request.post(origin + "/api/v1/generations/" + jobId, { headers: { Origin: origin, "Idempotency-Key": randomUUID() } }).catch(() => undefined);
    } finally { row.durationMs = Date.now() - started; results.push(row); await context.close(); await writeFile(path.join(root, "results.json"), JSON.stringify(results, null, 2)); }
    console.log(item.id + ": " + (row.completed ? "ready and exported" : "failed during " + row.failurePhase));
  }
} finally {
  await browser?.close(); for (const child of children) child.kill();
  await writeFile(path.join(root, "summary.json"), JSON.stringify({ attempted: results.length, completed: results.filter(r => r.completed).length, report: root, limitations: metadata.limitations }, null, 2));
}
console.log("Private evidence: " + root);
if (results.length !== selected.length || results.some(r => !r.completed)) process.exitCode = 1;
