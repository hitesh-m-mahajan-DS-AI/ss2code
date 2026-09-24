import { z } from "zod";

const confidence = z.enum(["high", "medium", "low"]);

export const visualSpecSchema = z.object({
  reference: z.object({ viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }), pageType: z.string().min(1).max(120), confidence }),
  observations: z.object({
    layout: z.array(z.object({ id: z.string().min(1).max(80), region: z.string().min(1).max(160), boundsPct: z.tuple([z.number(), z.number(), z.number(), z.number()]), description: z.string().max(800), importance: z.enum(["critical", "high", "normal"]) })).max(40),
    hierarchy: z.array(z.string().max(240)).max(30),
    style: z.object({
      palette: z.array(z.object({ role: z.string().max(80), value: z.string().max(60), confidence })).max(20),
      typography: z.array(z.object({ role: z.string().max(80), sizePxApprox: z.number().positive().max(400), weight: z.string().max(40), notes: z.string().max(300) })).max(20),
      spacing: z.object({ basePxApprox: z.number().positive().max(100), notes: z.string().max(300) }),
      radii: z.string().max(300),
      bordersAndShadows: z.string().max(500),
      imagery: z.array(z.string().max(300)).max(20),
    }),
    visibleInteractions: z.array(z.object({ element: z.string().max(160), evidence: z.string().max(500), implementation: z.string().max(400) })).max(30),
    responsiveEvidence: z.array(z.string().max(500)).max(20),
    visibleText: z.array(z.object({ region: z.string().max(160), text: z.string().max(1200), confidence })).max(100),
  }),
  constraints: z.object({ mustMatch: z.array(z.string().max(300)).max(40), mustNotInvent: z.array(z.string().max(300)).max(40), accessibilityRequirements: z.array(z.string().max(300)).max(30) }),
  assumptions: z.array(z.object({ detail: z.string().max(300), conservativeDefault: z.string().max(300), reason: z.string().max(400) })).max(30),
  implementationNotes: z.array(z.string().max(500)).max(30),
}).strict();

export const filePlanSchema = z.object({
  entry: z.string().min(1).max(180),
  files: z.array(z.object({ path: z.string().min(1).max(180), purpose: z.string().max(300), exports: z.array(z.string().max(100)).max(20), dependsOn: z.array(z.string().max(180)).max(30), visualRegions: z.array(z.string().max(160)).max(30) })).min(1).max(24),
  designTokens: z.object({ colors: z.record(z.string().max(100)), spacing: z.record(z.string().max(100)), radii: z.record(z.string().max(100)), shadows: z.record(z.string().max(200)), motion: z.record(z.string().max(100)) }),
  implementationDecisions: z.array(z.object({ decision: z.string().max(500), reason: z.string().max(500) })).max(30),
  assumptionsUsed: z.array(z.string().max(300)).max(30),
}).strict();

export const generatedProjectSchema = z.object({
  summary: z.string().max(1500),
  files: z.array(z.object({ path: z.string().min(1).max(180), content: z.string().max(300_000) })).min(1).max(24),
  interactionNotes: z.array(z.object({ element: z.string().max(160), behavior: z.string().max(500), accessibility: z.string().max(500) })).max(30),
  assumptionsApplied: z.array(z.string().max(300)).max(30),
}).strict();

export const designTokensSchema = z.object({
  colors: z.array(z.object({ name: z.string().max(80), value: z.string().max(100), usage: z.string().max(200), confidence })).max(30),
  typography: z.array(z.object({ role: z.string().max(80), sizePxApprox: z.number().positive().max(400), lineHeight: z.number().positive().max(8).optional(), weight: z.string().max(40).optional(), confidence })).max(30),
  spacing: z.array(z.number().positive().max(200)).max(20),
  radii: z.array(z.number().min(0).max(200)).max(20),
  shadows: z.array(z.string().max(300)).max(20),
  blurLevels: z.array(z.string().max(100)).max(10),
}).strict();

export const componentTreeSchema: z.ZodType<{ id: string; type: string; semanticRole: string; visualRegion: string; children: unknown[]; interactions?: string[]; confidence: "high" | "medium" | "low" }> = z.lazy(() => z.object({
  id: z.string().min(1).max(100),
  type: z.string().min(1).max(100),
  semanticRole: z.string().min(1).max(100),
  visualRegion: z.string().min(1).max(200),
  children: z.array(componentTreeSchema).max(40),
  interactions: z.array(z.string().max(200)).max(10).optional(),
  confidence,
}).strict());

