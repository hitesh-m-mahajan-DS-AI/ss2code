import { readFileSync } from "node:fs";
import path from "node:path";
import type { FilePlan, ManifestFile } from "@/lib/domain";
import { assertSafeProjectPath, sourcePolicyFindings } from "@/lib/security";

export const dependencies = ["react", "react-dom", "lucide-react"];
const toolchain = ["typescript", "esbuild", "postcss", "tailwindcss", "autoprefixer", "eslint", "typescript-eslint", "eslint-plugin-jsx-a11y", "@types/react", "@types/react-dom"];
const reserved = /^(?:package(?:-lock)?\.json|tsconfig\.json|eslint\.config\.mjs|next\.config\.mjs|postcss\.config\.mjs|tailwind\.config\.mjs|README\.md|__studio\/|scripts\/)/;

export function assertSourceManifest(files: ManifestFile[]) {
  for (const file of files) {
    if (assertSafeProjectPath(file.path) !== file.path || !file.path.startsWith("src/") || !/^[a-zA-Z0-9_./-]+$/.test(file.path) || reserved.test(file.path) || !/\.(tsx?|css|svg)$/.test(file.path)) throw new Error("Generated source conflicts with the trusted scaffold: " + file.path);
    const issues = sourcePolicyFindings(file.path, file.content, dependencies);
    if (issues.length) throw new Error(issues.join(" "));
  }
}

function versions(names: string[]) {
  return Object.fromEntries(names.map(name => [name, (JSON.parse(readFileSync(path.join(process.cwd(), "node_modules", name, "package.json"), "utf8")) as { version: string }).version]));
}

export const buildScript = [
  'import { build } from "esbuild";',
  'import postcss from "postcss";',
  'import tailwind from "tailwindcss";',
  'import autoprefixer from "autoprefixer";',
  'import { mkdir, readFile, writeFile } from "node:fs/promises";',
  'await mkdir("dist", { recursive: true });',
  'await build({ entryPoints: ["__studio/main.tsx"], outfile: "dist/app.js", bundle: true, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": \'"production"\' }, loader: { ".svg": "dataurl" } });',
  'let css = ""; try { css = await readFile("dist/app.css", "utf8"); } catch {}',
  'const processed = await postcss([tailwind({ content: ["./**/*.{ts,tsx}", "!./node_modules/**"], theme: { extend: {} }, plugins: [] }), autoprefixer]).process("@tailwind base;\\n@tailwind components;\\n@tailwind utilities;\\n" + css, { from: undefined });',
  'await writeFile("dist/app.css", processed.css);',
  'await writeFile("dist/index.html", \'<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reconstructed interface</title><link rel="stylesheet" href="./app.css"></head><body><div id="root"></div><script src="./app.js"></script></body></html>\');',
].join("\n");

