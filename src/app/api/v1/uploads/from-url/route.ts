import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { downloadPublicImage } from "@/server/public-image";
import { assertIdempotencyKey, assertSameOrigin, jsonForOwner, requestOwner, safeError } from "@/server/http";
import { store } from "@/server/repository";

export const runtime = "nodejs";

const requestSchema = z.object({ url: z.string().url().max(2048), projectId: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/).optional() });


export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertIdempotencyKey(request);
    const body = requestSchema.parse(await request.json());
    const owner = requestOwner(request);
    const downloaded = await downloadPublicImage(body.url);
    const projectId = body.projectId ?? randomUUID();
    const asset = await store.createAsset({ projectId, ownerId: owner.ownerId, name: downloaded.name, kind: "image", mimeType: downloaded.mimeType, bytes: downloaded.bytes.byteLength, bytesData: downloaded.bytes });
    return jsonForOwner(request, { projectId, asset: { id: asset.id, kind: asset.kind, name: asset.name, mimeType: asset.mimeType, bytes: asset.bytes, sha256: asset.sha256 } }, 201);
  } catch (error) {
    return jsonForOwner(request, { error: safeError(error) }, 400);
  }
}
