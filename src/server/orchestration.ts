import { componentTreePrompt, classifierPrompt, filePlanPrompt, generationPrompt, PROMPT_VERSION, refinementIntentPrompt, repairPlanPrompt, repairPrompt, reviewPrompt, tokenPrompt, userRefinementPrompt, visualReviewPrompt, visualSpecPrompt } from "@/lib/prompts";
import type { Evaluation, FilePlan, GeneratedProject, ManifestFile, Revision, VisualSpec } from "@/lib/domain";
import { accessibilityReviewSchema, componentTreeSchema, designTokensSchema, evaluationSchema, filePlanSchema, finalQaSchema, generatedProjectSchema, issueListSchema, patchSetSchema, referenceClassificationSchema, refinementIntentSchema, repairPlanSchema, visualSpecSchema } from "@/lib/schemas";
import { structuredOpenRouterCall } from "./openrouter";
import { store, type TaskInput } from "./repository";
import { validateGeneratedProject } from "./validation";
import { renderAndCompare } from "./sandbox";
import { jobContext } from "./job-context";
import { compareImages } from "./visual-comparison";
import { assertSourceManifest } from "./scaffold";

type GenerationInput = { projectId: string; ownerId: string; assetId: string; visualSpec: VisualSpec; framework: "react-tailwind" | "nextjs-tailwind"; targetViewport: { width: number; height: number }; modelId?: string };
type RefinementInput = { revisionId: string; ownerId: string; userIntent: string; lockedRegions: Array<{ label: string; bounds: [number, number, number, number] }> };
const event = (jobId: string, type: string, safeMessage: string, level: "info" | "success" | "warning" | "error" = "info") => store.appendEvent(jobId, { type, safeMessage, level });

async function active(jobId: string, ownerId: string) {
  if (jobContext.getStore()?.signal.aborted || (await store.getJob(jobId, ownerId)).cancelledAt) throw new Error("JOB_CANCELLED");
}

export async function analyseAsset(input: { projectId: string; assetId: string; ownerId: string; userIntent?: string; lockedRegions?: Array<{ label: string; bounds: [number, number, number, number] }> }) {
  const asset = await store.getProjectReference(input.projectId, input.ownerId, input.assetId);
  const imageDataUrl = "data:" + asset.mimeType + ";base64," + (await store.readAssetBytes(asset)).toString("base64");
  const classification = await structuredOpenRouterCall({ role: "vision", imageDataUrl, prompt: classifierPrompt({ kind: asset.kind, width: asset.width, height: asset.height, mimeType: asset.mimeType }) });
  const classified = referenceClassificationSchema.parse(classification.value);
  if (classified.readiness !== "ready") throw new Error(classified.nextAction);
  const analysis = await structuredOpenRouterCall<VisualSpec>({ role: "vision", prompt: visualSpecPrompt({ width: asset.width ?? 1440, height: asset.height ?? 900, assetKind: asset.kind, userIntent: input.userIntent, lockedRegions: input.lockedRegions }), imageDataUrl });
  const spec = visualSpecSchema.parse(analysis.value);
  if (asset.width && asset.height) spec.reference.viewport = { width: asset.width, height: asset.height };
  await store.setSpec(input.projectId, input.ownerId, spec);
  return { spec, modelId: analysis.modelId, classification: classified };
}

export async function startGeneration(input: GenerationInput, key?: string) {
  await store.getProjectReference(input.projectId, input.ownerId, input.assetId);
  const job = await store.createJob(input.projectId, input.ownerId, { kind: "generation", ownerId: input.ownerId, data: input }, key);
  await store.setSpec(input.projectId, input.ownerId, input.visualSpec);
  return job;
}

export async function startRefinement(input: RefinementInput, key?: string) {
  const parent = await store.getRevision(input.revisionId, input.ownerId);
  return store.createJob(parent.projectId, input.ownerId, { kind: "refinement", ownerId: input.ownerId, data: input }, key);
}

function applyPatch(files: ManifestFile[], patch: { files: ManifestFile[] }, plan: FilePlan) {
  const permitted = new Set(plan.files.map(file => file.path));
  const changed = new Map<string, ManifestFile>();
  for (const replacement of patch.files) {
    if (!permitted.has(replacement.path) || !files.some(f => f.path === replacement.path) || changed.has(replacement.path)) throw new Error("Repair attempted an unauthorized or duplicate path.");
    changed.set(replacement.path, replacement);
  }
  const result = files.map(file => changed.get(file.path) ?? file);
  assertSourceManifest(result);
  return result;
}

