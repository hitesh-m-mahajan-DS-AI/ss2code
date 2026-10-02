import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { recordSpan, traceContext } from "../src/server/telemetry";

test("telemetry records safe metadata, missing accounting stays null, opt-out works", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ss2-telemetry-"));
  const previous = process.env.PRIVATE_STORAGE_ROOT, enabled = process.env.TELEMETRY_ENABLED;
  process.env.PRIVATE_STORAGE_ROOT = root; process.env.TELEMETRY_ENABLED = "true";
  try {
    traceContext.run({ id: "test", source: "benchmark" }, () => {
      recordSpan({ stage: "GENERATE", outcome: "ok", durationMs: 12, model: "test/free", usage: { costCredits: 0, totalTokens: 5 } });
      recordSpan({ stage: "GENERATE", outcome: "error", durationMs: 20, model: "test/free", errorCode: "sk-or-v1-fake-secret" });
      process.env.TELEMETRY_ENABLED = "false";
      recordSpan({ stage: "ignored", outcome: "ok", durationMs: 1 });
    });
    const db = new DatabaseSync(path.join(root, "telemetry.sqlite"));
    try {
      const rows = db.prepare("SELECT * FROM spans ORDER BY rowid").all();
      assert.equal(rows.length, 2); assert.equal(rows[0].cost_credits, 0); assert.equal(rows[1].cost_credits, null);
      assert.equal(rows[1].error_code, "redacted"); assert.ok(!JSON.stringify(rows).includes("fake-secret"));
      db.exec("CREATE TABLE projects(id TEXT, has_spec INTEGER); CREATE TABLE jobs(id TEXT,project_id TEXT,phase TEXT,created_at TEXT,updated_at TEXT); CREATE TABLE revisions(id TEXT,project_id TEXT,pixel_agreement REAL);");
      db.exec(await readFile("portfolio/analytics/queries.sql", "utf8"));
      const model = db.prepare("SELECT * FROM model_reliability").get()!;
      assert.equal(model.attempt_success_rate, .5); assert.equal(model.attempts_with_cost_accounting, 1); assert.equal(model.reported_cost_credits, 0);
      assert.equal(db.prepare("SELECT * FROM observed_project_coverage WHERE stage='uploaded'").get()!.projects, 0);
    } finally { db.close(); }
  } finally {
    if (previous === undefined) delete process.env.PRIVATE_STORAGE_ROOT; else process.env.PRIVATE_STORAGE_ROOT = previous;
    if (enabled === undefined) delete process.env.TELEMETRY_ENABLED; else process.env.TELEMETRY_ENABLED = enabled;
    await rm(root, { recursive: true, force: true });
  }
});
