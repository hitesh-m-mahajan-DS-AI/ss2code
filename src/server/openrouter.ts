import type { ModelCandidate, ModelRole } from "@/lib/domain";
import { sharedSystemPrompt } from "@/lib/prompts";

type OpenRouterModel = {
  id: string;
  name?: string;
  context_length?: number;
  architecture?: { input_modalities?: string[]; output_modalities?: string[]; supports_response_schema?: boolean };
  pricing?: { prompt?: string; completion?: string };
};

type CachedCatalog = { fetchedAt: number; models: ModelCandidate[] };
let catalogCache: CachedCatalog | undefined;

const baseUrl = () => (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
const timeoutMs = () => Number(process.env.REQUEST_TIMEOUT_MS ?? 90_000);

function asFreeCandidate(model: OpenRouterModel) {
  const prompt = model.pricing?.prompt ?? "";
  const completion = model.pricing?.completion ?? "";
  return model.id === "openrouter/free" || model.id.endsWith(":free") || (Number(prompt) === 0 && Number(completion) === 0);
}

function familyFor(id: string) {
  const lowered = id.toLowerCase();
  for (const family of ["nemotron", "gemma", "qwen", "llama", "mistral", "deepseek"]) if (lowered.includes(family)) return family;
  return id.split("/")[0] ?? "other";
}

export async function getLiveModelCatalog(force = false): Promise<ModelCandidate[]> {
  if (!force && catalogCache && Date.now() - catalogCache.fetchedAt < 10 * 60_000) return catalogCache.models;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured. Add it to server environment variables; it is never sent to the browser.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs(), 30_000));
  try {
    const response = await fetch(`${baseUrl()}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`OpenRouter model catalog request failed (${response.status}).`);
    const body = (await response.json()) as { data?: OpenRouterModel[] };
    const models = (body.data ?? []).map((model) => ({
      id: model.id,
      family: familyFor(model.id),
      inputModalities: model.architecture?.input_modalities ?? ["text"],
      outputModalities: model.architecture?.output_modalities ?? ["text"],
      contextLength: model.context_length,
      supportsStructuredOutput: model.architecture?.supports_response_schema,
      isFreeCandidate: asFreeCandidate(model),
      promptPrice: model.pricing?.prompt,
      completionPrice: model.pricing?.completion,
    }));
    // The OpenRouter free router is itself capability-aware. Keep it as a live
    // free fallback when individual free variants are rate-limited or rotate.
    if (!models.some((candidate) => candidate.id === "openrouter/free")) {
      models.push({ id: "openrouter/free", family: "router", inputModalities: ["text", "image"], outputModalities: ["text"], contextLength: 16_000, supportsStructuredOutput: false, isFreeCandidate: true, promptPrice: "0", completionPrice: "0" });
    }
    catalogCache = { fetchedAt: Date.now(), models };
    return models;
  } finally {
    clearTimeout(timer);
  }
}

function roleRequirements(role: ModelRole) {
  return { image: role === "vision", context: role === "code" ? 16_000 : 4_000 };
}

export async function resolveModel(role: ModelRole, requestedModelId?: string) {
  const policy = process.env.MODEL_POLICY ?? "free_only";
  const models = await getLiveModelCatalog();
  const needs = roleRequirements(role);
  const eligible = models.filter((candidate) =>
    (policy !== "free_only" || candidate.isFreeCandidate) &&
    (!needs.image || candidate.inputModalities.includes("image")) &&
    (candidate.contextLength === undefined || candidate.contextLength >= needs.context),
  );
  if (requestedModelId) {
    const requested = models.find((candidate) => candidate.id === requestedModelId);
    if (!requested) throw new Error("The selected model is no longer present in the live OpenRouter catalog.");
    if (!eligible.some((candidate) => candidate.id === requested.id)) throw new Error("The selected model does not meet this job's capability or free-price policy.");
    return requested;
  }
  const families = (process.env.MODEL_PREFERRED_FAMILIES ?? "nemotron,gemma").split(",").map((value) => value.trim().toLowerCase());
  const ranked = eligible.sort((left, right) => {
    const leftScore = (families.includes(left.family) ? 4 : 0) + (left.supportsStructuredOutput ? 2 : 0) + (left.id.endsWith(":free") ? 1 : 0);
    const rightScore = (families.includes(right.family) ? 4 : 0) + (right.supportsStructuredOutput ? 2 : 0) + (right.id.endsWith(":free") ? 1 : 0);
    return rightScore - leftScore;
  });
  if (ranked[0]) return ranked[0];
  if (policy === "free_only") throw new Error("NO_ELIGIBLE_FREE_MODEL: no live zero-cost OpenRouter model currently supports this job. Retry later or choose an eligible model.");
  throw new Error("No OpenRouter model currently supports this job.");
}

type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

async function readSseText(response: Response) {
  if (!response.body) throw new Error("OpenRouter returned no response body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
        result += parsed.choices?.[0]?.delta?.content ?? "";
      } catch {
        // Partial provider events are intentionally ignored; the final JSON parser is authoritative.
      }
    }
  }
  return result;
}

export async function structuredOpenRouterCall<T>(input: { role: ModelRole; prompt: string; imageDataUrl?: string; imageDataUrls?: string[]; requestedModelId?: string; stream?: boolean; formatRetry?: boolean }) {
  const candidate = await resolveModel(input.role, input.requestedModelId);
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured.");
  const content: ContentPart[] = [{ type: "text", text: input.prompt }];
  for (const imageDataUrl of input.imageDataUrls ?? (input.imageDataUrl ? [input.imageDataUrl] : [])) content.push({ type: "image_url", image_url: { url: imageDataUrl } });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const response = await fetch(`${baseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER ?? "",
        "X-Title": process.env.OPENROUTER_APP_TITLE ?? "Screenshot-to-Code Studio",
      },
      body: JSON.stringify({
        model: candidate.id,
        messages: [{ role: "system", content: sharedSystemPrompt }, { role: "user", content }],
        temperature: input.role === "vision" ? 0.05 : input.role === "repair" ? 0.2 : 0.15,
        max_tokens: input.role === "code" ? 16_000 : 6_000,
        stream: Boolean(input.stream),
        ...(candidate.supportsStructuredOutput ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      const safeBody = (await response.text()).slice(0, 500).replace(/sk-or-v1-[A-Za-z0-9_-]+/g, "[redacted]");
      throw new Error(`OpenRouter request failed (${response.status}): ${safeBody}`);
    }
    const text = input.stream
      ? await readSseText(response)
      : ((await response.json()) as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? "";
    if (!text) throw new Error("OpenRouter returned an empty response.");
    try {
      return { value: JSON.parse(text) as T, modelId: candidate.id };
    } catch {
      if (input.formatRetry) throw new Error("OpenRouter returned invalid JSON after the one permitted format retry.");
      return structuredOpenRouterCall<T>({ ...input, formatRetry: true, prompt: `${input.prompt}\n\nYour previous response did not match the required JSON schema. Return the same result as one valid JSON object only, with no prose or fences.`, stream: false });
    }
  } finally {
    clearTimeout(timer);
  }
}
