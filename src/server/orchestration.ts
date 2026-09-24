import { componentTreePrompt, classifierPrompt, filePlanPrompt, generationPrompt, PROMPT_VERSION, refinementIntentPrompt, repairPlanPrompt, repairPrompt, reviewPrompt, tokenPrompt, userRefinementPrompt, visualReviewPrompt, visualSpecPrompt } from "@/lib/prompts";
import type { Evaluation, FilePlan, GeneratedProject, ManifestFile, VisualSpec } from "@/lib/domain";
import { accessibilityReviewSchema, componentTreeSchema, designTokensSchema, evaluationSchema, filePlanSchema, finalQaSchema, generatedProjectSchema, issueListSchema, patchSetSchema, referenceClassificationSchema, refinementIntentSchema, repairPlanSchema, visualSpecSchema } from "@/lib/schemas";
import { structuredOpenRouterCall } from "@/server/openrouter";
import { store } from "@/server/repository";
import { validateGeneratedProject } from "@/server/validation";
import { renderAndCompare } from "@/server/sandbox";

async function event(jobId: string, type: string, safeMessage: string, level: "info" | "success" | "warning" | "error" = "info") {
  await store.appendEvent(jobId, { type, safeMessage, level });
}

async function ensureJobActive(jobId: string, ownerId: string) {
  const current = await store.getJob(jobId, ownerId);
  if (current.cancelledAt || current.phase === "cancelling" || current.phase === "cancelled") {
    await store.updateJob(jobId, { phase: "cancelled" });
    await event(jobId, "generation.cancelled", "The job was cancelled safely. No new revision was created.", "warning");
    throw new Error("JOB_CANCELLED");
  }
}

export async function analyseAsset(input: { projectId: string; assetId: string; ownerId: string; userIntent?: string; lockedRegions?: Array<{ label: string; bounds: [number, number, number, number] }> }) {
  const asset = await store.getAsset(input.assetId, input.ownerId);
  if (asset.projectId !== input.projectId) throw new Error("The selected reference does not belong to this project.");
  if (asset.kind !== "image" && asset.kind !== "video_frame") throw new Error("Choose an extracted video frame before visual analysis.");
  const bytes = await store.readAssetBytes(asset);
  const imageDataUrl = `data:${asset.mimeType};base64,${bytes.toString("base64")}`;
  const classification = await structuredOpenRouterCall({
    role: "vision",
    prompt: classifierPrompt({ kind: asset.kind, name: asset.name, mimeType: asset.mimeType, bytes: asset.bytes, width: asset.width, height: asset.height }),
  });
  referenceClassificationSchema.parse(classification.value);
  const analysis = await structuredOpenRouterCall<VisualSpec>({
    role: "vision",
    prompt: visualSpecPrompt({ width: asset.width ?? 1440, height: asset.height ?? 900, assetKind: asset.kind, userIntent: input.userIntent, lockedRegions: input.lockedRegions }),
    imageDataUrl,
  });
  const spec = visualSpecSchema.parse(analysis.value);
  await store.setSpec(asset.projectId, input.ownerId, spec);
  return { spec, modelId: analysis.modelId, classification: classification.value };
}

export async function startGeneration(input: { projectId: string; ownerId: string; assetId: string; visualSpec: VisualSpec; framework: "react-tailwind" | "nextjs-tailwind"; targetViewport: { width: number; height: number }; modelId?: string }) {
  await store.setSpec(input.projectId, input.ownerId, input.visualSpec);
  const job = await store.createJob(input.projectId, input.ownerId);
  void runGeneration(job.id, input).catch(async (error) => {
    const safeMessage = error instanceof Error ? error.message.replace(/sk-or-v1-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 800) : "The generation failed unexpectedly.";
    if (safeMessage === "JOB_CANCELLED") return;
    await store.updateJob(job.id, { phase: "failed", error: safeMessage });
    await event(job.id, "generation.failed", safeMessage, "error");
  });
  return job;
}