export const referenceClassificationSchema = z.object({
  kind: z.enum(["image", "video", "video_frame", "pdf_page", "design_export", "asset_archive", "unsupported"]),
  readiness: z.enum(["ready", "needs_frame_selection", "needs_page_selection", "rejected"]),
  likelyRole: z.enum(["primary", "breakpoint", "interaction_state", "asset", "unknown"]),
  nextAction: z.string().max(400),
  safeNotes: z.array(z.string().max(400)).max(20),
}).strict();

export const issueListSchema = z.object({
  issues: z.array(z.object({ severity: z.enum(["critical", "high", "medium", "low"]), file: z.string().max(180).optional(), category: z.enum(["compile", "runtime", "import", "dependency", "react", "responsive", "security"]), explanation: z.string().max(500), minimalRepair: z.string().max(500), confidence })).max(50),
}).strict();

export const accessibilityReviewSchema = z.object({
  issues: z.array(z.object({ severity: z.enum(["critical", "serious", "moderate", "minor"]), file: z.string().max(180), element: z.string().max(200), issue: z.string().max(500), minimalFix: z.string().max(500) })).max(50),
  safeToAutoFix: z.boolean(),
}).strict();

export const repairPlanSchema = z.object({
  steps: z.array(z.object({ findingIds: z.array(z.string().max(100)).max(30), targetFiles: z.array(z.string().max(180)).max(20), kind: z.enum(["textual", "structural", "styling", "behavioral"]), change: z.string().max(600), preserves: z.array(z.string().max(300)).max(20) })).max(20),
}).strict();

export const patchSetSchema = z.object({
  rationale: z.array(z.object({ findingId: z.string().max(100), change: z.string().max(600), unresolvedReason: z.string().max(500).optional() })).max(30),
  files: z.array(z.object({ path: z.string().min(1).max(180), content: z.string().max(300_000) })).max(24),
  assumptionsChanged: z.array(z.string().max(300)).max(30),
}).strict();

export const refinementIntentSchema = z.object({
  targets: z.array(z.string().max(200)).max(30),
  requestedChanges: z.array(z.string().max(500)).max(30),
  scope: z.enum(["component", "section", "page", "project"]),
  preserve: z.array(z.string().max(300)).max(30),
  conflicts: z.array(z.string().max(500)).max(20),
  requiresReferenceReanalysis: z.boolean(),
}).strict();

export const evaluationSchema = z.object({
  buildFindings: z.array(z.object({ id: z.string().max(100), file: z.string().max(180).optional(), category: z.enum(["parse", "type", "lint", "build", "runtime"]), message: z.string().max(800) })).max(60),
  visualFindings: z.array(z.object({ id: z.string().max(100), severity: z.enum(["critical", "high", "medium", "low"]), region: z.string().max(200), expected: z.string().max(600), observed: z.string().max(600), suggestedDirection: z.string().max(600) })).max(60),
  a11yFindings: z.array(z.object({ id: z.string().max(100), severity: z.string().max(50), message: z.string().max(600), target: z.string().max(200).optional() })).max(60),
  metrics: z.object({ visualScore: z.number().min(0).max(1).optional(), previousVisualScore: z.number().min(0).max(1).optional(), horizontalOverflow: z.boolean() }),
}).strict();

export const finalQaSchema = z.object({
  status: z.enum(["READY", "NOT_READY"]),
  validation: z.object({ syntax: z.enum(["pass", "fail"]), types: z.enum(["pass", "fail"]), imports: z.enum(["pass", "fail"]), accessibility: z.enum(["pass", "pass_with_warnings", "fail"]), security: z.enum(["pass", "fail"]), preview: z.enum(["pass", "fail"]) }),
  blockingIssues: z.array(z.object({ id: z.string().max(100), reason: z.string().max(500) })).max(30),
  conciseSummary: z.string().max(1000).optional(),
}).strict();

export const generationRequestSchema = z.object({
  assetId: z.string().uuid(),
  visualSpec: visualSpecSchema,
  modelId: z.string().max(200).optional(),
  framework: z.enum(["react-tailwind", "nextjs-tailwind"]).default("react-tailwind"),
  targetViewport: z.object({ width: z.number().int().min(280).max(3840), height: z.number().int().min(320).max(4096) }),
});
