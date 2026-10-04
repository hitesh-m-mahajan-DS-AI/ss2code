import type { StoredAsset } from "@/lib/domain";
import { referenceClassificationSchema } from "@/lib/schemas";

/** P01 uses validated server metadata. Design/state interpretation belongs to P02. */
export function classifyValidatedReference(asset: Pick<StoredAsset, "kind" | "mimeType" | "width" | "height">) {
  const base = { kind: asset.kind, likelyRole: "unknown" as const, safeNotes: ["File type and dimensions are measured server-side; page design and related-state role are not inferred."] };
  if (asset.kind === "video") return referenceClassificationSchema.parse({ ...base, readiness: "needs_frame_selection", nextAction: "Select and upload a decoded video frame before visual analysis." });
  if (asset.kind === "pdf_page") return referenceClassificationSchema.parse({ ...base, readiness: "needs_page_selection", nextAction: "Upload a rendered page image; direct PDF ingestion is not supported." });
  const image = ["image", "video_frame"].includes(asset.kind) && /^image\/(png|jpeg|webp|avif|gif)$/.test(asset.mimeType);
  const dimensions = Number.isInteger(asset.width) && Number.isInteger(asset.height) && asset.width! >= 280 && asset.width! <= 3840 && asset.height! >= 320 && asset.height! <= 4096;
  if (!image || !dimensions) return referenceClassificationSchema.parse({ ...base, readiness: "rejected", nextAction: "Upload a supported image/frame with an original viewport 280–3840px wide and 320–4096px high. Crop large references; scoring never stretches them." });
  return referenceClassificationSchema.parse({ ...base, readiness: "ready", nextAction: "Inspect the reference and confirm its visible design, state and assumptions." });
}

export function assertReferenceViewports(asset: Pick<StoredAsset, "width" | "height">, ...viewports: Array<{ width: number; height: number }>) {
  if (!asset.width || !asset.height || viewports.some(v => v.width !== asset.width || v.height !== asset.height)) throw new Error("The specification and target viewport must match the reference's original measured dimensions. Reinspect or crop the reference; scoring never stretches it.");
}
