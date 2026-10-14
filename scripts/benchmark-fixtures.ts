import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { datasetSchema, type BenchmarkCase } from "../src/evaluation/contracts";

const layouts = {
  dashboard: '<h1>Workspace overview</h1><p>Review today’s activity.</p><div class="grid"><section><h2>Active projects</h2><strong>24</strong></section><section><h2>Pending reviews</h2><strong>7</strong></section><section><h2>Completed</h2><strong>18</strong></section></div>',
  table: '<h1>Shipment log</h1><p>Latest dispatches</p><div class="scroll" tabindex="0" role="region" aria-label="Shipment table"><table><thead><tr><th>Reference</th><th>Status</th><th>Destination</th></tr></thead><tbody><tr><td>PK-104</td><td>Delivered</td><td>Bristol</td></tr><tr><td>PK-105</td><td>In transit</td><td>Leeds</td></tr><tr><td>PK-106</td><td>Preparing</td><td>York</td></tr></tbody></table></div>',
  settings: '<h1>Notification settings</h1><p>Choose what reaches your inbox.</p><section><label><input type="checkbox" defaultChecked /> Weekly summary</label><label><input type="checkbox" /> Product news</label><button type="button">Save preferences</button></section>',
  login: '<div class="narrow"><h1>Welcome back</h1><p>Sign in to your workspace.</p><label>Email<input type="email" placeholder="you@example.com" /></label><label>Password<input type="password" /></label><button type="button">Sign in</button><p><a href="#help">Need help?</a></p></div>',
  editorial: '<article><p class="eyebrow">FIELD NOTES · 04 OCTOBER</p><h1>Designing for quiet focus</h1><p class="lead">Useful tools leave room for thought.</p><section><h2>Start with the essentials</h2><p>Clear hierarchy makes important work easier to find. Remove distractions, preserve context, and keep actions within reach.</p><blockquote>Clarity is a practical design choice.</blockquote></section></article>',
  pricing: '<h1>Choose your workspace</h1><p>Simple plans for focused teams.</p><div class="grid"><section><h2>Personal</h2><strong>£0</strong><p>One project</p><button type="button">Choose Personal</button></section><section><h2>Team</h2><strong>£18</strong><p>Shared projects</p><button type="button">Choose Team</button></section></div>',
  catalog: '<h1>Studio collection</h1><p>Objects for everyday work.</p><div class="grid"><section><div class="swatch"></div><h2>Desk notebook</h2><p>£12 · Sand</p><button type="button">View notebook</button></section><section><div class="swatch blue"></div><h2>Weekly planner</h2><p>£16 · Blue</p><button type="button">View planner</button></section></div>',
  status: '<h1>Service status</h1><p>Updated at 09:30 UTC</p><section><h2>All systems operational</h2><ul><li>Dashboard — Operational</li><li>Uploads — Operational</li><li>Exports — Operational</li></ul></section><section><h2>Recent maintenance</h2><p>Scheduled updates completed without interruption.</p></section>',
};
const regionSelectors: Record<string, Array<[string, string]>> = {
  dashboard: [["nav", "navigation"], ["h1", "page-title"], [".grid", "summary-grid"], [".grid section:nth-child(1)", "active-projects"], [".grid section:nth-child(2)", "pending-reviews"], [".grid section:nth-child(3)", "completed-projects"]],
  table: [["nav", "navigation"], ["h1", "page-title"], [".scroll", "shipment-table"], ["tbody", "shipment-rows"]],
  settings: [["nav", "navigation"], ["h1", "page-title"], ["main > section", "settings-panel"], ["main > section label:nth-of-type(1)", "weekly-setting"], ["main > section label:nth-of-type(2)", "news-setting"], ["main > section button", "save-action"]],
  login: [["nav", "navigation"], ["h1", "page-title"], [".narrow", "login-form"], [".narrow label:nth-of-type(1)", "email-field"], [".narrow label:nth-of-type(2)", "password-field"], [".narrow button", "sign-in-action"]],
  editorial: [["nav", "navigation"], ["h1", "page-title"], ["article section", "article-section"], ["blockquote", "pull-quote"]],
  pricing: [["nav", "navigation"], ["h1", "page-title"], [".grid", "plan-grid"], [".grid section:nth-child(1)", "personal-plan"], [".grid section:nth-child(2)", "team-plan"]],
  catalog: [["nav", "navigation"], ["h1", "page-title"], [".grid", "product-grid"], [".grid section:nth-child(1)", "notebook-product"], [".grid section:nth-child(2)", "planner-product"]],
  status: [["nav", "navigation"], ["h1", "page-title"], ["main section:nth-of-type(1)", "system-status"], ["main section:nth-of-type(2)", "maintenance-notes"]],
};
const args = process.argv.slice(2);
const option = (name: string, fallback: string) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const requestedSplit = option("--split", "all");
if (!["all", "development", "validation", "holdout"].includes(requestedSplit)) throw new Error("Split must be all, development, validation, or holdout");
const root = path.resolve(option("--output", ".data/benchmarks/pilot"));
await mkdir(root, { recursive: true });
const browser = await chromium.launch({ headless: true });
const cases: BenchmarkCase[] = [];
const splitFor = (index: number) => index < 4 ? "development" : index < 6 ? "validation" : "holdout";
try {
  for (const [index, [category, body]] of Object.entries(layouts).entries()) for (const variant of ["desktop", "mobile", "dark"]) {
    const split = splitFor(index);
    if (requestedSplit !== "all" && requestedSplit !== split) continue;
    const viewport = { width: variant === "mobile" ? 390 : 1280, height: variant === "mobile" ? 1000 : 900 };
    const dark = variant === "dark";
    const css = `*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:${dark ? "#111827" : "#f3f5fa"};color:${dark ? "#f9fafb" : "#172033"};line-height:1.5}main{min-height:100vh;padding:40px;max-width:1200px;margin:auto}nav{display:flex;gap:24px;flex-wrap:wrap;margin-bottom:40px}a{color:${dark ? "#c4b5fd" : "#4935b6"}}h1{font-size:38px;line-height:1.15;margin:0 0 18px}h2{font-size:22px;margin:0 0 12px}p{margin:0 0 20px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:24px}section{padding:24px;border:1px solid ${dark ? "#475569" : "#d1d5db"};border-radius:14px;background:${dark ? "#1e293b" : "white"};margin-bottom:24px}strong{font-size:34px}button{font:inherit;background:#4c35bb;color:white;border:0;border-radius:10px;padding:12px 20px;min-height:44px}button:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid #f59e0b;outline-offset:3px}label{display:block;margin:16px 0}input:not([type=checkbox]){display:block;width:100%;padding:12px;font:inherit;border:1px solid #64748b;border-radius:8px;margin-top:6px}.narrow{max-width:440px;margin:auto}.scroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:16px;border-bottom:1px solid #64748b}.eyebrow{letter-spacing:2px;font-size:12px}.lead{font-size:23px}blockquote{border-left:4px solid #7456dc;padding:12px;margin:0}.swatch{height:150px;background:#d6b991;border-radius:8px;margin-bottom:20px}.blue{background:#6594ae}li{margin-bottom:14px}@media(max-width:600px){main{padding:24px}h1{font-size:30px}nav{gap:18px;margin-bottom:28px}}`;
    const accessibleCss = css + "h1,h2,strong,th{font-weight:700}input:not([type=checkbox]){background:#fff;color:#172033}input::placeholder{color:#526077;opacity:1}[tabindex]:focus-visible{outline:3px solid #f59e0b;outline-offset:3px}";
    let markup = `<main data-ss2-region="page"><nav aria-label="Primary"><a href="#home">North Studio</a><a href="#work">Workspace</a><a href="#help">Help</a></nav>${body}</main>`;
    const page = await browser.newPage({ viewport });
    await page.setContent(`<!doctype html><html lang="en"><head><title>${category}</title><style>${accessibleCss}</style></head><body>${markup.replaceAll("defaultChecked", "checked")}</body></html>`);
    for (const [selector, id] of regionSelectors[category]) {
      const locator = page.locator(selector);
      if (await locator.count() !== 1) throw new Error(`Fixture region ${id} must map to exactly one element in ${id}-${variant}`);
      await locator.evaluate((element, regionId) => { element.setAttribute("data-ss2-region", regionId); if (regionId === "page-title") element.setAttribute("data-ss2-typography", "page-title"); }, id);
    }
    markup = await page.locator("main").evaluate(element => element.outerHTML);
    const jsxMarkup = markup.replaceAll('class="', 'className="').replaceAll('tabindex="0"', 'tabIndex={0}').replace(/ checked=""/g, " defaultChecked").replace(/<(input|img|br|hr|meta|link|area|base|embed|source|track|wbr)([^>]*?)(?<!\/)\s*>/gi, "<$1$2 />");
    await page.evaluate(() => document.fonts.ready);
    const png = await page.screenshot();
    const regions = await page.locator("[data-ss2-region]").evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect(), id = (node as HTMLElement).dataset.ss2Region!;
      return { id, region: id.replaceAll("-", " "), boundsPct: [rect.x / innerWidth * 100, rect.y / innerHeight * 100, rect.width / innerWidth * 100, rect.height / innerHeight * 100] as [number, number, number, number], description: id === "page" ? "Entire interface" : "Authored visual region: " + id.replaceAll("-", " "), importance: id === "page" || id === "page-title" ? "critical" as const : "high" as const };
    }));
    const visibleText = await page.locator("main").evaluate(element => [...element.querySelectorAll<HTMLElement>("h1,h2,h3,p,a,button,th,td,label,strong,blockquote")].map(node => ({ region: node.closest<HTMLElement>("[data-ss2-region]")?.dataset.ss2Region ?? "page", text: (node.innerText ?? "").replace(/\s+/g, " ").trim(), confidence: "high" as const })).filter(item => item.text));
    const typography = await page.locator('[data-ss2-typography="page-title"]').evaluate(element => { const style = getComputedStyle(element); return [{ role: "page-title", sizePxApprox: Number.parseFloat(style.fontSize), weight: style.fontWeight, notes: "Browser-measured authored fixture heading", regionId: "page-title", confidence: "high" as const }]; });
    const id = `${category}-${variant}`;
    await writeFile(path.join(root, id + ".png"), png);
    const oracleFiles = [{ path: "src/App.tsx", content: `import "./styles.css"; export default function App(){return (${jsxMarkup});}` }, { path: "src/styles.css", content: accessibleCss }];
    const layout = regions.map(region => ({ ...region, region: region.region.replace(/^page$/, "Page") }));
    const oracleRegions = layout.map(region => region.id);
    cases.push({ id, group: category, category, split, origin: "project-authored-synthetic", reference: id + ".png", sha256: createHash("sha256").update(png).digest("hex"), viewport, oracleFiles, oraclePlan: { entry: "src/App.tsx", files: oracleFiles.map(f => ({ path: f.path, purpose: "Authored fixture", exports: [], dependsOn: [], visualRegions: oracleRegions })), designTokens: { colors: {}, spacing: {}, radii: {}, shadows: {}, motion: {} }, implementationDecisions: [], assumptionsUsed: [] }, truth: { reference: { viewport, pageType: category, confidence: "high" }, observations: { layout, hierarchy: [category], style: { palette: [], typography, spacing: { basePxApprox: 8, notes: "Authored fixture" }, radii: "14px", bordersAndShadows: "", imagery: [] }, visibleInteractions: [], responsiveEvidence: [], visibleText }, constraints: { mustMatch: [], mustNotInvent: [], accessibilityRequirements: [] }, assumptions: [], implementationNotes: [] } });
    await page.close();
  }
  await writeFile(path.join(root, "manifest.json"), JSON.stringify(datasetSchema.parse({ version: "pilot-1", createdAt: new Date().toISOString(), cases }), null, 2));
  console.log(`Captured ${cases.length} synthetic references in ${requestedSplit} split: ${root}`);
} finally { await browser.close(); }
