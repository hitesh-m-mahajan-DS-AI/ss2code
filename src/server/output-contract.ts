import { z, type ZodTypeAny } from "zod";
import { generatedProjectSchema, patchSetSchema } from "@/lib/schemas";
import { assertSafeProjectPath } from "@/lib/security";
import { createHash } from "node:crypto";

export function contractFingerprint(input: unknown, schemaText: string, systemPrompt: string, promptVersion: string) {
  return createHash("sha256").update(JSON.stringify({ input, promptVersion, schemaText, systemPrompt })).digest("hex");
}

/** Bind model output to the trusted plan, not just the generic JSON envelope. */
export function scopedOutputContract(role: string, fallback: ZodTypeAny, paths?: string[]): ZodTypeAny {
  if (!paths) return fallback;
  if (!["GENERATE", "REPAIR_BUILD", "REPAIR_VISUAL", "USER_REFINEMENT"].includes(role)) throw new Error("File scopes are only valid for source-output roles.");
  if (!paths.length || paths.length > 24 || new Set(paths).size !== paths.length || paths.some(p => assertSafeProjectPath(p) !== p || !p.startsWith("src/") || !/\.(tsx?|css|svg)$/.test(p))) throw new Error("Invalid approved output file scope.");
  const item = z.object({ path: z.enum(paths as [string, ...string[]]), content: z.string().max(300_000) }).strict();
  const files = (role === "GENERATE" ? z.array(item).length(paths.length) : z.array(item).max(paths.length)).superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.forEach((file, i) => {
      if (seen.has(file.path)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "path"], message: "Each approved path must appear at most once; generation must include every planned file." });
      seen.add(file.path);
    });
  });
  return role === "GENERATE" ? generatedProjectSchema.extend({ files }) : patchSetSchema.extend({ files });
}

/** Field-level format feedback only; never echo a raw completion or its contents. */
export function formatDiagnostics(error: unknown): string {
  if (!(error instanceof z.ZodError)) return "The response was not a valid JSON object.";
  return error.issues.slice(0, 8).map(issue => `${issue.path.join(".") || "response"}: ${issue.code}`).join("; ").slice(0, 1200);
}

/** Persist only bounded contract locations/codes; never completion values or arbitrary record keys. */
export function schemaFailureCode(error: unknown): string {
  if (!(error instanceof z.ZodError)) return "SCHEMA_INVALID:invalid_json";
  const recordSections = new Set(["colors", "spacing", "radii", "shadows", "motion"]);
  const summary = error.issues.slice(0, 4).map(issue => {
    const isTokenRecordEntry = issue.path[0] === "designTokens" && typeof issue.path[1] === "string" && recordSections.has(issue.path[1]);
    const path = issue.path.slice(0, isTokenRecordEntry ? 2 : 4).map(part => {
      if (typeof part === "number") return "item";
      return /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(part) ? part : "field";
    }).join(".") || "response";
    const code = /^[a-z_]+$/.test(issue.code) ? issue.code : "invalid";
    return `${path}:${code}`;
  });
  return `SCHEMA_INVALID:${(summary.join(",") || "unknown").slice(0, 128)}`;
}
