import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { appendModelAttempt, getLiveModelCatalog, modelAuditAttempt, structuredOpenRouterCall } from "../src/server/openrouter";
import { jobContext } from "../src/server/job-context";
import { LocalProjectStore } from "../src/server/repository";

test("failed provider attempts are persisted to the active job without raw errors", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ss2-provider-audit-"));
  const attemptStore = new LocalProjectStore(directory);
  try {
    await attemptStore.createAsset({ projectId: "project", ownerId: "owner", name: "fixture", kind: "asset_archive", mimeType: "application/octet-stream", bytes: 1, bytesData: Buffer.from("x") });
    const job = await attemptStore.createJob("project", "owner", { kind: "generation", ownerId: "owner", data: {} });
    const lease = await attemptStore.claim();
    assert.ok(lease);
    await jobContext.run({ jobId: job.id, lease: lease.lease, signal: new AbortController().signal }, async () => {
      await attemptStore.checkpoint("ownerId", "owner");
      await appendModelAttempt({ role: "code" }, { id: "google/gemma-example:free", family: "gemma", inputModalities: ["image"], outputModalities: ["text"], isFreeCandidate: true }, { durationMs: 90001, attempt: 1, outcome: "error", errorCode: "HTTP_429" }, attemptStore);
    });
    const saved = await attemptStore.getJob(job.id, "owner");
    assert.equal(saved.modelAudit?.[0]?.outcome, "error");
    assert.equal(saved.modelAudit?.[0]?.errorCode, "HTTP_429");
    assert.equal(saved.modelAudit?.[0]?.routedModelId, "google/gemma-example:free");
    assert.equal("rawError" in (saved.modelAudit?.[0] ?? {}), false);
  } finally { attemptStore.close(); await rm(directory, { recursive: true, force: true }); }
});

test("provider attempt audit retains failed routes using safe outcome codes only", () => {
  const candidate = { id: "google/gemma-example:free", family: "gemma", inputModalities: ["image"], outputModalities: ["text"], isFreeCandidate: true };
  const audit = modelAuditAttempt({ role: "code" }, candidate, { durationMs: 90_001, attempt: 4, outcome: "error", errorCode: "TIMEOUT" });
  assert.equal(audit.routedModelId, "google/gemma-example:free");
  assert.equal(audit.resolvedModelId, "google/gemma-example:free");
  assert.equal(audit.outcome, "error");
  assert.equal(audit.errorCode, "TIMEOUT");
  assert.equal(audit.attempts, 1);
  assert.equal(audit.attemptNumber, 4);
  assert.equal("rawError" in audit, false);
});

test("plan-bound generation rejects duplicate files before build and gives one field-level format retry", async () => {
  const original = globalThis.fetch, key = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-only-not-a-real-key";
  const paths = ["src/App.tsx", "src/Header.tsx"], requests: string[] = [];
  const project = { summary: "Test", files: paths.map(path => ({ path, content: "export default function App(){return <main/>}" })), interactionNotes: [], assumptionsApplied: [] };
  globalThis.fetch = (async (url, options) => {
    if (String(url).endsWith("/models")) return Response.json({ data: [{ id: "test/scoped-code:free", pricing: { prompt: "0", completion: "0" }, context_length: 128000, supported_parameters: ["structured_outputs"], architecture: { input_modalities: ["text"], output_modalities: ["text"] } }] });
    const body = JSON.parse(String(options?.body));
    assert.equal(body.max_tokens, 16000);
    assert.match(JSON.stringify(body.response_format), /"enum":\["src\/App.tsx","src\/Header.tsx"\]/);
    requests.push(body.messages[1].content[0].text);
    const value = requests.length === 1 ? { ...project, files: [project.files[0], project.files[0]] } : project;
    return Response.json({ model: body.model, choices: [{ message: { content: JSON.stringify(value) } }] });
  }) as typeof fetch;
  try {
    await getLiveModelCatalog(true);
    const result = await structuredOpenRouterCall({ role: "code", prompt: "ROLE: GENERATE\nImplement the approved plan.", allowedFilePaths: paths });
    assert.deepEqual(result.value, project);
    assert.equal(requests.length, 2);
    assert.match(requests[1], /Contract failures: files.1.path: custom/);
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = key;
  }
});

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