function applyPatch(files: ManifestFile[], patch: { files: ManifestFile[] }, plan: FilePlan) {
  const permitted = new Set(plan.files.map((file) => file.path));
  const byPath = new Map(files.map((file) => [file.path, file]));
  for (const replacement of patch.files) {
    if (!permitted.has(replacement.path) || !byPath.has(replacement.path)) throw new Error(`Repair attempted an unauthorized path: ${replacement.path}`);
    byPath.set(replacement.path, replacement);
  }
  return files.map((file) => byPath.get(file.path) ?? file);
}

async function repairFiles(input: { mode: "build" | "visual"; files: ManifestFile[]; plan: FilePlan; findings: unknown; modelId?: string; viewport: { width: number; height: number }; refinementPass?: number }) {
  const planResponse = await structuredOpenRouterCall({ role: "repair", prompt: repairPlanPrompt({ findings: input.findings, files: input.files, filePlan: input.plan }), requestedModelId: input.modelId });
  const repairPlan = repairPlanSchema.parse(planResponse.value);
  const patchResponse = await structuredOpenRouterCall({ role: "repair", prompt: repairPrompt({ mode: input.mode, filePlan: input.plan, files: input.files, findings: { repairPlan, diagnostics: input.findings }, refinementPass: input.refinementPass, viewport: input.viewport }), requestedModelId: input.modelId });
  const patch = patchSetSchema.parse(patchResponse.value);
  return { files: applyPatch(input.files, patch, input.plan), patch };
}

