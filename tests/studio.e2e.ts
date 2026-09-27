import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { unzipSync } from "fflate";
import { LocalProjectStore } from "../src/server/repository";
import { renderAndCompare } from "../src/server/sandbox";
import { fixtureFiles, fixturePlan, fixtureSpec, fixtureTree, fixtureHtml } from "./support/fixture";

const root = await mkdtemp(path.join(tmpdir(), "ss2-e2e-"));
const db = new LocalProjectStore(path.join(root, "private"));
const ownerId = randomUUID(), projectId = randomUUID(), secret = randomUUID();
const origin = "http://localhost:3100";
const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "development", PRIVATE_STORAGE_ROOT: path.join(root, "private"), SESSION_SECRET: secret, OPENROUTER_API_KEY: "" };
const children: ChildProcess[] = [];
let logs = "";
function launch(args: string[]) {
  const child = spawn(process.execPath, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", data => { logs = (logs + data.toString()).slice(-12_000); });
  child.stderr?.on("data", data => { logs = (logs + data.toString()).slice(-12_000); });
  children.push(child); return child;
}
async function command(args: string[], cwd: string) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("Run this suite through npm run test:e2e.");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [npmCli, ...args], { cwd, windowsHide: true, stdio: "pipe" });
    let output = "";
    child.stdout.on("data", data => { output = (output + data.toString()).slice(-8000); });
    child.stderr.on("data", data => { output = (output + data.toString()).slice(-8000); });
    child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error(output)));
  });
}
const browser = await chromium.launch({ headless: true });
try {
  const capture = await browser.newPage({ viewport: fixtureSpec.reference.viewport });
  await capture.setContent(fixtureHtml);
  const png = await capture.screenshot();
  await capture.close();
  const render = await renderAndCompare({ files: fixtureFiles, plan: fixturePlan, visualSpec: fixtureSpec, referenceDataUrl: "data:image/png;base64," + png.toString("base64"), viewport: fixtureSpec.reference.viewport });
  const asset = await db.createAsset({ ownerId, projectId, name: "Dashboard reference.png", kind: "image", mimeType: "image/png", bytes: png.length, bytesData: png });
  await db.setSpec(projectId, ownerId, fixtureSpec);
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    const job = await db.createJob(projectId, ownerId);
    const revision = await db.createRevision({ jobId: job.id, projectId, parentRevisionId: ids.at(-1), referenceAssetId: asset.id, visualSpec: fixtureSpec, componentTree: fixtureTree, framework: "react-tailwind", files: fixtureFiles, filePlan: fixturePlan, promptVersion: "test-fixture", modelId: "fixture/no-inference", summary: "Deterministic integration fixture", assumptions: [], evaluation: { buildFindings: [], visualFindings: render.visualFindings, a11yFindings: render.a11yFindings, metrics: render.metrics } });
    await db.savePreview(revision.id, render.screenshot); await db.saveArtifact(revision.id, "bundle", render.html); await db.saveArtifact(revision.id, "diff", render.diff);
    await db.updateJob(job.id, { phase: "ready", revisionId: revision.id }); ids.push(revision.id);
  }
  launch(["node_modules/next/dist/bin/next", "dev", "-p", "3100"]);
  launch(["--import", "tsx", "src/workers/jobs.ts"]);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { ready = (await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (ready) break; await delay(1000);
  }
  assert.ok(ready, "Studio did not start.");
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
  const signature = createHmac("sha256", secret).update(ownerId).digest("base64url");
  await context.addCookies([{ name: "ss2_owner", value: ownerId + "." + signature, url: origin, httpOnly: true, sameSite: "Lax" }]);
  await context.addInitScript(id => { if (window === window.top && !localStorage.getItem("ss2-project")) localStorage.setItem("ss2-project", id); }, projectId);
  const page = await context.newPage(), pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(origin);
  await page.getByText("Project restored.", { exact: false }).waitFor();
  const frame = page.frameLocator('iframe[title="Interactive generated interface"]');
  await frame.getByRole("button", { name: "Interactions: 0" }).click();
  assert.equal(await frame.getByRole("button").innerText(), "Interactions: 1");
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await frame.getByRole("heading", { name: "Project overview" }).click();
  await page.getByRole("heading", { name: "Region: page", exact: true }).waitFor();
  await page.getByRole("button", { name: "Lock region", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Unlock region", exact: true }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await page.getByRole("navigation", { name: "Project files" }).getByRole("button", { name: "package.json", exact: true }).click();
  await page.getByRole("button", { name: "Copy file", exact: true }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /reconstructed-interface/);
  await page.getByRole("button", { name: "Undo revision" }).click();
  await page.waitForFunction(() => !(document.querySelector('[aria-label="Redo revision"]') as HTMLButtonElement)?.disabled);
  await page.getByRole("button", { name: "Redo revision" }).click();
  await page.getByRole("button", { name: "History", exact: true }).click();
  assert.equal(await page.getByRole("dialog").locator(".history-list li").count(), 2);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Overlay", exact: true }).click();
  await page.getByRole("slider", { name: "Reference overlay position" }).fill("35");
  await page.getByRole("button", { name: "Diff", exact: true }).click();
  await page.getByAltText("Pixel difference map").waitFor();
  await page.getByRole("button", { name: "Live", exact: true }).click();
  await page.getByLabel("Preview viewport").selectOption("390");
  assert.equal(await page.locator('iframe[title="Interactive generated interface"]').evaluate(node => (node as HTMLIFrameElement).style.width), "390px");
  await page.getByLabel("Preview zoom").selectOption("0.5");
  await page.reload();
  await frame.getByRole("button", { name: "Interactions: 0" }).waitFor();
  assert.equal(await page.locator(".file-tree").count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mkdir(".data/test-reports", { recursive: true });
  await page.screenshot({ path: ".data/test-reports/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.getByLabel("OpenRouter model").isVisible(), true);
  const tooSmall = await page.locator(".studio-shell button:visible").evaluateAll(nodes => nodes.filter(node => { const r = node.getBoundingClientRect(); return r.width < 43.9 || r.height < 43.9; }).map(node => node.textContent || node.getAttribute("aria-label")));
  assert.deepEqual(tooSmall, []);
  await page.screenshot({ path: ".data/test-reports/mobile.png", fullPage: true });
  const exported = await context.request.post(origin + "/api/v1/revisions/" + ids[1] + "/export", { headers: { Origin: origin, "Idempotency-Key": randomUUID() } });
  assert.equal(exported.status(), 200, await exported.text().catch(() => ""));
  const archive = unzipSync(await exported.body());
  assert.ok(archive["package-lock.json"]); assert.ok(archive["scripts/build.mjs"]); assert.ok(!archive[".env"]);
  const exportRoot = path.join(root, "export");
  for (const [name, content] of Object.entries(archive)) { const target = path.join(exportRoot, name); assert.ok(target.startsWith(exportRoot + path.sep)); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content); }
  console.log("Browser recovery, inspector, history, comparison, mobile controls and ZIP export passed. Installing the exported project…");
  await command(["ci", "--ignore-scripts", "--no-audit", "--no-fund"], exportRoot);
  await command(["run", "build"], exportRoot);
  const unauthorized = await browser.newContext();
  assert.equal((await unauthorized.request.get(origin + "/api/v1/revisions/" + ids[1])).status(), 404);
  assert.equal((await context.request.post(origin + "/api/v1/revisions/" + ids[1] + "/export", { headers: { Origin: "https://unrelated.example", "Idempotency-Key": randomUUID() } })).status(), 404);
  const key = randomUUID(), body = { assetId: asset.id, visualSpec: fixtureSpec, targetViewport: fixtureSpec.reference.viewport, framework: "react-tailwind" };
  const request = () => context.request.post(origin + "/api/v1/projects/" + projectId + "/generations", { data: body, headers: { Origin: origin, "Idempotency-Key": key } });
  const initial = await (await request()).json(), replay = await (await request()).json();
  assert.equal(initial.job.id, replay.job.id);
  const stream = await context.request.get(origin + "/api/v1/generations/" + initial.job.id + "/events");
  const events = await stream.text();
  assert.match(events, /event: complete/); assert.match(events, /OPENROUTER_API_KEY/);
  await page.reload();
  await page.getByRole("button", { name: "Build", exact: true }).click();
  await page.getByRole("button", { name: "Retry safely", exact: true }).waitFor();
  await page.getByRole("button", { name: "Reference", exact: true }).click();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "uploaded-reference.png", mimeType: "image/png", buffer: png });
  await page.getByText("Reference accepted.", { exact: false }).waitFor();
  await page.reload();
  await page.getByText("uploaded-reference.png", { exact: true }).waitFor();
  const videoBytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#13213a"; ctx.fillRect(0, 0, 640, 480);
    const recorder = new MediaRecorder(canvas.captureStream(6), { mimeType: "video/webm" });
    const chunks: Blob[] = [];
    const stopped = new Promise<Blob>(resolve => { recorder.ondataavailable = event => chunks.push(event.data); recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" })); });
    recorder.start();
    for (const color of ["#13213a", "#203a61", "#356da8"]) { ctx.fillStyle = color; ctx.fillRect(0, 0, 640, 480); await new Promise(resolve => setTimeout(resolve, 250)); }
    recorder.stop();
    return [...new Uint8Array(await (await stopped).arrayBuffer())];
  });
  await page.locator('input[type="file"]').setInputFiles({ name: "states.webm", mimeType: "video/webm", buffer: Buffer.from(videoBytes) });
  await page.locator(".frame-row button").first().waitFor();
  await page.locator(".frame-row button").first().click();
  await page.getByText("Selected the 0 ms frame", { exact: false }).waitFor();
  assert.equal(await page.locator(".frame-row button").count(), 3);
  await page.locator(".frame-row button").nth(1).click();
  await page.locator(".live-status").filter({ hasText: "Selected the" }).waitFor();
  assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
  console.log("Independent export install/build, ownership, CSRF, idempotent replay, failure recovery, upload persistence and video frame selection passed.");
} catch (error) {
  console.error(logs); throw error;
} finally {
  await browser.close();
  for (const child of children) {
    if (process.platform === "win32" && child.pid) await new Promise<void>(resolve => { const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" }); killer.on("exit", () => resolve()); killer.on("error", () => resolve()); });
    else child.kill();
  }
  db.close();
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
