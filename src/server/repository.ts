import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GenerationJob, JobEvent, Revision, StoredAsset, VisualSpec } from "@/lib/domain";

type Database = {
  assets: StoredAsset[];
  jobs: GenerationJob[];
  revisions: Revision[];
  specs: Array<{ projectId: string; spec: VisualSpec; updatedAt: string }>;
  projectOwners: Record<string, string>;
};

const emptyDatabase = (): Database => ({ assets: [], jobs: [], revisions: [], specs: [], projectOwners: {} });

class LocalProjectStore {
  // This is intentionally configurable to a private, deployment-managed volume.
  private readonly root = path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.PRIVATE_STORAGE_ROOT ?? ".data/private");
  private readonly metadataPath = path.join(this.root, "metadata.json");
  private writeQueue: Promise<void> = Promise.resolve();

  private async load(): Promise<Database> {
    try {
      return JSON.parse(await readFile(this.metadataPath, "utf8")) as Database;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyDatabase();
      throw error;
    }
  }

  private async save(database: Database) {
    await mkdir(this.root, { recursive: true });
    const temporaryPath = `${this.metadataPath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(database), { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.metadataPath);
  }

  private mutate<T>(operation: (database: Database) => T | Promise<T>) {
    const result = this.writeQueue.then(async () => {
      const database = await this.load();
      const value = await operation(database);
      await this.save(database);
      return value;
    });
    this.writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async createAsset(input: Omit<StoredAsset, "id" | "sha256" | "storageKey" | "createdAt"> & { bytesData: Buffer }) {
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

  async createJob(projectId: string, ownerId: string) {
    const job: GenerationJob = { id: randomUUID(), projectId, phase: "queued", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), events: [] };
    return this.mutate((database) => {
      if (database.projectOwners[projectId] !== ownerId) throw new Error("Project access denied.");
      if (database.jobs.some((item) => item.projectId === projectId && !["ready", "failed", "cancelled"].includes(item.phase))) throw new Error("A generation is already active for this project.");
      database.jobs.push(job);
      return job;
    });
  }

  async updateJob(jobId: string, patch: Partial<GenerationJob>) {
    return this.mutate((database) => {
      const job = database.jobs.find((item) => item.id === jobId);
      if (!job) throw new Error("Generation job not found.");
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

  async createRevision(revision: Omit<Revision, "id" | "createdAt">) {
    const record: Revision = { ...revision, id: randomUUID(), createdAt: new Date().toISOString() };
    return this.mutate((database) => {
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
    return revision;
  }

  async listRevisions(projectId: string, ownerId: string) {
    const database = await this.load();
    if (database.projectOwners[projectId] !== ownerId) throw new Error("Project access denied.");
    return database.revisions.filter((revision) => revision.projectId === projectId).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
}

const globalStore = globalThis as unknown as { studioStore?: LocalProjectStore };
export const store = globalStore.studioStore ?? (globalStore.studioStore = new LocalProjectStore());