async function runGeneration(jobId: string, input: { projectId: string; ownerId: string; assetId: string; visualSpec: VisualSpec; framework: "react-tailwind" | "nextjs-tailwind"; targetViewport: { width: number; height: number }; modelId?: string }) {
  const setPhase = async (phase: "planning" | "generating" | "validating" | "evaluating" | "ready") => store.updateJob(jobId, { phase });
  await ensureJobActive(jobId, input.ownerId);
  await setPhase("planning");
  await event(jobId, "blueprint.started", "Normalizing observed design tokens.");
  const tokenResponse = await structuredOpenRouterCall({ role: "blueprint", prompt: tokenPrompt(input.visualSpec), requestedModelId: input.modelId });
  await ensureJobActive(jobId, input.ownerId);
  const tokens = designTokensSchema.parse(tokenResponse.value);
  await event(jobId, "blueprint.tokens_ready", "Design tokens are ready.", "success");
  const treeResponse = await structuredOpenRouterCall({ role: "blueprint", prompt: componentTreePrompt(input.visualSpec, tokens), requestedModelId: input.modelId });
  await ensureJobActive(jobId, input.ownerId);
  const tree = componentTreeSchema.parse(treeResponse.value);
  const planResponse = await structuredOpenRouterCall<FilePlan>({ role: "blueprint", prompt: filePlanPrompt(input.visualSpec, tokens, tree, input.framework), requestedModelId: input.modelId });
  await ensureJobActive(jobId, input.ownerId);
  const filePlan = filePlanSchema.parse(planResponse.value);
  await event(jobId, "blueprint.ready", `Component and file plan contains ${filePlan.files.length} files.`, "success");

  await setPhase("generating");
  await event(jobId, "generation.started", "Generating the approved file manifest.");
  const generation = await structuredOpenRouterCall<GeneratedProject>({ role: "code", prompt: generationPrompt(input.visualSpec, filePlan, input.framework, input.targetViewport), requestedModelId: input.modelId, stream: true });
  await ensureJobActive(jobId, input.ownerId);
  let project = generatedProjectSchema.parse(generation.value);
  await store.updateJob(jobId, { modelId: generation.modelId });
  await event(jobId, "generation.files_ready", `Received ${project.files.length} source files.`, "success");

  await setPhase("validating");
  await event(jobId, "validation.started", "Checking file paths, source safety, imports, syntax, and accessibility.");
  let evaluation = validateGeneratedProject(project, filePlan);
  const staticReview = await structuredOpenRouterCall({ role: "review", prompt: reviewPrompt("static", { files: project.files, diagnostics: evaluation.buildFindings }), requestedModelId: input.modelId });
  await ensureJobActive(jobId, input.ownerId);
  const review = issueListSchema.parse(staticReview.value);
  for (const issue of review.issues.filter((item) => item.severity === "critical" || item.severity === "high")) {
    evaluation.buildFindings.push({ id: `model-${evaluation.buildFindings.length}`, file: issue.file, category: issue.category === "security" ? "runtime" : "build", message: issue.explanation });
  }
  if (evaluation.buildFindings.length) {
    await event(jobId, "validation.repairing", `${evaluation.buildFindings.length} validation issue${evaluation.buildFindings.length === 1 ? "" : "s"} will receive one bounded repair.`, "warning");
    const repaired = await repairFiles({ mode: "build", files: project.files, plan: filePlan, findings: evaluation.buildFindings, modelId: input.modelId, viewport: input.targetViewport });
    await ensureJobActive(jobId, input.ownerId);
    project = { ...project, files: repaired.files, assumptionsApplied: [...project.assumptionsApplied, ...repaired.patch.assumptionsChanged] };
    evaluation = validateGeneratedProject(project, filePlan);
    if (evaluation.buildFindings.length) throw new Error("The bounded build repair did not pass validation. The previous ready revision remains unchanged.");
    await event(jobId, "validation.repaired", "The bounded build repair now passes static validation.", "success");
  }
  const accessibilityReview = await structuredOpenRouterCall({ role: "review", prompt: reviewPrompt("a11y", { visualSpec: input.visualSpec, files: project.files, automatedFindings: evaluation.a11yFindings }), requestedModelId: input.modelId });
  await ensureJobActive(jobId, input.ownerId);
  const a11y = accessibilityReviewSchema.parse(accessibilityReview.value);
  evaluation.a11yFindings.push(...a11y.issues.map((issue, index) => ({ id: `review-a11y-${index}`, severity: issue.severity, message: issue.issue, target: issue.element })));
  if (evaluation.a11yFindings.some((finding) => ["critical", "serious"].includes(finding.severity))) throw new Error("Accessibility review found a serious issue that must be corrected before a revision is ready.");
  await event(jobId, "validation.passed", "Static source and accessibility checks passed.", "success");

  await setPhase("evaluating");
  await event(jobId, "preview.started", "Rendering the generated project inside an isolated, network-restricted browser.");
  const asset = await store.getProjectReference(input.projectId, input.ownerId, input.assetId);
  const referenceDataUrl = `data:${asset.mimeType};base64,${(await store.readAssetBytes(asset)).toString("base64")}`;
  let render = await renderAndCompare({ files: project.files, plan: filePlan, referenceDataUrl, viewport: input.targetViewport });
  await ensureJobActive(jobId, input.ownerId);
  evaluation.metrics.visualScore = render.visualScore;
  evaluation.visualFindings = render.visualFindings;
  const visualReview = await structuredOpenRouterCall<Evaluation>({ role: "vision", prompt: visualReviewPrompt({ visualSpec: input.visualSpec, evaluation, viewport: input.targetViewport }), imageDataUrls: [referenceDataUrl, `data:image/png;base64,${render.screenshot.toString("base64")}`], requestedModelId: input.modelId });
  await ensureJobActive(jobId, input.ownerId);
  const reviewed = evaluationSchema.parse(visualReview.value);
  evaluation.visualFindings.push(...reviewed.visualFindings);
  await event(jobId, "preview.ready", `Preview captured with an initial visual score of ${Math.round(render.visualScore * 100)}%.`, "success");

  const maxRefinements = Math.min(3, Math.max(0, Number(process.env.MAX_REFINEMENT_ITERATIONS ?? 3)));
  for (let pass = 1; pass <= maxRefinements && evaluation.visualFindings.some((finding) => finding.severity === "critical" || finding.severity === "high"); pass += 1) {
    await store.updateJob(jobId, { phase: "refining" });
    await event(jobId, "refinement.started", `Making focused visual refinement ${pass} of ${maxRefinements}.`);
    const repaired = await repairFiles({ mode: "visual", files: project.files, plan: filePlan, findings: evaluation.visualFindings, modelId: input.modelId, viewport: input.targetViewport, refinementPass: pass });
    await ensureJobActive(jobId, input.ownerId);
    const candidateProject = { ...project, files: repaired.files, assumptionsApplied: [...project.assumptionsApplied, ...repaired.patch.assumptionsChanged] };
    const candidateEvaluation = validateGeneratedProject(candidateProject, filePlan);
    if (candidateEvaluation.buildFindings.length) {
      await event(jobId, "refinement.reverted", "A visual patch was rejected because it violated a hard validation gate.", "warning");
      continue;
    }
    const candidateRender = await renderAndCompare({ files: candidateProject.files, plan: filePlan, referenceDataUrl, viewport: input.targetViewport });
    await ensureJobActive(jobId, input.ownerId);
    if (candidateRender.visualScore < render.visualScore) {
      await event(jobId, "refinement.reverted", "A visual patch was reverted because the deterministic comparison score declined.", "warning");
      continue;
    }
    project = candidateProject;
    render = candidateRender;
    evaluation = { ...candidateEvaluation, visualFindings: candidateRender.visualFindings, metrics: { visualScore: candidateRender.visualScore, previousVisualScore: evaluation.metrics.visualScore, horizontalOverflow: false } };
    await event(jobId, "refinement.accepted", `Refinement ${pass} improved or preserved the visual comparison score.`, "success");
  }

  const finalQa = await structuredOpenRouterCall({ role: "review", prompt: reviewPrompt("final", { filePlan, evaluation, rules: "A preview failure means NOT_READY." }), requestedModelId: input.modelId });
  await ensureJobActive(jobId, input.ownerId);
  const qa = finalQaSchema.parse(finalQa.value);
  if (qa.status !== "READY" || qa.validation.preview !== "pass") throw new Error("Final QA found remaining blocking issues. The previous ready revision remains unchanged.");
  const revision = await store.createRevision({ projectId: input.projectId, promptVersion: PROMPT_VERSION, modelId: generation.modelId, files: project.files, evaluation, assumptions: project.assumptionsApplied, summary: project.summary, filePlan });
  await store.savePreview(revision.id, render.screenshot);
  await store.updateJob(jobId, { phase: "ready", revisionId: revision.id });
  await event(jobId, "revision.ready", "Revision is ready for preview and export.", "success");
}

