import ts from "typescript";
import type { Evaluation, FilePlan, GeneratedProject, ManifestFile } from "@/lib/domain";
import { assertSafeProjectPath, sourcePolicyFindings } from "@/lib/security";

const allowedDependencies = ["react", "react-dom", "lucide-react"];

function diagnosticMessage(diagnostic: ts.Diagnostic) {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
}

function localImportFindings(file: ManifestFile, plannedPaths: Set<string>) {
  const findings: string[] = [];
  for (const match of file.content.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']|import\s+["'](\.{1,2}\/[^"']+)["']/g)) {
    const raw = match[1] ?? match[2];
    const base = file.path.split("/").slice(0, -1).join("/");
    const normalized = raw.replace(/^\.\//, "").split("/").reduce<string[]>((parts, part) => {
      if (part === "..") parts.pop();
      else if (part !== ".") parts.push(part);
      return parts;
    }, base ? base.split("/") : []).join("/");
    const candidates = [normalized, `${normalized}.ts`, `${normalized}.tsx`, `${normalized}/index.ts`, `${normalized}/index.tsx`];
    if (!candidates.some((candidate) => plannedPaths.has(candidate))) findings.push(`Unresolved local import ${raw} in ${file.path}.`);
  }
  return findings;
}

function accessibilityFindings(files: ManifestFile[]) {
  const findings: Evaluation["a11yFindings"] = [];
  for (const file of files) {
    if (/\.(tsx|jsx|html)$/.test(file.path)) {
      if (/<img\b(?![^>]*\balt=)[^>]*>/i.test(file.content)) findings.push({ id: `img-alt-${file.path}`, severity: "serious", target: file.path, message: "Image elements require meaningful alt text or an explicit empty alt for decoration." });
      if (/<(?:div|span)\b[^>]*\bonClick=/i.test(file.content)) findings.push({ id: `clickable-nonsemantic-${file.path}`, severity: "moderate", target: file.path, message: "Use a semantic button or link for click interactions so keyboard behavior is preserved." });
      if (/<button\b[^>]*>(?:\s*<[^>]+>\s*)+<\/button>/i.test(file.content) && !/aria-label=/i.test(file.content)) findings.push({ id: `icon-button-label-${file.path}`, severity: "moderate", target: file.path, message: "Icon-only buttons need an aria-label." });
    }
  }
  return findings;
}

export function validateGeneratedProject(project: GeneratedProject, plan: FilePlan): Evaluation {
  const buildFindings: Evaluation["buildFindings"] = [];
  const plannedPaths = new Set(plan.files.map((file) => file.path));
  const returnedPaths = new Set<string>();
  for (const file of project.files) {
    try {
      const normalized = assertSafeProjectPath(file.path);
      if (normalized !== file.path) buildFindings.push({ id: `normalized-${file.path}`, file: file.path, category: "parse", message: "Returned path is not normalized." });
    } catch (error) {
      buildFindings.push({ id: `path-${file.path}`, file: file.path, category: "parse", message: error instanceof Error ? error.message : "Unsafe path." });
      continue;
    }
    if (returnedPaths.has(file.path)) buildFindings.push({ id: `duplicate-${file.path}`, file: file.path, category: "parse", message: "A generated path appears more than once." });
    returnedPaths.add(file.path);
    if (!plannedPaths.has(file.path)) buildFindings.push({ id: `unplanned-${file.path}`, file: file.path, category: "runtime", message: "Generated a path outside the approved file plan." });
    for (const finding of sourcePolicyFindings(file.path, file.content, allowedDependencies)) buildFindings.push({ id: `policy-${file.path}-${buildFindings.length}`, file: file.path, category: "runtime", message: finding });
    if (/\.(ts|tsx|js|jsx)$/.test(file.path)) {
      const result = ts.transpileModule(file.content, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true, fileName: file.path });
      for (const diagnostic of result.diagnostics ?? []) {
        if (diagnostic.category === ts.DiagnosticCategory.Error) buildFindings.push({ id: `syntax-${file.path}-${buildFindings.length}`, file: file.path, category: "parse", message: diagnosticMessage(diagnostic) });
      }
    }
    for (const finding of localImportFindings(file, plannedPaths)) buildFindings.push({ id: `import-${file.path}-${buildFindings.length}`, file: file.path, category: "build", message: finding });
  }
  for (const expected of plannedPaths) if (!returnedPaths.has(expected)) buildFindings.push({ id: `missing-${expected}`, file: expected, category: "build", message: "A file required by the approved plan was not returned." });
  const a11yFindings = accessibilityFindings(project.files);
  return {
    buildFindings,
    a11yFindings,
    visualFindings: [],
    metrics: { horizontalOverflow: false },
  };
}

export function cleanManifest(files: ManifestFile[]) {
  return files.map((file) => ({ path: assertSafeProjectPath(file.path), content: file.content }));
}
