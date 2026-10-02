import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const root = path.resolve(process.env.PRIVATE_STORAGE_ROOT ?? ".data/private");
const output = path.resolve(".data/analytics", randomUUID());
await mkdir(output, { recursive: true, mode: 0o700 });
const warehouse = new DatabaseSync(path.join(output, "warehouse.sqlite"));
const salt = randomUUID();
const pseudonym = (id: string | null | undefined) => id ? createHash("sha256").update(salt + id).digest("hex").slice(0, 24) : null;
type State = { projectOwners: Record<string, string>; specs: { projectId: string }[]; jobs: { id: string; projectId: string; phase: string; createdAt: string; updatedAt: string }[]; revisions: { id: string; projectId: string; jobId?: string; evaluation: { metrics: { visualScore?: number } } }[] };
try {
  warehouse.exec("CREATE TABLE projects(id TEXT PRIMARY KEY, has_spec INTEGER NOT NULL); CREATE TABLE jobs(id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), phase TEXT, created_at TEXT, updated_at TEXT); CREATE TABLE revisions(id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), pixel_agreement REAL); CREATE TABLE spans(id TEXT PRIMARY KEY, trace_id TEXT, source TEXT, project_id TEXT, started_at TEXT, stage TEXT, outcome TEXT, duration_ms REAL, model TEXT, attempt INTEGER, error_code TEXT, prompt_tokens INTEGER, completion_tokens INTEGER, total_tokens INTEGER, cost_credits REAL); PRAGMA foreign_keys=ON;");
  let state: State = { projectOwners: {}, specs: [], jobs: [], revisions: [] };
  if (existsSync(path.join(root, "studio.sqlite"))) {
    const source = new DatabaseSync(path.join(root, "studio.sqlite"), { readOnly: true });
    try { const row = source.prepare("SELECT data FROM state WHERE id=1").get() as { data: string } | undefined; if (row) state = JSON.parse(row.data); } finally { source.close(); }
  }
  warehouse.exec("BEGIN");
  for (const project of Object.keys(state.projectOwners)) warehouse.prepare("INSERT INTO projects VALUES(?,?)").run(pseudonym(project), Number(state.specs.some(s => s.projectId === project)));
  for (const job of state.jobs) warehouse.prepare("INSERT INTO jobs VALUES(?,?,?,?,?)").run(pseudonym(job.id), pseudonym(job.projectId), job.phase, job.createdAt, job.updatedAt);
  for (const revision of state.revisions.filter(r => !r.jobId || state.jobs.some(j => j.id === r.jobId && j.phase === "ready"))) warehouse.prepare("INSERT INTO revisions VALUES(?,?,?)").run(pseudonym(revision.id), pseudonym(revision.projectId), revision.evaluation.metrics.visualScore ?? null);
  if (existsSync(path.join(root, "telemetry.sqlite"))) {
    const source = new DatabaseSync(path.join(root, "telemetry.sqlite"), { readOnly: true });
    try {
      for (const s of source.prepare("SELECT * FROM spans").all()) {
        const job = state.jobs.find(j => j.id === s.trace_id);
        warehouse.prepare("INSERT INTO spans VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(pseudonym(String(s.id)), pseudonym(String(s.trace_id)), s.source, pseudonym(s.project_id ? String(s.project_id) : job?.projectId), s.started_at, s.stage, s.outcome, s.duration_ms, s.model, s.attempt, s.error_code, s.prompt_tokens, s.completion_tokens, s.total_tokens, s.cost_credits);
      }
    } finally { source.close(); }
  }
  warehouse.exec("COMMIT");
  if (warehouse.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Warehouse relationship validation failed");
  warehouse.exec(await readFile("portfolio/analytics/queries.sql", "utf8"));
  const names = ["observed_project_coverage", "job_outcomes", "model_reliability", "failure_stages", "daily_jobs"];
  const report = Object.fromEntries(names.map(name => [name, warehouse.prepare("SELECT * FROM " + name).all()]));
  const durations = warehouse.prepare("SELECT duration_ms FROM spans WHERE source='studio' ORDER BY duration_ms").all().map(r => Number(r.duration_ms));
  const summary = { generatedAt: new Date().toISOString(), source: "local operational snapshot (not a user study)", p50StageMs: durations.length ? durations[Math.floor(durations.length * .5)] : null, p95StageMs: durations.length ? durations[Math.ceil(durations.length * .95) - 1] : null, ...report };
  await writeFile(path.join(output, "report.json"), JSON.stringify(summary, null, 2));
  const escape = (value: unknown) => String(value ?? "not recorded").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const tables = Object.entries(report).map(([name, rows]) => `<section><h2>${escape(name.replaceAll("_", " "))}</h2>${rows.length ? `<div class="scroll" tabindex="0" role="region" aria-label="${escape(name.replaceAll("_", " "))} table"><table><thead><tr>${Object.keys(rows[0]).map(k => `<th>${escape(k)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${Object.values(r).map(v => `<td>${escape(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : "<p>No observations yet. No values have been fabricated.</p>"}</section>`).join("");
  await writeFile(path.join(output, "dashboard.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>SS2Code operational evidence</title><style>body{font:16px/1.6 system-ui;background:#101827;color:#eef2ff;margin:0;padding:clamp(16px,4vw,64px)}main{max-width:1300px;margin:auto}h1{font-size:clamp(28px,4vw,46px)}section{background:#1c2940;padding:24px;border-radius:16px;margin:24px 0}.scroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{padding:12px;text-align:left;border-bottom:1px solid #475569}p{max-width:85ch;color:#cbd5e1}</style></head><body><main><h1>Operational evidence</h1><p>Generated ${escape(summary.generatedAt)}. Observed project coverage is not a session funnel or causal experiment. Historical uninstrumented actions are unknown. Export built does not prove a download was saved. Token/cost totals cover reported usage only; infrastructure cost is not measured. No personal identifiers or raw content are exported.</p><p>Studio stage p50: ${escape(summary.p50StageMs)} ms · p95: ${escape(summary.p95StageMs)} ms</p>${tables}</main></body></html>`);
  console.log(`Validated local warehouse and dashboard: ${output}`);
} finally { warehouse.close(); }
