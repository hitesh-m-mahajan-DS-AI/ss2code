import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { assertMagicBytes, assertUploadSize, classifyMime } from "@/lib/security";
import { jsonForOwner, requestOwner, safeError, assertSameOrigin, assertIdempotencyKey } from "@/server/http";
import { store } from "@/server/repository";

export const runtime = "nodejs";

function asDimension(value: FormDataEntryValue | null) {
  const number = Number(value ?? 0);
  return Number.isInteger(number) && number > 0 && number <= 16_384 ? number : undefined;
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertIdempotencyKey(request);
    const owner = requestOwner(request);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose a reference file before uploading.");
    const projectId = String(form.get("projectId") ?? randomUUID());
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(projectId)) throw new Error("Invalid project identifier.");
    const mimeType = file.type.toLowerCase();
    const category = classifyMime(mimeType);
    assertUploadSize(file.size);
    const bytes = Buffer.from(await file.arrayBuffer());
    assertMagicBytes(bytes, mimeType);
    const requestedRole = form.get("role");
    const asset = await store.createAsset({
      projectId,
      ownerId: owner.ownerId,
      name: file.name.replace(/[\\/\0]/g, "_").slice(0, 160) || "reference",
      kind: requestedRole === "video_frame" && category === "image" ? "video_frame" : category,
      mimeType,
      width: asDimension(form.get("width")),
      height: asDimension(form.get("height")),
      bytes: bytes.byteLength,
      bytesData: bytes,
    });
    return jsonForOwner(request, { projectId, asset: { id: asset.id, kind: asset.kind, name: asset.name, mimeType: asset.mimeType, bytes: asset.bytes, width: asset.width, height: asset.height, sha256: asset.sha256 } }, 201);
  } catch (error) {
    return jsonForOwner(request, { error: safeError(error) }, 400);
  }
}
