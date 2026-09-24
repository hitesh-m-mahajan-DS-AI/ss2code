import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import path from "node:path";

const maxUploadBytes = 16 * 1024 * 1024;
const allowedImageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif"]);
const allowedVideoTypes = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const forbiddenSource = [
  /\beval\s*\(/i,
  /\bnew\s+Function\b/i,
  /dangerouslySetInnerHTML/i,
  /process\.env/i,
  /\bchild_process\b/i,
  /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/i,
  /https?:\/\//i,
  /<script\b/i,
  /\b(?:sk-or-v1|api[_-]?key|secret)\b/i,
];

export function assertUploadSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > maxUploadBytes) {
    throw new Error("The file must be between 1 byte and 16 MB.");
  }
}

export function classifyMime(mimeType: string): "image" | "video" {
  if (allowedImageTypes.has(mimeType)) return "image";
  if (allowedVideoTypes.has(mimeType)) return "video";
  throw new Error("Supported references are PNG, JPG, WebP, AVIF, GIF, MP4, WebM, and MOV.");
}

export function assertMagicBytes(bytes: Buffer, mimeType: string) {
  const header = bytes.subarray(0, 16);
  const isPng = header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const isGif = header.subarray(0, 3).toString("ascii") === "GIF";
  const isWebp = header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP";
  const isAvif = header.subarray(4, 8).toString("ascii") === "ftyp" && /avif|avis/.test(header.subarray(8, 16).toString("ascii"));
  const isMp4 = header.subarray(4, 8).toString("ascii") === "ftyp";
  const isWebm = header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3;
  const isExpected =
    (mimeType === "image/png" && isPng) ||
    (mimeType === "image/jpeg" && isJpeg) ||
    (mimeType === "image/gif" && isGif) ||
    (mimeType === "image/webp" && isWebp) ||
    (mimeType === "image/avif" && isAvif) ||
    (mimeType === "video/webm" && isWebm) ||
    ((mimeType === "video/mp4" || mimeType === "video/quicktime") && isMp4);
  if (!isExpected) throw new Error("The file content does not match its declared type.");
}

export function assertSafeProjectPath(candidate: string) {
  if (!candidate || candidate.length > 180 || candidate.includes("\\") || candidate.startsWith("/") || candidate.startsWith(".") || candidate.includes("\0")) {
    throw new Error(`Unsafe project path: ${candidate}`);
  }
  const normalized = path.posix.normalize(candidate);
  if (normalized === "." || normalized.startsWith("../") || normalized.includes("/../") || normalized.startsWith("/")) {
    throw new Error(`Project paths must remain relative: ${candidate}`);
  }
  return normalized;
}

export function sourcePolicyFindings(pathname: string, content: string, allowedDependencies: string[]) {
  const findings: string[] = [];
  try {
    assertSafeProjectPath(pathname);
  } catch (error) {
    findings.push(error instanceof Error ? error.message : "Unsafe file path.");
  }
  if (content.length > 300_000) findings.push("File exceeds the 300 KB source limit.");
  for (const expression of forbiddenSource) {
    if (expression.test(content)) findings.push(`Blocked source pattern ${expression.toString()} in ${pathname}.`);
  }
  const packageImports = [...content.matchAll(/from\s+["']([^./][^"']*)["']|import\s+["']([^./][^"']*)["']/g)]
    .map((match) => match[1] ?? match[2])
    .filter(Boolean);
  for (const packageName of packageImports) {
    const root = packageName.split("/")[0];
    const scopedRoot = root.startsWith("@") ? packageName.split("/").slice(0, 2).join("/") : root;
    if (!allowedDependencies.includes(scopedRoot)) findings.push(`Unapproved dependency import: ${scopedRoot}.`);
  }
  return findings;
}

function isPrivateAddress(address: string) {
  if (address === "::1" || address === "0.0.0.0" || address.startsWith("fe80:") || address.startsWith("fc") || address.startsWith("fd")) return true;
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export async function assertSafeRemoteUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Only public HTTPS image URLs are accepted.");
  const records = await lookup(url.hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => isPrivateAddress(record.address))) {
    throw new Error("The URL must resolve only to a public address.");
  }
  return url;
}
