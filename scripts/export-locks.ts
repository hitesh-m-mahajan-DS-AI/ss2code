import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { scaffoldProject } from "../src/server/scaffold";
const entry = { path: "src/App.tsx", content: "export default function App(){return <main/>}" };
const plan = { entry: entry.path, files: [{ path: entry.path, purpose: "", exports: ["default"], dependsOn: [], visualRegions: [] }], designTokens: { colors: {}, spacing: {}, radii: {}, shadows: {}, motion: {} }, implementationDecisions: [], assumptionsUsed: [] };
await mkdir("resources/export", { recursive: true });
for (const framework of ["react-tailwind", "nextjs-tailwind"] as const) {
  const dir = await mkdtemp(path.join(tmpdir(), "ss2-lock-"));
  try {
    const manifest = scaffoldProject([entry], plan, framework, false).find(file => file.path === "package.json")!;
    await writeFile(path.join(dir, "package.json"), manifest.content);
    await new Promise<void>((resolve, reject) => {
      const executable = process.platform === "win32" ? "npm.cmd" : "npm";
      const child = spawn(executable, ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: dir, shell: process.platform === "win32", windowsHide: true, stdio: "inherit" });
      child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error("Export lock generation failed.")));
    });
    await writeFile(path.join("resources/export", framework + ".lock.json"), await readFile(path.join(dir, "package-lock.json")));
  } finally { await rm(dir, { recursive: true, force: true }); }
}
