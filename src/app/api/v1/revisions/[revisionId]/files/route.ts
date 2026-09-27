import { NextRequest } from "next/server";
import { requestOwner, safeError } from "@/server/http";
import { store } from "@/server/repository";
import { scaffoldProject } from "@/server/scaffold";
export const runtime = "nodejs";
export async function GET(request: NextRequest, { params }: { params: Promise<{ revisionId: string }> }) {
  try { const revision = await store.getRevision((await params).revisionId, requestOwner(request).ownerId); return Response.json({ files: scaffoldProject(revision.files, revision.filePlan, revision.framework) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return Response.json({ error: safeError(error) }, { status: 404 }); }
}
