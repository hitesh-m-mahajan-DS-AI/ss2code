import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
const { store } = await import("../server/repository");
const { executeTask } = await import("../server/orchestration");
const { jobContext } = await import("../server/job-context");
const { setTimeout: delay } = await import("node:timers/promises");
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
console.log("Persistent generation worker ready.");
while (!stopping) {
  const task = await store.claim();
  if (!task) { await delay(1000); continue; }
  const controller = new AbortController();
  const heartbeat = setInterval(() => {
    void store.heartbeat(task.jobId, task.lease).then(valid => { if (!valid || stopping) controller.abort(); }).catch(() => controller.abort());
  }, 5000);
  await jobContext.run({ jobId: task.jobId, lease: task.lease, signal: controller.signal }, async () => {
    try { await executeTask(task.jobId, task.input); }
    catch (error) {
      const job = await store.getJob(task.jobId, task.input.ownerId);
      const cancelled = Boolean(job.cancelledAt);
      const message = cancelled ? "Cancelled. The previous ready revision is preserved." : String(error).replace(/sk-or-v1-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 800);
      if (!stopping) {
        await store.updateJob(task.jobId, { phase: cancelled ? "cancelled" : "failed", error: cancelled ? undefined : message });
        await store.appendEvent(task.jobId, { type: cancelled ? "generation.cancelled" : "generation.failed", level: cancelled ? "warning" : "error", safeMessage: message });
      }
    }
  }).catch(error => console.error("Worker lease ended:", String(error).slice(0, 200)));
  clearInterval(heartbeat);
}
store.close();
