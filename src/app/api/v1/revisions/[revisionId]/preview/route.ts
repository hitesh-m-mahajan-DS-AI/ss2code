import { NextRequest, NextResponse } from "next/server";
import { requestOwner, safeError } from "@/server/http";
import { store } from "@/server/repository";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ revisionId: string }> }) {
  try {
    const owner = requestOwner(request);
    const { revisionId } = await params;
    const revision = await store.getRevision(revisionId, owner.ownerId);
    const image = await store.readPreview(revision);
    return new NextResponse(image, { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return NextResponse.json({ error: safeError(error) }, { status: 404 });
  }
}
