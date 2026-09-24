import { NextRequest } from "next/server";
import { assertIdempotencyKey, assertSameOrigin, jsonForOwner, requestOwner, safeError } from "@/server/http";
import { store } from "@/server/repository";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    assertSameOrigin(request);
    assertIdempotencyKey(request);
    const owner = requestOwner(request);
    const { jobId } = await params;
    return jsonForOwner(request, { job: await store.getJob(jobId, owner.ownerId) });
  } catch (error) {
    return jsonForOwner(request, { error: safeError(error) }, 404);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const owner = requestOwner(request);
    const { jobId } = await params;
    const job = await store.getJob(jobId, owner.ownerId);
    await store.updateJob(job.id, { phase: "cancelling", cancelledAt: new Date().toISOString() });
    await store.appendEvent(job.id, { type: "generation.cancelling", level: "warning", safeMessage: "Cancellation requested. The current provider call will finish safely before work stops." });
    return jsonForOwner(request, { ok: true });
  } catch (error) {
    return jsonForOwner(request, { error: safeError(error) }, 404);
  }
}
