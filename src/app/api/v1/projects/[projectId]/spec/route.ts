import { NextRequest } from "next/server";
import { z } from "zod";
import { analyseAsset } from "@/server/orchestration";
import { assertIdempotencyKey, assertSameOrigin, jsonForOwner, requestOwner, safeError } from "@/server/http";
import { visualSpecSchema, percentBoundsSchema } from "@/lib/schemas";
import { store } from "@/server/repository";

export const runtime = "nodejs";

const bodySchema = z.object({ assetId: z.string().uuid(), userIntent: z.string().max(4000).optional(), lockedRegions: z.array(z.object({ label: z.string().max(120), bounds: percentBoundsSchema })).max(30).optional() });

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

export async function PUT(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    assertSameOrigin(request); assertIdempotencyKey(request);
    const spec = visualSpecSchema.parse(await request.json());
    await store.setSpec((await params).projectId, requestOwner(request).ownerId, spec);
    return jsonForOwner(request, { spec });
  } catch (error) { return jsonForOwner(request, { error: safeError(error) }, 400); }
}
