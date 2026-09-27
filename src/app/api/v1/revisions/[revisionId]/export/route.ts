import archiver from "archiver";
import { NextRequest } from "next/server";
import { assertSafeProjectPath } from "@/lib/security";
import { requestOwner, safeError, assertSameOrigin, assertIdempotencyKey } from "@/server/http";
import { store } from "@/server/repository";
import { scaffoldProject } from "@/server/scaffold";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ revisionId: string }> }) {
  try {
    assertSameOrigin(request);
    assertIdempotencyKey(request);
    const owner = requestOwner(request);
    const { revisionId } = await params;
    const revision = await store.getRevision(revisionId, owner.ownerId);
    if (!revision.bundleStorageKey) throw new Error("Generate a revision with full build validation before exporting.");
    const files = scaffoldProject(revision.files, revision.filePlan, revision.framework);
    const archive = archiver("zip", { zlib: { level: 9 } });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        archive.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
        archive.on("error", (error: Error) => controller.error(error));
        archive.on("end", () => controller.close());
        for (const file of files) archive.append(file.content, { name: assertSafeProjectPath(file.path), mode: 0o600 });
        void archive.finalize();
      },
      cancel() {
        archive.abort();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="screenshot-to-code-${revision.id}.zip"`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: safeError(error) }, { status: 404 });
  }
}
