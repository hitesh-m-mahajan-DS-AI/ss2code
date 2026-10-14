import assert from "node:assert/strict";
import test from "node:test";
import type { VisualSpec } from "../src/lib/domain";
import { compareTypography, edgeDeltasPx, hasEdgeMismatch, measureLayoutRelationships, typographySelectorForRole } from "../src/server/fidelity-metrics";

const region = (id: string, boundsPct: [number, number, number, number], importance: "critical" | "high" | "normal" = "normal") => ({ id, region: id, boundsPct, description: id, importance });

test("edge geometry reports each rendered-minus-expected side in CSS pixels", () => {
  const edges = edgeDeltasPx([5, 5, 30, 10], [14, 2, 62, 16], { width: 200, height: 100 });
  assert.deepEqual(edges, { left: 4, top: -3, right: 6, bottom: 3 });
  assert.equal(hasEdgeMismatch(edges, { width: 200, height: 100 }), false);
  assert.equal(hasEdgeMismatch({ ...edges, left: 20 }, { width: 200, height: 100 }), true);
});

test("adjacent-region spacing is reported only for mapped neighbors with material gap changes", () => {
  const layout = [region("a", [5, 10, 20, 20]), region("b", [30, 10, 20, 20]), region("below", [5, 40, 20, 20])];
  const actual = new Map<string, [number, number, number, number]>([
    ["a", [5, 10, 20, 20]],
    ["b", [40, 10, 20, 20]],
    ["below", [5, 40, 20, 20]],
  ]);
  const result = measureLayoutRelationships(layout as VisualSpec["observations"]["layout"], actual, { width: 100, height: 100 });
  assert.deepEqual(result, { checkedPairs: 2, deviations: [{ firstRegion: "a", secondRegion: "b", axis: "horizontal", expectedGapPx: 5, actualGapPx: 15, deltaPx: 10 }] });
  assert.deepEqual(measureLayoutRelationships(layout as VisualSpec["observations"]["layout"], new Map(), { width: 100, height: 100 }), { checkedPairs: 0, deviations: [] });
});

test("typography measurements honor role mapping, confidence and explicit regions", () => {
  assert.equal(typographySelectorForRole("heading"), "h1,h2,h3,h4,h5,h6");
  assert.equal(typographySelectorForRole("button"), "button,[role=button]");
  assert.equal(typographySelectorForRole("metric value"), undefined);
  const expectations = [
    { role: "heading", sizePxApprox: 36, weight: "700", notes: "visible title", regionId: "title", confidence: "high" as const, family: "Inter", lineHeightPxApprox: 40 },
    { role: "label", sizePxApprox: 16, weight: "600", notes: "label", confidence: "medium" as const },
  ];
  const checks = compareTypography(expectations, [
    { status: "measured", regionId: "title", fontSizePx: 28, weight: "400", family: "Arial, sans-serif", lineHeightPx: 32 },
    { status: "ambiguous" },
  ]);
  assert.equal(checks[0].verified, true);
  assert.deepEqual(checks[0].mismatches, ["font size expected 36px, rendered 28px (-8px)", "font weight expected 700, rendered 400", "font family expected Inter, rendered Arial, sans-serif", "line height expected 40px, rendered 32px (-8px)"]);
  assert.equal(checks[1].verified, false);
  assert.equal(checks[1].status, "ambiguous");
  assert.deepEqual(checks[1].mismatches, []);
});
