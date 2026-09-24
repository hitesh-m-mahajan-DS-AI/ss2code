import { NextRequest } from "next/server";
import { z } from "zod";
import { analyseAsset } from "@/server/orchestration";
import { assertIdempotencyKey, assertSameOrigin, jsonForOwner, requestOwner, safeError } from "@/server/http";

export const runtime = "nodejs";

const bodySchema = z.object({ assetId: z.string().uuid(), userIntent: z.string().max(4000).optional(), lockedRegions: z.array(z.object({ label: z.string().max(120), bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]) })).max(30).optional() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    assertSameOrigin(request);
    assertIdempotencyKey(request);
    const owner = requestOwner(request);
    const body = bodySchema.parse(await request.json());
    const { projectId } = await params;
    const result = await analyseAsset({ ...body, projectId, ownerId: owner.ownerId });
    return jsonForOwner(request, result);
  } catch (error) {
    return jsonForOwner(request, { error: safeError(error) }, 400);
  }
}
