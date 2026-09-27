import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import type { VisualSpec } from "@/lib/domain";

export function compareImages(reference: Buffer, preview: Buffer, regions: VisualSpec["observations"]["layout"] = []) {
  const left = PNG.sync.read(reference), right = PNG.sync.read(preview);
  if (left.width !== right.width || left.height !== right.height) throw new Error("Reference and capture dimensions must match; comparison cannot stretch the reference.");
  const diff = new PNG({ width: left.width, height: left.height });
  const changed = pixelmatch(left.data, right.data, diff.data, left.width, left.height, { threshold: 0.16, includeAA: false });
  const scores = regions.map(region => {
    const [x, y, w, h] = region.boundsPct;
    const x0 = Math.max(0, Math.min(left.width - 1, Math.round(x / 100 * left.width)));
    const y0 = Math.max(0, Math.min(left.height - 1, Math.round(y / 100 * left.height)));
    const width = Math.max(1, Math.min(left.width - x0, Math.round(w / 100 * left.width)));
    const height = Math.max(1, Math.min(left.height - y0, Math.round(h / 100 * left.height)));
    const a = new PNG({ width, height }), b = new PNG({ width, height });
    PNG.bitblt(left, a, x0, y0, width, height, 0, 0); PNG.bitblt(right, b, x0, y0, width, height, 0, 0);
    const mismatch = pixelmatch(a.data, b.data, undefined, width, height, { threshold: 0.16, includeAA: false });
    return { region: region.id, pixelScore: 1 - mismatch / (width * height) };
  });
  return { score: 1 - changed / (left.width * left.height), regions: scores, diff: PNG.sync.write(diff) };
}
