import { NextRequest } from "next/server";
import { requestOwner, safeError } from "@/server/http";
import { store } from "@/server/repository";

export const runtime = "nodejs";

const terminal = new Set(["ready", "failed", "cancelled"]);

export async function GET(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const owner = requestOwner(request);
    const { jobId } = await params;
    await store.getJob(jobId, owner.ownerId);
    const requestedAfter = Number(request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("after") ?? 0);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let after = Number.isFinite(requestedAfter) ? requestedAfter : 0;
        const send = (event: { sequence: number; type: string; level: string; safeMessage: string; createdAt: string }) => controller.enqueue(encoder.encode(`id: ${event.sequence}\nevent: message\ndata: ${JSON.stringify(event)}\n\n`));
        const tick = async () => {
          try {
            const job = await store.getJob(jobId, owner.ownerId);
            job.events.filter((event) => event.sequence > after).forEach((event) => { after = event.sequence; send(event); });
            if (terminal.has(job.phase)) {
              controller.enqueue(encoder.encode(`event: complete\ndata: ${JSON.stringify({ phase: job.phase, error: job.error, revisionId: job.revisionId })}\n\n`));
              controller.close();
              return;
            }
            setTimeout(tick, 750);
          } catch {
            controller.close();
          }
        };
        void tick();
      },
      cancel() {},
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: safeError(error) }), { status: 404, headers: { "Content-Type": "application/json" } });
  }
}