test("generation reserves a final zero-price OpenRouter free-router attempt after named vision routes fail", async () => {
  const original = globalThis.fetch, key = process.env.OPENROUTER_API_KEY, retries = process.env.MAX_MODEL_RETRIES, preferred = process.env.MODEL_PREFERRED_FAMILIES;
  process.env.OPENROUTER_API_KEY = "test-only-not-a-real-key";
  process.env.MAX_MODEL_RETRIES = "3";
  process.env.MODEL_PREFERRED_FAMILIES = "nemotron,gemma";
  const routes: string[] = [];
  const files = [{ path: "src/App.tsx", content: "export default function App(){return <main/>}" }];
  const project = { summary: "Test", files, interactionNotes: [], assumptionsApplied: [] };
  const catalog = [
    "nvidia/nemotron-vision-test:free",
    "google/gemma-vision-test:free",
    "dots-studio/dots-vision-test:free",
    "thinkingmachines/inkling-small:free",
    "openrouter/free",
  ].map(id => ({ id, pricing: { prompt: "0", completion: "0" }, context_length: 128_000, supported_parameters: ["response_format"], architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } }));
  globalThis.fetch = (async (url, options) => {
    if (String(url).endsWith("/models")) return Response.json({ data: catalog });
    const body = JSON.parse(String(options?.body)) as { model: string; provider: { max_price: unknown } };
    assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0 });
    routes.push(body.model);
    if (body.model !== "openrouter/free") return new Response("", { status: 503 });
    return Response.json({ model: "thinkingmachines/inkling-small:free", choices: [{ message: { content: JSON.stringify(project) } }] });
  }) as typeof fetch;
  try {
    await getLiveModelCatalog(true);
    const result = await structuredOpenRouterCall({ role: "code", imageDataUrl: "data:image/png;base64,aGVsbG8=", prompt: "ROLE: GENERATE\nCreate the approved page.", allowedFilePaths: ["src/App.tsx"] });
    assert.deepEqual(result.value, project);
    assert.equal(routes.length, 4);
    assert.equal(routes.at(-1), "openrouter/free");
    assert.ok(routes.slice(0, -1).every(model => model !== "openrouter/free"));
    assert.equal(result.modelId, "thinkingmachines/inkling-small:free");
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = key;
    if (retries === undefined) delete process.env.MAX_MODEL_RETRIES; else process.env.MAX_MODEL_RETRIES = retries;
    if (preferred === undefined) delete process.env.MODEL_PREFERRED_FAMILIES; else process.env.MODEL_PREFERRED_FAMILIES = preferred;
  }
});

test("a provider route rejection falls through to another verified-free model without repeating the rejected route", async () => {
  const original = globalThis.fetch, key = process.env.OPENROUTER_API_KEY, retries = process.env.MAX_MODEL_RETRIES, preferred = process.env.MODEL_PREFERRED_FAMILIES;
  process.env.OPENROUTER_API_KEY = "test-only-not-a-real-key";
  process.env.MAX_MODEL_RETRIES = "1";
  process.env.MODEL_PREFERRED_FAMILIES = "gemma,nemotron";
  const routes: string[] = [];
  const value = { kind: "image", readiness: "ready", likelyRole: "primary", nextAction: "Inspect", safeNotes: [] };
  globalThis.fetch = (async (url, options) => {
    if (String(url).endsWith("/models")) return Response.json({ data: ["google/gemma-route-rejected:free", "nvidia/nemotron-route-fallback:free", "openrouter/free"].map(id => ({ id, pricing: { prompt: "0", completion: "0" }, context_length: 128_000, supported_parameters: ["response_format"], architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } })) });
    const body = JSON.parse(String(options?.body)) as { model: string };
    routes.push(body.model);
    if (routes.length === 1) return new Response("", { status: 400 });
    return Response.json({ model: body.model, choices: [{ message: { content: JSON.stringify(value) } }] });
  }) as typeof fetch;
  try {
    await getLiveModelCatalog(true);
    const result = await structuredOpenRouterCall({ role: "vision", prompt: "ROLE: REFERENCE_CLASSIFIER\nInspect the image." });
    assert.deepEqual(result.value, value);
    assert.deepEqual(routes, ["google/gemma-route-rejected:free", "nvidia/nemotron-route-fallback:free"]);
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = key;
    if (retries === undefined) delete process.env.MAX_MODEL_RETRIES; else process.env.MAX_MODEL_RETRIES = retries;
    if (preferred === undefined) delete process.env.MODEL_PREFERRED_FAMILIES; else process.env.MODEL_PREFERRED_FAMILIES = preferred;
  }
});

