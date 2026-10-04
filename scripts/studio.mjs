import { spawn } from "node:child_process";
import nextEnv from "@next/env";
const mode = process.argv[2] === "start" ? "start" : "dev";
nextEnv.loadEnvConfig(process.cwd(), mode !== "start");
const env = { ...process.env, NODE_ENV: mode === "start" ? "production" : "development" };
const hostname = process.env.STUDIO_HOST || "127.0.0.1";
if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) console.warn("Non-loopback startup was explicitly configured. Protect this host with appropriate authentication, HTTPS and network controls.");
const children = [
  spawn(process.execPath, ["node_modules/next/dist/bin/next", mode, "--hostname", hostname], { env, stdio: "inherit", windowsHide: true }),
  spawn(process.execPath, ["--import", "tsx", "src/workers/jobs.ts"], { env, stdio: "inherit", windowsHide: true }),
];
let stopping = false;
function stop() { if (stopping) return; stopping = true; for (const child of children) child.kill(); }
process.on("SIGINT", stop); process.on("SIGTERM", stop);
for (const child of children) {
  child.on("error", error => { console.error(error.message); stop(); process.exitCode = 1; });
  child.on("exit", code => { if (!stopping) { stop(); process.exitCode = code || 1; } });
}
