import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { LocalProjectStore } from "../src/server/repository";
import { jobContext } from "../src/server/job-context";
import { compareImages } from "../src/server/visual-comparison";
import { isVerifiedFree, normalizeModel, eligibleModels, readCompletion } from "../src/server/openrouter";
import { scaffoldProject } from "../src/server/scaffold";
import { fixturePlan, fixtureFiles } from "./support/fixture";
import { isPublicIp } from "../src/server/public-image";

test("remote image destinations reject private, mapped, reserved and metadata addresses", () => {
  for (const ip of ["127.0.0.1", "10.2.3.4", "169.254.169.254", "100.64.0.1", "192.168.1.1", "198.18.0.1", "::1", "::ffff:127.0.0.1", "fe80::1", "2001:db8::1"]) assert.equal(isPublicIp(ip), false, ip);
  assert.equal(isPublicIp("1.1.1.1"), true);
  assert.equal(isPublicIp("2606:4700:4700::1111"), true);
});

test("price checks fail closed for missing, paid and ancillary prices", () => {
  assert.equal(isVerifiedFree({ id: "fake:free" }), false);
  assert.equal(isVerifiedFree({ id: "fake:free", pricing: { prompt: "", completion: "" } }), false);
  assert.equal(isVerifiedFree({ id: "fake:free", pricing: { prompt: "1", completion: "0" } }), false);
  assert.equal(isVerifiedFree({ id: "free", pricing: { prompt: "0", completion: "0", request: "0.1" } }), false);
  assert.equal(isVerifiedFree({ id: "free", pricing: { prompt: "0", completion: "0" } }), true);
});

test("routing respects vision, context and explicit current prices", () => {
  const base = { pricing: { prompt: "0", completion: "0" }, context_length: 32_000, architecture: { input_modalities: ["text"], output_modalities: ["text"] } };
  const text = normalizeModel({ ...base, id: "nvidia/nemotron:free" });
  const vision = normalizeModel({ ...base, id: "google/gemma:free", architecture: { ...base.architecture, input_modalities: ["text", "image"] } });
  assert.equal(eligibleModels([text, vision], "vision", 10_000, text.id)[0].id, vision.id);
  assert.equal(eligibleModels([text, vision], "code", 40_000).length, 0);
});

test("SSE decoder handles chunk boundaries, final unterminated line and actual model", async () => {
  const encoder = new TextEncoder();
  const chunks = ['data: {"model":"actual/model","choices":[{"delta":{"content":"{\\"ok\\":"}}]}\n', 'data: {"choices":[{"delta":{"content":"true}"}}]}'];
  const response = new Response(new ReadableStream({ start(controller) { chunks.forEach(c => { controller.enqueue(encoder.encode(c.slice(0, 17))); controller.enqueue(encoder.encode(c.slice(17))); }); controller.close(); } }));
  assert.deepEqual(await readCompletion(response, true), { modelId: "actual/model", text: '{"ok":true}' });
  await assert.rejects(readCompletion(new Response('data: {"error":{"code":503}}\n'), true), /503/);
});

test("durable queue deduplicates, authorizes, recovers a lease and fences the stale worker", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ss2-queue-test-"));
  const a = new LocalProjectStore(dir), b = new LocalProjectStore(dir);
  try {
    await a.createAsset({ projectId: "project", ownerId: "owner", name: "video", kind: "video", mimeType: "video/mp4", bytes: 1, bytesData: Buffer.from("x") });
    const input = { kind: "generation" as const, ownerId: "owner", data: { assetId: "asset" } };
    const first = await a.createJob("project", "owner", input, "same-key");
    const replay = await b.createJob("project", "owner", input, "same-key");
    assert.equal(first.id, replay.id);
    await assert.rejects(b.createJob("project", "owner", { ...input, data: {} }, "same-key"), /different input/);
    await assert.rejects(b.getJob(first.id, "intruder"), /denied/);
    const lease = await a.claim(); assert.ok(lease);
    assert.equal(await b.claim(), undefined);
    await jobContext.run({ jobId: first.id, lease: lease.lease, signal: new AbortController().signal }, () => a.checkpoint("stage", { valid: true }));
    const originalNow = Date.now;
    let recovered: Awaited<ReturnType<typeof b.claim>>;
    try { Date.now = () => originalNow() + 31_000; recovered = await b.claim(); } finally { Date.now = originalNow; }
    assert.ok(recovered); assert.notEqual(recovered.lease, lease.lease);
    await assert.rejects(jobContext.run({ jobId: first.id, lease: lease.lease, signal: new AbortController().signal }, () => a.updateJob(first.id, { phase: "ready" })), /lease/);
    await jobContext.run({ jobId: first.id, lease: recovered.lease, signal: new AbortController().signal }, async () => assert.deepEqual(await b.checkpoint("stage"), { valid: true }));
    await b.updateJob(first.id, { cancelledAt: new Date().toISOString() });
    assert.equal(await a.heartbeat(first.id, recovered.lease), false);
    await assert.rejects(b.updateJob(first.id, { phase: "ready" }), /CANCELLED/);
  } finally { a.close(); b.close(); await rm(dir, { recursive: true, force: true }); }
});

test("regional comparison detects localized differences and rejects stretched references", () => {
  const a = new PNG({ width: 20, height: 10 }); a.data.fill(255);
  const b = PNG.sync.read(PNG.sync.write(a));
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) { const i = (y * 20 + x) * 4; b.data[i] = 0; b.data[i + 1] = 0; b.data[i + 2] = 0; }
  const result = compareImages(PNG.sync.write(a), PNG.sync.write(b), [{ id: "left", region: "Left", boundsPct: [0, 0, 50, 100], description: "", importance: "high" }, { id: "right", region: "Right", boundsPct: [50, 0, 50, 100], description: "", importance: "normal" }]);
  assert.equal(result.regions[0].pixelScore, 0); assert.equal(result.regions[1].pixelScore, 1);
  assert.throws(() => compareImages(PNG.sync.write(a), PNG.sync.write(new PNG({ width: 10, height: 10 }))), /dimensions/);
});

test("exports contain a complete pinned scaffold and reject configuration injection", () => {
  const files = scaffoldProject(fixtureFiles, fixturePlan);
  const manifest = JSON.parse(files.find(f => f.path === "package.json")!.content);
  assert.ok(manifest.scripts.dev); assert.ok(manifest.scripts.build);
  assert.match(manifest.dependencies.react, /^\d+\.\d+\.\d+/);
  assert.ok(files.some(f => f.path === "scripts/serve.mjs"));
  assert.throws(() => scaffoldProject([...fixtureFiles, { path: "package.json", content: "{}" }], fixturePlan), /scaffold/);
});
