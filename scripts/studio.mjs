import { spawn } from "node:child_process";
const mode = process.argv[2] === "start" ? "start" : "dev";
const env = { ...process.env, NODE_ENV: mode === "start" ? "production" : "development" };
const children = [
  spawn(process.execPath, ["node_modules/next/dist/bin/next", mode], { env, stdio: "inherit", windowsHide: true }),
  spawn(process.execPath, ["--import", "tsx", "src/workers/jobs.ts"], { env, stdio: "inherit", windowsHide: true }),
];
let stopping = false;
function stop() { if (stopping) return; stopping = true; for (const child of children) child.kill(); }
process.on("SIGINT", stop); process.on("SIGTERM", stop);
for (const child of children) {
  child.on("error", error => { console.error(error.message); stop(); process.exitCode = 1; });
  child.on("exit", code => { if (!stopping) { stop(); process.exitCode = code || 1; } });
}
