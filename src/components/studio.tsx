"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowLeftRight, Braces, Check, ChevronDown, ClipboardPaste, CloudUpload, Code2, Download, FileImage, FileVideo, ImageIcon, Info, LoaderCircle, LockKeyhole, Monitor, MoreHorizontal, MousePointer2, Play, Plus, RefreshCw, Sparkles, Undo2, Upload, WandSparkles, X, ZoomIn } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import type { GenerationJob, JobEvent, ModelCandidate, Revision, VisualSpec } from "@/lib/domain";

type UploadStatus = "idle" | "drag-over-valid" | "drag-over-invalid" | "uploading" | "processing" | "ready" | "error";
type ReferenceState = { assetId?: string; file?: File; previewUrl?: string; name: string; mimeType: string; width?: number; height?: number; kind: "image" | "video" | "video_frame" };
type VideoFrame = { id: string; file: File; url: string; time: number };
type UiEvent = Pick<JobEvent, "type" | "level" | "safeMessage" | "createdAt"> & { sequence: number };

const acceptedTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif", "video/mp4", "video/webm", "video/quicktime"]);
const maxUploadBytes = 16 * 1024 * 1024;
const phaseLabels = [
  ["reference", "Reference"],
  ["spec", "Visual spec"],
  ["blueprint", "Blueprint"],
  ["validate", "Validation"],
  ["ready", "Ready"],
] as const;

function errorText(value: unknown) {
  return value instanceof Error ? value.message : "Something went wrong. Please retry safely.";
}

function mutationHeaders(json = false) {
  return { "Idempotency-Key": crypto.randomUUID(), ...(json ? { "Content-Type": "application/json" } : {}) };
}

function isImage(file: File) {
  return file.type.startsWith("image/");
}

function isVideo(file: File) {
  return file.type.startsWith("video/");
}

async function dimensionsFor(file: File) {
  const url = URL.createObjectURL(file);
  try {
    if (isImage(file)) {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("This image could not be decoded."));
        image.src = url;
      });
      return { width: image.naturalWidth, height: image.naturalHeight };
    }
    const video = document.createElement("video");
    video.preload = "metadata";
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("This video could not be decoded."));
      video.src = url;
    });
    return { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function extractFrames(file: File): Promise<VideoFrame[]> {
  const videoUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("The browser could not extract frames from this video."));
      video.src = videoUrl;
    });
    const timestamps = [...new Set([0, Math.max(0, video.duration / 2), Math.max(0, video.duration - 0.08)])];
    const frames: VideoFrame[] = [];
    for (const time of timestamps) {
      video.currentTime = Math.min(time, Math.max(0, video.duration - 0.02));
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve();
        video.onerror = () => reject(new Error("A video frame could not be read."));
      });
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable for video frame extraction.");
      context.drawImage(video, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("A video frame could not be encoded.")), "image/png"));
      const frame = new File([blob], `${file.name.replace(/\.[^.]+$/, "")}-${Math.round(time * 1000)}ms.png`, { type: "image/png" });
      frames.push({ id: `${time}`, file: frame, url: URL.createObjectURL(frame), time });
    }
    return frames;
  } finally {
    URL.revokeObjectURL(videoUrl);
  }
}

