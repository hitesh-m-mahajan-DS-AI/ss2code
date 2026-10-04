import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import type { Evaluation, FilePlan, GeneratedProject, GenerationJob, JobEvent, Revision, StoredAsset, VisualSpec } from "@/lib/domain";
import { jobContext } from "./job-context";
import sharp from "sharp";

export type TaskInput = { kind: "generation" | "refinement"; ownerId: string; data: Record<string, unknown> };
type Task = { jobId: string; input: TaskInput; lease?: string; leaseUntil?: number; attempts: number; checkpoints: Record<string, unknown>; deadline: number };

type Database = {
  assets: StoredAsset[];
  jobs: GenerationJob[];
  revisions: Revision[];
  specs: Array<{ projectId: string; spec: VisualSpec; updatedAt: string }>;
  projectOwners: Record<string, string>;
  tasks: Task[];
  requests: Record<string, { hash: string; jobId: string }>;
};

const emptyDatabase = (): Database => ({ assets: [], jobs: [], revisions: [], specs: [], projectOwners: {}, tasks: [], requests: {} });

export class LocalProjectStore {
  // This is intentionally configurable to a private, deployment-managed volume.
  private readonly root: string;
  private connection?: DatabaseSync;
  constructor(root = process.env.PRIVATE_STORAGE_ROOT ?? ".data/private") { this.root = path.resolve(root); }

