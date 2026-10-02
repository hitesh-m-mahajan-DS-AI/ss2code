import assert from "node:assert/strict";
import test from "node:test";
import { buildIndex, retrieve, verifyCitations, assertFresh } from "../portfolio/document-assistant/retrieval";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

test("document retrieval returns sources, rejects invented quotes and abstains on unrelated questions", async () => {
  const index = await buildIndex("portfolio/document-assistant/corpus");
  const hits = retrieve(index, "Where do I configure OPENROUTER_API_KEY?");
  assert.equal(hits[0].file, "setup.md");
  assert.throws(() => verifyCitations(hits, [{ sourceId: hits[0].id, quote: "This quote was completely invented." }]), /Unsupported/);
  assert.throws(() => verifyCitations(hits, [{ sourceId: "fabricated-id", quote: hits[0].text }]), /Unsupported/);
  assert.equal(retrieve(index, "orbital eccentricity Neptune").length, 0);
  assert.equal(verifyCitations(hits, [{ sourceId: hits[0].id, quote: hits[0].text }])[0].file, "setup.md");
});

test("document index detects edits and deletions instead of silently citing stale text", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ss2-corpus-"));
  try {
    await writeFile(path.join(directory, "guide.md"), "An original explanation of a safe deployment process.");
    const index = await buildIndex(directory); await assertFresh(index);
    await writeFile(path.join(directory, "guide.md"), "A different deployment policy has replaced the original.");
    await assert.rejects(assertFresh(index), /changed/);
    await rm(path.join(directory, "guide.md"));
    await assert.rejects(assertFresh(index), /changed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
