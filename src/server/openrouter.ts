import { setTimeout as delay } from "node:timers/promises";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod";
import type { ModelAudit, ModelCandidate, ModelRole } from "@/lib/domain";
import { sharedSystemPrompt as screenshotSystemPrompt } from "@/lib/prompts";
import * as schemas from "@/lib/schemas";
import { jobContext } from "./job-context";
import { store, type LocalProjectStore } from "./repository";
import { recordSpan, type Usage } from "./telemetry";
import { documentEvidenceSchema } from "../lib/document-schema";
import { scopedOutputContract, formatDiagnostics, contractFingerprint } from "./output-contract";
import { PROMPT_VERSION } from "@/lib/prompts";

export type CatalogModel = { id: string; context_length?: number; architecture?: { input_modalities?: string[]; output_modalities?: string[] }; supported_parameters?: string[]; pricing?: Record<string, string | undefined>; reasoning?: { supported_efforts?: string[] | null; supports_max_tokens?: boolean; mandatory?: boolean } };
let catalogCache: { fetchedAt: number; models: ModelCandidate[] } | undefined;
const health = new Map<string, { failures: number; until: number }>();
const baseUrl = () => {
  const url = (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
  if (url !== "https://openrouter.ai/api/v1") throw new Error("Only the official OpenRouter inference endpoint is permitted.");
  return url;
};

export function isVerifiedFree(model: CatalogModel) {
  const pricing = model.pricing;
  return !!pricing && ["prompt", "completion"].every(key => typeof pricing[key] === "string" && pricing[key]!.trim() !== "" && Number(pricing[key]) === 0)
    && Object.values(pricing).every(value => value === undefined || (value.trim() !== "" && Number(value) === 0));
}

export function normalizeModel(model: CatalogModel): ModelCandidate {
  return { id: model.id, family: ["nemotron", "gemma", "qwen", "llama", "mistral", "deepseek"].find(f => model.id.toLowerCase().includes(f)) ?? model.id.split("/")[0], inputModalities: model.architecture?.input_modalities ?? [], outputModalities: model.architecture?.output_modalities ?? [], contextLength: model.context_length, supportedParameters: model.supported_parameters ?? [], supportsStructuredOutput: model.supported_parameters?.includes("structured_outputs") || model.supported_parameters?.includes("response_format"), isFreeCandidate: isVerifiedFree(model), promptPrice: model.pricing?.prompt, completionPrice: model.pricing?.completion, ...(model.reasoning ? { reasoning: { supportedEfforts: model.reasoning.supported_efforts, supportsMaxTokens: model.reasoning.supports_max_tokens, mandatory: model.reasoning.mandatory } } : {}) };
}

export async function getLiveModelCatalog(force = false) {
  if (!force && catalogCache && Date.now() - catalogCache.fetchedAt < 300_000) return catalogCache.models;
  const response = await fetch(baseUrl() + "/models", { signal: AbortSignal.timeout(20_000), cache: "no-store" });
  if (!response.ok) throw new Error("OpenRouter model catalog unavailable (" + response.status + "). Retry later.");
  const body = await response.json() as { data?: CatalogModel[] };
  if (!Array.isArray(body.data)) throw new Error("Invalid OpenRouter catalog.");
  const models = body.data.map(normalizeModel);
  catalogCache = { fetchedAt: Date.now(), models };
  return models;
}

export function eligibleModels(models: ModelCandidate[], role: ModelRole, context: number, requestedModelId?: string, excluded: string[] = []) {
  const families = (role === "review" ? process.env.MODEL_REVIEW_PREFERRED_FAMILIES ?? "gemma,nemotron,qwen,llama,mistral,deepseek" : process.env.MODEL_PREFERRED_FAMILIES ?? "nemotron,gemma").split(",").map(family => family.trim().toLowerCase()).filter(Boolean);
  const score = (model: ModelCandidate) => {
    if (model.id === requestedModelId && role !== "review") return 100;
    if (model.id === "openrouter/free") return 1;
    const familyRank = families.indexOf(model.family);
    const familyScore = familyRank < 0 ? 0 : (families.length - familyRank) * 10;
    return familyScore + (model.supportedParameters?.includes("structured_outputs") ? 6 : model.supportedParameters?.includes("response_format") ? 2 : 0);
  };
  // Modality alone does not make a specialist classifier suitable for generation.
  const specialist = /(?:^|[\/_-])(?:content-safety|moderation|guard|embeddings?|embed|rerank(?:er|ing)?)(?:[\/_:\d-]|$)/i;
  return models.filter(model => !specialist.test(model.id) && model.isFreeCandidate && model.outputModalities.includes("text") && model.inputModalities.includes(role === "vision" ? "image" : "text") && (model.contextLength ?? 0) >= context && !excluded.includes(model.id) && (health.get(model.id)?.until ?? 0) <= Date.now()).sort((a, b) => score(b) - score(a));
}

export async function resolveModel(role: ModelRole, requestedModelId?: string) {
  const candidates = eligibleModels(await getLiveModelCatalog(), role, role === "code" ? 16_000 : 4_000, requestedModelId);
  if (!candidates.length) throw new Error("NO_ELIGIBLE_FREE_MODEL: no live zero-price model supports this request. Retry later or choose another free model.");
  return candidates[0];
}

const roleSchemas: Record<string, ZodTypeAny> = {
  DOCUMENT_EVIDENCE: documentEvidenceSchema,
  REFERENCE_CLASSIFIER: schemas.referenceClassificationSchema, VISUAL_SPEC: schemas.visualSpecSchema,
  DESIGN_TOKEN_NORMALIZER: schemas.designTokensSchema, COMPONENT_HIERARCHY: schemas.componentTreeSchema,
  FILE_PLAN: schemas.filePlanSchema, GENERATE: schemas.generatedProjectSchema, STATIC_REVIEW: schemas.issueListSchema,
  A11Y_REVIEW: schemas.accessibilityReviewSchema, VISUAL_FIDELITY_REVIEW: schemas.evaluationSchema,
  REPAIR_PLANNER: schemas.repairPlanSchema, REPAIR_BUILD: schemas.patchSetSchema, REPAIR_VISUAL: schemas.patchSetSchema,
  REFINEMENT_INTERPRETER: schemas.refinementIntentSchema, USER_REFINEMENT: schemas.patchSetSchema, FINAL_QA: schemas.finalQaSchema,
};

class ProviderError extends Error {
  constructor(readonly status: number, readonly retryAfter = 0) { super("OpenRouter could not serve this request (" + status + ")."); }
}

type Completion = { model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number }; error?: { code?: number }; choices?: Array<{ delta?: { content?: string }; message?: { content?: string }; finish_reason?: string }> };

