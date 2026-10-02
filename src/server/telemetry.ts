import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { jobContext } from "./job-context";

export type Usage = { promptTokens?: number; completionTokens?: number; totalTokens?: number; costCredits?: number };
export type Trace = { id: string; source: "studio" | "benchmark" | "document-assistant"; projectId?: string };
export type Span = { stage: string; outcome: "ok" | "error" | "schema_error"; durationMs: number; model?: string; attempt?: number; errorCode?: string; usage?: Usage };
export const traceContext = new AsyncLocalStorage<Trace>();

/** Allowlisted operational metadata only: never prompts, screenshots, source or raw errors. */
export function recordSpan(span: Span) {
  const trace = traceContext.getStore() ?? (jobContext.getStore() ? { id: jobContext.getStore()!.jobId, source: "studio" as const } : undefined);
  if (!trace || process.env.TELEMETRY_ENABLED === "false") return;
  let db: DatabaseSync | undefined;
  try {
    // Runtime-only private data must not be copied into a traced Next.js deployment.
    const root = path.resolve(/* turbopackIgnore: true */ process.env.PRIVATE_STORAGE_ROOT ?? ".data/private");
    mkdirSync(root, { recursive: true, mode: 0o700 });
    db = new DatabaseSync(path.join(root, "telemetry.sqlite"));
    db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS spans (id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, source TEXT NOT NULL, project_id TEXT, started_at TEXT NOT NULL, stage TEXT NOT NULL, outcome TEXT NOT NULL, duration_ms REAL NOT NULL, model TEXT, attempt INTEGER, error_code TEXT, prompt_tokens INTEGER, completion_tokens INTEGER, total_tokens INTEGER, cost_credits REAL); CREATE INDEX IF NOT EXISTS spans_trace ON spans(trace_id);");
    const number = (v: number | undefined) => v !== undefined && Number.isFinite(v) && v >= 0 ? v : null;
    const label = (v?: string) => v?.replace(/sk-or-v1-[\w-]+/g, "redacted").replace(/[^a-zA-Z0-9_./:-]/g, "_").slice(0, 160) ?? null;
    db.prepare("INSERT INTO spans VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(randomUUID(), trace.id, trace.source, trace.projectId ?? null, new Date(Date.now() - span.durationMs).toISOString(), label(span.stage), span.outcome, number(span.durationMs) ?? 0, label(span.model), number(span.attempt), label(span.errorCode), number(span.usage?.promptTokens), number(span.usage?.completionTokens), number(span.usage?.totalTokens), number(span.usage?.costCredits));
  } catch { console.warn("Operational telemetry unavailable; application work continues."); }
  finally { db?.close(); }
}

export async function measured<T>(stage: string, work: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try { const result = await work(); recordSpan({ stage, outcome: "ok", durationMs: performance.now() - start }); return result; }
  catch (error) { recordSpan({ stage, outcome: "error", durationMs: performance.now() - start, errorCode: "STAGE_FAILED" }); throw error; }
}