function hardGate(evaluation: Evaluation) {
  return evaluation.buildFindings.length > 0 || evaluation.metrics.horizontalOverflow || evaluation.a11yFindings.some(f => ["critical", "serious"].includes(f.severity)) || evaluation.visualFindings.some(f => f.severity === "critical");
}

async function evaluate(project: GeneratedProject, plan: FilePlan, input: GenerationInput, referenceDataUrl: string) {
  const evaluation = validateGeneratedProject(project, plan);
  if (evaluation.buildFindings.length) throw new Error(JSON.stringify(evaluation.buildFindings));
  assertSourceManifest(project.files);
  const render = await renderAndCompare({ files: project.files, plan, referenceDataUrl, viewport: input.targetViewport, visualSpec: input.visualSpec, framework: input.framework });
  evaluation.a11yFindings.push(...render.a11yFindings);
  evaluation.visualFindings = render.visualFindings;
  evaluation.metrics = render.metrics;
  return { evaluation, render };
}

async function repair(project: GeneratedProject, filePlan: FilePlan, input: GenerationInput, findings: unknown, mode: "build" | "visual", referenceDataUrl: string, pass = 1) {
  const planned = await structuredOpenRouterCall({ role: "repair", prompt: repairPlanPrompt({ findings, files: project.files, filePlan }), requestedModelId: input.modelId });
  const repairPlan = repairPlanSchema.parse(planned.value);
  const response = await structuredOpenRouterCall({ role: "repair", imageDataUrl: mode === "visual" ? referenceDataUrl : undefined, prompt: repairPrompt({ mode, filePlan, files: project.files, findings: { repairPlan, diagnostics: findings, visualSpec: input.visualSpec }, viewport: input.targetViewport, refinementPass: pass }), requestedModelId: input.modelId });
  const patch = patchSetSchema.parse(response.value);
  return { ...project, files: applyPatch(project.files, patch, filePlan), assumptionsApplied: [...project.assumptionsApplied, ...patch.assumptionsChanged] };
}

async function visualReview(evaluation: Evaluation, render: Awaited<ReturnType<typeof renderAndCompare>>, input: GenerationInput, referenceDataUrl: string) {
  const response = await structuredOpenRouterCall({ role: "vision", prompt: visualReviewPrompt({ visualSpec: input.visualSpec, evaluation }), imageDataUrls: [referenceDataUrl, "data:image/png;base64," + render.screenshot.toString("base64")], requestedModelId: input.modelId });
  evaluation.visualFindings.push(...evaluationSchema.parse(response.value).visualFindings);
}

async function publish(jobId: string, input: GenerationInput, project: GeneratedProject, filePlan: FilePlan, checked: Awaited<ReturnType<typeof evaluate>>, extra: Partial<Revision>) {
  await active(jobId, input.ownerId);
  if (hardGate(checked.evaluation)) throw new Error("Blocking validation findings remain. The previous revision is preserved.");
  // Recheck the final files, including any visual repair, instead of dropping
  // supplemental findings when a new deterministic evaluation is constructed.
  const staticReview = issueListSchema.parse((await structuredOpenRouterCall({ role: "review", prompt: reviewPrompt("static", { files: project.files, diagnostics: checked.evaluation.buildFindings }), requestedModelId: input.modelId })).value);
  const a11yReview = accessibilityReviewSchema.parse((await structuredOpenRouterCall({ role: "review", prompt: reviewPrompt("a11y", { visualSpec: input.visualSpec, files: project.files, automatedFindings: checked.render.a11yFindings }), requestedModelId: input.modelId })).value);
  if (staticReview.issues.some(issue => ["critical", "high"].includes(issue.severity)) || a11yReview.issues.some(issue => ["critical", "serious"].includes(issue.severity))) throw new Error("Final source review still has blocking findings. The previous revision is preserved.");
  const qaResponse = await structuredOpenRouterCall({ role: "review", prompt: reviewPrompt("final", { filePlan, files: project.files, visualSpec: input.visualSpec, assumptions: project.assumptionsApplied, evaluation: checked.evaluation, rules: "Deterministic gates cannot be overridden." }), requestedModelId: input.modelId });
  const qa = finalQaSchema.parse(qaResponse.value);
  if (qa.status !== "READY" || Object.values(qa.validation).includes("fail") || qa.blockingIssues.length) throw new Error("Final QA: " + (qa.blockingIssues.map(i => i.reason).join("; ") || "Release gates did not pass."));
  await active(jobId, input.ownerId);
  const job = await store.getJob(jobId, input.ownerId);
  const revision = await store.createRevision({ ...extra, projectId: input.projectId, jobId, framework: input.framework, referenceAssetId: input.assetId, visualSpec: input.visualSpec, promptVersion: PROMPT_VERSION, modelId: job.modelId ?? input.modelId ?? "unknown", modelAudit: job.modelAudit, files: project.files, evaluation: checked.evaluation, assumptions: project.assumptionsApplied, summary: project.summary, filePlan });
  await store.savePreview(revision.id, checked.render.screenshot);
  await store.saveArtifact(revision.id, "bundle", checked.render.html);
  await store.saveArtifact(revision.id, "diff", checked.render.diff);
  await active(jobId, input.ownerId);
  await store.updateJob(jobId, { phase: "ready", revisionId: revision.id });
  await event(jobId, "revision.ready", "Build, browser and accessibility checks passed. Compare the remaining visual findings before exporting.", "success");
}

