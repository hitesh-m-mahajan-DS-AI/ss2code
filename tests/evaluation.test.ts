import assert from "node:assert/strict";
import test from "node:test";
import { summarize, datasetSchema, type BenchmarkResult } from "../src/evaluation/contracts";
import { fixtureFiles, fixturePlan, fixtureSpec } from "./support/fixture";
import { readCompletion, eligibleModels, normalizeModel } from "../src/server/openrouter";

test("benchmark split validation rejects template leakage", () => {
  const item = { id: "a", group: "same-template", category: "dashboard", split: "development", origin: "project-authored-synthetic", reference: "a.png", sha256: "a".repeat(64), viewport: fixtureSpec.reference.viewport, truth: fixtureSpec, oracleFiles: fixtureFiles, oraclePlan: fixturePlan };
  assert.equal(datasetSchema.safeParse({ version: "pilot-1", createdAt: "today", cases: [item, { ...item, id: "b", split: "holdout" }] }).success, false);
});

test("benchmark reports retain failures and separate missing measurements", () => {
  const row: BenchmarkResult = { id: "a", group: "a", category: "dashboard", lane: "direct", repeat: 0, traceId: "a", completed: true, firstBuildPassed: true, durationMs: 100, modelIds: [], repairPasses: 0, pixelAgreement: .8 };
  const summary = summarize([row, { ...row, id: "b", group: "b", completed: false, firstBuildPassed: false, pixelAgreement: undefined, failureCategory: "generation" }]);
  assert.equal(summary.completionRate, .5); assert.deepEqual(summary.pixelAgreement, { value: .8, measured: 1, total: 2 });
  assert.equal(summary.failures.generation, 1); assert.ok(summary.completion95Interval);
});

test("provider usage is captured from a final SSE accounting chunk", async () => {
  const result = await readCompletion(new Response('data: {"model":"test/free","choices":[{"delta":{"content":"{}"}}]}\n\ndata: {"usage":{"prompt_tokens":12,"completion_tokens":2,"total_tokens":14,"cost":0}}\n\ndata: [DONE]\n'), true);
  assert.deepEqual(result.usage, { promptTokens: 12, completionTokens: 2, totalTokens: 14, costCredits: 0 });
});

test("routing excludes specialist classifiers and prefers suitable named free families", () => {
  const model = (id: string) => normalizeModel({ id, context_length: 100000, architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] }, pricing: { prompt: "0", completion: "0" } });
  const candidates = eligibleModels([model("openrouter/free"), model("nvidia/nemotron-3.5-content-safety:free"), model("meta/llama-guard-4:free"), model("google/gemma-4:free")], "vision", 4000);
  assert.deepEqual(candidates.map(item => item.id), ["google/gemma-4:free", "openrouter/free"]);
});