export function modelAuditAttempt(input: { role: ModelRole; requestedModelId?: string }, candidate: ModelCandidate, details: { durationMs: number; attempt: number; outcome: "ok" | "error" | "schema_error"; errorCode?: string; resolvedModelId?: string }): ModelAudit {
  return {
    role: input.role,
    requestedModelId: input.requestedModelId,
    routedModelId: candidate.id,
    resolvedModelId: details.resolvedModelId ?? candidate.id,
    durationMs: details.durationMs,
    attempts: 1,
    attemptNumber: details.attempt,
    outcome: details.outcome,
    errorCode: details.outcome === "ok" ? undefined : details.errorCode,
    createdAt: new Date().toISOString(),
  };
}

export async function appendModelAttempt(input: { role: ModelRole; requestedModelId?: string }, candidate: ModelCandidate, details: { durationMs: number; attempt: number; outcome: "ok" | "error" | "schema_error"; errorCode?: string; resolvedModelId?: string }, attemptStore: LocalProjectStore = store) {
  const context = jobContext.getStore();
  if (!context) return;
  try {
    const ownerId = await attemptStore.checkpoint("ownerId") as string;
    const job = await attemptStore.getJob(context.jobId, ownerId);
    await attemptStore.updateJob(context.jobId, { modelAudit: [...job.modelAudit ?? [], modelAuditAttempt(input, candidate, details)] });
  } catch {
    // Audit persistence must never hide a provider result or its original failure.
    console.warn("Model-attempt audit could not be persisted.");
  }
}