async function runGeneration(jobId: string, input: GenerationInput) {
  await active(jobId, input.ownerId);
  const asset = await store.getProjectReference(input.projectId, input.ownerId, input.assetId);
  const referenceDataUrl = "data:" + asset.mimeType + ";base64," + (await store.readAssetBytes(asset)).toString("base64");
  await store.updateJob(jobId, { phase: "planning" });
  await event(jobId, "blueprint.started", "Planning components from the confirmed reference.");
  const tokens = designTokensSchema.parse((await structuredOpenRouterCall({ role: "blueprint", prompt: tokenPrompt(input.visualSpec), requestedModelId: input.modelId })).value);
  const tree = componentTreeSchema.parse((await structuredOpenRouterCall({ role: "blueprint", prompt: componentTreePrompt(input.visualSpec, tokens), requestedModelId: input.modelId })).value);
  const plan = filePlanSchema.parse((await structuredOpenRouterCall({ role: "blueprint", prompt: filePlanPrompt(input.visualSpec, tokens, tree, input.framework), requestedModelId: input.modelId })).value);
  assertSourceManifest(plan.files.map(file => ({ path: file.path, content: "" })));
  if (!plan.files.some(file => file.path === plan.entry && file.path.endsWith(".tsx")) || new Set(plan.files.map(file => file.path)).size !== plan.files.length) throw new Error("The component blueprint has an invalid entry or duplicate files.");
  const regions = new Set(input.visualSpec.observations.layout.map(region => region.id));
  if (plan.files.some(file => file.visualRegions.some(region => !regions.has(region)))) throw new Error("The file plan refers to a region outside the confirmed specification.");
  await store.updateJob(jobId, { filePlan: plan, componentTree: tree, phase: "generating" });
  await event(jobId, "blueprint.ready", "Blueprint ready: " + plan.files.length + " files. The component and file tree is available.", "success");
  const generated = await structuredOpenRouterCall<GeneratedProject>({ role: "code", prompt: generationPrompt(input.visualSpec, plan, input.framework, input.targetViewport), requestedModelId: input.modelId, stream: true });
  let project = generatedProjectSchema.parse(generated.value);
  await store.updateJob(jobId, { modelId: generated.modelId, phase: "validating" });
  await event(jobId, "validation.started", "Compiling, linting, rendering and measuring the generated project.");
  let checked: Awaited<ReturnType<typeof evaluate>>;
  try { checked = await evaluate(project, plan, input, referenceDataUrl); }
  catch (error) {
    await event(jobId, "validation.repair", "Build diagnostics are receiving one bounded repair.", "warning");
    project = await repair(project, plan, input, String(error).slice(0, 8000), "build", referenceDataUrl);
    checked = await evaluate(project, plan, input, referenceDataUrl);
  }
  const review = issueListSchema.parse((await structuredOpenRouterCall({ role: "review", prompt: reviewPrompt("static", { files: project.files, diagnostics: checked.evaluation.buildFindings }), requestedModelId: input.modelId })).value);
  const a11y = accessibilityReviewSchema.parse((await structuredOpenRouterCall({ role: "review", prompt: reviewPrompt("a11y", { visualSpec: input.visualSpec, files: project.files, automatedFindings: checked.evaluation.a11yFindings }), requestedModelId: input.modelId })).value);
  checked.evaluation.buildFindings.push(...review.issues.filter(i => ["critical", "high"].includes(i.severity)).map((i, n) => ({ id: "review-" + n, file: i.file, category: "runtime" as const, message: i.explanation })));
  checked.evaluation.a11yFindings.push(...a11y.issues.map((i, n) => ({ id: "review-a11y-" + n, severity: i.severity, message: i.issue, target: i.element })));
  if (checked.evaluation.buildFindings.length || checked.evaluation.a11yFindings.some(f => ["critical", "serious"].includes(f.severity))) {
    project = await repair(project, plan, input, checked.evaluation, "build", referenceDataUrl);
    checked = await evaluate(project, plan, input, referenceDataUrl);
  }
  await store.updateJob(jobId, { phase: "evaluating" });
  await visualReview(checked.evaluation, checked.render, input, referenceDataUrl);
  const max = Math.min(3, Math.max(0, Number(process.env.MAX_REFINEMENT_ITERATIONS ?? 2)));
  for (let pass = 1; pass <= max && checked.evaluation.visualFindings.some(f => ["critical", "high"].includes(f.severity)); pass++) {
    await active(jobId, input.ownerId);
    await store.updateJob(jobId, { phase: "refining" });
    await event(jobId, "refinement.started", "Refining measured differences, pass " + pass + " of " + max + ".");
    const candidate = await repair(project, plan, input, checked.evaluation, "visual", referenceDataUrl, pass);
    try {
      const next = await evaluate(candidate, plan, input, referenceDataUrl);
      await visualReview(next.evaluation, next.render, input, referenceDataUrl);
      if (hardGate(next.evaluation) || next.render.visualScore < checked.render.visualScore) throw new Error("A hard gate failed or pixel agreement declined.");
      next.evaluation.metrics.previousVisualScore = checked.render.visualScore;
      project = candidate; checked = next;
    } catch (error) { await event(jobId, "refinement.reverted", "Patch rejected; keeping the previous candidate. " + String(error).slice(0, 400), "warning"); }
  }
  await publish(jobId, input, project, plan, checked, { componentTree: tree });
}

