"use client";
import type { ComponentTree, FilePlan, ManifestFile } from "@/lib/domain";

type Node = { name: string; path: string; children: Map<string, Node>; file?: ManifestFile };
export function FileTree({ files, active, onSelect }: { files: ManifestFile[]; active?: string; onSelect: (path: string) => void }) {
  const root: Node = { name: "", path: "", children: new Map() };
  for (const file of files) {
    let node = root;
    const parts = file.path.split("/");
    parts.forEach((part, index) => {
      if (!node.children.has(part)) node.children.set(part, { name: part, path: parts.slice(0, index + 1).join("/"), children: new Map() });
      node = node.children.get(part)!;
    });
    node.file = file;
  }
  const render = (node: Node): React.ReactNode => node.file
    ? <li key={node.path}><button type="button" aria-label={node.path} aria-current={node.path === active ? "true" : undefined} className={node.path === active ? "active" : ""} title={node.path} onClick={() => onSelect(node.path)}>{node.name}</button></li>
    : <li key={node.path}><details open><summary>{node.name}</summary><ul>{[...node.children.values()].sort((a, b) => Number(Boolean(a.file)) - Number(Boolean(b.file)) || a.name.localeCompare(b.name)).map(render)}</ul></details></li>;
  return <nav aria-label="Project files" className="file-tree"><ul>{[...root.children.values()].map(render)}</ul></nav>;
}

export function BlueprintTree({ tree, plan, onSelect }: { tree?: ComponentTree; plan?: FilePlan; onSelect?: (region: string) => void }) {
  if (!tree || !plan) return null;
  const render = (node: ComponentTree, depth = 0): React.ReactNode => {
    const mapped = plan.files.filter(f => f.visualRegions.includes(node.visualRegion));
    return <li key={node.id}><details open={depth === 0}><summary>{node.type} <small>{node.semanticRole}</small></summary>{onSelect ? <button type="button" onClick={() => onSelect(node.visualRegion)}>{node.visualRegion}</button> : <span>{node.visualRegion}</span>}{mapped.map(f => <code key={f.path}>{f.path}</code>)}{node.children.length > 0 && <ul>{node.children.map(child => render(child, depth + 1))}</ul>}</details></li>;
  };
  return <section className="blueprint-tree"><h3>Component blueprint</h3><p>{plan.files.length} source files · mapped to observed regions</p><ul>{render(tree)}</ul></section>;
}
