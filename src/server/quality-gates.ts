import type { Evaluation } from "@/lib/domain";

export function blockingFindingIds(evaluation: Evaluation): Set<string> {
  return new Set([
    ...evaluation.buildFindings.map(f => "build:" + f.id),
    ...(evaluation.metrics.horizontalOverflow ? ["overflow"] : []),
    ...evaluation.a11yFindings.filter(f => ["critical", "serious"].includes(f.severity)).map(f => "a11y:" + f.id),
    ...evaluation.visualFindings.filter(f => f.severity === "critical").map(f => "visual:" + f.id),
  ]);
}

export const hasBlockingFindings = (evaluation: Evaluation) => blockingFindingIds(evaluation).size > 0;

/** Private working candidates may improve incrementally; publication still requires zero blockers. */
export function shouldAcceptRepair(previous: Evaluation, next: Evaluation) {
  const before = blockingFindingIds(previous), after = blockingFindingIds(next);
  if (!before.size && after.size) return false;
  // Do not trade an existing failure for a new compile/security/a11y/layout failure.
  if ([...after].some(id => !before.has(id))) return false;
  if (after.size < before.size) return true;
  return (next.metrics.visualScore ?? 0) >= (previous.metrics.visualScore ?? 0);
}
