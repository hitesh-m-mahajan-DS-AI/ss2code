import { NextRequest } from "next/server";
import { z } from "zod";
import { startRefinement } from "@/server/orchestration";
import { assertIdempotencyKey, assertSameOrigin, jsonForOwner, requestOwner, safeError } from "@/server/http";

export const runtime = "nodejs";

const requestSchema = z.object({
  userIntent: z.string().trim().min(2).max(4000),
  lockedRegions: z.array(z.object({ label: z.string().max(120), bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]) })).max(30).default([]),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ revisionId: string }> }) {
  try {
    assertSameOrigin(request);
    assertIdempotencyKey(request);
    const owner = requestOwner(request);
    const { revisionId } = await params;
    const body = requestSchema.parse(await request.json());
    return jsonForOwner(request, { job: await startRefinement({ revisionId, ownerId: owner.ownerId, ...body }) }, 202);
  } catch (error) {
    return jsonForOwner(request, { error: safeError(error) }, 400);
  }
}
