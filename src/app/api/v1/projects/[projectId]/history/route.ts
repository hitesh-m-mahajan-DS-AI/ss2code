import { NextRequest } from "next/server";
import { jsonForOwner, requestOwner, safeError } from "@/server/http";
import { store } from "@/server/repository";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const owner = requestOwner(request);
    const { projectId } = await params;
    return jsonForOwner(request, { revisions: await store.listRevisions(projectId, owner.ownerId) });
  } catch (error) {
    return jsonForOwner(request, { error: safeError(error) }, 404);
  }
}
