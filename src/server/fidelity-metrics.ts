import type { VisualSpec } from "@/lib/domain";

export type PixelBounds = [left: number, top: number, width: number, height: number];
export type EdgeDeltasPx = { left: number; top: number; right: number; bottom: number };
export type LayoutRelationship = {
  firstRegion: string;
  secondRegion: string;
  axis: "horizontal" | "vertical";
  expectedGapPx: number;
  actualGapPx: number;
  deltaPx: number;
};
export type LayoutRelationshipMeasurements = { checkedPairs: number; deviations: LayoutRelationship[] };

export type TypographyExpectation = VisualSpec["observations"]["style"]["typography"][number];
export type TypographyObservation = {
  status: "measured" | "missing" | "ambiguous";
  regionId?: string;
  fontSizePx?: number;
  weight?: string;
  family?: string;
  lineHeightPx?: number;
  letterSpacingPx?: number;
};
export type TypographyCheck = {
  role: string;
  regionId?: string;
  confidence?: "high" | "medium" | "low";
  status: TypographyObservation["status"];
  verified: boolean;
  expected: { fontSizePx: number; weight: string; family?: string; lineHeightPx?: number; letterSpacingPx?: number };
  actual?: { fontSizePx?: number; weight?: string; family?: string; lineHeightPx?: number; letterSpacingPx?: number };
  mismatches: string[];
};

const round = (value: number) => Math.round(value * 10) / 10;

export function edgeDeltasPx(boundsPct: [number, number, number, number], actual: PixelBounds, viewport: { width: number; height: number }): EdgeDeltasPx {
  const [x, y, width, height] = boundsPct;
  const expectedLeft = x / 100 * viewport.width;
  const expectedTop = y / 100 * viewport.height;
  const expectedRight = (x + width) / 100 * viewport.width;
  const expectedBottom = (y + height) / 100 * viewport.height;
  return {
    left: round(actual[0] - expectedLeft),
    top: round(actual[1] - expectedTop),
    right: round(actual[0] + actual[2] - expectedRight),
    bottom: round(actual[1] + actual[3] - expectedBottom),
  };
}

export function edgeTolerancePx(viewport: { width: number; height: number }) {
  return Math.max(8, Math.min(viewport.width, viewport.height) * 0.015);
}

export function hasEdgeMismatch(edges: EdgeDeltasPx | undefined, viewport: { width: number; height: number }) {
  return !!edges && Object.values(edges).some(delta => Math.abs(delta) > edgeTolerancePx(viewport));
}

function overlapRatio(startA: number, endA: number, startB: number, endB: number) {
  const smaller = Math.min(endA - startA, endB - startB);
  return smaller > 0 ? Math.max(0, Math.min(endA, endB) - Math.max(startA, startB)) / smaller : 0;
}

export function measureLayoutRelationships(
  regions: VisualSpec["observations"]["layout"],
  actualById: ReadonlyMap<string, PixelBounds>,
  viewport: { width: number; height: number },
  limit = 20,
): LayoutRelationshipMeasurements {
  const expected = regions.map(region => {
    const [x, y, width, height] = region.boundsPct;
    const left = x / 100 * viewport.width, top = y / 100 * viewport.height;
    return { region, left, top, right: (x + width) / 100 * viewport.width, bottom: (y + height) / 100 * viewport.height };
  });
  const relationships: LayoutRelationship[] = [];
  let checkedPairs = 0;
  for (let i = 0; i < expected.length; i++) for (let j = i + 1; j < expected.length; j++) {
    const a = expected[i], b = expected[j];
    const actualA = actualById.get(a.region.id), actualB = actualById.get(b.region.id);
    if (!actualA || !actualB) continue;
    const horizontalCandidates: Array<{ first: typeof a; second: typeof b; gap: number }> = [];
    const verticalCandidates: Array<{ first: typeof a; second: typeof b; gap: number }> = [];
    if (b.left >= a.right && overlapRatio(a.top, a.bottom, b.top, b.bottom) >= 0.5) horizontalCandidates.push({ first: a, second: b, gap: b.left - a.right });
    if (a.left >= b.right && overlapRatio(a.top, a.bottom, b.top, b.bottom) >= 0.5) horizontalCandidates.push({ first: b, second: a, gap: a.left - b.right });
    if (b.top >= a.bottom && overlapRatio(a.left, a.right, b.left, b.right) >= 0.5) verticalCandidates.push({ first: a, second: b, gap: b.top - a.bottom });
    if (a.top >= b.bottom && overlapRatio(a.left, a.right, b.left, b.right) >= 0.5) verticalCandidates.push({ first: b, second: a, gap: a.top - b.bottom });
    const candidates = [
      ...horizontalCandidates.map(candidate => ({ ...candidate, axis: "horizontal" as const })),
      ...verticalCandidates.map(candidate => ({ ...candidate, axis: "vertical" as const })),
    ];
    const candidate = candidates[0];
    if (!candidate) continue;
    checkedPairs++;
    const firstActual = actualById.get(candidate.first.region.id)!;
    const secondActual = actualById.get(candidate.second.region.id)!;
    const actualGap = candidate.axis === "horizontal"
      ? secondActual[0] - (firstActual[0] + firstActual[2])
      : secondActual[1] - (firstActual[1] + firstActual[3]);
    const delta = actualGap - candidate.gap;
    if (Math.abs(delta) < Math.max(8, candidate.gap * 0.3)) continue;
    relationships.push({ firstRegion: candidate.first.region.id, secondRegion: candidate.second.region.id, axis: candidate.axis, expectedGapPx: round(candidate.gap), actualGapPx: round(actualGap), deltaPx: round(delta) });
  }
  return { checkedPairs, deviations: relationships.sort((a, b) => Math.abs(b.deltaPx) - Math.abs(a.deltaPx)).slice(0, Math.max(0, limit)) };
}