export async function readCompletion(response: Response, streaming: boolean) {
  let text = "", modelId = "";
  let usage: Usage | undefined;
  const consume = (item: Completion) => {
    if (item.error) throw new ProviderError(Number(item.error.code) || 502);
    modelId = item.model ?? modelId;
    if (item.usage) usage = { promptTokens: item.usage.prompt_tokens, completionTokens: item.usage.completion_tokens, totalTokens: item.usage.total_tokens, costCredits: item.usage.cost };
    if (item.choices?.[0]?.finish_reason === "length") throw new Error("Model output exceeded the completion budget. Reduce the file plan and retry.");
    text += item.choices?.[0]?.delta?.content ?? item.choices?.[0]?.message?.content ?? "";
    if (text.length > 7_500_000) throw new Error("Model output exceeded the safe size limit.");
  };
  if (!streaming) consume(await response.json() as Completion);
  else {
    if (!response.body) throw new ProviderError(502);
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = "";
    const line = (value: string) => { if (value.startsWith("data:")) { const payload = value.slice(5).trim(); if (payload && payload !== "[DONE]") consume(JSON.parse(payload) as Completion); } };
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const item of lines) line(item);
        if (buffer.length > 7_500_000) throw new Error("Invalid provider stream.");
      }
      line(buffer + decoder.decode());
    } finally { await reader.cancel(); }
  }
  if (!text || !modelId) throw new ProviderError(502);
  return { text, modelId, ...(usage ? { usage } : {}) };
}

