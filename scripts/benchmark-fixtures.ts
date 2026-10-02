import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { datasetSchema, type BenchmarkCase } from "../src/evaluation/contracts";

const layouts = {
  dashboard: '<h1>Workspace overview</h1><p>Review today’s activity.</p><div class="grid"><section><h2>Active projects</h2><strong>24</strong></section><section><h2>Pending reviews</h2><strong>7</strong></section><section><h2>Completed</h2><strong>18</strong></section></div>',
  table: '<h1>Shipment log</h1><p>Latest dispatches</p><div class="scroll"><table><thead><tr><th>Reference</th><th>Status</th><th>Destination</th></tr></thead><tbody><tr><td>PK-104</td><td>Delivered</td><td>Bristol</td></tr><tr><td>PK-105</td><td>In transit</td><td>Leeds</td></tr><tr><td>PK-106</td><td>Preparing</td><td>York</td></tr></tbody></table></div>',
  settings: '<h1>Notification settings</h1><p>Choose what reaches your inbox.</p><section><label><input type="checkbox" defaultChecked /> Weekly summary</label><label><input type="checkbox" /> Product news</label><button type="button">Save preferences</button></section>',
  login: '<div class="narrow"><h1>Welcome back</h1><p>Sign in to your workspace.</p><label>Email<input type="email" placeholder="you@example.com" /></label><label>Password<input type="password" /></label><button type="button">Sign in</button><p><a href="#help">Need help?</a></p></div>',
  editorial: '<article><p class="eyebrow">FIELD NOTES · 04 OCTOBER</p><h1>Designing for quiet focus</h1><p class="lead">Useful tools leave room for thought.</p><section><h2>Start with the essentials</h2><p>Clear hierarchy makes important work easier to find. Remove distractions, preserve context, and keep actions within reach.</p><blockquote>Clarity is a practical design choice.</blockquote></section></article>',
  pricing: '<h1>Choose your workspace</h1><p>Simple plans for focused teams.</p><div class="grid"><section><h2>Personal</h2><strong>£0</strong><p>One project</p><button type="button">Choose Personal</button></section><section><h2>Team</h2><strong>£18</strong><p>Shared projects</p><button type="button">Choose Team</button></section></div>',
  catalog: '<h1>Studio collection</h1><p>Objects for everyday work.</p><div class="grid"><section><div class="swatch"></div><h2>Desk notebook</h2><p>£12 · Sand</p><button type="button">View notebook</button></section><section><div class="swatch blue"></div><h2>Weekly planner</h2><p>£16 · Blue</p><button type="button">View planner</button></section></div>',
  status: '<h1>Service status</h1><p>Updated at 09:30 UTC</p><section><h2>All systems operational</h2><ul><li>Dashboard — Operational</li><li>Uploads — Operational</li><li>Exports — Operational</li></ul></section><section><h2>Recent maintenance</h2><p>Scheduled updates completed without interruption.</p></section>',
};
const root = path.resolve(process.argv[2] ?? ".data/benchmarks/pilot");
await mkdir(root, { recursive: true });
const browser = await chromium.launch({ headless: true });
const cases: BenchmarkCase[] = [];
try {
  for (const [index, [category, body]] of Object.entries(layouts).entries()) for (const variant of ["desktop", "mobile", "dark"]) {
    const viewport = { width: variant === "mobile" ? 390 : 1280, height: variant === "mobile" ? 1000 : 900 };
    const dark = variant === "dark";
    const css = `*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:${dark ? "#111827" : "#f3f5fa"};color:${dark ? "#f9fafb" : "#172033"};line-height:1.5}main{min-height:100vh;padding:40px;max-width:1200px;margin:auto}nav{display:flex;gap:24px;flex-wrap:wrap;margin-bottom:40px}a{color:${dark ? "#c4b5fd" : "#4935b6"}}h1{font-size:38px;line-height:1.15;margin:0 0 18px}h2{font-size:22px;margin:0 0 12px}p{margin:0 0 20px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:24px}section{padding:24px;border:1px solid ${dark ? "#475569" : "#d1d5db"};border-radius:14px;background:${dark ? "#1e293b" : "white"};margin-bottom:24px}strong{font-size:34px}button{font:inherit;background:#4c35bb;color:white;border:0;border-radius:10px;padding:12px 20px;min-height:44px}button:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid #f59e0b;outline-offset:3px}label{display:block;margin:16px 0}input:not([type=checkbox]){display:block;width:100%;padding:12px;font:inherit;border:1px solid #64748b;border-radius:8px;margin-top:6px}.narrow{max-width:440px;margin:auto}.scroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:16px;border-bottom:1px solid #64748b}.eyebrow{letter-spacing:2px;font-size:12px}.lead{font-size:23px}blockquote{border-left:4px solid #7456dc;padding:12px;margin:0}.swatch{height:150px;background:#d6b991;border-radius:8px;margin-bottom:20px}.blue{background:#6594ae}li{margin-bottom:14px}@media(max-width:600px){main{padding:24px}h1{font-size:30px}nav{gap:18px;margin-bottom:28px}}`;
    const accessibleCss = css + "input:not([type=checkbox]){background:#fff;color:#172033}input::placeholder{color:#526077;opacity:1}";
    const markup = `<main data-ss2-region="page"><nav aria-label="Primary"><a href="#home">North Studio</a><a href="#work">Workspace</a><a href="#help">Help</a></nav>${body}</main>`;
    const page = await browser.newPage({ viewport });
    await page.setContent(`<!doctype html><html lang="en"><head><title>${category}</title><style>${accessibleCss}</style></head><body>${markup.replaceAll("defaultChecked", "checked")}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    const png = await page.screenshot();
    const text = await page.locator("main").innerText();
    const id = `${category}-${variant}`;
    await writeFile(path.join(root, id + ".png"), png);
    const oracleFiles = [{ path: "src/App.tsx", content: `import "./styles.css"; export default function App(){return (${markup.replaceAll('class="', 'className="')});}` }, { path: "src/styles.css", content: accessibleCss }];
    cases.push({ id, group: category, category, split: index < 4 ? "development" : index < 6 ? "validation" : "holdout", origin: "project-authored-synthetic", reference: id + ".png", sha256: createHash("sha256").update(png).digest("hex"), viewport, oracleFiles, oraclePlan: { entry: "src/App.tsx", files: oracleFiles.map(f => ({ path: f.path, purpose: "Authored fixture", exports: [], dependsOn: [], visualRegions: ["page"] })), designTokens: { colors: {}, spacing: {}, radii: {}, shadows: {}, motion: {} }, implementationDecisions: [], assumptionsUsed: [] }, truth: { reference: { viewport, pageType: category, confidence: "high" }, observations: { layout: [{ id: "page", region: "Page", boundsPct: await page.locator("main").evaluate(el => { const r = el.getBoundingClientRect(); return [r.x / innerWidth * 100, r.y / innerHeight * 100, r.width / innerWidth * 100, r.height / innerHeight * 100] as [number, number, number, number]; }), description: "Entire interface", importance: "critical" }], hierarchy: [category], style: { palette: [], typography: [], spacing: { basePxApprox: 8, notes: "Authored fixture" }, radii: "14px", bordersAndShadows: "", imagery: [] }, visibleInteractions: [], responsiveEvidence: [], visibleText: text.split(/\n+/).filter(Boolean).map(text => ({ region: "page", text, confidence: "high" as const })) }, constraints: { mustMatch: [], mustNotInvent: [], accessibilityRequirements: [] }, assumptions: [], implementationNotes: [] } });
    await page.close();
  }
  await writeFile(path.join(root, "manifest.json"), JSON.stringify(datasetSchema.parse({ version: "pilot-1", createdAt: new Date().toISOString(), cases }), null, 2));
  console.log(`Captured ${cases.length} synthetic references in 8 template groups: ${root}`);
} finally { await browser.close(); }