test("HTTP 429 immediately cools down that free route so later stages use a fallback", async () => {
  const original = globalThis.fetch, key = process.env.OPENROUTER_API_KEY, retries = process.env.MAX_MODEL_RETRIES, preferred = process.env.MODEL_PREFERRED_FAMILIES;
  process.env.OPENROUTER_API_KEY = "test-only-not-a-real-key"; process.env.MAX_MODEL_RETRIES = "1"; process.env.MODEL_PREFERRED_FAMILIES = "gemma,nemotron";
  const requests: string[] = [];
  const value = { kind: "image", readiness: "ready", likelyRole: "primary", nextAction: "Inspect", safeNotes: [] };
  globalThis.fetch = (async (url, options) => {
    if (String(url).endsWith("/models")) return Response.json({ data: ["google/gemma-cooldown-test:free", "nvidia/nemotron-fallback-test:free"].map(id => ({ id, pricing: { prompt: "0", completion: "0" }, context_length: 128000, architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } })) });
    const body = JSON.parse(String(options?.body)) as { model: string };
    requests.push(body.model);
    if (body.model.includes("gemma")) return new Response("", { status: 429 });
    return Response.json({ model: body.model, choices: [{ message: { content: JSON.stringify(value) } }] });
  }) as typeof fetch;
  try {
    await getLiveModelCatalog(true);
    const first = await structuredOpenRouterCall({ role: "vision", prompt: "ROLE: REFERENCE_CLASSIFIER\nInspect the first stage." });
    const nextStage = await structuredOpenRouterCall({ role: "vision", prompt: "ROLE: REFERENCE_CLASSIFIER\nInspect the next stage." });
    assert.deepEqual(first.value, value); assert.deepEqual(nextStage.value, value);
    assert.deepEqual(requests, ["google/gemma-cooldown-test:free", "nvidia/nemotron-fallback-test:free", "nvidia/nemotron-fallback-test:free"]);
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = key;
    if (retries === undefined) delete process.env.MAX_MODEL_RETRIES; else process.env.MAX_MODEL_RETRIES = retries;
    if (preferred === undefined) delete process.env.MODEL_PREFERRED_FAMILIES; else process.env.MODEL_PREFERRED_FAMILIES = preferred;
  }
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

test("a route that fails its one schema retry falls through to another verified-free model", async () => {
  const original = globalThis.fetch, key = process.env.OPENROUTER_API_KEY, retries = process.env.MAX_MODEL_RETRIES, preferred = process.env.MODEL_PREFERRED_FAMILIES;
  process.env.OPENROUTER_API_KEY = "test-only-not-a-real-key";
  process.env.MAX_MODEL_RETRIES = "1";
  process.env.MODEL_PREFERRED_FAMILIES = "gemma,nemotron";
  const routes: string[] = [];
  const value = { kind: "image", readiness: "ready", likelyRole: "primary", nextAction: "Inspect", safeNotes: [] };
  globalThis.fetch = (async (url, options) => {
    if (String(url).endsWith("/models")) return Response.json({ data: ["google/gemma-schema-test:free", "nvidia/nemotron-schema-fallback:free", "openrouter/free"].map(id => ({ id, pricing: { prompt: "0", completion: "0" }, context_length: 128_000, supported_parameters: ["response_format"], architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } })) });
    const body = JSON.parse(String(options?.body)) as { model: string };
    routes.push(body.model);
    if (body.model === "google/gemma-schema-test:free") return Response.json({ model: body.model, choices: [{ message: { content: '{"unexpected":"field"}' } }] });
    return Response.json({ model: body.model, choices: [{ message: { content: JSON.stringify(value) } }] });
  }) as typeof fetch;
  try {
    await getLiveModelCatalog(true);
    const result = await structuredOpenRouterCall({ role: "vision", prompt: "ROLE: REFERENCE_CLASSIFIER\nInspect." });
    assert.deepEqual(result.value, value);
    assert.deepEqual(routes, ["google/gemma-schema-test:free", "google/gemma-schema-test:free", "nvidia/nemotron-schema-fallback:free"]);
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = key;
    if (retries === undefined) delete process.env.MAX_MODEL_RETRIES; else process.env.MAX_MODEL_RETRIES = retries;
    if (preferred === undefined) delete process.env.MODEL_PREFERRED_FAMILIES; else process.env.MODEL_PREFERRED_FAMILIES = preferred;
  }
});