export async function structuredOpenRouterCall<T>(input: { role: ModelRole; prompt: string; imageDataUrl?: string; imageDataUrls?: string[]; requestedModelId?: string; stream?: boolean; systemPrompt?: string; allowedFilePaths?: string[] }) {
  const sharedSystemPrompt = input.systemPrompt ?? screenshotSystemPrompt;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured. Add it to the server environment.");
  const contractRole = input.prompt.match(/^ROLE: (\w+)/)?.[1] ?? "";
  const baseSchema = roleSchemas[contractRole];
  if (!baseSchema) throw new Error("Unknown prompt contract.");
  const schema = scopedOutputContract(contractRole, baseSchema, input.allowedFilePaths);
  const schemaText = JSON.stringify(zodToJsonSchema(schema, { $refStrategy: "root" }));
  const cacheKey = contractFingerprint(input, schemaText, sharedSystemPrompt, PROMPT_VERSION);
  const cached = await store.checkpoint(cacheKey) as { value: T; modelId: string } | undefined;
  if (cached) return cached;
  const images = input.imageDataUrls ?? (input.imageDataUrl ? [input.imageDataUrl] : []);
  const role = images.length ? "vision" : input.role;
  const codeOutput = input.role === "code" || input.role === "repair";
  const outputTokens = codeOutput ? 16_000 : 6000;
  const contextTokens = Math.ceil((input.prompt.length + schemaText.length) / 3) + outputTokens + images.length * 2000;
  const eligible = eligibleModels(await getLiveModelCatalog(), role, contextTokens, input.requestedModelId);
  if (!eligible.length) throw new Error("NO_ELIGIBLE_FREE_MODEL: no current free model has the required modality and context capacity.");
  // Keep the dynamic router as a reserved last route. It can choose from currently
  // available zero-price providers when the individually named free routes are busy.
  const freeRouterFallback = input.requestedModelId === "openrouter/free" ? undefined : eligible.find(model => model.id === "openrouter/free");
  const candidates = freeRouterFallback ? eligible.filter(model => model.id !== freeRouterFallback.id) : eligible;
  const signal = jobContext.getStore()?.signal;
  const retries = Math.min(4, Math.max(0, Number(process.env.MAX_MODEL_RETRIES ?? 3)));
  const maxAttempts = retries + 2 + (freeRouterFallback ? 1 : 0); // initial + transport retries + format retry + reserved free-router fallback
  let formatRetry = false;
  let formatIssues = "";
  let formatCandidate: ModelCandidate | undefined;
  let transportRetries = 0;
  const attempted = new Set<string>();
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    signal?.throwIfAborted();
    const available = candidates.filter(candidate => (health.get(candidate.id)?.until ?? 0) <= Date.now());
    const shouldUseFreeRouter = !!freeRouterFallback && !attempted.has(freeRouterFallback.id)
      && (transportRetries >= retries || available.length === 0 || attempt === maxAttempts - 1);
    const candidate = formatCandidate ?? (shouldUseFreeRouter
      ? freeRouterFallback
      : available.find(model => !attempted.has(model.id)) ?? available[0] ?? (freeRouterFallback && !attempted.has(freeRouterFallback.id) ? freeRouterFallback : undefined));
    formatCandidate = undefined;
    if (!candidate) throw new Error("Free routes are temporarily unhealthy. Retry after their cooldown.");
    attempted.add(candidate.id);
    const parameters = new Set(candidate.supportedParameters);
    const nativeSchema = parameters.has("structured_outputs");
    const responseFormat = nativeSchema
      ? { type: "json_schema", json_schema: { name: input.prompt.match(/^ROLE: (\w+)/)![1], strict: false, schema: JSON.parse(schemaText) } }
      : parameters.has("response_format") ? { type: "json_object" } : undefined;
    // Zod remains strict locally. API strict=false preserves optional/recursive contracts.
    const reasoning = parameters.has("reasoning") ? {
      exclude: true,
      ...(candidate.reasoning?.supportsMaxTokens ? { max_tokens: codeOutput ? 2048 : 1024 }
        : candidate.reasoning?.supportedEfforts === null || candidate.reasoning?.supportedEfforts?.includes("low") ? { effort: "low" } : {}),
    } : undefined;
    const prompt = input.prompt + "\n\nExact JSON schema:\n" + schemaText + (formatRetry ? "\nReturn only schema-valid JSON. Correct the response format; do not add prose or fields. Contract failures: " + formatIssues : "");
    const attemptStart = performance.now();
    let attemptDuration: number | undefined;
    let attemptUsage: Usage | undefined;
    let attemptModel = candidate.id;
    let outcome: "ok" | "error" | "schema_error" = "error";
    let schemaRejected = false;
    let errorCode = "PROVIDER_FAILED";
    try {
      const response = await fetch(baseUrl() + "/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey, "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER ?? "", "X-Title": process.env.OPENROUTER_APP_TITLE ?? "Screenshot-to-Code Studio" },
        body: JSON.stringify({ model: candidate.id, messages: [{ role: "system", content: sharedSystemPrompt }, { role: "user", content: [{ type: "text", text: prompt }, ...images.map(url => ({ type: "image_url", image_url: { url } }))] }], stream: !!input.stream, max_tokens: outputTokens, ...(parameters.has("temperature") ? { temperature: role === "vision" ? 0.05 : input.role === "review" ? 0 : 0.15 } : {}), ...(responseFormat ? { response_format: responseFormat } : {}), ...(reasoning ? { reasoning } : {}), provider: { max_price: { prompt: 0, completion: 0 }, allow_fallbacks: true, ...(nativeSchema ? { require_parameters: true } : {}) } }),
        signal: AbortSignal.any([AbortSignal.timeout(Math.min(120_000, Number(process.env.REQUEST_TIMEOUT_MS ?? 90_000))), ...(signal ? [signal] : [])]), cache: "no-store",
      });
      if (!response.ok) throw new ProviderError(response.status, Math.min(30_000, Number(response.headers.get("retry-after") ?? 0) * 1000) || 0);
      const completion = await readCompletion(response, !!input.stream);
      attemptUsage = completion.usage; attemptModel = completion.modelId;
      let value: T;
      try { value = schema.parse(JSON.parse(completion.text)) as T; }
      catch (error) {
        outcome = "schema_error"; errorCode = "SCHEMA_INVALID";
        schemaRejected = true;
        if (formatRetry) throw new Error("Model response failed its schema after one format retry.");
        formatIssues = formatDiagnostics(error);
        formatRetry = true; formatCandidate = candidate; continue;
      }
      const result = { value, modelId: completion.modelId };
      outcome = "ok";
      health.delete(candidate.id);
      const context = jobContext.getStore();
      if (context) {
        await store.checkpoint(cacheKey, result);
        await store.appendEvent(context.jobId, { type: "model.completed", level: "info", safeMessage: input.role + " completed via " + completion.modelId + (attempt ? " after fallback/retry." : ".") });
      }
      return result;
    } catch (error) {
      attemptDuration = performance.now() - attemptStart;
      if (error instanceof ProviderError) errorCode = "HTTP_" + error.status;
      else if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) errorCode = error.name === "TimeoutError" ? "TIMEOUT" : "ABORTED";
      if (signal?.aborted) throw new Error("JOB_CANCELLED");
      lastError = error;
      // A route can advertise JSON mode yet repeatedly violate the local Zod
      // contract. Keep the single same-route format retry, then fail over rather
      // than letting one model's malformed output terminate the whole workflow.
      if (schemaRejected) {
        const hasNextNamedRoute = candidates.some(model => !attempted.has(model.id));
        const hasFreeRouterRoute = !!freeRouterFallback && !attempted.has(freeRouterFallback.id);
        if (!hasNextNamedRoute && !hasFreeRouterRoute) throw error;
        const failures = (health.get(candidate.id)?.failures ?? 0) + 1;
        health.set(candidate.id, { failures, until: Date.now() + 60_000 });
        const context = jobContext.getStore();
        if (context) await store.appendEvent(context.jobId, { type: "model.retry", level: "warning", safeMessage: "Model response did not satisfy the output contract. Trying another eligible free route." });
        continue;
      }
      // A 400 can mean that one provider route rejects a capability the live catalog
      // advertised (for example, image + structured output). Try another free route,
      // but cool the rejecting route and do not retry it with the same payload.
      const routeRejected = error instanceof ProviderError && error.status === 400;
      const transient = routeRejected || (error instanceof ProviderError ? [408, 429, 500, 502, 503, 504].includes(error.status) : error instanceof TypeError || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)));
      const canUseFreeRouter = !!freeRouterFallback && candidate.id !== freeRouterFallback.id && !attempted.has(freeRouterFallback.id);
      if (!transient || (transportRetries >= retries && !canUseFreeRouter)) throw error;
      if (!routeRejected) transportRetries++;
      const failures = (health.get(candidate.id)?.failures ?? 0) + 1;
      const rateLimited = error instanceof ProviderError && error.status === 429;
      health.set(candidate.id, { failures, until: rateLimited || routeRejected || failures >= 2 ? Date.now() + 60_000 : 0 });
      const context = jobContext.getStore();
      if (context) await store.appendEvent(context.jobId, { type: "model.retry", level: "warning", safeMessage: "Free model temporarily unavailable. Retrying with an eligible free route." });
      if (!routeRejected) await delay(Math.max(error instanceof ProviderError ? error.retryAfter : 0, Math.min(8000, 500 * 2 ** attempt + Math.random() * 300)), undefined, { signal });
    } finally {
      const durationMs = attemptDuration ?? performance.now() - attemptStart;
      recordSpan({ stage: input.prompt.match(/^ROLE: (\w+)/)?.[1] ?? input.role, outcome, durationMs, model: attemptModel, attempt: attempt + 1, usage: attemptUsage, errorCode: outcome === "ok" ? undefined : errorCode });
      await appendModelAttempt(input, candidate, { durationMs, attempt: attempt + 1, outcome, errorCode, resolvedModelId: outcome === "ok" ? attemptModel : undefined });
    }
  }
  throw lastError ?? new Error("OpenRouter retry budget exhausted.");
}
