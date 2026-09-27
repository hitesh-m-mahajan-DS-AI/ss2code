import { NextRequest } from "next/server";
import { requestOwner, safeError } from "@/server/http";
import { store } from "@/server/repository";
export const runtime = "nodejs";
export async function GET(request: NextRequest, { params }: { params: Promise<{ revisionId: string }> }) {
  try {
    const revision = await store.getRevision((await params).revisionId, requestOwner(request).ownerId);
    const kind = request.nextUrl.searchParams.get("kind") === "diff" ? "diff" : "bundle";
    const content = await store.readArtifact(revision, kind);
    return new Response(new Uint8Array(content), { headers: { "Content-Type": kind === "diff" ? "image/png" : "text/plain; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" } });
  } catch (error) { return Response.json({ error: safeError(error) }, { status: 404 }); }
}
