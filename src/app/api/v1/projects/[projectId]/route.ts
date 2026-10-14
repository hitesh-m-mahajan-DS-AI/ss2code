import type { NextRequest } from "next/server";
import { ActiveProjectJobError, store } from "@/server/repository";
import { assertSameOrigin, jsonForOwner, requestOwner, safeError } from "@/server/http";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, context: RouteContext<"/api/v1/projects/[projectId]">) {
  try {
    assertSameOrigin(request);
    const { projectId } = await context.params;
    const result = await store.deleteProject(projectId, requestOwner(request).ownerId);
    return jsonForOwner(request, { deleted: true, alreadyAbsent: !result.deleted, cleanupComplete: result.cleanupComplete });
  } catch (error) {
    const status = error instanceof ActiveProjectJobError ? 409 : error instanceof Error && error.message.includes("Cross-site") ? 403 : 404;
    return jsonForOwner(request, { error: safeError(error) }, status);
  }
}
