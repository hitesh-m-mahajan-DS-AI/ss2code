import { NextRequest } from "next/server";
import { jsonForOwner, requestOwner, safeError } from "@/server/http";
import { store } from "@/server/repository";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try { return jsonForOwner(request, await store.snapshot(requestOwner(request).ownerId, request.nextUrl.searchParams.get("project") ?? undefined)); }
  catch (error) { return jsonForOwner(request, { error: safeError(error) }, 404); }
}
