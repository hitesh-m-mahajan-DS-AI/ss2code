import { spawn } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RenderInput, RenderResult } from "./render-project";
import { jobContext } from "./job-context";

export async function renderAndCompare(input: RenderInput) {
  const docker = process.env.SANDBOX_MODE === "docker";
  if (process.env.NODE_ENV === "production" && !docker) throw new Error("Production rendering requires SANDBOX_MODE=docker and the prepared render image.");
  const containerName = "ss2-render-" + randomUUID();
  const executable = docker ? "docker" : process.execPath;
  const args = docker
    ? ["run", "--rm", "-i", "--name", containerName, "--network", "none", "--memory", "1g", "--cpus", "1", "--pids-limit", "256", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--tmpfs", "/tmp:rw,exec,nosuid,size=512m", "-e", "SS2_CONTAINER=1", process.env.SANDBOX_IMAGE ?? "ss2code-render:local"]
    : ["--max-old-space-size=768", "--import", "tsx", path.join(process.cwd(), "src/workers/render.ts")];
  const result = await new Promise<RenderResult>((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: "production", ...Object.fromEntries(["PATH", "SystemRoot", "TEMP", "TMP", "USERPROFILE", "HOME", "PLAYWRIGHT_BROWSERS_PATH", "DOCKER_HOST", "DOCKER_CONTEXT"].filter(key => process.env[key]).map(key => [key, process.env[key]!])) };
    const child = spawn(executable, args, { cwd: process.cwd(), env, windowsHide: true, detached: !docker && process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const abort = () => {
      if (!docker && child.pid && process.platform === "win32") {
        const cleanup = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" }); cleanup.on("error", () => child.kill());
      } else if (!docker && child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill(); } }
      else child.kill();
      if (docker) { const cleanup = spawn("docker", ["rm", "-f", containerName], { windowsHide: true, stdio: "ignore" }); cleanup.on("error", () => undefined); }
    };
    const signal = jobContext.getStore()?.signal;
    const onAbort = () => { abort(); reject(new Error("JOB_CANCELLED")); };
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => { abort(); reject(new Error("Build/render exceeded its 180-second budget.")); }, 180_000);
    child.stdout.on("data", chunk => { stdout += chunk.toString(); if (stdout.length > 45_000_000) { abort(); reject(new Error("Render output exceeded the size limit.")); } });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-2000); });
    child.on("error", reject);
    child.on("close", () => {
      clearTimeout(timer); signal?.removeEventListener("abort", onAbort);
      try { const output = JSON.parse(stdout) as { result?: RenderResult; error?: string }; if (!output.result) throw new Error(output.error ?? "No render result."); resolve(output.result); }
      catch (error) { reject(new Error(error instanceof SyntaxError ? "Render worker unavailable: " + stderr : String(error))); }
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify(input));
  });
  return { ...result, screenshot: Buffer.from(result.screenshot, "base64"), diff: Buffer.from(result.diff, "base64") };
}
