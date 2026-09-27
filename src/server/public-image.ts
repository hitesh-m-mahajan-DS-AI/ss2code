import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { assertMagicBytes, assertUploadSize, classifyMime } from "@/lib/security";

export function isPublicIp(address: string) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  // Permit global unicast only; exclude documentation, transition and benchmark ranges.
  const normalized = address.toLowerCase();
  return isIP(address) === 6 && /^[23]/.test(normalized) && !/^(?:2001:(?:db8|0|2|10|20):|2002:)/.test(normalized);
}

async function fetchPinned(url: URL) {
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Only public HTTPS image URLs are accepted.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const records = await lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some(record => !isPublicIp(record.address))) throw new Error("The image URL must resolve only to public addresses.");
  return new Promise<{ status: number; location?: string; mimeType: string; bytes: Buffer }>((resolve, reject) => {
    // Connect to the checked address, retaining hostname verification and Host.
    // No second DNS resolution is performed by the HTTPS client.
    const req = request({ hostname: records[0].address, family: records[0].family, servername: hostname, path: url.pathname + url.search, method: "GET", headers: { Host: url.host, Accept: "image/png,image/jpeg,image/webp,image/avif,image/gif" } }, response => {
      const status = response.statusCode ?? 500;
      if (status >= 300 && status < 400) { response.resume(); resolve({ status, location: response.headers.location, mimeType: "", bytes: Buffer.alloc(0) }); return; }
      const mimeType = (response.headers["content-type"] ?? "").split(";")[0].toLowerCase();
      try {
        if (status !== 200 || classifyMime(mimeType) !== "image") throw new Error("The URL must return a supported image.");
        if (response.headers["content-length"]) assertUploadSize(Number(response.headers["content-length"]));
      } catch (error) { response.destroy(); reject(error); return; }
      const chunks: Buffer[] = []; let length = 0;
      response.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > 16 * 1024 * 1024) { response.destroy(new Error("The image exceeds 16 MB.")); return; }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve({ status, mimeType, bytes: Buffer.concat(chunks) }));
    });
    const timer = setTimeout(() => req.destroy(new Error("Image download timed out.")), 12_000);
    req.on("close", () => clearTimeout(timer)); req.on("error", reject); req.end();
  });
}

export async function downloadPublicImage(rawUrl: string) {
  let url = new URL(rawUrl);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetchPinned(url);
    if (response.status >= 300 && response.status < 400) {
      if (!response.location) throw new Error("Invalid image redirect.");
      url = new URL(response.location, url); continue;
    }
    assertUploadSize(response.bytes.length); assertMagicBytes(response.bytes, response.mimeType);
    return { bytes: response.bytes, mimeType: response.mimeType, name: (url.pathname.split("/").filter(Boolean).at(-1)?.replace(/[^a-zA-Z0-9._-]/g, "_") ?? "remote-reference").slice(0, 160) };
  }
  throw new Error("The image URL redirected too many times.");
}
