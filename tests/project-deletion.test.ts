import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PNG } from "pngjs";
import { ActiveProjectJobError, LocalProjectStore } from "../src/server/repository";
import { recordSpan, traceContext } from "../src/server/telemetry";
import { fixtureFiles, fixturePlan, fixtureSpec } from "./support/fixture";

test("owner project deletion removes private files, revisions and durable queue records", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ss2-project-delete-")), store = new LocalProjectStore(root);
  const ownerId = "deletion-owner", projectId = "b65e8edc-28d0-4d78-8a5a-14bdb5da72f5", previousStorageRoot = process.env.PRIVATE_STORAGE_ROOT;
  try {
    process.env.PRIVATE_STORAGE_ROOT = root;
    const image = PNG.sync.write(new PNG({ width: 24, height: 24 }));
    const asset = await store.createAsset({ ownerId, projectId, name: "Private reference", kind: "image", mimeType: "image/png", bytes: image.length, bytesData: image });
    await store.setSpec(projectId, ownerId, fixtureSpec);
    const job = await store.createJob(projectId, ownerId, { kind: "generation", ownerId, data: { assetId: asset.id } }, "deletion-test-key-1234");
    traceContext.run({ id: job.id, source: "studio" }, () => recordSpan({ stage: "DELETE_TEST", outcome: "ok", durationMs: 1 }));
    traceContext.run({ id: "project-export-trace", source: "studio", projectId }, () => recordSpan({ stage: "DELETE_TEST_EXPORT", outcome: "ok", durationMs: 1 }));
    const revision = await store.createRevision({ projectId, referenceAssetId: asset.id, visualSpec: fixtureSpec, framework: "react-tailwind", files: fixtureFiles, filePlan: fixturePlan, promptVersion: "test-fixture", modelId: "fixture/no-inference", summary: "Private revision", assumptions: [], evaluation: { buildFindings: [], visualFindings: [], a11yFindings: [], metrics: { horizontalOverflow: false } } });
    await store.savePreview(revision.id, image);
    await store.saveArtifact(revision.id, "bundle", "private preview");
    await store.saveCandidateEvidence(job.id, ownerId, { project: { files: fixtureFiles, summary: "Private diagnostic", interactionNotes: [], assumptionsApplied: [] }, plan: fixturePlan, visualSpec: fixtureSpec, evaluation: { buildFindings: [], visualFindings: [], a11yFindings: [], metrics: { horizontalOverflow: false } }, promptVersion: "test-fixture" });
    await store.updateJob(job.id, { phase: "failed", error: "Private failure detail" });
    const candidateRoot = path.join(root, "candidates", job.id);

    const result = await store.deleteProject(projectId, ownerId);
    assert.deepEqual(result, { deleted: true, cleanupComplete: true });
    assert.deepEqual((await store.snapshot(ownerId)).projects, []);
    const telemetryDb = new DatabaseSync(path.join(root, "telemetry.sqlite"));
    try { assert.equal((telemetryDb.prepare("SELECT COUNT(*) AS count FROM spans WHERE trace_id = ? OR project_id = ?").get(job.id, projectId) as { count: number }).count, 0); } finally { telemetryDb.close(); }
    await assert.rejects(store.getAsset(asset.id, ownerId), /not found/);
    for (const target of [path.join(root, asset.storageKey), path.join(root, "previews", revision.id + ".png"), path.join(root, "previews", revision.id + ".html"), candidateRoot]) {
      await assert.rejects(access(target));
    }
    assert.deepEqual(await store.deleteProject(projectId, ownerId), { deleted: false, cleanupComplete: true });
    store.close();
    const reopened = new LocalProjectStore(root);
    try {
      assert.deepEqual((await reopened.snapshot(ownerId)).projects, []);
      await reopened.createAsset({ ownerId, projectId, name: "Fresh project", kind: "image", mimeType: "image/png", bytes: image.length, bytesData: image });
      const replacement = await reopened.createJob(projectId, ownerId, { kind: "generation", ownerId, data: {} }, "deletion-test-key-1234");
      assert.notEqual(replacement.id, job.id);
    } finally { reopened.close(); }
  } finally {
    store.close();
    if (previousStorageRoot === undefined) delete process.env.PRIVATE_STORAGE_ROOT; else process.env.PRIVATE_STORAGE_ROOT = previousStorageRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test("project deletion is owner checked and refuses an active queue job", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ss2-project-delete-active-")), store = new LocalProjectStore(root);
  try {
    const projectId = "9de1fdea-92fb-41ab-8c4f-e0ebc27aac8d", ownerId = "owner-a";
    await store.createAsset({ ownerId, projectId, name: "Reference", kind: "asset_archive", mimeType: "application/octet-stream", bytes: 1, bytesData: Buffer.from("x") });
    const job = await store.createJob(projectId, ownerId, { kind: "generation", ownerId, data: {} });
    await assert.rejects(store.deleteProject(projectId, "owner-b"), /access denied/);
    await assert.rejects(store.deleteProject(projectId, ownerId), ActiveProjectJobError);
    assert.equal((await store.snapshot(ownerId)).projects.length, 1);
    await assert.rejects(store.getJob(job.id, "owner-b"), /not found/);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});
