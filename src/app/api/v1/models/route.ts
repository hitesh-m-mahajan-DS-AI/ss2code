import { NextRequest } from "next/server";
import { getLiveModelCatalog } from "@/server/openrouter";
import { jsonForOwner, safeError } from "@/server/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const models = await getLiveModelCatalog();
    return jsonForOwner(request, { models: models.filter((model) => model.isFreeCandidate) });
  } catch (error) {
    return jsonForOwner(request, { error: safeError(error) }, 503);
  }
}