export function scaffoldProject(files: ManifestFile[], plan: FilePlan, framework: "react-tailwind" | "nextjs-tailwind" = "react-tailwind", includeLock = true): ManifestFile[] {
  assertSourceManifest(files);
  if (!files.some(f => f.path === plan.entry) || !plan.entry.endsWith(".tsx")) throw new Error("The approved entry must be a supplied TSX default component.");
  const entry = "../" + plan.entry.replace(/\.tsx$/, "");
  const styles = files.filter(f => f.path.endsWith(".css")).map(f => 'import "../' + f.path + '";').join("\n");
  const manifest = {
    name: "reconstructed-interface", version: "1.0.0", private: true, type: "module",
    scripts: { typecheck: "tsc --noEmit", lint: "eslint . --max-warnings 0", build: "npm run typecheck && npm run lint && node scripts/build.mjs", dev: "npm run build && node scripts/serve.mjs", start: "node scripts/serve.mjs" },
    dependencies: versions(dependencies), devDependencies: versions(toolchain),
  };
  const trusted: ManifestFile[] = [
    { path: "package.json", content: JSON.stringify(manifest, null, 2) },
    { path: "tsconfig.json", content: JSON.stringify({ compilerOptions: { target: "ES2022", lib: ["ES2022", "DOM", "DOM.Iterable"], module: "ESNext", moduleResolution: "Bundler", jsx: "react-jsx", strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true, allowSyntheticDefaultImports: true, types: ["react", "react-dom"] }, include: ["**/*.ts", "**/*.tsx"], exclude: ["node_modules", "dist"] }, null, 2) },
    { path: "__studio/main.tsx", content: 'import React from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "' + entry + '";\n' + styles + '\ncreateRoot(document.getElementById("root")!).render(<App />);\n' },
    { path: "__studio/assets.d.ts", content: 'declare module "*.svg" { const url: string; export default url; }\ndeclare module "*.css";\n' },
    { path: "eslint.config.mjs", content: 'import ts from "typescript-eslint";\nimport a11y from "eslint-plugin-jsx-a11y";\nexport default [{ ignores: [".next/**", "next-env.d.ts", "dist/**", "node_modules/**", "scripts/**", "**/*.mjs"] }, ...ts.configs.recommended, { files: ["**/*.{ts,tsx}"], plugins: { "jsx-a11y": a11y }, rules: { "jsx-a11y/alt-text": "error", "jsx-a11y/label-has-associated-control": "error", "jsx-a11y/click-events-have-key-events": "error", "@typescript-eslint/no-explicit-any": "error", "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^React$" }] } }];\n' },
    { path: "scripts/build.mjs", content: buildScript },
    { path: "scripts/serve.mjs", content: 'import { createServer } from "node:http";\nimport { readFile } from "node:fs/promises";\nconst types = { "/": "text/html", "/index.html": "text/html", "/app.js": "text/javascript", "/app.css": "text/css" };\ncreateServer(async (req, res) => { const key = new URL(req.url, "http://localhost").pathname; if (!types[key]) { res.writeHead(404).end(); return; } try { res.setHeader("Content-Type", types[key]); res.end(await readFile(new URL("../dist/" + (key === "/" ? "index.html" : key.slice(1)), import.meta.url))); } catch { res.writeHead(500).end("Run npm run build first."); } }).listen(4173, "127.0.0.1", () => console.log("Open http://localhost:4173"));\n' },
    { path: "README.md", content: "# Reconstructed interface\n\nRequires Node.js 22.13 or newer.\n\n1. Run npm ci --ignore-scripts.\n2. Run npm run dev and open http://localhost:4173.\n3. Run npm run build for type checking, linting, and the production build.\n\nSource references and API keys are never included. Source fidelity and inferred responsive behavior should be reviewed before publishing. The included lockfile pins the complete dependency graph. The development command serves the built files; rebuild after editing source.\n" },
  ];
  if (framework === "nextjs-tailwind") {
    const nextManifest = { ...manifest, dependencies: { ...manifest.dependencies, ...versions(["next"]) }, scripts: { ...manifest.scripts, dev: "next dev", build: "npm run typecheck && npm run lint && next build", start: "next start" } };
    trusted[0].content = JSON.stringify(nextManifest, null, 2);
    trusted.push(
      { path: "app/layout.tsx", content: 'import type { ReactNode } from "react";\nimport "../__studio/tailwind.css";\nexport default function Layout({ children }: { children: ReactNode }) { return <html lang="en"><body>{children}</body></html>; }\n' },
      { path: "app/page.tsx", content: '"use client";\nimport App from "../' + plan.entry.replace(/\.tsx$/, "") + '";\n' + styles + '\nexport default App;\n' },
      { path: "__studio/tailwind.css", content: "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n" },
      { path: "postcss.config.mjs", content: 'export default { plugins: { tailwindcss: {}, autoprefixer: {} } };\n' },
      { path: "tailwind.config.mjs", content: 'export default { content: ["./**/*.{ts,tsx}", "!./node_modules/**"], theme: { extend: {} }, plugins: [] };\n' },
      { path: "next.config.mjs", content: 'export default { poweredByHeader: false };\n' },
    );
    trusted.find(f => f.path === "README.md")!.content = "# Reconstructed Next.js interface\n\nNode.js 22.13+ required. Run npm ci --ignore-scripts, then npm run dev and open http://localhost:3000. Run npm run build and npm start for production. All inference remains in the studio; this export needs no API key.\n";
  }
  if (includeLock) {
    const content = readFileSync(path.join(process.cwd(), "resources", "export", framework + ".lock.json"), "utf8");
    const lock = JSON.parse(content) as { packages: Record<string, { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }> };
    const exported = JSON.parse(trusted[0].content) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    for (const section of ["dependencies", "devDependencies"] as const) {
      if (JSON.stringify(lock.packages[""][section]) !== JSON.stringify(exported[section])) {
        const expected = exported[section], actual = lock.packages[""][section] ?? {};
        if (Object.keys(expected).length !== Object.keys(actual).length || Object.entries(expected).some(([key, value]) => actual[key] !== value)) throw new Error("Export toolchain changed. Run npm run export:locks before serving exports.");
      }
    }
    trusted.push({ path: "package-lock.json", content });
  }
  const seen = new Set(files.map(f => f.path));
  for (const file of trusted) { if (seen.has(file.path)) throw new Error("Source overlaps trusted scaffold: " + file.path); seen.add(file.path); }
  return [...files, ...trusted];
}
