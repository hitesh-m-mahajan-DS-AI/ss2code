import assert from "node:assert/strict";
import test from "node:test";
import type { Evaluation } from "../src/lib/domain";
import { hasBlockingFindings, shouldAcceptRepair } from "../src/server/quality-gates";

const evaluation = (overflow: boolean, contrast: boolean, score: number): Evaluation => ({
  buildFindings: [], visualFindings: overflow ? [{ id: "overflow-360", severity: "critical", region: "mobile", expected: "No overflow", observed: "Overflow", suggestedDirection: "Reflow" }] : [],
  a11yFindings: contrast ? [{ id: "color-contrast", severity: "serious", message: "Contrast" }] : [],
  metrics: { horizontalOverflow: overflow, visualScore: score },
});
test("repair can remove one blocker before another without publishing an invalid candidate", () => {
  const original = evaluation(true, true, .99), intermediate = evaluation(false, true, .98), fixed = evaluation(false, false, .97);
  assert.equal(shouldAcceptRepair(original, intermediate), true);
  assert.equal(hasBlockingFindings(intermediate), true);
  assert.equal(shouldAcceptRepair(intermediate, fixed), true);
  assert.equal(hasBlockingFindings(fixed), false);
  assert.equal(shouldAcceptRepair(fixed, original), false);
  assert.equal(shouldAcceptRepair(fixed, evaluation(false, false, .96)), false);
  assert.equal(shouldAcceptRepair(evaluation(true, false, .99), evaluation(false, true, 1)), false);
});
