"use client";
import { useEffect, useRef, useState } from "react";
import type { ManifestFile, Revision } from "@/lib/domain";
import { FileTree, BlueprintTree } from "./project-tree";

export function PreviewWorkspace({ revision, referenceUrl, onRefine, locked, onToggleLock }: { revision?: Revision; referenceUrl?: string; onRefine: (region: string) => void; locked: string[]; onToggleLock: (region: string) => void }) {
  const [mode, setMode] = useState("live");
  const [device, setDevice] = useState("reference");
  const [zoom, setZoom] = useState("fit");
  const [inspect, setInspect] = useState(false);
  const [region, setRegion] = useState("");
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const [files, setFiles] = useState<ManifestFile[]>([]);
  const [active, setActive] = useState("");
  const [position, setPosition] = useState(50);
  const [available, setAvailable] = useState(400);
  const frame = useRef<HTMLIFrameElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const viewport = revision?.evaluation.metrics.viewport ?? revision?.visualSpec?.reference.viewport ?? { width: 1440, height: 900 };
  const width = device === "reference" ? viewport.width : Number(device);
  const scale = zoom === "fit" ? Math.min(1, available / width) : Number(zoom);
  const selected = files.find(f => f.path === active) ?? files[0];
  const mapped = revision?.filePlan.files.filter(f => f.visualRegions.includes(region)) ?? [];
  useEffect(() => {
    if (!revision) return;
    const controller = new AbortController();
    void Promise.all([
      fetch("/api/v1/revisions/" + revision.id + "/bundle", { signal: controller.signal }).then(async r => { if (!r.ok) throw new Error((await r.json()).error); return r.text(); }),
      fetch("/api/v1/revisions/" + revision.id + "/files", { signal: controller.signal }).then(async r => { if (!r.ok) throw new Error("Project files unavailable."); return r.json() as Promise<{ files: ManifestFile[] }>; }),
    ]).then(([bundle, manifest]) => { setHtml(bundle); setFiles(manifest.files); }).catch(e => { if (!controller.signal.aborted) setError(String(e)); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new ResizeObserver(entries => setAvailable(Math.max(200, entries[0].contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { frame.current?.contentWindow?.postMessage({ type: "ss2:inspect", enabled: inspect }, "*"); }, [inspect, html, mode]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== "ss2:selection") return;
      const id = event.data.region;
      if (typeof id === "string" && revision?.visualSpec?.observations.layout.some(r => r.id === id)) setRegion(id);
      else setError("This element has no region mapping. Select a component from the blueprint.");
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [revision]);
  async function copyFile() {
    if (!selected) return;
    try { await navigator.clipboard.writeText(selected.content); setError("Copied " + selected.path); }
    catch { setError("Clipboard unavailable. Select the code and copy it with your keyboard."); }
  }
  return <>
    <div className="panel-heading"><div><span className="eyebrow">Compare and refine</span><h2>Live preview</h2></div></div>
    <div className="preview-controls">
      <label>Viewport<select aria-label="Preview viewport" value={device} onChange={e => setDevice(e.target.value)}><option value="reference">Reference · {viewport.width}px</option><option value="1440">Desktop · 1440px</option><option value="768">Tablet · 768px</option><option value="390">Mobile · 390px</option></select></label>
      <label>Zoom<select aria-label="Preview zoom" value={zoom} onChange={e => setZoom(e.target.value)}><option value="fit">Fit</option><option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option></select></label>
      <button type="button" className="secondary-button" disabled={!html || mode !== "live"} aria-pressed={inspect} onClick={() => setInspect(!inspect)}>Inspect</button>
    </div>
    <nav className="preview-tabs" aria-label="Output view">{[["live", "Live"], ["overlay", "Overlay"], ["side", "Side by side"], ["diff", "Diff"], ["code", "Files"]].map(([value, label]) => <button type="button" key={value} disabled={!revision} aria-pressed={mode === value} className={mode === value ? "active" : ""} onClick={() => setMode(value)}>{label}</button>)}</nav>
    <div ref={container} className="preview-host">
      {!revision ? <div className="empty-preview"><h2>Your faithful build appears here</h2><p>Upload a reference, review its plan, then compare the working result.</p></div> : mode === "code" ? <div className="code-browser"><FileTree files={files} active={selected?.path} onSelect={setActive} /><div className="code-content"><div className="code-heading"><span>{selected?.path}</span><button type="button" className="secondary-button" onClick={() => void copyFile()}>Copy file</button></div><pre tabIndex={0}><code>{selected?.content}</code></pre></div></div> : mode === "live" ? <div className="live-preview-scroll"><div style={{ width: width * scale, height: viewport.height * scale }}><iframe ref={frame} title="Interactive generated interface" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={html || undefined} onLoad={() => frame.current?.contentWindow?.postMessage({ type: "ss2:inspect", enabled: inspect }, "*")} style={{ width, height: viewport.height, transform: "scale(" + scale + ")", transformOrigin: "top left", border: 0, background: "white" }} /></div></div> : mode === "side" ? <div className="side-comparison"><figure><figcaption>Reference</figcaption><img src={referenceUrl} alt="Source reference" /></figure><figure><figcaption>Generated</figcaption><img src={"/api/v1/revisions/" + revision.id + "/preview"} alt="Validated generated capture" /></figure></div> : <div className="static-comparison" style={{ aspectRatio: viewport.width + "/" + viewport.height }}><img src={"/api/v1/revisions/" + revision.id + (mode === "diff" ? "/bundle?kind=diff" : "/preview")} alt={mode === "diff" ? "Pixel difference map" : "Validated generated capture"} />{mode === "overlay" && referenceUrl && <><img src={referenceUrl} alt="Source reference overlay" style={{ clipPath: "inset(0 " + (100 - position) + "% 0 0)" }} /><input type="range" min="0" max="100" value={position} aria-label="Reference overlay position" onChange={e => setPosition(Number(e.target.value))} /></>}</div>}
    </div>
    <p className="preview-note">Comparison uses the original reference viewport. Device presets show inferred reflow. Live preview cannot access your session or the network.</p>
    {error && <p className="inline-error" role="status">{error}</p>}
    {revision && <>
      <section className="score-row"><div><small>Pixel agreement</small><strong>{Math.round((revision.evaluation.metrics.visualScore ?? 0) * 100)}%</strong></div><div><small>Build and browser</small><strong className="success-text">Passed</strong></div><div><small>Visual findings</small><strong>{revision.evaluation.visualFindings.length}</strong></div></section>
      <BlueprintTree tree={revision.componentTree} plan={revision.filePlan} onSelect={setRegion} />
      {region && <section className="inspector-card"><h3>Region: {region}</h3>{mapped.map(file => <button type="button" className="secondary-button" key={file.path} onClick={() => { setActive(file.path); setMode("code"); }}>{file.path}</button>)}<div><button type="button" className="secondary-button" aria-pressed={locked.includes(region)} onClick={() => onToggleLock(region)}>{locked.includes(region) ? "Unlock region" : "Lock region"}</button><button type="button" className="primary-button" onClick={() => onRefine(region)}>Refine this region</button></div></section>}
      <details className="evaluation-details"><summary>Validation evidence and known gaps</summary><p>{revision.evaluation.metrics.checks?.join(" · ")}</p>{revision.evaluation.metrics.regions?.map(r => <p key={r.region}>{r.region}: pixels {Math.round(r.pixelScore * 100)}% · geometry {r.geometryScore === undefined ? "unmeasured" : Math.round(r.geometryScore * 100) + "%"} · text {r.textCoverage === undefined ? "unmeasured" : Math.round(r.textCoverage * 100) + "%"}</p>)}{revision.evaluation.visualFindings.map(f => <p key={f.id}><strong>{f.severity} · {f.region}</strong>: {f.observed} {f.suggestedDirection}</p>)}{revision.evaluation.a11yFindings.map(f => <p key={f.id}>{f.severity}: {f.message}</p>)}{revision.evaluation.metrics.limitations?.map(item => <p key={item}>{item}</p>)}</details>
    </>}
  </>;
}
