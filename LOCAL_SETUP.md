# Local setup in VS Code

This guide runs the existing studio, including its persistent generation worker. It does not require direct OpenAI or Anthropic credentials. README.md and prompts.md remain the product specifications; this guide describes the currently implemented local workflow.

## 1. Prerequisites

Install Git, VS Code, and **Node.js 24** with npm (the version used by this repository's CI). Open a fresh VS Code terminal after installation so PATH updates take effect. Node.js 22.13 is the minimum; using Node 24 keeps your environment aligned with CI.

Use a local, writable folder, not a network share or cloud-synced folder: the application uses SQLite WAL plus private files on the same machine. No separate PostgreSQL, Redis, or FFmpeg installation is needed for this implementation.

Docker Desktop with Linux containers is recommended for stronger isolation and is required for generated Next.js builds and production rendering. The default development React preview can run without Docker; a child process is not equivalent to container isolation. Keep development access private and use Docker for untrusted workloads.

## 2. Open the repository

For your existing checkout, open **File > Open Folder** in VS Code and select `U:\Projects\SS2Code`. Do not clone another copy inside it.

For a new checkout, run:

```powershell
git clone https://github.com/hitesh-m-mahajan-DS-AI/ss2code.git
cd ss2code
code .
```

If `code` is unavailable, open that folder through VS Code's File menu. Trust the workspace only after reviewing it.

Open **Terminal > New Terminal** at the repository root (the folder containing package.json). The following commands use Windows PowerShell:

```powershell
node --version
npm.cmd --version
npm.cmd ci
npx.cmd playwright install chromium
```

On macOS/Linux, use `npm` and `npx` instead of `npm.cmd` and `npx.cmd`. On Linux, install Chromium's system libraries with `npx playwright install --with-deps chromium`.

Use `npm ci`, not a dependency upgrade, for a reproducible first install. It replaces node_modules using the committed lockfile. Stop the app before reinstalling dependencies.

## 3. Configure your private environment

In VS Code Explorer, copy .env.example to **.env.local** in the repository root. If .env.local already exists, edit it; do not overwrite your existing credentials.

Set these values in .env.local:

```dotenv
OPENROUTER_API_KEY=YOUR_OPENROUTER_KEY
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_HTTP_REFERER=http://localhost:3000
OPENROUTER_APP_TITLE=Screenshot-to-Code Studio
MODEL_POLICY=free_only
MODEL_PREFERRED_FAMILIES=nemotron,gemma
PRIVATE_STORAGE_ROOT=.data/private
SANDBOX_MODE=process
SANDBOX_IMAGE=ss2code-render:local
SESSION_SECRET=YOUR_RANDOM_SECRET
```

Replace both placeholder values. Obtain your inference key from your [OpenRouter account](https://openrouter.ai/settings/keys). Generate a session secret locally, then paste the result into SESSION_SECRET:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep that secret stable: changing it invalidates access through existing workspace cookies. Leave the retry/time-budget settings from .env.example at their defaults initially.

Never put keys in a NEXT_PUBLIC_ variable, source file, screenshot, commit, or chat message. .env.local and .data are Git-ignored. Confirm before pushing:

```powershell
git check-ignore .env.local .data/private
```

The studio and public model catalog can open without an inference key, but **Inspect reference**, generation, and AI refinement require a valid OpenRouter key. Free-model availability, capability support, and rate limits can change; zero-price routing does not promise unlimited requests.

## 4. Start the studio

Choose **one** method; do not launch a second copy of the same studio.

### Terminal

```powershell
npm.cmd run dev
```

Wait for both the Next.js ready message and **Persistent generation worker ready.** Open [http://localhost:3000](http://localhost:3000).

This command starts the web app and worker together. Starting only `next dev` leaves queued generation jobs without a worker. Keep the terminal open; use Ctrl+C to stop. Restart after editing .env.local. Web source updates refresh automatically; restart after changing worker/server orchestration code to reload the separate worker.

### F5 in VS Code

1. Open **Run and Debug** (Ctrl+Shift+D).
2. Select **SS2Code: Studio (web + worker)**.
3. Press **F5**, then open the local URL printed in the terminal.
4. Set breakpoints in your source as needed; the configuration enables child-process attachment.
5. Use **Shift+F5** to stop the debugging session.

The committed .vscode/launch.json uses VS Code's built-in Node debugger; no extra debugging extension is required. It does not embed credentials. Next.js and the worker load .env.local themselves.

Alternatively, use **Terminal > Run Task > SS2Code: Start studio**. Use **Terminal > Terminate Task** to stop it. The install, Chromium, test, and build tasks are also available there. Ctrl+Shift+B runs **SS2Code: Verify**; stop the studio first so verification does not compete with the development build.

## 5. First screenshot-to-code run

1. Select **Choose a file**, drag in a screenshot, or use **Paste image**. For a short video, select an extracted frame first.
2. Leave the model selector on **Balanced free · auto**, or choose a currently eligible free model.
3. Select **Inspect reference**. Review the Visual Spec and assumptions. Use **Edit JSON > Save edits** if a correction is needed.
4. Select **Generate validated build**. Follow the build activity; do not refresh repeatedly or submit duplicate jobs.
5. Once ready, test **Live**, device sizes, **Overlay**, **Diff**, and **Inspect**. Open **Files** to browse the full project tree and copy individual files.
6. Enter a small targeted refinement, such as “Reduce the header spacing to match the reference; preserve the text.” Review the new revision and use History or undo/redo to revisit earlier ready results.
7. Select **Export**, extract the ZIP into a separate folder, and open it in VS Code.

Use a PNG/JPEG screenshot for the simplest first run. Current file inputs accept PNG, JPEG, WebP, AVIF, GIF, MP4, WebM, and MOV up to 16 MB. Video decoding depends on browser codec support; keep clips at most two minutes. GIF input is not a full multi-state GIF editor. Image URL expects a direct public HTTPS image, not an arbitrary website page. PDF, design-file, ZIP asset ingestion, and multi-reference state merging described in the product specification are not implemented in the current input UI.

Use an original reference viewport between 280 and 3840 pixels wide, and 320 and 4096 pixels high, for the current renderer. For a very long full-page screenshot, crop the relevant section before upload rather than stretching it.

The current UI generates React + Tailwind projects. Next.js export/build support exists in the backend, but the studio currently has no framework selector. A single screenshot cannot establish unseen pages, backend behavior, or exact mobile/hover states; review those assumptions yourself.

## 6. Run an exported project

For the default React export, in the extracted folder:

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run dev
```

Open [http://localhost:4173](http://localhost:4173). This export needs no inference key. Its development command builds and serves static output; after editing source, rebuild/restart it. Follow the export's own README for other frameworks. Exported source and the studio are separate projects.

## 7. Enable Docker rendering

Start Docker Desktop in Linux-container mode and wait for its engine to be ready. From the studio root:

```powershell
docker info
docker build -f Dockerfile.render -t ss2code-render:local .
```

Both commands must succeed. Then change .env.local:

```dotenv
SANDBOX_MODE=docker
SANDBOX_IMAGE=ss2code-render:local
```

Restart the studio. The web app and queue still run locally; only build/render jobs use disposable, network-disabled containers. Rebuild this image after changes to dependencies, lock templates, or renderer source.

For a local production-mode check, stop development, keep Docker configured, and run:

```powershell
npm.cmd run build
npm.cmd start
```

Production rendering refuses process mode. Public hosting also requires HTTPS, a stable private volume, secrets, and supervision; see [DEPLOYMENT.md](./DEPLOYMENT.md).

## 8. Verify the installation

Stop the running studio first:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

No real inference key is needed by these tests. Browser tests use explicit fixtures and isolated temporary storage, exercise the actual app, then download, install, and build an exported ZIP. They need network access for dependency installation and reserve port 3100. Captures are written to .data/test-reports.

The test harness selects its renderer from the terminal environment, not SANDBOX_MODE in .env.local. To exercise Docker in tests from PowerShell, set the environment in that terminal:

```powershell
$env:SANDBOX_MODE = "docker"
npm.cmd test
npm.cmd run test:e2e
Remove-Item Env:SANDBOX_MODE
```

Setting SANDBOX_MODE=docker also enables the Next.js container-build assertion. The previous implementation commit passed these checks in [GitHub Actions](https://github.com/hitesh-m-mahajan-DS-AI/ss2code/actions/runs/36343779198). Live AI output quality still needs a real OpenRouter run.

## 9. Troubleshooting

| Symptom | What to check |
| --- | --- |
| npm.ps1 cannot run | Use the documented `npm.cmd` / `npx.cmd` commands in PowerShell; no execution-policy change is needed. |
| node or npm not found | Install Node 24, restart VS Code, and open a fresh terminal. |
| node:sqlite is unavailable | Verify the terminal uses Node 24, not an older installation on PATH. An experimental SQLite warning alone is not a failure. |
| Port 3000 is occupied / Next.js lock error | Stop the earlier studio/debug session. Do not run terminal, task, and F5 startup simultaneously. |
| Need another port | Set `$env:PORT = "3001"` before terminal startup, update OPENROUTER_HTTP_REFERER, and use the printed URL. This launcher does not forward extra npm arguments. |
| Chromium executable missing | Run `npx.cmd playwright install chromium` as the same OS user that runs the studio. |
| OPENROUTER_API_KEY missing / authentication failure | Set a valid key in root .env.local and restart both processes. Do not paste the key into diagnostics. |
| No eligible free model / rate limit | Retry later or choose another current compatible free model. Do not substitute a direct provider key or silently switch to paid models. |
| Job stays queued | Confirm **Persistent generation worker ready.** Use npm run dev, not next dev alone; inspect both process logs. |
| dockerDesktopLinuxEngine / daemon unavailable | Start Docker Desktop and verify `docker info`. A Docker CLI installation by itself is insufficient. |
| Export toolchain changed | After an intentional dependency change, run `npm.cmd run export:locks`, test, and rebuild the Docker image if used. Commit both export lock templates. |
| Old projects disappear | Use the same browser profile, origin/port, session secret, and private storage. Clearing the ownership cookie loses access; there is no account recovery system. |
| Typecheck/build conflict while dev is running | Stop the studio, then rerun verification. Do not delete private data as a build-cache fix. |

Keep .data/private: it contains your references, revisions, and queue. Do not clear it during troubleshooting. Use local disk for this data and keep backups. Never disable antivirus, remove sandboxing from production, or expose a Node debugger publicly to work around a startup error.

## Repository map

```text
.vscode/                 VS Code launch configuration and named tasks
src/app/                 Studio page and API routes
src/components/          Reference, blueprint, preview and history UI
src/lib/                 Domain types, schemas and role prompts
src/server/              OpenRouter, storage, orchestration and validation
src/workers/             Persistent job worker and isolated renderer
scripts/studio.mjs       Starts the web app and worker together
resources/export/        Reproducible generated-project lock templates
tests/                   Unit, integration and browser/export tests
.env.local               Your private configuration (not committed)
.data/private/           Local persistent data (not committed)
```

VS Code references: [Node debugging](https://code.visualstudio.com/docs/nodejs/nodejs-debugging) and [Tasks](https://code.visualstudio.com/docs/debugtest/tasks).
