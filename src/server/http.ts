import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { attachOwnerCookie, ownerForRequest } from "@/server/session";

export function assertSameOrigin(request: NextRequest) {
  if (request.method === "GET" || process.env.NODE_ENV !== "production") return;
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) throw new Error("Cross-site mutation request rejected.");
}

export function assertIdempotencyKey(request: NextRequest) {
  const key = request.headers.get("idempotency-key");
  if (!key || !/^[a-zA-Z0-9_-]{16,128}$/.test(key)) throw new Error("Every mutation requires a valid Idempotency-Key header.");
  return key;
}

export function jsonForOwner(request: NextRequest, body: unknown, status = 200) {
  const owner = ownerForRequest(request);
  return attachOwnerCookie(NextResponse.json(body, { status }), owner.ownerId, owner.needsCookie);
}

export function requestOwner(request: NextRequest) {
  return ownerForRequest(request);
}

export function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "The request could not be completed.";
  return message.replace(/sk-or-v1-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 900);
}
