import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

type Check = { name: string; status: "pass" | "warning" | "fail"; detail: string };
const checks: Check[] = [];
const production = process.argv.includes("--production");
checks.push({ name: "Node", status: Number(process.versions.node.split(".")[0]) >= 24 ? "pass" : "fail", detail: "Use Node 24 or newer; CI uses Node 24." });
checks.push({ name: "Chromium", status: existsSync(chromium.executablePath()) ? "pass" : "fail", detail: "Install with npx playwright install chromium if missing." });
checks.push({ name: "OpenRouter key", status: process.env.OPENROUTER_API_KEY ? "pass" : "warning", detail: "A configured key is required for live inference; presence does not verify authentication or free quotas." });
checks.push({ name: "Inference endpoint", status: !process.env.OPENROUTER_BASE_URL || process.env.OPENROUTER_BASE_URL === "https://openrouter.ai/api/v1" ? "pass" : "fail", detail: "Only the official OpenRouter endpoint is permitted." });
checks.push({ name: "Session secret", status: (process.env.SESSION_SECRET?.length ?? 0) >= 32 ? "pass" : production ? "fail" : "warning", detail: "Use a stable random secret of at least 32 characters; do not publish its value." });
const dockerRequired = production || process.env.SANDBOX_MODE === "docker";
try {
  execFileSync("docker", ["info", "--format", "{{.ServerVersion}}"], { stdio: "pipe", timeout: 8000, windowsHide: true });
  checks.push({ name: "Docker engine", status: "pass", detail: "Container engine is reachable." });
  try {
    execFileSync("docker", ["image", "inspect", process.env.SANDBOX_IMAGE ?? "ss2code-render:local"], { stdio: "pipe", timeout: 8000, windowsHide: true });
    checks.push({ name: "Renderer image", status: "pass", detail: "Image exists; rebuild after source/dependency changes." });
  } catch { checks.push({ name: "Renderer image", status: dockerRequired ? "fail" : "warning", detail: "Run docker build -f Dockerfile.render -t ss2code-render:local ." }); }
} catch { checks.push({ name: "Docker engine", status: dockerRequired ? "fail" : "warning", detail: "Start Docker Desktop in Linux-container mode and wait for docker info to succeed." }); }
if (production && process.env.SANDBOX_MODE !== "docker") checks.push({ name: "Production isolation", status: "fail", detail: "Production requires SANDBOX_MODE=docker." });
console.log(JSON.stringify({ status: checks.some(c => c.status === "fail") ? "NOT_READY" : "LOCAL_CHECKS_PASSED", checks, limitations: ["This is environment readiness, not model accuracy, a security audit, or a public deployment certification."] }, null, 2));
if (checks.some(check => check.status === "fail")) process.exitCode = 1;