async function runRefinement(jobId: string, input: RefinementInput) {
  const parent = await store.getRevision(input.revisionId, input.ownerId);
  const spec = parent.visualSpec ?? await store.getSpec(parent.projectId, input.ownerId);
  if (!spec) throw new Error("Reanalyse the reference before refining.");
  const asset = await store.getProjectReference(parent.projectId, input.ownerId, parent.referenceAssetId);
  const generation: GenerationInput = { projectId: parent.projectId, ownerId: input.ownerId, visualSpec: spec, assetId: asset.id, framework: parent.framework ?? "react-tailwind", targetViewport: parent.evaluation.metrics.viewport ?? spec.reference.viewport };
  const referenceDataUrl = "data:" + asset.mimeType + ";base64," + (await store.readAssetBytes(asset)).toString("base64");
  await store.updateJob(jobId, { phase: "refining", filePlan: parent.filePlan, componentTree: parent.componentTree });
  const interpretation = refinementIntentSchema.parse((await structuredOpenRouterCall({ role: "blueprint", prompt: refinementIntentPrompt({ ...input, visualSpec: spec }) })).value);
  if (interpretation.conflicts.length || interpretation.requiresReferenceReanalysis || !interpretation.targets.length) throw new Error(interpretation.conflicts.join("; ") || "The request needs a revised scope or reference.");
  const response = await structuredOpenRouterCall({ role: "repair", prompt: userRefinementPrompt({ ...input, interpretation, visualSpec: spec, currentManifest: parent.files, filePlan: parent.filePlan }) });
  const patch = patchSetSchema.parse(response.value);
  if (!patch.files.length) throw new Error(patch.rationale[0]?.unresolvedReason ?? "No bounded change was produced.");
  const project: GeneratedProject = { summary: parent.summary, files: applyPatch(parent.files, patch, parent.filePlan), assumptionsApplied: [...parent.assumptions, ...patch.assumptionsChanged], interactionNotes: [] };
  const checked = await evaluate(project, parent.filePlan, generation, referenceDataUrl);
  if (input.lockedRegions.length) {
    const locks = input.lockedRegions.map((r, n) => ({ id: String(n), region: r.label, boundsPct: r.bounds, description: "Locked", importance: "critical" as const }));
    const compared = compareImages(await store.readPreview(parent), checked.render.screenshot, locks);
    if (compared.regions.some(r => r.pixelScore < 0.995)) throw new Error("A locked region changed. Patch rejected; the parent revision is preserved.");
  }
  await visualReview(checked.evaluation, checked.render, generation, referenceDataUrl);
  checked.evaluation.metrics.previousVisualScore = parent.evaluation.metrics.visualScore;
  await store.updateJob(jobId, { modelId: response.modelId });
  await publish(jobId, generation, project, parent.filePlan, checked, { parentRevisionId: parent.id, componentTree: parent.componentTree });
}

export async function executeTask(jobId: string, input: TaskInput) {
  await store.checkpoint("ownerId", input.ownerId);
  if (input.kind === "generation") await runGeneration(jobId, input.data as GenerationInput);
  else await runRefinement(jobId, input.data as RefinementInput);
}
