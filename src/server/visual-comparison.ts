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
    // Broad AI-labelled regions can contain mostly whitespace, making a missing
    // heading look like a 99% pixel match. Compare the spatial support of visible
    // foreground as a second signal. Estimate each crop's local background from its
    // border so the score tolerates different page colors and small color drift.
    const foreground = (image: PNG) => {
      const border: Array<[number, number, number]> = [];
      for (let x = 0; x < width; x++) {
        for (const y of [0, height - 1]) {
          const offset = (y * width + x) * 4;
          border.push([image.data[offset], image.data[offset + 1], image.data[offset + 2]]);
        }
      }
      for (let y = 1; y < height - 1; y++) {
        for (const x of [0, width - 1]) {
          const offset = (y * width + x) * 4;
          border.push([image.data[offset], image.data[offset + 1], image.data[offset + 2]]);
        }
      }
      const median = (channel: 0 | 1 | 2) => {
        const values = border.map(pixel => pixel[channel]).sort((a, b) => a - b);
        return values[Math.floor(values.length / 2)] ?? 255;
      };
      const background: [number, number, number] = [median(0), median(1), median(2)];
      const mask = new Uint8Array(width * height);
      for (let pixel = 0; pixel < mask.length; pixel++) {
        const offset = pixel * 4;
        const red = image.data[offset] - background[0];
        const green = image.data[offset + 1] - background[1];
        const blue = image.data[offset + 2] - background[2];
        mask[pixel] = red * red + green * green + blue * blue >= 22 * 22 ? 1 : 0;
      }
      return mask;
    };
    const foregroundA = foreground(a), foregroundB = foreground(b);
    let intersection = 0, union = 0;
    for (let pixel = 0; pixel < foregroundA.length; pixel++) {
      if (foregroundA[pixel] || foregroundB[pixel]) union++;
      if (foregroundA[pixel] && foregroundB[pixel]) intersection++;
    }
    return { region: region.id, pixelScore: 1 - mismatch / (width * height), foregroundScore: union ? intersection / union : 1 };
  });
  return { score: 1 - changed / (left.width * left.height), regions: scores, diff: PNG.sync.write(diff) };
}
