import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { assertMagicBytes, assertSafeRemoteUrl, assertUploadSize, classifyMime } from "@/lib/security";
import { assertIdempotencyKey, assertSameOrigin, jsonForOwner, requestOwner, safeError } from "@/server/http";
import { store } from "@/server/repository";

export const runtime = "nodejs";

const requestSchema = z.object({ url: z.string().url().max(2048), projectId: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/).optional() });

async function downloadPublicImage(rawUrl: string) {
  let url = await assertSafeRemoteUrl(rawUrl);
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(url, { redirect: "manual", signal: controller.signal, headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" } });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("The image URL returned an invalid redirect.");
        url = await assertSafeRemoteUrl(new URL(location, url).toString());
        continue;
      }
      if (!response.ok) throw new Error(`The image URL could not be downloaded (${response.status}).`);
      const mimeType = (response.headers.get("content-type") ?? "").split(";")[0].toLowerCase();
      classifyMime(mimeType);
      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength) assertUploadSize(declaredLength);
      const buffer = Buffer.from(await response.arrayBuffer());
      assertUploadSize(buffer.byteLength);
      assertMagicBytes(buffer, mimeType);
      return { bytes: buffer, mimeType, name: pathName(url.pathname) };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("The image URL redirected too many times.");
}

function pathName(pathname: string) {
  const name = pathname.split("/").filter(Boolean).at(-1);
  return (name?.replace(/[^a-zA-Z0-9._-]/g, "_") || "remote-reference").slice(0, 160);
}

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
