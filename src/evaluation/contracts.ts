import { z } from "zod";
import { visualSpecSchema, filePlanSchema } from "../lib/schemas";

export const benchmarkCaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), group: z.string().min(1), category: z.string(),
  split: z.enum(["development", "validation", "holdout"]),
  origin: z.literal("project-authored-synthetic"), reference: z.string(), sha256: z.string().length(64),
  viewport: z.object({ width: z.number().int().min(280).max(3840), height: z.number().int().min(320).max(4096) }),
  truth: visualSpecSchema, oracleFiles: z.array(z.object({ path: z.string(), content: z.string() })), oraclePlan: filePlanSchema,
});
export const datasetSchema = z.object({ version: z.literal("pilot-1"), createdAt: z.string(), cases: z.array(benchmarkCaseSchema).min(1) }).superRefine((value, context) => {
  const ids = new Set<string>(), groups = new Map<string, string>();
  for (const item of value.cases) {
    if (ids.has(item.id)) context.addIssue({ code: "custom", message: "Duplicate case ID" });
    ids.add(item.id);
    if (groups.has(item.group) && groups.get(item.group) !== item.split) context.addIssue({ code: "custom", message: "Template group leaks across splits" });
    groups.set(item.group, item.split);
    if (item.viewport.width !== item.truth.reference.viewport.width || item.viewport.height !== item.truth.reference.viewport.height) context.addIssue({ code: "custom", message: "Truth viewport mismatch" });
  }
});
export type BenchmarkCase = z.infer<typeof benchmarkCaseSchema>;
export type Lane = "direct" | "staged" | "repair" | "self-test";

export function selectCases(cases: BenchmarkCase[], split: string, limit: number) {
  const eligible = cases.filter(item => item.split === split);
  const groups = [...new Set(eligible.map(item => item.group))].map(group => eligible.filter(item => item.group === group));
  return Array.from({ length: Math.max(0, ...groups.map(group => group.length)) }, (_, i) => groups.flatMap(group => group[i] ? [group[i]] : [])).flat().slice(0, limit);
}
export type BenchmarkResult = { id: string; group: string; category: string; lane: Lane; repeat: number; traceId: string; completed: boolean; firstBuildPassed: boolean; durationMs: number; pixelAgreement?: number; geometry?: number; textCoverage?: number; seriousA11y?: number; overflow?: boolean; failureCategory?: string; failureMessage?: string; modelIds: string[]; repairPasses: number };

export function summarize(results: BenchmarkResult[]) {
  const groups = [...new Set(results.map(r => r.group))];
  const rate = (rows: BenchmarkResult[]) => rows.length ? rows.filter(r => r.completed).length / rows.length : null;
  let seed = 42;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
  const bootstraps = groups.length < 2 ? [] : Array.from({ length: 2000 }, () => rate(Array.from({ length: groups.length }, () => groups[Math.floor(random() * groups.length)]).flatMap(group => results.filter(r => r.group === group)))!).sort((a, b) => a - b);
  const mean = (key: "pixelAgreement" | "geometry" | "textCoverage") => {
    const values = results.map(r => r[key]).filter((v): v is number => v !== undefined);
    return { value: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, measured: values.length, total: results.length };
  };
  const times = results.map(r => r.durationMs).sort((a, b) => a - b);
  return { attempts: results.length, independentGroups: groups.length, completionRate: rate(results), firstBuildRate: results.length ? results.filter(r => r.firstBuildPassed).length / results.length : null, completion95Interval: bootstraps.length ? [bootstraps[49], bootstraps[1949]] : null, pixelAgreement: mean("pixelAgreement"), geometry: mean("geometry"), textCoverage: mean("textCoverage"), p95DurationMs: times.length ? times[Math.ceil(times.length * .95) - 1] : null, failures: Object.fromEntries([...new Set(results.filter(r => !r.completed).map(r => r.failureCategory ?? "unknown"))].map(k => [k, results.filter(r => !r.completed && (r.failureCategory ?? "unknown") === k).length])) };
}