export async function startRefinement(input: { revisionId: string; ownerId: string; userIntent: string; lockedRegions: Array<{ label: string; bounds: [number, number, number, number] }> }) {
  const parent = await store.getRevision(input.revisionId, input.ownerId);
  const job = await store.createJob(parent.projectId, input.ownerId);
  void runRefinement(job.id, parent, input).catch(async (error) => {
    const safeMessage = error instanceof Error ? error.message.replace(/sk-or-v1-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 800) : "The refinement failed unexpectedly.";
    if (safeMessage === "JOB_CANCELLED") return;
    await store.updateJob(job.id, { phase: "failed", error: safeMessage });
    await event(job.id, "refinement.failed", safeMessage, "error");
  });
  return job;
}

async function runRefinement(jobId: string, parent: import("@/lib/domain").Revision, input: { revisionId: string; ownerId: string; userIntent: string; lockedRegions: Array<{ label: string; bounds: [number, number, number, number] }> }) {
  await ensureJobActive(jobId, input.ownerId);
  await store.updateJob(jobId, { phase: "refining", modelId: parent.modelId });
  await event(jobId, "refinement.intent_started", "Interpreting the requested bounded change.");
  const spec = await store.getSpec(parent.projectId, input.ownerId);
  if (!spec) throw new Error("The approved Visual Spec is unavailable; reanalyse the reference before refining.");
  const interpretationResponse = await structuredOpenRouterCall({ role: "blueprint", prompt: refinementIntentPrompt({ userIntent: input.userIntent, lockedRegions: input.lockedRegions, visualSpec: spec, currentManifest: parent.files }), requestedModelId: parent.modelId });
  await ensureJobActive(jobId, input.ownerId);
  const interpretation = refinementIntentSchema.parse(interpretationResponse.value);
  if (interpretation.conflicts.length || interpretation.requiresReferenceReanalysis || !interpretation.targets.length) throw new Error(interpretation.conflicts[0] ?? "This request exceeds the confirmed reconstruction scope and needs an explicit scope expansion.");
  await event(jobId, "refinement.intent_ready", `Targeting ${interpretation.targets.join(", ")}.`, "success");
  const patchResponse = await structuredOpenRouterCall({ role: "repair", prompt: userRefinementPrompt({ userIntent: input.userIntent, interpretation, visualSpec: spec, currentManifest: parent.files, lockedRegions: input.lockedRegions, filePlan: parent.filePlan }), requestedModelId: parent.modelId });
  await ensureJobActive(jobId, input.ownerId);
  const patch = patchSetSchema.parse(patchResponse.value);
  if (!patch.files.length) throw new Error(patch.rationale[0]?.unresolvedReason ?? "No safe bounded code change was produced for this refinement request.");
  const files = applyPatch(parent.files, patch, parent.filePlan);
  const candidate: GeneratedProject = { summary: parent.summary, files, interactionNotes: [], assumptionsApplied: [...parent.assumptions, ...patch.assumptionsChanged] };
  let evaluation = validateGeneratedProject(candidate, parent.filePlan);
  if (evaluation.buildFindings.length) throw new Error("The refinement patch was rejected by the static validation gate; the parent revision remains available.");
  if (evaluation.a11yFindings.some((finding) => ["critical", "serious"].includes(finding.severity))) throw new Error("The refinement patch introduced a serious accessibility issue and was rejected.");
  await store.updateJob(jobId, { phase: "rendering" });
  const asset = await store.getProjectReference(parent.projectId, input.ownerId);
  const referenceDataUrl = `data:${asset.mimeType};base64,${(await store.readAssetBytes(asset)).toString("base64")}`;
  const render = await renderAndCompare({ files, plan: parent.filePlan, referenceDataUrl, viewport: spec.reference.viewport });
  await ensureJobActive(jobId, input.ownerId);
  evaluation = { ...evaluation, visualFindings: render.visualFindings, metrics: { visualScore: render.visualScore, previousVisualScore: parent.evaluation.metrics.visualScore, horizontalOverflow: false } };
  const qaResponse = await structuredOpenRouterCall({ role: "review", prompt: reviewPrompt("final", { evaluation, parent: parent.id, requestedChanges: interpretation.requestedChanges, rules: "A preview failure means NOT_READY." }), requestedModelId: parent.modelId });
  await ensureJobActive(jobId, input.ownerId);
  const qa = finalQaSchema.parse(qaResponse.value);
  if (qa.status !== "READY" || qa.validation.preview !== "pass" || evaluation.visualFindings.some((finding) => finding.severity === "critical")) throw new Error("Final QA retained the previous revision because this refinement has unresolved blocking evidence.");
  const revision = await store.createRevision({ projectId: parent.projectId, parentRevisionId: parent.id, promptVersion: PROMPT_VERSION, modelId: parent.modelId, files, evaluation, assumptions: candidate.assumptionsApplied, summary: parent.summary, filePlan: parent.filePlan });
  await store.savePreview(revision.id, render.screenshot);
  await store.updateJob(jobId, { phase: "ready", revisionId: revision.id });
  await event(jobId, "revision.ready", "Refined immutable revision is ready for comparison and export.", "success");
}