  private db() {
    if (this.connection) return this.connection;
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(path.join(this.root, "studio.sqlite"));
    db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)");
    const legacy = path.join(this.root, "metadata.json");
    const initial = existsSync(legacy) ? { ...emptyDatabase(), ...JSON.parse(readFileSync(legacy, "utf8")) } : emptyDatabase();
    // Legacy in-process jobs have no replayable input and must not block a project forever.
    for (const job of initial.jobs as GenerationJob[]) {
      if (!["ready", "failed", "cancelled"].includes(job.phase) && !initial.tasks.some((task: Task) => task.jobId === job.id)) { job.phase = "failed"; job.error = "This job predates durable execution. Generate again from the saved reference."; }
    }
    db.prepare("INSERT OR IGNORE INTO state(id,data) VALUES(1,?)").run(JSON.stringify(initial));
    this.connection = db;
    return db;
  }

  private async load(): Promise<Database> {
    return JSON.parse((this.db().prepare("SELECT data FROM state WHERE id=1").get() as { data: string }).data) as Database;
  }

  private async mutate<T>(operation: (database: Database) => T): Promise<T> {
    const db = this.db();
    db.exec("BEGIN IMMEDIATE");
    try {
      const database = JSON.parse((db.prepare("SELECT data FROM state WHERE id=1").get() as { data: string }).data) as Database;
      const context = jobContext.getStore();
      if (context) {
        const task = database.tasks.find(item => item.jobId === context.jobId);
        if (task?.lease !== context.lease || (task.leaseUntil ?? 0) < Date.now()) throw new Error("Worker lease expired; stale work was discarded.");
      }
      const value = operation(database);
      db.prepare("UPDATE state SET data=? WHERE id=1").run(JSON.stringify(database));
      db.exec("COMMIT");
      return value;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  async createAsset(input: Omit<StoredAsset, "id" | "sha256" | "storageKey" | "createdAt"> & { bytesData: Buffer }) {
    if (input.mimeType.startsWith("image/")) {
      const metadata = await sharp(input.bytesData, { limitInputPixels: 16_000_000 }).metadata();
      input.width = metadata.width; input.height = metadata.height;
      if (!input.width || !input.height) throw new Error("Image dimensions could not be decoded.");
    }
    const id = randomUUID();
    const storageKey = `assets/${id}`;
    const asset: StoredAsset = {
      id,
      projectId: input.projectId,
      ownerId: input.ownerId,
      name: input.name,
      kind: input.kind,
      mimeType: input.mimeType,
      bytes: input.bytesData.byteLength,
      width: input.width,
      height: input.height,
      sha256: createHash("sha256").update(input.bytesData).digest("hex"),
      storageKey,
      createdAt: new Date().toISOString(),
    };
    const target = path.join(this.root, storageKey);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.bytesData, { mode: 0o600, flag: "wx" });
    return this.mutate((database) => {
      const existingOwner = database.projectOwners[input.projectId];
      if (existingOwner && existingOwner !== input.ownerId) throw new Error("Project access denied.");
      database.projectOwners[input.projectId] = input.ownerId;
      database.assets.push(asset);
      if (asset.kind === "image" || asset.kind === "video_frame") database.specs = database.specs.filter(spec => spec.projectId !== asset.projectId);
      return asset;
    });
  }

  async getAsset(assetId: string, ownerId: string) {
    const database = await this.load();
    const asset = database.assets.find((item) => item.id === assetId && item.ownerId === ownerId);
    if (!asset) throw new Error("Reference asset was not found or access is denied.");
    return asset;
  }

  async readAssetBytes(asset: StoredAsset) {
    return readFile(path.join(this.root, asset.storageKey));
  }

  async setSpec(projectId: string, ownerId: string, spec: VisualSpec) {
    return this.mutate((database) => {
      if (database.projectOwners[projectId] !== ownerId) throw new Error("Project access denied.");
      const existing = database.specs.find((item) => item.projectId === projectId);
      if (existing) {
        existing.spec = spec;
        existing.updatedAt = new Date().toISOString();
      } else database.specs.push({ projectId, spec, updatedAt: new Date().toISOString() });
      return spec;
    });
  }

  async getSpec(projectId: string, ownerId: string) {
    const database = await this.load();
    if (database.projectOwners[projectId] !== ownerId) throw new Error("Project access denied.");
    return database.specs.find((item) => item.projectId === projectId)?.spec;
  }

  async getProjectReference(projectId: string, ownerId: string, assetId?: string) {
    const database = await this.load();
    if (database.projectOwners[projectId] !== ownerId) throw new Error("Project access denied.");
    const candidates = database.assets.filter((asset) => asset.projectId === projectId && asset.ownerId === ownerId && (asset.kind === "image" || asset.kind === "video_frame"));
    const asset = assetId ? candidates.find((item) => item.id === assetId) : candidates.at(-1);
    if (!asset) throw new Error("A selected image or video frame is required for generation.");
    return asset;
  }

  async createJob(projectId: string, ownerId: string, input?: TaskInput, idempotencyKey?: string) {
    const job: GenerationJob = { id: randomUUID(), projectId, phase: "queued", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), events: [] };
    return this.mutate((database) => {
      if (database.projectOwners[projectId] !== ownerId) throw new Error("Project access denied.");
      const requestKey = idempotencyKey ? ownerId + ":" + projectId + ":" + idempotencyKey : undefined;
      const hash = createHash("sha256").update(JSON.stringify(input ?? {})).digest("hex");
      if (requestKey && database.requests[requestKey]) {
        const previous = database.requests[requestKey];
        if (previous.hash !== hash) throw new Error("Idempotency key was already used with different input.");
        return database.jobs.find(item => item.id === previous.jobId)!;
      }
      if (database.jobs.some((item) => item.projectId === projectId && !["ready", "failed", "cancelled"].includes(item.phase))) throw new Error("A generation is already active for this project.");
      database.jobs.push(job);
      if (input) database.tasks.push({ jobId: job.id, input, attempts: 0, checkpoints: {}, deadline: Date.now() + 30 * 60_000 });
      if (requestKey) database.requests[requestKey] = { hash, jobId: job.id };
      return job;
    });
  }

  async updateJob(jobId: string, patch: Partial<GenerationJob>) {
    return this.mutate((database) => {
      const job = database.jobs.find((item) => item.id === jobId);
      if (!job) throw new Error("Generation job not found.");
      if (patch.phase === "ready" && job.cancelledAt) throw new Error("JOB_CANCELLED");
      Object.assign(job, patch, { updatedAt: new Date().toISOString() });
      return job;
    });
  }

  async appendEvent(jobId: string, event: Omit<JobEvent, "sequence" | "createdAt">) {
    return this.mutate((database) => {
      const job = database.jobs.find((item) => item.id === jobId);
      if (!job) throw new Error("Generation job not found.");
      const record: JobEvent = { ...event, sequence: job.events.length + 1, createdAt: new Date().toISOString() };
      job.events.push(record);
      job.updatedAt = record.createdAt;
      return record;
    });
  }

  async getJob(jobId: string, ownerId: string) {
    const database = await this.load();
    const job = database.jobs.find((item) => item.id === jobId);
    if (!job || database.projectOwners[job.projectId] !== ownerId) throw new Error("Generation job not found or access is denied.");
    return job;
  }

  /** Private diagnostic evidence only. A capture is never a published revision. */
  async saveCandidateEvidence(jobId: string, ownerId: string, input: { project: GeneratedProject; plan: FilePlan; visualSpec: VisualSpec; evaluation: Evaluation; promptVersion: string; error?: string }, render?: { screenshot: Buffer; diff: Buffer }) {
    const job = await this.getJob(jobId, ownerId);
    if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(jobId)) throw new Error("Invalid candidate evidence job identifier.");
    jobContext.getStore()?.signal.throwIfAborted();
    const storageKey = `candidates/${jobId}/${randomUUID()}`;
    const target = path.join(this.root, storageKey);
    await mkdir(target, { recursive: true, mode: 0o700 });
    await writeFile(path.join(target, "metadata.json"), JSON.stringify({ ...input, capturedAt: new Date().toISOString(), phase: job.phase, status: "diagnostic-not-published" }, null, 2), { mode: 0o600 });
    if (render) {
      await writeFile(path.join(target, "capture.png"), render.screenshot, { mode: 0o600 });
      await writeFile(path.join(target, "diff.png"), render.diff, { mode: 0o600 });
    }
    return storageKey;
  }

  async createRevision(revision: Omit<Revision, "id" | "createdAt">) {
    const record: Revision = { ...revision, id: randomUUID(), createdAt: new Date().toISOString() };
    return this.mutate((database) => {
      if (revision.jobId) {
        const job = database.jobs.find(item => item.id === revision.jobId);
        if (job?.cancelledAt) throw new Error("JOB_CANCELLED");
        const existing = database.revisions.find(item => item.jobId === revision.jobId);
        if (existing) return existing;
      }
      database.revisions.push(record);
      return record;
    });
  }

  async savePreview(revisionId: string, image: Buffer) {
    const storageKey = `previews/${revisionId}.png`;
    const target = path.join(this.root, storageKey);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, image, { mode: 0o600 });
    return this.mutate((database) => {
      const revision = database.revisions.find((item) => item.id === revisionId);
      if (!revision) throw new Error("Revision not found.");
      revision.previewStorageKey = storageKey;
      return revision;
    });
  }

  async readPreview(revision: Revision) {
    if (!revision.previewStorageKey) throw new Error("Preview is not available.");
    return readFile(path.join(this.root, revision.previewStorageKey));
  }

  async getRevision(revisionId: string, ownerId: string) {
    const database = await this.load();
    const revision = database.revisions.find((item) => item.id === revisionId);
    if (!revision || database.projectOwners[revision.projectId] !== ownerId) throw new Error("Revision not found or access is denied.");
    if (revision.jobId && !database.jobs.some(job => job.id === revision.jobId && job.phase === "ready")) throw new Error("Revision has not passed its release gates.");
    return revision;
  }

  async listRevisions(projectId: string, ownerId: string) {
    const database = await this.load();
    if (database.projectOwners[projectId] !== ownerId) throw new Error("Project access denied.");
    return database.revisions.filter((revision) => revision.projectId === projectId && (!revision.jobId || database.jobs.some(j => j.id === revision.jobId && j.phase === "ready"))).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async snapshot(ownerId: string, projectId?: string) {
    const database = await this.load();
    const projects = Object.entries(database.projectOwners).filter(([, owner]) => owner === ownerId).map(([id]) => ({ id, name: database.assets.find(a => a.projectId === id)?.name ?? "Reconstruction" }));
    if (!projectId) return { projects };
    if (database.projectOwners[projectId] !== ownerId) throw new Error("Project access denied.");
    const latestAsset = database.assets.filter(a => a.projectId === projectId && ["image", "video_frame"].includes(a.kind)).at(-1);
    const latestJob = database.jobs.filter(j => j.projectId === projectId).at(-1);
    const relevantJob = latestJob && (!latestAsset || latestJob.createdAt >= latestAsset.createdAt) ? latestJob : undefined;
    return { projects, assets: database.assets.filter(a => a.projectId === projectId), selectedAssetId: latestAsset?.id, spec: database.specs.find(s => s.projectId === projectId)?.spec, job: relevantJob, revisions: database.revisions.filter(r => r.projectId === projectId && (!r.jobId || database.jobs.some(j => j.id === r.jobId && j.phase === "ready"))).reverse() };
  }

  async claim() {
    return this.mutate(database => {
      for (const task of database.tasks) {
        const job = database.jobs.find(j => j.id === task.jobId)!;
        if (["ready", "failed", "cancelled"].includes(job.phase) || (task.leaseUntil ?? 0) > Date.now()) continue;
        if (job.cancelledAt) { job.phase = "cancelled"; continue; }
        if (task.deadline < Date.now() || task.attempts >= 3) { job.phase = "failed"; job.error = "Job recovery/time budget exhausted. Retry safely to start a new job."; continue; }
        task.lease = randomUUID(); task.leaseUntil = Date.now() + 30_000; task.attempts++;
        return { ...task, lease: task.lease };
      }
    });
  }

  async retry(jobId: string, ownerId: string, key: string) {
    const job = await this.getJob(jobId, ownerId);
    if (!["failed", "cancelled"].includes(job.phase)) throw new Error("Only failed or cancelled jobs can be retried.");
    const task = (await this.load()).tasks.find(t => t.jobId === jobId);
    if (!task) throw new Error("This legacy job has no saved input. Generate again from its reference.");
    return this.createJob(job.projectId, ownerId, task.input, key);
  }

  async heartbeat(jobId: string, lease: string) {
    return this.mutate(database => {
      const task = database.tasks.find(t => t.jobId === jobId);
      const job = database.jobs.find(j => j.id === jobId);
      if (!task || task.lease !== lease || !job || job.cancelledAt || task.deadline < Date.now()) return false;
      task.leaseUntil = Date.now() + 30_000;
      return true;
    });
  }

  async checkpoint(key: string, value?: unknown) {
    const context = jobContext.getStore();
    if (!context) return undefined;
    if (value === undefined) return (await this.load()).tasks.find(t => t.jobId === context.jobId)?.checkpoints[key];
    return this.mutate(database => { database.tasks.find(t => t.jobId === context.jobId)!.checkpoints[key] = value; });
  }

  async saveArtifact(revisionId: string, kind: "bundle" | "diff", content: Buffer | string) {
    const storageKey = "previews/" + revisionId + (kind === "bundle" ? ".html" : ".diff.png");
    await mkdir(path.join(this.root, "previews"), { recursive: true });
    await writeFile(path.join(this.root, storageKey), content, { mode: 0o600 });
    return this.mutate(database => {
      const revision = database.revisions.find(r => r.id === revisionId)!;
      if (kind === "bundle") revision.bundleStorageKey = storageKey; else revision.diffStorageKey = storageKey;
    });
  }

  async readArtifact(revision: Revision, kind: "bundle" | "diff") {
    const key = kind === "bundle" ? revision.bundleStorageKey : revision.diffStorageKey;
    if (!key) throw new Error("This older revision has no interactive bundle. Generate a new revision.");
    return readFile(path.join(this.root, key));
  }

  close() { this.connection?.close(); this.connection = undefined; }
}

const globalStore = globalThis as unknown as { studioStore?: LocalProjectStore };
export const store = globalStore.studioStore ?? (globalStore.studioStore = new LocalProjectStore());
