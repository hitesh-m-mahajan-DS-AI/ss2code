import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { scopedOutputContract, formatDiagnostics, contractFingerprint } from "../src/server/output-contract";
import { generatedProjectSchema, patchSetSchema, percentBoundsSchema, visualSpecSchema } from "../src/lib/schemas";
import { classifyValidatedReference, assertReferenceViewports } from "../src/server/reference-classification";
import { fixtureSpec } from "./support/fixture";

test("region coordinates are finite in-viewport xywh with positive size and unique IDs", () => {
  assert.deepEqual(percentBoundsSchema.parse([35, 22, 30, 16]), [35, 22, 30, 16]);
  for (const invalid of [[67, 22, 95, 38], [-1, 0, 20, 20], [0, 0, 0, 20], [0, 0, 20, -1], [0, 0, Infinity, 20]]) assert.equal(percentBoundsSchema.safeParse(invalid).success, false);
  assert.ok(visualSpecSchema.safeParse(fixtureSpec).success);
  assert.equal(visualSpecSchema.safeParse({ ...fixtureSpec, observations: { ...fixtureSpec.observations, layout: [] } }).success, false);
  assert.equal(visualSpecSchema.safeParse({ ...fixtureSpec, observations: { ...fixtureSpec.observations, layout: [fixtureSpec.observations.layout[0], fixtureSpec.observations.layout[0]] } }).success, false);
  assert.match(JSON.stringify(zodToJsonSchema(percentBoundsSchema)), /NOT/);
});

test("viewport mismatch is rejected before a job can spend model calls", () => {
  const asset = { width: 640, height: 480 };
  assert.doesNotThrow(() => assertReferenceViewports(asset, { width: 640, height: 480 }));
  assert.throws(() => assertReferenceViewports(asset, { width: 640, height: 900 }), /original measured dimensions/);
  assert.throws(() => assertReferenceViewports(asset, { width: 640, height: 480 }, { width: 1280, height: 720 }));
});

test("checkpoints are invalidated by schema, system instructions and prompt version", () => {
  const input = { role: "code", prompt: "Test", allowedFilePaths: ["src/App.tsx"] };
  const hash = contractFingerprint(input, "schema-a", "system-a", "v1");
  assert.equal(hash, contractFingerprint(input, "schema-a", "system-a", "v1"));
  assert.notEqual(hash, contractFingerprint(input, "schema-b", "system-a", "v1"));
  assert.notEqual(hash, contractFingerprint(input, "schema-a", "system-b", "v1"));
  assert.notEqual(hash, contractFingerprint(input, "schema-a", "system-a", "v2"));
});

test("generation contract binds exact planned count, unique paths and native schema enums", () => {
  const paths = ["src/App.tsx", "src/Header.tsx"], schema = scopedOutputContract("GENERATE", generatedProjectSchema, paths);
  const project = { summary: "Test", files: paths.map(path => ({ path, content: "export default function App(){return <main/>}" })), interactionNotes: [], assumptionsApplied: [] };
  assert.ok(schema.safeParse(project).success);
  assert.equal(schema.safeParse({ ...project, files: [project.files[0]] }).success, false);
  const duplicate = schema.safeParse({ ...project, files: [project.files[0], project.files[0]] });
  assert.equal(duplicate.success, false);
  if (!duplicate.success) assert.match(formatDiagnostics(duplicate.error), /files.1.path: custom/);
  assert.equal(schema.safeParse({ ...project, files: [...project.files.slice(0, 1), { path: "src/Other.tsx", content: "" }] }).success, false);
  assert.match(JSON.stringify(zodToJsonSchema(schema)), /"enum":\["src\/App.tsx","src\/Header.tsx"\]/);
  assert.throws(() => scopedOutputContract("GENERATE", generatedProjectSchema, ["../escape.tsx"]));
  assert.throws(() => scopedOutputContract("GENERATE", generatedProjectSchema, ["src/App.tsx", "src/App.tsx"]));
  assert.equal(formatDiagnostics(new SyntaxError("private completion contents")), "The response was not a valid JSON object.");
  assert.ok(!formatDiagnostics(new z.ZodError([])).includes("private"));
});

test("patch contracts cannot add paths or repeat files, while unresolved empty patches remain valid", () => {
  for (const role of ["REPAIR_BUILD", "REPAIR_VISUAL", "USER_REFINEMENT"]) {
    const schema = scopedOutputContract(role, patchSetSchema, ["src/App.tsx"]);
    const patch = { rationale: [], files: [], assumptionsChanged: [] };
    assert.ok(schema.safeParse(patch).success);
    assert.equal(schema.safeParse({ ...patch, files: [{ path: "src/Other.tsx", content: "" }] }).success, false);
    assert.equal(schema.safeParse({ ...patch, files: [{ path: "src/App.tsx", content: "" }, { path: "src/App.tsx", content: "" }] }).success, false);
  }
});

test("P01 derives readiness from validated metadata without inventing design or related-state roles", () => {
  const input = { kind: "image" as const, mimeType: "image/png", width: 1280, height: 720 };
  assert.equal(classifyValidatedReference(input).readiness, "ready");
  assert.equal(classifyValidatedReference(input).likelyRole, "unknown");
  assert.equal(classifyValidatedReference({ ...input, kind: "video_frame" }).readiness, "ready");
  assert.equal(classifyValidatedReference({ ...input, kind: "video", mimeType: "video/webm" }).readiness, "needs_frame_selection");
  assert.equal(classifyValidatedReference({ ...input, kind: "pdf_page", mimeType: "application/pdf" }).readiness, "needs_page_selection");
  for (const invalid of [{ width: 100 }, { height: 5000 }, { width: undefined }, { width: Number.NaN }, { mimeType: "text/html" }, { kind: "asset_archive" as const }]) assert.equal(classifyValidatedReference({ ...input, ...invalid }).readiness, "rejected");
});
