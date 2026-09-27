import { NextRequest } from "next/server";
import { assertSameOrigin, assertIdempotencyKey, requestOwner, jsonForOwner, safeError } from "@/server/http";
import { store } from "@/server/repository";
export const runtime = "nodejs";
export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try { assertSameOrigin(request); const key = assertIdempotencyKey(request); return jsonForOwner(request, { job: await store.retry((await params).jobId, requestOwner(request).ownerId, key) }, 202); }
  catch (error) { return jsonForOwner(request, { error: safeError(error) }, 400); }
}
