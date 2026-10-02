import { readFile } from "node:fs/promises";
import path from "node:path";
import { summarize, type BenchmarkResult } from "../src/evaluation/contracts";

const ids = process.argv.slice(2);
if (ids.length < 2 || ids.some(id => !/^[a-f0-9-]{36}$/.test(id))) throw new Error("Supply at least two run UUIDs from .data/benchmarks/runs");
const runs = await Promise.all(ids.map(async id => {
  const root = path.resolve(".data/benchmarks/runs", id);
  return { metadata: JSON.parse(await readFile(path.join(root, "run.json"), "utf8")), rows: JSON.parse(await readFile(path.join(root, "results.json"), "utf8")) as BenchmarkResult[] };
}));
const first = runs[0];
for (const run of runs) {
  if (run.metadata.lane === "self-test") throw new Error("Oracle self-tests are not live AI comparison results");
  for (const key of ["datasetHash", "split", "promptVersion", "sourceHashes", "routing", "environment"]) {
    if (!first.metadata[key] || JSON.stringify(first.metadata[key]) !== JSON.stringify(run.metadata[key])) throw new Error(`Incomparable ${key}; freeze inputs and code before running the lanes`);
  }
  const keys = (rows: BenchmarkResult[]) => rows.map(row => `${row.id}:${row.repeat}`).sort().join("|");
  if (keys(first.rows) !== keys(run.rows)) throw new Error("Case/repeat coverage differs; do not silently drop failures or unmatched cases");
}
console.log(JSON.stringify({
  warning: "Descriptive paired pilot, not a causal model-ranking claim. Dynamic fallback models and availability are confounders. Pre-register larger group-held-out repeated experiments before inference.",
  runs: runs.map(({ metadata, rows }) => ({ runId: metadata.runId, lane: metadata.lane, ...summarize(rows), resolvedModels: [...new Set(rows.flatMap(row => row.modelIds))] })),
  pairedAgainstFirst: runs.slice(1).map(run => ({ lane: run.metadata.lane, differences: run.rows.map(row => {
    const baseline = first.rows.find(candidate => candidate.id === row.id && candidate.repeat === row.repeat)!;
    return { id: row.id, repeat: row.repeat, completionDifference: Number(row.completed) - Number(baseline.completed), elapsedDifferenceMs: row.durationMs - baseline.durationMs, pixelDifference: row.pixelAgreement !== undefined && baseline.pixelAgreement !== undefined ? row.pixelAgreement - baseline.pixelAgreement : null };
  }) })),
}, null, 2));
