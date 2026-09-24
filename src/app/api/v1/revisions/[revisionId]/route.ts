import { NextRequest } from "next/server";
import { jsonForOwner, requestOwner, safeError } from "@/server/http";
import { store } from "@/server/repository";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ revisionId: string }> }) {
  try {
    const owner = requestOwner(request);
    const { revisionId } = await params;
    return jsonForOwner(request, { revision: await store.getRevision(revisionId, owner.ownerId) });
  } catch (error) {
    return jsonForOwner(request, { error: safeError(error) }, 404);
  }
}
