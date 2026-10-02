import assert from "node:assert/strict";
import test from "node:test";
import { getLiveModelCatalog, structuredOpenRouterCall } from "../src/server/openrouter";

test("OpenRouter retries a transient failure via a free fallback and records the response model", async () => {
  const original = globalThis.fetch, key = process.env.OPENROUTER_API_KEY;
  const routes: string[] = [];
  process.env.OPENROUTER_API_KEY = "test-only-not-a-real-key";
  globalThis.fetch = (async (url, options) => {
    assert.ok(String(url).startsWith("https://openrouter.ai/api/v1/"));
    if (String(url).endsWith("/models")) return Response.json({ data: ["openrouter/free", "google/gemma-test:free"].map(id => ({ id, pricing: { prompt: "0", completion: "0" }, context_length: 128_000, supported_parameters: ["temperature", "response_format"], architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } })) });
    const body = JSON.parse(String(options?.body));
    assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0 });
    assert.match(body.messages[1].content[0].text, /Exact JSON schema/);
    routes.push(body.model);
    if (routes.length === 1) return new Response("", { status: 429, headers: { "Retry-After": "0" } });
    return Response.json({ model: "google/gemma-resolved:free", choices: [{ message: { content: JSON.stringify({ kind: "image", readiness: "ready", likelyRole: "primary", nextAction: "Inspect", safeNotes: [] }) } }] });
  }) as typeof fetch;
  try {
    await getLiveModelCatalog(true);
    const result = await structuredOpenRouterCall({ role: "vision", prompt: "ROLE: REFERENCE_CLASSIFIER\nInspect the image." });
    assert.deepEqual(routes, ["google/gemma-test:free", "openrouter/free"]);
    assert.equal(result.modelId, "google/gemma-resolved:free");
  } finally { globalThis.fetch = original; if (key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = key; }
});

test("schema failure has one bounded format retry; authentication failure is not retried", async () => {
  const original = globalThis.fetch, key = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-only-not-a-real-key";
  let calls = 0, unauthorized = false;
  globalThis.fetch = (async url => {
    if (String(url).endsWith("/models")) return Response.json({ data: [{ id: "test/free", pricing: { prompt: "0", completion: "0" }, context_length: 128_000, architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } }] });
    calls++;
    return unauthorized ? new Response("", { status: 401 }) : Response.json({ model: "test/free", choices: [{ message: { content: '{"unexpected":"field"}' } }] });
  }) as typeof fetch;
  try {
    await getLiveModelCatalog(true);
    await assert.rejects(structuredOpenRouterCall({ role: "vision", prompt: "ROLE: REFERENCE_CLASSIFIER\nInspect." }), /schema after one format retry/);
    assert.equal(calls, 2);
    calls = 0; unauthorized = true;
    await assert.rejects(structuredOpenRouterCall({ role: "vision", prompt: "ROLE: REFERENCE_CLASSIFIER\nInspect." }), /401/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; if (key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = key; }
});
