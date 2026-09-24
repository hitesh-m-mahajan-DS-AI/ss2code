import { NextRequest } from "next/server";
import { generationRequestSchema } from "@/lib/schemas";
import { startGeneration } from "@/server/orchestration";
import { assertIdempotencyKey, assertSameOrigin, jsonForOwner, requestOwner, safeError } from "@/server/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    assertSameOrigin(request);
    assertIdempotencyKey(request);
    const owner = requestOwner(request);
    const { projectId } = await params;
    const body = generationRequestSchema.parse(await request.json());
    const job = await startGeneration({ ...body, projectId, ownerId: owner.ownerId });
    return jsonForOwner(request, { job }, 202);
  } catch (error) {
    return jsonForOwner(request, { error: safeError(error) }, 400);
  }
}
