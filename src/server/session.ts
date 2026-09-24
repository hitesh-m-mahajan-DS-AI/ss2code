import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

const cookieName = "ss2_owner";

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value && process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be configured in production.");
  return value ?? "development-only-session-secret-change-me";
}

function sign(ownerId: string) {
  return createHmac("sha256", secret()).update(ownerId).digest("base64url");
}

function validCookie(value: string | undefined) {
  if (!value) return undefined;
  const [ownerId, signature] = value.split(".");
  if (!ownerId || !signature) return undefined;
  const expected = Buffer.from(sign(ownerId));
  const supplied = Buffer.from(signature);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied) ? ownerId : undefined;
}

export function ownerForRequest(request: NextRequest) {
  const current = validCookie(request.cookies.get(cookieName)?.value);
  const ownerId = current ?? randomUUID();
  return { ownerId, needsCookie: !current };
}

export function attachOwnerCookie(response: Response, ownerId: string, needsCookie: boolean) {
  if (needsCookie) {
    response.headers.append("Set-Cookie", `${cookieName}=${ownerId}.${sign(ownerId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  }
  return response;
}
