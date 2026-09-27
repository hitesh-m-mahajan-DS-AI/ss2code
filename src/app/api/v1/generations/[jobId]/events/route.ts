import { NextRequest } from "next/server";
import { requestOwner, safeError } from "@/server/http";
import { store } from "@/server/repository";
export const runtime = "nodejs";
export async function GET(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const owner = requestOwner(request), { jobId } = await params;
    await store.getJob(jobId, owner.ownerId);
    let after = Number(request.headers.get("last-event-id") ?? request.nextUrl.searchParams.get("after") ?? 0) || 0;
    let closed = false, timer: ReturnType<typeof setTimeout> | undefined;
    const encoder = new TextEncoder();
    const stop = () => { closed = true; clearTimeout(timer); };
    const stream = new ReadableStream({
      start(controller) {
        request.signal.addEventListener("abort", stop, { once: true });
        const tick = async () => {
          if (closed) return;
          try {
            const job = await store.getJob(jobId, owner.ownerId);
            if (closed) return;
            for (const event of job.events.filter(e => e.sequence > after)) {
              after = event.sequence;
              controller.enqueue(encoder.encode("id: " + after + "\nevent: message\ndata: " + JSON.stringify(event) + "\n\n"));
            }
            controller.enqueue(encoder.encode("event: state\ndata: " + JSON.stringify({ ...job, events: undefined }) + "\n\n"));
            if (["ready", "failed", "cancelled"].includes(job.phase)) {
              controller.enqueue(encoder.encode("event: complete\ndata: " + JSON.stringify({ phase: job.phase, revisionId: job.revisionId, error: job.error }) + "\n\n"));
              stop(); controller.close(); return;
            }
            timer = setTimeout(tick, 1000);
          } catch { if (!closed) { stop(); controller.close(); } }
        };
        void tick();
      },
      cancel: stop,
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
  } catch (error) { return Response.json({ error: safeError(error) }, { status: 404 }); }
}