export function typographySelectorForRole(role: string) {
  const normalized = role.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (/^(?:(?:page|card) )?(?:title|heading)(?: [1-6])?$/.test(normalized)) return "h1,h2,h3,h4,h5,h6";
  if (/^(?:subheading|subtitle)$/.test(normalized)) return "h2,h3,p";
  if (/^(?:body|paragraph|description|copy)$/.test(normalized)) return "p,li";
  if (/^(?:label|caption|eyebrow|overline)$/.test(normalized)) return "label,small";
  if (/^(?:button|action)$/.test(normalized)) return "button,[role=button]";
  if (/^(?:link|navigation)$/.test(normalized)) return "a";
  return undefined;
}

function numericWeight(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "normal") return 400;
  if (normalized === "bold") return 700;
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 1 && number <= 1000 ? number : undefined;
}

function familyMatches(expected: string, actual: string) {
  const normalize = (family: string) => family.trim().replace(/^['"]|['"]$/g, "").toLowerCase();
  const expectedFamily = normalize(expected);
  return actual.split(",").some(family => normalize(family) === expectedFamily);
}

export function compareTypography(expectations: TypographyExpectation[], observations: TypographyObservation[]): TypographyCheck[] {
  return expectations.map((item, index) => {
    const observation = observations[index] ?? { status: "missing" as const };
    const expected = {
      fontSizePx: item.sizePxApprox,
      weight: item.weight,
      ...(item.family ? { family: item.family } : {}),
      ...(item.lineHeightPxApprox === undefined ? {} : { lineHeightPx: item.lineHeightPxApprox }),
      ...(item.letterSpacingPxApprox === undefined ? {} : { letterSpacingPx: item.letterSpacingPxApprox }),
    };
    const actual = observation.status === "measured" ? {
      ...(observation.fontSizePx === undefined ? {} : { fontSizePx: round(observation.fontSizePx) }),
      ...(observation.weight ? { weight: observation.weight } : {}),
      ...(observation.family ? { family: observation.family } : {}),
      ...(observation.lineHeightPx === undefined ? {} : { lineHeightPx: round(observation.lineHeightPx) }),
      ...(observation.letterSpacingPx === undefined ? {} : { letterSpacingPx: round(observation.letterSpacingPx) }),
    } : undefined;
    const mismatches: string[] = [];
    if (actual?.fontSizePx !== undefined && Math.abs(actual.fontSizePx - item.sizePxApprox) >= Math.max(2, item.sizePxApprox * 0.125)) mismatches.push(`font size expected ${item.sizePxApprox}px, rendered ${actual.fontSizePx}px (${round(actual.fontSizePx - item.sizePxApprox)}px)`);
    const expectedWeight = numericWeight(item.weight), actualWeight = numericWeight(actual?.weight);
    if (expectedWeight !== undefined && actualWeight !== undefined && Math.abs(actualWeight - expectedWeight) >= 100) mismatches.push(`font weight expected ${expectedWeight}, rendered ${actualWeight}`);
    if (item.family && actual?.family && !familyMatches(item.family, actual.family)) mismatches.push(`font family expected ${item.family}, rendered ${actual.family}`);
    if (item.lineHeightPxApprox !== undefined && actual?.lineHeightPx !== undefined && Math.abs(actual.lineHeightPx - item.lineHeightPxApprox) > Math.max(2, item.lineHeightPxApprox * 0.15)) mismatches.push(`line height expected ${item.lineHeightPxApprox}px, rendered ${actual.lineHeightPx}px (${round(actual.lineHeightPx - item.lineHeightPxApprox)}px)`);
    if (item.letterSpacingPxApprox !== undefined && actual?.letterSpacingPx !== undefined && Math.abs(actual.letterSpacingPx - item.letterSpacingPxApprox) > Math.max(0.75, Math.abs(item.letterSpacingPxApprox) * 0.25)) mismatches.push(`letter spacing expected ${item.letterSpacingPxApprox}px, rendered ${actual.letterSpacingPx}px (${round(actual.letterSpacingPx - item.letterSpacingPxApprox)}px)`);
    return {
      role: item.role,
      ...(item.regionId ? { regionId: item.regionId } : {}),
      ...(item.confidence ? { confidence: item.confidence } : {}),
      status: observation.status,
      verified: observation.status === "measured" && item.confidence === "high" && !!item.regionId,
      expected,
      ...(actual ? { actual } : {}),
      mismatches,
    };
  });
}