function IconButton({ label, children, onClick, disabled = false }: { label: string; children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return <button type="button" className="icon-button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

function PhaseStepper({ phase, hasSpec }: { phase: string; hasSpec: boolean }) {
  const activeIndex = phase === "ready" ? 4 : phase === "validating" || phase === "evaluating" || phase === "refining" ? 3 : phase === "planning" || phase === "generating" ? 2 : hasSpec ? 1 : 0;
  return <ol className="phase-stepper" aria-label="Generation workflow">
    {phaseLabels.map(([key, label], index) => <li key={key} className={index < activeIndex ? "complete" : index === activeIndex ? "active" : ""}>
      <span>{index < activeIndex ? <Check size={13} /> : index + 1}</span><small>{label}</small>
    </li>)}
  </ol>;
}

function EmptyPreview() {
  return <div className="empty-preview"><div className="empty-preview-art"><Code2 size={40} /><Sparkles size={21} /></div><h2>Your faithful build appears here</h2><p>Confirm the visual specification to create a validated, comparable revision.</p></div>;
}

export function Studio() {
  const fileInput = useRef<HTMLInputElement>(null);
  const commandInput = useRef<HTMLInputElement>(null);
  const [projectId] = useState(() => typeof crypto === "undefined" ? "pending-project" : crypto.randomUUID());
  const [projectName, setProjectName] = useState("Untitled reconstruction");
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("Drop a reference to begin.");
  const [reference, setReference] = useState<ReferenceState>();
  const [frames, setFrames] = useState<VideoFrame[]>([]);
  const [brief, setBrief] = useState("");
  const [visualSpec, setVisualSpec] = useState<VisualSpec>();
  const [specEditing, setSpecEditing] = useState(false);
  const [specText, setSpecText] = useState("");
  const [models, setModels] = useState<ModelCandidate[]>([]);
  const [modelId, setModelId] = useState("");
  const [modelError, setModelError] = useState("");
  const [job, setJob] = useState<GenerationJob>();
  const [events, setEvents] = useState<UiEvent[]>([]);
  const [revision, setRevision] = useState<Revision>();
  const [activeFile, setActiveFile] = useState("");
  const [view, setView] = useState<"preview" | "code">("preview");
  const [panel, setPanel] = useState(0);
  const [compare, setCompare] = useState(false);
  const [comparePosition, setComparePosition] = useState(54);
  const [dragDepth, setDragDepth] = useState(0);
  const [urlValue, setUrlValue] = useState("");
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [command, setCommand] = useState("");
  const [showShortcuts, setShowShortcuts] = useState(false);

  const activePhase = job?.phase ?? (visualSpec ? "awaiting_spec_confirmation" : "queued");
  const previewUrl = revision ? `/api/v1/revisions/${revision.id}/preview` : undefined;
  const selectedFile = revision?.files.find((file) => file.path === activeFile) ?? revision?.files[0];
  const progress = useMemo(() => ({ queued: 3, analysing: 22, awaiting_spec_confirmation: 33, planning: 46, generating: 62, validating: 76, rendering: 84, evaluating: 91, refining: 94, ready: 100, failed: 100, cancelling: 100, cancelled: 100 } as Record<string, number>)[activePhase] ?? 8, [activePhase]);

  useEffect(() => {
    void fetch("/api/v1/models").then(async (response) => {
      const body = await response.json() as { models?: ModelCandidate[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Free model catalog is unavailable.");
      setModels(body.models ?? []);
    }).catch((error: unknown) => setModelError(errorText(error)));
  }, []);

  useEffect(() => {
    const keydown = (event: globalThis.KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        commandInput.current?.focus();
      } else if (!typing && event.key === "?") {
        setShowShortcuts(true);
      } else if (!typing && (event.key === "[" || event.key === "]")) {
        setPanel((value) => Math.max(0, Math.min(2, value + (event.key === "]" ? 1 : -1))));
      } else if (event.key === "Escape") {
        setShowShortcuts(false);
        setShowUrlInput(false);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const item = [...event.clipboardData?.items ?? []].find((candidate) => candidate.type.startsWith("image/"));
      const image = item?.getAsFile();
      if (image) {
        event.preventDefault();
        void receiveFile(new File([image], `pasted-reference.${image.type.split("/")[1] || "png"}`, { type: image.type }));
      }
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  });

  useEffect(() => () => {
    if (reference?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(reference.previewUrl);
  }, [reference?.previewUrl]);

  useEffect(() => () => {
    frames.forEach((frame) => URL.revokeObjectURL(frame.url));
  }, [frames]);

  async function uploadFile(file: File, dimensions?: { width: number; height: number }, role?: "video_frame") {
    const form = new FormData();
    form.set("projectId", projectId);
    form.set("file", file);
    if (dimensions) {
      form.set("width", String(dimensions.width));
      form.set("height", String(dimensions.height));
    }
    if (role) form.set("role", role);
    const response = await fetch("/api/v1/uploads/initiate", { method: "POST", headers: mutationHeaders(), body: form });
    const body = await response.json() as { projectId?: string; asset?: { id: string; kind: ReferenceState["kind"]; name: string; mimeType: string; width?: number; height?: number }; error?: string };
    if (!response.ok || !body.asset || !body.projectId) throw new Error(body.error ?? "Upload could not be accepted.");
    return body.asset;
  }

  async function receiveFile(file: File) {
    if (!acceptedTypes.has(file.type) || file.size > maxUploadBytes) {
      setStatus("error");
      setStatusMessage("Use an image or short video under 16 MB. The original stays intact when a file is rejected.");
      return;
    }
    setStatus("uploading");
    setStatusMessage(`Safely checking ${file.name}…`);
    try {
      const dimensions = await dimensionsFor(file);
      const previewUrl = URL.createObjectURL(file);
      setVisualSpec(undefined);
      setRevision(undefined);
      setEvents([]);
      setJob(undefined);
      if (isVideo(file)) {
        await uploadFile(file, dimensions);
        setStatus("processing");
        setStatusMessage("Extracting representative frames in your browser…");
        const extracted = await extractFrames(file);
        setReference({ file, previewUrl, name: file.name, mimeType: file.type, width: dimensions.width, height: dimensions.height, kind: "video" });
        setFrames(extracted);
        setStatus("ready");
        setStatusMessage("Choose the frame that best represents the interface state.");
      } else {
        const asset = await uploadFile(file, dimensions);
        setReference({ assetId: asset.id, file, previewUrl, name: file.name, mimeType: file.type, width: dimensions.width, height: dimensions.height, kind: "image" });
        setFrames([]);
        setStatus("ready");
        setStatusMessage("Reference accepted. Inspect it to create a visual specification.");
      }
    } catch (error) {
      setStatus("error");
      setStatusMessage(errorText(error));
    }
  }

  async function chooseFrame(frame: VideoFrame) {
    setStatus("uploading");
    setStatusMessage("Uploading the selected reference frame…");
    try {
      const dimensions = await dimensionsFor(frame.file);
      const asset = await uploadFile(frame.file, dimensions, "video_frame");
      setReference({ assetId: asset.id, file: frame.file, previewUrl: frame.url, name: frame.file.name, mimeType: frame.file.type, width: dimensions.width, height: dimensions.height, kind: "video_frame" });
      setStatus("ready");
      setStatusMessage(`Selected the ${Math.round(frame.time * 1000)} ms frame as the visual authority.`);
    } catch (error) {
      setStatus("error");
      setStatusMessage(errorText(error));
    }
  }

  async function pasteImage() {
    try {
      if (!navigator.clipboard?.read) throw new Error("Clipboard image access is not available in this browser. Use Ctrl/Cmd + V or choose a file instead.");
      const items = await navigator.clipboard.read();
      const item = items.find((candidate) => candidate.types.some((type) => type.startsWith("image/")));
      const type = item?.types.find((candidate) => candidate.startsWith("image/"));
      if (!item || !type) throw new Error("Your clipboard does not contain an image.");
      const image = await item.getType(type);
      await receiveFile(new File([image], `pasted-reference.${type.split("/")[1] ?? "png"}`, { type }));
    } catch (error) {
      setStatus("error");
      setStatusMessage(errorText(error));
    }
  }

  async function importUrl() {
    if (!urlValue.trim()) return;
    setStatus("uploading");
    setStatusMessage("Downloading the public HTTPS image through the protected server fetcher…");
    try {
      const response = await fetch("/api/v1/uploads/from-url", { method: "POST", headers: mutationHeaders(true), body: JSON.stringify({ url: urlValue.trim(), projectId }) });
      const body = await response.json() as { projectId?: string; asset?: { id: string; name: string; mimeType: string }; error?: string };
      if (!response.ok || !body.asset || !body.projectId) throw new Error(body.error ?? "The URL could not be imported.");
      setReference({ assetId: body.asset.id, previewUrl: `/api/v1/references/${body.asset.id}/content`, name: body.asset.name, mimeType: body.asset.mimeType, kind: "image" });
      setFrames([]);
      setStatus("ready");
      setShowUrlInput(false);
      setStatusMessage("Reference URL fetched safely. Inspect it to create a visual specification.");
    } catch (error) {
      setStatus("error");
      setStatusMessage(errorText(error));
    }
  }

  async function analyse() {
    if (!reference?.assetId || projectId === "pending-project") return;
    setStatus("processing");
    setStatusMessage("Asking a vision-capable, currently free OpenRouter model for evidence-led observations…");
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/spec`, { method: "POST", headers: mutationHeaders(true), body: JSON.stringify({ assetId: reference.assetId, userIntent: brief || undefined }) });
      const body = await response.json() as { spec?: VisualSpec; error?: string };
      if (!response.ok || !body.spec) throw new Error(body.error ?? "Visual analysis could not complete.");
      setVisualSpec(body.spec);
      setSpecText(JSON.stringify(body.spec, null, 2));
      setStatus("ready");
      setStatusMessage("Visual Spec ready. Review observations and assumptions before generation.");
    } catch (error) {
      setStatus("error");
      setStatusMessage(errorText(error));
    }
  }

  function saveSpecEdits() {
    try {
      const parsed = JSON.parse(specText) as VisualSpec;
      setVisualSpec(parsed);
      setSpecEditing(false);
      setStatusMessage("Visual Spec edits are staged. Generate when you are happy with the approved scope.");
    } catch {
      setStatus("error");
      setStatusMessage("The Visual Spec must remain valid JSON. Your last saved specification is unchanged.");
    }
  }

  async function generate() {
    if (!visualSpec || !reference?.assetId) return;
    setStatusMessage("Starting a traceable generation job. Code stays server-side until it passes validation.");
    setEvents([]);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/generations`, { method: "POST", headers: mutationHeaders(true), body: JSON.stringify({ assetId: reference.assetId, visualSpec, targetViewport: visualSpec.reference.viewport, framework: "react-tailwind", modelId: modelId || undefined }) });
      const body = await response.json() as { job?: GenerationJob; error?: string };
      if (!response.ok || !body.job) throw new Error(body.error ?? "Generation could not start.");
      setJob(body.job);
      subscribeToJob(body.job.id);
    } catch (error) {
      setStatus("error");
      setStatusMessage(errorText(error));
    }
  }

  async function cancelJob() {
    if (!job || ["ready", "failed", "cancelled"].includes(job.phase)) return;
    try {
      const response = await fetch(`/api/v1/generations/${job.id}`, { method: "POST", headers: mutationHeaders() });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Cancellation request could not be sent.");
      setStatusMessage("Cancellation requested. The active step will stop safely without replacing your last ready revision.");
    } catch (error) {
      setStatus("error");
      setStatusMessage(errorText(error));
    }
  }

  function subscribeToJob(jobId: string) {
    const source = new EventSource(`/api/v1/generations/${jobId}/events`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as UiEvent;
      setEvents((current) => current.some((item) => item.sequence === event.sequence) ? current : [...current, event]);
      setJob((current) => current ? { ...current, phase: event.type.includes("ready") ? "ready" : current.phase } : current);
    };
    source.addEventListener("complete", (message) => {
      const result = JSON.parse((message as MessageEvent<string>).data) as { phase: GenerationJob["phase"]; error?: string; revisionId?: string };
      setJob((current) => current ? { ...current, phase: result.phase, error: result.error, revisionId: result.revisionId } : current);
      if (result.revisionId) void loadRevision(result.revisionId);
      if (result.error) setStatusMessage(result.error);
      source.close();
    });
    source.onerror = () => source.close();
  }

  async function loadRevision(revisionId: string) {
    try {
      const response = await fetch(`/api/v1/revisions/${revisionId}`);
      const body = await response.json() as { revision?: Revision; error?: string };
      if (!response.ok || !body.revision) throw new Error(body.error ?? "The completed revision could not be opened.");
      setRevision(body.revision);
      setActiveFile(body.revision.files[0]?.path ?? "");
      setView("preview");
      setStatusMessage("Validated revision ready. Compare it with the source, inspect files, or export it.");
    } catch (error) {
      setStatus("error");
      setStatusMessage(errorText(error));
    }
  }

  async function exportRevision() {
    if (!revision) return;
    try {
      const response = await fetch(`/api/v1/revisions/${revision.id}/export`, { method: "POST" });
      if (!response.ok) throw new Error("The export archive could not be created.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "reconstruction"}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatusMessage("Immutable revision archive downloaded.");
    } catch (error) {
      setStatus("error");
      setStatusMessage(errorText(error));
    }
  }

  function commandSubmit(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || !command.trim()) return;
    event.preventDefault();
    if (!revision) {
      setStatusMessage("Create a ready revision before sending a targeted refinement.");
      return;
    }
    void startUserRefinement(command.trim());
  }

  async function startUserRefinement(userIntent: string) {
    if (!revision) return;
    setStatusMessage("Starting a bounded refinement. The current revision remains immutable while it validates.");
    try {
      const response = await fetch(`/api/v1/revisions/${revision.id}/refine`, { method: "POST", headers: mutationHeaders(true), body: JSON.stringify({ userIntent, lockedRegions: [] }) });
      const body = await response.json() as { job?: GenerationJob; error?: string };
      if (!response.ok || !body.job) throw new Error(body.error ?? "Refinement could not start.");
      setCommand("");
      setEvents([]);
      setJob(body.job);
      subscribeToJob(body.job.id);
    } catch (error) {
      setStatus("error");
      setStatusMessage(errorText(error));
    }
  }

  const selectedReferenceLabel = reference?.kind === "video_frame" ? "Selected video frame" : reference?.kind === "video" ? "Video reference" : "Reference";

  return <main className="studio-shell" onDragEnter={(event: DragEvent<HTMLElement>) => { event.preventDefault(); setDragDepth((value) => value + 1); const valid = [...event.dataTransfer.items].some((item) => acceptedTypes.has(item.type)); setStatus(valid ? "drag-over-valid" : "drag-over-invalid"); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { event.preventDefault(); setDragDepth((value) => { const next = Math.max(0, value - 1); if (!next && status.startsWith("drag-over")) setStatus(reference ? "ready" : "idle"); return next; }); }} onDrop={(event) => { event.preventDefault(); setDragDepth(0); const file = [...event.dataTransfer.files].at(0); if (file) void receiveFile(file); else { setStatus("error"); setStatusMessage("Drop a supported image or short video file."); } }}>
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <header className="topbar glass">
      <div className="brand"><div className="brand-mark"><WandSparkles size={19} /></div><span>PixelForge <i>AI</i></span></div>
      <div className="project-title"><input aria-label="Project name" value={projectName} onChange={(event) => setProjectName(event.target.value)} /><span className={job?.phase === "ready" ? "status-dot ready" : "status-dot"}>{job?.phase === "ready" ? "Ready" : visualSpec ? "Blueprint confirmed" : "Draft"}</span></div>
      <div className="topbar-actions">
        <IconButton label="Undo" disabled><Undo2 size={16} /></IconButton><IconButton label="Redo" disabled><RefreshCw size={16} /></IconButton>
        <label className="model-select"><Sparkles size={14} /><select aria-label="OpenRouter model" value={modelId} onChange={(event) => setModelId(event.target.value)}><option value="">Balanced free · auto</option>{models.map((model) => <option key={model.id} value={model.id}>{model.id} · {model.family}</option>)}</select><ChevronDown size={14} /></label>
        <button type="button" className="secondary-button export-button" onClick={exportRevision} disabled={!revision}><Download size={15} /> Export</button>
      </div>
    </header>

    {dragDepth > 0 && <div className={`drop-overlay ${status === "drag-over-invalid" ? "invalid" : ""}`}><CloudUpload size={34} /><strong>{status === "drag-over-invalid" ? "That file type is not supported" : "Drop the reference to add it"}</strong><span>PNG, JPG, WebP, AVIF, GIF, MP4, WebM, or MOV · up to 16 MB</span></div>}

    <section className="workspace">
      <nav className="mobile-tabs" aria-label="Workspace panels">{["Reference", "Build", "Preview"].map((label, index) => <button type="button" key={label} className={panel === index ? "active" : ""} onClick={() => setPanel(index)}>{label}</button>)}</nav>
      <aside className={`workspace-panel reference-panel glass ${panel === 0 ? "mobile-visible" : ""}`}>
        <div className="panel-heading"><div><span className="eyebrow">Source material</span><h1>Reference</h1></div><IconButton label="Reference options"><MoreHorizontal size={17} /></IconButton></div>
        {!reference && <section className={`composer ${status === "error" ? "has-error" : ""}`}>
          <div className="composer-icon"><Upload size={25} /></div><h2>Drop a reference to begin</h2><p>Reconstruct what you can see—then improve only the parts evidence safely supports.</p>
          <button type="button" className="primary-button" onClick={() => fileInput.current?.click()} disabled={projectId === "pending-project"}><FileImage size={16} /> Choose a file</button>
          <div className="composer-actions"><button type="button" onClick={pasteImage}><ClipboardPaste size={15} /> Paste image</button><button type="button" onClick={() => setShowUrlInput((value) => !value)}><Plus size={15} /> Image URL</button></div>
          {showUrlInput && <div className="url-entry"><input value={urlValue} onChange={(event) => setUrlValue(event.target.value)} placeholder="https://example.com/reference.png" aria-label="Public image URL" /><button type="button" onClick={() => void importUrl()} aria-label="Import image URL"><Upload size={15} /></button></div>}
        </section>}
        {reference && <>
          <div className="reference-canvas">
            {reference.kind === "video" ? <video src={reference.previewUrl} controls muted playsInline /> : <img src={reference.previewUrl} alt={`${selectedReferenceLabel}: ${reference.name}`} />}
            <div className="canvas-badge">{reference.kind === "video" ? <FileVideo size={13} /> : <ImageIcon size={13} />}{selectedReferenceLabel}</div>
          </div>
          <div className="reference-meta"><div><strong>{reference.name}</strong><span>{reference.width && reference.height ? `${reference.width} × ${reference.height}` : "Dimensions confirmed after analysis"}</span></div><button type="button" onClick={() => { setReference(undefined); setFrames([]); setVisualSpec(undefined); setRevision(undefined); setStatus("idle"); setStatusMessage("Reference cleared. Drop a new one to begin."); }} aria-label="Remove reference"><X size={16} /></button></div>
          {frames.length > 0 && reference.kind === "video" && <section className="frame-picker"><div className="mini-heading"><span>Extracted states</span><small>Choose a visual authority</small></div><div className="frame-row">{frames.map((frame) => <button type="button" key={frame.id} onClick={() => void chooseFrame(frame)}><img src={frame.url} alt={`Video frame at ${Math.round(frame.time * 1000)} milliseconds`} /><span>{Math.round(frame.time * 1000)}ms</span></button>)}</div></section>}
          <div className="reference-actions"><button type="button" className="secondary-button" onClick={() => fileInput.current?.click()}><Plus size={15} /> Replace</button><button type="button" className="secondary-button" onClick={pasteImage}><ClipboardPaste size={15} /> Paste</button><button type="button" className="secondary-button" onClick={() => setCompare((value) => !value)} disabled={!revision}><ArrowLeftRight size={15} /> Compare</button></div>
        </>}
        <input ref={fileInput} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/gif,video/mp4,video/webm,video/quicktime" onChange={(event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) void receiveFile(file); event.target.value = ""; }} />
        <div className="brief-block"><label htmlFor="brief">Implementation brief <span>optional</span></label><textarea id="brief" value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="e.g. Target desktop viewport; keep the selected tab state." maxLength={4000} /><small>Clarifies scope, never overrides the visible reference.</small></div>
        <section className="privacy-note"><LockKeyhole size={15} /><p>Originals stay in private storage. Your OpenRouter key is only ever used by the server.</p></section>
      </aside>

      <section className={`workspace-panel build-panel glass ${panel === 1 ? "mobile-visible" : ""}`}>
        <div className="panel-heading"><div><span className="eyebrow">Evidence-led workflow</span><h2>Build activity</h2></div><span className={`phase-pill ${job?.phase === "failed" ? "failed" : ""}`}>{job?.phase === "failed" ? "Needs attention" : job?.phase === "ready" ? "Ready" : visualSpec ? "In review" : "Waiting"}</span></div>
        <PhaseStepper phase={activePhase} hasSpec={Boolean(visualSpec)} />
        <div className="progress-track" aria-label={`Job progress ${progress}%`}><motion.div className="progress-value" animate={{ width: `${progress}%` }} transition={{ duration: 0.25 }} /></div>
        <section className="activity-card"><div className="activity-card-heading"><span>Safe job events</span>{job && <small>{job.id.slice(0, 8)}</small>}</div>{events.length ? <ol className="event-log">{events.map((event) => <li key={event.sequence} className={event.level}><span /><div><strong>{event.type.replaceAll(".", " ")}</strong><p>{event.safeMessage}</p></div><time>{new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></li>)}</ol> : <div className="empty-events"><LoaderCircle size={16} /><span>{visualSpec ? "Ready to generate from the approved blueprint." : "The visual plan appears here after inspection."}</span></div>}</section>
        {visualSpec ? <section className="spec-card"><div className="mini-heading"><span>Visual Spec</span><button type="button" onClick={() => setSpecEditing((value) => !value)}>{specEditing ? "Cancel" : "Edit JSON"}</button></div>{specEditing ? <><textarea className="json-editor" value={specText} onChange={(event) => setSpecText(event.target.value)} aria-label="Editable Visual Spec JSON" /><button type="button" className="secondary-button" onClick={saveSpecEdits}><Check size={15} /> Save edits</button></> : <><div className="spec-facts"><div><small>Viewport</small><strong>{visualSpec.reference.viewport.width} × {visualSpec.reference.viewport.height}</strong></div><div><small>Confidence</small><strong>{visualSpec.reference.confidence}</strong></div><div><small>Regions</small><strong>{visualSpec.observations.layout.length}</strong></div></div><ul>{visualSpec.observations.hierarchy.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul>{visualSpec.assumptions.length > 0 && <details><summary>{visualSpec.assumptions.length} recorded assumption{visualSpec.assumptions.length === 1 ? "" : "s"}</summary>{visualSpec.assumptions.map((item) => <p key={item.detail}><strong>{item.detail}</strong> — {item.conservativeDefault}</p>)}</details>}</>}</section> : <section className="inspect-card"><Info size={18} /><div><strong>Inspect before code</strong><p>Observed facts, unknown details, and constrained assumptions remain visible before the model can generate.</p></div></section>}
        <div className="build-action">{job && !["ready", "failed", "cancelled"].includes(job.phase) ? <button type="button" className="secondary-button wide" onClick={() => void cancelJob()}><X size={16} /> Cancel safely</button> : <button type="button" className="primary-button wide" onClick={() => visualSpec ? void generate() : void analyse()} disabled={!reference?.assetId || status === "uploading" || status === "processing"}>{visualSpec ? <><WandSparkles size={17} /> Generate validated build</> : <><ZoomIn size={17} /> Inspect reference</>}</button>}{modelError && <p className="inline-error"><AlertCircle size={14} /> {modelError}</p>}</div>
      </section>

      <section className={`workspace-panel preview-panel glass ${panel === 2 ? "mobile-visible" : ""}`}>
        <div className="panel-heading"><div><span className="eyebrow">Output review</span><h2>Live preview</h2></div><div className="preview-tools"><IconButton label="Desktop viewport"><Monitor size={16} /></IconButton><IconButton label="Inspect elements" disabled={!revision}><MousePointer2 size={16} /></IconButton><IconButton label="Zoom preview" disabled={!revision}><ZoomIn size={16} /></IconButton></div></div>
        <div className="preview-tabs"><button type="button" className={view === "preview" ? "active" : ""} onClick={() => setView("preview")}><Play size={14} /> Preview</button><button type="button" className={view === "code" ? "active" : ""} onClick={() => setView("code")} disabled={!revision}><Braces size={14} /> Code</button><button type="button" className={compare ? "active" : ""} onClick={() => setCompare((value) => !value)} disabled={!revision}><ArrowLeftRight size={14} /> Compare</button></div>
        <div className="preview-frame">{view === "code" && revision ? <div className="code-browser"><div className="file-list">{revision.files.map((file) => <button type="button" key={file.path} className={selectedFile?.path === file.path ? "active" : ""} onClick={() => setActiveFile(file.path)}>{file.path}</button>)}</div><pre><code>{selectedFile?.content}</code></pre></div> : previewUrl ? <div className="comparison-stage"><img src={previewUrl} alt="Generated isolated preview" />{compare && reference?.previewUrl && <div className="reference-overlay" style={{ clipPath: `inset(0 ${100 - comparePosition}% 0 0)` }}><img src={reference.previewUrl} alt="Source reference overlay" /></div>}{compare && <input type="range" min="0" max="100" value={comparePosition} onChange={(event) => setComparePosition(Number(event.target.value))} aria-label="Reference overlay position" />}</div> : <EmptyPreview />}</div>
        {revision && <div className="score-row"><div><small>Visual comparison</small><strong>{Math.round((revision.evaluation.metrics.visualScore ?? 0) * 100)}%</strong></div><div><small>Validation</small><strong className="success-text">Passed</strong></div><div><small>Assumptions</small><strong>{revision.assumptions.length}</strong></div><button type="button" className="secondary-button" onClick={() => setView("code")}><Code2 size={15} /> Inspect files</button></div>}
        {revision?.evaluation.visualFindings.length ? <section className="finding-card"><AlertCircle size={16} /><div><strong>Visual findings</strong><p>{revision.evaluation.visualFindings[0].region}: {revision.evaluation.visualFindings[0].suggestedDirection}</p></div></section> : null}
      </section>
    </section>

    <footer className="command-bar glass"><button type="button" className="command-attach" onClick={() => fileInput.current?.click()} aria-label="Attach another reference"><Plus size={17} /></button><input ref={commandInput} value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={commandSubmit} placeholder="Refine the approved build…" aria-label="Targeted refinement instruction" /><kbd>Ctrl K</kbd><button type="button" className="primary-button command-submit" onClick={() => { if (command.trim()) void startUserRefinement(command.trim()); }} disabled={!command.trim() || !revision}><Sparkles size={15} /> Refine</button></footer>
    <p className={`live-status ${status === "error" ? "error" : ""}`} aria-live="polite">{status === "processing" || status === "uploading" ? <LoaderCircle size={14} className="spin" /> : status === "error" ? <AlertCircle size={14} /> : <Check size={14} />}{statusMessage}</p>

    <AnimatePresence>{showShortcuts && <motion.div className="shortcut-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts"><div className="shortcut-card glass"><button type="button" className="modal-close" onClick={() => setShowShortcuts(false)} aria-label="Close keyboard shortcuts"><X size={17} /></button><span className="eyebrow">Keyboard shortcuts</span><h2>Stay in the flow</h2><dl><div><dt>Ctrl/Cmd + V</dt><dd>Paste an image</dd></div><div><dt>Ctrl/Cmd + K</dt><dd>Focus refinement bar</dd></div><div><dt>[ or ]</dt><dd>Switch workspace panel</dd></div><div><dt>Esc</dt><dd>Close transient surfaces</dd></div></dl></div></motion.div>}</AnimatePresence>
  </main>;
}
