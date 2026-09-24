import { NextRequest, NextResponse } from "next/server";
import { requestOwner, safeError } from "@/server/http";
import { store } from "@/server/repository";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  try {
    const owner = requestOwner(request);
    const { assetId } = await params;
    const asset = await store.getAsset(assetId, owner.ownerId);
    const content = await store.readAssetBytes(asset);
    return new NextResponse(content, { headers: { "Content-Type": asset.mimeType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return NextResponse.json({ error: safeError(error) }, { status: 404 });
  }
}
