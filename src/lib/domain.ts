export const jobPhases = [
  "queued",
  "ingesting",
  "awaiting_frame_selection",
  "analysing",
  "awaiting_spec_confirmation",
  "planning",
  "generating",
  "validating",
  "rendering",
  "evaluating",
  "refining",
  "ready",
  "cancelling",
  "cancelled",
  "failed",
] as const;

export type JobPhase = (typeof jobPhases)[number];
export type AssetKind = "image" | "video" | "video_frame" | "pdf_page" | "design_export" | "asset_archive";
export type ModelRole = "vision" | "blueprint" | "code" | "review" | "repair";

export type ModelCandidate = {
  id: string;
  family: string;
  inputModalities: string[];
  outputModalities: string[];
  contextLength?: number;
  supportsStructuredOutput?: boolean;
  isFreeCandidate: boolean;
  promptPrice?: string;
  completionPrice?: string;
};

export type VisualSpec = {
  reference: { viewport: { width: number; height: number }; pageType: string; confidence: "high" | "medium" | "low" };
  observations: {
    layout: Array<{ id: string; region: string; boundsPct: [number, number, number, number]; description: string; importance: "critical" | "high" | "normal" }>;
    hierarchy: string[];
    style: {
      palette: Array<{ role: string; value: string; confidence: "high" | "medium" | "low" }>;
      typography: Array<{ role: string; sizePxApprox: number; weight: string; notes: string }>;
      spacing: { basePxApprox: number; notes: string };
      radii: string;
      bordersAndShadows: string;
      imagery: string[];
    };
    visibleInteractions: Array<{ element: string; evidence: string; implementation: string }>;
    responsiveEvidence: string[];
    visibleText: Array<{ region: string; text: string; confidence: "high" | "medium" | "low" }>;
  };
  constraints: { mustMatch: string[]; mustNotInvent: string[]; accessibilityRequirements: string[] };
  assumptions: Array<{ detail: string; conservativeDefault: string; reason: string }>;
  implementationNotes: string[];
};

export type FilePlan = {
  entry: string;
  files: Array<{ path: string; purpose: string; exports: string[]; dependsOn: string[]; visualRegions: string[] }>;
  designTokens: {
    colors: Record<string, string>;
    spacing: Record<string, string>;
    radii: Record<string, string>;
    shadows: Record<string, string>;
    motion: Record<string, string>;
  };
  implementationDecisions: Array<{ decision: string; reason: string }>;
  assumptionsUsed: string[];
};

export type ManifestFile = { path: string; content: string };

export type GeneratedProject = {
  summary: string;
  files: ManifestFile[];
  interactionNotes: Array<{ element: string; behavior: string; accessibility: string }>;
  assumptionsApplied: string[];
};

export type Evaluation = {
  buildFindings: Array<{ id: string; file?: string; category: "parse" | "type" | "lint" | "build" | "runtime"; message: string }>;
  visualFindings: Array<{ id: string; severity: "critical" | "high" | "medium" | "low"; region: string; expected: string; observed: string; suggestedDirection: string }>;
  a11yFindings: Array<{ id: string; severity: string; message: string; target?: string }>;
  metrics: { visualScore?: number; previousVisualScore?: number; horizontalOverflow: boolean };
};

export type JobEvent = { sequence: number; type: string; level: "info" | "success" | "warning" | "error"; safeMessage: string; createdAt: string };

export type Revision = {
  id: string;
  projectId: string;
  parentRevisionId?: string;
  createdAt: string;
  promptVersion: string;
  modelId: string;
  files: ManifestFile[];
  evaluation: Evaluation;
  assumptions: string[];
  summary: string;
  filePlan: FilePlan;
  previewStorageKey?: string;
};

export type GenerationJob = {
  id: string;
  projectId: string;
  phase: JobPhase;
  modelId?: string;
  createdAt: string;
  updatedAt: string;
  events: JobEvent[];
  error?: string;
  revisionId?: string;
  cancelledAt?: string;
};

export type StoredAsset = {
  id: string;
  projectId: string;
  ownerId: string;
  name: string;
  kind: AssetKind;
  mimeType: string;
  bytes: number;
  width?: number;
  height?: number;
  sha256: string;
  storageKey: string;
  createdAt: string;
};