test("a truncated structured response fails over to a different verified-free route without repeating the request", async () => {
  const original = globalThis.fetch, key = process.env.OPENROUTER_API_KEY, preferred = process.env.MODEL_PREFERRED_FAMILIES;
  process.env.OPENROUTER_API_KEY = "test-only-not-a-real-key";
  process.env.MODEL_PREFERRED_FAMILIES = "gemma,nemotron";
  const routes: string[] = [];
  const value = { kind: "image", readiness: "ready", likelyRole: "primary", nextAction: "Inspect", safeNotes: [] };
  globalThis.fetch = (async (url, options) => {
    if (String(url).endsWith("/models")) return Response.json({ data: [
      "google/gemma-truncated-test:free",
      "nvidia/nemotron-truncation-fallback:free",
      "openrouter/free",
    ].map(id => ({ id, pricing: { prompt: "0", completion: "0" }, context_length: 128_000, supported_parameters: ["response_format"], architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } })) });
    const body = JSON.parse(String(options?.body)) as { model: string; provider: { max_price: unknown } };
    assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0 });
    routes.push(body.model);
    if (routes.length === 1) return Response.json({ model: body.model, choices: [{ message: { content: "{\"kind\":\"image\"", }, finish_reason: "length" }] });
    return Response.json({ model: body.model, choices: [{ message: { content: JSON.stringify(value) } }] });
  }) as typeof fetch;
  try {
    await getLiveModelCatalog(true);
    const result = await structuredOpenRouterCall({ role: "vision", requestedModelId: "google/gemma-truncated-test:free", prompt: "ROLE: REFERENCE_CLASSIFIER\nInspect the uploaded reference." });
    assert.deepEqual(result.value, value);
    assert.deepEqual(routes, ["google/gemma-truncated-test:free", "nvidia/nemotron-truncation-fallback:free"]);
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = key;
    if (preferred === undefined) delete process.env.MODEL_PREFERRED_FAMILIES; else process.env.MODEL_PREFERRED_FAMILIES = preferred;
  }
});

test("when no free route completes a structured response, truncation reports the actual workflow stage", async () => {
  const original = globalThis.fetch, key = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-only-not-a-real-key";
  let calls = 0;
  globalThis.fetch = (async (url, options) => {
    if (String(url).endsWith("/models")) return Response.json({ data: [{ id: "test/only-truncated:free", pricing: { prompt: "0", completion: "0" }, context_length: 128_000, supported_parameters: ["response_format"], architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } }] });
    calls++;
    const body = JSON.parse(String(options?.body)) as { model: string };
    return Response.json({ model: body.model, choices: [{ message: { content: "{", }, finish_reason: "length" }] });
  }) as typeof fetch;
  try {
    await getLiveModelCatalog(true);
    await assert.rejects(
      structuredOpenRouterCall({ role: "vision", prompt: "ROLE: REFERENCE_CLASSIFIER\nInspect the uploaded reference." }),
      /reference inspection.*No partial result was accepted/i,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = key;
  }
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
