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

test("native schema and advertised reasoning controls survive a format retry followed by free fallback", async () => {
  const original = globalThis.fetch, key = process.env.OPENROUTER_API_KEY, retries = process.env.MAX_MODEL_RETRIES;
  process.env.OPENROUTER_API_KEY = "test-only-not-a-real-key"; process.env.MAX_MODEL_RETRIES = "1";
  const requests: Record<string, unknown>[] = [];
  const value = { kind: "image", readiness: "ready", likelyRole: "primary", nextAction: "Inspect", safeNotes: [] };
  globalThis.fetch = (async (url, options) => {
    if (String(url).endsWith("/models")) return Response.json({ data: [
      { id: "test/native-reasoning:free", supported_parameters: ["structured_outputs", "reasoning"], reasoning: { mandatory: true, supports_max_tokens: true } },
      { id: "test/json-fallback:free", supported_parameters: ["response_format"] },
    ].map(model => ({ ...model, pricing: { prompt: "0", completion: "0" }, context_length: 128000, architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } })) });
    const body = JSON.parse(String(options?.body)); requests.push(body);
    if (requests.length === 1) return Response.json({ model: body.model, choices: [{ message: { content: '{"bad":"schema"}' } }] });
    if (requests.length === 2) return new Response("", { status: 429 });
    return Response.json({ model: body.model, choices: [{ message: { content: JSON.stringify(value) } }] });
  }) as typeof fetch;
  try {
    await getLiveModelCatalog(true);
    const result = await structuredOpenRouterCall({ role: "vision", prompt: "ROLE: REFERENCE_CLASSIFIER\nInspect." });
    assert.deepEqual(result.value, value);
    assert.deepEqual(requests.map(request => request.model), ["test/native-reasoning:free", "test/native-reasoning:free", "test/json-fallback:free"]);
    const first = requests[0] as { response_format: { type: string; json_schema: { name: string; schema: { type: string } } }; reasoning: unknown; provider: { require_parameters: boolean; max_price: unknown } };
    assert.equal(first.response_format.type, "json_schema"); assert.equal(first.response_format.json_schema.name, "REFERENCE_CLASSIFIER");
    assert.equal(first.response_format.json_schema.schema.type, "object");
    assert.deepEqual(first.reasoning, { exclude: true, max_tokens: 1024 });
    assert.equal(first.provider.require_parameters, true); assert.deepEqual(first.provider.max_price, { prompt: 0, completion: 0 });
    assert.deepEqual(requests[2].response_format, { type: "json_object" }); assert.equal("reasoning" in requests[2], false);
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = key;
    if (retries === undefined) delete process.env.MAX_MODEL_RETRIES; else process.env.MAX_MODEL_RETRIES = retries;
  }
});
